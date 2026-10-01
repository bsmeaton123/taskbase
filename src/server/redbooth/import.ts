import "server-only";
import { format } from "date-fns";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  activities,
  attachments,
  comments,
  redboothImportedProjects,
  redboothImports,
  subtasks,
  taskAssignees,
  taskFollowers,
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { WORKSPACE_COLOR_KEYS } from "@/lib/colors";
import { newId } from "@/lib/id";
import { emptyCounts, type ImportProgress, type ImportProjectState } from "@/lib/redbooth";
import { matchPeople, planProject, type ProjectPlan } from "@/lib/redbooth-plan";
import { maxUploadBytes, sanitizeFileName, storageDriver, storeFile } from "@/lib/storage";
import { RedboothError, type RedboothClient } from "@/server/redbooth/client";
import { redboothClientFor } from "@/server/redbooth/connection";
import type { Executor } from "@/server/events";
import { PRODUCT_NAME } from "@/lib/product";

/** An import counts as running while it has saved progress in the last 15 minutes. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/** "running" only while it's still making progress; a stalled one reads as "interrupted". */
export function importState(job: { status: "running" | "done" | "failed"; updatedAt: Date }) {
  if (job.status !== "running") return job.status;
  return Date.now() - job.updatedAt.getTime() < STALE_AFTER_MS ? "running" : "interrupted";
}

/** The latest import, for the import page. Callers check the viewer is an admin. */
export async function latestRedboothImport() {
  const [row] = await db.select().from(redboothImports).orderBy(desc(redboothImports.createdAt)).limit(1);
  return row ?? null;
}

/**
 * Runs an import created by startRedboothImport, in the background. Each project is
 * read in full, planned (src/lib/redbooth-plan.ts), then written in one transaction, so a
 * failure never leaves half a project. Files are fetched afterwards, one at a time, so a
 * slow or missing file only skips that file. Progress is saved as it goes.
 */
export async function runRedboothImport(importId: string, importerId: string) {
  const [job] = await db.select().from(redboothImports).where(eq(redboothImports.id, importId));
  if (!job) return;
  const progress: ImportProgress = structuredClone(job.progress);
  const save = (patch: Partial<typeof redboothImports.$inferInsert> = {}) =>
    db
      .update(redboothImports)
      .set({ progress, updatedAt: new Date(), ...patch })
      .where(eq(redboothImports.id, importId));
  const setStep = async (step: string | null, project?: ImportProjectState, status?: ImportProjectState["status"]) => {
    progress.step = step;
    if (project && status) project.status = status;
    await save();
  };

  try {
    const rb = await redboothClientFor(importerId);
    if (!rb) throw new RedboothError("Redbooth isn't connected any more. Connect again and restart.", 401);

    await setStep("Matching people");
    const local = await db.select({ id: user.id, email: user.email, banned: user.banned }).from(user);
    const people = matchPeople(
      await rb.users(),
      local.map((p) => ({ id: p.id, email: p.email, active: !p.banned })),
    );

    const already = new Set(
      (
        await db
          .select({ id: redboothImportedProjects.projectId, ws: redboothImportedProjects.workspaceId })
          .from(redboothImportedProjects)
      )
        .filter((r) => r.ws)
        .map((r) => r.id),
    );
    const palette = WORKSPACE_COLOR_KEYS.filter((c) => c !== "slate");

    for (const [index, project] of progress.projects.entries()) {
      if (project.status !== "waiting") continue;
      if (already.has(project.id)) {
        project.status = "skipped";
        project.note = "Already imported";
        await save();
        continue;
      }
      try {
        await importProject(rb, project, {
          people,
          importerId,
          importId,
          color: palette[index % palette.length],
          setStep: (step) => setStep(step ? `${project.name}: ${step}` : null),
        });
        project.status = "done";
        await save();
      } catch (error) {
        project.status = "failed";
        project.note =
          error instanceof RedboothError ? error.message : "Something went wrong importing this project.";
        await save();
        if (!(error instanceof RedboothError)) console.error(`[redbooth] project ${project.id} failed`, error);
        // A lost sign-in stops everything; anything else moves on to the next project.
        if (error instanceof RedboothError && error.status === 401) throw error;
      }
    }
    progress.step = null;
    await save({ status: "done", finishedAt: new Date() });
  } catch (error) {
    progress.step = null;
    for (const p of progress.projects) if (p.status === "waiting" || p.status === "importing") p.status = "failed";
    await save({
      status: "failed",
      finishedAt: new Date(),
      error: error instanceof RedboothError ? error.message : "The import stopped unexpectedly.",
    });
    if (!(error instanceof RedboothError)) console.error("[redbooth] import failed", error);
  }
}

async function importProject(
  rb: RedboothClient,
  project: ImportProjectState,
  ctx: {
    people: ReturnType<typeof matchPeople>;
    importerId: string;
    importId: string;
    color: string;
    setStep: (step: string | null) => Promise<unknown>;
  },
) {
  project.status = "importing";
  await ctx.setStep("reading lists and tasks");
  const [lists, rbTasks, rbSubtasks, rbComments, people, files] = await Promise.all([
    rb.taskLists(project.id),
    rb.tasks(project.id),
    rb.subtasks(project.id),
    rb.comments(project.id),
    rb.people(project.id),
    rb.files(project.id),
  ]);
  const now = new Date();
  const plan = planProject({
    project,
    lists,
    tasks: rbTasks,
    subtasks: rbSubtasks,
    comments: rbComments,
    people,
    files,
    users: ctx.people,
    importerId: ctx.importerId,
    color: ctx.color,
    dateLabel: format(now, "d MMM yyyy"),
    now,
  });

  await ctx.setStep(`saving ${plan.tasks.length} tasks`);
  const ids = await db.transaction((tx) => writePlan(tx, plan, project, ctx));
  project.workspaceId = ids.workspaceId;
  project.counts = {
    ...emptyCounts(),
    lists: plan.lists.length,
    tasks: plan.tasks.length,
    subtasks: plan.subtasks.length,
    comments: plan.comments.length,
  };
  if (plan.unmatched.length > 0)
    project.note = `Not in ${PRODUCT_NAME}: ${plan.unmatched.map((p) => p.name).join(", ")}`;

  // Files, one at a time, outside the main transaction.
  const limit = maxUploadBytes();
  const driver = storageDriver();
  for (const [i, f] of plan.files.entries()) {
    await ctx.setStep(`downloading files (${i + 1} of ${plan.files.length})`);
    const bytes = await rb.download(f.file, limit);
    if (!bytes) {
      project.counts.filesSkipped++;
      continue;
    }
    const attachmentId = newId();
    await db.transaction(async (tx) => {
      await tx.insert(attachments).values({
        id: attachmentId,
        taskId: ids.tasks.get(f.taskKey)!,
        commentId: ids.comments.get(f.commentKey)!,
        uploaderId: f.uploaderId,
        name: sanitizeFileName(f.file.name ?? "file"),
        contentType: f.file.mime_type || "application/octet-stream",
        size: bytes.length,
        storage: driver,
        createdAt: f.createdAt,
      });
      await storeFile(tx, attachmentId, driver, bytes);
    });
    project.counts.files++;
  }
  await ctx.setStep(null);
}

/** Inserts in slices, well inside Postgres's limit on query parameters. */
async function insertAll<T>(rows: T[], insert: (slice: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += 500) await insert(rows.slice(i, i + 500));
}

async function writePlan(
  tx: Executor,
  plan: ProjectPlan,
  project: ImportProjectState,
  ctx: { importerId: string; importId: string },
) {
  const workspaceId = newId();
  await tx.insert(workspaces).values({
    id: workspaceId,
    name: plan.workspace.name,
    description: plan.workspace.description,
    color: plan.workspace.color,
    createdById: ctx.importerId,
  });
  await tx.insert(workspaceMembers).values(
    plan.members.map((m) => ({ workspaceId, userId: m.userId, role: m.role })),
  );

  const listIds = new Map(plan.lists.map((l) => [l.key, newId()]));
  await tx.insert(taskLists).values(
    plan.lists.map((l) => ({ id: listIds.get(l.key)!, workspaceId, name: l.name, position: l.position })),
  );

  const taskIds = new Map(plan.tasks.map((t) => [t.key, newId()]));
  await insertAll(plan.tasks, (slice) =>
    tx.insert(tasks).values(
      slice.map((t) => ({
        id: taskIds.get(t.key)!,
        workspaceId,
        taskListId: listIds.get(t.listKey)!,
        title: t.title,
        description: t.description,
        status: t.status,
        dueDate: t.dueDate,
        urgent: t.urgent,
        position: t.position,
        createdById: t.createdById,
        completedAt: t.completedAt,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
    ),
  );

  const assigneeRows = plan.tasks.flatMap((t) =>
    t.assigneeIds.map((userId, i) => ({
      taskId: taskIds.get(t.key)!,
      userId,
      createdAt: new Date(t.createdAt.getTime() + i),
    })),
  );
  await insertAll(assigneeRows, (slice) => tx.insert(taskAssignees).values(slice));

  const followerRows = plan.tasks.flatMap((t) =>
    t.followerIds.map((userId) => ({ taskId: taskIds.get(t.key)!, userId })),
  );
  await insertAll(followerRows, (slice) => tx.insert(taskFollowers).values(slice).onConflictDoNothing());

  // Each task's history starts with where it came from.
  await insertAll(plan.tasks, (slice) =>
    tx.insert(activities).values(
      slice.map((t) => ({
        workspaceId,
        taskId: taskIds.get(t.key)!,
        actorId: t.createdById,
        kind: "task_created" as const,
        data: { source: "Redbooth" },
        createdAt: t.createdAt,
      })),
    ),
  );

  await insertAll(plan.subtasks, (slice) =>
    tx.insert(subtasks).values(
      slice.map((s) => ({
        taskId: taskIds.get(s.taskKey)!,
        title: s.title,
        done: s.done,
        position: s.position,
        completedAt: s.completedAt,
        createdAt: s.createdAt,
      })),
    ),
  );

  const commentIds = new Map(plan.comments.map((c) => [c.key, newId()]));
  await insertAll(plan.comments, (slice) =>
    tx.insert(comments).values(
      slice.map((c) => ({
        id: commentIds.get(c.key)!,
        taskId: taskIds.get(c.taskKey)!,
        authorId: c.authorId,
        body: c.body,
        createdAt: c.createdAt,
      })),
    ),
  );

  await tx.insert(redboothImportedProjects).values({
    projectId: project.id,
    workspaceId,
    importId: ctx.importId,
    name: project.name,
  })
    .onConflictDoUpdate({
      target: redboothImportedProjects.projectId,
      set: { workspaceId, importId: ctx.importId, name: project.name },
    });

  return { workspaceId, tasks: taskIds, comments: commentIds };
}
