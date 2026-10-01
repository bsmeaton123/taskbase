"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  CalendarBlankIcon,
  DotsSixVerticalIcon,
  PlusIcon,
  TrashIcon,
  UserCirclePlusIcon,
} from "@phosphor-icons/react/ssr";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { SuggestSubtasksButton } from "@/components/ai/task-ai";
import { DuePicker, PersonPicker } from "@/components/pickers";
import { DueLabel, SubtaskCheck } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  addSubtask,
  deleteSubtask,
  reorderSubtasks,
  restoreSubtask,
  updateSubtask,
} from "@/server/actions/subtasks";
import type { TaskDetail } from "@/server/queries";

type Subtask = TaskDetail["subtasks"][number];
type Person = { id: string; name: string; image: string | null; email: string };

type Patch =
  | { type: "update"; id: string; patch: Partial<Subtask> }
  | { type: "delete"; id: string }
  | { type: "add"; subtask: Subtask }
  | { type: "reorder"; ids: string[] };

export function Subtasks({
  taskId,
  subtasks,
  members,
}: {
  taskId: string;
  subtasks: Subtask[];
  members: Person[];
}) {
  const [items, apply] = useOptimistic(subtasks, (state: Subtask[], p: Patch) => {
    switch (p.type) {
      case "update":
        return state.map((s) => (s.id === p.id ? { ...s, ...p.patch } : s));
      case "delete":
        return state.filter((s) => s.id !== p.id);
      case "add":
        return [...state, p.subtask];
      case "reorder":
        return p.ids.flatMap((id) => state.find((s) => s.id === id) ?? []);
    }
  });
  const [, startTransition] = useTransition();
  const dndId = useId();
  const headingId = useId();
  const done = items.filter((s) => s.done).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function mutate(p: Patch, action: () => Promise<unknown>) {
    startTransition(async () => {
      apply(p);
      await action();
    });
  }

  // dnd-kit's defaults read out internal ids; say the subtask names and positions instead.
  const titleOf = (id: UniqueIdentifier) => items.find((s) => s.id === id)?.title ?? "the subtask";
  const positionOf = (id: UniqueIdentifier) =>
    `position ${items.findIndex((s) => s.id === id) + 1} of ${items.length}`;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${titleOf(active.id)} is at ${positionOf(over.id)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${titleOf(active.id)} at ${positionOf(over.id)}.`
        : `${titleOf(active.id)} is back where it was.`,
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} is back where it was.`,
  };

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const ids = items.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    mutate({ type: "reorder", ids: next }, () => perform(reorderSubtasks(taskId, next)));
  }

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-[13px] font-semibold">
          Subtasks
        </h3>
        {items.length > 0 && (
          <span className="tabular text-[12.5px] text-subtle">
            {done} of {items.length}
          </span>
        )}
        <SuggestSubtasksButton taskId={taskId} />
      </div>

      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "To move this subtask, press Space or Enter. Use the arrow keys to move it, then Space or Enter to drop it, or Escape to cancel.",
          },
        }}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={items.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="-mx-2">
            {items.map((s) => (
              <SubtaskRow
                key={s.id}
                subtask={s}
                members={members}
                onPatch={(patch) =>
                  mutate({ type: "update", id: s.id, patch: toOptimistic(patch, members) }, () =>
                    perform(updateSubtask({ id: s.id, ...patch })),
                  )
                }
                onDelete={() =>
                  mutate({ type: "delete", id: s.id }, async () => {
                    const res = await perform(deleteSubtask(s.id));
                    const deleted = res.ok ? res.data : null;
                    if (deleted)
                      toast.success("Subtask deleted", {
                        action: {
                          label: "Undo",
                          onClick: () => void perform(restoreSubtask(deleted)),
                        },
                      });
                  })
                }
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AddSubtask
        onAdd={(title) =>
          mutate(
            {
              type: "add",
              subtask: {
                id: `pending-${Date.now()}`,
                title,
                done: false,
                dueDate: null,
                assignee: null,
              },
            },
            () => perform(addSubtask(taskId, title)),
          )
        }
      />
    </section>
  );
}

type SubtaskInput = {
  title?: string;
  done?: boolean;
  assigneeId?: string | null;
  dueDate?: string | null;
};

function toOptimistic(patch: SubtaskInput, members: Person[]): Partial<Subtask> {
  const out: Partial<Subtask> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.done !== undefined) out.done = patch.done;
  if (patch.dueDate !== undefined) out.dueDate = patch.dueDate;
  if (patch.assigneeId !== undefined) {
    const m = members.find((p) => p.id === patch.assigneeId);
    out.assignee = m ? { id: m.id, name: m.name, image: m.image } : null;
  }
  return out;
}

function SubtaskRow({
  subtask,
  members,
  onPatch,
  onDelete,
}: {
  subtask: Subtask;
  members: Person[];
  onPatch: (patch: SubtaskInput) => void;
  onDelete: () => void;
}) {
  const { today, viewer } = useApp();
  const [editing, setEditing] = useState(false);
  // Escape unmounts the input, and some browsers then fire blur, which would save.
  const cancelled = useRef(false);
  const pending = subtask.id.startsWith("pending-");
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: subtask.id, disabled: pending || editing });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/sub flex min-h-9 items-center gap-2 rounded-md px-2 hover:bg-surface-2",
        isDragging && "relative z-10 bg-surface shadow-pop",
        pending && "opacity-60",
      )}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${subtask.title}`}
        // The pseudo-element gives fingers a hit area the height of the row.
        className="relative -ml-1 inline-flex w-3 cursor-grab touch-none justify-center text-subtle opacity-0 after:absolute after:-inset-x-1 after:-inset-y-3 focus-visible:opacity-100 group-hover/sub:opacity-100 pointer-coarse:opacity-100"
      >
        <DotsSixVerticalIcon size={13} weight="bold" />
      </span>
      <SubtaskCheck
        done={subtask.done}
        label={subtask.done ? `Reopen ${subtask.title}` : `Complete ${subtask.title}`}
        onToggle={() => !pending && onPatch({ done: !subtask.done })}
      />
      {editing ? (
        <input
          autoFocus
          defaultValue={subtask.title}
          maxLength={300}
          aria-label="Subtask title"
          onBlur={(e) => {
            setEditing(false);
            if (cancelled.current) return;
            const title = e.target.value.trim();
            if (title && title !== subtask.title) onPatch({ title });
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.stopPropagation();
              cancelled.current = true;
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-accent bg-surface px-1.5 text-[14px] outline-none ring-3 ring-accent/15"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (pending) return;
            cancelled.current = false;
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 truncate py-1.5 text-left text-[14px]",
            subtask.done && "text-subtle line-through",
          )}
        >
          {subtask.title}
        </button>
      )}

      <DuePicker
        value={subtask.dueDate}
        today={today}
        onChange={(dueDate) => onPatch({ dueDate })}
        align="end"
      >
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex h-6 items-center rounded-md px-1 hover:bg-surface-3",
            !subtask.dueDate &&
              "text-subtle opacity-0 focus-visible:opacity-100 group-hover/sub:opacity-100 pointer-coarse:opacity-100",
          )}
          aria-label={subtask.dueDate ? undefined : `Set a due date for ${subtask.title}`}
        >
          {subtask.dueDate ? (
            <>
              <span className="sr-only">Due date for {subtask.title}: </span>
              <DueLabel dueDate={subtask.dueDate} today={today} closed={subtask.done} />
            </>
          ) : (
            <CalendarBlankIcon size={15} />
          )}
        </button>
      </DuePicker>

      <PersonPicker
        people={members}
        value={subtask.assignee?.id ?? null}
        onChange={(assigneeId) => onPatch({ assigneeId })}
        viewerId={viewer.id}
        align="end"
      >
        <button
          type="button"
          disabled={pending}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full hover:bg-surface-3",
            !subtask.assignee &&
              "text-subtle opacity-0 focus-visible:opacity-100 group-hover/sub:opacity-100 pointer-coarse:opacity-100",
          )}
          aria-label={
            subtask.assignee ? `Assigned to ${subtask.assignee.name}` : `Assign ${subtask.title}`
          }
        >
          {subtask.assignee ? (
            <Avatar person={subtask.assignee} size="xs" />
          ) : (
            <UserCirclePlusIcon size={16} />
          )}
        </button>
      </PersonPicker>

      <Tooltip content="Delete subtask">
        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="inline-flex size-6 items-center justify-center rounded-md text-subtle opacity-0 hover:bg-danger-soft hover:text-danger-text focus-visible:opacity-100 group-hover/sub:opacity-100 pointer-coarse:opacity-100"
          aria-label={`Delete ${subtask.title}`}
        >
          <TrashIcon size={14} />
        </button>
      </Tooltip>
    </li>
  );
}

function AddSubtask({ onAdd }: { onAdd: (title: string) => void }) {
  const [active, setActive] = useState(false);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  if (!active)
    return (
      <button
        type="button"
        onClick={() => {
          setActive(true);
          requestAnimationFrame(() => ref.current?.focus());
        }}
        // Indented to line up with the subtask checkboxes (past the drag handles).
        className="mt-0.5 flex h-8 items-center gap-2 rounded-md pl-4 text-[13px] text-subtle hover:text-text"
      >
        <span className="inline-flex size-4 items-center justify-center">
          <PlusIcon size={14} weight="bold" />
        </span>
        Add subtask
      </button>
    );

  return (
    <form
      method="post"
      className="mt-1 flex items-center gap-2 pl-4"
      onSubmit={(e) => {
        e.preventDefault();
        const title = value.trim();
        if (!title) return;
        onAdd(title);
        setValue("");
      }}
    >
      <span className="inline-flex size-4 shrink-0 rounded-[4px] border border-dashed border-border-strong" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => !value.trim() && setActive(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setValue("");
            setActive(false);
          }
        }}
        maxLength={300}
        placeholder="Subtask title, then Enter"
        aria-label="New subtask title"
        className="h-8 min-w-0 flex-1 bg-transparent text-[14px] outline-none"
      />
    </form>
  );
}
