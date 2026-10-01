"use server";

import { and, eq, gt } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { redboothImports } from "@/db/schema";
import type { ImportProgress } from "@/lib/redbooth";
import { personName } from "@/lib/redbooth";
import { ActionError, requireActionUser } from "@/lib/session";
import { run } from "@/server/action-utils";
import { RedboothError, redboothClient } from "@/server/redbooth/client";
import {
  deleteRedboothConnection,
  redboothClientFor,
  saveRedboothConnection,
} from "@/server/redbooth/connection";
import { runRedboothImport, STALE_AFTER_MS } from "@/server/redbooth/import";

async function requireAdmin() {
  const viewer = await requireActionUser();
  if (!viewer.isAdmin) throw new ActionError("Only admins can import from Redbooth.");
  return viewer;
}

/** For when OAuth isn't set up: an access token pasted from Redbooth (valid for two hours). */
export async function connectRedboothWithToken(token: string) {
  return run(async () => {
    const viewer = await requireAdmin();
    const accessToken = z.string().trim().min(10, "That doesn't look like an access token.").max(500).parse(token);
    const tokens = { accessToken, refreshToken: null, expiresAt: null };
    try {
      const me = await redboothClient({ tokens }).me();
      await saveRedboothConnection(viewer.id, tokens, { name: personName(me), email: me.email ?? null });
    } catch (error) {
      if (error instanceof RedboothError) throw new ActionError(error.message);
      throw error;
    }
    return null;
  });
}

export async function disconnectRedbooth() {
  return run(async () => {
    const viewer = await requireAdmin();
    await deleteRedboothConnection(viewer.id);
    return null;
  });
}

export async function startRedboothImport(projectIds: string[]) {
  return run(async () => {
    const viewer = await requireAdmin();
    const ids = z.array(z.string().min(1).max(40)).min(1, "Choose at least one project.").max(500).parse(projectIds);

    const [running] = await db
      .select({ id: redboothImports.id })
      .from(redboothImports)
      .where(
        and(
          eq(redboothImports.status, "running"),
          gt(redboothImports.updatedAt, new Date(Date.now() - STALE_AFTER_MS)),
        ),
      )
      .limit(1);
    if (running) throw new ActionError("An import is already running. Wait for it to finish.");

    const rb = await redboothClientFor(viewer.id);
    if (!rb) throw new ActionError("Connect Redbooth first.");
    let names: Map<string, string>;
    try {
      names = new Map((await rb.projects()).map((p) => [p.id, p.name || `Project ${p.id}`]));
    } catch (error) {
      if (error instanceof RedboothError) throw new ActionError(error.message);
      throw error;
    }
    const chosen = [...new Set(ids)].filter((id) => names.has(id));
    if (chosen.length === 0) throw new ActionError("Those projects aren't in this Redbooth account.");

    const progress: ImportProgress = {
      step: "Starting",
      projects: chosen.map((id) => ({ id, name: names.get(id)!, status: "waiting" })),
    };
    const [job] = await db
      .insert(redboothImports)
      .values({ startedById: viewer.id, progress })
      .returning({ id: redboothImports.id });

    after(() => runRedboothImport(job.id, viewer.id));
    return { importId: job.id };
  });
}
