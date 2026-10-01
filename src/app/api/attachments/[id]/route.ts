import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, tasks } from "@/db/schema";
import { getWorkspaceAccess } from "@/lib/access";
import { getCurrentUser } from "@/lib/session";
import { isInlineSafe, loadFile } from "@/lib/storage";

function contentDisposition(kind: "inline" | "attachment", name: string) {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** Serves an attachment to people who can see its task. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getCurrentUser();
  if (!viewer) return new Response("Sign in to view this file.", { status: 401 });

  const [row] = await db
    .select({
      id: attachments.id,
      name: attachments.name,
      contentType: attachments.contentType,
      storage: attachments.storage,
      draft: attachments.draft,
      uploaderId: attachments.uploaderId,
      workspaceId: tasks.workspaceId,
    })
    .from(attachments)
    .innerJoin(tasks, eq(tasks.id, attachments.taskId))
    .where(eq(attachments.id, id));

  const visible =
    row &&
    (!row.draft || row.uploaderId === viewer.id) &&
    (await getWorkspaceAccess(viewer, row.workspaceId));
  if (!visible) return new Response("File not found.", { status: 404 });

  const bytes = await loadFile(row);
  if (!bytes) return new Response("File not found.", { status: 404 });

  const download = new URL(request.url).searchParams.has("download");
  const inline = isInlineSafe(row.contentType) && !download;

  const headers = new Headers({
    "Content-Type": inline ? row.contentType : "application/octet-stream",
    "Content-Length": String(bytes.length),
    "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", row.name),
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  });
  // Uploaded files must never run scripts in our origin. PDFs are exempt
  // because browsers render them in an isolated viewer that won't load
  // inside a sandbox.
  if (row.contentType !== "application/pdf" || !inline)
    headers.set("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");

  return new Response(new Uint8Array(bytes), { headers });
}
