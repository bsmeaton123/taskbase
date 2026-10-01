"use server";

import { and, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, comments, updateDismissals, user } from "@/db/schema";
import { assertTaskAccess } from "@/lib/access";
import { requireActionUser } from "@/lib/session";
import { UPDATES_WINDOW_DAYS, type UpdateItemRef } from "@/lib/updates";
import { idSchema, run } from "@/server/action-utils";

const itemsSchema = z
  .array(z.object({ kind: z.enum(["activity", "comment"]), id: idSchema }))
  .min(1)
  .max(500);

/** Hides one card on My tasks > Updates (every change and comment it stands for). */
export async function dismissUpdates(items: UpdateItemRef[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const parsed = itemsSchema.parse(items);
    const ids = (kind: UpdateItemRef["kind"]) =>
      parsed.filter((i) => i.kind === kind).map((i) => i.id);
    const activityIds = ids("activity");
    const commentIds = ids("comment");

    // Items whose task has gone since are skipped; the card disappears on refresh anyway.
    const [activityRows, commentRows] = await Promise.all([
      activityIds.length > 0
        ? db
            .select({ id: activities.id, taskId: activities.taskId })
            .from(activities)
            .where(inArray(activities.id, activityIds))
        : [],
      commentIds.length > 0
        ? db
            .select({ id: comments.id, taskId: comments.taskId })
            .from(comments)
            .where(inArray(comments.id, commentIds))
        : [],
    ]);
    const taskIds = new Set(
      [...activityRows, ...commentRows]
        .map((r) => r.taskId)
        .filter((id): id is string => Boolean(id)),
    );
    for (const taskId of taskIds) await assertTaskAccess(viewer, taskId);

    const rows = [
      ...activityRows.map((r) => ({ userId: viewer.id, itemKind: "activity" as const, itemId: r.id })),
      ...commentRows.map((r) => ({ userId: viewer.id, itemKind: "comment" as const, itemId: r.id })),
    ];
    if (rows.length > 0) await db.insert(updateDismissals).values(rows).onConflictDoNothing();

    // Updates only go back 30 days, so older dismissals no longer hide anything.
    await db
      .delete(updateDismissals)
      .where(
        and(
          eq(updateDismissals.userId, viewer.id),
          lt(updateDismissals.createdAt, new Date(Date.now() - UPDATES_WINDOW_DAYS * 86_400_000)),
        ),
      );
    return null;
  });
}

/**
 * "Clear all": hides every update up to the newest one on screen (`upTo`), so anything that
 * arrived since stays. Returns the previous setting so it can be undone.
 */
export async function clearAllUpdates(upTo: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const shown = new Date(z.iso.datetime().parse(upTo));
    // Timestamps carry microseconds and `upTo` only milliseconds: go just past it.
    const cutoff = new Date(Math.min(Date.now(), shown.getTime() + 1));
    const [row] = await db
      .select({ previous: user.updatesClearedAt })
      .from(user)
      .where(eq(user.id, viewer.id));
    const previous = row?.previous ?? null;
    if (!previous || previous < cutoff)
      await db.update(user).set({ updatesClearedAt: cutoff }).where(eq(user.id, viewer.id));
    return { previous: previous?.toISOString() ?? null };
  });
}

/** Undoes "Clear all" by putting the previous setting back. */
export async function undoClearUpdates(previous: string | null) {
  return run(async () => {
    const viewer = await requireActionUser();
    const value = z.iso.datetime().nullable().parse(previous);
    await db
      .update(user)
      .set({ updatesClearedAt: value ? new Date(value) : null })
      .where(eq(user.id, viewer.id));
    return null;
  });
}
