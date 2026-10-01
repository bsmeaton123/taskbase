"use server";

import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { activities, taskFollowers, taskLists, taskTags, tasks } from "@/db/schema";
import { assertWorkspaceAccess } from "@/lib/access";
import { newId } from "@/lib/id";
import { ActionError, requireActionUser } from "@/lib/session";
import { isClosed } from "@/lib/status";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { insertAssignees } from "@/server/assignees";
import { filterMembers } from "@/server/events";
import { cleanTagName, ensureTags } from "@/server/tags";

const rowSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20000).optional(),
  list: z.string().trim().max(80).optional(),
  assigneeIds: z.array(idSchema).max(20).optional(),
  startDate: dateSchema.nullable().optional(),
  dueDate: dateSchema.nullable().optional(),
  status: z.enum(["open", "in_progress", "on_hold", "resolved", "rejected"]).optional(),
  urgent: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  /** When it was finished, for closed rows (so old imports don't look freshly completed). */
  completedOn: dateSchema.nullable().optional(),
});

export type ImportRow = z.input<typeof rowSchema>;

/**
 * Bulk-creates tasks from a parsed spreadsheet. Lists named in the file are
 * created if they don't exist. Assignees must be workspace members; nobody is
 * notified, so a big import doesn't flood inboxes.
 */
export async function importTasks(input: {
  workspaceId: string;
  defaultListId: string;
  rows: ImportRow[];
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        workspaceId: idSchema,
        defaultListId: idSchema,
        rows: z.array(rowSchema).min(1, "There's nothing to import.").max(2000, "Import up to 2,000 tasks at a time."),
      })
      .parse(input);
    await assertWorkspaceAccess(viewer, data.workspaceId);

    return db.transaction(async (tx) => {
      const lists = await tx
        .select({ id: taskLists.id, name: taskLists.name, position: taskLists.position })
        .from(taskLists)
        .where(eq(taskLists.workspaceId, data.workspaceId));
      if (!lists.some((l) => l.id === data.defaultListId))
        throw new ActionError("That task list no longer exists. Reopen the import and pick another.");

      // Create any lists the file mentions that don't exist yet.
      const byName = new Map(lists.map((l) => [l.name.trim().toLowerCase(), l.id]));
      let nextListPos = Math.max(0, ...lists.map((l) => l.position)) + 1024;
      let listsCreated = 0;
      for (const row of data.rows) {
        const key = row.list?.toLowerCase();
        if (key && !byName.has(key)) {
          const id = newId();
          await tx.insert(taskLists).values({
            id,
            workspaceId: data.workspaceId,
            name: row.list!,
            position: nextListPos,
          });
          nextListPos += 1024;
          byName.set(key, id);
          listsCreated++;
        }
      }

      const allowed = new Set(
        await filterMembers(tx, data.workspaceId, [
          ...new Set(data.rows.flatMap((r) => r.assigneeIds ?? [])),
        ]),
      );

      // Append after whatever is already in each list, keeping file order.
      const nextPos = new Map<string, number>();
      for (const listId of new Set([...lists.map((l) => l.id), ...byName.values()])) {
        const [{ hi }] = await tx
          .select({ hi: max(tasks.position) })
          .from(tasks)
          .where(eq(tasks.taskListId, listId));
        nextPos.set(listId, (hi ?? 0) + 1024);
      }

      const now = new Date();
      const taskRows = data.rows.map((r) => {
        const listId = (r.list && byName.get(r.list.toLowerCase())) || data.defaultListId;
        const position = nextPos.get(listId)!;
        nextPos.set(listId, position + 1024);
        const status = r.status ?? "open";
        return {
          id: newId(),
          workspaceId: data.workspaceId,
          taskListId: listId,
          title: r.title,
          description: r.description ?? "",
          status,
          urgent: r.urgent ?? false,
          startDate: r.startDate && (!r.dueDate || r.startDate <= r.dueDate) ? r.startDate : null,
          dueDate: r.dueDate ?? null,
          position,
          createdById: viewer.id,
          completedAt: isClosed(status)
            ? r.completedOn
              ? new Date(`${r.completedOn}T12:00:00Z`)
              : r.dueDate
                ? new Date(`${r.dueDate}T12:00:00Z`)
                : now
            : null,
        } satisfies typeof tasks.$inferInsert;
      });

      const assigneesOf = (i: number) =>
        (data.rows[i].assigneeIds ?? []).filter((id) => allowed.has(id));
      for (let i = 0; i < taskRows.length; i += 500) {
        const chunk = taskRows.slice(i, i + 500);
        await tx.insert(tasks).values(chunk);
        await insertAssignees(
          tx,
          chunk.map((t, j) => ({ taskId: t.id, userIds: assigneesOf(i + j) })),
        );
        await tx.insert(activities).values(
          chunk.map((t) => ({
            workspaceId: data.workspaceId,
            taskId: t.id,
            actorId: viewer.id,
            kind: "task_created" as const,
            data: { imported: true },
          })),
        );
        const follows = chunk.flatMap((t, j) =>
          [...new Set([viewer.id, ...assigneesOf(i + j)])].map((userId) => ({ taskId: t.id, userId })),
        );
        await tx.insert(taskFollowers).values(follows).onConflictDoNothing();
      }

      // Tags named in the file: create missing ones, then attach.
      const tagNames = data.rows.flatMap((r) => r.tags ?? []);
      let tagsUsed = 0;
      if (tagNames.length > 0) {
        const tagIds = await ensureTags(
          tx,
          data.workspaceId,
          tagNames.map((name) => ({ name })),
        );
        tagsUsed = new Set(tagNames.map((n) => n.toLowerCase())).size;
        const links = data.rows.flatMap((r, i) =>
          (r.tags ?? []).flatMap((name) => {
            const tagId = tagIds.get(cleanTagName(name).toLowerCase());
            return tagId ? [{ taskId: taskRows[i].id, tagId }] : [];
          }),
        );
        for (let i = 0; i < links.length; i += 500)
          await tx.insert(taskTags).values(links.slice(i, i + 500)).onConflictDoNothing();
      }

      return { created: taskRows.length, listsCreated, tagsUsed };
    });
  });
}
