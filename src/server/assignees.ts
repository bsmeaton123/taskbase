import "server-only";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { activities, taskAssignees, user } from "@/db/schema";
import { activeMemberIds, type Executor } from "@/server/events";

/*
 * A task can have any number of assignees (task_assignees), listed in the order they
 * were added. Only active members of the task's workspace can be assignees.
 */

export type AssigneeInfo = { id: string; name: string; image: string | null };

/**
 * A task's assignees as JSON, in the order they were added. Use in selects from "tasks"
 * (the real table name, not an alias): loads them in the same query, no extra round trip.
 */
export const assigneesJson = sql<AssigneeInfo[]>`coalesce((select json_agg(json_build_object('id', au.id, 'name', au.name, 'image', au.image) order by ta.created_at, lower(au.name)) from task_assignees ta join "user" au on au.id = ta.user_id where ta.task_id = "tasks"."id"), '[]'::json)`;

/** Assignees' names joined with commas ("Priya Raman, Sam Ortiz"), or null. Selects from "tasks". */
export const assigneeNamesSql = sql<
  string | null
>`(select string_agg(au.name, ', ' order by ta.created_at, lower(au.name)) from task_assignees ta join "user" au on au.id = ta.user_id where ta.task_id = "tasks"."id")`;

/** Assignees' names as an array, in order. Selects from "tasks". */
export const assigneeNameListSql = sql<string[]>`coalesce((select json_agg(au.name order by ta.created_at, lower(au.name)) from task_assignees ta join "user" au on au.id = ta.user_id where ta.task_id = "tasks"."id"), '[]'::json)`;

/** Condition: this person is one of the task's assignees. */
export const assignedTo = (userId: string) =>
  sql`exists (select 1 from task_assignees ta where ta.task_id = "tasks"."id" and ta.user_id = ${userId})`;

/** Condition: this person is not one of the task's assignees. */
export const notAssignedTo = (userId: string) =>
  sql`not exists (select 1 from task_assignees ta where ta.task_id = "tasks"."id" and ta.user_id = ${userId})`;

/** Condition: nobody is assigned. */
export const unassigned = sql`not exists (select 1 from task_assignees ta where ta.task_id = "tasks"."id")`;

const unique = (ids: (string | null | undefined)[]) => [
  ...new Set(ids.filter((id): id is string => Boolean(id))),
];

/** Assignee ids per task, in the order they were added. */
export async function getAssigneeMap(tx: Executor, taskIds: string[]) {
  const map = new Map<string, string[]>();
  if (taskIds.length === 0) return map;
  const rows = await tx
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
    .from(taskAssignees)
    .innerJoin(user, eq(user.id, taskAssignees.userId))
    .where(inArray(taskAssignees.taskId, taskIds))
    .orderBy(asc(taskAssignees.createdAt), asc(sql`lower(${user.name})`));
  for (const r of rows) map.set(r.taskId, [...(map.get(r.taskId) ?? []), r.userId]);
  return map;
}

export async function getAssigneeIds(tx: Executor, taskId: string) {
  return (await getAssigneeMap(tx, [taskId])).get(taskId) ?? [];
}

/**
 * Adds people to tasks, keeping the given order, and skips anyone already on a task.
 * Callers check that everyone is an active member of the workspace. Returns what changed.
 */
export async function insertAssignees(
  tx: Executor,
  entries: { taskId: string; userIds: (string | null | undefined)[] }[],
) {
  const rows = entries.flatMap((e) =>
    unique(e.userIds).map((userId, i) => ({
      taskId: e.taskId,
      userId,
      // Same transaction means the same now(): nudge each one so the order sticks.
      createdAt: sql`now() + ${`${i} milliseconds`}::interval`,
    })),
  );
  const added: { taskId: string; userId: string }[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    added.push(
      ...(await tx
        .insert(taskAssignees)
        .values(rows.slice(i, i + 500))
        .onConflictDoNothing()
        .returning({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })),
    );
  }
  return added;
}

/** Takes people off tasks. Returns what changed. */
export async function deleteAssignees(tx: Executor, taskIds: string[], userIds: string[]) {
  if (taskIds.length === 0 || userIds.length === 0) return [];
  return tx
    .delete(taskAssignees)
    .where(and(inArray(taskAssignees.taskId, taskIds), inArray(taskAssignees.userId, userIds)))
    .returning({ taskId: taskAssignees.taskId, userId: taskAssignees.userId });
}

/**
 * Gives target tasks the same assignees as their source tasks (`pairs` maps source id to
 * target id), in the same order, keeping only people in `allowed`.
 */
export async function carryAssignees(
  tx: Executor,
  pairs: Map<string, string>,
  allowed: Set<string>,
) {
  const map = await getAssigneeMap(tx, [...pairs.keys()]);
  return insertAssignees(
    tx,
    [...map.entries()].map(([sourceId, ids]) => ({
      taskId: pairs.get(sourceId)!,
      userIds: ids.filter((id) => allowed.has(id)),
    })),
  );
}

/** Takes anyone who isn't an active member of the workspace off these tasks. */
export async function pruneAssignees(tx: Executor, taskIds: string[], workspaceId: string) {
  if (taskIds.length === 0) return [];
  const members = [...(await activeMemberIds(tx, workspaceId))];
  return tx
    .delete(taskAssignees)
    .where(
      and(
        inArray(taskAssignees.taskId, taskIds),
        members.length ? notInArray(taskAssignees.userId, members) : undefined,
      ),
    )
    .returning({ taskId: taskAssignees.taskId, userId: taskAssignees.userId });
}

/** "assigned" / "unassigned" history entries that name the person added or removed. */
export async function logAssigneeChanges(
  tx: Executor,
  input: {
    workspaceId: string;
    actorId: string;
    changes: { taskId: string; userId: string }[];
    on: boolean;
  },
) {
  if (input.changes.length === 0) return;
  const ids = unique(input.changes.map((c) => c.userId));
  const people = await tx
    .select({ id: user.id, name: user.name })
    .from(user)
    .where(inArray(user.id, ids));
  const names = new Map(people.map((p) => [p.id, p.name]));
  for (let i = 0; i < input.changes.length; i += 500)
    await tx.insert(activities).values(
      input.changes.slice(i, i + 500).map((c) => ({
        workspaceId: input.workspaceId,
        taskId: c.taskId,
        actorId: input.actorId,
        kind: input.on ? ("assigned" as const) : ("unassigned" as const),
        data: { userId: c.userId, name: names.get(c.userId) ?? null },
      })),
    );
}

/** Ids of active members among `userIds`, in the given order. */
export async function keepActiveMembers(tx: Executor, workspaceId: string, userIds: string[]) {
  const ids = unique(userIds);
  if (ids.length === 0) return [];
  const members = await activeMemberIds(tx, workspaceId);
  return ids.filter((id) => members.has(id));
}
