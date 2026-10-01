import "server-only";
import { and, eq, inArray, or, isNull } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import {
  activities,
  notifications,
  taskFollowers,
  user,
  workspaceMembers,
  type ActivityData,
  type ActivityKind,
} from "@/db/schema";
import { deliverNotificationEmails } from "@/server/notification-emails";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Executor = typeof db | Tx;

export async function logActivity(
  tx: Executor,
  entry: {
    workspaceId: string;
    taskId: string | null;
    actorId: string;
    kind: ActivityKind;
    data?: ActivityData;
  },
) {
  await tx.insert(activities).values({ ...entry, data: entry.data ?? {} });
}

export async function addFollowers(
  tx: Executor,
  taskId: string,
  userIds: (string | null | undefined)[],
) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  await tx
    .insert(taskFollowers)
    .values(ids.map((userId) => ({ taskId, userId })))
    .onConflictDoNothing();
}

/** Followers who are still active members of the task's workspace. */
export async function getFollowerIds(tx: Executor, taskId: string, workspaceId: string) {
  const rows = await tx
    .select({ userId: taskFollowers.userId })
    .from(taskFollowers)
    .where(eq(taskFollowers.taskId, taskId));
  return filterMembers(
    tx,
    workspaceId,
    rows.map((r) => r.userId),
  );
}

/** Ids of every active (not deactivated) member of the workspace. */
export async function activeMemberIds(tx: Executor, workspaceId: string) {
  const rows = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), or(isNull(user.banned), eq(user.banned, false))),
    );
  return new Set(rows.map((r) => r.userId));
}

/** Keeps only ids of active (not deactivated) members of the workspace. */
export async function filterMembers(
  tx: Executor,
  workspaceId: string,
  userIds: string[],
) {
  if (userIds.length === 0) return [];
  const rows = await tx
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        inArray(workspaceMembers.userId, userIds),
        or(isNull(user.banned), eq(user.banned, false)),
      ),
    );
  return rows.map((r) => r.userId);
}

type NotificationInput = Omit<
  typeof notifications.$inferInsert,
  "id" | "createdAt" | "readAt" | "userId"
> & { actorId: string };

/**
 * Sends one notification per recipient, never to the person who acted. Bulk changes pass
 * `email: false` and send their own summary email instead of one per task.
 */
export async function notify(
  tx: Executor,
  recipients: (string | null | undefined)[],
  input: NotificationInput,
  opts: { email?: boolean } = {},
) {
  const ids = [
    ...new Set(
      recipients.filter(
        (id): id is string => Boolean(id) && id !== input.actorId,
      ),
    ),
  ];
  if (ids.length === 0) return;
  const created = await tx
    .insert(notifications)
    .values(ids.map((userId) => ({ ...input, userId, data: input.data ?? {} })))
    .returning({ id: notifications.id });
  // Send emails once the response is on its way (and the transaction has
  // committed; rolled-back notifications simply won't be found).
  if (opts.email !== false) after(() => deliverNotificationEmails(created.map((n) => n.id)));
}
