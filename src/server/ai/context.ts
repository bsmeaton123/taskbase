import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activities,
  comments,
  taskFollowers,
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
  type TaskStatus,
  tags,
} from "@/db/schema";
import { getWorkspaceAccess } from "@/lib/access";
import { shiftDate } from "@/lib/dates";
import { computeInsights, type Insight, type InsightTask } from "@/lib/insights";
import { decodeMentions } from "@/lib/mentions";
import { getToday, type CurrentUser } from "@/lib/session";
import { STATUS_META } from "@/lib/status";
import { describeRecurrence } from "@/lib/recurrence";
import {
  assignedTo,
  assigneeNameListSql,
  assigneeNamesSql,
  unassigned,
} from "@/server/assignees";
import { getInbox, getMyTasks, getTaskDetail } from "@/server/queries";

/*
 * Everything the AI sees is gathered here, always scoped to what the viewer
 * can already access. Content is rendered as compact, labelled plain text.
 */

const CLOSED: TaskStatus[] = ["resolved", "rejected"];

const stamp = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
const plain = (body: string) => decodeMentions(body).text;
const statusLabel = (s: TaskStatus) => STATUS_META[s].label;

/** Workspaces the viewer is a member of (never templates or archived ones). */
function memberWorkspaces(viewerId: string) {
  return db
    .select({ id: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, viewerId),
        isNull(workspaces.archivedAt),
        eq(workspaces.isTemplate, false),
      ),
    );
}

/** People's text goes inside XML-ish data tags; angle brackets inside it must not close them. */
export function safe(text: string) {
  return text.replace(/</g, "‹").replace(/>/g, "›");
}

/* -------------------------------------------------------------------------- */
/* Task thread                                                                 */
/* -------------------------------------------------------------------------- */

export async function taskThreadContext(viewer: CurrentUser, taskId: string) {
  const detail = await getTaskDetail(viewer, taskId);
  if (!detail) return null;
  const t = detail.task;
  const assignees = detail.assignees.map((a) => a.name).join(", ");
  const lines = [
    `<task number="#${t.number}" workspace="${detail.workspace.name}" list="${detail.list.name}">`,
    `Title: ${safe(t.title)}`,
    `Status: ${statusLabel(t.status)} | Assignees: ${assignees || "nobody"} | Start: ${t.startDate ?? "none"} | Due: ${t.dueDate ?? "none"} | Urgent: ${t.urgent ? "yes" : "no"}`,
    t.recurrence ? `Repeats: ${describeRecurrence(t.recurrence, t.dueDate)}` : "",
    detail.tags.length ? `Tags: ${detail.tags.map((x) => x.name).join(", ")}` : "",
    detail.blockedBy.length
      ? `Waiting for: ${detail.blockedBy.map((b) => `#${b.number} ${b.title} (${statusLabel(b.status)})`).join("; ")}`
      : "",
    detail.blocking.length
      ? `Holding up: ${detail.blocking.map((b) => `#${b.number} ${b.title}`).join("; ")}`
      : "",
    `Created: ${stamp(t.createdAt)} by ${detail.creatorName ?? "unknown"}`,
    t.description ? `Description:\n${safe(t.description)}` : "Description: none",
    `Subtasks (${detail.subtasks.filter((s) => s.done).length} of ${detail.subtasks.length} done):`,
    ...detail.subtasks.map(
      (s) =>
        `- [${s.done ? "x" : " "}] ${safe(s.title)}${s.assignee ? ` (${s.assignee.name})` : ""}${s.dueDate ? ` due ${s.dueDate}` : ""}`,
    ),
    detail.files.length ? `Files: ${detail.files.map((f) => f.name).join(", ")}` : "",
    "</task>",
    "<history>",
    ...detail.feed.map((item) => {
      if (item.type === "comment") {
        const files = item.attachments.length
          ? ` [attached: ${item.attachments.map((a) => a.name).join(", ")}]`
          : "";
        return `[${stamp(item.createdAt)}] ${item.author?.name ?? "Former member"} commented: ${safe(plain(item.body))}${files}`;
      }
      return `[${stamp(item.createdAt)}] ${item.actor?.name ?? "Someone"} ${describeActivity(item.kind, item.data)}`;
    }),
    "</history>",
  ];
  return { text: lines.filter(Boolean).join("\n"), detail };
}

function describeActivity(kind: string, d: Record<string, unknown>): string {
  switch (kind) {
    case "task_created":
      return d.source ? `created the task in ${d.source}` : "created the task";
    case "renamed":
      return `renamed it from "${d.from}"`;
    case "status_changed":
      return `changed status to ${STATUS_META[d.to as TaskStatus]?.label ?? d.to}`;
    case "assigned":
      return `assigned it to ${d.name ?? "someone"}`;
    case "unassigned":
      // Older entries (single assignee) didn't record who was removed.
      return d.name ? `took ${d.name} off it` : "removed the assignee";
    case "due_changed":
      return d.to ? `set the due date to ${d.to}` : "removed the due date";
    case "urgent_changed":
      return d.urgent ? "marked it urgent" : "removed the urgent flag";
    case "moved":
      return `moved it to ${d.list}${d.workspace ? ` in ${d.workspace}` : ""}`;
    case "subtask_added":
      return `added subtask "${d.title}"`;
    case "subtask_completed":
      return `completed subtask "${d.title}"`;
    case "subtask_reopened":
      return `reopened subtask "${d.title}"`;
    case "file_added":
      return `attached ${d.name}`;
    case "start_changed":
      return d.to ? `set the start date to ${d.to}` : "removed the start date";
    case "recurrence_changed":
      return d.rule ? `set it to repeat: ${d.rule}` : "stopped it repeating";
    case "recurred":
      return d.fromNumber
        ? `created this from #${d.fromNumber} (a repeating task)`
        : d.nextNumber
          ? `completed it; the next repeat is #${d.nextNumber}${d.due ? `, due ${d.due}` : ""}`
          : "completed the last repeat";
    case "blocker_added":
      return `marked it as waiting for #${d.number} "${d.title}"`;
    case "blocker_removed":
      return `removed the wait on #${d.number}`;
    case "tag_added":
      return `tagged it "${d.name}"`;
    case "tag_removed":
      return `removed the tag "${d.name}"`;
    case "restored":
      return "restored it from the trash";
    default:
      return "updated the task";
  }
}

/* -------------------------------------------------------------------------- */
/* Personal digest                                                             */
/* -------------------------------------------------------------------------- */

export async function digestContext(viewer: CurrentUser) {
  const today = await getToday();
  const since = new Date(Date.now() - 24 * 3600_000);
  const [{ tasks: mine }, unread, changes] = await Promise.all([
    getMyTasks(viewer, "open"),
    getInbox(viewer, "unread"),
    followedChanges(viewer, since),
  ]);

  const taskLine = (t: (typeof mine)[number]) =>
    `#${t.number} ${t.title} [${t.workspace.name}] status ${statusLabel(t.status)}${t.dueDate ? `, due ${t.dueDate}` : ""}${t.urgent ? ", URGENT" : ""}${t.subtaskTotal ? `, subtasks ${t.subtaskDone}/${t.subtaskTotal}` : ""}`;

  const overdue = mine.filter((t) => t.dueDate && t.dueDate < today);
  const dueSoon = mine.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= shiftDate(today, 2));
  const later = mine.filter((t) => !overdue.includes(t) && !dueSoon.includes(t)).slice(0, 25);

  const text = [
    `Today is ${today}. The reader is ${viewer.name}.`,
    "<my_tasks>",
    `Overdue (${overdue.length}):`,
    ...overdue.map(taskLine),
    `Due today to ${shiftDate(today, 2)} (${dueSoon.length}):`,
    ...dueSoon.map(taskLine),
    `Other open tasks (${later.length}${mine.length > overdue.length + dueSoon.length + later.length ? ", more not shown" : ""}):`,
    ...later.map(taskLine),
    "</my_tasks>",
    "<unread_inbox>",
    ...unread.slice(0, 40).map(
      (n) =>
        `- ${n.actorName ?? "Someone"} ${n.kind.replace(/_/g, " ")}${n.taskNumber ? ` on #${n.taskNumber} ${n.taskTitle}` : ""}${n.workspaceName ? ` [${n.workspaceName}]` : ""}${n.commentBody ? `: "${plain(n.commentBody).slice(0, 300)}"` : ""}`,
    ),
    "</unread_inbox>",
    "<followed_task_updates_last_24h>",
    ...changes,
    "</followed_task_updates_last_24h>",
  ].join("\n");

  return { text, empty: mine.length === 0 && unread.length === 0 && changes.length === 0 };
}

async function followedChanges(viewer: CurrentUser, since: Date) {
  const actor = alias(user, "change_actor");
  const followed = db
    .select({ id: taskFollowers.taskId })
    .from(taskFollowers)
    .where(eq(taskFollowers.userId, viewer.id));
  const [commentRows, activityRows] = await Promise.all([
    db
      .select({
        number: tasks.number,
        title: tasks.title,
        who: actor.name,
        body: comments.body,
        at: comments.createdAt,
      })
      .from(comments)
      .innerJoin(tasks, eq(tasks.id, comments.taskId))
      .leftJoin(actor, eq(actor.id, comments.authorId))
      .where(
        and(
          inArray(comments.taskId, followed),
          inArray(tasks.workspaceId, memberWorkspaces(viewer.id)),
          gte(comments.createdAt, since),
          or(isNull(comments.authorId), ne(comments.authorId, viewer.id)),
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(40),
    db
      .select({
        number: tasks.number,
        title: tasks.title,
        who: actor.name,
        kind: activities.kind,
        data: activities.data,
        at: activities.createdAt,
      })
      .from(activities)
      .innerJoin(tasks, eq(tasks.id, activities.taskId))
      .leftJoin(actor, eq(actor.id, activities.actorId))
      .where(
        and(
          inArray(activities.taskId, followed),
          inArray(tasks.workspaceId, memberWorkspaces(viewer.id)),
          gte(activities.createdAt, since),
          or(isNull(activities.actorId), ne(activities.actorId, viewer.id)),
        ),
      )
      .orderBy(desc(activities.createdAt))
      .limit(40),
  ]);
  return [
    ...commentRows.map(
      (c) => `[${stamp(c.at)}] ${c.who ?? "Someone"} commented on #${c.number} ${c.title}: "${plain(c.body).slice(0, 300)}"`,
    ),
    ...activityRows.map(
      (a) => `[${stamp(a.at)}] ${a.who ?? "Someone"} ${describeActivity(a.kind, a.data)} on #${a.number} ${a.title}`,
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* Workspace status report                                                     */
/* -------------------------------------------------------------------------- */

export async function workspaceReportContext(viewer: CurrentUser, workspaceId: string, days: number) {
  const access = await getWorkspaceAccess(viewer, workspaceId);
  if (!access) return null;
  const today = await getToday();
  const since = new Date(Date.now() - days * 24 * 3600_000);
  const commenter = alias(user, "report_commenter");

  const all = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      urgent: tasks.urgent,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      list: taskLists.name,
      assignees: assigneeNamesSql,
    })
    .from(tasks)
    .innerJoin(taskLists, eq(taskLists.id, tasks.taskListId))
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(asc(taskLists.position), asc(tasks.position));

  const recentComments = await db
    .select({
      number: tasks.number,
      who: commenter.name,
      body: comments.body,
      at: comments.createdAt,
    })
    .from(comments)
    .innerJoin(tasks, eq(tasks.id, comments.taskId))
    .leftJoin(commenter, eq(commenter.id, comments.authorId))
    .where(and(eq(tasks.workspaceId, workspaceId), gte(comments.createdAt, since)))
    .orderBy(desc(comments.createdAt))
    .limit(60);

  const line = (t: (typeof all)[number]) =>
    `#${t.number} ${t.title} [${t.list}] ${statusLabel(t.status)}${t.assignees ? `, ${t.assignees}` : ", unassigned"}${t.dueDate ? `, due ${t.dueDate}` : ""}${t.urgent ? ", URGENT" : ""}`;
  const open = all.filter((t) => !CLOSED.includes(t.status));
  const done = all.filter((t) => t.status === "resolved" && t.completedAt && t.completedAt >= since);
  const created = all.filter((t) => t.createdAt >= since);
  const overdue = open.filter((t) => t.dueDate && t.dueDate < today);
  const upcoming = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= shiftDate(today, 7));
  const inProgress = open.filter((t) => t.status === "in_progress");
  const onHold = open.filter((t) => t.status === "on_hold");

  const text = [
    `Workspace: ${access.workspace.name}${access.workspace.description ? ` (${access.workspace.description})` : ""}`,
    `Report period: last ${days} days, up to ${today}. Open tasks: ${open.length}. Total tasks: ${all.length}.`,
    `<completed_in_period count="${done.length}">`,
    ...done.map(line),
    "</completed_in_period>",
    `<created_in_period count="${created.length}">`,
    ...created.slice(0, 40).map(line),
    "</created_in_period>",
    `<in_progress count="${inProgress.length}">`,
    ...inProgress.map(line),
    "</in_progress>",
    `<on_hold count="${onHold.length}">`,
    ...onHold.map(line),
    "</on_hold>",
    `<overdue count="${overdue.length}">`,
    ...overdue.map(line),
    "</overdue>",
    `<due_next_7_days count="${upcoming.length}">`,
    ...upcoming.map(line),
    "</due_next_7_days>",
    "<recent_comments>",
    ...recentComments.map(
      (c) => `[${stamp(c.at)}] ${c.who ?? "Someone"} on #${c.number}: "${safe(plain(c.body)).slice(0, 280)}"`,
    ),
    "</recent_comments>",
  ].join("\n");
  return { text, workspace: access.workspace };
}

/* -------------------------------------------------------------------------- */
/* Risks                                                                       */
/* -------------------------------------------------------------------------- */

async function loadInsightTasks(where: SQL): Promise<InsightTask[]> {
  const rows = await db
    .select({
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      assigneeNames: assigneeNameListSql,
      subtaskTotal:
        sql<number>`(select count(*) from subtasks s where s.task_id = "tasks"."id")`.mapWith(Number),
      subtaskDone:
        sql<number>`(select count(*) from subtasks s where s.task_id = "tasks"."id" and s.done)`.mapWith(Number),
      lastActivity: sql<string>`to_char(greatest(
          "tasks"."updated_at",
          coalesce((select max(c.created_at) from comments c where c.task_id = "tasks"."id"), "tasks"."created_at"),
          coalesce((select max(a.created_at) from activities a where a.task_id = "tasks"."id"), "tasks"."created_at")
        ), 'YYYY-MM-DD')`,
      onHoldSince: sql<string | null>`(select to_char(max(a.created_at), 'YYYY-MM-DD') from activities a
          where a.task_id = "tasks"."id" and a.kind = 'status_changed' and a.data->>'to' = 'on_hold')`,
      blockers: sql<{ number: number; title: string; dueDate: string | null }[]>`coalesce((
          select json_agg(json_build_object('number', b.number, 'title', b.title, 'dueDate', b.due_date) order by b.due_date nulls last)
          from task_dependencies d join tasks b on b.id = d.depends_on_id
          where d.task_id = "tasks"."id" and b.status not in ('resolved','rejected')), '[]'::json)`,
    })
    .from(tasks)
    .where(and(where, notInArray(tasks.status, CLOSED)))
    .limit(2000);
  return rows.map((r) => ({ ...r, onHoldSince: r.status === "on_hold" ? r.onHoldSince : null }));
}

export async function workspaceInsights(viewer: CurrentUser, workspaceId: string) {
  const access = await getWorkspaceAccess(viewer, workspaceId);
  if (!access) return null;
  const today = await getToday();
  const list = await loadInsightTasks(eq(tasks.workspaceId, workspaceId));
  return { workspace: access.workspace, insights: computeInsights(list, today), openCount: list.length, today };
}

/** The viewer's own warnings across their workspaces (no AI involved). */
export async function myInsights(viewer: CurrentUser): Promise<Insight[]> {
  const today = await getToday();
  const list = await loadInsightTasks(
    and(assignedTo(viewer.id), inArray(tasks.workspaceId, memberWorkspaces(viewer.id)))!,
  );
  return computeInsights(list, today).filter((i) => i.kind !== "overloaded");
}

export function insightsText(insights: Insight[]) {
  return insights
    .map(
      (i) =>
        `- [${i.severity}] ${i.kind}: ${i.taskNumber ? `#${i.taskNumber} ` : ""}${i.title}${i.person && i.kind !== "overloaded" ? ` (${i.person})` : ""}, ${i.detail}`,
    )
    .join("\n");
}

/* -------------------------------------------------------------------------- */
/* Workspace directory (for quick add and notes-to-tasks)                      */
/* -------------------------------------------------------------------------- */

export async function workspaceDirectory(viewer: CurrentUser, onlyWorkspaceId?: string) {
  const ids = (await memberWorkspaces(viewer.id)).map((w) => w.id);
  const scoped = onlyWorkspaceId ? ids.filter((id) => id === onlyWorkspaceId) : ids;
  if (scoped.length === 0) return [];
  const [ws, tagRows, lists, members] = await Promise.all([
    db
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(inArray(workspaces.id, scoped))
      .orderBy(asc(workspaces.name)),
    db
      .select({ id: tags.id, name: tags.name, workspaceId: tags.workspaceId })
      .from(tags)
      .where(inArray(tags.workspaceId, scoped))
      .orderBy(asc(tags.name)),
    db
      .select({ id: taskLists.id, name: taskLists.name, workspaceId: taskLists.workspaceId })
      .from(taskLists)
      .where(inArray(taskLists.workspaceId, scoped))
      .orderBy(asc(taskLists.position)),
    db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        id: user.id,
        name: user.name,
        email: user.email,
      })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(
        and(
          inArray(workspaceMembers.workspaceId, scoped),
          or(isNull(user.banned), eq(user.banned, false)),
        ),
      ),
  ]);
  return ws.map((w) => ({
    ...w,
    lists: lists.filter((l) => l.workspaceId === w.id).map(({ id, name }) => ({ id, name })),
    members: members
      .filter((m) => m.workspaceId === w.id)
      .map(({ id, name, email }) => ({ id, name, email })),
    tags: tagRows.filter((t) => t.workspaceId === w.id).map(({ id, name }) => ({ id, name })),
  }));
}

export type WorkspaceDirectory = Awaited<ReturnType<typeof workspaceDirectory>>;

/* -------------------------------------------------------------------------- */
/* Ask: read-only tools over the viewer's workspaces                           */
/* -------------------------------------------------------------------------- */

export async function aiListWorkspaces(viewer: CurrentUser) {
  const dir = await workspaceDirectory(viewer);
  if (dir.length === 0) return "You are not a member of any workspaces.";
  const counts = await db
    .select({
      workspaceId: tasks.workspaceId,
      open: sql<number>`count(*) filter (where ${tasks.status} not in ('resolved','rejected'))`.mapWith(Number),
      total: sql<number>`count(*)`.mapWith(Number),
    })
    .from(tasks)
    .where(inArray(tasks.workspaceId, dir.map((w) => w.id)))
    .groupBy(tasks.workspaceId);
  return dir
    .map((w) => {
      const c = counts.find((x) => x.workspaceId === w.id);
      return `${w.name}: ${c?.open ?? 0} open of ${c?.total ?? 0} tasks. Lists: ${w.lists.map((l) => l.name).join(", ")}. Members: ${w.members.map((m) => m.name).join(", ")}`;
    })
    .join("\n");
}

export async function aiSearchTasks(
  viewer: CurrentUser,
  q: {
    query?: string;
    workspace?: string;
    assignee?: string;
    status?: "open" | "closed" | "any";
    dueBefore?: string;
    limit?: number;
  },
) {
  const conditions: (SQL | undefined)[] = [
    inArray(tasks.workspaceId, memberWorkspaces(viewer.id)),
  ];
  if (q.query?.trim()) {
    const pattern = `%${q.query.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      or(
        ilike(tasks.title, pattern),
        ilike(tasks.description, pattern),
        sql`exists (select 1 from comments c where c.task_id = "tasks"."id" and c.body ilike ${pattern})`,
        sql`exists (select 1 from subtasks s where s.task_id = "tasks"."id" and s.title ilike ${pattern})`,
      ),
    );
  }
  if (q.workspace?.trim()) conditions.push(ilike(workspaces.name, `%${q.workspace.trim()}%`));
  if (q.assignee?.trim()) {
    // Matches when any of the task's assignees does.
    const who = q.assignee.trim();
    if (who.toLowerCase() === "me") conditions.push(assignedTo(viewer.id));
    else if (who.toLowerCase() === "nobody" || who.toLowerCase() === "unassigned")
      conditions.push(unassigned);
    else {
      const pattern = `%${who.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
      conditions.push(
        sql`exists (select 1 from task_assignees ta join "user" au on au.id = ta.user_id where ta.task_id = "tasks"."id" and (au.name ilike ${pattern} or au.email ilike ${pattern}))`,
      );
    }
  }
  const status = q.status ?? "open";
  if (status === "open") conditions.push(notInArray(tasks.status, CLOSED));
  if (status === "closed") conditions.push(inArray(tasks.status, CLOSED));
  if (q.dueBefore && /^\d{4}-\d{2}-\d{2}$/.test(q.dueBefore))
    conditions.push(lt(tasks.dueDate, shiftDate(q.dueBefore, 1)));

  const rows = await db
    .select({
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      dueDate: tasks.dueDate,
      urgent: tasks.urgent,
      workspace: workspaces.name,
      list: taskLists.name,
      assignees: assigneeNamesSql,
      updatedAt: tasks.updatedAt,
      comments: sql<number>`(select count(*) from comments c where c.task_id = "tasks"."id")`.mapWith(Number),
    })
    .from(tasks)
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .innerJoin(taskLists, eq(taskLists.id, tasks.taskListId))
    .where(and(...conditions))
    .orderBy(sql`${tasks.dueDate} asc nulls last`, desc(tasks.updatedAt))
    .limit(Math.min(Math.max(q.limit ?? 25, 1), 50));

  if (rows.length === 0) return "No matching tasks.";
  return rows
    .map(
      (t) =>
        `#${t.number} ${t.title} [${t.workspace} / ${t.list}] ${statusLabel(t.status)}, ${t.assignees ?? "unassigned"}${t.dueDate ? `, due ${t.dueDate}` : ""}${t.urgent ? ", URGENT" : ""}, ${t.comments} comments, updated ${stamp(t.updatedAt).slice(0, 10)}`,
    )
    .join("\n");
}

export async function aiGetTask(viewer: CurrentUser, number: number) {
  if (!Number.isInteger(number) || number <= 0 || number > 2_147_483_647) return "No such task.";
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.number, number), inArray(tasks.workspaceId, memberWorkspaces(viewer.id))));
  if (!row) return `Task #${number} doesn't exist or isn't in your workspaces.`;
  const ctx = await taskThreadContext(viewer, row.id);
  return ctx?.text ?? `Task #${number} isn't available.`;
}

/** Recent tasks in a workspace, used to suggest defaults for a new task. */
export async function recentTaskPatterns(workspaceId: string) {
  return db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      status: tasks.status,
      list: taskLists.name,
      assignees: assigneeNamesSql,
      dueDate: tasks.dueDate,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .innerJoin(taskLists, eq(taskLists.id, tasks.taskListId))
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(tasks.createdAt))
    .limit(400);
}

