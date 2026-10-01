"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { assertTaskAccess } from "@/lib/access";
import { ActionError, requireActionUser } from "@/lib/session";
import { isClosed } from "@/lib/status";
import { planMove } from "@/lib/workload";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import {
  deleteAssignees,
  getAssigneeIds,
  insertAssignees,
  keepActiveMembers,
  logAssigneeChanges,
} from "@/server/assignees";
import { addFollowers, filterMembers, logActivity, notify, type Executor } from "@/server/events";

const moveSchema = z.object({
  taskId: idSchema,
  /** The row the task was dragged from: a person, or null for Unassigned. */
  from: idSchema.nullable(),
  /** The row it was dropped on. */
  to: idSchema.nullable(),
  dueDate: dateSchema.nullable(),
});

/** Locks the task row and returns what the plan works from. */
async function lockTask(tx: Executor, taskId: string, workspaceId: string) {
  const [fresh] = await tx
    .select({ workspaceId: tasks.workspaceId, startDate: tasks.startDate, dueDate: tasks.dueDate })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .for("update");
  if (!fresh) throw new ActionError("That task no longer exists.");
  if (fresh.workspaceId !== workspaceId)
    throw new ActionError("That task has moved to another workspace. Refresh and try again.");
  return fresh;
}

/** History entries for date changes, then the update itself. */
async function saveDates(
  tx: Executor,
  task: { id: string; workspaceId: string; startDate: string | null; dueDate: string | null },
  next: { startDate: string | null; dueDate: string | null },
  actorId: string,
) {
  if (next.startDate && next.dueDate && next.startDate > next.dueDate)
    throw new ActionError("The start date has to be on or before the due date.");
  const base = { workspaceId: task.workspaceId, taskId: task.id, actorId };
  if (next.dueDate !== task.dueDate)
    await logActivity(tx, { ...base, kind: "due_changed", data: { from: task.dueDate, to: next.dueDate } });
  if (next.startDate !== task.startDate)
    await logActivity(tx, { ...base, kind: "start_changed", data: { from: task.startDate, to: next.startDate } });
  await tx
    .update(tasks)
    .set({ startDate: next.startDate, dueDate: next.dueDate, updatedAt: new Date() })
    .where(eq(tasks.id, task.id));
}

/**
 * A drag on the Team workload grid, in one go: hands the task from one person to another
 * (the person it came from comes off, anyone else assigned stays) and/or gives it a new due
 * date, moving the start date along. Returns how it was before, for Undo.
 */
export async function moveOnWorkload(input: z.input<typeof moveSchema>) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = moveSchema.parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);
    if (isClosed(task.status)) throw new ActionError("That task is already done.");
    if (data.to && data.to !== data.from) {
      const [member] = await filterMembers(db, task.workspaceId, [data.to]);
      if (!member) throw new ActionError("They aren't a member of that task's workspace.");
    }

    return db.transaction(async (tx) => {
      const fresh = await lockTask(tx, task.id, task.workspaceId);
      const before = {
        assigneeIds: await getAssigneeIds(tx, task.id),
        startDate: fresh.startDate,
        dueDate: fresh.dueDate,
      };
      const plan = planMove(before, data);
      if (!plan.changed) return null;

      const base = { workspaceId: fresh.workspaceId, actorId: viewer.id };
      if (plan.remove) {
        const removed = await deleteAssignees(tx, [task.id], [plan.remove]);
        await logAssigneeChanges(tx, { ...base, changes: removed, on: false });
      }
      if (plan.add) {
        const added = await insertAssignees(tx, [{ taskId: task.id, userIds: [plan.add] }]);
        await logAssigneeChanges(tx, { ...base, changes: added, on: true });
        if (added.length) {
          await addFollowers(tx, task.id, [plan.add]);
          await notify(tx, [plan.add], { kind: "assigned", ...base, taskId: task.id });
        }
      }
      await saveDates(tx, { id: task.id, ...fresh }, plan, viewer.id);
      return { before };
    });
  });
}

const restoreSchema = z.object({
  taskId: idSchema,
  assigneeIds: z.array(idSchema).max(50),
  startDate: dateSchema.nullable(),
  dueDate: dateSchema.nullable(),
});

/** Undo for a workload drag: puts the assignees and dates back exactly as they were. */
export async function restoreWorkloadMove(input: z.input<typeof restoreSchema>) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = restoreSchema.parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);

    await db.transaction(async (tx) => {
      const fresh = await lockTask(tx, task.id, task.workspaceId);
      const current = await getAssigneeIds(tx, task.id);
      // Anyone who has since left the workspace can't be put back.
      const wanted = await keepActiveMembers(tx, fresh.workspaceId, data.assigneeIds);
      const base = { workspaceId: fresh.workspaceId, actorId: viewer.id };
      const removed = await deleteAssignees(
        tx,
        [task.id],
        current.filter((id) => !wanted.includes(id)),
      );
      await logAssigneeChanges(tx, { ...base, changes: removed, on: false });
      const added = await insertAssignees(tx, [
        { taskId: task.id, userIds: wanted.filter((id) => !current.includes(id)) },
      ]);
      await logAssigneeChanges(tx, { ...base, changes: added, on: true });
      await addFollowers(
        tx,
        task.id,
        added.map((a) => a.userId),
      );
      await saveDates(tx, { id: task.id, ...fresh }, data, viewer.id);
    });
    return null;
  });
}
