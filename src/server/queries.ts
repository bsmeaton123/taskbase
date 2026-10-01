import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import {
  activities,
  attachments,
  comments,
  invites,
  notifications,
  subtasks,
  taskAssignees,
  taskDependencies,
  taskFollowers,
  tags,
  taskTags,
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
  type TaskStatus,
} from "@/db/schema";
import { getWorkspaceAccess } from "@/lib/access";
import { shiftDate } from "@/lib/dates";
import type { CurrentUser } from "@/lib/session";
import type { Recurrence } from "@/lib/recurrence";
import {
  assignedTo,
  assigneesJson,
  notAssignedTo,
  unassigned,
  type AssigneeInfo,
} from "@/server/assignees";

export type { AssigneeInfo };

export type Person = {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

export type Member = Person & { role: "owner" | "member" };

export type TaskSummary = {
  id: string;
  number: number;
  title: string;
  status: TaskStatus;
  urgent: boolean;
  startDate: string | null;
  dueDate: string | null;
  recurrence: Recurrence | null;
  position: number;
  taskListId: string;
  workspaceId: string;
  completedAt: Date | null;
  /** Everyone the task is assigned to, in the order they were added. */
  assignees: AssigneeInfo[];
  subtaskTotal: number;
  subtaskDone: number;
  commentCount: number;
  attachmentCount: number;
  /** Tasks this one waits for that aren't done yet. */
  openBlockers: number;
  tags: TagInfo[];
};

export type TagInfo = { id: string; name: string; color: string };

/** A subtask as shown inline under its task in the list. */
export type InlineSubtask = {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  dueDate: string | null;
  assignee: Pick<Person, "id" | "name" | "image"> | null;
};

const CLOSED: TaskStatus[] = ["resolved", "rejected"];

const summaryColumns = {
  id: tasks.id,
  number: tasks.number,
  title: tasks.title,
  status: tasks.status,
  urgent: tasks.urgent,
  startDate: tasks.startDate,
  dueDate: tasks.dueDate,
  recurrence: tasks.recurrence,
  position: tasks.position,
  taskListId: tasks.taskListId,
  workspaceId: tasks.workspaceId,
  completedAt: tasks.completedAt,
  // Correlated subqueries use explicit aliases: Drizzle leaves column names
  // unqualified in single-table selects, which would make "id" ambiguous.
  assignees: assigneesJson,
  subtaskTotal: sql<number>`(select count(*) from subtasks s where s.task_id = "tasks"."id")`.mapWith(
    Number,
  ),
  subtaskDone:
    sql<number>`(select count(*) from subtasks s where s.task_id = "tasks"."id" and s.done)`.mapWith(
      Number,
    ),
  commentCount:
    sql<number>`(select count(*) from comments c where c.task_id = "tasks"."id")`.mapWith(Number),
  attachmentCount:
    sql<number>`(select count(*) from attachments a where a.task_id = "tasks"."id" and not a.draft)`.mapWith(
      Number,
    ),
  openBlockers:
    sql<number>`(select count(*) from task_dependencies d join tasks b on b.id = d.depends_on_id where d.task_id = "tasks"."id" and b.status not in ('resolved', 'rejected'))`.mapWith(
      Number,
    ),
  tags: sql<TagInfo[]>`coalesce((select json_agg(json_build_object('id', tg.id, 'name', tg.name, 'color', tg.color) order by lower(tg.name)) from task_tags tt join tags tg on tg.id = tt.tag_id where tt.task_id = "tasks"."id"), '[]'::json)`,
};

type SummaryRow = { [K in keyof typeof summaryColumns]: unknown };

function toSummary(row: SummaryRow): TaskSummary {
  return row as TaskSummary;
}

/* -------------------------------------------------------------------------- */
/* Sidebar                                                                     */
/* -------------------------------------------------------------------------- */

export async function getSidebarData(viewer: CurrentUser) {
  const [myWorkspaces, [{ unread }], [{ mine }]] = await Promise.all([
    db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        color: workspaces.color,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.userId, viewer.id),
          isNull(workspaces.archivedAt),
          eq(workspaces.isTemplate, false),
        ),
      )
      .orderBy(asc(sql`lower(${workspaces.name})`)),
    db
      .select({ unread: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, viewer.id),
          isNull(notifications.readAt),
          viewer.isAdmin
            ? undefined
            : sql`(${notifications.workspaceId} is null or exists (select 1 from workspace_members wm where wm.workspace_id = ${notifications.workspaceId} and wm.user_id = ${viewer.id}))`,
        ),
      ),
    db
      .select({ mine: count() })
      .from(tasks)
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, tasks.workspaceId),
          eq(workspaceMembers.userId, viewer.id),
        ),
      )
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .where(
        and(
          assignedTo(viewer.id),
          notInArray(tasks.status, CLOSED),
          isNull(workspaces.archivedAt),
          eq(workspaces.isTemplate, false),
        ),
      ),
  ]);
  return { workspaces: myWorkspaces, unread, myOpenCount: mine };
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                   */
/* -------------------------------------------------------------------------- */

export async function getWorkspaceMembers(workspaceId: string): Promise<Member[]> {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${user.name})`));
}

/** A workspace's tags with how many tasks use each. Callers check access. */
export async function getWorkspaceTags(workspaceId: string) {
  return db
    .select({
      id: tags.id,
      name: tags.name,
      color: tags.color,
      count: sql<number>`(select count(*) from task_tags c where c.tag_id = "tags"."id")`.mapWith(Number),
    })
    .from(tags)
    .where(eq(tags.workspaceId, workspaceId))
    .orderBy(asc(sql`lower(${tags.name})`));
}

export type WorkspaceFilters = {
  show: "open" | "all" | "closed";
  assignee: "anyone" | "me" | "unassigned" | (string & {});
  /** Only tasks with this tag. */
  tag?: string | null;
};

export async function getWorkspacePage(
  viewer: CurrentUser,
  workspaceId: string,
  filters: WorkspaceFilters,
) {
  const access = await getWorkspaceAccess(viewer, workspaceId);
  if (!access) return null;

  const conditions: SQL[] = [eq(tasks.workspaceId, workspaceId)];
  if (filters.show === "open") conditions.push(notInArray(tasks.status, CLOSED));
  if (filters.show === "closed") conditions.push(inArray(tasks.status, CLOSED));
  if (filters.tag)
    conditions.push(
      sql`exists (select 1 from task_tags ft where ft.task_id = "tasks"."id" and ft.tag_id = ${filters.tag})`,
    );
  // A task matches when any of its assignees does; "unassigned" means it has none.
  if (filters.assignee === "me") conditions.push(assignedTo(viewer.id));
  else if (filters.assignee === "unassigned") conditions.push(unassigned);
  else if (filters.assignee !== "anyone") conditions.push(assignedTo(filters.assignee));

  const blocked = alias(tasks, "blocked_task");
  const subAssignee = alias(user, "inline_sub_assignee");
  const [members, lists, rows, [{ closedCount }], dependencies, workspaceTags, subRows] = await Promise.all([
    getWorkspaceMembers(workspaceId),
    db
      .select()
      .from(taskLists)
      .where(eq(taskLists.workspaceId, workspaceId))
      .orderBy(asc(taskLists.position), asc(taskLists.createdAt)),
    db
      .select(summaryColumns)
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.position), asc(tasks.createdAt)),
    db
      .select({ closedCount: count() })
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, workspaceId), inArray(tasks.status, CLOSED)),
      ),
    db
      .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
      .from(taskDependencies)
      .innerJoin(blocked, eq(blocked.id, taskDependencies.taskId))
      .where(eq(blocked.workspaceId, workspaceId)),
    getWorkspaceTags(workspaceId),
    db
      .select({
        id: subtasks.id,
        taskId: subtasks.taskId,
        title: subtasks.title,
        done: subtasks.done,
        dueDate: subtasks.dueDate,
        assigneeId: subtasks.assigneeId,
        assigneeName: subAssignee.name,
        assigneeImage: subAssignee.image,
      })
      .from(subtasks)
      .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
      .leftJoin(subAssignee, eq(subAssignee.id, subtasks.assigneeId))
      .where(and(...conditions))
      .orderBy(asc(subtasks.position), asc(subtasks.createdAt)),
  ]);

  const inlineSubtasks: InlineSubtask[] = subRows.map((r) => ({
    id: r.id,
    taskId: r.taskId,
    title: r.title,
    done: r.done,
    dueDate: r.dueDate,
    assignee:
      r.assigneeId && r.assigneeName
        ? { id: r.assigneeId, name: r.assigneeName, image: r.assigneeImage }
        : null,
  }));

  return {
    access,
    members,
    lists,
    tasks: rows.map((r) => toSummary(r as SummaryRow)),
    closedCount,
    dependencies,
    tags: workspaceTags,
    subtasks: inlineSubtasks,
  };
}

/* -------------------------------------------------------------------------- */
/* Task detail                                                                 */
/* -------------------------------------------------------------------------- */

export type AttachmentInfo = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  createdAt: Date;
  commentId: string | null;
  uploader: Pick<Person, "id" | "name"> | null;
};

export type FeedItem =
  | {
      type: "comment";
      id: string;
      createdAt: Date;
      editedAt: Date | null;
      body: string;
      author: Pick<Person, "id" | "name" | "image"> | null;
      attachments: AttachmentInfo[];
    }
  | {
      type: "activity";
      id: string;
      createdAt: Date;
      kind: typeof activities.$inferSelect.kind;
      data: Record<string, string | number | boolean | null>;
      actor: Pick<Person, "id" | "name" | "image"> | null;
    };

export async function getTaskDetail(viewer: CurrentUser, taskId: string) {
  const creator = alias(user, "creator_user");
  const [row] = await db
    .select({
      task: tasks,
      listName: taskLists.name,
      workspaceName: workspaces.name,
      workspaceColor: workspaces.color,
      creatorName: creator.name,
    })
    .from(tasks)
    .innerJoin(taskLists, eq(taskLists.id, tasks.taskListId))
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .leftJoin(creator, eq(creator.id, tasks.createdById))
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!row) return null;

  const access = await getWorkspaceAccess(viewer, row.task.workspaceId);
  if (!access) return null;

  const subAssignee = alias(user, "sub_assignee");
  const author = alias(user, "author_user");
  const actor = alias(user, "actor_user");

  const uploader = alias(user, "uploader_user");
  const [subtaskRows, commentRows, activityRows, followerRows, members, lists, fileRows] =
    await Promise.all([
      db
        .select({
          id: subtasks.id,
          title: subtasks.title,
          done: subtasks.done,
          dueDate: subtasks.dueDate,
          position: subtasks.position,
          assigneeId: subtasks.assigneeId,
          assigneeName: subAssignee.name,
          assigneeImage: subAssignee.image,
        })
        .from(subtasks)
        .leftJoin(subAssignee, eq(subAssignee.id, subtasks.assigneeId))
        .where(eq(subtasks.taskId, taskId))
        .orderBy(asc(subtasks.position), asc(subtasks.createdAt)),
      db
        .select({
          id: comments.id,
          body: comments.body,
          createdAt: comments.createdAt,
          editedAt: comments.editedAt,
          authorId: comments.authorId,
          authorName: author.name,
          authorImage: author.image,
        })
        .from(comments)
        .leftJoin(author, eq(author.id, comments.authorId))
        .where(eq(comments.taskId, taskId))
        .orderBy(asc(comments.createdAt)),
      db
        .select({
          id: activities.id,
          kind: activities.kind,
          data: activities.data,
          createdAt: activities.createdAt,
          actorId: activities.actorId,
          actorName: actor.name,
          actorImage: actor.image,
        })
        .from(activities)
        .where(eq(activities.taskId, taskId))
        .leftJoin(actor, eq(actor.id, activities.actorId))
        .orderBy(asc(activities.createdAt)),
      db
        .select({ userId: taskFollowers.userId })
        .from(taskFollowers)
        .where(eq(taskFollowers.taskId, taskId)),
      getWorkspaceMembers(row.task.workspaceId),
      db
        .select({ id: taskLists.id, name: taskLists.name })
        .from(taskLists)
        .where(eq(taskLists.workspaceId, row.task.workspaceId))
        .orderBy(asc(taskLists.position), asc(taskLists.createdAt)),
      db
        .select({
          id: attachments.id,
          name: attachments.name,
          size: attachments.size,
          contentType: attachments.contentType,
          createdAt: attachments.createdAt,
          commentId: attachments.commentId,
          uploaderId: attachments.uploaderId,
          uploaderName: uploader.name,
        })
        .from(attachments)
        .leftJoin(uploader, eq(uploader.id, attachments.uploaderId))
        .where(and(eq(attachments.taskId, taskId), eq(attachments.draft, false)))
        .orderBy(asc(attachments.createdAt)),
    ]);

  const files: AttachmentInfo[] = fileRows.map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size,
    contentType: f.contentType,
    createdAt: f.createdAt,
    commentId: f.commentId,
    uploader: f.uploaderId && f.uploaderName ? { id: f.uploaderId, name: f.uploaderName } : null,
  }));

  const linkColumns = {
    id: tasks.id,
    number: tasks.number,
    title: tasks.title,
    status: tasks.status,
    dueDate: tasks.dueDate,
  };
  const [blockedBy, blocking, taskTagRows, workspaceTagRows, assigneeRows] = await Promise.all([
    db
      .select(linkColumns)
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.dependsOnId))
      .where(and(eq(taskDependencies.taskId, taskId), eq(tasks.workspaceId, row.task.workspaceId)))
      .orderBy(asc(tasks.number)),
    db
      .select(linkColumns)
      .from(taskDependencies)
      .innerJoin(tasks, eq(tasks.id, taskDependencies.taskId))
      .where(and(eq(taskDependencies.dependsOnId, taskId), eq(tasks.workspaceId, row.task.workspaceId)))
      .orderBy(asc(tasks.number)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(eq(taskTags.taskId, taskId))
      .orderBy(asc(sql`lower(${tags.name})`)),
    db
      .select({ id: tags.id, name: tags.name, color: tags.color })
      .from(tags)
      .where(eq(tags.workspaceId, row.task.workspaceId))
      .orderBy(asc(sql`lower(${tags.name})`)),
    db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(taskAssignees)
      .innerJoin(user, eq(user.id, taskAssignees.userId))
      .where(eq(taskAssignees.taskId, taskId))
      .orderBy(asc(taskAssignees.createdAt), asc(sql`lower(${user.name})`)),
  ]);

  const feed: FeedItem[] = [
    ...commentRows.map(
      (c): FeedItem => ({
        type: "comment",
        id: c.id,
        createdAt: c.createdAt,
        editedAt: c.editedAt,
        body: c.body,
        author:
          c.authorId && c.authorName
            ? { id: c.authorId, name: c.authorName, image: c.authorImage }
            : null,
        attachments: files.filter((f) => f.commentId === c.id),
      }),
    ),
    ...activityRows.map(
      (a): FeedItem => ({
        type: "activity",
        id: a.id,
        createdAt: a.createdAt,
        kind: a.kind,
        data: a.data,
        actor:
          a.actorId && a.actorName
            ? { id: a.actorId, name: a.actorName, image: a.actorImage }
            : null,
      }),
    ),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    task: row.task,
    access,
    list: { id: row.task.taskListId, name: row.listName },
    workspace: {
      id: row.task.workspaceId,
      name: row.workspaceName,
      color: row.workspaceColor,
    },
    /** Everyone the task is assigned to, in the order they were added. */
    assignees: assigneeRows satisfies AssigneeInfo[],
    creatorName: row.creatorName,
    subtasks: subtaskRows.map((s) => ({
      id: s.id,
      title: s.title,
      done: s.done,
      dueDate: s.dueDate,
      assignee:
        s.assigneeId && s.assigneeName
          ? { id: s.assigneeId, name: s.assigneeName, image: s.assigneeImage }
          : null,
    })),
    feed,
    files,
    commentCount: commentRows.length,
    following: followerRows.some((f) => f.userId === viewer.id),
    followerCount: followerRows.length,
    members,
    lists,
    /** Tasks this one waits for, and tasks waiting for this one. */
    blockedBy,
    blocking,
    tags: taskTagRows,
    workspaceTags: workspaceTagRows,
  };
}

export type TaskDetail = NonNullable<Awaited<ReturnType<typeof getTaskDetail>>>;

/* -------------------------------------------------------------------------- */
/* My tasks                                                                    */
/* -------------------------------------------------------------------------- */

export type MyTask = TaskSummary & {
  workspace: { id: string; name: string; color: string };
  /** Shown under the row when expanded. */
  subtasks?: InlineSubtask[];
};

/** Subtasks for a set of tasks the caller has already scoped to the viewer. */
async function loadInlineSubtasks(taskIds: string[]): Promise<Map<string, InlineSubtask[]>> {
  const map = new Map<string, InlineSubtask[]>();
  if (taskIds.length === 0) return map;
  const subAssignee = alias(user, "inline_sub_assignee");
  const rows = await db
    .select({
      id: subtasks.id,
      taskId: subtasks.taskId,
      title: subtasks.title,
      done: subtasks.done,
      dueDate: subtasks.dueDate,
      assigneeId: subtasks.assigneeId,
      assigneeName: subAssignee.name,
      assigneeImage: subAssignee.image,
    })
    .from(subtasks)
    .leftJoin(subAssignee, eq(subAssignee.id, subtasks.assigneeId))
    .where(inArray(subtasks.taskId, taskIds))
    .orderBy(asc(subtasks.position), asc(subtasks.createdAt));
  for (const r of rows) {
    const sub: InlineSubtask = {
      id: r.id,
      taskId: r.taskId,
      title: r.title,
      done: r.done,
      dueDate: r.dueDate,
      assignee:
        r.assigneeId && r.assigneeName
          ? { id: r.assigneeId, name: r.assigneeName, image: r.assigneeImage }
          : null,
    };
    const list = map.get(r.taskId);
    if (list) list.push(sub);
    else map.set(r.taskId, [sub]);
  }
  return map;
}

export async function getMyTasks(viewer: CurrentUser, show: "open" | "closed") {
  const memberJoin = and(
    eq(workspaceMembers.workspaceId, tasks.workspaceId),
    eq(workspaceMembers.userId, viewer.id),
  );
  const statusFilter =
    show === "open"
      ? notInArray(tasks.status, CLOSED)
      : inArray(tasks.status, CLOSED);

  const [rows, subtaskRows] = await Promise.all([
    db
      .select({
        ...summaryColumns,
        wsName: workspaces.name,
        wsColor: workspaces.color,
      })
      .from(tasks)
      .innerJoin(workspaceMembers, memberJoin)
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .where(
        and(
          assignedTo(viewer.id),
          statusFilter,
          isNull(workspaces.archivedAt),
          eq(workspaces.isTemplate, false),
        ),
      )
      .orderBy(
        sql`${tasks.dueDate} asc nulls last`,
        show === "closed" ? desc(tasks.completedAt) : asc(tasks.createdAt),
      )
      .limit(show === "closed" ? 100 : 500),
    show === "open"
      ? db
          .select({
            id: subtasks.id,
            title: subtasks.title,
            dueDate: subtasks.dueDate,
            taskId: tasks.id,
            taskNumber: tasks.number,
            taskTitle: tasks.title,
            workspaceId: workspaces.id,
            workspaceName: workspaces.name,
            workspaceColor: workspaces.color,
          })
          .from(subtasks)
          .innerJoin(tasks, eq(tasks.id, subtasks.taskId))
          .innerJoin(workspaceMembers, memberJoin)
          .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
          .where(
            and(
              eq(subtasks.assigneeId, viewer.id),
              eq(subtasks.done, false),
              notInArray(tasks.status, CLOSED),
              isNull(workspaces.archivedAt),
              eq(workspaces.isTemplate, false),
              // The whole task is already listed when it's assigned to the viewer.
              notAssignedTo(viewer.id),
            ),
          )
          .orderBy(sql`${subtasks.dueDate} asc nulls last`, asc(subtasks.createdAt))
      : Promise.resolve([]),
  ]);

  const inline = await loadInlineSubtasks(rows.filter((r) => r.subtaskTotal > 0).map((r) => r.id));
  const myTasks: MyTask[] = rows.map((r) => {
    const { wsName, wsColor, ...rest } = r;
    const summary = toSummary(rest as SummaryRow);
    return {
      ...summary,
      workspace: { id: summary.workspaceId, name: wsName, color: wsColor },
      subtasks: inline.get(summary.id),
    };
  });

  return { tasks: myTasks, subtasks: subtaskRows };
}

/* -------------------------------------------------------------------------- */
/* Inbox                                                                       */
/* -------------------------------------------------------------------------- */

export async function getInbox(viewer: CurrentUser, filter: "unread" | "all") {
  const actor = alias(user, "notif_actor");
  return db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      data: notifications.data,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      taskId: notifications.taskId,
      taskNumber: tasks.number,
      taskTitle: tasks.title,
      workspaceId: notifications.workspaceId,
      workspaceName: workspaces.name,
      workspaceColor: workspaces.color,
      commentBody: comments.body,
      actorId: notifications.actorId,
      actorName: actor.name,
      actorImage: actor.image,
    })
    .from(notifications)
    .leftJoin(tasks, eq(tasks.id, notifications.taskId))
    .leftJoin(workspaces, eq(workspaces.id, notifications.workspaceId))
    .leftJoin(comments, eq(comments.id, notifications.commentId))
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .where(
      and(
        eq(notifications.userId, viewer.id),
        filter === "unread" ? isNull(notifications.readAt) : undefined,
        // Hide items from workspaces the viewer has since lost access to.
        viewer.isAdmin
          ? undefined
          : sql`(${notifications.workspaceId} is null or exists (select 1 from workspace_members wm where wm.workspace_id = ${notifications.workspaceId} and wm.user_id = ${viewer.id}))`,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(200);
}

export type InboxItem = Awaited<ReturnType<typeof getInbox>>[number];

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

export async function searchTasks(viewer: CurrentUser, query: string) {
  const q = query.trim();
  if (!q) return [];
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const numberMatch = /^#?(\d{1,9})$/.exec(q);

  const rows = await db
    .select({
      ...summaryColumns,
      wsName: workspaces.name,
      wsColor: workspaces.color,
    })
    .from(tasks)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, tasks.workspaceId),
        eq(workspaceMembers.userId, viewer.id),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .where(
      and(
        eq(workspaces.isTemplate, false),
        or(
          ilike(tasks.title, pattern),
          ilike(tasks.description, pattern),
          numberMatch ? eq(tasks.number, Number(numberMatch[1])) : undefined,
          sql`exists (select 1 from comments c where c.task_id = "tasks"."id" and c.body ilike ${pattern})`,
          sql`exists (select 1 from subtasks s where s.task_id = "tasks"."id" and s.title ilike ${pattern})`,
          sql`exists (select 1 from task_tags tt join tags tg on tg.id = tt.tag_id where tt.task_id = "tasks"."id" and tg.name ilike ${pattern})`,
        ),
      ),
    )
    .orderBy(
      sql`case when ${tasks.status} in ('resolved','rejected') then 1 else 0 end`,
      desc(tasks.updatedAt),
    )
    .limit(60);

  return rows.map((r): MyTask => {
    const { wsName, wsColor, ...rest } = r;
    const summary = toSummary(rest as SummaryRow);
    return {
      ...summary,
      workspace: { id: summary.workspaceId, name: wsName, color: wsColor },
    };
  });
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export async function getAllPeople() {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
      workspaceCount:
        sql<number>`(select count(*) from workspace_members wm where wm.user_id = "user"."id")`.mapWith(
          Number,
        ),
      openTaskCount:
        sql<number>`(select count(*) from task_assignees ta join tasks t on t.id = ta.task_id join workspaces w on w.id = t.workspace_id where ta.user_id = "user"."id" and t.status not in ('resolved','rejected') and w.archived_at is null and not w.is_template)`.mapWith(
          Number,
        ),
    })
    .from(user)
    .orderBy(asc(sql`lower(${user.name})`));
}

export async function getActivePeople(): Promise<Person[]> {
  return db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(or(isNull(user.banned), eq(user.banned, false)))
    .orderBy(asc(sql`lower(${user.name})`));
}

/** Workspaces the viewer is not a member of (admins only). */
export async function getOtherWorkspaces(viewer: CurrentUser) {
  if (!viewer.isAdmin) return [];
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      color: workspaces.color,
      archivedAt: workspaces.archivedAt,
      memberCount:
        sql<number>`(select count(*) from workspace_members wm where wm.workspace_id = "workspaces"."id")`.mapWith(
          Number,
        ),
    })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.isTemplate, false),
        sql`not exists (select 1 from workspace_members wm where wm.workspace_id = "workspaces"."id" and wm.user_id = ${viewer.id})`,
      ),
    )
    .orderBy(asc(sql`lower(${workspaces.name})`));
}

/** The viewer's active workspaces with a sense of size: open and overdue tasks, members. */
export async function getMyWorkspaceOverview(viewer: CurrentUser, today: string) {
  const openTasks = (extra = sql``) =>
    sql<number>`(select count(*) from tasks t where t.workspace_id = "workspaces"."id" and t.status not in ('resolved', 'rejected') ${extra})`.mapWith(Number);
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      color: workspaces.color,
      description: workspaces.description,
      open: openTasks(),
      overdue: openTasks(sql`and t.due_date < ${today}`),
      members:
        sql<number>`(select count(*) from workspace_members wm where wm.workspace_id = "workspaces"."id")`.mapWith(
          Number,
        ),
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, viewer.id),
        isNull(workspaces.archivedAt),
        eq(workspaces.isTemplate, false),
      ),
    )
    .orderBy(asc(sql`lower(${workspaces.name})`));
}

export async function getArchivedWorkspaces(viewer: CurrentUser) {
  return db
    .select({ id: workspaces.id, name: workspaces.name, color: workspaces.color })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, viewer.id),
        eq(workspaces.isTemplate, false),
        sql`${workspaces.archivedAt} is not null`,
      ),
    )
    .orderBy(asc(sql`lower(${workspaces.name})`));
}

export async function getPendingInvites() {
  const creator = alias(user, "invite_creator");
  return db
    .select({
      id: invites.id,
      token: invites.token,
      email: invites.email,
      role: invites.role,
      expiresAt: invites.expiresAt,
      createdAt: invites.createdAt,
      createdByName: creator.name,
    })
    .from(invites)
    .leftJoin(creator, eq(creator.id, invites.createdById))
    .where(and(isNull(invites.usedAt), gt(invites.expiresAt, new Date())))
    .orderBy(desc(invites.createdAt));
}

/** Every template in the organisation, with a little context for picking one. */
export async function getTemplates(viewer: CurrentUser) {
  const creator = alias(user, "template_creator");
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      description: workspaces.description,
      color: workspaces.color,
      createdByName: creator.name,
      listCount:
        sql<number>`(select count(*) from task_lists l where l.workspace_id = "workspaces"."id")`.mapWith(
          Number,
        ),
      taskCount:
        sql<number>`(select count(*) from tasks t where t.workspace_id = "workspaces"."id")`.mapWith(
          Number,
        ),
      isMember: sql<boolean>`exists (select 1 from workspace_members wm where wm.workspace_id = "workspaces"."id" and wm.user_id = ${viewer.id})`,
    })
    .from(workspaces)
    .leftJoin(creator, eq(creator.id, workspaces.createdById))
    .where(eq(workspaces.isTemplate, true))
    .orderBy(asc(sql`lower(${workspaces.name})`));
  return rows.map((r) => ({ ...r, canEdit: r.isMember || viewer.isAdmin }));
}

export type TemplateSummary = Awaited<ReturnType<typeof getTemplates>>[number];

/* -------------------------------------------------------------------------- */
/* Team: tasks by person                                                       */
/* -------------------------------------------------------------------------- */

export type Teammate = Person & {
  open: number;
  overdue: number;
  dueSoon: number;
  /** Workspaces the viewer shares with this person. */
  sharedWorkspaces: number;
};

/**
 * Everyone the viewer shares a workspace with (admins: everyone), with their open task
 * counts. Counts only include tasks in workspaces the viewer can see, so nothing leaks
 * from private workspaces. `today` is the viewer's local date.
 */
export async function getTeam(viewer: CurrentUser, today: string): Promise<Teammate[]> {
  const visible = viewer.isAdmin
    ? sql`select w.id from workspaces w where w.is_template = false and w.archived_at is null`
    : sql`select w.id from workspaces w join workspace_members vm on vm.workspace_id = w.id and vm.user_id = ${viewer.id} where w.is_template = false and w.archived_at is null`;
  const soon = shiftDate(today, 7);
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
      // A task with several assignees counts for each of them.
      open: sql<number>`(select count(*) from task_assignees ta join tasks t on t.id = ta.task_id where ta.user_id = "user"."id" and t.status not in ('resolved','rejected') and t.workspace_id in (${visible}))`.mapWith(Number),
      overdue:
        sql<number>`(select count(*) from task_assignees ta join tasks t on t.id = ta.task_id where ta.user_id = "user"."id" and t.status not in ('resolved','rejected') and t.due_date < ${today} and t.workspace_id in (${visible}))`.mapWith(
          Number,
        ),
      dueSoon:
        sql<number>`(select count(*) from task_assignees ta join tasks t on t.id = ta.task_id where ta.user_id = "user"."id" and t.status not in ('resolved','rejected') and t.due_date >= ${today} and t.due_date <= ${soon} and t.workspace_id in (${visible}))`.mapWith(
          Number,
        ),
      sharedWorkspaces:
        sql<number>`(select count(*) from workspace_members m where m.user_id = "user"."id" and m.workspace_id in (${visible}))`.mapWith(
          Number,
        ),
    })
    .from(user)
    .where(
      and(
        or(isNull(user.banned), eq(user.banned, false)),
        viewer.isAdmin
          ? undefined
          : sql`exists (select 1 from workspace_members m where m.user_id = "user"."id" and m.workspace_id in (${visible}))`,
      ),
    )
    .orderBy(asc(sql`lower(${user.name})`));
}

/** One person's tasks, limited to workspaces the viewer can see. */
export async function getPersonTasks(
  viewer: CurrentUser,
  personId: string,
  show: "open" | "closed",
) {
  const [person] = await db
    .select({ id: user.id, name: user.name, email: user.email, image: user.image, banned: user.banned })
    .from(user)
    .where(eq(user.id, personId));
  if (!person) return null;

  const viewerMember = alias(workspaceMembers, "viewer_member");
  const conditions = [
    assignedTo(personId),
    show === "open" ? notInArray(tasks.status, CLOSED) : inArray(tasks.status, CLOSED),
    isNull(workspaces.archivedAt),
    eq(workspaces.isTemplate, false),
  ];
  let query = db
    .select({ ...summaryColumns, wsName: workspaces.name, wsColor: workspaces.color })
    .from(tasks)
    .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
    .$dynamic();
  if (!viewer.isAdmin)
    query = query.innerJoin(
      viewerMember,
      and(eq(viewerMember.workspaceId, tasks.workspaceId), eq(viewerMember.userId, viewer.id)),
    );
  const rows = await query
    .where(and(...conditions))
    .orderBy(
      sql`${tasks.dueDate} asc nulls last`,
      show === "closed" ? desc(tasks.completedAt) : asc(tasks.createdAt),
    )
    .limit(show === "closed" ? 100 : 500);

  const inline = await loadInlineSubtasks(rows.filter((r) => r.subtaskTotal > 0).map((r) => r.id));
  const personTasks: MyTask[] = rows.map((r) => {
    const { wsName, wsColor, ...rest } = r;
    const summary = toSummary(rest as SummaryRow);
    return {
      ...summary,
      workspace: { id: summary.workspaceId, name: wsName, color: wsColor },
      subtasks: inline.get(summary.id),
    };
  });
  return { person, tasks: personTasks };
}

/* -------------------------------------------------------------------------- */
/* Team workload                                                               */
/* -------------------------------------------------------------------------- */

export type WorkloadTask = {
  id: string;
  number: number;
  title: string;
  workspaceId: string;
  status: TaskStatus;
  urgent: boolean;
  startDate: string | null;
  dueDate: string | null;
  assigneeIds: string[];
};

export type WorkloadPerson = Person & {
  /** Workspaces (of those the viewer can see) this person is a member of: where they can take work. */
  workspaceIds: string[];
};

export type Workload = {
  people: WorkloadPerson[];
  workspaces: { id: string; name: string; color: string }[];
  tasks: WorkloadTask[];
  /**
   * How many undated tasks each row has in all (person id, or UNASSIGNED). Only a preview of
   * them is in `tasks`; the grid shows "+N more" for the rest.
   */
  undatedTotal: Record<string, number>;
};

/**
 * The workload grid for one week: everyone who shares a workspace with the viewer (admins:
 * everyone in any workspace), with their open tasks that are overdue, due that week, or
 * undated. Scoped like getTeam: only workspaces the viewer can see, never templates or
 * archived ones. Undated tasks are trimmed to a preview per row, newest first.
 */
export async function getWorkload(
  viewer: CurrentUser,
  weekStart: string,
  today: string,
): Promise<Workload> {
  const weekEnd = shiftDate(weekStart, 6);
  const liveWorkspace = and(eq(workspaces.isTemplate, false), isNull(workspaces.archivedAt));
  const columns = { id: workspaces.id, name: workspaces.name, color: workspaces.color };
  const visible = await (viewer.isAdmin
    ? db.select(columns).from(workspaces).where(liveWorkspace)
    : db
        .select(columns)
        .from(workspaces)
        .innerJoin(
          workspaceMembers,
          and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, viewer.id)),
        )
        .where(liveWorkspace)
  ).orderBy(asc(sql`lower(${workspaces.name})`));
  const wsIds = visible.map((w) => w.id);
  if (wsIds.length === 0) return { people: [], workspaces: [], tasks: [], undatedTotal: {} };

  const active = or(isNull(user.banned), eq(user.banned, false));
  const memberships = await db
    .select({ userId: workspaceMembers.userId, workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(and(inArray(workspaceMembers.workspaceId, wsIds), active));
  const byPerson = new Map<string, string[]>();
  for (const m of memberships) byPerson.set(m.userId, [...(byPerson.get(m.userId) ?? []), m.workspaceId]);

  const [peopleRows, taskRows] = await Promise.all([
    byPerson.size
      ? db
          .select({ id: user.id, name: user.name, email: user.email, image: user.image })
          .from(user)
          .where(inArray(user.id, [...byPerson.keys()]))
          .orderBy(asc(sql`lower(${user.name})`))
      : [],
    db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        workspaceId: tasks.workspaceId,
        status: tasks.status,
        urgent: tasks.urgent,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
        assigneeIds: sql<
          string[]
        >`coalesce((select json_agg(ta.user_id order by ta.created_at) from task_assignees ta where ta.task_id = "tasks"."id"), '[]'::json)`,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.workspaceId, wsIds),
          notInArray(tasks.status, CLOSED),
          or(
            isNull(tasks.dueDate),
            sql`"tasks"."due_date" < ${today}`,
            sql`"tasks"."due_date" between ${weekStart} and ${weekEnd}`,
          ),
        ),
      )
      .orderBy(sql`"tasks"."due_date" asc nulls last`, desc(tasks.urgent), desc(tasks.number))
      .limit(5000),
  ]);

  const people = peopleRows.map((p) => ({ ...p, workspaceIds: byPerson.get(p.id) ?? [] }));
  const shown = new Set(people.map((p) => p.id));

  // Undated work can run to hundreds of tasks: keep a preview per row and count the rest.
  const PREVIEW = 3;
  const kept = new Map<string, number>();
  const undatedTotal: Record<string, number> = {};
  const result: WorkloadTask[] = [];
  for (const t of taskRows) {
    const rows = t.assigneeIds.length
      ? t.assigneeIds.filter((id) => shown.has(id))
      : ["unassigned"];
    if (rows.length === 0) continue; // only on deactivated people's plates
    if (t.dueDate) {
      result.push(t);
      continue;
    }
    let keep = false;
    for (const r of rows) {
      undatedTotal[r] = (undatedTotal[r] ?? 0) + 1;
      const n = kept.get(r) ?? 0;
      if (n < PREVIEW) {
        kept.set(r, n + 1);
        keep = true;
      }
    }
    if (keep) result.push(t);
  }
  return { people, workspaces: visible, tasks: result, undatedTotal };
}
