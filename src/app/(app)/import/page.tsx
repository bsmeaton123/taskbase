import type { Metadata } from "next";
import { inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { redboothImportedProjects, user, workspaces } from "@/db/schema";
import { PageHeader } from "@/components/page-header";
import { RedboothImport, type ImportView } from "@/components/redbooth-import";
import { appUrl } from "@/lib/email";
import { matchPeople } from "@/lib/redbooth-plan";
import { requireUser } from "@/lib/session";
import { RedboothError } from "@/server/redbooth/client";
import {
  getRedboothConnection,
  redboothClientFor,
  redboothOAuthConfigured,
} from "@/server/redbooth/connection";
import { importState, latestRedboothImport } from "@/server/redbooth/import";

export const metadata: Metadata = { title: "Import from Redbooth" };

const ERRORS: Record<string, string> = {
  state: "That sign-in link had expired or came from somewhere else. Try connecting again.",
  denied: "Redbooth didn't give access. Try connecting again, and choose Allow.",
  connect: "Redbooth sign-in didn't work. Try again in a minute.",
  "not-configured": "Redbooth sign-in isn't set up on this server yet. Paste an access token instead.",
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const viewer = await requireUser();
  if (!viewer.isAdmin) notFound();
  const sp = await searchParams;
  const [connection, job] = await Promise.all([
    getRedboothConnection(viewer.id),
    latestRedboothImport(),
  ]);

  let catalogue: ImportView["catalogue"] = null;
  let loadError: string | null = null;
  if (connection) {
    try {
      const rb = (await redboothClientFor(viewer.id))!;
      const [projects, rbUsers, imported, local] = await Promise.all([
        rb.projects(),
        rb.users(),
        db
          .select({ projectId: redboothImportedProjects.projectId, workspaceId: redboothImportedProjects.workspaceId })
          .from(redboothImportedProjects),
        db.select({ id: user.id, email: user.email, banned: user.banned }).from(user),
      ]);
      const wsIds = imported.map((i) => i.workspaceId).filter((id): id is string => Boolean(id));
      const wsNames = new Map(
        wsIds.length
          ? (await db.select({ id: workspaces.id, name: workspaces.name }).from(workspaces).where(inArray(workspaces.id, wsIds))).map(
              (w) => [w.id, w.name],
            )
          : [],
      );
      const importedAs = new Map(
        imported.flatMap((i) =>
          i.workspaceId && wsNames.has(i.workspaceId)
            ? [[i.projectId, { id: i.workspaceId, name: wsNames.get(i.workspaceId)! }] as const]
            : [],
        ),
      );
      const people = [...matchPeople(rbUsers, local.map((p) => ({ id: p.id, email: p.email, active: !p.banned }))).values()];
      catalogue = {
        projects: projects
          .map((p) => ({ id: p.id, name: p.name || `Project ${p.id}`, importedAs: importedAs.get(p.id) ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        people: {
          total: people.length,
          matched: people.filter((p) => p.local?.active).length,
          missing: people.filter((p) => !p.local).map((p) => ({ name: p.name, email: p.email })),
          deactivated: people.filter((p) => p.local && !p.local.active).map((p) => p.name),
        },
      };
    } catch (error) {
      loadError =
        error instanceof RedboothError ? error.message : "Couldn't reach Redbooth. Try again in a minute.";
      if (!(error instanceof RedboothError)) console.error("[redbooth] loading projects failed", error);
    }
  }

  const view: ImportView = {
    oauth: redboothOAuthConfigured(),
    callbackUrl: appUrl("/api/redbooth/callback"),
    connection: connection ? { name: connection.name, email: connection.email, expires: !connection.tokens.refreshToken } : null,
    notice: sp.error
      ? { text: Object.hasOwn(ERRORS, sp.error) ? ERRORS[sp.error] : ERRORS.connect, error: true }
      : sp.connected
        ? { text: "Redbooth is connected", error: false }
        : null,
    loadError,
    catalogue,
    job: job
      ? {
          state: importState(job),
          progress: job.progress,
          error: job.error,
          finishedAt: job.finishedAt,
        }
      : null,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Import from Redbooth" />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <RedboothImport view={view} />
      </div>
    </div>
  );
}
