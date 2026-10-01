import "server-only";
import { and, count, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { activities, attachments, comments, subtasks, taskDependencies, tasks } from "@/db/schema";
import { carryAssignees } from "@/server/assignees";
import { carryTags } from "@/server/tags";
import { daysUntil, shiftDate } from "@/lib/dates";
import { describeRecurrence, nextOccurrence, recurrenceSchema } from "@/lib/recurrence";
import {
  activeMemberIds,
  addFollowers,
  filterMembers,
  getFollowerIds,
  logActivity,
  type Executor,
} from "@/server/events";

type Task = typeof tasks.$inferSelect;

/**
 * Called when a repeating task is completed (or rejected): creates the next one with the
 * next due date, a fresh copy of its subtasks, and the same list, assignees and followers.
 * The repeat rule moves to the new task, so reopening and re-completing the old one
 * can't create duplicates.
 */
export async function spawnNextOccurrence(
  tx: Executor,
  task: Task,
  opts: { actorId: string; today: string },
): Promise<{ id: string; number: number; dueDate: string } | null> {
  // Take the rule off the task under a row lock, so two people completing it at once
  // can't both create a next occurrence. (UPDATE ... RETURNING would hand back the new,
  // empty value, so the rule is read first.)
  const [claimed] = await tx
    .select({ recurrence: tasks.recurrence })
    .from(tasks)
    .where(and(eq(tasks.id, task.id), isNotNull(tasks.recurrence)))
    .for("update");
  if (!claimed) return null;
  const parsed = recurrenceSchema.safeParse(claimed.recurrence);
  if (!parsed.success) return null;
  await tx.update(tasks).set({ recurrence: null }).where(eq(tasks.id, task.id));
  const rule = parsed.data;
  const dueDate = nextOccurrence(rule, {
    due: task.dueDate,
    completedOn: opts.today,
    today: opts.today,
  });

  if (!dueDate) {
    // The series has ended: keep the rule on the task so reopening it changes nothing.
    await tx.update(tasks).set({ recurrence: rule }).where(eq(tasks.id, task.id));
    await logActivity(tx, {
      workspaceId: task.workspaceId,
      taskId: task.id,
      actorId: opts.actorId,
      kind: "recurred",
      data: { ended: true },
    });
    return null;
  }

  // Keep the same gap between start and due, and move subtask dates along with the task.
  const shift = task.dueDate ? daysUntil(dueDate, task.dueDate) : null;
  const startDate =
    task.startDate && shift !== null ? shiftDate(task.startDate, shift) : null;

  const [next] = await tx
    .insert(tasks)
    .values({
      workspaceId: task.workspaceId,
      taskListId: task.taskListId,
      title: task.title,
      description: task.description,
      urgent: task.urgent,
      startDate,
      dueDate,
      recurrence: rule,
      recurredFromId: task.id,
      position: task.position,
      createdById: task.createdById,
    })
    .returning({ id: tasks.id, number: tasks.number });

  const subs = await tx
    .select()
    .from(subtasks)
    .where(eq(subtasks.taskId, task.id))
    .orderBy(subtasks.position);
  if (subs.length > 0) {
    const members = new Set(
      await filterMembers(
        tx,
        task.workspaceId,
        subs.map((s) => s.assigneeId).filter((id): id is string => Boolean(id)),
      ),
    );
    await tx.insert(subtasks).values(
      subs.map((s) => ({
        taskId: next.id,
        title: s.title,
        assigneeId: s.assigneeId && members.has(s.assigneeId) ? s.assigneeId : null,
        dueDate: s.dueDate && shift !== null ? shiftDate(s.dueDate, shift) : null,
        position: s.position,
        createdById: s.createdById,
      })),
    );
  }

  // The same assignees (those still active members), in the same order.
  const assigned = await carryAssignees(
    tx,
    new Map([[task.id, next.id]]),
    await activeMemberIds(tx, task.workspaceId),
  );
  await addFollowers(tx, next.id, [
    ...(await getFollowerIds(tx, task.id, task.workspaceId)),
    ...assigned.map((a) => a.userId),
  ]);
  await carryTags(tx, new Map([[task.id, next.id]]), task.workspaceId);

  const text = describeRecurrence(rule, dueDate);
  await logActivity(tx, {
    workspaceId: task.workspaceId,
    taskId: next.id,
    actorId: opts.actorId,
    kind: "recurred",
    data: { fromNumber: task.number, rule: text },
  });
  await logActivity(tx, {
    workspaceId: task.workspaceId,
    taskId: task.id,
    actorId: opts.actorId,
    kind: "recurred",
    data: { nextNumber: next.number, due: dueDate },
  });
  return { ...next, dueDate };
}

const UNDO_WINDOW_MS = 15 * 60 * 1000;

/**
 * Called when a completed task is reopened. If completing it just created the next one
 * (within 15 minutes) and nobody has touched that since, remove it and give the repeat
 * rule back. Any edit at all keeps it: the task's updated_at moves on every change,
 * including subtask edits, and comments, files and links are checked separately.
 */
export async function undoNextOccurrence(tx: Executor, task: Task) {
  const [spawned] = await tx
    .select()
    .from(tasks)
    .where(eq(tasks.recurredFromId, task.id))
    .orderBy(desc(tasks.createdAt))
    .limit(1);
  if (!spawned || spawned.status !== "open") return;
  if (Date.now() - spawned.createdAt.getTime() > UNDO_WINDOW_MS) return;
  if (spawned.updatedAt.getTime() !== spawned.createdAt.getTime()) return;

  const [[c], [a], [act], [d]] = await Promise.all([
    tx.select({ n: count() }).from(comments).where(eq(comments.taskId, spawned.id)),
    tx.select({ n: count() }).from(attachments).where(eq(attachments.taskId, spawned.id)),
    tx.select({ n: count() }).from(activities).where(eq(activities.taskId, spawned.id)),
    tx
      .select({ n: count() })
      .from(taskDependencies)
      .where(or(eq(taskDependencies.taskId, spawned.id), eq(taskDependencies.dependsOnId, spawned.id))),
  ]);
  // Only its own "created from #N" entry: nothing has happened to it since.
  if (c.n > 0 || a.n > 0 || act.n > 1 || d.n > 0) return;

  await tx.delete(tasks).where(eq(tasks.id, spawned.id));
  await tx.update(tasks).set({ recurrence: spawned.recurrence }).where(eq(tasks.id, task.id));
  await tx
    .delete(activities)
    .where(
      and(
        eq(activities.taskId, task.id),
        eq(activities.kind, "recurred"),
        sql`${activities.data}->>'nextNumber' = ${String(spawned.number)}`,
      ),
    );
}
