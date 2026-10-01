import "server-only";
import { and, eq, inArray, max, notInArray, or, type AnyColumn } from "drizzle-orm";
import {
  activities,
  notifications,
  subtasks,
  taskDependencies,
  taskFollowers,
  tasks,
  workspaceMembers,
} from "@/db/schema";
import { pruneAssignees } from "@/server/assignees";
import { logActivity, type Executor } from "@/server/events";
import { carryTags } from "@/server/tags";

/**
 * Moves tasks (with their subtasks, comments, files and history) to a list in another
 * workspace. People who aren't members there are unassigned, stop following, and lose
 * their inbox items for these tasks, so nothing leaks across workspaces.
 * Callers check access to the tasks and the target first.
 */
export async function moveTasksToWorkspace(
  tx: Executor,
  input: {
    tasks: { id: string }[];
    workspace: { id: string; name: string };
    list: { id: string; name: string };
    actorId: string;
  },
) {
  const taskIds = input.tasks.map((t) => t.id);
  if (taskIds.length === 0) return;
  const memberIds = (
    await tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, input.workspace.id))
  ).map((m) => m.userId);
  const nonMember = (column: AnyColumn) =>
    memberIds.length ? notInArray(column, memberIds) : undefined;

  const [{ hi }] = await tx
    .select({ hi: max(tasks.position) })
    .from(tasks)
    .where(eq(tasks.taskListId, input.list.id));
  let position = hi ?? 0;

  for (const task of input.tasks) {
    position += 1024;
    await tx
      .update(tasks)
      .set({ workspaceId: input.workspace.id, taskListId: input.list.id, position })
      .where(eq(tasks.id, task.id));
  }

  // Only active members of the target workspace stay assigned.
  await pruneAssignees(tx, taskIds, input.workspace.id);
  await tx
    .update(subtasks)
    .set({ assigneeId: null })
    .where(and(inArray(subtasks.taskId, taskIds), nonMember(subtasks.assigneeId)));
  await tx
    .delete(taskFollowers)
    .where(and(inArray(taskFollowers.taskId, taskIds), nonMember(taskFollowers.userId)));
  await tx
    .update(activities)
    .set({ workspaceId: input.workspace.id })
    .where(inArray(activities.taskId, taskIds));
  await tx
    .delete(notifications)
    .where(and(inArray(notifications.taskId, taskIds), nonMember(notifications.userId)));
  await tx
    .update(notifications)
    .set({ workspaceId: input.workspace.id })
    .where(inArray(notifications.taskId, taskIds));

  // Links to tasks left behind would cross workspaces; keep only links among the moved tasks.
  await tx
    .delete(taskDependencies)
    .where(
      or(
        and(inArray(taskDependencies.taskId, taskIds), notInArray(taskDependencies.dependsOnId, taskIds)),
        and(inArray(taskDependencies.dependsOnId, taskIds), notInArray(taskDependencies.taskId, taskIds)),
      ),
    );

  // Tags belong to a workspace: swap each for the same-named tag in the target.
  await carryTags(tx, new Map(taskIds.map((id) => [id, id])), input.workspace.id, { replace: true });

  for (const id of taskIds) {
    await logActivity(tx, {
      workspaceId: input.workspace.id,
      taskId: id,
      actorId: input.actorId,
      kind: "moved",
      data: { list: input.list.name, workspace: input.workspace.name },
    });
  }
}
