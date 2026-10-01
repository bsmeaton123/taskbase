"use server";

import { and, asc, eq, gt, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { assertTaskAccess, assertWorkspaceAccess, getWorkspaceAccess } from "@/lib/access";
import { isValidColor, normalizeColor } from "@/lib/colors";
import { newId } from "@/lib/id";
import { ActionError, requireActionUser, type CurrentUser } from "@/lib/session";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { copyTasks } from "@/server/copy";
import { notify } from "@/server/events";
import { moveTasksToWorkspace } from "@/server/move-tasks";

const CLOSED = ["resolved", "rejected"] as const;

const dateModeSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("keep") }),
  z.object({ mode: z.literal("clear") }),
  z.object({ mode: z.literal("shift"), startOn: dateSchema }),
]);

const duplicateSchema = z.object({
  sourceId: idSchema,
  name: z.string().trim().min(1, "Give the workspace a name.").max(80),
  description: z.string().trim().max(500).nullable().optional(),
  color: z.string().refine(isValidColor, "Pick a colour from the palette or a hex value like #1f6fe8.").transform(normalizeColor).optional(),
  asTemplate: z.boolean(),
  includeTasks: z.boolean(),
  includeCompleted: z.boolean(),
  includeSubtasks: z.boolean(),
  keepAssignees: z.boolean(),
  resetProgress: z.boolean(),
  dates: dateModeSchema,
  copyMembers: z.boolean(),
  memberIds: z.array(idSchema).max(200).optional(),
});

export type DuplicateWorkspaceInput = z.input<typeof duplicateSchema>;

/** Templates are open to everyone; other workspaces need access. */
async function loadCopySource(viewer: CurrentUser, id: string) {
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, id));
  if (!ws) throw new ActionError("That workspace no longer exists.");
  if (!ws.isTemplate && !(await getWorkspaceAccess(viewer, id)))
    throw new ActionError("You don't have access to that workspace.");
  return ws;
}

/**
 * Creates a new workspace (or template) from an existing one: lists, tasks
 * and subtasks are copied; comments, files and history are not.
 */
export async function duplicateWorkspace(input: DuplicateWorkspaceInput) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = duplicateSchema.parse(input);
    const source = await loadCopySource(viewer, data.sourceId);
    const sourceAccess = await getWorkspaceAccess(viewer, source.id);
    // Publishing a private workspace as an org-wide template is an owner decision.
    if (data.asTemplate && !source.isTemplate && !sourceAccess?.canManage)
      throw new ActionError("Only workspace owners can save it as a template.");
    // Copying members reveals who's in the source, so it needs real access.
    const copyMembers = data.copyMembers && Boolean(sourceAccess);

    return db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: data.name,
          description: data.description === undefined ? source.description : data.description || null,
          color: data.color ?? source.color,
          isTemplate: data.asTemplate,
          createdById: viewer.id,
        })
        .returning({ id: workspaces.id });

      // Members: you (owner), plus the source's members and/or people picked.
      const wanted = new Set<string>(data.memberIds ?? []);
      if (copyMembers) {
        const rows = await tx
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, source.id));
        rows.forEach((r) => wanted.add(r.userId));
      }
      wanted.delete(viewer.id);
      const others = wanted.size
        ? (
            await tx
              .select({ id: user.id })
              .from(user)
              .where(
                and(
                  inArray(user.id, [...wanted]),
                  or(isNull(user.banned), eq(user.banned, false)),
                ),
              )
          ).map((u) => u.id)
        : [];
      await tx.insert(workspaceMembers).values([
        { workspaceId: ws.id, userId: viewer.id, role: "owner" as const },
        ...others.map((userId) => ({ workspaceId: ws.id, userId, role: "member" as const })),
      ]);

      // Lists, in the same order.
      const lists = await tx
        .select()
        .from(taskLists)
        .where(eq(taskLists.workspaceId, source.id))
        .orderBy(asc(taskLists.position), asc(taskLists.createdAt));
      const listMap = new Map<string, string>();
      if (lists.length === 0) {
        await tx.insert(taskLists).values({ workspaceId: ws.id, name: "To do", position: 1024 });
      } else {
        const rows = lists.map((l) => {
          const id = newId();
          listMap.set(l.id, id);
          return { id, workspaceId: ws.id, name: l.name, position: l.position };
        });
        await tx.insert(taskLists).values(rows);
      }

      let copied = 0;
      if (data.includeTasks && lists.length > 0) {
        const sourceTasks = await tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.workspaceId, source.id),
              data.includeCompleted ? undefined : notInArray(tasks.status, [...CLOSED]),
              // Past occurrences of a repeating task would all reopen as duplicates.
              data.resetProgress
                ? sql`not ("tasks"."status" in ('resolved', 'rejected') and exists (select 1 from tasks n where n.recurred_from_id = "tasks"."id"))`
                : undefined,
            ),
          )
          .orderBy(asc(tasks.position), asc(tasks.createdAt));
        const idMap = await copyTasks(tx, {
          source: sourceTasks,
          targetWorkspaceId: ws.id,
          listMap,
          actorId: viewer.id,
          allowedAssignees: new Set([viewer.id, ...others]),
          includeSubtasks: data.includeSubtasks,
          keepAssignees: data.keepAssignees,
          resetProgress: data.resetProgress,
          dates: data.dates,
        });
        copied = idMap.size;
      }

      if (!data.asTemplate && others.length > 0) {
        await notify(tx, others, {
          kind: "added_to_workspace",
          actorId: viewer.id,
          workspaceId: ws.id,
        });
      }
      return { id: ws.id, tasks: copied };
    });
  });
}

/** Turns a workspace into a template (or back into a regular workspace). */
export async function setWorkspaceTemplate(id: string, isTemplate: boolean) {
  return run(async () => {
    const viewer = await requireActionUser();
    await assertWorkspaceAccess(viewer, idSchema.parse(id), { manage: true });
    await db
      .update(workspaces)
      .set({ isTemplate: z.boolean().parse(isTemplate), archivedAt: null })
      .where(eq(workspaces.id, id));
    return null;
  });
}

/** Copies a task list (and its tasks) right after the original. */
export async function duplicateTaskList(listId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const [list] = await db
      .select()
      .from(taskLists)
      .where(eq(taskLists.id, idSchema.parse(listId)));
    if (!list) throw new ActionError("That list no longer exists.");
    await assertWorkspaceAccess(viewer, list.workspaceId);

    return db.transaction(async (tx) => {
      const [next] = await tx
        .select({ position: taskLists.position })
        .from(taskLists)
        .where(and(eq(taskLists.workspaceId, list.workspaceId), gt(taskLists.position, list.position)))
        .orderBy(asc(taskLists.position))
        .limit(1);
      const [copy] = await tx
        .insert(taskLists)
        .values({
          workspaceId: list.workspaceId,
          name: `${list.name} (copy)`.slice(0, 80),
          position: next ? (list.position + next.position) / 2 : list.position + 1024,
        })
        .returning({ id: taskLists.id });

      const members = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, list.workspaceId));
      const sourceTasks = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.taskListId, list.id))
        .orderBy(asc(tasks.position), asc(tasks.createdAt));
      await copyTasks(tx, {
        source: sourceTasks,
        targetWorkspaceId: list.workspaceId,
        listMap: new Map([[list.id, copy.id]]),
        actorId: viewer.id,
        allowedAssignees: new Set(members.map((m) => m.userId)),
        includeSubtasks: true,
        keepAssignees: true,
        resetProgress: false,
        dates: { mode: "keep" },
      });
      return { id: copy.id };
    });
  });
}

/** Copies a task (with subtasks) right below the original. */
export async function duplicateTask(taskId: string) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));

    return db.transaction(async (tx) => {
      const [next] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(and(eq(tasks.taskListId, task.taskListId), gt(tasks.position, task.position)))
        .orderBy(asc(tasks.position))
        .limit(1);
      const members = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, task.workspaceId));
      const idMap = await copyTasks(tx, {
        source: [task],
        targetWorkspaceId: task.workspaceId,
        listMap: new Map([[task.taskListId, task.taskListId]]),
        actorId: viewer.id,
        allowedAssignees: new Set(members.map((m) => m.userId)),
        includeSubtasks: true,
        keepAssignees: true,
        resetProgress: true,
        dates: { mode: "keep" },
        positionFor: (t) => (next ? (t.position + next.position) / 2 : t.position + 1024),
        titleFor: (t) => `${t.title} (copy)`.slice(0, 300),
      });
      return { id: idMap.get(task.id)! };
    });
  });
}

/** Moves a task to another workspace (see moveTasksToWorkspace). */
export async function moveTaskToWorkspace(input: {
  taskId: string;
  workspaceId: string;
  taskListId: string;
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({ taskId: idSchema, workspaceId: idSchema, taskListId: idSchema })
      .parse(input);
    const { task } = await assertTaskAccess(viewer, data.taskId);
    const target = await assertWorkspaceAccess(viewer, data.workspaceId);
    if (target.workspace.id === task.workspaceId)
      throw new ActionError("The task is already in that workspace.");
    const [list] = await db
      .select({ id: taskLists.id, name: taskLists.name })
      .from(taskLists)
      .where(and(eq(taskLists.id, data.taskListId), eq(taskLists.workspaceId, data.workspaceId)));
    if (!list) throw new ActionError("Pick a list in that workspace.");

    await db.transaction((tx) =>
      moveTasksToWorkspace(tx, {
        tasks: [task],
        workspace: target.workspace,
        list,
        actorId: viewer.id,
      }),
    );
    return { workspaceId: data.workspaceId };
  });
}

/** Lists in a workspace the viewer can access (for "Move to workspace"). */
export async function getWorkspaceLists(workspaceId: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
      return db
        .select({ id: taskLists.id, name: taskLists.name })
        .from(taskLists)
        .where(eq(taskLists.workspaceId, workspaceId))
        .orderBy(asc(taskLists.position), asc(taskLists.createdAt));
    },
    { refresh: false },
  );
}
