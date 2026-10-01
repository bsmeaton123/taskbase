"use server";

import { asc, eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { subtasks, tasks } from "@/db/schema";
import { assertTaskAccess } from "@/lib/access";
import { ActionError, requireActionUser } from "@/lib/session";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { addFollowers, filterMembers, logActivity, notify } from "@/server/events";

const titleSchema = z
  .string()
  .trim()
  .min(1, "Subtasks need a title.")
  .max(300, "Keep subtask titles under 300 characters.");

async function loadSubtask(id: string) {
  const [row] = await db
    .select()
    .from(subtasks)
    .where(eq(subtasks.id, idSchema.parse(id)));
  if (!row) throw new ActionError("That subtask no longer exists.");
  return row;
}

export async function addSubtask(taskId: string, title: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));
    const parsed = titleSchema.parse(title);
    return db.transaction(async (tx) => {
      const [{ hi }] = await tx
        .select({ hi: max(subtasks.position) })
        .from(subtasks)
        .where(eq(subtasks.taskId, task.id));
      const [sub] = await tx
        .insert(subtasks)
        .values({
          taskId: task.id,
          title: parsed,
          position: (hi ?? 0) + 1024,
          createdById: viewer.id,
        })
        .returning({ id: subtasks.id });
      await logActivity(tx, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: "subtask_added",
        data: { title: parsed },
      });
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
      return sub;
    });
  });
}

export async function updateSubtask(input: {
  id: string;
  title?: string;
  done?: boolean;
  assigneeId?: string | null;
  dueDate?: string | null;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        id: idSchema,
        title: titleSchema.optional(),
        done: z.boolean().optional(),
        assigneeId: idSchema.nullable().optional(),
        dueDate: dateSchema.nullable().optional(),
      })
      .parse(input);
    const sub = await loadSubtask(data.id);
    const { task } = await assertTaskAccess(viewer, sub.taskId);

    const changes: Partial<typeof subtasks.$inferInsert> = {};
    if (data.title !== undefined && data.title !== sub.title) changes.title = data.title;
    if (data.done !== undefined && data.done !== sub.done) {
      changes.done = data.done;
      changes.completedAt = data.done ? new Date() : null;
    }
    if (data.assigneeId !== undefined && data.assigneeId !== sub.assigneeId) {
      if (data.assigneeId) {
        const [ok] = await filterMembers(db, task.workspaceId, [data.assigneeId]);
        if (!ok)
          throw new ActionError("You can only assign members of this workspace.");
      }
      changes.assigneeId = data.assigneeId;
    }
    if (data.dueDate !== undefined && data.dueDate !== sub.dueDate)
      changes.dueDate = data.dueDate;
    if (Object.keys(changes).length === 0) return null;

    await db.transaction(async (tx) => {
      await tx.update(subtasks).set(changes).where(eq(subtasks.id, sub.id));
      if (changes.done !== undefined)
        await logActivity(tx, {
          workspaceId: task.workspaceId,
          taskId: task.id,
          actorId: viewer.id,
          kind: changes.done ? "subtask_completed" : "subtask_reopened",
          data: { title: changes.title ?? sub.title },
        });
      if (changes.assigneeId) {
        await addFollowers(tx, task.id, [changes.assigneeId]);
        await notify(tx, [changes.assigneeId], {
          kind: "assigned",
          actorId: viewer.id,
          workspaceId: task.workspaceId,
          taskId: task.id,
          data: { subtask: changes.title ?? sub.title },
        });
      }
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    });
    return null;
  });
}

/** Deletes a subtask and returns it, so the panel can offer Undo (restoreSubtask). */
export async function deleteSubtask(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const sub = await loadSubtask(id);
    await assertTaskAccess(viewer, sub.taskId);
    const [deleted] = await db.delete(subtasks).where(eq(subtasks.id, sub.id)).returning();
    return deleted ?? null;
  });
}

const deletedSubtaskSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  title: z.string().trim().min(1).max(300),
  done: z.boolean(),
  assigneeId: idSchema.nullable(),
  dueDate: dateSchema.nullable(),
  position: z.number().finite(),
  completedAt: z.coerce.date().nullable(),
  createdById: idSchema.nullable(),
  createdAt: z.coerce.date(),
});

/** Undo for deleteSubtask: puts the same subtask back where it was. */
export async function restoreSubtask(input: z.input<typeof deletedSubtaskSchema>) {
  return run(async () => {
    const viewer = await requireActionUser();
    const sub = deletedSubtaskSchema.parse(input);
    const { task } = await assertTaskAccess(viewer, sub.taskId);
    // Someone who has left the workspace since can't be put back on it.
    const [assignee] = sub.assigneeId ? await filterMembers(db, task.workspaceId, [sub.assigneeId]) : [];
    await db
      .insert(subtasks)
      .values({ ...sub, assigneeId: assignee ?? null })
      .onConflictDoNothing();
    return null;
  });
}

export async function reorderSubtasks(taskId: string, orderedIds: string[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));
    const ids = z.array(idSchema).max(500).parse(orderedIds);
    const existing = await db
      .select({ id: subtasks.id })
      .from(subtasks)
      .where(eq(subtasks.taskId, task.id))
      .orderBy(asc(subtasks.position));
    const known = new Set(existing.map((s) => s.id));
    const order = [
      ...ids.filter((id) => known.has(id)),
      ...existing.map((s) => s.id).filter((id) => !ids.includes(id)),
    ];
    await db.transaction(async (tx) => {
      for (const [i, id] of order.entries()) {
        await tx
          .update(subtasks)
          .set({ position: (i + 1) * 1024 })
          .where(eq(subtasks.id, id));
      }
    });
    return null;
  });
}
