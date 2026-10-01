import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { tags, taskTags } from "@/db/schema";
import { isValidColor, normalizeColor, WORKSPACE_COLOR_KEYS } from "@/lib/colors";
import type { Executor } from "@/server/events";

export const TAG_NAME_MAX = 40;

export function cleanTagName(name: string) {
  return name.trim().replace(/\s+/g, " ").slice(0, TAG_NAME_MAX);
}

/**
 * A colour for a new tag: the one used least in the workspace, in palette order, with grey
 * last so new tags are easy to tell apart.
 */
export function pickTagColor(existing: string[]) {
  const order = [...WORKSPACE_COLOR_KEYS.filter((c) => c !== "slate"), "slate"];
  const counts = new Map(order.map((c) => [c, 0]));
  for (const c of existing) if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
}

/**
 * Finds tags by name in a workspace (case-insensitive), creating the missing ones.
 * Returns lower-case name -> tag id.
 */
export async function ensureTags(
  tx: Executor,
  workspaceId: string,
  wanted: { name: string; color?: string }[],
) {
  const existing = await tx.select().from(tags).where(eq(tags.workspaceId, workspaceId));
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
  const colors = existing.map((t) => t.color);
  for (const w of wanted) {
    const name = cleanTagName(w.name);
    if (!name || byName.has(name.toLowerCase())) continue;
    const color = isValidColor(w.color) ? normalizeColor(w.color) : pickTagColor(colors);
    const [row] = await tx
      .insert(tags)
      .values({ workspaceId, name, color })
      .onConflictDoNothing()
      .returning({ id: tags.id });
    if (row) {
      byName.set(name.toLowerCase(), row.id);
      colors.push(color);
    } else {
      // Someone created it at the same moment: use theirs.
      const [again] = await tx
        .select({ id: tags.id })
        .from(tags)
        .where(and(eq(tags.workspaceId, workspaceId), sql`lower(${tags.name}) = ${name.toLowerCase()}`));
      if (again) byName.set(name.toLowerCase(), again.id);
    }
  }
  return byName;
}

/**
 * Gives copied or moved tasks the same tags (by name) in the target workspace.
 * `pairs` maps each source task id to the task that should get its tags.
 */
export async function carryTags(
  tx: Executor,
  pairs: Map<string, string>,
  targetWorkspaceId: string,
  opts: { replace?: boolean } = {},
) {
  const sourceIds = [...pairs.keys()];
  if (sourceIds.length === 0) return;
  const rows = await tx
    .select({ taskId: taskTags.taskId, name: tags.name, color: tags.color })
    .from(taskTags)
    .innerJoin(tags, eq(tags.id, taskTags.tagId))
    .where(inArray(taskTags.taskId, sourceIds));
  if (opts.replace) await tx.delete(taskTags).where(inArray(taskTags.taskId, [...pairs.values()]));
  if (rows.length === 0) return;
  const ids = await ensureTags(
    tx,
    targetWorkspaceId,
    rows.map((r) => ({ name: r.name, color: r.color })),
  );
  const links = rows
    .map((r) => ({ taskId: pairs.get(r.taskId)!, tagId: ids.get(r.name.toLowerCase())! }))
    .filter((l) => l.taskId && l.tagId);
  for (let i = 0; i < links.length; i += 500)
    await tx.insert(taskTags).values(links.slice(i, i + 500)).onConflictDoNothing();
}
