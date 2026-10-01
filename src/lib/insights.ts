import { daysUntil } from "@/lib/dates";

/**
 * Early-warning signals, computed with plain rules so they're predictable and
 * cheap. The AI briefing explains and prioritises these; it never invents them.
 */
export type InsightTask = {
  number: number;
  title: string;
  status: "open" | "in_progress" | "on_hold" | "resolved" | "rejected";
  dueDate: string | null;
  /** Everyone the task is assigned to (empty when nobody is). */
  assigneeNames: string[];
  subtaskTotal: number;
  subtaskDone: number;
  /** Most recent comment, activity or edit (ISO date, YYYY-MM-DD). */
  lastActivity: string;
  /** When the task last entered "on hold" (ISO date), if it's on hold. */
  onHoldSince: string | null;
  /** Open tasks this one is waiting for, with their due dates. */
  blockers?: { number: number; title: string; dueDate: string | null }[];
};

export type InsightKind =
  | "overdue"
  | "due_soon_not_started"
  | "unassigned_due_soon"
  | "stale"
  | "long_on_hold"
  | "blocked_due_soon"
  | "overloaded";

export type Insight = {
  kind: InsightKind;
  severity: "high" | "medium" | "low";
  taskNumber?: number;
  title: string;
  person?: string;
  detail: string;
};

const STALE_DAYS = 14;
const ON_HOLD_DAYS = 10;

/** "Priya", "Priya and Sam", "Priya, Sam and Lee"; undefined for nobody. */
export function joinNames(names: string[]): string | undefined {
  if (names.length === 0) return undefined;
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function computeInsights(tasks: InsightTask[], today: string): Insight[] {
  const open = tasks.filter((t) => t.status !== "resolved" && t.status !== "rejected");
  const out: Insight[] = [];

  for (const t of open) {
    const due = t.dueDate ? daysUntil(t.dueDate, today) : null;
    const quiet = -daysUntil(t.lastActivity, today);
    const people = joinNames(t.assigneeNames);

    const blocked = Boolean(t.blockers?.length);
    if (due !== null && due < 0) {
      out.push({
        kind: "overdue",
        severity: due <= -7 ? "high" : "medium",
        taskNumber: t.number,
        title: t.title,
        person: people,
        detail: `${-due} day${due === -1 ? "" : "s"} overdue${blocked ? `, waiting for #${t.blockers![0].number}` : ""}`,
      });
      continue;
    }
    if (
      due !== null &&
      due <= 3 &&
      !blocked &&
      t.status === "open" &&
      (t.subtaskTotal === 0 || t.subtaskDone === 0)
    ) {
      out.push({
        kind: "due_soon_not_started",
        severity: due <= 1 ? "high" : "medium",
        taskNumber: t.number,
        title: t.title,
        person: people,
        detail: due === 0 ? "due today and not started" : `due in ${due} day${due === 1 ? "" : "s"} and not started`,
      });
    }
    if (due !== null && due <= 7 && t.blockers?.length) {
      // Waiting on something that's late, or due after this task itself.
      const worst = t.blockers.find((b) => !b.dueDate || b.dueDate >= t.dueDate!) ?? t.blockers[0];
      out.push({
        kind: "blocked_due_soon",
        severity: due <= 2 ? "high" : "medium",
        taskNumber: t.number,
        title: t.title,
        person: people,
        detail: `due in ${due} day${due === 1 ? "" : "s"} but still waiting for #${worst.number}${
          worst.dueDate ? ` (due ${worst.dueDate >= t.dueDate! ? "after it" : "soon"})` : ""
        }`,
      });
    }
    if (due !== null && due <= 7 && t.assigneeNames.length === 0) {
      out.push({
        kind: "unassigned_due_soon",
        severity: "medium",
        taskNumber: t.number,
        title: t.title,
        detail: `nobody assigned, due in ${due} day${due === 1 ? "" : "s"}`,
      });
    }
    if (t.status === "on_hold" && t.onHoldSince && -daysUntil(t.onHoldSince, today) >= ON_HOLD_DAYS) {
      out.push({
        kind: "long_on_hold",
        severity: "low",
        taskNumber: t.number,
        title: t.title,
        person: people,
        detail: `on hold for ${-daysUntil(t.onHoldSince, today)} days`,
      });
    } else if (quiet >= STALE_DAYS && t.status !== "on_hold" && !blocked) {
      out.push({
        kind: "stale",
        severity: quiet >= 30 ? "medium" : "low",
        taskNumber: t.number,
        title: t.title,
        person: people,
        detail: `no activity for ${quiet} days`,
      });
    }
  }

  // Workload: lots of open work, or a pile-up due this week, on one person. A shared task
  // counts for each of its assignees.
  const byPerson = new Map<string, { open: number; dueThisWeek: number }>();
  for (const t of open) {
    const d = t.dueDate ? daysUntil(t.dueDate, today) : null;
    for (const name of new Set(t.assigneeNames)) {
      const p = byPerson.get(name) ?? { open: 0, dueThisWeek: 0 };
      p.open++;
      if (d !== null && d >= 0 && d < 7) p.dueThisWeek++;
      byPerson.set(name, p);
    }
  }
  const counts = [...byPerson.values()].map((p) => p.open).sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
  for (const [person, p] of byPerson) {
    const heavy = p.open >= 10 || (p.open >= 5 && counts.length > 1 && p.open >= median * 2);
    if (heavy || p.dueThisWeek >= 4) {
      out.push({
        kind: "overloaded",
        severity: p.dueThisWeek >= 6 || p.open >= 15 ? "high" : "medium",
        title: person,
        person,
        detail: `${p.open} open tasks, ${p.dueThisWeek} due in the next 7 days`,
      });
    }
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export const INSIGHT_LABELS: Record<InsightKind, string> = {
  overdue: "Overdue",
  due_soon_not_started: "Due soon, not started",
  unassigned_due_soon: "No owner",
  stale: "Gone quiet",
  long_on_hold: "Stuck on hold",
  blocked_due_soon: "Waiting on another task",
  overloaded: "Heavy workload",
};

/** Token-overlap similarity for spotting likely duplicate task titles. */
export function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
    );
  const A = words(a);
  const B = words(b);
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / (A.size + B.size - shared);
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "our", "new", "this", "that", "task",
  "about", "need", "needs", "make", "get", "set",
]);
