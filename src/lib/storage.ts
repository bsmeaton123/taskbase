import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attachmentBlobs, attachments } from "@/db/schema";

/**
 * File storage for attachments.
 *
 * - Default: bytes live in Postgres (`attachment_blobs`). Works on any host,
 *   including serverless, with nothing extra to run.
 * - Set UPLOAD_DIR to store files on disk instead (self-hosted servers with a
 *   persistent volume; better for lots of large files).
 */
type Executor = Pick<typeof db, "insert" | "select" | "delete">;

export type StorageDriver = "db" | "disk";

export function storageDriver(): StorageDriver {
  return process.env.UPLOAD_DIR ? "disk" : "db";
}

export function maxUploadBytes() {
  const mb = Number(process.env.MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 10) * 1024 * 1024;
}

function diskPath(attachmentId: string) {
  // Attachment ids are generated alphanumerics, but never trust a path blindly.
  if (!/^[A-Za-z0-9]+$/.test(attachmentId)) throw new Error("Invalid attachment id");
  return path.join(process.env.UPLOAD_DIR!, attachmentId);
}

export async function storeFile(
  tx: Executor,
  attachmentId: string,
  driver: StorageDriver,
  bytes: Buffer,
) {
  if (driver === "disk") {
    await mkdir(process.env.UPLOAD_DIR!, { recursive: true });
    await writeFile(diskPath(attachmentId), bytes);
  } else {
    await tx.insert(attachmentBlobs).values({ attachmentId, data: bytes });
  }
}

export async function loadFile(attachment: {
  id: string;
  storage: string;
}): Promise<Buffer | null> {
  if (attachment.storage === "disk") {
    if (!process.env.UPLOAD_DIR) return null;
    try {
      return await readFile(diskPath(attachment.id));
    } catch {
      return null;
    }
  }
  const [row] = await db
    .select({ data: attachmentBlobs.data })
    .from(attachmentBlobs)
    .where(eq(attachmentBlobs.attachmentId, attachment.id));
  return row?.data ?? null;
}

/** Best-effort removal of on-disk files (database rows cascade on their own). */
export async function removeDiskFiles(attachmentIds: string[]) {
  if (!process.env.UPLOAD_DIR) return;
  await Promise.all(
    attachmentIds.map((id) => rm(diskPath(id), { force: true }).catch(() => undefined)),
  );
}

/** Content types that are safe to show inline in the browser. */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "application/pdf",
]);

export function isInlineSafe(contentType: string) {
  return INLINE_TYPES.has(contentType);
}

export function sanitizeFileName(name: string) {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  return (cleaned || "file").slice(0, 200);
}

/** Ids of on-disk attachments for tasks or a comment (collect before deleting rows). */
export async function diskAttachmentIds(where: {
  taskIds?: string[];
  commentId?: string;
}): Promise<string[]> {
  if (!process.env.UPLOAD_DIR) return [];
  const conditions = [eq(attachments.storage, "disk")];
  if (where.taskIds) {
    if (where.taskIds.length === 0) return [];
    conditions.push(inArray(attachments.taskId, where.taskIds));
  }
  if (where.commentId) conditions.push(eq(attachments.commentId, where.commentId));
  const rows = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(and(...conditions));
  return rows.map((r) => r.id);
}
