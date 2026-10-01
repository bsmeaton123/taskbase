import { Suspense } from "react";
import { requireUser } from "@/lib/session";
import { getTaskDetail } from "@/server/queries";
import { MissingTask, TaskPanelShell, TaskPanelSkeleton } from "./panel-shell";
import { TaskPanel } from "./task-panel";

async function TaskPanelData({ taskId }: { taskId: string }) {
  const viewer = await requireUser();
  const detail = await getTaskDetail(viewer, taskId);
  return detail ? <TaskPanel key={detail.task.id} detail={detail} /> : <MissingTask />;
}

/** Renders the task panel for `?task=<id>` on any page. */
export function TaskPanelSlot({ taskId: raw }: { taskId: string | string[] | undefined }) {
  const taskId = Array.isArray(raw) ? raw[0] : raw;
  if (!taskId || taskId.length > 64) return null;
  return (
    <TaskPanelShell>
      <Suspense key={taskId} fallback={<TaskPanelSkeleton />}>
        <TaskPanelData taskId={taskId} />
      </Suspense>
    </TaskPanelShell>
  );
}
