"use client";

import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp, useTaskNavigation } from "@/components/app-context";
import { TagList } from "@/components/tags";
import { AssigneeAvatars, StatusPill, TaskCheck } from "@/components/task-bits";
import { TaskMeta, useTaskToggle } from "@/components/task-row";
import { isClosed } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TaskSummary } from "@/server/queries";
import {
  AddTaskList,
  InlineAddTask,
  ListNameEditor,
  TaskListMenu,
} from "./list-controls";
import { SelectBox, useTaskSelection } from "./selection";
import { useTaskColumns } from "./use-task-columns";

type List = { id: string; name: string };

export function BoardView({
  workspaceId,
  lists,
  tasks,
}: {
  workspaceId: string;
  lists: List[];
  tasks: TaskSummary[];
}) {
  const { columns, activeTask, dndProps } = useTaskColumns(lists, tasks);
  const { hrefFor, activeTaskId } = useTaskNavigation();
  const [editing, setEditing] = useState<string | null>(null);
  const selection = useTaskSelection();
  const selecting = Boolean(selection?.active);
  const setVisible = selection?.setVisible;
  const orderKey = lists.flatMap((l) => (columns[l.id] ?? []).map((t) => t.id)).join(",");

  useEffect(() => {
    setVisible?.(orderKey ? orderKey.split(",") : []);
  }, [orderKey, setVisible]);

  return (
    <DndContext {...dndProps}>
      <div
        className={cn(
          "scrollbar-thin flex h-full items-start gap-3 overflow-x-auto p-4 sm:p-5",
          selecting && "pb-20 sm:pb-20",
        )}
      >
        {lists.map((list, i) => {
          const items = columns[list.id] ?? [];
          return (
            <section
              key={list.id}
              aria-labelledby={`col-${list.id}`}
              className="flex max-h-full w-[288px] shrink-0 flex-col rounded-[10px] border border-border bg-bg"
            >
              <div className="flex h-11 shrink-0 items-center gap-1.5 pl-3 pr-1.5">
                {selecting && items.length > 0 && (
                  <ColumnSelectAll ids={items.map((t) => t.id)} name={list.name} />
                )}
                {editing === list.id ? (
                  <ListNameEditor list={list} onDone={() => setEditing(null)} className="flex-1" />
                ) : (
                  <h2
                    id={`col-${list.id}`}
                    onDoubleClick={() => setEditing(list.id)}
                    className="truncate text-[13.5px] font-semibold tracking-tight"
                  >
                    {list.name}
                  </h2>
                )}
                <span className="tabular text-[12.5px] text-subtle">{items.length}</span>
                <span className="flex-1" />
                <TaskListMenu
                  list={list}
                  taskCount={items.length}
                  isFirst={i === 0}
                  isLast={i === lists.length - 1}
                  orientation="horizontal"
                  onRename={() => setEditing(list.id)}
                />
              </div>
              <DroppableColumn id={list.id}>
                <SortableContext
                  items={items.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {items.map((task) =>
                    selecting && selection ? (
                      <TaskCard
                        key={task.id}
                        task={task}
                        href={hrefFor(task.id)}
                        select={{
                          selected: selection.selected.has(task.id),
                          onToggle: (range) => selection.toggle(task.id, range),
                        }}
                      />
                    ) : (
                      <SortableCard
                        key={task.id}
                        task={task}
                        href={hrefFor(task.id)}
                        active={task.id === activeTaskId}
                      />
                    ),
                  )}
                </SortableContext>
              </DroppableColumn>
              {!selecting && (
                <InlineAddTask
                  workspaceId={workspaceId}
                  taskListId={list.id}
                  className="pl-3"
                />
              )}
            </section>
          );
        })}
        <AddTaskList workspaceId={workspaceId} variant="column" />
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && <TaskCard task={activeTask} href="#" overlay />}
      </DragOverlay>
    </DndContext>
  );
}

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "scrollbar-thin grid min-h-12 content-start gap-2 overflow-y-auto px-2 pb-1 transition-colors",
        isOver && "bg-accent-soft/40",
      )}
    >
      {children}
    </div>
  );
}

function SortableCard({
  task,
  href,
  active,
}: {
  task: TaskSummary;
  href: string;
  active: boolean;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      onPointerDown={listeners?.onPointerDown as React.PointerEventHandler<HTMLDivElement>}
      onKeyDown={(e) => {
        // Only start keyboard dragging when the card itself is focused, so
        // Enter on the inner link still opens the task.
        if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
      }}
      aria-label={`Reorder ${task.title}`}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <TaskCard task={task} href={href} active={active} dragging={isDragging} />
    </div>
  );
}

function TaskCard({
  task,
  href,
  active,
  dragging,
  overlay,
  select,
}: {
  task: TaskSummary;
  href: string;
  active?: boolean;
  dragging?: boolean;
  overlay?: boolean;
  select?: { selected: boolean; onToggle: (range: boolean) => void };
}) {
  const { today } = useApp();
  const { status, toggle } = useTaskToggle(task);
  const closed = isClosed(status);
  return (
    <div
      className={cn(
        "group/card relative flex gap-2.5 rounded-lg border bg-surface p-3 shadow-card transition-colors",
        // Long columns only draw the cards on screen; "auto" remembers each card's height.
        "[contain-intrinsic-size:auto_92px] [content-visibility:auto]",
        select && "select-none",
        active || select?.selected
          ? "border-accent ring-2 ring-accent/15"
          : "border-border hover:border-border-strong",
        select?.selected && "bg-accent-soft/40",
        dragging && "opacity-40",
        overlay && "rotate-[1.5deg] cursor-grabbing shadow-pop",
      )}
    >
      {select ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={select.selected}
          aria-label={task.title}
          onClick={(e) => select.onToggle(e.shiftKey)}
          className="absolute inset-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      ) : null}
      <div className="pt-px">
        {select ? (
          <span className="inline-flex size-[17px] items-center justify-center">
            <SelectBox checked={select.selected} />
          </span>
        ) : (
          <TaskCheck status={status} onToggle={toggle} title={task.title} />
        )}
      </div>
      <CardBody
        href={select ? null : href}
        className="grid min-w-0 flex-1 gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <span
          className={cn(
            "line-clamp-3 text-[13.5px] leading-snug",
            closed ? "text-subtle line-through" : "text-text",
          )}
        >
          {task.title}
        </span>
        {task.tags.length > 0 && <TagList tags={task.tags} className="flex-wrap" />}
        {(status !== "open" ||
          task.dueDate ||
          task.subtaskTotal > 0 ||
          task.commentCount > 0 ||
          task.attachmentCount > 0 ||
          task.urgent ||
          task.openBlockers > 0 ||
          task.recurrence ||
          task.assignees.length > 0) && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <StatusPill status={status} />
            <TaskMeta task={task} status={status} today={today} compact />
            <span className="flex-1" />
            <AssigneeAvatars people={task.assignees} size="xs" />
          </span>
        )}
      </CardBody>
    </div>
  );
}

/** The card's text links to the task, except in selection mode (the whole card toggles). */
function CardBody({
  href,
  className,
  children,
}: {
  href: string | null;
  className: string;
  children: React.ReactNode;
}) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <Link href={href} scroll={false} draggable={false} className={className}>
      {children}
    </Link>
  );
}

function ColumnSelectAll({ ids, name }: { ids: string[]; name: string }) {
  const selection = useTaskSelection()!;
  const count = ids.filter((id) => selection.selected.has(id)).length;
  const all = count === ids.length;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={all ? true : count > 0 ? "mixed" : false}
      aria-label={`Select all in ${name}`}
      onClick={() => selection.setMany(ids, !all)}
      className="-ml-1 inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-2"
    >
      <SelectBox checked={all} mixed={count > 0 && !all} />
    </button>
  );
}
