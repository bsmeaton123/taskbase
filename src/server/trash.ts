import "server-only";
import { and, asc, desc, eq, inArray, lt, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { taskLists, tasks, trashedTasks, user } from "@/db/schema";
import { removeDiskFiles } from "@/lib/storage";
import { diskFilesIn, TRASH_DAYS } from "@/lib/trash";
import { wouldCreateCycle } from "@/server/dependencies";
import { filterMembers, logActivity, type Executor } from "@/server/events";

/**
 * The trash: deleting a task saves everything that belonged to it (subtasks, comments,
 * files, history, tags, links, followers) as a snapshot, then deletes the rows as before.
 * Restoring puts the rows back exactly, with the same id and number, so links like /t/142
 * work again. Snapshots are kept for 30 days.
 *
 * Snapshots are taken and restored inside Postgres (to_jsonb / jsonb_populate_record), so
 * every column, including ones added later, round-trips without code here knowing about it.
 */

type Row = Record<string, unknown>;
type Snapshot = {
  task: Row;
  subtasks: Row[];
  comments: Row[];
  attachments: Row[];
  activities: Row[];
  tags: Row[];
  /** task_assignees rows. Missing in snapshots taken before tasks had several assignees. */
  assignees?: Row[];
  dependencies: Row[];
  followers: Row[];
  /** Tasks created from this one by a repeat rule (their link is cleared on delete). */
  recurredChildren: string[];
};

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/** Moves tasks to the trash. Callers check access first. Returns the new trash ids. */
export async function trashTasks(tx: Executor, taskIds: string[], actorId: string) {
  if (taskIds.length === 0) return [];
  const rows = await tx.execute<{
    id: string;
    number: number;
    title: string;
    workspace_id: string;
    list_name: string | null;
    snapshot: Snapshot;
  }>(sql`
    select t.id, t.number, t.title, t.workspace_id, l.name as list_name,
      jsonb_build_object(
        'task', to_jsonb(t),
        'subtasks', coalesce((select jsonb_agg(to_jsonb(s)) from subtasks s where s.task_id = t.id), '[]'),
        'comments', coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at) from comments c where c.task_id = t.id), '[]'),
        'attachments', coalesce((select jsonb_agg(to_jsonb(a)) from attachments a where a.task_id = t.id), '[]'),
        'activities', coalesce((select jsonb_agg(to_jsonb(v)) from activities v where v.task_id = t.id), '[]'),
        'tags', coalesce((select jsonb_agg(to_jsonb(g)) from task_tags g where g.task_id = t.id), '[]'),
        'assignees', coalesce((select jsonb_agg(to_jsonb(ta) order by ta.created_at) from task_assignees ta where ta.task_id = t.id), '[]'),
        'dependencies', coalesce((select jsonb_agg(to_jsonb(d)) from task_dependencies d
          where d.task_id = t.id or d.depends_on_id = t.id), '[]'),
        'followers', coalesce((select jsonb_agg(to_jsonb(f)) from task_followers f where f.task_id = t.id), '[]'),
        'recurredChildren', coalesce((select jsonb_agg(r.id) from tasks r where r.recurred_from_id = t.id), '[]')
      ) as snapshot
    from tasks t
    left join task_lists l on l.id = t.task_list_id
    where t.id in (${idList(taskIds)})
    for update of t
  `);
  if (rows.length === 0) return [];

  const saved = await tx
    .insert(trashedTasks)
    .values(
      rows.map((r) => ({
        workspaceId: r.workspace_id,
        taskId: r.id,
        number: r.number,
        title: r.title,
        listName: r.list_name,
        deletedById: actorId,
        snapshot: r.snapshot,
      })),
    )
    .returning({ id: trashedTasks.id });

  // Files stored in Postgres: set the bytes aside (copied inside the database). Files on
  // disk stay where they are until the trash is purged.
  await tx.execute(sql`
    insert into trashed_blobs (attachment_id, trash_id, data)
    select b.attachment_id, tt.id, b.data
    from attachment_blobs b
    join attachments a on a.id = b.attachment_id
    join trashed_tasks tt on tt.task_id = a.task_id
    where a.task_id in (${idList(rows.map((r) => r.id))})
  `);

  await tx.delete(tasks).where(inArray(tasks.id, rows.map((r) => r.id)));
  return saved.map((s) => s.id);
}

/**
 * Puts a trashed task back. Its list is used if it still exists, otherwise the workspace's
 * first list. People who are no longer members are left off, and tags or linked tasks that
 * were deleted in the meantime are skipped. Callers check access and lock the trash row.
 */
export async function restoreTrashed(
  tx: Executor,
  row: { id: string; workspaceId: string; snapshot: Record<string, unknown> },
  actorId: string,
) {
  const snap = row.snapshot as Snapshot;
  const task = snap.task;
  const ws = row.workspaceId;

  const [list] = await tx
    .select({ id: taskLists.id })
    .from(taskLists)
    .where(
      and(eq(taskLists.workspaceId, ws), eq(taskLists.id, String(task.task_list_id))),
    );
  const [fallback] = list
    ? [list]
    : await tx
        .select({ id: taskLists.id })
        .from(taskLists)
        .where(eq(taskLists.workspaceId, ws))
        .orderBy(asc(taskLists.position), asc(taskLists.createdAt))
        .limit(1);
  if (!fallback) throw new Error("The workspace has no lists to restore into.");

  const people = new Set<string>();
  const addPerson = (v: unknown) => typeof v === "string" && people.add(v);
  // Older snapshots kept the single assignee on the task row itself.
  const assigneeRows: Row[] =
    snap.assignees ??
    (typeof task.assignee_id === "string"
      ? [{ task_id: task.id, user_id: task.assignee_id, created_at: task.created_at }]
      : []);
  assigneeRows.forEach((a) => addPerson(a.user_id));
  snap.subtasks.forEach((s) => addPerson(s.assignee_id));
  snap.followers.forEach((f) => addPerson(f.user_id));
  const members = new Set(await filterMembers(tx, ws, [...people]));
  const member = (v: unknown) => (typeof v === "string" && members.has(v) ? v : null);

  let recurredFrom = task.recurred_from_id ?? null;
  if (typeof recurredFrom === "string") {
    const [exists] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, recurredFrom));
    if (!exists) recurredFrom = null;
  }

  const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
  const taskRow = {
    ...task,
    task_list_id: fallback.id,
    recurred_from_id: recurredFrom,
  };
  await tx.execute(sql`
    insert into tasks overriding system value
    select * from jsonb_populate_record(null::tasks, ${json(taskRow)})
  `);
  const insertAll = async (table: string, rows: Row[]) => {
    if (rows.length === 0) return;
    await tx.execute(sql`
      insert into ${sql.identifier(table)}
      select * from jsonb_populate_recordset(null::${sql.identifier(table)}, ${json(rows)})
    `);
  };
  await insertAll(
    "subtasks",
    snap.subtasks.map((s) => ({ ...s, assignee_id: member(s.assignee_id) })),
  );
  await insertAll(
    "task_assignees",
    assigneeRows.filter((a) => member(a.user_id)),
  );
  await insertAll("comments", snap.comments);
  await insertAll("attachments", snap.attachments);
  await tx.execute(sql`
    insert into attachment_blobs (attachment_id, data)
    select b.attachment_id, b.data from trashed_blobs b where b.trash_id = ${row.id}
  `);
  await insertAll("activities", snap.activities);
  await insertAll(
    "task_followers",
    snap.followers.filter((f) => member(f.user_id)),
  );
  if (snap.tags.length > 0) {
    await tx.execute(sql`
      insert into task_tags
      select r.* from jsonb_populate_recordset(null::task_tags, ${json(snap.tags)}) r
      where exists (select 1 from tags g where g.id = r.tag_id and g.workspace_id = ${ws})
    `);
  }

  // Links to other tasks: only to tasks still in this workspace, and never into a loop.
  // Same lock as addDependency, so a link added meanwhile can't race the cycle check.
  if (snap.dependencies.length > 0)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ws}))`);
  for (const dep of snap.dependencies) {
    const from = String(dep.task_id);
    const to = String(dep.depends_on_id);
    const other = from === String(task.id) ? to : from;
    const [peer] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, other), eq(tasks.workspaceId, ws)));
    if (!peer || (await wouldCreateCycle(tx, from, to))) continue;
    await tx.execute(sql`
      insert into task_dependencies
      select * from jsonb_populate_record(null::task_dependencies, ${json(dep)})
      on conflict do nothing
    `);
  }

  if (snap.recurredChildren.length > 0) {
    await tx
      .update(tasks)
      .set({ recurredFromId: String(task.id) })
      .where(
        and(
          inArray(tasks.id, snap.recurredChildren),
          eq(tasks.workspaceId, ws),
          sql`${tasks.recurredFromId} is null`,
        ),
      );
  }

  await logActivity(tx, {
    workspaceId: ws,
    taskId: String(task.id),
    actorId,
    kind: "restored",
  });
  await tx.delete(trashedTasks).where(eq(trashedTasks.id, row.id));
  return { taskId: String(task.id), number: Number(task.number) };
}

export type TrashEntry = {
  id: string;
  number: number;
  title: string;
  listName: string | null;
  deletedAt: Date;
  deletedBy: string | null;
  subtasks: number;
  comments: number;
  files: number;
};

/** A workspace's trash, newest first. Callers check access to the workspace. */
export async function listTrash(workspaceId: string): Promise<TrashEntry[]> {
  return db
    .select({
      id: trashedTasks.id,
      number: trashedTasks.number,
      title: trashedTasks.title,
      listName: trashedTasks.listName,
      deletedAt: trashedTasks.deletedAt,
      deletedBy: user.name,
      subtasks: sql<number>`jsonb_array_length(${trashedTasks.snapshot}->'subtasks')`.mapWith(Number),
      comments: sql<number>`jsonb_array_length(${trashedTasks.snapshot}->'comments')`.mapWith(Number),
      files: sql<number>`(select count(*) from jsonb_array_elements(${trashedTasks.snapshot}->'attachments') a
        where (a->>'draft')::boolean is not true)`.mapWith(Number),
    })
    .from(trashedTasks)
    .leftJoin(user, eq(user.id, trashedTasks.deletedById))
    .where(eq(trashedTasks.workspaceId, workspaceId))
    .orderBy(desc(trashedTasks.deletedAt))
    .limit(500);
}

/** On-disk files of a workspace's trashed tasks (collect before deleting the workspace). */
export async function trashedDiskFiles(workspaceId: string) {
  if (!process.env.UPLOAD_DIR) return [];
  const rows = await db
    .select({ snapshot: trashedTasks.snapshot })
    .from(trashedTasks)
    .where(eq(trashedTasks.workspaceId, workspaceId));
  return diskFilesIn(rows.map((r) => r.snapshot));
}

/** Deletes trash entries for good, with their files. */
export async function purgeTrashEntries(where: SQL | undefined) {
  const gone = await db
    .delete(trashedTasks)
    .where(where)
    .returning({ snapshot: trashedTasks.snapshot });
  await removeDiskFiles(diskFilesIn(gone.map((g) => g.snapshot)));
  return gone.length;
}

/** Empties trash older than TRASH_DAYS. Run by the scheduler. */
export async function purgeOldTrash() {
  const cutoff = new Date(Date.now() - TRASH_DAYS * 24 * 3600_000);
  return purgeTrashEntries(lt(trashedTasks.deletedAt, cutoff));
}
