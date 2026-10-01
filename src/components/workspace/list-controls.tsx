"use client";

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CopyIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react/ssr";
import { useRef, useState, useTransition } from "react";
import { perform } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { TRASH_DAYS } from "@/lib/trash";
import { cn, pluralize } from "@/lib/utils";
import { createTask } from "@/server/actions/tasks";
import { duplicateTaskList } from "@/server/actions/templates";
import {
  createTaskList,
  deleteTaskList,
  renameTaskList,
  shiftTaskList,
} from "@/server/actions/workspaces";

/** Type a title, press Enter, keep typing the next one. */
export function InlineAddTask({
  workspaceId,
  taskListId,
  className,
  placeholder = "Add a task",
}: {
  workspaceId: string;
  taskListId: string;
  className?: string;
  placeholder?: string;
}) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  function submit() {
    const title = value.trim();
    if (!title) return;
    setValue("");
    startTransition(async () => {
      const res = await perform(createTask({ workspaceId, taskListId, title }));
      if (!res.ok) setValue(title);
      input.current?.focus();
    });
  }

  if (!active)
    return (
      <button
        type="button"
        onClick={() => {
          setActive(true);
          requestAnimationFrame(() => input.current?.focus());
        }}
        className={cn(
          "flex h-9 w-full items-center gap-2.5 pl-8 pr-4 text-left text-[13.5px] text-subtle hover:text-text",
          className,
        )}
      >
        <PlusIcon size={14} weight="bold" />
        {placeholder}
      </button>
    );

  return (
    <form method="post"
      className={cn("flex h-10 items-center gap-2.5 pl-8 pr-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <PlusIcon size={14} weight="bold" className="shrink-0 text-accent" />
      <input
        ref={input}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (!value.trim()) setActive(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            setActive(false);
          }
        }}
        maxLength={300}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending || !value.trim()}>
        Add
      </Button>
    </form>
  );
}

export function TaskListMenu({
  list,
  taskCount,
  isFirst,
  isLast,
  orientation,
  onRename,
}: {
  list: { id: string; name: string };
  taskCount: number;
  isFirst: boolean;
  isLast: boolean;
  orientation: "vertical" | "horizontal";
  onRename: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const Prev = orientation === "vertical" ? ArrowUpIcon : ArrowLeftIcon;
  const Next = orientation === "vertical" ? ArrowDownIcon : ArrowRightIcon;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-md text-subtle hover:bg-surface-3 hover:text-text data-[state=open]:bg-surface-3"
            aria-label={`Options for ${list.name}`}
          >
            <DotsThreeIcon size={18} weight="bold" />
          </button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuItem onSelect={onRename}>
            <PencilSimpleIcon size={16} />
            Rename list
          </MenuItem>
          <MenuItem
            onSelect={() => perform(duplicateTaskList(list.id), { success: "List duplicated" })}
          >
            <CopyIcon size={16} />
            Duplicate list
          </MenuItem>
          <MenuItem disabled={isFirst} onSelect={() => perform(shiftTaskList(list.id, -1))}>
            <Prev size={16} />
            {orientation === "vertical" ? "Move up" : "Move left"}
          </MenuItem>
          <MenuItem disabled={isLast} onSelect={() => perform(shiftTaskList(list.id, 1))}>
            <Next size={16} />
            {orientation === "vertical" ? "Move down" : "Move right"}
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger disabled={isFirst && isLast} onSelect={() => setConfirming(true)}>
            <TrashIcon size={16} />
            Delete list
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title={`Delete “${list.name}”?`}
          description={
            taskCount > 0
              ? `Its ${pluralize(taskCount, "task")} go to the workspace's trash, where you can restore them into another list for ${TRASH_DAYS} days.`
              : "The list is empty. This can't be undone."
          }
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await perform(deleteTaskList(list.id), {
                    success: taskCount > 0 ? "List deleted. Its tasks are in the trash." : "List deleted",
                  });
                  if (res.ok) setConfirming(false);
                })
              }
            >
              {pending ? "Deleting…" : "Delete list"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Inline rename field used by list headers and board columns. */
export function ListNameEditor({
  list,
  onDone,
  className,
}: {
  list: { id: string; name: string };
  onDone: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(list.name);
  const [, startTransition] = useTransition();
  // Escape discards, even if the browser also fires blur as the field goes away.
  const cancelled = useRef(false);

  function save() {
    const name = value.trim();
    onDone();
    if (cancelled.current || !name || name === list.name) return;
    startTransition(async () => {
      await perform(renameTaskList(list.id, name));
    });
  }

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelled.current = true;
          onDone();
        }
      }}
      maxLength={80}
      aria-label="List name"
      className={cn(
        "h-7 min-w-0 rounded-md border border-accent bg-surface px-1.5 text-[13.5px] font-semibold outline-none ring-3 ring-accent/15",
        className,
      )}
    />
  );
}

export function AddTaskList({
  workspaceId,
  variant,
}: {
  workspaceId: string;
  variant: "row" | "column";
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    const name = value.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await perform(createTaskList(workspaceId, name));
      if (res.ok) {
        setValue("");
        setOpen(false);
      }
    });
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 text-[13.5px] font-medium text-muted hover:text-text",
          variant === "row"
            ? "h-11 w-full px-4 sm:px-6"
            : "h-10 w-72 shrink-0 rounded-[10px] border border-dashed border-border-strong px-3 hover:border-accent",
        )}
      >
        <PlusIcon size={14} weight="bold" />
        Add task list
      </button>
    );

  return (
    <form method="post"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "flex items-center gap-2",
        variant === "row" ? "px-4 py-2 sm:px-6" : "w-72 shrink-0 rounded-[10px] border border-border bg-surface p-2",
      )}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            setOpen(false);
          }
        }}
        onBlur={() => !value.trim() && setOpen(false)}
        maxLength={80}
        placeholder="List name, e.g. In review"
        aria-label="New list name"
        className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-[13.5px] outline-none transition-colors hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15"
      />
      <Button type="submit" size="sm" variant="primary" disabled={pending || !value.trim()}>
        Add list
      </Button>
    </form>
  );
}
