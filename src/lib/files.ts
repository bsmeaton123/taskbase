export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export type FileKind = "image" | "pdf" | "doc" | "sheet" | "slides" | "archive" | "text" | "other";

export function fileKind(contentType: string, name: string): FileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (contentType.startsWith("image/")) return "image";
  if (contentType === "application/pdf" || ext === "pdf") return "pdf";
  if (["doc", "docx", "odt", "rtf", "pages"].includes(ext)) return "doc";
  if (["xls", "xlsx", "csv", "ods", "numbers"].includes(ext)) return "sheet";
  if (["ppt", "pptx", "odp", "key"].includes(ext)) return "slides";
  if (["zip", "rar", "7z", "gz", "tar"].includes(ext)) return "archive";
  if (contentType.startsWith("text/") || ["txt", "md", "json"].includes(ext)) return "text";
  return "other";
}

/** Images the browser can preview inline (matches the server's safe list). */
export function isPreviewableImage(contentType: string) {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(
    contentType,
  );
}

export function attachmentUrl(id: string, download = false) {
  return `/api/attachments/${id}${download ? "?download=1" : ""}`;
}
