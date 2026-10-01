"use server";

import { and, asc, eq, isNull, max, min } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { notifications, taskFollowers, taskLists, tasks, type TaskStatus } from "@/db/schema";
import { assertTaskAccess, assertWorkspaceAccess } from "@/lib/access";
import { getDate, parseISO } from "date-fns";
import { describeRecurrence, recurrenceSchema, sameRecurrence, type Recurrence } from "@/lib/recurrence";
import { ActionError, getToday, requireActionUser } from "@/lib/session";
import { isClosed, STATUS_META } from "@/lib/status";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { deleteAssignees, insertAssignees, logAssigneeChanges } from "@/server/assignees";
import {
  addFollowers,
  filterMembers,
  getFollowerIds,
  logActivity,
  notify,
} from "@/server/events";
import { notifyUnblocked } from "@/server/dependencies";
import { spawnNextOccurrence, undoNextOccurrence } from "@/server/recurrence";
import { trashTasks } from "@/server/trash";

const titleSchema = z
  .string()
  .trim()
  .min(1, "Tasks need a title.")
  .max(300, "Keep task titles under 300 characters.");

const statusSchema = z.enum([
  "open",
  "in_progress",
  "on_hold",
  "resolved",
  "rejected",
]);

const assigneeIdsSchema = z.array(idSchema).max(50, "Assign up to 50 people.");

/** Everyone must be an active member of the workspace. Returns the ids without repeats. */
async function assertAssignable(workspaceId: string, assigneeIds: string[]) {
  const ids = [...new Set(assigneeIds)];
  if (ids.length === 0) return ids;
  const members = new Set(await filterMembers(db, workspaceId, ids));
  if (ids.some((id) => !members.has(id)))
    throw new ActionError("You can only assign tasks to members of this workspace.");
  return ids;
}

function assertDateOrder(startDate: string | null | undefined, dueDate: string | null | undefined) {
  if (startDate && dueDate && startDate > dueDate)
    throw new ActionError("The start date has to be on or before the due date.");
}

/** Pins a monthly rule to a day of the month, so short months don't make it drift. */
function normalizeRecurrence(rule: Recurrence | null, dueDate: string | null, today: string) {
  if (!rule) return null;
  if (rule.freq === "monthly" && rule.monthDay === undefined && rule.from !== "completion")
    return { ...rule, monthDay: getDate(parseISO(dueDate ?? today)) };
  return rule;
}

export async function createTask(input: {
  workspaceId: string;
  taskListId: string;
  title: string;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  recurrence?: Recurrence | null;
  urgent?: boolean;
  position?: "top" | "bottom";
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        workspaceId: idSchema,
        taskListId: idSchema,
        title: titleSchema,
        assigneeIds: assigneeIdsSchema.optional(),
        startDate: dateSchema.nullable().optional(),
        dueDate: dateSchema.nullable().optional(),
        recurrence: recurrenceSchema.nullable().optional(),
        urgent: z.boolean().optional(),
        position: z.enum(["top", "bottom"]).optional(),
      })
      .parse(input);
    assertDateOrder(data.startDate, data.dueDate);
    const recurrence = normalizeRecurrence(data.recurrence ?? null, data.dueDate ?? null, await getToday());

    await assertWorkspaceAccess(viewer, data.workspaceId);
    const [list] = await db
      .select({ id: taskLists.id })
      .from(taskLists)
      .where(
        and(
          eq(taskLists.id, data.taskListId),
          eq(taskLists.workspaceId, data.workspaceId),
        ),
      );
    if (!list) throw new ActionError("That task list no longer exists.");
    const assigneeIds = await assertAssignable(data.workspaceId, data.assigneeIds ?? []);

    return db.transaction(async (tx) => {
      const [{ lo, hi }] = await tx
        .select({ lo: min(tasks.position), hi: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.taskListId, data.taskListId));
      const position =
        data.position === "top" ? (lo ?? 1024) - 1024 : (hi ?? 0) + 1024;

      const [task] = await tx
        .insert(tasks)
        .values({
          workspaceId: data.workspaceId,
          taskListId: data.taskListId,
          title: data.title,
          startDate: data.startDate ?? null,
          dueDate: data.dueDate ?? null,
          recurrence,
          urgent: data.urgent ?? false,
          position,
          createdById: viewer.id,
        })
        .returning({ id: tasks.id, number: tasks.number });

      await logActivity(tx, {
        workspaceId: data.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: "task_created",
      });
      await insertAssignees(tx, [{ taskId: task.id, userIds: assigneeIds }]);
      await addFollowers(tx, task.id, [viewer.id, ...assigneeIds]);
      await notify(tx, assigneeIds, {
        kind: "assigned",
        actorId: viewer.id,
        workspaceId: data.workspaceId,
        taskId: task.id,
      });
      return task;
    });
  });
}

export async function updateTask(input: {
  id: string;
  title?: string;
  description?: string;
  status?: TaskStatus;
  urgent?: boolean;
  startDate?: string | null;
  dueDate?: string | null;
  recurrence?: Recurrence | null;
  taskListId?: string;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        id: idSchema,
        title: titleSchema.optional(),
        description: z.string().max(20000).optional(),
        status: statusSchema.optional(),
        urgent: z.boolean().optional(),
        startDate: dateSchema.nullable().optional(),
        dueDate: dateSchema.nullable().optional(),
        recurrence: recurrenceSchema.nullable().optional(),
        taskListId: idSchema.optional(),
      })
      .parse(input);

    const { task } = await assertTaskAccess(viewer, data.id);
    const changes: Partial<typeof tasks.$inferInsert> = {};

    if (data.title !== undefined && data.title !== task.title)
      changes.title = data.title;
    if (data.description !== undefined && data.description !== task.description)
      changes.description = data.description;
    if (data.status !== undefined && data.status !== task.status) {
      changes.status = data.status;
      changes.completedAt = isClosed(data.status) ? new Date() : null;
    }
    if (data.urgent !== undefined && data.urgent !== task.urgent)
      changes.urgent = data.urgent;
    if (data.dueDate !== undefined && data.dueDate !== task.dueDate)
      changes.dueDate = data.dueDate;
    if (data.startDate !== undefined && data.startDate !== task.startDate)
      changes.startDate = data.startDate;
    if (changes.startDate !== undefined || changes.dueDate !== undefined)
      assertDateOrder(
        changes.startDate !== undefined ? changes.startDate : task.startDate,
        changes.dueDate !== undefined ? changes.dueDate : task.dueDate,
      );
    const today = await getToday();
    if (data.recurrence !== undefined) {
      const rule = normalizeRecurrence(
        data.recurrence,
        changes.dueDate !== undefined ? changes.dueDate : task.dueDate,
        today,
      );
      if (!sameRecurrence(rule, task.recurrence)) changes.recurrence = rule;
    }

    let movedToList: { id: string; name: string } | null = null;
    if (data.taskListId !== undefined && data.taskListId !== task.taskListId) {
      const [list] = await db
        .select({ id: taskLists.id, name: taskLists.name })
        .from(taskLists)
        .where(
          and(
            eq(taskLists.id, data.taskListId),
            eq(taskLists.workspaceId, task.workspaceId),
          ),
        );
      if (!list) throw new ActionError("That task list no longer exists.");
      const [{ hi }] = await db
        .select({ hi: max(tasks.position) })
        .from(tasks)
        .where(eq(tasks.taskListId, list.id));
      changes.taskListId = list.id;
      changes.position = (hi ?? 0) + 1024;
      movedToList = list;
    }

    if (Object.keys(changes).length === 0) return null;

    let next: { id: string; number: number; dueDate: string } | null = null;
    await db.transaction(async (tx) => {
      await tx.update(tasks).set(changes).where(eq(tasks.id, task.id));

      const base = {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
      };

      if (changes.title !== undefined)
        await logActivity(tx, {
          ...base,
          kind: "renamed",
          data: { from: task.title, to: changes.title },
        });

      if (changes.status !== undefined) {
        await logActivity(tx, {
          ...base,
          kind: "status_changed",
          data: { from: task.status, to: changes.status },
        });
        await notify(tx, await getFollowerIds(tx, task.id, task.workspaceId), {
          kind: "status_changed",
          actorId: viewer.id,
          workspaceId: task.workspaceId,
          taskId: task.id,
          data: { to: STATUS_META[changes.status as TaskStatus].label },
        });
        const wasClosed = isClosed(task.status);
        const nowClosed = isClosed(changes.status as TaskStatus);
        const updated = { ...task, ...changes } as typeof task;
        if (nowClosed && !wasClosed) {
          await notifyUnblocked(tx, updated, viewer.id);
          if (updated.recurrence)
            next = await spawnNextOccurrence(tx, updated, { actorId: viewer.id, today });
        } else if (!nowClosed && wasClosed) await undoNextOccurrence(tx, updated);
      }

      if (changes.urgent !== undefined)
        await logActivity(tx, {
          ...base,
          kind: "urgent_changed",
          data: { urgent: changes.urgent },
        });

      if (changes.dueDate !== undefined)
        await logActivity(tx, {
          ...base,
          kind: "due_changed",
          data: { from: task.dueDate, to: changes.dueDate },
        });

      if (changes.startDate !== undefined)
        await logActivity(tx, {
          ...base,
          kind: "start_changed",
          data: { from: task.startDate, to: changes.startDate },
        });

      if (changes.recurrence !== undefined)
        await logActivity(tx, {
          ...base,
          kind: "recurrence_changed",
          data: {
            rule: changes.recurrence
              ? describeRecurrence(changes.recurrence, changes.dueDate ?? task.dueDate)
              : null,
          },
        });

      if (movedToList)
        await logActivity(tx, {
          ...base,
          kind: "moved",
          data: { list: movedToList.name },
        });
    });
    return next ? { next } : null;
  });
}

/**
 * Adds one person to a task's assignees, or takes them off. New assignees follow the task
 * and get an "assigned" notification (unless they added themselves).
 */
export async function setTaskAssignee(input: { taskId: string; userId: string; on: boolean }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.object({ taskId: idSchema, userId: idSchema, on: z.boolean() }).parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);
    if (data.on) await assertAssignable(task.workspaceId, [data.userId]);

    await db.transaction(async (tx) => {
      // The task may have been moved since we looked: re-check against the locked row.
      const [fresh] = await tx
        .select({ workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .for("update");
      if (!fresh) throw new ActionError("That task no longer exists.");
      if (data.on && fresh.workspaceId !== task.workspaceId)
        throw new ActionError("You can only assign tasks to members of this workspace.");

      const changed = data.on
        ? await insertAssignees(tx, [{ taskId: task.id, userIds: [data.userId] }])
        : await deleteAssignees(tx, [task.id], [data.userId]);
      if (changed.length === 0) return;
      await logAssigneeChanges(tx, {
        workspaceId: fresh.workspaceId,
        actorId: viewer.id,
        changes: changed,
        on: data.on,
      });
      if (data.on) {
        await addFollowers(tx, task.id, [data.userId]);
        await notify(tx, [data.userId], {
          kind: "assigned",
          actorId: viewer.id,
          workspaceId: fresh.workspaceId,
          taskId: task.id,
        });
      }
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    });
    return null;
  });
}

/**
 * Drag-and-drop reorder. `prevId`/`nextId` are the visible neighbours at the
 * drop position, so ordering stays correct even when filters hide tasks.
 */
export async function moveTask(input: {
  id: string;
  taskListId: string;
  prevId?: string | null;
  nextId?: string | null;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        id: idSchema,
        taskListId: idSchema,
        prevId: idSchema.nullable().optional(),
        nextId: idSchema.nullable().optional(),
      })
      .parse(input);
    const { task } = await assertTaskAccess(viewer, data.id);

    const [list] = await db
      .select({ id: taskLists.id, name: taskLists.name })
      .from(taskLists)
      .where(
        and(
          eq(taskLists.id, data.taskListId),
          eq(taskLists.workspaceId, task.workspaceId),
        ),
      );
    if (!list) throw new ActionError("That task list no longer exists.");

    await db.transaction(async (tx) => {
      // Every task in the list (including ones hidden by filters), minus the
      // one being moved, in display order.
      const siblings = (
        await tx
          .select({ id: tasks.id, position: tasks.position })
          .from(tasks)
          .where(eq(tasks.taskListId, list.id))
          .orderBy(asc(tasks.position), asc(tasks.createdAt))
      ).filter((s) => s.id !== task.id);

      // Where the task should land: right after the visible task above it,
      // or right before the visible task below it.
      const anchor = (() => {
        const p = data.prevId ? siblings.findIndex((s) => s.id === data.prevId) : -1;
        if (p >= 0) return p + 1;
        const n = data.nextId ? siblings.findIndex((s) => s.id === data.nextId) : -1;
        if (n >= 0) return n;
        return siblings.length;
      })();

      const before = siblings[anchor - 1]?.position;
      const after = siblings[anchor]?.position;
      let position =
        before !== undefined && after !== undefined
          ? (before + after) / 2
          : before !== undefined
            ? before + 1024
            : after !== undefined
              ? after - 1024
              : 1024;

      // Neighbours too close (or tied): renumber the list to make room.
      if (before !== undefined && after !== undefined && after - before < 1e-6) {
        for (const [i, s] of siblings.entries()) {
          const newPos = (i + (i >= anchor ? 2 : 1)) * 1024;
          await tx.update(tasks).set({ position: newPos }).where(eq(tasks.id, s.id));
        }
        position = (anchor + 1) * 1024;
      }

      await tx
        .update(tasks)
        .set({ position, taskListId: list.id })
        .where(eq(tasks.id, task.id));

      if (list.id !== task.taskListId)
        await logActivity(tx, {
          workspaceId: task.workspaceId,
          taskId: task.id,
          actorId: viewer.id,
          kind: "moved",
          data: { list: list.name },
        });
    });
    return null;
  });
}

export async function deleteTask(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(id));
    const trashIds = await db.transaction((tx) => trashTasks(tx, [task.id], viewer.id));
    return { workspaceId: task.workspaceId, trashIds };
  });
}

export async function setFollowing(taskId: string, following: boolean) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));
    if (following) await addFollowers(db, task.id, [viewer.id]);
    else
      await db
        .delete(taskFollowers)
        .where(
          and(eq(taskFollowers.taskId, task.id), eq(taskFollowers.userId, viewer.id)),
        );
    return null;
  });
}

/** Called when a task is opened: clears inbox items for it. */
export async function markTaskNotificationsRead(taskId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const updated = await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, viewer.id),
          eq(notifications.taskId, idSchema.parse(taskId)),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return { count: updated.length };
  }, { refresh: false });
}
