import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import {
  DangerZone,
  EmailInSettings,
  GeneralSettings,
  MembersSettings,
  TagSettings,
  TemplateSettings,
} from "@/components/workspace/settings";
import { getWorkspaceAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { inboundAddressFor, recentInboundEmails } from "@/server/inbound/ingest";
import { getActivePeople, getWorkspaceMembers, getWorkspaceTags } from "@/server/queries";

export const metadata: Metadata = { title: "Workspace settings" };

export default async function WorkspaceSettingsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const viewer = await requireUser();
  const access = await getWorkspaceAccess(viewer, workspaceId);
  if (!access) notFound();
  const [members, people, tags, inbound] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    getActivePeople(),
    getWorkspaceTags(workspaceId),
    recentInboundEmails(workspaceId),
  ]);
  const ws = access.workspace;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Settings"
        leading={
          <Link
            href={`/w/${ws.id}`}
            className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-text"
          >
            <ArrowLeftIcon size={15} />
            <WorkspaceMark color={ws.color} size={12} className="rounded-[4px]" />
            <span className="max-w-[40vw] truncate font-semibold tracking-tight">{ws.name}</span>
            <span className="text-subtle">/</span>
          </Link>
        }
      />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-2xl gap-10 px-4 py-8 sm:px-6">
          <GeneralSettings
            workspace={{
              id: ws.id,
              name: ws.name,
              description: ws.description,
              color: ws.color,
            }}
            canManage={access.canManage}
          />
          <MembersSettings
            workspaceId={ws.id}
            members={members}
            people={people}
            canManage={access.canManage}
            isMember={access.role !== "admin"}
          />
          <TagSettings workspaceId={ws.id} tags={tags} />
          {!ws.isTemplate && (
            <EmailInSettings
              workspaceId={ws.id}
              address={inboundAddressFor(ws.inboundKey)}
              archived={Boolean(ws.archivedAt)}
              canManage={access.canManage}
              recent={inbound}
            />
          )}
          {access.canManage && (
            <TemplateSettings
              workspace={{ id: ws.id, name: ws.name, isTemplate: ws.isTemplate }}
            />
          )}
          {access.canManage && (
            <DangerZone
              workspace={{ id: ws.id, name: ws.name, archived: Boolean(ws.archivedAt) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
