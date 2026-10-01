"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, inArray, isNull, max, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  notifications,
  subtasks,
  taskAssignees,
  taskFollowers,
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { assertWorkspaceAccess } from "@/lib/access";
import { isValidColor, normalizeColor } from "@/lib/colors";
import { diskAttachmentIds, removeDiskFiles } from "@/lib/storage";
import { ActionError, requireActionUser } from "@/lib/session";
import { idSchema, run } from "@/server/action-utils";
import { notify } from "@/server/events";
import { trashedDiskFiles, trashTasks } from "@/server/trash";

const colorSchema = z.string().refine(isValidColor, "Pick a colour from the palette or a hex value like #1f6fe8.").transform(normalizeColor);
const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the workspace a name.")
  .max(80, "Keep the name under 80 characters.");

export async function createWorkspace(input: {
  name: string;
  description?: string;
  color: string;
  memberIds?: string[];
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        name: nameSchema,
        description: z.string().trim().max(500).optional(),
        color: colorSchema,
        memberIds: z.array(idSchema).max(200).optional(),
      })
      .parse(input);

    return db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: data.name,
          description: data.description || null,
          color: data.color,
          createdById: viewer.id,
        })
        .returning({ id: workspaces.id });

      const others = [...new Set(data.memberIds ?? [])].filter(
        (id) => id !== viewer.id,
      );
      // Only people who exist and haven't been deactivated.
      const validOthers = others.length
        ? (
            await tx
              .select({ id: user.id })
              .from(user)
              .where(and(inArray(user.id, others), or(isNull(user.banned), eq(user.banned, false))))
          ).map((u) => u.id)
        : [];

      await tx.insert(workspaceMembers).values([
        { workspaceId: ws.id, userId: viewer.id, role: "owner" },
        ...validOthers.map((userId) => ({
          workspaceId: ws.id,
          userId,
          role: "member" as const,
        })),
      ]);
      await tx
        .insert(taskLists)
        .values({ workspaceId: ws.id, name: "To do", position: 1024 });
      await notify(tx, validOthers, {
        kind: "added_to_workspace",
        actorId: viewer.id,
        workspaceId: ws.id,
      });
      return { id: ws.id };
    });
  });
}

export async function updateWorkspace(input: {
  id: string;
  name?: string;
  description?: string | null;
  color?: string;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        id: idSchema,
        name: nameSchema.optional(),
        description: z.string().trim().max(500).nullable().optional(),
        color: colorSchema.optional(),
      })
      .parse(input);
    await assertWorkspaceAccess(viewer, data.id, { manage: true });
    await db
      .update(workspaces)
      .set({
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && {
          description: data.description || null,
        }),
        ...(data.color !== undefined && { color: data.color }),
      })
      .where(eq(workspaces.id, data.id));
    return null;
  });
}

export async function setWorkspaceArchived(id: string, archived: boolean) {
  return run(async () => {
    const viewer = await requireActionUser();
    await assertWorkspaceAccess(viewer, idSchema.parse(id), { manage: true });
    await db
      .update(workspaces)
      .set({ archivedAt: archived ? new Date() : null })
      .where(eq(workspaces.id, id));
    return null;
  });
}

/** A new email-in address for the workspace; the old one stops working straight away. */
export async function newInboundAddress(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    await assertWorkspaceAccess(viewer, idSchema.parse(id), { manage: true });
    await db
      .update(workspaces)
      .set({ inboundKey: randomBytes(12).toString("hex") })
      .where(eq(workspaces.id, id));
    return null;
  });
}

export async function deleteWorkspace(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    await assertWorkspaceAccess(viewer, idSchema.parse(id), { manage: true });
    const taskIds = (
      await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.workspaceId, id))
    ).map((t) => t.id);
    const files = [
      ...(await diskAttachmentIds({ taskIds })),
      ...(await trashedDiskFiles(id)),
    ];
    await db.delete(workspaces).where(eq(workspaces.id, id));
    await removeDiskFiles(files);
    return null;
  });
}

export async function addWorkspaceMembers(workspaceId: string, userIds: string[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const ids = z.array(idSchema).min(1).max(200).parse(userIds);
    await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(inArray(user.id, ids), or(isNull(user.banned), eq(user.banned, false))));
      if (existing.length === 0) return;
      const inserted = await tx
        .insert(workspaceMembers)
        .values(
          existing.map((u) => ({ workspaceId, userId: u.id, role: "member" as const })),
        )
        .onConflictDoNothing()
        .returning({ userId: workspaceMembers.userId });
      await notify(
        tx,
        inserted.map((r) => r.userId),
        { kind: "added_to_workspace", actorId: viewer.id, workspaceId },
      );
    });
    return null;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Locks the workspace row for the rest of the transaction, so concurrent
 * owner changes are serialised and can't leave a workspace without owners.
 */
async function lockWorkspace(tx: Tx, workspaceId: string) {
  await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .for("update");
}

async function ownerCount(tx: Tx, workspaceId: string, excludingUserId?: string) {
  const [{ value }] = await tx
    .select({ value: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
        excludingUserId ? ne(workspaceMembers.userId, excludingUserId) : undefined,
      ),
    );
  return value;
}

export async function removeWorkspaceMember(workspaceId: string, userId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    idSchema.parse(workspaceId);
    idSchema.parse(userId);
    const isSelf = userId === viewer.id;
    await assertWorkspaceAccess(viewer, workspaceId, { manage: !isSelf });

    await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      const [membership] = await tx
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        );
      if (!membership) return;
      if (membership.role === "owner" && (await ownerCount(tx, workspaceId, userId)) === 0)
        throw new ActionError(
          "A workspace needs at least one owner. Make someone else an owner first.",
        );

      await tx
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        );

      // They lose access, so stop sending them updates and free up their work.
      const workspaceTasks = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.workspaceId, workspaceId));
      await tx
        .delete(taskFollowers)
        .where(
          and(eq(taskFollowers.userId, userId), inArray(taskFollowers.taskId, workspaceTasks)),
        );
      await tx
        .delete(taskAssignees)
        .where(
          and(eq(taskAssignees.userId, userId), inArray(taskAssignees.taskId, workspaceTasks)),
        );
      await tx
        .update(subtasks)
        .set({ assigneeId: null })
        .where(and(eq(subtasks.assigneeId, userId), inArray(subtasks.taskId, workspaceTasks)));
      await tx
        .delete(notifications)
        .where(
          and(eq(notifications.userId, userId), eq(notifications.workspaceId, workspaceId)),
        );
    });
    return { left: isSelf };
  });
}

export async function setWorkspaceMemberRole(
  workspaceId: string,
  userId: string,
  role: "owner" | "member",
) {
  return run(async () => {
    const viewer = await requireActionUser();
    idSchema.parse(workspaceId);
    idSchema.parse(userId);
    z.enum(["owner", "member"]).parse(role);
    await assertWorkspaceAccess(viewer, workspaceId, { manage: true });
    await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId);
      if (role === "member" && (await ownerCount(tx, workspaceId, userId)) === 0)
        throw new ActionError("A workspace needs at least one owner.");
      await tx
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            eq(workspaceMembers.userId, userId),
          ),
        );
    });
    return null;
  });
}

/** Org admins can join any workspace (e.g. to help out or clean up). */
export async function joinWorkspace(workspaceId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    if (!viewer.isAdmin) throw new ActionError("Only admins can join workspaces directly.");
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: idSchema.parse(workspaceId), userId: viewer.id })
      .onConflictDoNothing();
    return null;
  });
}

/* -------------------------------------------------------------------------- */
/* Task lists                                                                  */
/* -------------------------------------------------------------------------- */

const listNameSchema = z
  .string()
  .trim()
  .min(1, "Give the list a name.")
  .max(80, "Keep list names under 80 characters.");

export async function createTaskList(workspaceId: string, name: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
    const [{ top }] = await db
      .select({ top: max(taskLists.position) })
      .from(taskLists)
      .where(eq(taskLists.workspaceId, workspaceId));
    const [list] = await db
      .insert(taskLists)
      .values({
        workspaceId,
        name: listNameSchema.parse(name),
        position: (top ?? 0) + 1024,
      })
      .returning({ id: taskLists.id });
    return list;
  });
}

async function loadList(listId: string) {
  const [list] = await db
    .select()
    .from(taskLists)
    .where(eq(taskLists.id, idSchema.parse(listId)));
  if (!list) throw new ActionError("That list no longer exists.");
  return list;
}

export async function renameTaskList(listId: string, name: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const list = await loadList(listId);
    await assertWorkspaceAccess(viewer, list.workspaceId);
    await db
      .update(taskLists)
      .set({ name: listNameSchema.parse(name) })
      .where(eq(taskLists.id, list.id));
    return null;
  });
}

export async function deleteTaskList(listId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const list = await loadList(listId);
    await assertWorkspaceAccess(viewer, list.workspaceId);
    const trashed = await db.transaction(async (tx) => {
      await lockWorkspace(tx, list.workspaceId);
      const [{ value }] = await tx
        .select({ value: count() })
        .from(taskLists)
        .where(eq(taskLists.workspaceId, list.workspaceId));
      if (value <= 1) throw new ActionError("A workspace needs at least one task list.");
      // The list's tasks go to the trash (restoring puts them in the first list).
      const taskIds = (
        await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.taskListId, list.id))
      ).map((t) => t.id);
      const trashIds = await trashTasks(tx, taskIds, viewer.id);
      await tx.delete(taskLists).where(eq(taskLists.id, list.id));
      return trashIds.length;
    });
    return { trashed };
  });
}

/** Moves a list one step left/up or right/down. */
export async function shiftTaskList(listId: string, direction: -1 | 1) {
  return run(async () => {
    const viewer = await requireActionUser();
    z.union([z.literal(-1), z.literal(1)]).parse(direction);
    const list = await loadList(listId);
    await assertWorkspaceAccess(viewer, list.workspaceId);
    const lists = await db
      .select({ id: taskLists.id })
      .from(taskLists)
      .where(eq(taskLists.workspaceId, list.workspaceId))
      .orderBy(taskLists.position, taskLists.createdAt);
    const ids = lists.map((l) => l.id);
    const from = ids.indexOf(list.id);
    const to = from + direction;
    if (to < 0 || to >= ids.length) return null;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    await db.transaction(async (tx) => {
      for (const [i, id] of ids.entries()) {
        await tx
          .update(taskLists)
          .set({ position: (i + 1) * 1024 })
          .where(eq(taskLists.id, id));
      }
    });
    return null;
  });
}
