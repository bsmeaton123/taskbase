import type { TaskStatus } from "@/db/schema";

/** RFC 4180-style CSV parsing with quoted fields; delimiter is auto-detected. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"]
    .map((d) => ({ d, n: firstLine.split(d).length }))
    .sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export const IMPORT_FIELDS = [
  "title",
  "description",
  "list",
  "assignee",
  "startDate",
  "dueDate",
  "status",
  "urgent",
  "tags",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const FIELD_LABELS: Record<ImportField, string> = {
  title: "Task title",
  description: "Description",
  list: "Task list",
  assignee: "Assignees",
  startDate: "Start date",
  dueDate: "Due date",
  status: "Status",
  urgent: "Urgent",
  tags: "Tags",
};

/**
 * Header names for each field, best first. Covers Redbooth, Asana and Trello exports plus
 * plain spreadsheets. "project" is last for list: in Redbooth exports it names the workspace.
 */
const SYNONYMS: Record<ImportField, string[]> = {
  title: ["task title", "task name", "card name", "title", "task", "name", "subject", "summary"],
  description: ["task description", "card description", "description", "notes", "details", "body"],
  list: ["task list", "task list name", "tasklist", "list name", "section/column", "section", "column", "list", "stage", "project"],
  assignee: ["assignee", "assignee email", "assigned to", "assigned user", "assigned", "members", "owner", "responsible"],
  startDate: ["start date", "start on", "start_date", "startdate", "starts", "start", "begin date"],
  dueDate: ["due date", "due on", "due_date", "duedate", "deadline", "due", "end date"],
  status: ["status", "state", "completed at", "completed", "due complete", "done", "complete"],
  urgent: ["urgent", "is urgent", "priority"],
  tags: ["tags", "labels", "tag", "label", "categories", "category"],
};

/** "Design, Web; urgent" -> ["Design", "Web", "urgent"] (deduplicated, max 10). */
export function parseTags(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(/[,;|]/)) {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out.slice(0, 10);
}

const normalise = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ");

/** Best-guess column for each field: the earliest synonym in priority order that appears. */
export function guessMapping(headers: string[]): Partial<Record<ImportField, number>> {
  const mapping: Partial<Record<ImportField, number>> = {};
  const used = new Set<number>();
  const names = headers.map(normalise);
  for (const field of IMPORT_FIELDS) {
    for (const synonym of SYNONYMS[field]) {
      const index = names.findIndex((h, i) => !used.has(i) && h === synonym);
      if (index >= 0) {
        mapping[field] = index;
        used.add(index);
        break;
      }
    }
  }
  return mapping;
}

export type DateOrder = "dmy" | "mdy";

/** Guess day-first vs month-first from values like 31/12/2026 or 12/31/2026. */
export function guessDateOrder(values: string[]): DateOrder {
  for (const v of values) {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(v.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return "dmy";
}

const pad = (n: number) => String(n).padStart(2, "0");

function validDate(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Parses common date formats into YYYY-MM-DD, or null when unclear. A trailing time is ignored. */
export function parseDate(value: string, order: DateOrder): string | null {
  const v = value.trim();
  if (!v) return null;
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/.exec(v);
  if (m) return validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,].*)?$/.exec(v);
  if (m) {
    const [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return order === "dmy" ? validDate(y, b, a) : validDate(y, a, b);
  }
  const t = Date.parse(v);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    return validDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  return null;
}

export function parseStatus(value: string): TaskStatus {
  const v = normalise(value);
  if (!v) return "open";
  // A "Completed At" / "Due Complete" column: any date or timestamp means it's done.
  if (/^\d{4}-\d{2}-\d{2}/.test(v) || /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(v)) return "resolved";
  if (["done", "completed", "complete", "resolved", "closed", "yes", "true", "finished"].includes(v))
    return "resolved";
  if (["rejected", "cancelled", "canceled", "won't do", "wont do", "declined"].includes(v))
    return "rejected";
  if (["on hold", "hold", "paused", "blocked", "waiting"].includes(v)) return "on_hold";
  if (["in progress", "doing", "started", "working", "active", "in review"].includes(v))
    return "in_progress";
  return "open";
}

export function parseUrgent(value: string): boolean {
  return ["urgent", "yes", "true", "1", "high", "highest", "critical", "y"].includes(normalise(value));
}

export type PersonMatch = { id: string; name: string; email: string };

/** Matches one person by email, then full name, then first name if unique. */
export function matchPerson(value: string, people: PersonMatch[]): PersonMatch | null {
  const v = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!v) return null;
  const byEmail = people.find((p) => p.email.toLowerCase() === v);
  if (byEmail) return byEmail;
  const byName = people.find((p) => p.name.toLowerCase() === v);
  if (byName) return byName;
  const firstName = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === v);
  return firstName.length === 1 ? firstName[0] : null;
}

/** "Priya, Sam; Lee and Ana & Jo" -> ["Priya", "Sam", "Lee", "Ana", "Jo"]. */
export function splitPeople(value: string): string[] {
  return value
    .split(/\s*[,;&]\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Matches an assignee cell that may name several people, separated by commas, semicolons
 * or "and". A cell that names one person as a whole (like "Smith, Jo") still matches.
 * Returns the people found, without repeats, and the names that matched nobody.
 */
export function matchPeople(
  value: string,
  people: PersonMatch[],
): { matched: PersonMatch[]; unmatched: string[] } {
  const whole = matchPerson(value, people);
  if (whole) return { matched: [whole], unmatched: [] };
  const matched: PersonMatch[] = [];
  const unmatched: string[] = [];
  for (const part of splitPeople(value)) {
    const person = matchPerson(part, people);
    if (!person) unmatched.push(part);
    else if (!matched.some((m) => m.id === person.id)) matched.push(person);
  }
  return { matched, unmatched };
}
