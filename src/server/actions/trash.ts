"use server";

import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { trashedTasks } from "@/db/schema";
import { assertWorkspaceAccess } from "@/lib/access";
import { ActionError, requireActionUser } from "@/lib/session";
import { idSchema, run } from "@/server/action-utils";
import { purgeTrashEntries, restoreTrashed } from "@/server/trash";

const trashIdsSchema = z.array(idSchema).min(1).max(500);

/** Puts deleted tasks back. Anyone who can see the workspace can restore. */
export async function restoreTasks(trashIds: string[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const ids = trashIdsSchema.parse(trashIds);
    const restored = await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: trashedTasks.id,
          workspaceId: trashedTasks.workspaceId,
          snapshot: trashedTasks.snapshot,
          deletedAt: trashedTasks.deletedAt,
        })
        .from(trashedTasks)
        .where(inArray(trashedTasks.id, ids))
        .orderBy(trashedTasks.deletedAt)
        .for("update");
      if (rows.length === 0)
        throw new ActionError("Those tasks have already been restored or deleted for good.");
      for (const ws of new Set(rows.map((r) => r.workspaceId)))
        await assertWorkspaceAccess(viewer, ws);
      const out = [];
      for (const row of rows) out.push(await restoreTrashed(tx, row, viewer.id));
      return out;
    });
    return { count: restored.length, numbers: restored.map((r) => r.number) };
  });
}

/** Deletes trashed tasks for good. Workspace owners and admins only. */
export async function deleteForever(trashIds: string[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const ids = trashIdsSchema.parse(trashIds);
    const rows = await db
      .select({ id: trashedTasks.id, workspaceId: trashedTasks.workspaceId })
      .from(trashedTasks)
      .where(inArray(trashedTasks.id, ids));
    for (const ws of new Set(rows.map((r) => r.workspaceId)))
      await assertWorkspaceAccess(viewer, ws, { manage: true });
    if (rows.length === 0) return { count: 0 };
    const count = await purgeTrashEntries(inArray(trashedTasks.id, rows.map((r) => r.id)));
    return { count };
  });
}

/** Empties a workspace's trash. Workspace owners and admins only. */
export async function emptyTrash(workspaceId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const ws = idSchema.parse(workspaceId);
    await assertWorkspaceAccess(viewer, ws, { manage: true });
    const count = await purgeTrashEntries(eq(trashedTasks.workspaceId, ws));
    return { count };
  });
}
