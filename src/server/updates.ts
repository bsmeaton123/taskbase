import "server-only";
import { and, desc, eq, gt, gte, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { commentPreview } from "@/components/comment-body";
import { db } from "@/db";
import {
  activities,
  comments,
  taskFollowers,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { getTimeZone, type CurrentUser } from "@/lib/session";
import {
  formatUpdateTime,
  groupUpdates,
  MAX_UPDATE_CARDS,
  summariseGroup,
  UPDATES_WINDOW_DAYS,
  type UpdateCard,
  type UpdateItem,
} from "@/lib/updates";

/** Rows read from each source (activities, comments) before grouping into cards. */
const RAW_LIMIT = 400;

type Meta = {
  taskNumber: number;
  taskTitle: string;
  workspaceId: string;
  workspaceName: string;
  workspaceColor: string;
  actorName: string | null;
  actorImage: string | null;
};

/**
 * My tasks > Updates: what other people changed or said in the last 30 days on tasks the
 * viewer follows (assignees and creators follow automatically), newest first, grouped into
 * cards. Only workspaces the viewer is still a member of, never templates or archived ones,
 * only since the viewer started following, and nothing they dismissed or cleared.
 */
export async function getUpdates(viewer: CurrentUser): Promise<UpdateCard[]> {
  const actor = alias(user, "update_actor");
  const lookback = sql.raw(`interval '${UPDATES_WINDOW_DAYS} days'`);
  const since = sql`greatest(now() - ${lookback}, coalesce((select u.updates_cleared_at from "user" u where u.id = ${viewer.id}), '-infinity'::timestamptz))`;
  const memberJoin = and(
    eq(workspaceMembers.workspaceId, tasks.workspaceId),
    eq(workspaceMembers.userId, viewer.id),
  );
  const meta = {
    taskNumber: tasks.number,
    taskTitle: tasks.title,
    workspaceId: workspaces.id,
    workspaceName: workspaces.name,
    workspaceColor: workspaces.color,
    actorName: actor.name,
    actorImage: actor.image,
  };
  const scope = and(
    eq(taskFollowers.userId, viewer.id),
    eq(workspaces.isTemplate, false),
    isNull(workspaces.archivedAt),
  );

  const [activityRows, commentRows, timeZone] = await Promise.all([
    db
      .select({
        id: activities.id,
        taskId: tasks.id,
        actorId: activities.actorId,
        kind: activities.kind,
        data: activities.data,
        createdAt: activities.createdAt,
        ...meta,
      })
      .from(taskFollowers)
      .innerJoin(tasks, eq(tasks.id, taskFollowers.taskId))
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .innerJoin(workspaceMembers, memberJoin)
      .innerJoin(activities, eq(activities.taskId, taskFollowers.taskId))
      .leftJoin(actor, eq(actor.id, activities.actorId))
      .where(
        and(
          scope,
          gt(activities.createdAt, since),
          gte(activities.createdAt, taskFollowers.createdAt),
          or(isNull(activities.actorId), ne(activities.actorId, viewer.id)),
          sql`not exists (select 1 from update_dismissals ud where ud.user_id = ${viewer.id} and ud.item_kind = 'activity' and ud.item_id = "activities"."id")`,
        ),
      )
      .orderBy(desc(activities.createdAt))
      .limit(RAW_LIMIT),
    db
      .select({
        id: comments.id,
        taskId: tasks.id,
        actorId: comments.authorId,
        body: comments.body,
        fileCount:
          sql<number>`(select count(*) from attachments att where att.comment_id = "comments"."id" and not att.draft)`.mapWith(
            Number,
          ),
        createdAt: comments.createdAt,
        ...meta,
      })
      .from(taskFollowers)
      .innerJoin(tasks, eq(tasks.id, taskFollowers.taskId))
      .innerJoin(workspaces, eq(workspaces.id, tasks.workspaceId))
      .innerJoin(workspaceMembers, memberJoin)
      .innerJoin(comments, eq(comments.taskId, taskFollowers.taskId))
      .leftJoin(actor, eq(actor.id, comments.authorId))
      .where(
        and(
          scope,
          gt(comments.createdAt, since),
          gte(comments.createdAt, taskFollowers.createdAt),
          or(isNull(comments.authorId), ne(comments.authorId, viewer.id)),
          sql`not exists (select 1 from update_dismissals ud where ud.user_id = ${viewer.id} and ud.item_kind = 'comment' and ud.item_id = "comments"."id")`,
        ),
      )
      .orderBy(desc(comments.createdAt))
      .limit(RAW_LIMIT),
    getTimeZone(),
  ]);

  const metaById = new Map<string, Meta>();
  const items: UpdateItem[] = [];
  for (const r of activityRows) {
    metaById.set(r.id, r);
    items.push({
      type: "activity",
      id: r.id,
      taskId: r.taskId,
      actorId: r.actorId,
      createdAt: r.createdAt,
      kind: r.kind,
      data: r.data,
    });
  }
  for (const r of commentRows) {
    metaById.set(r.id, r);
    items.push({
      type: "comment",
      id: r.id,
      taskId: r.taskId,
      actorId: r.actorId,
      createdAt: r.createdAt,
      excerpt: commentPreview(r.body, 200),
      fileCount: r.fileCount,
    });
  }

  // When a source hit its limit, anything older than its last row may be missing, so stop
  // there; the oldest card might then be missing its start, so drop it too.
  const cutoffs = [activityRows, commentRows]
    .filter((rows) => rows.length === RAW_LIMIT)
    .map((rows) => rows[rows.length - 1].createdAt.getTime());
  const cutoff = cutoffs.length > 0 ? Math.max(...cutoffs) : null;
  let groups = groupUpdates(
    cutoff === null ? items : items.filter((i) => i.createdAt.getTime() >= cutoff),
  );
  if (cutoff !== null) groups = groups.slice(0, -1);

  const now = new Date();
  const cards: UpdateCard[] = [];
  for (const group of groups) {
    const { verb, lines } = summariseGroup(group.items);
    // e.g. a due date moved and moved back: nothing left to say.
    if (verb === "updated" && lines.length === 0) continue;
    const newest = group.items[group.items.length - 1];
    const m = metaById.get(newest.id)!;
    cards.push({
      id: newest.id,
      task: { id: group.taskId, number: m.taskNumber, title: m.taskTitle },
      workspace: { id: m.workspaceId, name: m.workspaceName, color: m.workspaceColor },
      actor:
        group.actorId && m.actorName
          ? { id: group.actorId, name: m.actorName, image: m.actorImage }
          : null,
      verb,
      lines,
      items: group.items.map((i) => ({ kind: i.type, id: i.id })),
      at: group.at,
      time: formatUpdateTime(group.at, now, timeZone),
    });
    if (cards.length === MAX_UPDATE_CARDS) break;
  }
  return cards;
}
