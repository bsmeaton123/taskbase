"use client";

import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CaretDownIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useMemo, useState } from "react";
import { useTaskNavigation } from "@/components/app-context";
import { TaskRow } from "@/components/task-row";
import { cn } from "@/lib/utils";
import type { InlineSubtask, TaskSummary } from "@/server/queries";
import {
  AddTaskList,
  InlineAddTask,
  ListNameEditor,
  TaskListMenu,
} from "./list-controls";
import { SelectBox, useTaskSelection } from "./selection";
import { useTaskColumns } from "./use-task-columns";

type List = { id: string; name: string };

export function ListView({
  workspaceId,
  lists,
  tasks,
  subtasks,
  filtered,
  footer,
}: {
  workspaceId: string;
  lists: List[];
  tasks: TaskSummary[];
  /** Every visible task's subtasks, shown under a row when it's expanded. */
  subtasks: InlineSubtask[];
  filtered: boolean;
  footer?: React.ReactNode;
}) {
  const subtasksByTask = useMemo(() => {
    const map = new Map<string, InlineSubtask[]>();
    for (const sub of subtasks) {
      const list = map.get(sub.taskId);
      if (list) list.push(sub);
      else map.set(sub.taskId, [sub]);
    }
    return map;
  }, [subtasks]);
  const { columns, activeTask, dndProps } = useTaskColumns(lists, tasks);
  const { hrefFor, activeTaskId } = useTaskNavigation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const selection = useTaskSelection();
  const selecting = Boolean(selection?.active);
  const setVisible = selection?.setVisible;
  // Only what's actually on screen: collapsed lists are left out of "Select all".
  const order = lists.flatMap((l) => (collapsed[l.id] ? [] : (columns[l.id] ?? []).map((t) => t.id)));
  const orderKey = order.join(",");

  useEffect(() => {
    setVisible?.(orderKey ? orderKey.split(",") : []);
  }, [orderKey, setVisible]);

  return (
    <DndContext {...dndProps}>
      <div className="pb-24">
        {lists.map((list, i) => {
          const items = columns[list.id] ?? [];
          const isCollapsed = collapsed[list.id];
          return (
            <section key={list.id} aria-labelledby={`list-${list.id}`}>
              <div className="sticky top-0 z-[2] flex h-11 items-center gap-1.5 border-b border-border bg-surface/95 pl-3 pr-3 backdrop-blur sm:pr-4">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [list.id]: !c[list.id] }))}
                  className="inline-flex size-6 items-center justify-center rounded-md text-subtle hover:bg-surface-2 hover:text-text"
                  aria-expanded={!isCollapsed}
                  aria-label={isCollapsed ? `Expand ${list.name}` : `Collapse ${list.name}`}
                >
                  <CaretDownIcon
                    size={12}
                    weight="bold"
                    className={cn("transition-transform", isCollapsed && "-rotate-90")}
                  />
                </button>
                {selecting && selection && items.length > 0 && (
                  <ListSelectAll ids={items.map((t) => t.id)} name={list.name} />
                )}
                {editing === list.id ? (
                  <ListNameEditor list={list} onDone={() => setEditing(null)} className="w-64" />
                ) : (
                  <h2
                    id={`list-${list.id}`}
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
                  orientation="vertical"
                  onRename={() => setEditing(list.id)}
                />
              </div>
              {!isCollapsed && (
                <DroppableList id={list.id}>
                  <SortableContext
                    items={items.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {items.map((task) =>
                      selecting && selection ? (
                        <TaskRow
                          key={task.id}
                          task={task}
                          href={hrefFor(task.id)}
                          select={{
                            selected: selection.selected.has(task.id),
                            onToggle: (range) => selection.toggle(task.id, range),
                          }}
                        />
                      ) : (
                        <SortableTaskRow
                          key={task.id}
                          task={task}
                          href={hrefFor(task.id)}
                          active={task.id === activeTaskId}
                          subtasks={subtasksByTask.get(task.id)}
                        />
                      ),
                    )}
                  </SortableContext>
                  {items.length === 0 && filtered && (
                    <p className="py-2 pl-14 text-[13px] text-subtle">
                      No tasks here match the current filters.
                    </p>
                  )}
                  {!selecting && (
                    <InlineAddTask
                      workspaceId={workspaceId}
                      taskListId={list.id}
                      className="border-b border-border/70"
                    />
                  )}
                </DroppableList>
              )}
            </section>
          );
        })}
        <AddTaskList workspaceId={workspaceId} variant="row" />
        {footer}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeTask && <TaskRow task={activeTask} href="#" overlay />}
      </DragOverlay>
    </DndContext>
  );
}

function ListSelectAll({ ids, name }: { ids: string[]; name: string }) {
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
      className="inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-2"
    >
      <SelectBox checked={all} mixed={count > 0 && !all} />
    </button>
  );
}

function DroppableList({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn(isOver && "bg-accent-soft/30")}>
      {children}
    </div>
  );
}

function SortableTaskRow({
  task,
  href,
  active,
  subtasks,
}: {
  task: TaskSummary;
  href: string;
  active: boolean;
  subtasks?: InlineSubtask[];
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <TaskRow
        task={task}
        href={href}
        active={active}
        subtasks={subtasks}
        dragging={isDragging}
        drag={{
          row: {
            onPointerDown: listeners?.onPointerDown as React.PointerEventHandler<HTMLElement>,
          },
          handle: {
            onKeyDown: listeners?.onKeyDown as React.KeyboardEventHandler<HTMLElement>,
            ...attributes,
          },
        }}
      />
    </div>
  );
}
