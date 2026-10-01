"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { assertTaskAccess } from "@/lib/access";
import { ActionError, requireActionUser } from "@/lib/session";
import { removeDiskFiles } from "@/lib/storage";
import { idSchema, run } from "@/server/action-utils";

/** Uploader, workspace owners and org admins can delete a file. */
export async function deleteAttachment(id: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const [file] = await db
      .select()
      .from(attachments)
      .where(eq(attachments.id, idSchema.parse(id)));
    if (!file) return null;
    const { access } = await assertTaskAccess(viewer, file.taskId);
    if (file.uploaderId !== viewer.id && !access.canManage)
      throw new ActionError("Only the person who uploaded a file (or an owner) can delete it.");
    await db.delete(attachments).where(eq(attachments.id, file.id));
    if (file.storage === "disk") await removeDiskFiles([file.id]);
    return null;
  });
}
