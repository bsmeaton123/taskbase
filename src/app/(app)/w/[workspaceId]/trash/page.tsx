import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import { TrashList } from "@/components/workspace/trash-list";
import { getWorkspaceAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { TRASH_DAYS } from "@/lib/trash";
import { listTrash } from "@/server/trash";

export const metadata: Metadata = { title: "Trash" };

export default async function WorkspaceTrashPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const [{ workspaceId }, { task }] = await Promise.all([params, searchParams]);
  const viewer = await requireUser();
  const access = await getWorkspaceAccess(viewer, workspaceId);
  if (!access) notFound();
  const entries = await listTrash(workspaceId);
  const ws = access.workspace;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Trash"
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
        <TrashList
          workspaceId={ws.id}
          entries={entries}
          canManage={access.canManage}
          highlight={task && /^\d+$/.test(task) ? Number(task) : null}
          days={TRASH_DAYS}
        />
      </div>
    </div>
  );
}
