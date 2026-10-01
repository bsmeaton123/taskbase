import type { TaskStatus } from "@/db/schema";

export const STATUS_META: Record<
  TaskStatus,
  { label: string; tone: "neutral" | "accent" | "warning" | "success" | "muted" }
> = {
  open: { label: "Open", tone: "neutral" },
  in_progress: { label: "In progress", tone: "accent" },
  on_hold: { label: "On hold", tone: "warning" },
  resolved: { label: "Resolved", tone: "success" },
  rejected: { label: "Rejected", tone: "muted" },
};

export const STATUS_ORDER: TaskStatus[] = [
  "open",
  "in_progress",
  "on_hold",
  "resolved",
  "rejected",
];

export function isClosed(status: TaskStatus) {
  return status === "resolved" || status === "rejected";
}
