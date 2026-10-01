"use client";

import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { perform } from "@/components/app-context";
import { StatusIcon } from "@/components/task-bits";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TaskStatus } from "@/db/schema";
import { isClosed, STATUS_META } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  addDependency,
  listTaskOptions,
  removeDependency,
} from "@/server/actions/dependencies";

type Linked = { id: string; number: number; title: string; status: TaskStatus };

/** "Waiting for" and "Holding up" rows for the task panel's property list. */
export function DependencyRows({
  taskId,
  workspaceId,
  blockedBy,
  blocking,
}: {
  taskId: string;
  workspaceId: string;
  blockedBy: Linked[];
  blocking: Linked[];
}) {
  const [pending, startTransition] = useTransition();
  const openBlockers = blockedBy.filter((t) => !isClosed(t.status)).length;

  return (
    <>
      <dt className="self-start pt-1.5 text-muted">Waiting for</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
        {blockedBy.map((t) => (
          <TaskChip
            key={t.id}
            task={t}
            onRemove={() =>
              startTransition(async () => {
                await perform(removeDependency({ taskId, dependsOnId: t.id }));
              })
            }
            disabled={pending}
          />
        ))}
        <AddBlocker
          taskId={taskId}
          workspaceId={workspaceId}
          exclude={[taskId, ...blockedBy.map((t) => t.id), ...blocking.map((t) => t.id)]}
          empty={blockedBy.length === 0}
        />
        {openBlockers > 0 && (
          <span className="basis-full text-[12px] text-warning-text">
            Best to wait until {openBlockers === 1 ? "that's" : "those are"} done before starting.
          </span>
        )}
      </dd>
      {blocking.length > 0 && (
        <>
          <dt className="self-start pt-1.5 text-muted">Holding up</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
            {blocking.map((t) => (
              <TaskChip key={t.id} task={t} />
            ))}
          </dd>
        </>
      )}
    </>
  );
}

function TaskChip({
  task,
  onRemove,
  disabled,
}: {
  task: Linked;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const closed = isClosed(task.status);
  return (
    <span className="group/chip inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-surface pl-2 pr-1 text-[12.5px]">
      <StatusIcon status={task.status} size={13} className="shrink-0" />
      <Link
        href={`/t/${task.number}`}
        className={cn(
          "min-w-0 truncate hover:underline",
          closed && "text-subtle line-through decoration-subtle/60",
        )}
        title={`Open “${task.title}” (task #${task.number})`}
      >
        {task.title}
        {/* The icon shows the status by shape and colour; say it for screen readers too. */}
        {task.status !== "open" && (
          <span className="sr-only"> ({STATUS_META[task.status].label})</span>
        )}
      </Link>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Stop waiting for #${task.number}`}
          // The pseudo-element widens the hit area for fingers without changing the chip.
          className="relative inline-flex size-5 shrink-0 items-center justify-center rounded text-subtle after:absolute after:-inset-1 hover:bg-surface-2 hover:text-text disabled:opacity-50"
        >
          <XIcon size={10} weight="bold" />
        </button>
      ) : (
        <span className="w-1" />
      )}
    </span>
  );
}

function AddBlocker({
  taskId,
  workspaceId,
  exclude,
  empty,
}: {
  taskId: string;
  workspaceId: string;
  exclude: string[];
  empty: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Linked[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return (options ?? [])
      .filter((t) => !exclude.includes(t.id))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || String(t.number).startsWith(q))
      .slice(0, 50);
  }, [options, query, exclude]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function choose(t: Linked) {
    if (pending) return;
    startTransition(async () => {
      const res = await perform(addDependency({ taskId, dependsOnId: t.id }));
      if (res.ok) {
        setOpen(false);
        setQuery("");
      }
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setCursor(0);
        if (o && !options) {
          setLoadFailed(false);
          perform(listTaskOptions(workspaceId)).then((res) =>
            res.ok ? setOptions(res.data) : setLoadFailed(true),
          );
        }
      }}
    >
      <PopoverTrigger asChild>
        {empty ? (
          <button
            type="button"
            className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
          >
            <PlusIcon size={15} className="shrink-0" />
            Add a task it waits for
          </button>
        ) : (
          <button
            type="button"
            aria-label="Add a task it waits for"
            className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
          >
            <PlusIcon size={13} />
            Add
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-1">
        <div className="flex items-center gap-2 border-b border-border px-2 pb-1">
          <MagnifyingGlassIcon size={14} className="shrink-0 text-subtle" />
          <input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={matches[cursor] ? `${listId}-${matches[cursor].id}` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.max(0, Math.min(c + 1, matches.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter" && matches[cursor]) {
                e.preventDefault();
                choose(matches[cursor]);
              }
            }}
            placeholder="Which task has to happen first?"
            aria-label="Search tasks"
            className="h-8 w-full bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Tasks"
          className="scrollbar-thin max-h-64 overflow-y-auto pt-1"
        >
          {!options ? (
            <p className="px-2 py-2 text-[12.5px] text-muted">
              {loadFailed ? "Couldn't load the tasks. Close this and try again." : "Loading tasks…"}
            </p>
          ) : matches.length === 0 ? (
            <p className="px-2 py-2 text-[12.5px] text-muted">
              {query.trim()
                ? "No matching tasks in this workspace."
                : "No other tasks to choose from in this workspace."}
            </p>
          ) : (
            matches.map((t, i) => (
              <button
                key={t.id}
                id={`${listId}-${t.id}`}
                type="button"
                role="option"
                aria-selected={i === cursor}
                data-active={i === cursor}
                tabIndex={-1}
                disabled={pending}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(t)}
                className={cn(
                  "flex min-h-8 w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px]",
                  i === cursor && "bg-surface-2",
                )}
              >
                <StatusIcon status={t.status} size={13} />
                <span className="font-mono text-[11.5px] text-subtle">#{t.number}</span>
                <span className={cn("min-w-0 flex-1 truncate", isClosed(t.status) && "text-subtle")}>
                  {t.title}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
