/**
 * My tasks > Updates: other people's changes and comments on tasks you follow, grouped into
 * cards. Pure helpers (grouping, before > after wording, times) so they can be unit tested;
 * the query lives in src/server/updates.ts.
 */
import type { ActivityData, ActivityKind, TaskStatus } from "@/db/schema";
import { formatDue } from "@/lib/dates";
import { STATUS_META } from "@/lib/status";

/** How far back the Updates tab looks. */
export const UPDATES_WINDOW_DAYS = 30;
/** Changes by one person on one task this close together share a card. */
export const GROUP_GAP_MS = 10 * 60 * 1000;
/** Most cards shown at once. */
export const MAX_UPDATE_CARDS = 100;

export type UpdateItemRef = { kind: "activity" | "comment"; id: string };

export type UpdateItem =
  | {
      type: "activity";
      id: string;
      taskId: string;
      actorId: string | null;
      createdAt: Date;
      kind: ActivityKind;
      data: ActivityData;
    }
  | {
      type: "comment";
      id: string;
      taskId: string;
      actorId: string | null;
      createdAt: Date;
      /** Plain-text excerpt, mentions shown as names. */
      excerpt: string;
      fileCount: number;
    };

export type UpdateGroup<T extends UpdateItem = UpdateItem> = {
  taskId: string;
  actorId: string | null;
  /** Oldest first. */
  items: T[];
  /** Time of the newest item. */
  at: Date;
};

/**
 * Groups items into cards: consecutive items by the same person on the same task, each
 * within `gapMs` of the one before, share a card. Someone else's update on that task in
 * between starts a new card. Cards come back newest first.
 */
export function groupUpdates<T extends UpdateItem>(
  items: T[],
  gapMs = GROUP_GAP_MS,
): UpdateGroup<T>[] {
  const sorted = [...items].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const latestByTask = new Map<string, UpdateGroup<T>>();
  const groups: UpdateGroup<T>[] = [];
  for (const item of sorted) {
    const current = latestByTask.get(item.taskId);
    if (
      current &&
      current.actorId === item.actorId &&
      item.createdAt.getTime() - current.at.getTime() <= gapMs
    ) {
      current.items.push(item);
      current.at = item.createdAt;
      continue;
    }
    const group: UpdateGroup<T> = {
      taskId: item.taskId,
      actorId: item.actorId,
      items: [item],
      at: item.createdAt,
    };
    groups.push(group);
    latestByTask.set(item.taskId, group);
  }
  return groups.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export type UpdateVerb = "created" | "restored" | "commented" | "updated";

export type UpdateLine =
  | { type: "activity"; id: string; kind: ActivityKind; data: ActivityData }
  | { type: "comment"; id: string; excerpt: string; fileCount: number };

/** Kinds that record `from` and `to`: repeated changes in one card collapse into one line. */
const MERGEABLE = new Set<ActivityKind>(["due_changed", "start_changed", "status_changed", "renamed"]);
/** Said by the card's heading instead of a line. */
const HEADLINE_KINDS = new Set<ActivityKind>(["task_created", "restored"]);

const isMergeable = (l: UpdateLine) =>
  l.type === "activity" && MERGEABLE.has(l.kind) && "from" in l.data && "to" in l.data;

/**
 * What a card says: its verb ("created the task", "commented on the task"...) and one line
 * per change, oldest first. Repeated changes to the same field merge into one before > after
 * line, and a field changed and then changed back drops out.
 */
export function summariseGroup(items: UpdateItem[]): { verb: UpdateVerb; lines: UpdateLine[] } {
  const kinds = new Set(items.map((i) => (i.type === "activity" ? i.kind : "comment")));
  const verb: UpdateVerb = kinds.has("task_created")
    ? "created"
    : kinds.has("restored")
      ? "restored"
      : items.every((i) => i.type === "comment")
        ? "commented"
        : "updated";

  const lines: UpdateLine[] = [];
  for (const item of items) {
    if (item.type === "comment") {
      lines.push({ type: "comment", id: item.id, excerpt: item.excerpt, fileCount: item.fileCount });
      continue;
    }
    if (HEADLINE_KINDS.has(item.kind)) continue;
    const line: UpdateLine = { type: "activity", id: item.id, kind: item.kind, data: item.data };
    if (isMergeable(line)) {
      const earlier = lines.findIndex((l) => isMergeable(l) && l.type === "activity" && l.kind === item.kind);
      if (earlier !== -1) {
        const prev = lines[earlier] as Extract<UpdateLine, { type: "activity" }>;
        // Keep the line where it first appeared: first "from", latest "to".
        lines[earlier] = { ...prev, data: { ...item.data, from: prev.data.from ?? null } };
        continue;
      }
    }
    lines.push(line);
  }

  return {
    verb,
    lines: lines.filter(
      (l) => !(isMergeable(l) && l.type === "activity" && (l.data.from ?? null) === (l.data.to ?? null)),
    ),
  };
}

/** One card on the Updates tab. */
export type UpdateCard = {
  /** The newest item's id. */
  id: string;
  task: { id: string; number: number; title: string };
  workspace: { id: string; name: string; color: string };
  actor: { id: string; name: string; image: string | null } | null;
  verb: UpdateVerb;
  lines: UpdateLine[];
  /** Everything the card stands for, so dismissing it hides all of it. */
  items: UpdateItemRef[];
  /** When the newest item happened, and that as text in the viewer's time zone. */
  at: Date;
  time: string;
};

export type ChangePair = { label: string; from: string; to: string };

const statusLabel = (v: ActivityData[string]) =>
  STATUS_META[v as TaskStatus]?.label ?? String(v ?? "None");

/**
 * Before > after for changes that record both values ("29 Sep" > "Today"). Null when the
 * activity only records the new value, so the caller falls back to the activity's wording.
 */
export function changePair(
  kind: ActivityKind,
  data: ActivityData,
  today: string,
): ChangePair | null {
  if (!("from" in data) || !("to" in data)) return null;
  const date = (v: ActivityData[string]) => (v ? formatDue(String(v), today) : "No date");
  switch (kind) {
    case "due_changed":
      return { label: "Due date", from: date(data.from), to: date(data.to) };
    case "start_changed":
      return { label: "Start date", from: date(data.from), to: date(data.to) };
    case "status_changed":
      return { label: "Status", from: statusLabel(data.from), to: statusLabel(data.to) };
    case "renamed":
      return { label: "Title", from: `“${data.from ?? ""}”`, to: `“${data.to ?? ""}”` };
    default:
      return null;
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Calendar date and clock time of `date` in `timeZone`, as numbers. */
function zonedParts(date: Date, timeZone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    if (timeZone === "UTC") throw new Error("Can't format dates");
    return zonedParts(date, "UTC");
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, min: get("minute") };
}

/**
 * When an update happened: "4:09 pm" today, "Yesterday 3:06 pm", "Tue 4:09 pm" within the
 * week, then "29 Sep, 4:09 pm" (plus the year once it's a different one). Built from numbers
 * rather than locale strings so it reads the same everywhere.
 */
export function formatUpdateTime(date: Date, now: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const n = zonedParts(now, timeZone);
  const clock = `${p.h % 12 === 0 ? 12 : p.h % 12}:${String(p.min).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`;
  const day = Date.UTC(p.y, p.m - 1, p.d);
  const days = Math.round((Date.UTC(n.y, n.m - 1, n.d) - day) / 86_400_000);
  if (days <= 0) return clock;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${WEEKDAYS[new Date(day).getUTCDay()]} ${clock}`;
  const md = `${p.d} ${MONTHS[p.m - 1]}`;
  return p.y === n.y ? `${md}, ${clock}` : `${md} ${p.y}, ${clock}`;
}

/** The count on the Updates tab: "99+" past that. */
export function updatesCountLabel(count: number): string {
  return count > 99 ? "99+" : String(count);
}
