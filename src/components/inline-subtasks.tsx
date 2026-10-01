"use client";

import { useOptimistic, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import { DueLabel, SubtaskCheck } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { updateSubtask } from "@/server/actions/subtasks";
import type { InlineSubtask } from "@/server/queries";

/**
 * A task's subtasks shown under its row in the list, so they can be read and ticked off
 * without opening the task. The checkboxes line up with the task title (TaskRow puts it
 * 61px in), and the avatar column matches the row's so due dates line up too.
 */
export function InlineSubtasks({ id, subtasks }: { id: string; subtasks: InlineSubtask[] }) {
  const { today } = useApp();
  const [items, setDone] = useOptimistic(
    subtasks,
    (state: InlineSubtask[], change: { id: string; done: boolean }) =>
      state.map((s) => (s.id === change.id ? { ...s, done: change.done } : s)),
  );
  const [, startTransition] = useTransition();

  return (
    <ul id={id} aria-label="Subtasks" className="border-b border-border/70 bg-surface-2/40 py-1">
      {items.map((s) => (
        <li key={s.id} className="flex min-h-8 items-center gap-2.5 pl-[61px] pr-3 sm:pr-4">
          <SubtaskCheck
            done={s.done}
            label={s.done ? `Reopen ${s.title}` : `Complete ${s.title}`}
            onToggle={() =>
              startTransition(async () => {
                setDone({ id: s.id, done: !s.done });
                await perform(updateSubtask({ id: s.id, done: !s.done }));
              })
            }
          />
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-[13px]",
              s.done ? "text-subtle line-through decoration-subtle/60" : "text-text",
            )}
          >
            {s.title}
          </span>
          {s.dueDate && !s.done && <DueLabel dueDate={s.dueDate} today={today} />}
          <span className="ml-0.5 inline-flex w-6 shrink-0 justify-end sm:w-[42px]">
            {s.assignee && <Avatar person={s.assignee} size="xs" />}
          </span>
        </li>
      ))}
    </ul>
  );
}
