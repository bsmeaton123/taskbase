"use client";

import { ChartBarHorizontalIcon, WarningCircleIcon } from "@phosphor-icons/react/ssr";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  format,
  isWeekend,
  parseISO,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { perform, useApp, useTaskNavigation } from "@/components/app-context";
import { EmptyState } from "@/components/page-header";
import { AssigneeAvatars } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { isClosed, STATUS_META } from "@/lib/status";
import { cn, pluralize } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import { updateTask } from "@/server/actions/tasks";
import type { TaskSummary } from "@/server/queries";
import { SelectBox, useTaskSelection } from "./selection";

type Zoom = "day" | "week" | "month";
type Dates = { start: string | null; due: string | null };
type Row =
  | { kind: "list"; id: string; name: string; count: number }
  | { kind: "task"; task: TaskSummary };

const DAY_WIDTH: Record<Zoom, number> = { day: 34, week: 14, month: 4.5 };
const ROW_H = 36;
const LIST_H = 32;
const HEADER_H = 52;
const ZOOM_KEY = "taskbase:gantt-zoom";
/**
 * The pinned task column grows with the chart's own width (a third of it, 150 to 340px),
 * so titles get room on wide screens without squeezing the timeline on phones.
 */
const LABEL_W = "var(--gantt-label)";
const LABEL_W_VALUE = "clamp(150px, 34cqw, 340px)";
/** Just right of the pinned column: where sticky labels in the timeline rest. */
const AFTER_LABEL = `calc(${LABEL_W} + 8px)`;
/** How far the timeline is scrolled, kept in a CSS variable so scrolling doesn't re-render. */
const SCROLL_X = "var(--gantt-sx, 0px)";
/** `SCROLL_X` minus a pixel offset, as a CSS expression (minus a negative is written as plus). */
const scrolledPast = (x: number) => `${SCROLL_X} ${x < 0 ? "+" : "-"} ${Math.abs(x)}px`;

const iso = (d: Date) => format(d, "yyyy-MM-dd");

/* Zoom level, remembered per browser (in memory when storage is unavailable). */
let memoryZoom: Zoom | null = null;
const zoomListeners = new Set<() => void>();
function readZoom(): Zoom {
  if (memoryZoom) return memoryZoom;
  try {
    const saved = localStorage.getItem(ZOOM_KEY);
    return saved === "week" || saved === "month" ? saved : "day";
  } catch {
    return "day";
  }
}
function writeZoom(z: Zoom) {
  memoryZoom = z;
  try {
    localStorage.setItem(ZOOM_KEY, z);
  } catch {
    /* private mode or blocked storage: the in-memory value still works */
  }
  zoomListeners.forEach((l) => l());
}
function subscribeZoom(listener: () => void) {
  zoomListeners.add(listener);
  return () => zoomListeners.delete(listener);
}

/** Bar colours by state, from the shared tokens. */
function barTone(task: TaskSummary, due: string | null, today: string) {
  if (isClosed(task.status)) return "border-border bg-surface-2 text-subtle line-through";
  if (due && due < today) return "border-danger/50 bg-danger-soft text-danger-text";
  if (task.status === "in_progress") return "border-accent bg-accent text-accent-fg";
  if (task.status === "on_hold") return "border-warning/50 bg-warning-soft text-text";
  return "border-accent/40 bg-accent-soft text-accent-text";
}

/**
 * Gantt chart: tasks as bars from start to due date, grouped by list. Drag a bar to move
 * it, drag its ends to change the start or due date, click to open it. Arrows show which
 * tasks wait for which (red when a task is planned to start before its blocker is due).
 */
export function GanttView({
  lists,
  tasks,
  dependencies,
}: {
  lists: { id: string; name: string }[];
  tasks: TaskSummary[];
  dependencies: { taskId: string; dependsOnId: string }[];
}) {
  const { today } = useApp();
  const { openTask, activeTaskId } = useTaskNavigation();
  const selection = useTaskSelection();
  const selecting = Boolean(selection?.active);
  const zoom = useSyncExternalStore(subscribeZoom, readZoom, () => "day" as Zoom);
  const [overrides, setOverrides] = useState<Record<string, Dates>>({});
  const [source, setSource] = useState(tasks);
  const [, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fresh server data replaces optimistic dates.
  if (source !== tasks) {
    setSource(tasks);
    setOverrides({});
  }

  const datesOf = (t: TaskSummary): Dates => overrides[t.id] ?? { start: t.startDate, due: t.dueDate };

  const rows = useMemo<Row[]>(
    () =>
      lists.flatMap((l) => {
        const items = tasks.filter((t) => t.taskListId === l.id);
        return [
          { kind: "list" as const, id: l.id, name: l.name, count: items.length },
          ...items.map((task) => ({ kind: "task" as const, task })),
        ];
      }),
    [lists, tasks],
  );

  const setVisible = selection?.setVisible;
  const orderKey = rows.flatMap((r) => (r.kind === "task" ? [r.task.id] : [])).join(",");
  useEffect(() => {
    setVisible?.(orderKey ? orderKey.split(",") : []);
  }, [orderKey, setVisible]);

  // The visible date range: every task's dates plus today, with room either side.
  const { rangeStart, days } = useMemo(() => {
    // Ignore dates far from today (typos like year 0002 or 20260), or the chart would be
    // hundreds of thousands of columns wide.
    const lo = iso(addDays(parseISO(today), -365 * 3));
    const hi = iso(addDays(parseISO(today), 365 * 5));
    const all = tasks
      .flatMap((t) => [t.startDate, t.dueDate])
      .filter((d): d is string => Boolean(d) && d! >= lo && d! <= hi);
    const sorted = [...all, today].sort();
    const first = parseISO(sorted[0]);
    const last = parseISO(sorted[sorted.length - 1]);
    const start =
      zoom === "month"
        ? startOfMonth(addDays(first, -14))
        : startOfWeek(addDays(first, -7), { weekStartsOn: 1 });
    const minSpan = zoom === "day" ? 63 : zoom === "week" ? 182 : 540;
    const end = addDays(last, zoom === "day" ? 21 : zoom === "week" ? 42 : 90);
    const span = Math.max(minSpan, differenceInCalendarDays(end, start) + 1);
    return { rangeStart: start, days: span };
  }, [tasks, today, zoom]);

  const dw = DAY_WIDTH[zoom];
  const width = days * dw;
  const xOf = (date: string) => differenceInCalendarDays(parseISO(date), rangeStart) * dw;
  const dateAt = (x: number) => iso(addDays(rangeStart, Math.max(0, Math.floor(x / dw))));

  // Start scrolled so today sits near the left, with a little context before it.
  const scrolledFor = useRef<{ zoom: Zoom; start: string } | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = iso(rangeStart);
    const prev = scrolledFor.current;
    if (prev && prev.zoom === zoom && prev.start === start) return;
    if (prev && prev.zoom === zoom) {
      // Only the range start moved (a task was dragged earlier): keep the same days in view.
      el.scrollLeft += differenceInCalendarDays(parseISO(prev.start), rangeStart) * dw;
    } else {
      el.scrollLeft = Math.max(0, xOf(today) - dw * (zoom === "day" ? 5 : 14));
    }
    scrolledFor.current = { zoom, start };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, rangeStart, today]);

  function scrollToToday() {
    scrollRef.current?.scrollTo({
      left: Math.max(0, xOf(today) - dw * (zoom === "day" ? 5 : 14)),
      behavior: "smooth",
    });
  }

  function save(task: TaskSummary, next: Dates) {
    // Compare with what the server has, not the drag preview (which already shows `next`).
    if (task.startDate === next.start && task.dueDate === next.due) {
      setOverrides((o) => {
        const rest = { ...o };
        delete rest[task.id];
        return rest;
      });
      return;
    }
    setOverrides((o) => ({ ...o, [task.id]: next }));
    startTransition(async () => {
      const res = await perform(
        updateTask({ id: task.id, startDate: next.start, dueDate: next.due }),
      );
      if (!res.ok)
        setOverrides((o) => {
          const rest = { ...o };
          delete rest[task.id];
          return rest;
        });
    });
  }

  // Row geometry, for the dependency arrows.
  const rowTop = new Map<string, number>();
  let y = 0;
  for (const r of rows) {
    if (r.kind === "task") rowTop.set(r.task.id, y);
    y += r.kind === "task" ? ROW_H : LIST_H;
  }
  const bodyH = y;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const spanOf = (t: TaskSummary) => {
    const d = datesOf(t);
    const start = d.start ?? d.due;
    const end = d.due ?? d.start;
    if (!start || !end) return null;
    return { x: xOf(start), w: (differenceInCalendarDays(parseISO(end), parseISO(start)) + 1) * dw, start, end };
  };

  const unscheduled = tasks.filter((t) => !t.startDate && !t.dueDate).length;

  if (rows.length === 0)
    return (
      <EmptyState icon={<ChartBarHorizontalIcon size={20} />} title="Nothing to plan yet">
        Add a task list from the List or Board view, then give its tasks dates to see them here.
      </EmptyState>
    );

  return (
    <div
      className="@container flex h-full min-h-0 flex-col"
      style={{ "--gantt-label": LABEL_W_VALUE } as React.CSSProperties}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:px-6">
        <div
          className="inline-flex h-7 items-center rounded-md border border-border bg-surface-2 p-0.5"
          role="radiogroup"
          onKeyDown={radioGroupKeys}
          aria-label="Zoom"
        >
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              type="button"
              role="radio"
              aria-checked={zoom === z}
              tabIndex={zoom === z ? 0 : -1}
              onClick={() => writeZoom(z)}
              className={cn(
                "inline-flex h-full items-center rounded-[5px] px-2 text-[12.5px] font-medium",
                zoom === z ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
              )}
            >
              {z === "day" ? "Days" : z === "week" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={scrollToToday}>
          Today
        </Button>
        <span className="flex-1" />
        <p className="hidden text-[12.5px] text-subtle md:block">
          Drag bars to reschedule, drag their ends to change dates.
          {unscheduled > 0 &&
            ` ${pluralize(unscheduled, "task")} without dates: click a day in a task's row to set its due date.`}
        </p>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin relative min-h-0 flex-1 overflow-auto"
        onScroll={(e) =>
          e.currentTarget.style.setProperty("--gantt-sx", `${e.currentTarget.scrollLeft}px`)
        }
      >
        <div
          className={cn("relative", selecting && "pb-20")}
          style={{ width: `calc(${LABEL_W} + ${width}px)`, minHeight: "100%" }}
        >
          {/* Header */}
          <div className="sticky top-0 z-20 flex" style={{ height: HEADER_H }}>
            <div
              className="sticky left-0 z-30 flex shrink-0 items-end border-b border-r border-border bg-surface px-3 pb-2 text-[12px] font-medium text-subtle"
              style={{ width: LABEL_W }}
            >
              Task
            </div>
            <TimeHeader
              rangeStart={rangeStart}
              days={days}
              dw={dw}
              zoom={zoom}
              today={today}
              stickyLeft={AFTER_LABEL}
            />
          </div>

          {/* Grid lines, weekends and the today line */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0"
            style={{ left: LABEL_W, top: HEADER_H, width }}
          >
            <GridBackground rangeStart={rangeStart} days={days} dw={dw} zoom={zoom} />
            <div className="absolute inset-y-0 w-px bg-accent" style={{ left: xOf(today) + dw / 2 }} />
          </div>

          {/* Dependency arrows */}
          <svg
            aria-hidden
            className="pointer-events-none absolute z-0"
            style={{ left: LABEL_W, top: HEADER_H, width, height: bodyH }}
            width={width}
            height={bodyH}
          >
            <defs>
              <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="fill-subtle" />
              </marker>
              <marker id="gantt-arrow-late" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="fill-danger" />
              </marker>
            </defs>
            {dependencies.map((d) => {
              const task = byId.get(d.taskId);
              const blocker = byId.get(d.dependsOnId);
              if (!task || !blocker) return null;
              const a = spanOf(blocker);
              const b = spanOf(task);
              const ya = rowTop.get(blocker.id);
              const yb = rowTop.get(task.id);
              if (!a || !b || ya === undefined || yb === undefined) return null;
              const late = b.start <= a.end && !isClosed(blocker.status);
              const x1 = a.x + a.w;
              const y1 = ya + ROW_H / 2;
              const x2 = b.x;
              const y2 = yb + ROW_H / 2;
              const bend = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 8));
              const path =
                x2 - 16 >= x1
                  ? `M${x1},${y1} H${bend} V${y2} H${x2 - 1}`
                  : `M${x1},${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2 - 1}`;
              return (
                <path
                  key={`${d.taskId}-${d.dependsOnId}`}
                  d={path}
                  fill="none"
                  strokeWidth={1.5}
                  className={late ? "stroke-danger" : "stroke-subtle"}
                  markerEnd={`url(#${late ? "gantt-arrow-late" : "gantt-arrow"})`}
                />
              );
            })}
          </svg>

          {/* Rows */}
          <div className="relative">
            {rows.map((r) =>
              r.kind === "list" ? (
                <div key={`l-${r.id}`} className="flex" style={{ height: LIST_H }}>
                  <div
                    className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-r border-border bg-surface px-3"
                    style={{ width: LABEL_W }}
                  >
                    <span className="truncate text-[12.5px] font-semibold">{r.name}</span>
                    <span className="tabular text-[12px] text-subtle">{r.count}</span>
                  </div>
                  <div className="border-b border-border/70 bg-surface-2/40" style={{ width }} />
                </div>
              ) : (
                <GanttRow
                  key={r.task.id}
                  task={r.task}
                  dates={datesOf(r.task)}
                  span={spanOf(r.task)}
                  width={width}
                  dw={dw}
                  today={today}
                  active={r.task.id === activeTaskId}
                  select={
                    selecting && selection
                      ? {
                          selected: selection.selected.has(r.task.id),
                          onToggle: (range) => selection.toggle(r.task.id, range),
                        }
                      : undefined
                  }
                  onOpen={() => openTask(r.task.id)}
                  onPreview={(next) => setOverrides((o) => ({ ...o, [r.task.id]: next }))}
                  onCommit={(next) => save(r.task, next)}
                  onCancel={() =>
                    setOverrides((o) => {
                      const rest = { ...o };
                      delete rest[r.task.id];
                      return rest;
                    })
                  }
                  dateAt={dateAt}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttRow({
  task,
  dates,
  span,
  width,
  dw,
  today,
  active,
  select,
  onOpen,
  onPreview,
  onCommit,
  onCancel,
  dateAt,
}: {
  task: TaskSummary;
  dates: Dates;
  span: { x: number; w: number; start: string; end: string } | null;
  width: number;
  dw: number;
  today: string;
  active: boolean;
  select?: { selected: boolean; onToggle: (range: boolean) => void };
  onOpen: () => void;
  onPreview: (d: Dates) => void;
  onCommit: (d: Dates) => void;
  onCancel: () => void;
  dateAt: (x: number) => string;
}) {
  const closed = isClosed(task.status);
  const drag = useRef<{
    mode: "move" | "start" | "end";
    x0: number;
    from: Dates;
    moved: boolean;
    last: Dates;
  } | null>(null);

  function shifted(from: Dates, mode: "move" | "start" | "end", delta: number): Dates {
    const move = (d: string | null) => (d ? iso(addDays(parseISO(d), delta)) : null);
    if (mode === "move") return { start: move(from.start), due: move(from.due) };
    const start = from.start ?? from.due!;
    const due = from.due ?? from.start!;
    if (mode === "start") {
      const next = iso(addDays(parseISO(start), delta));
      return { start: next > due ? due : next, due: from.due ?? due };
    }
    const next = iso(addDays(parseISO(due), delta));
    return { start: from.start, due: next < start ? start : next };
  }

  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0 || select) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>("[data-handle]")?.dataset.handle;
    drag.current = {
      mode: handle === "start" || handle === "end" ? handle : "move",
      x0: e.clientX,
      from: dates,
      moved: false,
      last: dates,
    };
    document.body.dataset.dragging = "1";
    try {
      // Keep receiving moves when the pointer leaves the bar.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* the drag still works while the pointer stays over the bar */
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    // A few pixels of wobble is still a click; only a real move starts a drag.
    if (!d.moved && Math.abs(e.clientX - d.x0) < 4) return;
    const delta = Math.round((e.clientX - d.x0) / dw);
    if (delta === 0 && !d.moved) return;
    d.moved = true;
    d.last = shifted(d.from, d.mode, delta);
    onPreview(d.last);
  }

  function onPointerUp() {
    const d = drag.current;
    drag.current = null;
    delete document.body.dataset.dragging;
    if (!d) return;
    if (!d.moved) onOpen();
    else onCommit(d.last);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (select) select.onToggle(e.shiftKey);
      else onOpen();
      return;
    }
    if (select || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const step = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 7 : 1);
    onCommit(shifted(dates, "move", step));
  }

  const label = (
    <>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[13px]",
          closed ? "text-subtle line-through decoration-subtle/60" : "text-text",
        )}
      >
        {task.title}
      </span>
      <AssigneeAvatars
        people={task.assignees}
        size="xs"
        compactOnPhones
        ring={active || select?.selected ? "ring-accent-soft" : "ring-surface"}
      />
    </>
  );

  const titleInside = span && span.w >= 96;
  const rangeText = span
    ? span.start === span.end
      ? format(parseISO(span.end), "d MMM")
      : `${format(parseISO(span.start), "d MMM")} to ${format(parseISO(span.end), "d MMM")}`
    : "";
  // Bar colours carry status and lateness, so say both in words too.
  const overdue = !closed && Boolean(dates.due && dates.due < today);
  const state = [
    task.status === "open" ? null : STATUS_META[task.status].label.toLowerCase(),
    overdue ? "overdue" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const describe = `${rangeText}${state ? `, ${state}` : ""}`;
  const warning = overdue && (
    <WarningCircleIcon size={12} weight="fill" aria-hidden className="shrink-0 text-danger-text" />
  );

  return (
    <div className="group/grow flex" style={{ height: ROW_H }}>
      {select ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={select.selected}
          aria-label={task.title}
          onClick={(e) => select.onToggle(e.shiftKey)}
          title={task.title}
          className={cn(
            "sticky left-0 z-10 flex shrink-0 select-none items-center gap-2 border-b border-r border-border px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            select.selected ? "bg-accent-soft" : "bg-surface hover:bg-surface-2",
          )}
          style={{ width: LABEL_W }}
        >
          <SelectBox checked={select.selected} />
          {label}
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          title={task.title}
          className={cn(
            "sticky left-0 z-10 flex shrink-0 items-center gap-2 border-b border-r border-border px-3 text-left outline-none focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
            active ? "bg-accent-soft" : "bg-surface hover:bg-surface-2",
          )}
          style={{ width: LABEL_W }}
        >
          {label}
        </button>
      )}

      <div
        className={cn(
          "relative border-b border-border/50",
          !span && !select && "cursor-copy",
          active && "bg-accent-soft/30",
        )}
        style={{ width }}
        onClick={(e) => {
          if (span || select) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onCommit({ start: null, due: dateAt(e.clientX - rect.left) });
        }}
      >
        {!span && !select && (
          <span
            className="pointer-events-none sticky top-0 hidden h-full items-center pl-2 text-[12px] text-subtle group-hover/grow:inline-flex"
            style={{ left: AFTER_LABEL }}
          >
            Click a day to set the due date
          </span>
        )}
        {span && (
          <>
            <div
              role="button"
              tabIndex={select ? -1 : 0}
              aria-label={`${task.title}, ${describe}. Arrow keys move it a day, Shift+arrow a week.`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => {
                drag.current = null;
                delete document.body.dataset.dragging;
                onCancel();
              }}
              onKeyDown={onKeyDown}
              title={`${task.title} (${describe})`}
              className={cn(
                "absolute top-[6px] flex touch-none select-none items-center overflow-hidden rounded-md border text-[12px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent",
                select ? "cursor-default" : "cursor-grab active:cursor-grabbing",
                barTone(task, dates.due, today),
                active && "ring-2 ring-accent/40",
              )}
              style={{ left: span.x + 1, width: Math.max(span.w - 2, 6), height: ROW_H - 12 }}
            >
              {!select && span.w >= 28 && (
                <span
                  data-handle="start"
                  className="absolute inset-y-0 left-0 w-2 cursor-ew-resize"
                  aria-hidden
                />
              )}
              {titleInside && (
                // Starts where the bar comes into view, so a bar scrolled partly under the
                // task column still shows the beginning of its title.
                <span
                  className="flex min-w-0 items-center gap-1 pr-2"
                  style={{
                    paddingLeft: `calc(min(max(0px, ${scrolledPast(span.x + 1)}), ${Math.max(0, span.w - 40)}px) + 8px)`,
                  }}
                >
                  {warning}
                  <span className="truncate">{task.title}</span>
                </span>
              )}
              {!select && span.w >= 28 && (
                <span
                  data-handle="end"
                  className="absolute inset-y-0 right-0 w-2 cursor-ew-resize"
                  aria-hidden
                />
              )}
            </div>
            {!titleInside && (
              // Bounded to the row (right: 0) so the scroll-driven padding can never widen
              // the chart; a long title truncates at the row's end instead.
              <span
                className="pointer-events-none absolute top-0 flex h-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[12px] text-muted"
                style={{
                  left: span.x + span.w + 6,
                  right: 0,
                  paddingLeft: `max(0px, ${scrolledPast(span.x + span.w - 2)})`,
                }}
              >
                {warning}
                <span className="truncate">{task.title}</span>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TimeHeader({
  rangeStart,
  days,
  dw,
  zoom,
  today,
  stickyLeft,
}: {
  rangeStart: Date;
  days: number;
  dw: number;
  zoom: Zoom;
  today: string;
  /** Month labels stick just right of the pinned task column while scrolling. */
  stickyLeft: string;
}) {
  const end = addDays(rangeStart, days);
  // Top band: months (or years when zoomed out).
  const top: { key: string; label: string; x: number; w: number }[] = [];
  let cursor = zoom === "month" ? new Date(rangeStart.getFullYear(), 0, 1) : startOfMonth(rangeStart);
  while (cursor < end) {
    const next = zoom === "month" ? new Date(cursor.getFullYear() + 1, 0, 1) : addMonths(cursor, 1);
    const from = Math.max(0, differenceInCalendarDays(cursor, rangeStart));
    const to = Math.min(days, differenceInCalendarDays(next, rangeStart));
    if (to > from)
      top.push({
        key: iso(cursor),
        label: zoom === "month" ? format(cursor, "yyyy") : format(cursor, "MMMM yyyy"),
        x: from * dw,
        w: (to - from) * dw,
      });
    cursor = next;
  }

  // Bottom band: days, week starts, or months.
  const bottom: { key: string; label: string; x: number; w: number; today?: boolean; weekend?: boolean }[] = [];
  if (zoom === "day") {
    for (let i = 0; i < days; i++) {
      const d = addDays(rangeStart, i);
      bottom.push({
        key: iso(d),
        label: format(d, "d"),
        x: i * dw,
        w: dw,
        today: iso(d) === today,
        weekend: isWeekend(d),
      });
    }
  } else if (zoom === "week") {
    for (let i = 0; i < days; i += 7) {
      const d = addDays(rangeStart, i);
      bottom.push({ key: iso(d), label: format(d, "d MMM"), x: i * dw, w: 7 * dw });
    }
  } else {
    let m = startOfMonth(rangeStart);
    while (m < end) {
      const from = Math.max(0, differenceInCalendarDays(m, rangeStart));
      const to = Math.min(days, differenceInCalendarDays(addMonths(m, 1), rangeStart));
      bottom.push({ key: iso(m), label: format(m, "MMM"), x: from * dw, w: (to - from) * dw });
      m = addMonths(m, 1);
    }
  }

  return (
    <div className="tabular relative shrink-0 border-b border-border bg-surface" style={{ width: days * dw }}>
      {top.map((t) => (
        <div
          key={t.key}
          className="absolute top-0 flex h-6 items-center border-l border-border/70 px-2 text-[12px] font-semibold"
          style={{ left: t.x, width: t.w }}
        >
          <span className="sticky max-w-full truncate" style={{ left: stickyLeft }}>
            {t.label}
          </span>
        </div>
      ))}
      {bottom.map((b) => (
        <div
          key={b.key}
          className={cn(
            "absolute bottom-0 flex h-6 items-center justify-center border-l border-border/50 text-[11.5px]",
            zoom !== "day" && "justify-start px-1.5",
            b.today ? "font-semibold text-accent-text" : b.weekend ? "text-subtle" : "text-muted",
          )}
          style={{ left: b.x, width: b.w }}
        >
          {b.label}
        </div>
      ))}
    </div>
  );
}

function GridBackground({
  rangeStart,
  days,
  dw,
  zoom,
}: {
  rangeStart: Date;
  days: number;
  dw: number;
  zoom: Zoom;
}) {
  if (zoom === "day") {
    return (
      <>
        {Array.from({ length: days }, (_, i) => {
          const d = addDays(rangeStart, i);
          return (
            <div
              key={i}
              className={cn("absolute inset-y-0 border-l border-border/40", isWeekend(d) && "bg-surface-2/60")}
              style={{ left: i * dw, width: dw }}
            />
          );
        })}
      </>
    );
  }
  if (zoom === "week") {
    return (
      <>
        {Array.from({ length: Math.ceil(days / 7) }, (_, i) => (
          <div key={i} className="absolute inset-y-0 border-l border-border/40" style={{ left: i * 7 * dw }} />
        ))}
      </>
    );
  }
  const end = addDays(rangeStart, days);
  const lines: number[] = [];
  for (let m = startOfMonth(addMonths(rangeStart, 1)); m < end; m = addMonths(m, 1))
    lines.push(differenceInCalendarDays(m, rangeStart) * dw);
  return (
    <>
      {lines.map((x) => (
        <div key={x} className="absolute inset-y-0 border-l border-border/40" style={{ left: x }} />
      ))}
    </>
  );
}
