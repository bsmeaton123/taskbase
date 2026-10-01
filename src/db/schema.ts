import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { newId } from "@/lib/id";
import type { Recurrence } from "@/lib/recurrence";
import type { ImportProgress } from "@/lib/redbooth";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => newId());

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* -------------------------------------------------------------------------- */
/* Better Auth tables (user, session, account, verification)                   */
/* Field names follow Better Auth's core schema plus the admin plugin fields.  */
/* -------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  /** "all" | "important" (assignments, mentions, invites) | "none" */
  emailNotifications: text("email_notifications").notNull().default("important"),
  /** A morning email listing tasks overdue or due today. */
  dailyReminder: boolean("daily_reminder").notNull().default(true),
  /** The local date (YYYY-MM-DD) the last daily reminder was for, so it goes once a day. */
  dailyReminderSentOn: date("daily_reminder_sent_on", { mode: "string" }),
  /** "Clear all" on My tasks > Updates: updates up to this moment are hidden. */
  updatesClearedAt: timestamp("updates_cleared_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* -------------------------------------------------------------------------- */
/* Invites: single-use sign-up links created by admins                        */
/* -------------------------------------------------------------------------- */

export const invites = pgTable(
  "invites",
  {
    id: id(),
    token: text("token").notNull().unique(),
    /** When set, only this address can use the invite. */
    email: text("email"),
    role: text("role").notNull().default("user"),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedById: text("used_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("invites_created_idx").on(t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

export const workspaceRole = pgEnum("workspace_role", ["owner", "member"]);

export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("slate"),
  createdById: text("created_by_id").references(() => user.id, {
    onDelete: "set null",
  }),
  /** Templates are blueprints: listed for everyone, hidden from sidebars and My tasks. */
  isTemplate: boolean("is_template").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRole("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Task lists, tasks, subtasks                                                 */
/* -------------------------------------------------------------------------- */

export const taskLists = pgTable(
  "task_lists",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: doublePrecision("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("task_lists_workspace_idx").on(t.workspaceId)],
);

export const taskStatus = pgEnum("task_status", [
  "open",
  "in_progress",
  "on_hold",
  "resolved",
  "rejected",
]);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    number: integer("number").notNull().unique().generatedAlwaysAsIdentity(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskListId: text("task_list_id")
      .notNull()
      .references(() => taskLists.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatus("status").notNull().default("open"),
    urgent: boolean("urgent").notNull().default(false),
    startDate: date("start_date", { mode: "string" }),
    dueDate: date("due_date", { mode: "string" }),
    /** Repeat rule (see src/lib/recurrence.ts). Completing the task creates the next one. */
    recurrence: jsonb("recurrence").$type<Recurrence>(),
    /** The completed task this one was created from, for repeating tasks. */
    recurredFromId: text("recurred_from_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    position: doublePrecision("position").notNull().default(0),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_workspace_idx").on(t.workspaceId),
    index("tasks_list_idx").on(t.taskListId, t.position),
  ],
);

export const subtasks = pgTable(
  "subtasks",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    assigneeId: text("assignee_id").references(() => user.id, {
      onDelete: "set null",
    }),
    dueDate: date("due_date", { mode: "string" }),
    position: doublePrecision("position").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("subtasks_task_idx").on(t.taskId, t.position)],
);

/** The people a task is assigned to (any number). Subtasks keep a single assignee. */
export const taskAssignees = pgTable(
  "task_assignees",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** When they were added: assignees are listed in this order. */
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_assignees_user_idx").on(t.userId),
  ],
);

export const taskFollowers = pgTable(
  "task_followers",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.userId] }),
    index("task_followers_user_idx").on(t.userId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Comments and activity                                                       */
/* -------------------------------------------------------------------------- */

/** Labels for grouping and filtering tasks, per workspace. */
export const tags = pgTable(
  "tags",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull().default("slate"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_workspace_name_idx").on(t.workspaceId, sql`lower(${t.name})`)],
);

export const taskTags = pgTable(
  "task_tags",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_tag_idx").on(t.tagId)],
);

/** "taskId is blocked by dependsOnId": dependsOnId has to be done first. Same workspace. */
export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnId: text("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    createdById: text("created_by_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnId] }),
    index("task_dependencies_depends_on_idx").on(t.dependsOnId),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => user.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("comments_task_idx").on(t.taskId, t.createdAt)],
);

export type ActivityData = Record<string, string | number | boolean | null>;

export const activityKind = pgEnum("activity_kind", [
  "task_created",
  "renamed",
  "status_changed",
  "assigned",
  "unassigned",
  "due_changed",
  "urgent_changed",
  "moved",
  "subtask_added",
  "subtask_completed",
  "subtask_reopened",
  "file_added",
  "start_changed",
  "recurrence_changed",
  "recurred",
  "blocker_added",
  "blocker_removed",
  "tag_added",
  "tag_removed",
  "restored",
]);

export const activities = pgTable(
  "activities",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    kind: activityKind("kind").notNull(),
    data: jsonb("data").$type<ActivityData>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("activities_task_idx").on(t.taskId, t.createdAt),
    index("activities_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Attachments                                                                 */
/* -------------------------------------------------------------------------- */

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id").references(() => user.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    /** Where the bytes live: "db" (attachment_blobs) or "disk" (UPLOAD_DIR). */
    storage: text("storage").notNull(),
    /** Uploaded from the comment box but the comment hasn't been posted yet. */
    draft: boolean("draft").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("attachments_task_idx").on(t.taskId, t.createdAt),
    index("attachments_comment_idx").on(t.commentId),
  ],
);

export const attachmentBlobs = pgTable("attachment_blobs", {
  attachmentId: text("attachment_id")
    .primaryKey()
    .references(() => attachments.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

/* -------------------------------------------------------------------------- */
/* Trash                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Deleted tasks, kept for 30 days so they can be restored. `snapshot` holds every row that
 * belonged to the task (the task, subtasks, comments, files, history, tags, links,
 * followers) exactly as Postgres's to_jsonb saved them; restoring puts them back with
 * jsonb_populate_record. See src/server/trash.ts.
 *
 * Adding a NOT NULL column to one of those tables? Backfill it into existing snapshots in
 * the migration, or older trash can't be restored.
 */
export const trashedTasks = pgTable(
  "trashed_tasks",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** The original task's id and number (the task row itself is gone). */
    taskId: text("task_id").notNull().unique(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    listName: text("list_name"),
    deletedById: text("deleted_by_id").references(() => user.id, { onDelete: "set null" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    index("trashed_tasks_workspace_idx").on(t.workspaceId, t.deletedAt),
    index("trashed_tasks_number_idx").on(t.number),
    index("trashed_tasks_deleted_idx").on(t.deletedAt),
  ],
);

/** Bytes of database-stored files on trashed tasks, set aside until restore or purge. */
export const trashedBlobs = pgTable(
  "trashed_blobs",
  {
    attachmentId: text("attachment_id").primaryKey(),
    trashId: text("trash_id")
      .notNull()
      .references(() => trashedTasks.id, { onDelete: "cascade" }),
    data: bytea("data").notNull(),
  },
  (t) => [index("trashed_blobs_trash_idx").on(t.trashId)],
);

/* -------------------------------------------------------------------------- */
/* Redbooth import                                                             */
/* -------------------------------------------------------------------------- */

/** An admin's Redbooth sign-in. Tokens are sealed with src/server/secret-box.ts. */
export const redboothConnections = pgTable("redbooth_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  redboothName: text("redbooth_name"),
  redboothEmail: text("redbooth_email"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One run of the importer; progress is updated as it goes. */
export const redboothImports = pgTable(
  "redbooth_imports",
  {
    id: id(),
    startedById: text("started_by_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status").$type<"running" | "done" | "failed">().notNull().default("running"),
    progress: jsonb("progress").$type<ImportProgress>().notNull(),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("redbooth_imports_created_idx").on(t.createdAt)],
);

/** Which Redbooth project became which workspace, so a project is never imported twice. */
export const redboothImportedProjects = pgTable("redbooth_imported_projects", {
  projectId: text("project_id").primaryKey(),
  workspaceId: text("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
  importId: text("import_id").references(() => redboothImports.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  importedAt: createdAt(),
});

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export const notificationKind = pgEnum("notification_kind", [
  "assigned",
  "mentioned",
  "commented",
  "status_changed",
  "added_to_workspace",
  "unblocked",
]);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "set null",
    }),
    kind: notificationKind("kind").notNull(),
    workspaceId: text("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comments.id, {
      onDelete: "cascade",
    }),
    data: jsonb("data").$type<ActivityData>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Updates: per-person dismissals on My tasks > Updates                        */
/* -------------------------------------------------------------------------- */

export const updateItemKind = pgEnum("update_item_kind", ["activity", "comment"]);

/**
 * Updates someone dismissed one by one (an activity or a comment id). Updates only go back
 * 30 days, so rows older than that are pruned. "Clear all" uses user.updates_cleared_at.
 */
export const updateDismissals = pgTable(
  "update_dismissals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    itemKind: updateItemKind("item_kind").notNull(),
    itemId: text("item_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemKind, t.itemId] })],
);

/* -------------------------------------------------------------------------- */
/* AI usage: one row per Claude request (quota + cost visibility)             */
/* -------------------------------------------------------------------------- */

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: id(),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    ok: boolean("ok").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt)],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  taskLists: many(taskLists),
  tasks: many(tasks),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(user, {
      fields: [workspaceMembers.userId],
      references: [user.id],
    }),
  }),
);

export const taskListsRelations = relations(taskLists, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [taskLists.workspaceId],
    references: [workspaces.id],
  }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [tasks.workspaceId],
    references: [workspaces.id],
  }),
  taskList: one(taskLists, {
    fields: [tasks.taskListId],
    references: [taskLists.id],
  }),
  assignees: many(taskAssignees),
  subtasks: many(subtasks),
  comments: many(comments),
}));

export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, { fields: [taskAssignees.taskId], references: [tasks.id] }),
  user: one(user, { fields: [taskAssignees.userId], references: [user.id] }),
}));

export const subtasksRelations = relations(subtasks, ({ one }) => ({
  task: one(tasks, { fields: [subtasks.taskId], references: [tasks.id] }),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  author: one(user, { fields: [comments.authorId], references: [user.id] }),
}));

export type User = typeof user.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type TaskList = typeof taskLists.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Subtask = typeof subtasks.$inferSelect;
export type Comment = typeof comments.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type TaskStatus = (typeof taskStatus.enumValues)[number];
export type ActivityKind = (typeof activityKind.enumValues)[number];
