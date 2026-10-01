"use client";

import {
  closestCorners,
  KeyboardSensor,
  type Announcements,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useId, useState, useTransition } from "react";
import { perform } from "@/components/app-context";
import type { TaskSummary } from "@/server/queries";
import { moveTask } from "@/server/actions/tasks";

type Columns = Record<string, TaskSummary[]>;

function buildColumns(listIds: string[], tasks: TaskSummary[]): Columns {
  const cols: Columns = Object.fromEntries(listIds.map((id) => [id, []]));
  for (const t of tasks) (cols[t.taskListId] ??= []).push(t);
  return cols;
}

/** What screen readers hear while a task is dragged with the keyboard (Space, arrows, Space). */
const SCREEN_READER_INSTRUCTIONS = {
  draggable:
    "To move this task, press Space or Enter. Use the arrow keys to move it, then Space or Enter to drop it, or Escape to cancel.",
};

/**
 * Multi-container drag and drop state shared by the list and board views.
 * Local state mirrors server data and is re-synced whenever fresh props
 * arrive (unless a drag is in progress).
 */
export function useTaskColumns(lists: { id: string; name: string }[], tasks: TaskSummary[]) {
  const listIds = lists.map((l) => l.id);
  const dndId = useId();
  const listKey = listIds.join(",");
  const [columns, setColumns] = useState(() => buildColumns(listIds, tasks));
  const [source, setSource] = useState({ listKey, tasks });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<{ list: string; index: number } | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync with fresh server data (compare list ids by value, tasks by
  // identity: a new array only arrives with a new server render).
  if ((source.listKey !== listKey || source.tasks !== tasks) && activeId === null) {
    setSource({ listKey, tasks });
    setColumns(buildColumns(listIds, tasks));
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findList = (id: UniqueIdentifier): string | undefined => {
    const key = String(id);
    if (key in columns) return key;
    return Object.keys(columns).find((k) => columns[k].some((t) => t.id === key));
  };

  function onDragStart({ active }: DragStartEvent) {
    const list = findList(active.id);
    if (!list) return;
    document.body.dataset.dragging = "1";
    setActiveId(String(active.id));
    setOrigin({ list, index: columns[list].findIndex((t) => t.id === active.id) });
  }

  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const from = findList(active.id);
    const to = findList(over.id);
    if (!from || !to || from === to) return;

    setColumns((prev) => {
      const fromItems = prev[from];
      const toItems = prev[to];
      const activeIndex = fromItems.findIndex((t) => t.id === active.id);
      if (activeIndex < 0) return prev;
      let newIndex = toItems.length;
      if (!(String(over.id) in prev)) {
        const overIndex = toItems.findIndex((t) => t.id === over.id);
        const translated = active.rect.current.translated;
        const below =
          translated && translated.top > over.rect.top + over.rect.height / 2;
        newIndex = overIndex >= 0 ? overIndex + (below ? 1 : 0) : toItems.length;
      }
      const moved = { ...fromItems[activeIndex], taskListId: to };
      return {
        ...prev,
        [from]: fromItems.filter((t) => t.id !== active.id),
        [to]: [...toItems.slice(0, newIndex), moved, ...toItems.slice(newIndex)],
      };
    });
  }

  function finish() {
    delete document.body.dataset.dragging;
    setActiveId(null);
    setOrigin(null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    const list = findList(active.id);
    const start = origin;
    finish();
    if (!over || !list || !start) {
      setColumns(buildColumns(listIds, tasks));
      return;
    }

    let items = columns[list];
    const oldIndex = items.findIndex((t) => t.id === active.id);
    if (findList(over.id) === list) {
      const newIndex =
        String(over.id) in columns
          ? items.length - 1
          : items.findIndex((t) => t.id === over.id);
      if (newIndex >= 0 && newIndex !== oldIndex) items = arrayMove(items, oldIndex, newIndex);
    }
    const index = items.findIndex((t) => t.id === active.id);
    if (list === start.list && index === start.index) return;

    setColumns((prev) => ({ ...prev, [list]: items }));
    startTransition(async () => {
      const res = await perform(
        moveTask({
          id: String(active.id),
          taskListId: list,
          prevId: items[index - 1]?.id ?? null,
          nextId: items[index + 1]?.id ?? null,
        }),
      );
      if (!res.ok) setColumns(buildColumns(listIds, tasks));
    });
  }

  function onDragCancel() {
    finish();
    setColumns(buildColumns(listIds, tasks));
  }

  const activeTask = activeId
    ? Object.values(columns).flat().find((t) => t.id === activeId) ?? null
    : null;

  // dnd-kit's defaults read out internal ids; say the task and list names instead.
  const titleOf = (id: UniqueIdentifier) =>
    Object.values(columns).flat().find((t) => t.id === String(id))?.title ?? "the task";
  const listName = (id: string | undefined) =>
    lists.find((l) => l.id === id)?.name ?? "the list";
  const placeOf = (id: UniqueIdentifier) =>
    String(id) in columns
      ? listName(String(id))
      : `${titleOf(id)}, in ${listName(findList(id))}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id
        ? `${titleOf(active.id)} is over ${placeOf(over.id)}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${titleOf(active.id)} in ${listName(findList(over.id))}.`
        : `${titleOf(active.id)} is back where it was.`,
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} is back where it was.`,
  };

  return {
    columns,
    activeTask,
    dndProps: {
      // Stable id keeps dnd-kit's aria ids identical on server and client.
      id: dndId,
      sensors,
      collisionDetection: closestCorners,
      accessibility: { announcements, screenReaderInstructions: SCREEN_READER_INSTRUCTIONS },
      onDragStart,
      onDragOver,
      onDragEnd,
      onDragCancel,
    },
  };
}
