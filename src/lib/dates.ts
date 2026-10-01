import {
  addDays,
  differenceInCalendarDays,
  format,
  formatDistanceToNowStrict,
  parseISO,
} from "date-fns";

/** Today's date (YYYY-MM-DD) in the given IANA time zone. */
export function todayIn(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function shiftDate(iso: string, days: number): string {
  return format(addDays(parseISO(iso), days), "yyyy-MM-dd");
}

/** Days from `today` until `iso`. Negative when in the past. */
export function daysUntil(iso: string, today: string): number {
  return differenceInCalendarDays(parseISO(iso), parseISO(today));
}

/** Short, human label for a due date relative to today. */
export function formatDue(iso: string, today: string): string {
  const diff = daysUntil(iso, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const date = parseISO(iso);
  if (diff > 1 && diff < 7) return format(date, "EEEE");
  if (date.getFullYear() === parseISO(today).getFullYear())
    return format(date, "d MMM");
  return format(date, "d MMM yyyy");
}

export function formatLongDate(iso: string): string {
  return format(parseISO(iso), "EEEE d MMMM yyyy");
}

export function timeAgo(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const seconds = (Date.now() - d.getTime()) / 1000;
  if (seconds < 45) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}

export function formatTimestamp(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "d MMM yyyy, HH:mm");
}

export type DueBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "this_week"
  | "later"
  | "no_date";

export function dueBucket(iso: string | null, today: string): DueBucket {
  if (!iso) return "no_date";
  const diff = daysUntil(iso, today);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff < 7) return "this_week";
  return "later";
}

export const DUE_BUCKET_LABELS: Record<DueBucket, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "Next 7 days",
  later: "Later",
  no_date: "No due date",
};
