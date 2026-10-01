/** How long deleted tasks stay in a workspace's trash before they're deleted for good. */
export const TRASH_DAYS = 30;

/** Ids of on-disk files inside trash snapshots (to remove once the trash entry goes). */
export function diskFilesIn(snapshots: Record<string, unknown>[]): string[] {
  return snapshots.flatMap((s) => {
    const files = Array.isArray(s.attachments) ? (s.attachments as Record<string, unknown>[]) : [];
    return files.filter((a) => a.storage === "disk").map((a) => String(a.id));
  });
}
