"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { UserCircleDashedIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useTaskNavigation } from "@/components/app-context";
import { UrgentFlag, WorkspaceMark } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import { formatDue } from "@/lib/dates";
import { cn, pluralize } from "@/lib/utils";
import {
  BUSY_DAY,
  CELL_PREVIEW,
  UNASSIGNED,
  columnFor,
  planMove,
  weekColumns,
  type Column,
  type ColumnKey,
} from "@/lib/workload";
import { moveOnWorkload, restoreWorkloadMove } from "@/server/actions/workload";
import type { Workload, WorkloadPerson, WorkloadTask } from "@/server/queries";

/** A task picked up from one cell (the same task shows in each assignee's row). */
type DragData = { task: WorkloadTask; rowId: string; colKey: ColumnKey };
type DropData = { rowId: string; colKey: ColumnKey };

const INSTRUCTIONS =
  "Press Enter to open this task. Press Space to pick it up, then use the arrow keys to move it to another person or day, Space or Enter to drop it, or Escape to cancel.";

/**
 * Whether a cell can take the task being moved: never a past day; Overdue only as a
 * hand-over within that column (it has no date to give); and only people who are members
 * of the task's workspace.
 */
function cellAccepts(
  column: Column,
  rowId: string,
  moving: DragData | null,
  canTake: (rowId: string, task: WorkloadTask) => boolean,
) {
  if (column.past) return false;
  if (!moving) return true;
  if (column.key === "overdue" && moving.colKey !== "overdue") return false;
  return canTake(rowId, moving.task);
}

const cellDomId = (gridId: string, d: DropData) => `${gridId}-${d.rowId}-${d.colKey}`;

/**
 * Who's doing what this week: a row per person (and one for unassigned work), a column per
 * day. Move a task to another person to hand it over, to another day to change its due
 * date, or both: drag it, or press Space on it and use the arrow keys. Days with BUSY_DAY or
 * more tasks due for one person are tinted.
 */
export function WorkloadGrid({
  workload,
  viewerId,
  today,
  weekStart,
}: {
  workload: Workload;
  viewerId: string;
  today: string;
  weekStart: string;
}) {
  const gridId = useId();
  const { hrefFor } = useTaskNavigation();
  const [, startTransition] = useTransition();
  const columns = useMemo(() => weekColumns(weekStart, today), [weekStart, today]);

  // Local copy for instant feedback; replaced whenever fresh server data arrives.
  const [source, setSource] = useState(workload.tasks);
  const [tasks, setTasks] = useState(workload.tasks);
  if (source !== workload.tasks) {
    setSource(workload.tasks);
    setTasks(workload.tasks);
  }
  /** A pointer drag in progress (dnd-kit). */
  const [dragging, setDragging] = useState<DragData | null>(null);
  /** A keyboard move in progress: the task, and the cell it would land in. */
  const [picked, setPicked] = useState<{ from: DragData; target: DropData } | null>(null);
  /** What a screen reader hears about keyboard moves. */
  const [status, setStatus] = useState("");
  const moving = dragging ?? picked?.from ?? null;

  const people = useMemo(() => {
    const me = workload.people.find((p) => p.id === viewerId);
    return me ? [me, ...workload.people.filter((p) => p.id !== viewerId)] : workload.people;
  }, [workload.people, viewerId]);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const workspaceById = useMemo(
    () => new Map(workload.workspaces.map((w) => [w.id, w])),
    [workload.workspaces],
  );
  const rowIds = useMemo(() => [...people.map((p) => p.id), UNASSIGNED], [people]);

  /** rowId -> column -> tasks */
  const cells = useMemo(() => {
    const map = new Map<string, Map<ColumnKey, WorkloadTask[]>>(rowIds.map((r) => [r, new Map()]));
    for (const t of tasks) {
      const col = columnFor(t.dueDate, columns, today);
      if (!col) continue;
      const rows = t.assigneeIds.length ? t.assigneeIds.filter((id) => personById.has(id)) : [UNASSIGNED];
      for (const r of rows) {
        const row = map.get(r)!;
        row.set(col, [...(row.get(col) ?? []), t]);
      }
    }
    return map;
  }, [tasks, columns, today, rowIds, personById]);

  const rowName = useCallback(
    (rowId: string) =>
      rowId === UNASSIGNED ? "Unassigned" : rowId === viewerId ? "You" : (personById.get(rowId)?.name ?? "Someone"),
    [viewerId, personById],
  );
  const columnLabel = useCallback(
    (key: ColumnKey) => {
      const c = columns.find((col) => col.key === key)!;
      return c.sub ? `${c.label} ${c.sub}` : c.label;
    },
    [columns],
  );
  const canTake = useCallback(
    (rowId: string, task: WorkloadTask) =>
      rowId === UNASSIGNED || Boolean(personById.get(rowId)?.workspaceIds.includes(task.workspaceId)),
    [personById],
  );
  const accepts = useCallback(
    (d: DropData, m: DragData | null) => {
      const column = columns.find((c) => c.key === d.colKey);
      return Boolean(column && cellAccepts(column, d.rowId, m, canTake));
    },
    [columns, canTake],
  );

  /** Saves a move (from a drag or the keyboard): instant on screen, with Undo. */
  const commit = useCallback(
    (from: DragData, to: DropData): { changed: boolean; message: string } => {
      const col = columns.find((c) => c.key === to.colKey)!;
      // Same column, another person: just a hand-over, the date stays (the weekend column
      // covers two days, and Overdue and No date have no single date).
      const dueDate = to.colKey === from.colKey ? from.task.dueDate : (col.dropDate ?? null);
      const move = {
        taskId: from.task.id,
        from: from.rowId === UNASSIGNED ? null : from.rowId,
        to: to.rowId === UNASSIGNED ? null : to.rowId,
        dueDate,
      };
      const plan = planMove(from.task, move);
      if (!plan.changed) return { changed: false, message: "Nothing changed." };

      const message = describeMove(plan, move, from.task, rowName, today);
      setTasks((list) =>
        list.map((t) =>
          t.id === from.task.id
            ? { ...t, assigneeIds: plan.assigneeIds, dueDate: plan.dueDate, startDate: plan.startDate }
            : t,
        ),
      );
      startTransition(async () => {
        const res = await perform(moveOnWorkload(move));
        if (!res.ok) {
          setTasks(source);
          return;
        }
        const before = res.data?.before;
        if (!before) return;
        toast.success(message, {
          description: `“${from.task.title}”`,
          action: {
            label: "Undo",
            onClick: () => perform(restoreWorkloadMove({ taskId: from.task.id, ...before })),
          },
        });
      });
      return { changed: true, message };
    },
    [columns, rowName, today, source],
  );

  /* ---- Keyboard moves ---------------------------------------------------- */

  // After a keyboard drop, focus follows the task to its new cell.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    const taskId = refocus.current;
    if (!taskId) return;
    refocus.current = null;
    const chips = [...document.querySelectorAll<HTMLElement>(`[data-grid="${gridId}"] [data-chip]`)];
    (chips.find((c) => c.dataset.chip === taskId) ?? chips[0])?.focus();
  }, [tasks, gridId]);

  const pick = useCallback(
    (from: DragData) => {
      setPicked({ from, target: { rowId: from.rowId, colKey: from.colKey } });
      setStatus(
        `Picked up ${from.task.title}, in ${rowName(from.rowId)}, ${columnLabel(from.colKey)}. Arrow keys move it, Space or Enter drops it, Escape cancels.`,
      );
    },
    [rowName, columnLabel],
  );

  useEffect(() => {
    if (!picked) return;
    const { from, target } = picked;
    const step = (dRow: number, dCol: number): DropData | null => {
      let r = rowIds.indexOf(target.rowId);
      let c = columns.findIndex((col) => col.key === target.colKey);
      for (;;) {
        r += dRow;
        c += dCol;
        if (r < 0 || r >= rowIds.length || c < 0 || c >= columns.length) return null;
        const next = { rowId: rowIds[r], colKey: columns[c].key };
        if (accepts(next, from)) return next;
      }
    };
    function onKey(e: KeyboardEvent) {
      const arrows: Record<string, [number, number]> = {
        ArrowUp: [-1, 0],
        ArrowDown: [1, 0],
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
      };
      if (e.key in arrows) {
        e.preventDefault();
        e.stopPropagation();
        const next = step(...arrows[e.key]);
        if (!next) {
          setStatus("It can't go any further that way.");
          return;
        }
        setPicked({ from, target: next });
        setStatus(`${rowName(next.rowId)}, ${columnLabel(next.colKey)}.`);
        document
          .getElementById(cellDomId(gridId, next))
          ?.scrollIntoView({ block: "nearest", inline: "nearest" });
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        setPicked(null);
        const { changed, message } = commit(from, target);
        if (changed) refocus.current = from.task.id;
        setStatus(message);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setPicked(null);
        setStatus(`Cancelled. ${from.task.title} stays where it was.`);
      } else if (e.key === "Tab") {
        setPicked(null);
        setStatus(`Cancelled. ${from.task.title} stays where it was.`);
      }
    }
    // A click anywhere else puts the task back, so arrow keys don't stay captured.
    function onPointer() {
      setPicked(null);
      setStatus(`Cancelled. ${from.task.title} stays where it was.`);
    }
    // Capture, so Escape doesn't also close the task panel or leave selection mode.
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("pointerdown", onPointer, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("pointerdown", onPointer, { capture: true });
    };
  }, [picked, rowIds, columns, accepts, commit, rowName, columnLabel, gridId]);

  /* ---- Pointer drags (dnd-kit) ------------------------------------------- */

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  // Only cells that can take the task count as drop targets.
  const draggingRef = useRef<DragData | null>(null);
  useEffect(() => {
    draggingRef.current = dragging;
  });
  const collisionDetection = useCallback<CollisionDetection>(
    (args) =>
      pointerWithin({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => {
          const d = c.data.current as DropData | undefined;
          return Boolean(d && accepts(d, draggingRef.current));
        }),
      }),
    [accepts],
  );

  const dropData = (over: { data: { current?: unknown } } | null) =>
    (over?.data.current as DropData | undefined) ?? null;
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const d = active.data.current as DragData;
      return `Picked up ${d.task.title}, from ${rowName(d.rowId)}, ${columnLabel(d.colKey)}.`;
    },
    onDragOver: ({ over }) => {
      const d = dropData(over);
      return d ? `Over ${rowName(d.rowId)}, ${columnLabel(d.colKey)}.` : undefined;
    },
    onDragEnd: ({ active, over }) => {
      const d = dropData(over);
      const t = (active.data.current as DragData).task.title;
      return d ? `Dropped ${t} on ${rowName(d.rowId)}, ${columnLabel(d.colKey)}.` : `${t} is back where it was.`;
    },
    onDragCancel: ({ active }) =>
      `Cancelled. ${(active.data.current as DragData).task.title} is back where it was.`,
  };

  function onDragStart({ active }: DragStartEvent) {
    document.body.dataset.dragging = "1";
    setPicked(null);
    setDragging(active.data.current as DragData);
  }

  function finish() {
    delete document.body.dataset.dragging;
    setDragging(null);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    finish();
    const to = dropData(over);
    if (to) commit(active.data.current as DragData, to);
  }

  return (
    <DndContext
      id={gridId}
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{ announcements, screenReaderInstructions: { draggable: INSTRUCTIONS } }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <p role="status" aria-live="assertive" className="sr-only">
        {status}
      </p>
      <table
        data-grid={gridId}
        className="w-full table-fixed border-separate border-spacing-0 text-left"
        // Room for two short lines of title in every column; the page scrolls sideways below that.
        style={{ minWidth: 176 + columns.length * 124 }}
      >
        <caption className="sr-only">
          Open tasks by person and day. Move a task to another person or day to change it.
        </caption>
        <colgroup>
          <col className="w-[132px] sm:w-[176px]" />
          {columns.map((c) => (
            <col key={c.key} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 top-0 z-20 border-b border-border bg-bg px-3 py-2 text-[12px] font-medium text-muted sm:px-4"
            >
              Person
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "sticky top-0 z-10 border-b border-l border-border bg-bg px-2 py-2 text-[12px] font-medium",
                  c.today ? "text-accent-text" : c.past ? "text-subtle" : "text-muted",
                  c.key === "overdue" && "text-danger-text",
                )}
              >
                <span className="block">{c.today ? `${c.label}, today` : c.label}</span>
                {c.sub && <span className="tabular block font-normal text-subtle">{c.sub}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowIds.map((rowId) => {
            const person = personById.get(rowId);
            const row = cells.get(rowId)!;
            const overdue = row.get("overdue")?.length ?? 0;
            const thisWeek = columns
              .filter((c) => c.dates)
              .reduce((n, c) => n + (row.get(c.key)?.length ?? 0), 0);
            const undated = workload.undatedTotal[rowId] ?? row.get("none")?.length ?? 0;
            return (
              <tr key={rowId}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-b border-border bg-bg px-3 py-2.5 align-top font-normal sm:px-4"
                >
                  <RowHeader
                    person={person}
                    isMe={rowId === viewerId}
                    summary={[
                      overdue ? `${overdue} overdue` : null,
                      thisWeek ? `${thisWeek} this week` : null,
                      undated ? `${undated} undated` : null,
                    ]}
                  />
                </th>
                {columns.map((c) => {
                  const drop = { rowId, colKey: c.key };
                  return (
                    <Cell
                      key={c.key}
                      domId={cellDomId(gridId, drop)}
                      rowId={rowId}
                      column={c}
                      tasks={row.get(c.key) ?? []}
                      more={c.key === "none" ? Math.max(0, undated - (row.get("none")?.length ?? 0)) : 0}
                      moreHref={
                        rowId === UNASSIGNED ? null : rowId === viewerId ? "/my-tasks" : `/team/${rowId}`
                      }
                      moving={moving}
                      accepted={accepts(drop, moving)}
                      targeted={picked?.target.rowId === rowId && picked.target.colKey === c.key}
                      picked={picked?.from ?? null}
                      onPick={pick}
                      workspaceById={workspaceById}
                      hrefFor={hrefFor}
                      today={today}
                    />
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <DragOverlay dropAnimation={null}>
        {dragging ? (
          <ChipBody
            task={dragging.task}
            workspace={workspaceById.get(dragging.task.workspaceId)}
            column={dragging.colKey}
            today={today}
            className="w-44 rotate-1 shadow-pop"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function describeMove(
  plan: ReturnType<typeof planMove>,
  move: { from: string | null; to: string | null },
  task: WorkloadTask,
  rowName: (id: string) => string,
  today: string,
) {
  const name = (id: string) => (rowName(id) === "You" ? "you" : rowName(id));
  const who =
    move.from === move.to
      ? null
      : move.from && move.to
        ? `Reassigned from ${name(move.from)} to ${name(move.to)}`
        : move.to
          ? `Assigned to ${name(move.to)}`
          : `Unassigned from ${name(move.from!)}`;
  const when =
    plan.dueDate === task.dueDate
      ? null
      : plan.dueDate
        ? `due ${formatDue(plan.dueDate, today).replace(/^(Today|Tomorrow)$/, (m) => m.toLowerCase())}`
        : "no due date";
  if (who && when) return `${who}, ${when}`;
  if (who) return who;
  return when === "no due date" ? "Due date removed" : `Now ${when}`;
}

function RowHeader({
  person,
  isMe,
  summary,
}: {
  person: WorkloadPerson | undefined;
  isMe: boolean;
  summary: (string | null)[];
}) {
  const text = summary.filter(Boolean).join(" · ") || "Nothing open";
  if (!person)
    return (
      <span className="flex min-w-0 items-start gap-2">
        <UserCircleDashedIcon size={24} className="shrink-0 text-subtle" aria-hidden />
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium">Unassigned</span>
          <span className="tabular block text-[12px] text-muted">{text}</span>
        </span>
      </span>
    );
  return (
    <Link
      href={isMe ? "/my-tasks" : `/team/${person.id}`}
      className="group/name flex min-w-0 items-start gap-2 rounded-md"
    >
      <Avatar person={person} size="sm" className="mt-px" />
      <span className="min-w-0">
        <span className="block text-[13px] font-medium break-words group-hover/name:underline">
          {person.name}
          {isMe && <span className="font-normal text-subtle"> (you)</span>}
        </span>
        <span className="tabular block text-[12px] text-muted">{text}</span>
      </span>
    </Link>
  );
}

function Cell({
  domId,
  rowId,
  column,
  tasks,
  more,
  moreHref,
  moving,
  accepted,
  targeted,
  picked,
  onPick,
  workspaceById,
  hrefFor,
  today,
}: {
  domId: string;
  rowId: string;
  column: Column;
  tasks: WorkloadTask[];
  /** Undated tasks not loaded here, for the No date column. */
  more: number;
  moreHref: string | null;
  moving: DragData | null;
  /** Whether the task being moved can land here. */
  accepted: boolean;
  /** The keyboard move's current target. */
  targeted: boolean;
  picked: DragData | null;
  onPick: (from: DragData) => void;
  workspaceById: Map<string, { id: string; name: string; color: string }>;
  hrefFor: (id: string) => string;
  today: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { setNodeRef, isOver } = useDroppable({
    id: `${rowId}|${column.key}`,
    data: { rowId, colKey: column.key } satisfies DropData,
    disabled: !accepted,
  });
  const busy = column.dates && tasks.length >= BUSY_DAY;
  const shown = expanded ? tasks : tasks.slice(0, CELL_PREVIEW);
  const hidden = tasks.length - shown.length;

  return (
    <td
      ref={setNodeRef}
      id={domId}
      className={cn(
        "h-16 scroll-m-24 border-b border-l border-border p-1.5 align-top transition-colors",
        column.past ? "bg-surface-2/50" : busy ? "bg-warning-soft/60" : column.today && "bg-accent-soft/25",
        moving && !accepted && "opacity-45",
        (isOver || targeted) && "bg-accent-soft/70 ring-2 ring-inset ring-accent",
      )}
    >
      {busy && <span className="sr-only">{pluralize(tasks.length, "task")} due, a busy day.</span>}
      <ul className="grid gap-1">
        {shown.map((t) => (
          <li key={t.id}>
            <Chip
              task={t}
              rowId={rowId}
              column={column.key}
              workspace={workspaceById.get(t.workspaceId)}
              href={hrefFor(t.id)}
              today={today}
              lifted={picked?.task.id === t.id && picked.rowId === rowId}
              onPick={onPick}
            />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 h-6 rounded-md px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          +{hidden} more
        </button>
      )}
      {expanded && tasks.length > CELL_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="mt-1 h-6 rounded-md px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-text"
        >
          Show fewer
        </button>
      )}
      {more > 0 &&
        (moreHref ? (
          <Link
            href={moreHref}
            className="mt-1 inline-flex h-6 items-center rounded-md px-1.5 text-[12px] font-medium text-muted hover:bg-surface-2 hover:text-text"
          >
            +{more} more
          </Link>
        ) : (
          <span className="mt-1 inline-flex h-6 items-center px-1.5 text-[12px] text-muted">
            +{more} more
          </span>
        ))}
    </td>
  );
}

function Chip({
  task,
  rowId,
  column,
  workspace,
  href,
  today,
  lifted,
  onPick,
}: {
  task: WorkloadTask;
  rowId: string;
  column: ColumnKey;
  workspace: { name: string; color: string } | undefined;
  href: string;
  today: string;
  /** Picked up with the keyboard. */
  lifted: boolean;
  onPick: (from: DragData) => void;
}) {
  const data = { task, rowId, colKey: column } satisfies DragData;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${task.id}|${rowId}`,
    data,
  });
  return (
    <Link
      ref={setNodeRef}
      href={href}
      scroll={false}
      draggable={false}
      {...attributes}
      {...listeners}
      // A link that can also be picked up, not a button.
      role={undefined}
      data-chip={task.id}
      aria-label={`${task.title}, #${task.number}${workspace ? `, ${workspace.name}` : ""}${task.urgent ? ", urgent" : ""}`}
      onKeyDown={(e) => {
        if (e.key === " " && !lifted) {
          e.preventDefault();
          onPick(data);
        }
      }}
      className={cn(
        "block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent",
        "cursor-grab touch-manipulation active:cursor-grabbing",
        (isDragging || lifted) && "opacity-40",
      )}
    >
      <ChipBody task={task} workspace={workspace} column={column} today={today} />
    </Link>
  );
}

function ChipBody({
  task,
  workspace,
  column,
  today,
  className,
}: {
  task: WorkloadTask;
  workspace: { name: string; color: string } | undefined;
  column: ColumnKey;
  today: string;
  className?: string;
}) {
  // The weekend column holds two days, and Overdue many: say which.
  const when =
    task.dueDate && (column === "overdue" || column === "weekend") ? formatDue(task.dueDate, today) : null;
  return (
    <span
      className={cn(
        "block rounded-md border border-border bg-surface px-2 py-1.5 shadow-card hover:border-border-strong",
        className,
      )}
      title={workspace ? `${task.title} (${workspace.name})` : task.title}
    >
      <span className="line-clamp-2 text-[12.5px] leading-snug text-text">{task.title}</span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted">
        {workspace && <WorkspaceMark color={workspace.color} size={8} />}
        <span className="tabular font-mono text-subtle">#{task.number}</span>
        {when && (
          <span className={cn("tabular truncate", column === "overdue" && "text-danger-text")}>{when}</span>
        )}
        {task.urgent && <UrgentFlag className="ml-auto" />}
      </span>
    </span>
  );
}
