"use client";

import {
  CaretDownIcon,
  ChatCircleIcon,
  CheckSquareIcon,
  DotsSixVerticalIcon,
  HourglassMediumIcon,
  PaperclipIcon,
  RepeatIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useId, useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp, useTaskNavigation } from "@/components/app-context";
import {
  AssigneeAvatars,
  DueLabel,
  StatusPill,
  TaskCheck,
  UrgentFlag,
  WorkspaceMark,
} from "@/components/task-bits";
import { InlineSubtasks } from "@/components/inline-subtasks";
import { TagList } from "@/components/tags";
import { SelectBox } from "@/components/workspace/selection";
import type { TaskStatus } from "@/db/schema";
import { formatDue } from "@/lib/dates";
import { describeRecurrence } from "@/lib/recurrence";
import { isClosed } from "@/lib/status";
import { cn, pluralize } from "@/lib/utils";
import { updateTask } from "@/server/actions/tasks";
import type { InlineSubtask, TaskSummary } from "@/server/queries";

/** After a repeating task is completed: say when the next one is due, with a link to it. */
export function announceNext(
  next: { id: string; dueDate: string },
  today: string,
  openTask: (id: string) => void,
) {
  const label = formatDue(next.dueDate, today);
  const when = label === "Today" || label === "Tomorrow" ? label.toLowerCase() : `on ${label}`;
  toast(`It repeats: the next one is due ${when}`, {
    action: { label: "Open", onClick: () => openTask(next.id) },
  });
}

export function useTaskToggle(task: { id: string; title: string; status: TaskStatus }) {
  const [status, setStatus] = useOptimistic(task.status);
  const [pending, startTransition] = useTransition();
  const { today } = useApp();
  const { openTask } = useTaskNavigation();

  function toggle() {
    if (pending) return;
    const previous = status;
    const next: TaskStatus = isClosed(status) ? "open" : "resolved";
    startTransition(async () => {
      setStatus(next);
      const res = await perform(updateTask({ id: task.id, status: next }));
      if (res.ok && next === "resolved") {
        toast.success(`Completed “${task.title}”`, {
          action: {
            label: "Undo",
            onClick: () => perform(updateTask({ id: task.id, status: previous })),
          },
        });
        if (res.data?.next) announceNext(res.data.next, today, openTask);
      }
    });
  }

  return { status, toggle, pending };
}

export function TaskMeta({
  task,
  status,
  today,
  compact,
  expander,
  hidePillOnPhones,
}: {
  task: TaskSummary;
  status: TaskStatus;
  today: string;
  compact?: boolean;
  /**
   * In a list row: keep it short on phones (the status pill shows from the sm breakpoint),
   * and show comment and file counts only when the row itself is wide enough for the title.
   */
  hidePillOnPhones?: boolean;
  /** Makes the subtask count a button that shows the subtasks under the row. */
  expander?: { open: boolean; controls: string; onToggle: () => void };
}) {
  const closed = isClosed(status);
  // Rows are @container elements (see TaskRow); board cards aren't, so they always show counts.
  const countClass = hidePillOnPhones ? "hidden @[28rem]:inline-flex" : "inline-flex";
  const subtaskLabel = `${task.subtaskDone} of ${task.subtaskTotal} subtasks done`;
  const subtaskClass = cn(
    "tabular inline-flex items-center gap-1 text-[12px]",
    task.subtaskDone === task.subtaskTotal ? "text-success" : "text-muted",
  );
  return (
    <>
      {task.urgent && !closed && <UrgentFlag />}
      {!compact && (
        <StatusPill status={status} className={hidePillOnPhones ? "hidden sm:inline-flex" : undefined} />
      )}
      {task.subtaskTotal > 0 &&
        (expander ? (
          <button
            type="button"
            aria-expanded={expander.open}
            aria-controls={expander.controls}
            aria-label={`${subtaskLabel}. ${expander.open ? "Hide" : "Show"} subtasks`}
            title={expander.open ? "Hide subtasks" : "Show subtasks"}
            onClick={(e) => {
              // The row is a link; this button sits on top of it.
              e.preventDefault();
              e.stopPropagation();
              expander.onToggle();
            }}
            className={cn(
              subtaskClass,
              "relative z-[1] -mx-1 h-6 rounded-md px-1 hover:bg-surface-3 hover:text-text",
              expander.open && "bg-surface-3 text-text",
            )}
          >
            <CheckSquareIcon size={14} />
            {task.subtaskDone}/{task.subtaskTotal}
            <CaretDownIcon
              size={10}
              weight="bold"
              className={cn("transition-transform", !expander.open && "-rotate-90")}
            />
          </button>
        ) : (
          <span className={subtaskClass} title={subtaskLabel}>
            <CheckSquareIcon size={14} />
            <span aria-hidden>
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
            <span className="sr-only">{subtaskLabel}</span>
          </span>
        ))}
      {task.commentCount > 0 && (
        <span
          className={cn("tabular items-center gap-1 text-[12px] text-muted", countClass)}
          title={pluralize(task.commentCount, "comment")}
        >
          <ChatCircleIcon size={14} />
          <span aria-hidden>{task.commentCount}</span>
          <span className="sr-only">{pluralize(task.commentCount, "comment")}</span>
        </span>
      )}
      {task.attachmentCount > 0 && (
        <span
          className={cn("tabular items-center gap-1 text-[12px] text-muted", countClass)}
          title={pluralize(task.attachmentCount, "file")}
        >
          <PaperclipIcon size={14} />
          <span aria-hidden>{task.attachmentCount}</span>
          <span className="sr-only">{pluralize(task.attachmentCount, "file")}</span>
        </span>
      )}
      {task.openBlockers > 0 && !closed && (
        <span
          className="inline-flex items-center gap-1 text-[12px] text-warning-text"
          title={`Waiting for ${pluralize(task.openBlockers, "task")} to be done first`}
        >
          <HourglassMediumIcon size={14} aria-hidden />
          <span className="sr-only">Waiting for {pluralize(task.openBlockers, "task")}</span>
        </span>
      )}
      {task.recurrence && !closed && (
        <span className="inline-flex text-muted" title={describeRecurrence(task.recurrence, task.dueDate)}>
          <RepeatIcon
            size={14}
            role="img"
            aria-label={describeRecurrence(task.recurrence, task.dueDate)}
          />
        </span>
      )}
      {task.dueDate && <DueLabel dueDate={task.dueDate} today={today} closed={closed} />}
    </>
  );
}

export function TaskRow({
  task,
  href,
  active,
  workspace,
  drag,
  dragging,
  overlay,
  select,
  subtasks,
}: {
  task: TaskSummary;
  href: string;
  active?: boolean;
  workspace?: { name: string; color: string };
  drag?: { row: React.HTMLAttributes<HTMLElement>; handle: React.HTMLAttributes<HTMLElement> };
  dragging?: boolean;
  overlay?: boolean;
  /** Selection mode: the row toggles selection instead of opening the task. */
  select?: { selected: boolean; onToggle: (range: boolean) => void };
  /** This task's subtasks, to show under the row when expanded. */
  subtasks?: InlineSubtask[];
}) {
  const { today } = useApp();
  const { status, toggle } = useTaskToggle(task);
  const closed = isClosed(status);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const canExpand = Boolean(subtasks?.length) && !overlay && !select;
  const expander = canExpand
    ? { open: expanded, controls: listId, onToggle: () => setExpanded((v) => !v) }
    : undefined;

  const content = (
    <>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "truncate text-[14px] group-focus-visible/row:underline",
              closed ? "text-subtle line-through decoration-subtle/60" : "text-text",
            )}
          >
            {task.title}
          </span>
          <TagList tags={task.tags} max={2} className="hidden shrink-0 @[44rem]:inline-flex" />
        </span>
        {workspace && (
          <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
            <WorkspaceMark color={workspace.color} size={8} />
            <span className="truncate">{workspace.name}</span>
            <span className="font-mono text-[11px] text-subtle">#{task.number}</span>
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2.5 sm:gap-3">
        <TaskMeta task={task} status={status} today={today} expander={expander} hidePillOnPhones />
      </span>
      {/* Room for two stacked avatars keeps due dates lined up in most rows. */}
      <span className="inline-flex min-w-6 shrink-0 justify-end sm:min-w-[42px]">
        {task.assignees.length > 0 ? (
          <AssigneeAvatars
            people={task.assignees}
            compactOnPhones
            ring={select?.selected || active ? "ring-accent-soft" : "ring-surface"}
          />
        ) : (
          <span
            className="size-6 rounded-full border border-dashed border-border-strong"
            title="Unassigned"
          >
            <span className="sr-only">Unassigned</span>
          </span>
        )}
      </span>
    </>
  );

  if (select) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={select.selected}
        aria-label={task.title}
        onClick={(e) => select.onToggle(e.shiftKey)}
        className={cn(
          // An inset ring for focus, so a focused row keeps its selected tint.
          "flex min-h-10 w-full select-none items-center gap-3 border-b border-border/70 pl-2.5 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent sm:pr-4",
          select.selected ? "bg-accent-soft/60" : "bg-surface hover:bg-surface-2/70",
          "[contain-intrinsic-size:auto_41px] [content-visibility:auto]",
        )}
      >
        <span className="inline-flex w-4 shrink-0 justify-center">
          <SelectBox checked={select.selected} />
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-3 self-stretch py-2">{content}</span>
      </button>
    );
  }

  const row = (
    <div
      className={cn(
        "group/row relative flex min-h-10 items-center gap-2.5 border-b border-border/70 pl-2 pr-3 sm:pr-4",
        active ? "bg-accent-soft/70" : "bg-surface hover:bg-surface-2/70",
        dragging && "opacity-40",
        // A list of hundreds of tasks only draws the rows on screen (they stay in the page
        // for find, focus and drag); "auto" remembers each row's real height once drawn.
        overlay
          ? "rounded-lg border border-border shadow-pop"
          : "[contain-intrinsic-size:auto_41px] [content-visibility:auto]",
      )}
      {...drag?.row}
    >
      <span
        className={cn(
          "inline-flex w-4 shrink-0 justify-center rounded text-subtle",
          drag
            ? "cursor-grab touch-none opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100"
            : "invisible",
        )}
        aria-label={drag ? `Reorder ${task.title}` : undefined}
        aria-hidden={drag ? undefined : true}
        {...drag?.handle}
      >
        <DotsSixVerticalIcon size={14} weight="bold" />
      </span>
      <TaskCheck status={status} onToggle={toggle} title={task.title} />
      <Link
        href={href}
        scroll={false}
        draggable={false}
        className="group/row @container flex min-w-0 flex-1 items-center gap-3 self-stretch py-2 outline-none"
      >
        {content}
      </Link>
    </div>
  );

  if (!canExpand) return row;
  return (
    <>
      {row}
      {expanded && <InlineSubtasks id={listId} subtasks={subtasks!} />}
    </>
  );
}
