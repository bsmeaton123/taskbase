import { and, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { attachments, tasks } from "@/db/schema";
import { getWorkspaceAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/session";
import {
  maxUploadBytes,
  removeDiskFiles,
  sanitizeFileName,
  storageDriver,
  storeFile,
} from "@/lib/storage";
import { logActivity } from "@/server/events";

export type UploadedAttachment = {
  id: string;
  name: string;
  size: number;
  contentType: string;
};

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/**
 * Upload one file to a task. `draft=1` marks uploads from the comment box;
 * they're linked to the comment when it's posted.
 */
export async function POST(request: Request) {
  const viewer = await getCurrentUser();
  if (!viewer) return fail(401, "Your session has expired. Sign in again.");

  // Reject oversized bodies before buffering them. Browsers always send Content-Length
  // for form uploads; a request without one is refused rather than buffered blind.
  const limit = maxUploadBytes();
  const header = request.headers.get("content-length");
  const declared = header === null ? NaN : Number(header);
  if (!Number.isFinite(declared) || declared < 0)
    return fail(411, "That upload didn't include its size. Try again.");
  if (declared > limit + 64 * 1024)
    return fail(413, `Files can be up to ${Math.round(limit / 1024 / 1024)} MB.`);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "That upload didn't come through. Try again.");
  }
  const taskId = form.get("taskId");
  const file = form.get("file");
  const draft = form.get("draft") === "1";
  if (typeof taskId !== "string" || !(file instanceof File))
    return fail(400, "Choose a file to upload.");

  if (file.size > limit)
    return fail(413, `Files can be up to ${Math.round(limit / 1024 / 1024)} MB.`);
  if (file.size === 0) return fail(400, "That file is empty.");

  const [task] = await db
    .select({ id: tasks.id, workspaceId: tasks.workspaceId })
    .from(tasks)
    .where(eq(tasks.id, taskId));
  if (!task || !(await getWorkspaceAccess(viewer, task.workspaceId)))
    return fail(404, "That task no longer exists.");

  const bytes = Buffer.from(await file.arrayBuffer());
  const driver = storageDriver();
  const name = sanitizeFileName(file.name);
  const contentType = (file.type || "application/octet-stream").slice(0, 120);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(attachments)
      .values({
        taskId: task.id,
        uploaderId: viewer.id,
        name,
        contentType,
        size: file.size,
        storage: driver,
        draft,
      })
      .returning({ id: attachments.id });
    await storeFile(tx, row.id, driver, bytes);
    if (!draft) {
      await logActivity(tx, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: "file_added",
        data: { name },
      });
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    }
    return row;
  });

  // Tidy up comment-box uploads that were never posted.
  const stale = await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.uploaderId, viewer.id),
        eq(attachments.draft, true),
        lt(attachments.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
      ),
    )
    .returning({ id: attachments.id, storage: attachments.storage });
  await removeDiskFiles(stale.filter((s) => s.storage === "disk").map((s) => s.id));

  const body: UploadedAttachment = { id: created.id, name, size: file.size, contentType };
  return NextResponse.json(body, { status: 201 });
}
