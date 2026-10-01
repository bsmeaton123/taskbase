import {
  addDays,
  addMonths,
  addYears,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  format,
  getDate,
  getDaysInMonth,
  getDay,
  parseISO,
  setDate,
  startOfMonth,
} from "date-fns";
import { z } from "zod";

/**
 * How a task repeats. When a repeating task is completed, the next one is created with
 * the next due date (see nextOccurrence).
 */
export type Recurrence = {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  /** Every N days / weeks / months / years. */
  interval: number;
  /** Weekly: days of the week (0 = Sunday). Empty or missing means "every N weeks". */
  weekdays?: number[];
  /** Monthly: day of the month (1 to 31, or -1 for the last day). Missing means the due date's day. */
  monthDay?: number;
  /** Count from the due date (a fixed schedule, the default) or from when it was completed. */
  from?: "due" | "completion";
  /** Stop repeating after this date (YYYY-MM-DD). */
  until?: string | null;
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const recurrenceSchema = z.object({
  freq: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(99),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  monthDay: z.number().int().min(-1).max(31).refine((d) => d !== 0).optional(),
  from: z.enum(["due", "completion"]).optional(),
  until: isoDate.nullable().optional(),
}) satisfies z.ZodType<Recurrence>;

const iso = (d: Date) => format(d, "yyyy-MM-dd");

function onMonthDay(month: Date, day: number) {
  const last = getDaysInMonth(month);
  return setDate(month, day === -1 ? last : Math.min(day, last));
}

/**
 * The first occurrence strictly after `from`. `anchor` is the original due date: monthly
 * and yearly rules keep its day (and month), so a rule that started on the 31st or on
 * 29 February clamps in short months but comes back rather than drifting.
 */
function step(rule: Recurrence, from: Date, anchor: Date): Date {
  const n = rule.interval;
  const anchorDay = rule.monthDay ?? getDate(anchor);
  switch (rule.freq) {
    case "daily":
      return addDays(from, n);
    case "weekly": {
      const days = [...new Set(rule.weekdays ?? [])];
      if (days.length === 0) return addDays(from, 7 * n);
      // Walk forward to the next chosen weekday in an "on" week (every n weeks).
      for (let i = 1; i <= 7 * n + 7; i++) {
        const d = addDays(from, i);
        const week = differenceInCalendarWeeks(d, from, { weekStartsOn: 1 });
        if (week % n === 0 && days.includes(getDay(d))) return d;
      }
      return addDays(from, 7 * n);
    }
    case "monthly":
      return onMonthDay(addMonths(startOfMonth(from), n), anchorDay);
    case "yearly": {
      const target = addYears(from, n);
      return onMonthDay(new Date(target.getFullYear(), anchor.getMonth(), 1), getDate(anchor));
    }
  }
}

/** Skips a fixed schedule forward to the first date on or after `today`, in one jump where possible. */
function catchUp(rule: Recurrence, next: Date, today: Date, anchor: Date): Date {
  if (next >= today) return next;
  const behind = differenceInCalendarDays(today, next);
  const n = rule.interval;
  if (rule.freq === "daily") return addDays(next, Math.ceil(behind / n) * n);
  if (rule.freq === "weekly") {
    // The pattern repeats every n weeks: jump whole cycles, then step to the exact day.
    const cycle = 7 * n;
    if (!rule.weekdays?.length) return addDays(next, Math.ceil(behind / cycle) * cycle);
    next = addDays(next, Math.max(0, Math.floor(behind / cycle) - 1) * cycle);
  }
  if (rule.freq === "monthly") {
    const months = (today.getFullYear() - next.getFullYear()) * 12 + today.getMonth() - next.getMonth();
    next = onMonthDay(addMonths(startOfMonth(next), Math.floor(months / n) * n), rule.monthDay ?? getDate(anchor));
  } else if (rule.freq === "yearly") {
    const years = today.getFullYear() - next.getFullYear();
    next = onMonthDay(new Date(next.getFullYear() + Math.floor(years / n) * n, anchor.getMonth(), 1), getDate(anchor));
  }
  // Weekly-with-weekdays, or the remainder after a jump: at most a few steps.
  for (let i = 0; next < today && i < 400; i++) next = step(rule, next, anchor);
  return next;
}

/**
 * The next due date after a repeating task is completed, or null when the series has
 * ended (`until`). On a fixed schedule, dates that have already passed are skipped, so a
 * weekly task completed late is next due on its next scheduled day, not in the past.
 */
export function nextOccurrence(
  rule: Recurrence,
  opts: { due: string | null; completedOn: string; today: string },
): string | null {
  const fromCompletion = rule.from === "completion" || !opts.due;
  const base = parseISO(fromCompletion ? opts.completedOn : opts.due!);
  let next = step(rule, base, base);
  if (!fromCompletion) next = catchUp(rule, next, parseISO(opts.today), base);
  const result = iso(next);
  if (rule.until && result > rule.until) return null;
  return result;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                      */
/* -------------------------------------------------------------------------- */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UNIT = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function isWeekdays(rule: Recurrence) {
  const d = [...new Set(rule.weekdays ?? [])].sort().join(",");
  return rule.freq === "weekly" && rule.interval === 1 && d === "1,2,3,4,5";
}

/** "Every week on Monday", "Every 2 weeks on Mon, Thu", "Every month on the 15th"... */
export function describeRecurrence(rule: Recurrence, dueDate?: string | null): string {
  const n = rule.interval;
  const every = n === 1 ? `Every ${UNIT[rule.freq]}` : `Every ${n} ${UNIT[rule.freq]}s`;
  let text: string;
  if (isWeekdays(rule)) {
    text = "Every weekday";
  } else if (rule.freq === "daily") {
    text = n === 1 ? "Every day" : every;
  } else if (rule.freq === "weekly") {
    const days = [...new Set(rule.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    if (days.length === 1) text = `${every} on ${DAY_NAMES[days[0]]}`;
    else if (days.length > 1) text = `${every} on ${days.map((d) => DAY_SHORT[d]).join(", ")}`;
    else if (dueDate && rule.from !== "completion")
      text = `${every} on ${DAY_NAMES[getDay(parseISO(dueDate))]}`;
    else text = every;
  } else if (rule.freq === "monthly") {
    const day = rule.monthDay ?? (dueDate ? getDate(parseISO(dueDate)) : null);
    text =
      day === -1
        ? `${every} on the last day`
        : day && rule.from !== "completion"
          ? `${every} on the ${ordinal(day)}`
          : every;
  } else {
    text =
      dueDate && rule.from !== "completion" ? `${every} on ${format(parseISO(dueDate), "d MMMM")}` : every;
  }
  if (rule.from === "completion") text += " after it's done";
  if (rule.until) text += `, until ${format(parseISO(rule.until), "d MMM yyyy")}`;
  return text;
}

/** One-tap choices, built around the task's due date (or today). */
export function recurrencePresets(anchor: string): { label: string; rule: Recurrence }[] {
  const d = parseISO(anchor);
  const weekday = getDay(d);
  const monthDay = getDate(d);
  return [
    { label: "Every day", rule: { freq: "daily", interval: 1 } },
    { label: "Every weekday (Mon to Fri)", rule: { freq: "weekly", interval: 1, weekdays: [1, 2, 3, 4, 5] } },
    { label: `Every week on ${DAY_NAMES[weekday]}`, rule: { freq: "weekly", interval: 1, weekdays: [weekday] } },
    { label: `Every 2 weeks on ${DAY_NAMES[weekday]}`, rule: { freq: "weekly", interval: 2, weekdays: [weekday] } },
    { label: `Every month on the ${ordinal(monthDay)}`, rule: { freq: "monthly", interval: 1, monthDay } },
    { label: "Every month on the last day", rule: { freq: "monthly", interval: 1, monthDay: -1 } },
    { label: `Every year on ${format(d, "d MMMM")}`, rule: { freq: "yearly", interval: 1 } },
  ];
}

/**
 * When a task's due date is moved by copying (templates shift every date), a rule that
 * was tied to the old date follows it: "every month on the 15th" for a task due on the
 * 15th becomes "on the 18th" if the copy is due on the 18th. Rules that pointed at some
 * other day, or at several weekdays ("every weekday"), are left alone.
 */
export function shiftRecurrence(rule: Recurrence, fromDue: string | null, toDue: string | null): Recurrence {
  if (!fromDue || !toDue || fromDue === toDue) return rule;
  const from = parseISO(fromDue);
  const to = parseISO(toDue);
  if (rule.freq === "monthly" && rule.monthDay !== undefined && rule.monthDay === getDate(from))
    return { ...rule, monthDay: getDate(to) };
  if (rule.freq === "weekly" && rule.weekdays?.length === 1 && rule.weekdays[0] === getDay(from))
    return { ...rule, weekdays: [getDay(to)] };
  return rule;
}

export function sameRecurrence(a: Recurrence | null | undefined, b: Recurrence | null | undefined) {
  const norm = (r: Recurrence | null | undefined) =>
    r
      ? JSON.stringify({
          freq: r.freq,
          interval: r.interval,
          weekdays: [...new Set(r.weekdays ?? [])].sort(),
          monthDay: r.monthDay ?? null,
          from: r.from ?? "due",
          until: r.until ?? null,
        })
      : null;
  return norm(a) === norm(b);
}
