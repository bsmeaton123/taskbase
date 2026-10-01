import "server-only";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { taskDependencies, tasks } from "@/db/schema";
import { getAssigneeMap } from "@/server/assignees";
import { filterMembers, notify, type Executor } from "@/server/events";

const CLOSED = ["resolved", "rejected"] as const;

/** Would making `taskId` wait for `dependsOnId` create a loop (a task waiting on itself)? */
export async function wouldCreateCycle(tx: Executor, taskId: string, dependsOnId: string) {
  if (taskId === dependsOnId) return true;
  // Walk everything dependsOnId is (transitively) waiting for.
  const seen = new Set<string>([dependsOnId]);
  let frontier = [dependsOnId];
  while (frontier.length > 0) {
    const rows = await tx
      .select({ id: taskDependencies.dependsOnId })
      .from(taskDependencies)
      .where(inArray(taskDependencies.taskId, frontier));
    frontier = [];
    for (const { id } of rows) {
      if (id === taskId) return true;
      if (!seen.has(id)) {
        seen.add(id);
        frontier.push(id);
      }
    }
    if (seen.size > 5000) return true; // pathological graphs: refuse rather than spin
  }
  return false;
}

/**
 * After a task is closed: tell the assignees of tasks that were waiting on it, if nothing
 * else is holding them up any more.
 */
export async function notifyUnblocked(
  tx: Executor,
  task: { id: string; number: number; title: string; workspaceId: string },
  actorId: string,
  opts: { skipTaskIds?: Set<string>; email?: boolean } = {},
) {
  const waiting = await tx
    .select({ id: tasks.id })
    .from(taskDependencies)
    .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
    .where(and(eq(taskDependencies.dependsOnId, task.id), notInArray(tasks.status, [...CLOSED])));
  const assignees = await getAssigneeMap(
    tx,
    waiting.map((w) => w.id),
  );
  for (const w of waiting) {
    const assigneeIds = assignees.get(w.id) ?? [];
    if (assigneeIds.length === 0 || opts.skipTaskIds?.has(w.id)) continue;
    const stillBlocked = await tx
      .select({ id: tasks.id })
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
      .where(and(eq(taskDependencies.taskId, w.id), notInArray(tasks.status, [...CLOSED])))
      .limit(1);
    if (stillBlocked.length > 0) continue;
    const members = await filterMembers(tx, task.workspaceId, assigneeIds);
    if (members.length === 0) continue;
    await notify(tx, members, {
      kind: "unblocked",
      actorId,
      workspaceId: task.workspaceId,
      taskId: w.id,
      data: { blockerNumber: task.number, blockerTitle: task.title },
    }, { email: opts.email });
  }
}
