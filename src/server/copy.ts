import "server-only";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  subtasks,
  taskDependencies,
  taskFollowers,
  tasks,
  type Task,
} from "@/db/schema";
import { daysUntil, shiftDate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { shiftRecurrence } from "@/lib/recurrence";
import { isClosed } from "@/lib/status";
import { carryAssignees } from "@/server/assignees";
import { activeMemberIds } from "@/server/events";
import { carryTags } from "@/server/tags";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DateMode =
  | { mode: "keep" }
  | { mode: "clear" }
  | { mode: "shift"; startOn: string };

export type CopyOptions = {
  includeSubtasks: boolean;
  keepAssignees: boolean;
  /** Reopen tasks and uncheck subtasks in the copy. */
  resetProgress: boolean;
  dates: DateMode;
};

async function insertInChunks<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

/**
 * Copies tasks (and optionally their subtasks) into new lists. Comments,
 * files and history stay with the originals. Returns old → new task ids.
 */
export async function copyTasks(
  tx: Tx,
  opts: CopyOptions & {
    source: Task[];
    targetWorkspaceId: string;
    /** Old list id → new list id. Tasks whose list isn't mapped are skipped. */
    listMap: Map<string, string>;
    actorId: string;
    /** People who may stay assigned in the target workspace. */
    allowedAssignees: Set<string>;
    /** Overrides for the first/only task (used by "Duplicate task"). */
    positionFor?: (task: Task) => number;
    titleFor?: (task: Task) => string;
  },
) {
  const source = opts.source.filter((t) => opts.listMap.has(t.taskListId));
  const idMap = new Map<string, string>();
  if (source.length === 0) return idMap;

  const sourceSubtasks = opts.includeSubtasks
    ? await tx
        .select()
        .from(subtasks)
        .where(
          inArray(
            subtasks.taskId,
            source.map((t) => t.id),
          ),
        )
        .orderBy(asc(subtasks.position))
    : [];

  // Shift every date by the same number of days so the earliest lands on startOn.
  let offset = 0;
  if (opts.dates.mode === "shift") {
    const all = [
      ...source.map((t) => t.startDate),
      ...source.map((t) => t.dueDate),
      ...sourceSubtasks.map((s) => s.dueDate),
    ].filter((d): d is string => Boolean(d));
    const earliest = all.sort()[0];
    if (earliest) offset = daysUntil(opts.dates.startOn, earliest);
  }
  const mapDate = (d: string | null) =>
    !d || opts.dates.mode === "clear" ? null : offset ? shiftDate(d, offset) : d;
  const mapAssignee = (id: string | null) =>
    opts.keepAssignees && id && opts.allowedAssignees.has(id) ? id : null;

  const now = new Date();
  const taskRows = source.map((t) => {
    const id = newId();
    idMap.set(t.id, id);
    const status = opts.resetProgress ? "open" : t.status;
    return {
      id,
      workspaceId: opts.targetWorkspaceId,
      taskListId: opts.listMap.get(t.taskListId)!,
      title: opts.titleFor?.(t) ?? t.title,
      description: t.description,
      status,
      urgent: t.urgent,
      startDate: mapDate(t.startDate),
      dueDate: mapDate(t.dueDate),
      recurrence: t.recurrence
        ? shiftRecurrence(
            { ...t.recurrence, until: t.recurrence.until ? mapDate(t.recurrence.until) : null },
            t.dueDate,
            mapDate(t.dueDate),
          )
        : null,
      position: opts.positionFor?.(t) ?? t.position,
      createdById: opts.actorId,
      completedAt: isClosed(status) ? (t.completedAt ?? now) : null,
    } satisfies typeof tasks.$inferInsert;
  });
  await insertInChunks(taskRows, (chunk) => tx.insert(tasks).values(chunk));

  await insertInChunks(
    taskRows.map((t) => ({
      workspaceId: opts.targetWorkspaceId,
      taskId: t.id,
      actorId: opts.actorId,
      kind: "task_created" as const,
    })),
    (chunk) => tx.insert(activities).values(chunk),
  );

  // Assignees who may stay (and are still active members there) come along, in order,
  // and follow the copies.
  if (opts.keepAssignees) {
    const active = await activeMemberIds(tx, opts.targetWorkspaceId);
    const allowed = new Set([...opts.allowedAssignees].filter((id) => active.has(id)));
    const assigned = await carryAssignees(tx, idMap, allowed);
    await insertInChunks(assigned, (chunk) =>
      tx.insert(taskFollowers).values(chunk).onConflictDoNothing(),
    );
  }

  const subtaskRows = sourceSubtasks.map((s) => {
    const done = opts.resetProgress ? false : s.done;
    return {
      id: newId(),
      taskId: idMap.get(s.taskId)!,
      title: s.title,
      done,
      assigneeId: mapAssignee(s.assigneeId),
      dueDate: mapDate(s.dueDate),
      position: s.position,
      completedAt: done ? (s.completedAt ?? now) : null,
      createdById: opts.actorId,
    } satisfies typeof subtasks.$inferInsert;
  });
  await insertInChunks(subtaskRows, (chunk) => tx.insert(subtasks).values(chunk));

  // Keep "blocked by" links between tasks that were copied together.
  const links = source.length
    ? await tx
        .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
        .from(taskDependencies)
        .where(inArray(taskDependencies.taskId, source.map((t) => t.id)))
    : [];
  const copiedLinks = links
    .filter((l) => idMap.has(l.dependsOnId))
    .map((l) => ({
      taskId: idMap.get(l.taskId)!,
      dependsOnId: idMap.get(l.dependsOnId)!,
      createdById: opts.actorId,
    }));
  await insertInChunks(copiedLinks, (chunk) =>
    tx.insert(taskDependencies).values(chunk).onConflictDoNothing(),
  );

  await carryTags(tx, idMap, opts.targetWorkspaceId);

  return idMap;
}
