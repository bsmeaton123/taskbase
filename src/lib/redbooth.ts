import type { TaskStatus } from "@/db/schema";

/**
 * Turning Redbooth API values into taskbase ones. Pure functions, so the importer's
 * mapping is unit-tested without a Redbooth account.
 *
 * Redbooth API facts these rely on (https://redbooth.com/api/api-docs and the official
 * redbooth-ruby client): timestamps are Unix seconds (sometimes as strings), task due dates
 * are `due_on` (YYYY-MM-DD), statuses are new / open / hold / resolved / rejected, and text
 * comes as plain `description` / `body` plus an `_html` twin.
 */

export const LIMITS = {
  workspaceName: 80,
  listName: 80,
  taskTitle: 300,
  description: 20000,
  subtaskTitle: 300,
  comment: 10000,
} as const;

/** "new" (nobody on it yet) and "open" (assigned, not done) are both open in taskbase. */
export function mapStatus(status: unknown): TaskStatus {
  switch (status) {
    case "hold":
      return "on_hold";
    case "resolved":
      return "resolved";
    case "rejected":
      return "rejected";
    default:
      return "open";
  }
}

/** Unix seconds (number or numeric string), milliseconds, or an ISO string, as a Date. */
export function rbTime(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    return new Date(n > 1e12 ? n : n * 1000);
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A calendar date (YYYY-MM-DD) the app accepts (years 2000 to 2099), or null. */
export function rbDate(value: unknown): string | null {
  let iso: string | null = null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) iso = value.slice(0, 10);
  else {
    const d = rbTime(value);
    if (d) iso = d.toISOString().slice(0, 10);
  }
  if (!iso) return null;
  const [y, m, day] = iso.split("-").map(Number);
  const check = new Date(Date.UTC(y, m - 1, day));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== day) return null;
  return y >= 2000 && y <= 2099 ? iso : null;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

/** Readable plain text from HTML: keeps line breaks and list items, drops tags and scripts. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|pre)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      const c = code.toLowerCase();
      if (c in ENTITIES) return ENTITIES[c];
      if (c.startsWith("#x")) return String.fromCodePoint(parseInt(c.slice(2), 16));
      if (c.startsWith("#")) return String.fromCodePoint(Number(c.slice(1)));
      return m;
    });
}

/** Text from a plain field, falling back to its HTML twin; tidied and capped. */
export function rbText(plain: unknown, html: unknown, max: number): string {
  let text = typeof plain === "string" && plain.trim() ? plain : "";
  if (!text && typeof html === "string") text = htmlToText(html);
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** A one-line name (titles, list and workspace names), capped. */
export function rbName(value: unknown, max: number, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return (text || fallback).slice(0, max);
}

export function personName(u: {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email?: string | null;
}): string {
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return full || u.username || u.email || "Someone";
}

export function normaliseEmail(email: unknown): string | null {
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
}

/* -------------------------------------------------------------------------- */
/* Import progress                                                             */
/* -------------------------------------------------------------------------- */

export type ImportCounts = {
  lists: number;
  tasks: number;
  subtasks: number;
  comments: number;
  files: number;
  filesSkipped: number;
};

export type ImportProjectState = {
  id: string;
  name: string;
  status: "waiting" | "importing" | "done" | "skipped" | "failed";
  workspaceId?: string;
  counts?: ImportCounts;
  note?: string;
};

export type ImportProgress = {
  /** What's happening right now, in words ("Reading tasks", "Downloading files"). */
  step: string | null;
  projects: ImportProjectState[];
};

export const emptyCounts = (): ImportCounts => ({
  lists: 0,
  tasks: 0,
  subtasks: 0,
  comments: 0,
  files: 0,
  filesSkipped: 0,
});
