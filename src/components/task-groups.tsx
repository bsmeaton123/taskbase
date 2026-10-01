"use client";

import { CaretDownIcon, CaretUpIcon, CheckSquareIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState } from "react";
import { useApp, useTaskNavigation } from "@/components/app-context";
import { DueLabel, WorkspaceMark } from "@/components/task-bits";
import { TaskRow } from "@/components/task-row";
import { cn } from "@/lib/utils";
import type { MyTask } from "@/server/queries";

export function TaskGroup({
  title,
  tasks,
  tone,
  collapseAfter,
}: {
  title: string;
  tasks: MyTask[];
  tone?: "danger";
  /**
   * Show only this many rows until "Show all" is pressed, so a long backlog (say 35
   * overdue) doesn't push the groups below it off the screen.
   */
  collapseAfter?: number;
}) {
  const { hrefFor, activeTaskId } = useTaskNavigation();
  const [open, setOpen] = useState(false);
  if (tasks.length === 0) return null;
  // Not worth hiding one or two rows; and never hide the task that's open in the panel.
  const collapsible = collapseAfter !== undefined && tasks.length > collapseAfter + 2;
  const showAll =
    !collapsible || open || tasks.slice(collapseAfter).some((t) => t.id === activeTaskId);
  const shown = showAll ? tasks : tasks.slice(0, collapseAfter);
  return (
    <section aria-label={title}>
      <div className="sticky top-0 z-[1] flex h-11 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
        <h2
          className={cn(
            "truncate text-[13.5px] font-semibold tracking-tight",
            tone === "danger" && "text-danger-text",
          )}
        >
          {title}
        </h2>
        <span className="tabular text-[12.5px] text-subtle">{tasks.length}</span>
      </div>
      {shown.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          href={hrefFor(t.id)}
          active={t.id === activeTaskId}
          workspace={t.workspace}
          subtasks={t.subtasks}
        />
      ))}
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen(!showAll)}
          aria-expanded={showAll}
          className="flex h-10 w-full items-center gap-2 border-b border-border/70 pl-4 text-left text-[13px] text-muted hover:bg-surface-2/70 hover:text-text sm:pl-14"
        >
          {showAll ? <CaretUpIcon size={13} /> : <CaretDownIcon size={13} />}
          {showAll ? (
            "Show fewer"
          ) : (
            <span>
              Show all <span className="tabular">{tasks.length}</span>
            </span>
          )}
        </button>
      )}
    </section>
  );
}

type AssignedSubtask = {
  id: string;
  title: string;
  dueDate: string | null;
  taskId: string;
  taskNumber: number;
  taskTitle: string;
  workspaceName: string;
  workspaceColor: string;
};

export function SubtaskGroup({ subtasks }: { subtasks: AssignedSubtask[] }) {
  const { hrefFor } = useTaskNavigation();
  const { today } = useApp();
  if (subtasks.length === 0) return null;
  return (
    <section aria-label="Subtasks assigned to you">
      <div className="sticky top-0 z-[1] flex h-11 items-center gap-2 border-b border-border bg-surface/95 px-4 backdrop-blur sm:px-6">
        <h2 className="truncate text-[13.5px] font-semibold tracking-tight">Subtasks assigned to you</h2>
        <span className="tabular text-[12.5px] text-subtle">{subtasks.length}</span>
      </div>
      {subtasks.map((s) => (
        <Link
          key={s.id}
          href={hrefFor(s.taskId)}
          scroll={false}
          // Same focus and right-hand columns as TaskRow, so due dates line up with the tasks.
          className="group/row flex min-h-10 items-center gap-3 border-b border-border/70 bg-surface py-2 pl-8 pr-3 outline-none hover:bg-surface-2/70 sm:pr-4"
        >
          <CheckSquareIcon size={16} className="shrink-0 text-subtle" />
          <span className="min-w-0 flex-1">
            <span className="block truncate group-focus-visible/row:underline">{s.title}</span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted">
              <WorkspaceMark color={s.workspaceColor} size={8} />
              <span className="truncate">
                {s.workspaceName}, in “{s.taskTitle}”
              </span>
            </span>
          </span>
          {s.dueDate && <DueLabel dueDate={s.dueDate} today={today} />}
          <span aria-hidden className="w-6 shrink-0 sm:w-[42px]" />
        </Link>
      ))}
    </section>
  );
}
