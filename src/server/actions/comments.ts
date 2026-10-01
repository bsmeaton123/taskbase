"use server";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { attachments, comments, tasks } from "@/db/schema";
import { assertTaskAccess } from "@/lib/access";
import { extractMentionIds } from "@/lib/mentions";
import { ActionError, requireActionUser } from "@/lib/session";
import { diskAttachmentIds, removeDiskFiles } from "@/lib/storage";
import { idSchema, run } from "@/server/action-utils";
import {
  addFollowers,
  filterMembers,
  getFollowerIds,
  notify,
} from "@/server/events";

const bodySchema = z
  .string()
  .trim()
  .min(1, "Write something first.")
  .max(10000, "That comment is too long.");

export async function addComment(taskId: string, body: string, attachmentIds: string[] = []) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));
    const fileIds = z.array(idSchema).max(20).parse(attachmentIds);
    const text = fileIds.length > 0 ? body.trim().slice(0, 10000) : bodySchema.parse(body);

    return db.transaction(async (tx) => {
      const [comment] = await tx
        .insert(comments)
        .values({ taskId: task.id, authorId: viewer.id, body: text })
        .returning({ id: comments.id });

      if (fileIds.length > 0) {
        // Only the viewer's own draft uploads on this task can be attached.
        const linked = await tx
          .update(attachments)
          .set({ commentId: comment.id, draft: false })
          .where(
            and(
              inArray(attachments.id, fileIds),
              eq(attachments.taskId, task.id),
              eq(attachments.uploaderId, viewer.id),
              eq(attachments.draft, true),
            ),
          )
          .returning({ id: attachments.id });
        if (!text && linked.length === 0) throw new ActionError("Write something first.");
      }

      const mentioned = await filterMembers(
        tx,
        task.workspaceId,
        extractMentionIds(text),
      );
      const followers = await getFollowerIds(tx, task.id, task.workspaceId);
      const base = {
        actorId: viewer.id,
        workspaceId: task.workspaceId,
        taskId: task.id,
        commentId: comment.id,
      };
      await notify(tx, mentioned, { ...base, kind: "mentioned" });
      await notify(
        tx,
        followers.filter((id) => !mentioned.includes(id)),
        { ...base, kind: "commented" },
      );
      await addFollowers(tx, task.id, [viewer.id, ...mentioned]);
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
      return comment;
    });
  });
}

async function loadOwnComment(id: string, viewerId: string, allowAdmin: boolean) {
  const [comment] = await db
    .select()
    .from(comments)
    .where(eq(comments.id, idSchema.parse(id)));
  if (!comment) throw new ActionError("That comment no longer exists.");
  if (comment.authorId !== viewerId && !allowAdmin)
    throw new ActionError("You can only change your own comments.");
  return comment;
}

export async function editComment(id: string, body: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const comment = await loadOwnComment(id, viewer.id, false);
    await assertTaskAccess(viewer, comment.taskId);
    await db
      .update(comments)
      .set({ body: bodySchema.parse(body), editedAt: new Date() })
      .where(eq(comments.id, comment.id));
    return null;
  });
}

export async function deleteComment(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const comment = await loadOwnComment(id, viewer.id, viewer.isAdmin);
    await assertTaskAccess(viewer, comment.taskId);
    const files = await diskAttachmentIds({ commentId: comment.id });
    await db.delete(comments).where(eq(comments.id, comment.id));
    await removeDiskFiles(files);
    return null;
  });
}
