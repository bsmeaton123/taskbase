import { format, parseISO } from "date-fns";
import { daysUntil, shiftDate } from "@/lib/dates";

/**
 * The team workload grid (Team page): one row per person, one column per day of a week.
 * Pure helpers, shared by the query, the server action and the grid.
 */

/** A day this busy (tasks due for one person) gets flagged. */
export const BUSY_DAY = 4;
/** Chips shown per cell before "+N more". */
export const CELL_PREVIEW = 3;
/** The row for tasks nobody is assigned to. */
export const UNASSIGNED = "unassigned";

export type ColumnKey = "overdue" | "mon" | "tue" | "wed" | "thu" | "fri" | "weekend" | "none";

export type Column = {
  key: ColumnKey;
  label: string;
  /** Short date under the label ("6 Oct"), for day columns. */
  sub?: string;
  /** The due date a dropped task gets. Null: it loses its due date ("No date"). */
  dropDate?: string | null;
  /** Days this column covers, for matching tasks to it. */
  dates?: string[];
  today?: boolean;
  /** Already past: nothing can be dropped there. */
  past?: boolean;
};

/** The Monday of the week `iso` falls in. */
export function mondayOf(iso: string): string {
  const dow = (parseISO(iso).getDay() + 6) % 7; // Monday 0 ... Sunday 6
  return shiftDate(iso, -dow);
}

/**
 * The week to show from a `?week=` value: this week unless it names a later week (up to a
 * year ahead). Earlier weeks have nothing to plan; their open work is overdue.
 */
export function weekFromParam(value: string | null | undefined, today: string): string {
  const thisWeek = mondayOf(today);
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parseISO(value).getTime()))
    return thisWeek;
  const week = mondayOf(value);
  if (week < thisWeek) return thisWeek;
  const last = shiftDate(thisWeek, 52 * 7);
  return week > last ? last : week;
}

const DAY_KEYS: ColumnKey[] = ["mon", "tue", "wed", "thu", "fri"];

/**
 * Overdue, the weekdays still to come (this week starts from today: earlier days' open work
 * is overdue), the weekend as one column, and No date.
 */
export function weekColumns(weekStart: string, today: string): Column[] {
  const days = DAY_KEYS.map((key, i) => {
    const date = shiftDate(weekStart, i);
    return {
      key,
      label: format(parseISO(date), "EEE"),
      sub: format(parseISO(date), "d MMM"),
      dropDate: date,
      dates: [date],
      today: date === today,
      past: date < today,
    } satisfies Column;
  }).filter((d) => !d.past);
  const sat = shiftDate(weekStart, 5);
  const sun = shiftDate(weekStart, 6);
  return [
    { key: "overdue", label: "Overdue" },
    ...days,
    {
      key: "weekend",
      label: "Weekend",
      sub: `${format(parseISO(sat), "d")}–${format(parseISO(sun), "d MMM")}`,
      // Saturday, unless that's already gone.
      dropDate: sat >= today ? sat : sun,
      dates: [sat, sun],
      today: sat === today || sun === today,
      past: sun < today,
    },
    { key: "none", label: "No date", dropDate: null },
  ];
}

/** Which column a task with this due date sits in this week, or null when it's outside. */
export function columnFor(
  dueDate: string | null,
  columns: Column[],
  today: string,
): ColumnKey | null {
  if (!dueDate) return "none";
  if (dueDate < today) return "overdue";
  return columns.find((c) => c.dates?.includes(dueDate))?.key ?? null;
}

export type PlanTask = { assigneeIds: string[]; startDate: string | null; dueDate: string | null };
/** A drag on the grid: from one person's row (or Unassigned) to another's, and/or a new day. */
export type Move = { from: string | null; to: string | null; dueDate: string | null };

/**
 * What a drag changes. Moving between rows hands the task over: the person it was dragged
 * from comes off, the person it lands on goes on (others assigned stay). A new due date
 * moves the start date by the same number of days, as dragging a Gantt bar does.
 */
export function planMove(task: PlanTask, move: Move) {
  const reassign = move.from !== move.to;
  const remove = reassign && move.from && task.assigneeIds.includes(move.from) ? move.from : null;
  const add = reassign && move.to && !task.assigneeIds.includes(move.to) ? move.to : null;

  let { startDate } = task;
  if (move.dueDate !== task.dueDate && move.dueDate) {
    if (task.dueDate && startDate) startDate = shiftDate(startDate, daysUntil(move.dueDate, task.dueDate));
    else if (startDate && startDate > move.dueDate) startDate = move.dueDate;
  }
  const assigneeIds = task.assigneeIds.filter((id) => id !== remove);
  if (add) assigneeIds.push(add);
  return {
    add,
    remove,
    startDate,
    dueDate: move.dueDate,
    assigneeIds,
    changed: Boolean(add || remove || move.dueDate !== task.dueDate),
  };
}
