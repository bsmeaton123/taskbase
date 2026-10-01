"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { tags, taskTags, tasks } from "@/db/schema";
import { assertTaskAccess, assertWorkspaceAccess } from "@/lib/access";
import { isValidColor, normalizeColor } from "@/lib/colors";
import { ActionError, requireActionUser } from "@/lib/session";
import { idSchema, run } from "@/server/action-utils";
import { logActivity } from "@/server/events";
import { cleanTagName, ensureTags, pickTagColor, TAG_NAME_MAX } from "@/server/tags";

const nameSchema = z
  .string()
  .transform(cleanTagName)
  .pipe(z.string().min(1, "Give the tag a name.").max(TAG_NAME_MAX));
const colorSchema = z.string().refine(isValidColor, "Pick a colour from the palette or a hex value like #1f6fe8.").transform(normalizeColor);

async function loadTag(id: string) {
  const [tag] = await db.select().from(tags).where(eq(tags.id, id));
  if (!tag) throw new ActionError("That tag no longer exists.");
  return tag;
}

async function nameTaken(workspaceId: string, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = ${name.toLowerCase()}`));
  return Boolean(row && row.id !== exceptId);
}

export async function createTag(input: { workspaceId: string; name: string; color?: string }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({ workspaceId: idSchema, name: nameSchema, color: colorSchema.optional() })
      .parse(input);
    await assertWorkspaceAccess(viewer, data.workspaceId);
    const ids = await ensureTags(db, data.workspaceId, [{ name: data.name, color: data.color }]);
    const id = ids.get(data.name.toLowerCase())!;
    return loadTag(id);
  });
}

export async function updateTag(input: { id: string; name?: string; color?: string }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({ id: idSchema, name: nameSchema.optional(), color: colorSchema.optional() })
      .parse(input);
    const tag = await loadTag(data.id);
    await assertWorkspaceAccess(viewer, tag.workspaceId);
    if (data.name && (await nameTaken(tag.workspaceId, data.name, tag.id)))
      throw new ActionError(`There's already a tag called “${data.name}”.`);
    await db
      .update(tags)
      .set({ ...(data.name ? { name: data.name } : {}), ...(data.color ? { color: data.color } : {}) })
      .where(eq(tags.id, tag.id));
    return null;
  });
}

export async function deleteTag(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const tag = await loadTag(idSchema.parse(id));
    await assertWorkspaceAccess(viewer, tag.workspaceId);
    await db.delete(tags).where(eq(tags.id, tag.id));
    return null;
  });
}

/** Adds or removes one tag on a task. With `name` instead of `tagId`, creates the tag first. */
export async function setTaskTag(input: {
  taskId: string;
  tagId?: string;
  name?: string;
  on: boolean;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        taskId: idSchema,
        tagId: idSchema.optional(),
        name: nameSchema.optional(),
        on: z.boolean(),
      })
      .refine((d) => d.tagId || d.name, "Pick a tag.")
      .parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);

    let tagId = data.tagId;
    if (!tagId) {
      const existing = await db
        .select({ color: tags.color })
        .from(tags)
        .where(eq(tags.workspaceId, task.workspaceId));
      const ids = await ensureTags(db, task.workspaceId, [
        { name: data.name!, color: pickTagColor(existing.map((t) => t.color)) },
      ]);
      tagId = ids.get(data.name!.toLowerCase());
    }
    const tag = await loadTag(tagId!);
    if (tag.workspaceId !== task.workspaceId)
      throw new ActionError("That tag belongs to another workspace.");

    await db.transaction(async (tx) => {
      // The task may have been moved since we looked: re-check against the locked row.
      const [fresh] = await tx
        .select({ workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .for("update");
      if (!fresh || fresh.workspaceId !== tag.workspaceId)
        throw new ActionError("That tag belongs to another workspace.");
      const changed = data.on
        ? await tx
            .insert(taskTags)
            .values({ taskId: task.id, tagId: tag.id })
            .onConflictDoNothing()
            .returning({ id: taskTags.tagId })
        : await tx
            .delete(taskTags)
            .where(and(eq(taskTags.taskId, task.id), eq(taskTags.tagId, tag.id)))
            .returning({ id: taskTags.tagId });
      if (changed.length === 0) return;
      await logActivity(tx, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: data.on ? "tag_added" : "tag_removed",
        data: { name: tag.name },
      });
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    });
    return { id: tag.id, name: tag.name, color: tag.color };
  });
}
