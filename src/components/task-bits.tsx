"use client";

import {
  CheckCircleIcon,
  CheckIcon,
  CircleDashedIcon,
  CircleHalfIcon,
  FlagIcon,
  PauseCircleIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/ssr";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import type { TaskStatus } from "@/db/schema";
import { workspaceSwatch } from "@/lib/colors";
import { daysUntil, formatDue } from "@/lib/dates";
import { isClosed, STATUS_META } from "@/lib/status";
import { cn } from "@/lib/utils";

const STATUS_COLOR: Record<TaskStatus, string> = {
  open: "text-subtle",
  in_progress: "text-accent",
  on_hold: "text-warning",
  resolved: "text-success",
  rejected: "text-subtle",
};

export function StatusIcon({
  status,
  size = 16,
  className,
}: {
  status: TaskStatus;
  size?: number;
  className?: string;
}) {
  const props = { size, className: cn(STATUS_COLOR[status], className) };
  switch (status) {
    case "in_progress":
      return <CircleHalfIcon weight="fill" {...props} />;
    case "on_hold":
      return <PauseCircleIcon weight="fill" {...props} />;
    case "resolved":
      return <CheckCircleIcon weight="fill" {...props} />;
    case "rejected":
      return <XCircleIcon weight="fill" {...props} />;
    default:
      return <CircleDashedIcon weight="bold" {...props} />;
  }
}

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  if (status === "open") return null;
  const tone = {
    in_progress: "bg-accent-soft text-accent-text",
    on_hold: "bg-warning-soft text-warning-text",
    resolved: "bg-success-soft text-success",
    rejected: "bg-surface-3 text-muted",
  }[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-[11.5px] font-medium",
        tone,
        className,
      )}
    >
      {STATUS_META[status].label}
    </span>
  );
}

/** Round checkbox for tasks. Checked = resolved. */
export function TaskCheck({
  status,
  onToggle,
  disabled,
  size = "md",
  title,
}: {
  status: TaskStatus;
  onToggle: () => void;
  disabled?: boolean;
  size?: "md" | "lg";
  /** The task's title, for the accessible name ("Complete Write the copy"). */
  title?: string;
}) {
  const done = isClosed(status);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={`${done ? "Reopen" : "Complete"} ${title ?? "task"}`}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onToggle();
      }}
      className={cn(
        // The ::after pad gives a thumb-sized hit area without changing how it looks.
        "group/check relative inline-flex shrink-0 items-center justify-center rounded-full border transition-[background-color,border-color,opacity] after:absolute after:-inset-1.5 after:rounded-full disabled:pointer-events-none disabled:opacity-50",
        size === "lg" ? "size-5" : "size-[17px]",
        done
          ? cn(
              "hover:opacity-80",
              status === "rejected"
                ? "border-subtle bg-subtle text-bg"
                : "border-success bg-success text-accent-fg",
            )
          : "border-border-strong bg-surface hover:border-success hover:bg-success-soft",
      )}
    >
      {status === "rejected" ? (
        <XCircleIcon size={size === "lg" ? 20 : 17} weight="fill" className="absolute" />
      ) : (
        <CheckIcon
          size={size === "lg" ? 11 : 10}
          weight="bold"
          className={cn(
            "transition-opacity",
            done ? "opacity-100" : "text-success opacity-0 group-hover/check:opacity-100",
          )}
        />
      )}
    </button>
  );
}

/** Square checkbox for subtasks. */
export function SubtaskCheck({
  done,
  onToggle,
  label,
}: {
  done: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={label}
      onClick={onToggle}
      className={cn(
        "relative inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-[background-color,border-color,opacity] after:absolute after:-inset-1.5",
        done
          ? "border-success bg-success text-accent-fg hover:opacity-80"
          : "border-border-strong bg-surface hover:border-success hover:bg-success-soft",
      )}
    >
      {done && <CheckIcon size={10} weight="bold" />}
    </button>
  );
}

export function DueLabel({
  dueDate,
  today,
  closed,
  className,
}: {
  dueDate: string;
  today: string;
  closed?: boolean;
  className?: string;
}) {
  const diff = daysUntil(dueDate, today);
  const overdue = !closed && diff < 0;
  const label = formatDue(dueDate, today);
  return (
    <span
      className={cn(
        "tabular inline-flex items-center gap-1 whitespace-nowrap text-[12.5px]",
        closed
          ? "text-subtle"
          : diff < 0
            ? "font-medium text-danger-text"
            : diff === 0
              ? "font-medium text-warning-text"
              : "text-muted",
        className,
      )}
      title={overdue ? `Overdue: was due ${label}` : !closed && diff === 0 ? "Due today" : `Due ${label}`}
    >
      {overdue && <WarningCircleIcon size={12} weight="fill" aria-hidden className="shrink-0" />}
      {overdue && <span className="sr-only">Overdue, was due </span>}
      {label}
    </span>
  );
}

export function UrgentFlag({ className }: { className?: string }) {
  return (
    <FlagIcon
      size={14}
      weight="fill"
      className={cn("shrink-0 text-danger-text", className)}
      role="img"
      aria-label="Urgent"
    />
  );
}

type AssigneePerson = { id: string; name: string; image?: string | null };

/**
 * A task's assignees on a row, card or Gantt bar: up to three stacked avatars, then "+N"
 * with the rest in its tooltip. With `compactOnPhones`, phones show only the first avatar
 * with a small count on it, so rows keep the same width as with one assignee.
 */
export function AssigneeAvatars({
  people,
  size = "sm",
  ring = "ring-surface",
  compactOnPhones,
  className,
}: {
  people: AssigneePerson[];
  size?: "xs" | "sm";
  /** Matches the background behind the avatars. */
  ring?: string;
  compactOnPhones?: boolean;
  className?: string;
}) {
  if (people.length === 0) return null;
  const stack = (extra?: string) => (
    <AvatarStack people={people} max={3} size={size} ring={ring} className={cn(extra, className)} />
  );
  if (!compactOnPhones) return stack();
  const others = people.slice(1);
  return (
    <>
      <span className={cn("relative inline-flex shrink-0 sm:hidden", className)}>
        <Avatar person={people[0]} size={size} />
        {others.length > 0 && (
          <span
            aria-label={`and ${others.map((p) => p.name).join(", ")}`}
            className={cn(
              "tabular absolute -bottom-1 -right-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-surface-3 px-0.5 text-[9px] font-semibold leading-none text-muted ring-2",
              ring,
            )}
          >
            +{others.length}
          </span>
        )}
      </span>
      {stack("hidden sm:flex")}
    </>
  );
}

export function WorkspaceMark({
  color,
  size = 10,
  className,
}: {
  color: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-[3px]", className)}
      style={{ width: size, height: size, background: workspaceSwatch(color) }}
    />
  );
}
