import type { TaskStatus } from "@/db/schema";
import {
  LIMITS,
  mapStatus,
  normaliseEmail,
  personName,
  rbDate,
  rbName,
  rbText,
  rbTime,
} from "@/lib/redbooth";

/**
 * Turns one Redbooth project, as read from the API, into exactly what taskbase will
 * create: a workspace, its members, lists, tasks, subtasks, comments and files to fetch.
 * Pure, so every mapping rule is unit-tested; src/server/redbooth/import.ts writes it.
 */

type Id = string;
type Maybe<T> = T | null | undefined;

export type PlanUser = { id: Id; first_name?: Maybe<string>; last_name?: Maybe<string>; username?: Maybe<string>; email?: Maybe<string> };
export type PlanList = { id: Id; name?: Maybe<string>; position?: Maybe<number>; archived?: Maybe<boolean>; deleted?: Maybe<boolean> };
export type PlanTask = {
  id: Id;
  name?: Maybe<string>;
  task_list_id?: Maybe<Id>;
  assigned_id?: Maybe<Id>;
  user_id?: Maybe<Id>;
  status?: Maybe<string>;
  due_on?: unknown;
  urgent?: Maybe<boolean>;
  position?: Maybe<number>;
  description?: Maybe<string>;
  description_html?: Maybe<string>;
  watcher_ids?: Maybe<Id[]>;
  deleted?: Maybe<boolean>;
  created_at?: unknown;
  updated_at?: unknown;
};
export type PlanSubtask = { id: Id; task_id?: Maybe<Id>; name?: Maybe<string>; resolved?: Maybe<boolean>; position?: Maybe<number>; created_at?: unknown };
export type PlanComment = {
  id: Id;
  target_id?: Maybe<Id>;
  user_id?: Maybe<Id>;
  body?: Maybe<string>;
  body_html?: Maybe<string>;
  upload_ids?: Maybe<Id[]>;
  created_at?: unknown;
};
export type PlanPerson = { user_id?: Maybe<Id>; role?: Maybe<string> };
export type PlanFile = { id: Id; name?: Maybe<string>; mime_type?: Maybe<string>; size?: Maybe<number>; is_dir?: Maybe<boolean> };

export type LocalPerson = { id: string; active: boolean };

export type ProjectPlan = {
  workspace: { name: string; description: string; color: string };
  members: { userId: string; role: "owner" | "member" }[];
  lists: { key: string; name: string; position: number }[];
  tasks: {
    key: string;
    listKey: string;
    title: string;
    description: string;
    status: TaskStatus;
    dueDate: string | null;
    urgent: boolean;
    position: number;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    completedAt: Date | null;
    assigneeIds: string[];
    followerIds: string[];
  }[];
  subtasks: { taskKey: string; title: string; done: boolean; position: number; createdAt: Date; completedAt: Date | null }[];
  comments: { key: string; taskKey: string; authorId: string | null; body: string; createdAt: Date }[];
  files: { file: PlanFile; commentKey: string; taskKey: string; uploaderId: string | null; createdAt: Date }[];
  /** Redbooth people in this project with no active taskbase account (by email). */
  unmatched: { name: string; email: string | null }[];
  skipped: { deletedTasks: number; emptyComments: number };
};

const DEFAULT_LIST = "default";

/** Matches Redbooth users to taskbase people by email (case-insensitive). */
export function matchPeople(
  rbUsers: PlanUser[],
  local: { id: string; email: string; active: boolean }[],
): Map<Id, { name: string; email: string | null; local: LocalPerson | null }> {
  const byEmail = new Map(local.map((p) => [p.email.trim().toLowerCase(), p]));
  return new Map(
    rbUsers.map((u) => {
      const email = normaliseEmail(u.email);
      const hit = email ? byEmail.get(email) : undefined;
      return [u.id, { name: personName(u), email, local: hit ? { id: hit.id, active: hit.active } : null }];
    }),
  );
}

export function planProject(input: {
  project: { id: Id; name?: Maybe<string> };
  lists: PlanList[];
  tasks: PlanTask[];
  subtasks: PlanSubtask[];
  comments: PlanComment[];
  people: PlanPerson[];
  files: PlanFile[];
  users: ReturnType<typeof matchPeople>;
  importerId: string;
  color: string;
  /** e.g. "1 Oct 2026", for the workspace description. */
  dateLabel: string;
  now: Date;
}): ProjectPlan {
  const { users, importerId, now } = input;
  const local = (rbUserId: Maybe<Id>) => (rbUserId ? (users.get(rbUserId)?.local ?? null) : null);

  // Members: the importer owns it; matched, active project people join (admins as owners).
  const members = new Map<string, "owner" | "member">([[importerId, "owner"]]);
  const unmatched = new Map<string, { name: string; email: string | null }>();
  for (const p of input.people) {
    if (!p.user_id) continue;
    const who = users.get(p.user_id);
    const person = who?.local;
    if (person?.active) {
      const role = p.role === "admin" ? "owner" : "member";
      if (members.get(person.id) !== "owner") members.set(person.id, role);
    } else if (who && !person) unmatched.set(p.user_id, { name: who.name, email: who.email });
  }
  const isMember = (id: string | null | undefined): id is string => Boolean(id && members.has(id));

  // Lists: active ones first in Redbooth's order, then archived ones.
  const liveLists = input.lists
    .filter((l) => !l.deleted)
    .sort((a, b) => Number(Boolean(a.archived)) - Number(Boolean(b.archived)) || (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id));
  const lists = liveLists.map((l, i) => ({ key: l.id, name: rbName(l.name, LIMITS.listName, "Task list"), position: i + 1 }));
  const listKeys = new Set(lists.map((l) => l.key));

  const liveTasks = input.tasks.filter((t) => !t.deleted);
  const orphans = liveTasks.some((t) => !t.task_list_id || !listKeys.has(t.task_list_id));
  if (lists.length === 0 || orphans) lists.push({ key: DEFAULT_LIST, name: "Tasks", position: lists.length + 1 });

  const byList = new Map<string, PlanTask[]>();
  for (const t of liveTasks) {
    const key = t.task_list_id && listKeys.has(t.task_list_id) ? t.task_list_id : DEFAULT_LIST;
    byList.set(key, [...(byList.get(key) ?? []), t]);
  }

  const tasks: ProjectPlan["tasks"] = [];
  for (const [listKey, rows] of byList) {
    rows
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
      .forEach((t, i) => {
        const status = mapStatus(t.status);
        const createdAt = rbTime(t.created_at) ?? now;
        const updatedAt = rbTime(t.updated_at) ?? createdAt;
        const creator = local(t.user_id);
        const assignee = local(t.assigned_id);
        const assigneeIds = isMember(assignee?.id) ? [assignee.id] : [];
        const followers = new Set<string>(assigneeIds);
        for (const w of t.watcher_ids ?? []) {
          const id = local(w)?.id;
          if (isMember(id)) followers.add(id);
        }
        if (isMember(creator?.id)) followers.add(creator.id);
        tasks.push({
          key: t.id,
          listKey,
          title: rbName(t.name, LIMITS.taskTitle, "Untitled task"),
          description: rbText(t.description, t.description_html, LIMITS.description),
          status,
          dueDate: rbDate(t.due_on),
          urgent: Boolean(t.urgent),
          position: i + 1,
          createdById: creator?.id ?? importerId,
          createdAt,
          updatedAt,
          completedAt: status === "resolved" || status === "rejected" ? updatedAt : null,
          assigneeIds,
          followerIds: [...followers],
        });
      });
  }
  const taskKeys = new Set(tasks.map((t) => t.key));

  const bySubtaskTask = new Map<string, PlanSubtask[]>();
  for (const s of input.subtasks)
    if (s.task_id && taskKeys.has(s.task_id))
      bySubtaskTask.set(s.task_id, [...(bySubtaskTask.get(s.task_id) ?? []), s]);
  const subtasks: ProjectPlan["subtasks"] = [];
  for (const [taskKey, rows] of bySubtaskTask)
    rows
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id.localeCompare(b.id))
      .forEach((s, i) => {
        const createdAt = rbTime(s.created_at) ?? now;
        subtasks.push({
          taskKey,
          title: rbName(s.name, LIMITS.subtaskTitle, "Untitled subtask"),
          done: Boolean(s.resolved),
          position: i + 1,
          createdAt,
          completedAt: s.resolved ? createdAt : null,
        });
      });

  const filesById = new Map(input.files.map((f) => [f.id, f]));
  const comments: ProjectPlan["comments"] = [];
  const files: ProjectPlan["files"] = [];
  let emptyComments = 0;
  for (const c of input.comments) {
    if (!c.target_id || !taskKeys.has(c.target_id)) continue;
    const uploads = (c.upload_ids ?? []).map((id) => filesById.get(id)).filter((f): f is PlanFile => Boolean(f && !f.is_dir));
    const who = c.user_id ? users.get(c.user_id) : undefined;
    const author = who?.local?.id ?? null;
    // Keep who wrote it when they have no account here.
    const prefix = !author && who ? `${who.name} wrote in Redbooth:\n` : "";
    const text = rbText(c.body, c.body_html, LIMITS.comment - prefix.length);
    if (!text && uploads.length === 0) {
      emptyComments++;
      continue;
    }
    const createdAt = rbTime(c.created_at) ?? now;
    comments.push({ key: c.id, taskKey: c.target_id, authorId: author, body: prefix + text, createdAt });
    for (const file of uploads) files.push({ file, commentKey: c.id, taskKey: c.target_id, uploaderId: author, createdAt });
  }
  comments.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return {
    workspace: {
      name: rbName(input.project.name, LIMITS.workspaceName, "Redbooth project"),
      description: `Imported from Redbooth on ${input.dateLabel}.`,
      color: input.color,
    },
    members: [...members].map(([userId, role]) => ({ userId, role })),
    lists,
    tasks,
    subtasks,
    comments,
    files,
    unmatched: [...unmatched.values()],
    skipped: { deletedTasks: input.tasks.length - liveTasks.length, emptyComments },
  };
}
