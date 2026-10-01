"use server";

import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { taskDependencies, tasks } from "@/db/schema";
import { assertTaskAccess, assertWorkspaceAccess } from "@/lib/access";
import { ActionError, requireActionUser } from "@/lib/session";
import { idSchema, run } from "@/server/action-utils";
import { wouldCreateCycle } from "@/server/dependencies";
import { logActivity } from "@/server/events";

/** Make `taskId` wait for `dependsOnId` ("blocked by"). Both must be in the same workspace. */
export async function addDependency(input: { taskId: string; dependsOnId: string }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.object({ taskId: idSchema, dependsOnId: idSchema }).parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);
    const [blocker] = await db
      .select({
        id: tasks.id,
        number: tasks.number,
        title: tasks.title,
        workspaceId: tasks.workspaceId,
      })
      .from(tasks)
      .where(eq(tasks.id, data.dependsOnId));
    if (!blocker || blocker.workspaceId !== task.workspaceId)
      throw new ActionError("Pick a task in the same workspace.");

    await db.transaction(async (tx) => {
      // One link at a time per workspace, so two people can't add A->B and B->A together.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${task.workspaceId}))`);
      // Re-check inside the transaction: either task may have been moved meanwhile.
      const fresh = await tx
        .select({ id: tasks.id, workspaceId: tasks.workspaceId })
        .from(tasks)
        .where(inArray(tasks.id, [task.id, blocker.id]))
        .for("update");
      if (fresh.length !== 2 || fresh.some((t) => t.workspaceId !== task.workspaceId))
        throw new ActionError("Pick a task in the same workspace.");
      if (await wouldCreateCycle(tx, task.id, blocker.id))
        throw new ActionError(
          blocker.id === task.id
            ? "A task can't wait for itself."
            : `#${blocker.number} already waits for this task, so they'd be waiting for each other.`,
        );
      const inserted = await tx
        .insert(taskDependencies)
        .values({ taskId: task.id, dependsOnId: blocker.id, createdById: viewer.id })
        .onConflictDoNothing()
        .returning({ taskId: taskDependencies.taskId });
      if (inserted.length === 0) return;
      await logActivity(tx, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: "blocker_added",
        data: { number: blocker.number, title: blocker.title },
      });
    });
    return null;
  });
}

export async function removeDependency(input: { taskId: string; dependsOnId: string }) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.object({ taskId: idSchema, dependsOnId: idSchema }).parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);
    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(taskDependencies)
        .where(
          and(
            eq(taskDependencies.taskId, task.id),
            eq(taskDependencies.dependsOnId, data.dependsOnId),
          ),
        )
        .returning({ id: taskDependencies.dependsOnId });
      if (removed.length === 0) return;
      const [blocker] = await tx
        .select({ number: tasks.number, title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, data.dependsOnId));
      await logActivity(tx, {
        workspaceId: task.workspaceId,
        taskId: task.id,
        actorId: viewer.id,
        kind: "blocker_removed",
        data: { number: blocker?.number ?? null, title: blocker?.title ?? null },
      });
    });
    return null;
  });
}

/** Tasks in a workspace to pick a blocker from: open ones, then recently closed. */
export async function listTaskOptions(workspaceId: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
      const columns = { id: tasks.id, number: tasks.number, title: tasks.title, status: tasks.status };
      const [open, closed] = await Promise.all([
        db
          .select(columns)
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, workspaceId),
              notInArray(tasks.status, ["resolved", "rejected"]),
            ),
          )
          .orderBy(asc(tasks.number))
          .limit(500),
        db
          .select(columns)
          .from(tasks)
          .where(and(eq(tasks.workspaceId, workspaceId), inArray(tasks.status, ["resolved", "rejected"])))
          .orderBy(sql`${tasks.completedAt} desc nulls last`)
          .limit(50),
      ]);
      const seen = new Set(open.map((t) => t.id));
      return [
        ...open,
        ...closed.filter((t) => !seen.has(t.id) && (t.status === "resolved" || t.status === "rejected")),
      ];
    },
    { refresh: false },
  );
}
