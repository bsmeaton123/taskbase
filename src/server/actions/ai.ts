"use server";

import { and, eq, inArray, isNull, max, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  attachments,
  subtasks,
  tags,
  taskFollowers,
  taskLists,
  taskTags,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { assertTaskAccess, assertWorkspaceAccess } from "@/lib/access";
import { isValidColor, normalizeColor } from "@/lib/colors";
import { daysUntil, shiftDate } from "@/lib/dates";
import { newId } from "@/lib/id";
import { titleSimilarity } from "@/lib/insights";
import { ActionError, getToday, requireActionUser } from "@/lib/session";
import { recurrenceSchema, type Recurrence } from "@/lib/recurrence";
import { isInlineSafe, loadFile } from "@/lib/storage";
import { dateSchema, idSchema, run } from "@/server/action-utils";
import { aiEnabled, aiStructured } from "@/server/ai/client";
import {
  recentTaskPatterns,
  safe,
  taskThreadContext,
  workspaceDirectory,
  workspaceInsights,
} from "@/server/ai/context";
import { PROMPTS } from "@/server/ai/prompts";
import { insertAssignees } from "@/server/assignees";
import { activeMemberIds, addFollowers, logActivity, notify } from "@/server/events";
import { ensureTags } from "@/server/tags";

const isoDate = (v: string | null | undefined) =>
  v && dateSchema.safeParse(v).success ? v : null;

function matchMember<M extends { name: string; email?: string }>(name: string | null, members: M[]) {
  if (!name) return null;
  const n = name.trim().toLowerCase();
  return (
    members.find((m) => m.name.toLowerCase() === n || m.email?.toLowerCase() === n) ??
    (() => {
      const byFirst = members.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === n);
      return byFirst.length === 1 ? byFirst[0] : null;
    })()
  );
}

/** Members named by the model, in order and without repeats. "I"/"me" is the viewer. */
function matchMembers<M extends { id: string; name: string; email?: string }>(
  names: string[],
  members: M[],
  viewerId: string,
) {
  const out: M[] = [];
  for (const name of names.slice(0, 20)) {
    const member = /^(i|me|my|i'll)$/i.test(name.trim())
      ? (members.find((m) => m.id === viewerId) ?? null)
      : matchMember(name, members);
    if (member && !out.some((m) => m.id === member.id)) out.push(member);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Notes → tasks                                                               */
/* -------------------------------------------------------------------------- */

const ExtractedTasks = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      assignees: z.array(z.string()),
      dueDate: z.string().nullable(),
      list: z.string().nullable(),
      urgent: z.boolean(),
      subtasks: z.array(z.string()),
    }),
  ),
});

export type DraftTask = {
  title: string;
  description: string;
  assigneeIds: string[];
  dueDate: string | null;
  list: string | null;
  urgent: boolean;
  subtasks: string[];
};

export async function extractTasksFromNotes(workspaceId: string, notes: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
      const text = z
        .string()
        .trim()
        .min(10, "Paste a few lines of notes first.")
        .max(40_000, "That's too long. Paste up to about 40,000 characters.")
        .parse(notes);
      const [dir] = await workspaceDirectory(viewer, workspaceId);
      if (!dir) throw new ActionError("You're not a member of that workspace.");
      const today = await getToday();

      const out = await aiStructured({
        viewer,
        feature: "notes_to_tasks",
        system: PROMPTS.notesToTasks,
        schema: ExtractedTasks,
        effort: "medium",
        content: [
          `Today is ${today}. The person pasting is ${viewer.name}.`,
          `Workspace: ${dir.name}`,
          `Existing lists: ${dir.lists.map((l) => l.name).join(", ")}`,
          `Members: ${dir.members.map((m) => m.name).join(", ")}`,
          `<notes>\n${safe(text)}\n</notes>`,
        ].join("\n"),
      });

      const drafts: DraftTask[] = out.tasks.slice(0, 60).map((t) => {
        return {
          title: t.title.trim().slice(0, 300),
          description: t.description.trim().slice(0, 5000),
          assigneeIds: matchMembers(t.assignees, dir.members, viewer.id).map((m) => m.id),
          dueDate: isoDate(t.dueDate),
          list: t.list?.trim().slice(0, 80) || null,
          urgent: t.urgent,
          subtasks: t.subtasks.map((s) => s.trim().slice(0, 300)).filter(Boolean).slice(0, 10),
        };
      });
      return { drafts: drafts.filter((d) => d.title) };
    },
    { refresh: false },
  );
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000),
  assigneeIds: z.array(idSchema).max(20),
  dueDate: dateSchema.nullable(),
  list: z.string().trim().max(80).nullable(),
  urgent: z.boolean(),
  subtasks: z.array(z.string().trim().min(1).max(300)).max(20),
});

/** Creates reviewed drafts (from notes or a plan) in an existing workspace. */
export async function createTasksFromDrafts(workspaceId: string, drafts: DraftTask[]) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z.array(draftSchema).min(1, "Pick at least one task.").max(100).parse(drafts);
    await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
    return db.transaction(async (tx) => {
      const created = await insertDrafts(tx, workspaceId, data, viewer.id);
      return { created };
    });
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function insertDrafts(
  tx: Tx,
  workspaceId: string,
  drafts: z.infer<typeof draftSchema>[],
  actorId: string,
) {
  const lists = await tx
    .select({ id: taskLists.id, name: taskLists.name, position: taskLists.position })
    .from(taskLists)
    .where(eq(taskLists.workspaceId, workspaceId))
    .orderBy(taskLists.position);
  const byName = new Map(lists.map((l) => [l.name.trim().toLowerCase(), l.id]));
  let listPos = Math.max(0, ...lists.map((l) => l.position)) + 1024;
  for (const d of drafts) {
    const key = d.list?.toLowerCase();
    if (key && !byName.has(key)) {
      const id = newId();
      await tx.insert(taskLists).values({ id, workspaceId, name: d.list!, position: listPos });
      listPos += 1024;
      byName.set(key, id);
    }
  }
  let defaultList = lists[0]?.id;
  if (!defaultList) {
    defaultList = newId();
    await tx.insert(taskLists).values({ id: defaultList, workspaceId, name: "To do", position: listPos });
  }

  const memberIds = await activeMemberIds(tx, workspaceId);

  const nextPos = new Map<string, number>();
  for (const listId of new Set([defaultList, ...byName.values()])) {
    const [{ hi }] = await tx
      .select({ hi: max(tasks.position) })
      .from(tasks)
      .where(eq(tasks.taskListId, listId));
    nextPos.set(listId, (hi ?? 0) + 1024);
  }

  let created = 0;
  for (const d of drafts) {
    const listId = (d.list && byName.get(d.list.toLowerCase())) || defaultList;
    const position = nextPos.get(listId)!;
    nextPos.set(listId, position + 1024);
    const assigneeIds = [...new Set(d.assigneeIds)].filter((id) => memberIds.has(id));
    const id = newId();
    await tx.insert(tasks).values({
      id,
      workspaceId,
      taskListId: listId,
      title: d.title,
      description: d.description,
      urgent: d.urgent,
      dueDate: d.dueDate,
      position,
      createdById: actorId,
    });
    await insertAssignees(tx, [{ taskId: id, userIds: assigneeIds }]);
    if (d.subtasks.length)
      await tx.insert(subtasks).values(
        d.subtasks.map((title, i) => ({ taskId: id, title, position: (i + 1) * 1024, createdById: actorId })),
      );
    await logActivity(tx, { workspaceId, taskId: id, actorId, kind: "task_created" });
    await addFollowers(tx, id, [actorId, ...assigneeIds]);
    await notify(tx, assigneeIds, { kind: "assigned", actorId, workspaceId, taskId: id });
    created++;
  }
  return created;
}

/* -------------------------------------------------------------------------- */
/* Quick add                                                                   */
/* -------------------------------------------------------------------------- */

const QuickAdd = z.object({
  workspace: z.string(),
  list: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  subtasks: z.array(z.string()),
  assignees: z.array(z.string()),
  startDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  repeat: z
    .object({
      freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
      interval: z.number(),
      weekdays: z.array(z.number()).nullable(),
      monthDay: z.number().nullable(),
    })
    .nullable(),
  tags: z.array(z.string()),
  urgent: z.boolean(),
});

export type QuickAddDraft = {
  workspaceId: string;
  workspaceName: string;
  taskListId: string;
  listName: string;
  title: string;
  description: string;
  subtasks: string[];
  assigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  recurrence: Recurrence | null;
  /** Existing tag ids, plus new names to create. */
  tagIds: string[];
  newTags: string[];
  urgent: boolean;
};

export async function parseQuickAdd(text: string, preferredWorkspaceId?: string | null) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      const input = z.string().trim().min(3, "Type what needs doing.").max(4000).parse(text);
      const dir = await workspaceDirectory(viewer);
      if (dir.length === 0) throw new ActionError("Join or create a workspace first.");
      // Put the current workspace first so it wins when the text doesn't say.
      const ordered = preferredWorkspaceId
        ? [...dir.filter((w) => w.id === preferredWorkspaceId), ...dir.filter((w) => w.id !== preferredWorkspaceId)]
        : dir;
      const today = await getToday();
      const out = await aiStructured({
        viewer,
        feature: "quick_add",
        system: PROMPTS.quickAdd,
        schema: QuickAdd,
        effort: "low",
        maxTokens: 4000,
        content: [
          `Today is ${today} (${new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long" })}). The person typing is ${viewer.name}.`,
          "Workspaces:",
          ...ordered.map(
            (w) =>
              `- ${w.name} | lists: ${w.lists.map((l) => l.name).join(", ")} | members: ${w.members.map((m) => m.name).join(", ")}${
                w.tags.length ? ` | tags: ${w.tags.map((t) => t.name).join(", ")}` : ""
              }`,
          ),
          `<notes>${safe(input)}</notes>`,
        ].join("\n"),
      });

      const ws =
        ordered.find((w) => w.name.toLowerCase() === out.workspace.trim().toLowerCase()) ??
        ordered.find((w) => w.name.toLowerCase().includes(out.workspace.trim().toLowerCase())) ??
        ordered[0];
      const list =
        (out.list && ws.lists.find((l) => l.name.toLowerCase() === out.list!.trim().toLowerCase())) ||
        ws.lists[0];
      if (!list) throw new ActionError(`${ws.name} has no task lists yet.`);
      const assignees = matchMembers(out.assignees, ws.members, viewer.id);
      const startDate = isoDate(out.startDate);
      const dueDate = isoDate(out.dueDate);
      const repeat = out.repeat
        ? recurrenceSchema.safeParse({
            freq: out.repeat.freq,
            interval: Math.max(1, Math.min(99, Math.round(out.repeat.interval || 1))),
            weekdays: out.repeat.freq === "weekly" && out.repeat.weekdays?.length ? out.repeat.weekdays : undefined,
            monthDay: out.repeat.freq === "monthly" && out.repeat.monthDay ? out.repeat.monthDay : undefined,
          })
        : null;
      const tagIds: string[] = [];
      const newTags: string[] = [];
      for (const raw of out.tags.slice(0, 4)) {
        const name = raw.trim().slice(0, 40);
        if (!name) continue;
        const existing = ws.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
        if (existing) tagIds.push(existing.id);
        else if (newTags.length < 1) newTags.push(name);
      }
      const draft: QuickAddDraft = {
        workspaceId: ws.id,
        workspaceName: ws.name,
        taskListId: list.id,
        listName: list.name,
        title: (out.title.trim() || input.split("\n")[0]).slice(0, 300),
        description: out.description.trim().slice(0, 20000),
        subtasks: out.subtasks.map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 8),
        assigneeIds: assignees.map((m) => m.id),
        startDate: startDate && dueDate && startDate > dueDate ? null : startDate,
        dueDate,
        recurrence: repeat?.success ? repeat.data : null,
        tagIds: [...new Set(tagIds)],
        newTags,
        urgent: out.urgent,
      };
      return { draft, workspaces: dir };
    },
    { refresh: false },
  );
}

const quickAddCreateSchema = z.object({
  workspaceId: idSchema,
  taskListId: idSchema,
  title: z.string().trim().min(1, "Tasks need a title.").max(300),
  description: z.string().max(20000),
  subtasks: z.array(z.string().trim().min(1).max(200)).max(8),
  assigneeIds: z.array(idSchema).max(20),
  startDate: dateSchema.nullable(),
  dueDate: dateSchema.nullable(),
  recurrence: recurrenceSchema.nullable(),
  tagIds: z.array(idSchema).max(6),
  newTags: z.array(z.string().trim().min(1).max(40)).max(2),
  urgent: z.boolean(),
});

/** Creates the task someone reviewed in Quick add, with its subtasks and tags. */
export async function createFromQuickAdd(input: z.input<typeof quickAddCreateSchema>) {
  return run(async () => {
    const viewer = await requireActionUser();
    const d = quickAddCreateSchema.parse(input);
    await assertWorkspaceAccess(viewer, d.workspaceId);
    if (d.startDate && d.dueDate && d.startDate > d.dueDate)
      throw new ActionError("The start date has to be on or before the due date.");
    const [list] = await db
      .select({ id: taskLists.id })
      .from(taskLists)
      .where(and(eq(taskLists.id, d.taskListId), eq(taskLists.workspaceId, d.workspaceId)));
    if (!list) throw new ActionError("That task list no longer exists.");

    return db.transaction(async (tx) => {
      const memberIds = await activeMemberIds(tx, d.workspaceId);
      const assigneeIds = [...new Set(d.assigneeIds)].filter((id) => memberIds.has(id));
      const [{ lo }] = await tx
        .select({ lo: sql<number | null>`min(${tasks.position})` })
        .from(tasks)
        .where(eq(tasks.taskListId, list.id));
      const [task] = await tx
        .insert(tasks)
        .values({
          workspaceId: d.workspaceId,
          taskListId: list.id,
          title: d.title,
          description: d.description,
          urgent: d.urgent,
          startDate: d.startDate,
          dueDate: d.dueDate,
          recurrence: d.recurrence,
          position: (lo ?? 1024) - 1024,
          createdById: viewer.id,
        })
        .returning({ id: tasks.id, number: tasks.number });
      await insertAssignees(tx, [{ taskId: task.id, userIds: assigneeIds }]);
      if (d.subtasks.length)
        await tx.insert(subtasks).values(
          d.subtasks.map((title, i) => ({
            taskId: task.id,
            title,
            position: (i + 1) * 1024,
            createdById: viewer.id,
          })),
        );
      // Only this workspace's tags can be attached; new names are created here.
      const existing = d.tagIds.length
        ? await tx
            .select({ id: tags.id })
            .from(tags)
            .where(and(eq(tags.workspaceId, d.workspaceId), inArray(tags.id, d.tagIds)))
        : [];
      const tagIds = new Set(existing.map((t) => t.id));
      if (d.newTags.length) {
        const byName = await ensureTags(tx, d.workspaceId, d.newTags.map((name) => ({ name })));
        for (const name of d.newTags) {
          const id = byName.get(name.trim().replace(/\s+/g, " ").toLowerCase());
          if (id) tagIds.add(id);
        }
      }
      if (tagIds.size)
        await tx
          .insert(taskTags)
          .values([...tagIds].map((tagId) => ({ taskId: task.id, tagId })))
          .onConflictDoNothing();
      await logActivity(tx, { workspaceId: d.workspaceId, taskId: task.id, actorId: viewer.id, kind: "task_created" });
      await addFollowers(tx, task.id, [viewer.id, ...assigneeIds]);
      await notify(tx, assigneeIds, {
        kind: "assigned",
        actorId: viewer.id,
        workspaceId: d.workspaceId,
        taskId: task.id,
      });
      return task;
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Subtask suggestions                                                         */
/* -------------------------------------------------------------------------- */

const SuggestedSubtasks = z.object({
  subtasks: z.array(z.object({ title: z.string(), assignee: z.string().nullable() })),
});

export async function suggestSubtasks(taskId: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      const ctx = await taskThreadContext(viewer, idSchema.parse(taskId));
      if (!ctx) throw new ActionError("That task isn't available.");
      const out = await aiStructured({
        viewer,
        feature: "suggest_subtasks",
        system: PROMPTS.suggestSubtasks,
        schema: SuggestedSubtasks,
        effort: "medium",
        content: `Members: ${ctx.detail.members.map((m) => m.name).join(", ")}\n${ctx.text}`,
      });
      const existing = new Set(ctx.detail.subtasks.map((s) => s.title.toLowerCase()));
      return {
        suggestions: out.subtasks
          .map((s) => ({
            title: s.title.trim().slice(0, 300),
            assigneeId: matchMember(s.assignee, ctx.detail.members)?.id ?? null,
          }))
          .filter((s) => s.title && !existing.has(s.title.toLowerCase()))
          .slice(0, 10),
      };
    },
    { refresh: false },
  );
}

/** Adds several subtasks at once (from suggestions or a file's action items). */
export async function addSubtasksBulk(
  taskId: string,
  items: { title: string; assigneeId?: string | null }[],
) {
  return run(async () => {
    const viewer = await requireActionUser();
    const { task } = await assertTaskAccess(viewer, idSchema.parse(taskId));
    const data = z
      .array(z.object({ title: z.string().trim().min(1).max(300), assigneeId: idSchema.nullable().optional() }))
      .min(1, "Pick at least one subtask.")
      .max(30)
      .parse(items);
    const memberIds = await activeMemberIds(db, task.workspaceId);
    await db.transaction(async (tx) => {
      const [{ hi }] = await tx
        .select({ hi: max(subtasks.position) })
        .from(subtasks)
        .where(eq(subtasks.taskId, task.id));
      let pos = (hi ?? 0) + 1024;
      for (const item of data) {
        const assigneeId = item.assigneeId && memberIds.has(item.assigneeId) ? item.assigneeId : null;
        await tx.insert(subtasks).values({
          taskId: task.id,
          title: item.title,
          assigneeId,
          position: pos,
          createdById: viewer.id,
        });
        pos += 1024;
        await logActivity(tx, {
          workspaceId: task.workspaceId,
          taskId: task.id,
          actorId: viewer.id,
          kind: "subtask_added",
          data: { title: item.title },
        });
        if (assigneeId) {
          await tx.insert(taskFollowers).values({ taskId: task.id, userId: assigneeId }).onConflictDoNothing();
          await notify(tx, [assigneeId], {
            kind: "assigned",
            actorId: viewer.id,
            workspaceId: task.workspaceId,
            taskId: task.id,
            data: { subtask: item.title },
          });
        }
      }
      await tx.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, task.id));
    });
    return { added: data.length };
  });
}

/* -------------------------------------------------------------------------- */
/* Plan a workspace                                                            */
/* -------------------------------------------------------------------------- */

const Plan = z.object({
  name: z.string(),
  description: z.string(),
  lists: z.array(
    z.object({
      name: z.string(),
      tasks: z.array(
        z.object({
          title: z.string(),
          description: z.string(),
          dueInDays: z.number().int().nullable(),
          subtasks: z.array(z.string()),
        }),
      ),
    }),
  ),
});

export type WorkspacePlan = z.infer<typeof Plan>;

export async function planWorkspace(brief: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      const text = z
        .string()
        .trim()
        .min(10, "Describe the project in a sentence or two.")
        .max(8000)
        .parse(brief);
      const plan = await aiStructured({
        viewer,
        feature: "plan_workspace",
        system: PROMPTS.planWorkspace,
        schema: Plan,
        effort: "medium",
        content: `<brief>\n${safe(text)}\n</brief>`,
      });
      return {
        plan: {
          name: plan.name.trim().slice(0, 80) || "New project",
          description: plan.description.trim().slice(0, 500),
          lists: plan.lists.slice(0, 8).map((l) => ({
            name: l.name.trim().slice(0, 80) || "Tasks",
            tasks: l.tasks.slice(0, 15).map((t) => ({
              title: t.title.trim().slice(0, 300),
              description: t.description.trim().slice(0, 2000),
              dueInDays: t.dueInDays !== null && t.dueInDays >= 0 && t.dueInDays < 3650 ? t.dueInDays : null,
              subtasks: t.subtasks.map((s) => s.trim().slice(0, 300)).filter(Boolean).slice(0, 8),
            })),
          })),
        } satisfies WorkspacePlan,
      };
    },
    { refresh: false },
  );
}

export async function createWorkspaceFromPlan(input: {
  plan: WorkspacePlan;
  name: string;
  color: string;
  startDate: string;
  memberIds: string[];
}) {
  return run(async () => {
    const viewer = await requireActionUser();
    const data = z
      .object({
        name: z.string().trim().min(1, "Give the workspace a name.").max(80),
        color: z.string().refine(isValidColor, "Pick a colour from the palette or a hex value like #1f6fe8.").transform(normalizeColor),
        startDate: dateSchema,
        memberIds: z.array(idSchema).max(200),
        plan: z.object({
          description: z.string().max(500),
          lists: z
            .array(
              z.object({
                name: z.string().trim().min(1).max(80),
                tasks: z
                  .array(
                    z.object({
                      title: z.string().trim().min(1).max(300),
                      description: z.string().max(2000),
                      dueInDays: z.number().int().min(0).max(3650).nullable(),
                      subtasks: z.array(z.string().trim().min(1).max(300)).max(10),
                    }),
                  )
                  .max(30),
              }),
            )
            .min(1)
            .max(10),
        }),
      })
      .parse(input);

    return db.transaction(async (tx) => {
      const [ws] = await tx
        .insert(workspaces)
        .values({
          name: data.name,
          description: data.plan.description || null,
          color: data.color,
          createdById: viewer.id,
        })
        .returning({ id: workspaces.id });
      const otherIds = data.memberIds.filter((id) => id !== viewer.id);
      const others = otherIds.length
        ? (
            await tx
              .select({ id: user.id })
              .from(user)
              .where(and(inArray(user.id, otherIds), or(isNull(user.banned), eq(user.banned, false))))
          ).map((u) => u.id)
        : [];
      await tx.insert(workspaceMembers).values([
        { workspaceId: ws.id, userId: viewer.id, role: "owner" as const },
        ...others.map((userId) => ({ workspaceId: ws.id, userId, role: "member" as const })),
      ]);
      await tx.insert(taskLists).values(
        data.plan.lists.map((l, i) => ({ workspaceId: ws.id, name: l.name, position: (i + 1) * 1024 })),
      );
      const drafts = data.plan.lists.flatMap((l) =>
        l.tasks.map((t) => ({
          title: t.title,
          description: t.description,
          assigneeIds: [],
          dueDate: t.dueInDays === null ? null : shiftDate(data.startDate, t.dueInDays),
          list: l.name,
          urgent: false,
          subtasks: t.subtasks,
        })),
      );
      const created = drafts.length ? await insertDrafts(tx, ws.id, drafts, viewer.id) : 0;
      await notify(tx, others, { kind: "added_to_workspace", actorId: viewer.id, workspaceId: ws.id });
      return { id: ws.id, created };
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Smart defaults + duplicate hints                                            */
/* -------------------------------------------------------------------------- */

const Defaults = z.object({
  list: z.string().nullable(),
  assignees: z.array(z.string()),
  dueInDays: z.number().int().nullable(),
  reason: z.string(),
});

export type TaskSuggestion = {
  duplicates: { id: string; number: number; title: string; status: string; score: number }[];
  defaults: {
    taskListId: string | null;
    listName: string | null;
    assignees: { id: string; name: string }[];
    dueDate: string | null;
    reason: string;
  } | null;
};

export async function suggestTaskDefaults(workspaceId: string, title: string, withAi = true) {
  return run(
    async (): Promise<TaskSuggestion> => {
      const viewer = await requireActionUser();
      await assertWorkspaceAccess(viewer, idSchema.parse(workspaceId));
      const t = z.string().trim().min(3).max(300).parse(title);
      const recent = await recentTaskPatterns(workspaceId);

      // Duplicate hints need no AI: token overlap against open tasks.
      const duplicates = recent
        .filter((r) => r.status !== "resolved" && r.status !== "rejected")
        .map((r) => ({ id: r.id, number: r.number, title: r.title, status: r.status, score: titleSimilarity(t, r.title) }))
        .filter((r) => r.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (!withAi || !aiEnabled() || recent.length < 5) return { duplicates, defaults: null };

      const [dir] = await workspaceDirectory(viewer, workspaceId);
      if (!dir) return { duplicates, defaults: null };
      const today = await getToday();
      const out = await aiStructured({
        viewer,
        feature: "smart_defaults",
        system: PROMPTS.smartDefaults,
        schema: Defaults,
        effort: "low",
        maxTokens: 2000,
        content: [
          `Lists: ${dir.lists.map((l) => l.name).join(", ")}`,
          `Members: ${dir.members.map((m) => m.name).join(", ")}`,
          "<recent_tasks>",
          ...recent.slice(0, 80).map((r) => {
            const created = r.createdAt.toISOString().slice(0, 10);
            const days = r.dueDate ? daysUntil(r.dueDate, created) : null;
            return `${r.title} | list: ${r.list} | assignees: ${r.assignees ?? "none"} | due after: ${days === null ? "none" : `${days} days`}`;
          }),
          "</recent_tasks>",
          `<new_task_title>${t}</new_task_title>`,
        ].join("\n"),
      });
      const list = out.list ? dir.lists.find((l) => l.name.toLowerCase() === out.list!.toLowerCase()) : null;
      const assignees = matchMembers(out.assignees, dir.members, viewer.id).slice(0, 5);
      const dueDate = out.dueInDays !== null && out.dueInDays >= 0 && out.dueInDays < 365 ? shiftDate(today, out.dueInDays) : null;
      const defaults =
        list || assignees.length || dueDate
          ? {
              taskListId: list?.id ?? null,
              listName: list?.name ?? null,
              assignees: assignees.map(({ id, name }) => ({ id, name })),
              dueDate,
              reason: out.reason.trim().slice(0, 200),
            }
          : null;
      return { duplicates, defaults };
    },
    { refresh: false },
  );
}

/* -------------------------------------------------------------------------- */
/* Attachment insights                                                         */
/* -------------------------------------------------------------------------- */

const FileInsights = z.object({
  summary: z.array(z.string()),
  actionItems: z.array(z.string()),
});

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml|yaml))/;
const MAX_TEXT_CHARS = 200_000;

export async function attachmentInsights(attachmentId: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      const [file] = await db
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, idSchema.parse(attachmentId)), eq(attachments.draft, false)));
      if (!file) throw new ActionError("That file isn't available.");
      const { task } = await assertTaskAccess(viewer, file.taskId);
      const bytes = await loadFile(file);
      if (!bytes) throw new ActionError("That file couldn't be read.");

      const intro = `Task #${task.number}: ${task.title}\n${task.description ? `Task description: ${task.description.slice(0, 2000)}\n` : ""}File: ${file.name}`;
      let content: Parameters<typeof aiStructured>[0]["content"];
      if (file.contentType === "application/pdf") {
        content = [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytes.toString("base64") } },
          { type: "text", text: intro },
        ];
      } else if (isInlineSafe(file.contentType) && file.contentType.startsWith("image/") && file.contentType !== "image/avif") {
        content = [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: file.contentType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: bytes.toString("base64"),
            },
          },
          { type: "text", text: intro },
        ];
      } else if (TEXT_TYPES.test(file.contentType) || /\.(md|txt|csv|json|log)$/i.test(file.name)) {
        const text = bytes.toString("utf8");
        if (text.length > MAX_TEXT_CHARS)
          throw new ActionError("That file is too long to summarise in one go.");
        content = `${intro}\n<file_contents>\n${safe(text)}\n</file_contents>`;
      } else {
        throw new ActionError("Summaries work for PDFs, images and text files.");
      }

      const out = await aiStructured({
        viewer,
        feature: "attachment_insights",
        system: PROMPTS.attachmentInsights,
        schema: FileInsights,
        effort: "medium",
        content,
      });
      return {
        summary: out.summary.map((s) => s.trim()).filter(Boolean).slice(0, 8),
        actionItems: out.actionItems.map((s) => s.trim().slice(0, 300)).filter(Boolean).slice(0, 10),
      };
    },
    { refresh: false },
  );
}

/* -------------------------------------------------------------------------- */
/* Risks (deterministic part)                                                  */
/* -------------------------------------------------------------------------- */

export async function getWorkspaceInsights(workspaceId: string) {
  return run(
    async () => {
      const viewer = await requireActionUser();
      const result = await workspaceInsights(viewer, idSchema.parse(workspaceId));
      if (!result) throw new ActionError("You don't have access to that workspace.");
      return { insights: result.insights, openCount: result.openCount };
    },
    { refresh: false },
  );
}
