import { ArchiveIcon, CopySimpleIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { BoardView } from "@/components/workspace/board-view";
import { BulkActionBar } from "@/components/workspace/bulk-bar";
import { GanttView } from "@/components/workspace/gantt-view";
import { ListView } from "@/components/workspace/list-view";
import { TaskSelectionProvider } from "@/components/workspace/selection";
import { WorkspaceToolbar } from "@/components/workspace/toolbar";
import { getWorkspaceAccess } from "@/lib/access";
import { requireUser } from "@/lib/session";
import { getWorkspacePage, type WorkspaceFilters } from "@/server/queries";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { workspaceId } = await params;
  const viewer = await requireUser();
  const access = await getWorkspaceAccess(viewer, workspaceId);
  return { title: access?.workspace.name ?? "Workspace" };
}

function one(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function WorkspacePage({ params, searchParams }: Props) {
  const [{ workspaceId }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireUser();

  const viewParam = one(sp.view);
  const view = viewParam === "board" || viewParam === "gantt" ? viewParam : "list";
  const showParam = one(sp.show);
  const show: WorkspaceFilters["show"] =
    showParam === "all" || showParam === "closed" ? showParam : "open";
  const assignee = one(sp.assignee) || "anyone";
  const tagParam = one(sp.tag);
  const tag = tagParam && /^[\w-]{6,40}$/.test(tagParam) ? tagParam : null;
  const taskId = one(sp.task);

  const data = await getWorkspacePage(viewer, workspaceId, { show, assignee, tag });
  if (!data) notFound();
  const { access, members, lists, tasks, closedCount, dependencies, tags, subtasks } = data;
  const ws = access.workspace;

  const listOptions = lists.map((l) => ({ id: l.id, name: l.name }));

  return (
    <TaskSelectionProvider key={ws.id}>
      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-w-0 flex-1 flex-col">
          <PageHeader
            keepTitle
            title={ws.name}
            leading={<WorkspaceMark color={ws.color} size={12} className="rounded-[4px]" />}
          >
            <WorkspaceToolbar
              workspace={{
                id: ws.id,
                name: ws.name,
                color: ws.color,
                isTemplate: ws.isTemplate,
                canManage: access.canManage,
              }}
              view={view}
              show={show}
              assignee={assignee}
              tag={tag}
              tags={tags}
              members={members}
              lists={listOptions}
            />
          </PageHeader>

          {ws.isTemplate && (
            <div className="flex items-center gap-2 border-b border-border bg-accent-soft/60 px-4 py-2 text-[13px] text-accent-text sm:px-6">
              <CopySimpleIcon size={15} className="shrink-0" />
              This is a template. Edit it like any workspace; new workspaces made from it get a
              copy of its task lists, tasks and subtasks.
            </div>
          )}
          {ws.archivedAt && (
            <div className="flex items-center gap-2 border-b border-border bg-warning-soft px-4 py-2 text-[13px] sm:px-6">
              <ArchiveIcon size={15} className="shrink-0 text-warning" />
              This workspace is archived. It&apos;s hidden from the sidebar but everything still works.
            </div>
          )}

          <div
            className={
              view === "list"
                ? "scrollbar-thin min-h-0 flex-1 overflow-y-auto"
                : "min-h-0 flex-1 overflow-hidden"
            }
          >
            {view === "board" ? (
              <BoardView
                workspaceId={ws.id}
                lists={listOptions}
                tasks={tasks}
              />
            ) : view === "gantt" ? (
              <GanttView lists={listOptions} tasks={tasks} dependencies={dependencies} />
            ) : (
              <>
                {ws.description && (
                  <p className="max-w-[70ch] px-4 pb-1 pt-4 text-[13.5px] text-muted sm:px-6">
                    {ws.description}
                  </p>
                )}
                <ListView
                  workspaceId={ws.id}
                  lists={listOptions}
                  tasks={tasks}
                  subtasks={subtasks}
                  filtered={show !== "open" || assignee !== "anyone" || Boolean(tag)}
                  footer={
                    show === "open" && closedCount > 0 ? (
                      <p key="hidden-note" className="px-4 pt-2 text-[13px] text-subtle sm:px-6">
                        {closedCount} completed {closedCount === 1 ? "task is" : "tasks are"}{" "}
                        hidden. Use Filter to show them.
                      </p>
                    ) : null
                  }
                />
              </>
            )}
          </div>
          <BulkActionBar
            workspaceId={ws.id}
            lists={listOptions}
            members={members}
            tasks={tasks}
            tags={tags}
          />
        </div>
        <TaskPanelSlot taskId={taskId} />
      </div>
    </TaskSelectionProvider>
  );
}
