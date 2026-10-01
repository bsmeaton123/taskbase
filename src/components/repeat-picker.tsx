"use client";

import { CaretLeftIcon, CheckIcon } from "@phosphor-icons/react/ssr";
import { getDay, parseISO } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DAY_SHORT,
  describeRecurrence,
  recurrencePresets,
  sameRecurrence,
  type Recurrence,
} from "@/lib/recurrence";
import { cn } from "@/lib/utils";

const FREQS: { value: Recurrence["freq"]; one: string; many: string }[] = [
  { value: "daily", one: "day", many: "days" },
  { value: "weekly", one: "week", many: "weeks" },
  { value: "monthly", one: "month", many: "months" },
  { value: "yearly", one: "year", many: "years" },
];
// Monday first, as people read a week.
const WEEK = [1, 2, 3, 4, 5, 6, 0];

const field =
  "h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

/** Arrow keys, Home and End move between the presets, as in any menu. */
function moveFocus(e: React.KeyboardEvent<HTMLElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  if (items.length === 0) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? last
        : e.key === "ArrowDown"
          ? (i + 1) % items.length
          : i <= 0
            ? last
            : i - 1;
  items[next].focus();
}

/**
 * Choose how a task repeats: one-tap presets built around its due date, or a custom rule
 * (every N days/weeks/months/years, chosen weekdays, day of the month, end date).
 */
export function RepeatPicker({
  value,
  anchor,
  hasDue = true,
  onChange,
  children,
  align = "start",
}: {
  value: Recurrence | null;
  /** The task's due date, or today: presets are phrased around it. */
  anchor: string;
  /** Whether the task has a due date (some wording depends on it). */
  hasDue?: boolean;
  onChange: (rule: Recurrence | null) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const presets = recurrencePresets(anchor);
  const isPreset = value ? presets.some((p) => sameRecurrence(p.rule, value)) : false;

  function choose(rule: Recurrence | null) {
    onChange(rule);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setCustom(Boolean(value) && !isPreset);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-72 p-1">
        {custom ? (
          <CustomRepeat
            initial={
              value ?? { freq: "weekly", interval: 1, weekdays: [getDay(parseISO(anchor))] }
            }
            anchor={anchor}
            hasDue={hasDue}
            onBack={() => setCustom(false)}
            onSave={choose}
          />
        ) : (
          <div role="menu" aria-label="Repeat" onKeyDown={moveFocus}>
            {presets.map((p) => {
              const selected = value !== null && sameRecurrence(p.rule, value);
              return (
                <button
                  key={p.label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  onClick={() => choose(p.rule)}
                  className={cn(
                    "flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-surface-2",
                    selected && "text-accent-text",
                  )}
                >
                  {p.label}
                  {selected && <CheckIcon size={14} weight="bold" />}
                </button>
              );
            })}
            <div role="separator" className="my-1 h-px bg-border" />
            <button
              type="button"
              role="menuitem"
              onClick={() => setCustom(true)}
              className="flex h-8 w-full items-center justify-between rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
            >
              <span>Custom…</span>
              {value && !isPreset && (
                <span className="truncate pl-3 text-[12px] text-accent-text">
                  {describeRecurrence(value, anchor)}
                </span>
              )}
            </button>
            {value && (
              <button
                type="button"
                role="menuitem"
                onClick={() => choose(null)}
                className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-danger-text hover:bg-danger-soft"
              >
                Stop repeating
              </button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function CustomRepeat({
  initial,
  anchor,
  hasDue,
  onBack,
  onSave,
}: {
  initial: Recurrence;
  anchor: string;
  hasDue: boolean;
  onBack: () => void;
  onSave: (rule: Recurrence) => void;
}) {
  const [rule, setRule] = useState<Recurrence>(initial);
  const [intervalText, setIntervalText] = useState(String(initial.interval));
  const set = (patch: Partial<Recurrence>) => setRule((r) => ({ ...r, ...patch }));
  const weekdays = rule.weekdays ?? [];
  const typed = Number(intervalText);
  const noDays = rule.freq === "weekly" && weekdays.length === 0;
  const valid = Number.isInteger(typed) && typed >= 1 && typed <= 99 && !noDays;

  return (
    <form
      method="post"
      className="grid gap-3 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const clean: Recurrence = { freq: rule.freq, interval: rule.interval };
        if (rule.freq === "weekly" && weekdays.length) clean.weekdays = [...weekdays].sort();
        if (rule.freq === "monthly" && rule.monthDay !== undefined) clean.monthDay = rule.monthDay;
        if (rule.from === "completion") clean.from = "completion";
        if (rule.until) clean.until = rule.until;
        onSave(clean);
      }}
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to presets"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
        >
          <CaretLeftIcon size={14} />
        </button>
        <span className="text-[13px] font-semibold">Custom repeat</span>
      </div>

      <label className="flex items-center gap-2 text-[13px]">
        Every
        <input
          type="number"
          min={1}
          max={99}
          value={intervalText}
          onChange={(e) => {
            setIntervalText(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1 && n <= 99) set({ interval: n });
          }}
          onBlur={() => setIntervalText(String(rule.interval))}
          className={cn(field, "w-16")}
          aria-label="Interval"
        />
        <select
          value={rule.freq}
          onChange={(e) => {
            const freq = e.target.value as Recurrence["freq"];
            set({
              freq,
              weekdays: freq === "weekly" ? [getDay(parseISO(anchor))] : undefined,
              monthDay: undefined,
            });
          }}
          className={cn(field, "flex-1")}
          aria-label="Repeat unit"
        >
          {FREQS.map((f) => (
            <option key={f.value} value={f.value}>
              {rule.interval === 1 ? f.one : f.many}
            </option>
          ))}
        </select>
      </label>

      {rule.freq === "weekly" && (
        <div className="grid gap-1.5">
          <span className="text-[12px] text-muted">On</span>
          <div className="flex gap-1">
            {WEEK.map((d) => {
              const on = weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={DAY_SHORT[d]}
                  onClick={() =>
                    set({ weekdays: on ? weekdays.filter((x) => x !== d) : [...weekdays, d] })
                  }
                  className={cn(
                    "inline-flex h-8 flex-1 items-center justify-center rounded-md border text-[12px] font-medium",
                    on
                      ? "border-accent bg-accent text-accent-fg"
                      : "border-border text-muted hover:border-border-strong hover:text-text",
                  )}
                >
                  {DAY_SHORT[d].slice(0, 2)}
                </button>
              );
            })}
          </div>
          {noDays && (
            <p className="text-[12.5px] text-danger-text" role="alert">
              Choose at least one day.
            </p>
          )}
        </div>
      )}

      {rule.freq === "monthly" && (
        <label className="flex items-center gap-2 text-[13px]">
          On
          <select
            value={rule.monthDay ?? ""}
            onChange={(e) => set({ monthDay: e.target.value ? Number(e.target.value) : undefined })}
            className={cn(field, "flex-1")}
            aria-label="Day of the month"
          >
            <option value="">{hasDue ? "the due date's day" : "the same day each month"}</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                day {d}
              </option>
            ))}
            <option value={-1}>the last day</option>
          </select>
        </label>
      )}

      <fieldset className="grid gap-1 text-[13px]">
        <legend className="mb-1 text-[12px] text-muted">Next one is due</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="repeat-from"
            checked={rule.from !== "completion"}
            onChange={() => set({ from: undefined })}
            className="accent-[var(--accent)]"
          />
          On schedule, from the due date
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="repeat-from"
            checked={rule.from === "completion"}
            onChange={() => set({ from: "completion" })}
            className="accent-[var(--accent)]"
          />
          Counting from when it&apos;s done
        </label>
      </fieldset>

      <label className="flex items-center gap-2 text-[13px]">
        Ends
        <input
          type="date"
          value={rule.until ?? ""}
          min={anchor}
          onChange={(e) => set({ until: e.target.value || null })}
          className={cn(field, "flex-1")}
          aria-label="End date (optional)"
        />
      </label>

      <p className="rounded-md bg-surface-2 px-2 py-1.5 text-[12.5px] text-muted" aria-live="polite">
        {describeRecurrence(
          {
            ...rule,
            weekdays: rule.freq === "weekly" ? weekdays : undefined,
          },
          anchor,
        )}
      </p>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!valid}>
          Save
        </Button>
      </div>
    </form>
  );
}
