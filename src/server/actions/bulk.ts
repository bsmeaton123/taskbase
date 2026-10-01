"use server";

import { and, asc, eq, inArray, max } from "drizzle-orm";
import { after } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { activities, tags, taskLists, taskTags, tasks, type TaskStatus } from "@/db/schema";
import { assertWorkspaceAccess, type WorkspaceAccess } from "@/lib/access";
import { ActionError, getToday, requireActionUser, type CurrentUser } from "@/lib/session";
import { isClosed, STATUS_META } from "@/lib/status";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { deleteAssignees, insertAssignees, logAssigneeChanges } from "@/server/assignees";
import { addFollowers, filterMembers, getFollowerIds, logActivity, notify } from "@/server/events";
import { moveTasksToWorkspace } from "@/server/move-tasks";
import { notifyUnblocked } from "@/server/dependencies";
import { spawnNextOccurrence, undoNextOccurrence } from "@/server/recurrence";
import { trashTasks } from "@/server/trash";
import { deliverBulkAssignmentEmail } from "@/server/notification-emails";

/* Changes to many tasks at once, from selection mode in a workspace. */

const idsSchema = z
  .array(idSchema)
  .min(1, "Select at least one task.")
  .max(500, "Select up to 500 tasks at a time.");

/** Loads the tasks and checks the viewer can reach every workspace they're in. */
async function loadTasks(viewer: CurrentUser, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select()
    .from(tasks)
    .where(inArray(tasks.id, unique))
    .orderBy(asc(tasks.position), asc(tasks.createdAt));
  if (rows.length !== unique.length)
    throw new ActionError("Some of those tasks no longer exist. Refresh and try again.");
  const access = new Map<string, WorkspaceAccess>();
  for (const workspaceId of new Set(rows.map((r) => r.workspaceId)))
    access.set(workspaceId, await assertWorkspaceAccess(viewer, workspaceId));
  return { rows, access };
}

export async function bulkUpdateTasks(input: {
  ids: string[];
  status?: TaskStatus;
  dueDate?: string | null;
  urgent?: boolean;
  taskListId?: string;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        ids: idsSchema,
        status: z.enum(["open", "in_progress", "on_hold", "resolved", "rejected"]).optional(),
        dueDate: dateSchema.nullable().optional(),
        urgent: z.boolean().optional(),
        taskListId: idSchema.optional(),
      })
      .parse(input);
    const { rows } = await loadTasks(viewer, data.ids);
    const workspaceIds = [...new Set(rows.map((r) => r.workspaceId))];

    let list: { id: string; name: string } | null = null;
    if (data.taskListId) {
      if (workspaceIds.length !== 1)
        throw new ActionError("Those tasks are in different workspaces.");
      [list] = await db
        .select({ id: taskLists.id, name: taskLists.name })
        .from(taskLists)
        .where(and(eq(taskLists.id, data.taskListId), eq(taskLists.workspaceId, workspaceIds[0])));
      if (!list) throw new ActionError("That task list no longer exists.");
    }

    // Tasks being closed in this batch don't need a "ready to start" nudge.
    const closing = new Set(data.status && isClosed(data.status) ? rows.map((r) => r.id) : []);
    let changed = 0;
    const today = await getToday();

    await db.transaction(async (tx) => {
      let position = 0;
      if (list) {
        const [{ hi }] = await tx
          .select({ hi: max(tasks.position) })
          .from(tasks)
          .where(eq(tasks.taskListId, list.id));
        position = hi ?? 0;
      }

      for (const task of rows) {
        const changes: Partial<typeof tasks.$inferInsert> = {};
        if (data.status !== undefined && data.status !== task.status) {
          changes.status = data.status;
          changes.completedAt = isClosed(data.status) ? new Date() : null;
        }
        if (data.dueDate !== undefined && data.dueDate !== task.dueDate) {
          changes.dueDate = data.dueDate;
          // A start date after the new due date makes no sense: drop it.
          if (data.dueDate && task.startDate && task.startDate > data.dueDate) changes.startDate = null;
        }
        if (data.urgent !== undefined && data.urgent !== task.urgent)
          changes.urgent = data.urgent;
        if (list && list.id !== task.taskListId) {
          position += 1024;
          changes.taskListId = list.id;
          changes.position = position;
        }
        if (Object.keys(changes).length === 0) continue;
        changed++;

        await tx.update(tasks).set(changes).where(eq(tasks.id, task.id));
        const base = { workspaceId: task.workspaceId, taskId: task.id, actorId: viewer.id };

        if (changes.status !== undefined) {
          await logActivity(tx, {
            ...base,
            kind: "status_changed",
            data: { from: task.status, to: changes.status },
          });
          await notify(
            tx,
            await getFollowerIds(tx, task.id, task.workspaceId),
            {
              kind: "status_changed",
              actorId: viewer.id,
              workspaceId: task.workspaceId,
              taskId: task.id,
              data: { to: STATUS_META[changes.status as TaskStatus].label },
            },
            { email: false },
          );
          const updated = { ...task, ...changes } as typeof task;
          if (isClosed(changes.status as TaskStatus) && !isClosed(task.status)) {
            await notifyUnblocked(tx, updated, viewer.id, { skipTaskIds: closing, email: false });
            if (updated.recurrence)
              await spawnNextOccurrence(tx, updated, { actorId: viewer.id, today });
          } else if (!isClosed(changes.status as TaskStatus) && isClosed(task.status))
            await undoNextOccurrence(tx, updated);
        }
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
        if (changes.urgent !== undefined)
          await logActivity(tx, { ...base, kind: "urgent_changed", data: { urgent: changes.urgent } });
        if (changes.taskListId !== undefined && list)
          await logActivity(tx, { ...base, kind: "moved", data: { list: list.name } });
      }
    });

    return { count: changed };
  });
}

/**
 * Adds a person to every selected task, or takes them off every one. New assignees follow
 * the tasks and get one summary email per workspace rather than one per task.
 */
export async function bulkSetAssignee(input: { ids: string[]; userId: string; on: boolean }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.object({ ids: idsSchema, userId: idSchema, on: z.boolean() }).parse(input);
    const { rows } = await loadTasks(viewer, data.ids);
    const workspaceIds = [...new Set(rows.map((r) => r.workspaceId))];
    if (data.on)
      for (const workspaceId of workspaceIds) {
        const [member] = await filterMembers(db, workspaceId, [data.userId]);
        if (!member)
          throw new ActionError("You can only assign tasks to members of their workspace.");
      }

    const changed: { taskId: string; userId: string }[] = [];
    await db.transaction(async (tx) => {
      // Lock the tasks so none can move to another workspace while people are added.
      const fresh = await tx
        .select({ id: tasks.id, workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(inArray(tasks.id, rows.map((r) => r.id)))
        .for("update");
      for (const workspaceId of workspaceIds) {
        const taskIds = fresh.filter((t) => t.workspaceId === workspaceId).map((t) => t.id);
        if (data.on && taskIds.length !== rows.filter((r) => r.workspaceId === workspaceId).length)
          throw new ActionError("Some of those tasks have moved. Refresh and try again.");
        const done = data.on
          ? await insertAssignees(tx, taskIds.map((taskId) => ({ taskId, userIds: [data.userId] })))
          : await deleteAssignees(tx, taskIds, [data.userId]);
        if (done.length === 0) continue;
        changed.push(...done);
        await logAssigneeChanges(tx, { workspaceId, actorId: viewer.id, changes: done, on: data.on });
        const ids = done.map((d) => d.taskId);
        await tx.update(tasks).set({ updatedAt: new Date() }).where(inArray(tasks.id, ids));
        if (!data.on) continue;
        for (const taskId of ids) {
          await addFollowers(tx, taskId, [data.userId]);
          await notify(
            tx,
            [data.userId],
            { kind: "assigned", actorId: viewer.id, workspaceId, taskId },
            { email: false },
          );
        }
      }
    });

    // One email per workspace for the new assignee, rather than one per task.
    if (data.on && changed.length > 0) {
      const added = new Set(changed.map((c) => c.taskId));
      after(async () => {
        for (const workspaceId of workspaceIds) {
          const batch = rows.filter((t) => t.workspaceId === workspaceId && added.has(t.id));
          if (batch.length === 0) continue;
          await deliverBulkAssignmentEmail({
            assigneeId: data.userId,
            actorId: viewer.id,
            workspaceId,
            tasks: batch.map((t) => ({ number: t.number, title: t.title })),
          });
        }
      });
    }

    return { count: changed.length };
  });
}

export async function bulkDeleteTasks(ids: string[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { rows } = await loadTasks(viewer, idsSchema.parse(ids));
    const taskIds = rows.map((r) => r.id);
    const trashIds = await db.transaction((tx) => trashTasks(tx, taskIds, viewer.id));
    return { count: trashIds.length, trashIds };
  });
}

export async function bulkMoveToWorkspace(input: {
  ids: string[];
  workspaceId: string;
  taskListId: string;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({ ids: idsSchema, workspaceId: idSchema, taskListId: idSchema })
      .parse(input);
    const { rows } = await loadTasks(viewer, data.ids);
    const target = await assertWorkspaceAccess(viewer, data.workspaceId);
    const [list] = await db
      .select({ id: taskLists.id, name: taskLists.name })
      .from(taskLists)
      .where(and(eq(taskLists.id, data.taskListId), eq(taskLists.workspaceId, data.workspaceId)));
    if (!list) throw new ActionError("Pick a list in that workspace.");

    const moving = rows.filter((r) => r.workspaceId !== data.workspaceId);
    if (moving.length === 0) throw new ActionError("Those tasks are already in that workspace.");

    await db.transaction((tx) =>
      moveTasksToWorkspace(tx, {
        tasks: moving,
        workspace: target.workspace,
        list,
        actorId: viewer.id,
      }),
    );
    return { count: moving.length, workspaceId: target.workspace.id, workspaceName: target.workspace.name };
  });
}

/** Adds or removes a tag on many tasks at once (all in the tag's workspace). */
export async function bulkSetTag(input: { ids: string[]; tagId: string; on: boolean }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.object({ ids: idsSchema, tagId: idSchema, on: z.boolean() }).parse(input);
    const { rows } = await loadTasks(viewer, data.ids);
    const [tag] = await db.select().from(tags).where(eq(tags.id, data.tagId));
    if (!tag) throw new ActionError("That tag no longer exists.");
    if (rows.some((r) => r.workspaceId !== tag.workspaceId))
      throw new ActionError("That tag belongs to another workspace.");

    let count = 0;
    await db.transaction(async (tx) => {
      const taskIds = rows.map((r) => r.id);
      const changed = data.on
        ? await tx
            .insert(taskTags)
            .values(taskIds.map((taskId) => ({ taskId, tagId: tag.id })))
            .onConflictDoNothing()
            .returning({ taskId: taskTags.taskId })
        : await tx
            .delete(taskTags)
            .where(and(eq(taskTags.tagId, tag.id), inArray(taskTags.taskId, taskIds)))
            .returning({ taskId: taskTags.taskId });
      count = changed.length;
      if (changed.length > 0)
        await tx.insert(activities).values(
          changed.map((c) => ({
            workspaceId: tag.workspaceId,
            taskId: c.taskId,
            actorId: viewer.id,
            kind: data.on ? ("tag_added" as const) : ("tag_removed" as const),
            data: { name: tag.name },
          })),
        );
    });
    return { count, name: tag.name };
  });
}
