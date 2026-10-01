"use client";

import {
  CalendarBlankIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  UserCircleDashedIcon,
} from "@phosphor-icons/react/ssr";
import { format, parseISO } from "date-fns";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatLongDate, shiftDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

type Person = { id: string; name: string; email?: string; image?: string | null };

/**
 * Choose one person: search, then pick (the list closes). Arrow keys move, Enter picks.
 * `allowNone` offers "Unassigned" first; turn it off when adding someone to a list.
 */
export function PersonPicker({
  people,
  value,
  onChange,
  children,
  align = "start",
  viewerId,
  allowNone = true,
  placeholder,
  label = "People",
}: {
  people: Person[];
  value: string | null;
  onChange: (id: string | null) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  viewerId?: string;
  allowNone?: boolean;
  /** Defaults to "Assign to…", or "Find people" without the "Unassigned" option. */
  placeholder?: string;
  /** Names the list for screen readers. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...people].sort((a, b) =>
      a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0,
    );
    const matches = sorted.filter(
      (p) =>
        !q ||
        p.name.toLowerCase().includes(q) ||
        p.email?.toLowerCase().includes(q),
    );
    return [
      ...(q || !allowNone ? [] : [{ id: null as string | null, name: "Unassigned" }]),
      ...matches,
    ] as (Person | { id: null; name: string })[];
  }, [people, query, viewerId, allowNone]);

  const active = Math.min(cursor, Math.max(options.length - 1, 0));
  const optionId = (id: string | null) => `${listId}-${id ?? "none"}`;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(id: string | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
        setCursor(0);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <MagnifyingGlassIcon size={14} className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(active + 1, Math.max(options.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(active - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const opt = options[active];
                if (opt) choose(opt.id);
              }
            }}
            placeholder={placeholder ?? (allowNone ? "Assign to…" : "Find people")}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? optionId(options[active].id) : undefined}
            aria-label="Search people"
            className="h-9 w-full bg-transparent text-[13px] outline-none"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn("scrollbar-thin max-h-64 overflow-y-auto", options.length > 0 && "p-1")}
        >
          {options.map((opt, i) => (
            <button
              key={opt.id ?? "none"}
              id={optionId(opt.id)}
              type="button"
              role="option"
              aria-selected={value === opt.id}
              data-active={i === active}
              tabIndex={-1}
              onMouseEnter={() => setCursor(i)}
              onClick={() => choose(opt.id)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                i === active && "bg-surface-2",
              )}
            >
              {opt.id ? (
                <Avatar person={opt as Person} size="xs" />
              ) : (
                <UserCircleDashedIcon size={20} className="shrink-0 text-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {opt.name}
                {opt.id && opt.id === viewerId && (
                  <span className="text-muted"> (you)</span>
                )}
              </span>
              {value === opt.id && (
                <CheckIcon size={14} weight="bold" className="shrink-0 text-accent" />
              )}
            </button>
          ))}
        </div>
        {options.length === 0 && (
          <p className="px-3 py-3 text-center text-[12.5px] text-muted">
            {query.trim() ? `Nobody matches “${query.trim()}”.` : "Nobody to choose from."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Choose several people: search, then tick or untick (each change applies straight away and
 * the list stays open). `selected` are the ids that are on; for many tasks at once, the
 * people on all of them. Arrow keys move, Enter toggles, Escape closes.
 */
export function PeoplePicker({
  people,
  selected,
  onToggle,
  children,
  align = "start",
  viewerId,
  label = "Assignees",
}: {
  people: Person[];
  selected: Set<string>;
  onToggle: (person: Person, on: boolean) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  viewerId?: string;
  /** Names the list for screen readers. */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...people].sort((a, b) =>
      a.id === viewerId ? -1 : b.id === viewerId ? 1 : 0,
    );
    return sorted.filter(
      (p) => !q || p.name.toLowerCase().includes(q) || p.email?.toLowerCase().includes(q),
    );
  }, [people, query, viewerId]);

  const active = Math.min(cursor, Math.max(options.length - 1, 0));
  const optionId = (id: string) => `${listId}-${id}`;

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function toggle(person: Person | undefined) {
    if (person) onToggle(person, !selected.has(person.id));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
        setCursor(0);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-0">
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <MagnifyingGlassIcon size={14} className="shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(active + 1, Math.max(options.length - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(active - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                toggle(options[active]);
              }
            }}
            placeholder="Find people"
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? optionId(options[active].id) : undefined}
            aria-label="Search people"
            className="h-9 w-full bg-transparent text-[13px] outline-none"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable
          className={cn("scrollbar-thin max-h-64 overflow-y-auto", options.length > 0 && "p-1")}
        >
          {options.map((p, i) => {
            const on = selected.has(p.id);
            return (
              <button
                key={p.id}
                id={optionId(p.id)}
                type="button"
                role="option"
                aria-selected={on}
                data-active={i === active}
                tabIndex={-1}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  setCursor(i);
                  toggle(p);
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                  i === active && "bg-surface-2",
                )}
              >
                <Avatar person={p} size="xs" />
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  {p.id === viewerId && <span className="text-muted"> (you)</span>}
                </span>
                {on && <CheckIcon size={14} weight="bold" className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
        {options.length === 0 && (
          <p className="px-3 py-3 text-center text-[12.5px] text-muted">
            {query.trim()
              ? `Nobody in this workspace matches “${query.trim()}”.`
              : "Nobody to assign yet."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** A form field for choosing assignees: shows who's picked and opens the people picker. */
export function AssigneesField({
  people,
  value,
  onChange,
  viewerId,
  className,
}: {
  people: Person[];
  value: string[];
  onChange: (ids: string[]) => void;
  viewerId?: string;
  className?: string;
}) {
  const picked = value
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is Person => Boolean(p));
  return (
    <PeoplePicker
      people={people}
      selected={new Set(value)}
      onToggle={(person, on) =>
        onChange(
          on
            ? [...value.filter((id) => id !== person.id), person.id]
            : value.filter((id) => id !== person.id),
        )
      }
      viewerId={viewerId}
    >
      <button
        type="button"
        aria-label={
          picked.length ? `Assignees: ${picked.map((p) => p.name).join(", ")}` : "Assignees: nobody"
        }
        className={cn("inline-flex items-center gap-1.5 text-left", className)}
      >
        {picked.length === 0 ? (
          <>
            <UserCircleDashedIcon size={16} className="shrink-0 text-subtle" />
            <span className="truncate text-subtle">Unassigned</span>
          </>
        ) : (
          <>
            <AvatarStack people={picked} max={3} size="xs" ring="ring-surface" />
            <span className="min-w-0 truncate">{picked.map((p) => p.name).join(", ")}</span>
          </>
        )}
      </button>
    </PeoplePicker>
  );
}

export function DuePicker({
  value,
  today,
  onChange,
  children,
  align = "start",
  allowClear,
  kind = "due date",
}: {
  value: string | null;
  today: string;
  onChange: (date: string | null) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  /** Offer the remove option even with no value (e.g. when editing many tasks). */
  allowClear?: boolean;
  /** What the picked date is, for the remove option. Default "due date". */
  kind?: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);

  function commitTyped() {
    if (typed === null) return;
    const t = typed;
    setTyped(null);
    if (t && t >= "2000-01-01" && t <= "2099-12-31") choose(t);
  }

  // Days until next Monday (1..7).
  const dow = new Date(`${today}T12:00:00`).getDay();
  const toMonday = ((8 - dow) % 7) || 7;
  const quick = [
    { label: "Today", date: today },
    { label: "Tomorrow", date: shiftDate(today, 1) },
    { label: "Next Monday", date: shiftDate(today, toMonday) },
    { label: "In 2 weeks", date: shiftDate(today, 14) },
  ];

  function choose(date: string | null) {
    onChange(date);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setTyped(null);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className="w-60 p-1">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => choose(q.date)}
            className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
          >
            <span className="min-w-0 flex-1 truncate">{q.label}</span>
            <span className="tabular text-[12px] text-muted">
              {format(parseISO(q.date), "EEE d MMM")}
            </span>
            <span className="inline-flex w-3.5 shrink-0 justify-center">
              {value === q.date && (
                <CheckIcon
                  size={14}
                  weight="bold"
                  className="text-accent"
                  role="img"
                  aria-label="Selected"
                />
              )}
            </span>
          </button>
        ))}
        <div className="-mx-1 my-1 h-px bg-border" />
        <label className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
          <CalendarBlankIcon size={15} className="shrink-0 text-muted" />
          <span className="sr-only">Pick a date</span>
          <Input
            type="date"
            value={typed ?? value ?? ""}
            min="2000-01-01"
            max="2099-12-31"
            // Browsers fire a change for every digit typed into the year, so the value is
            // held until the field is left or Enter is pressed, and only sensible years count.
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commitTyped}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitTyped();
              }
            }}
            className="h-8 min-w-0 flex-1 px-2 text-[13px]"
          />
        </label>
        {(value || allowClear) && (
          <>
            {value && <p className="px-2 pb-1 text-[12px] text-muted">{formatLongDate(value)}</p>}
            <button
              type="button"
              onClick={() => choose(null)}
              className="flex h-8 w-full items-center rounded-md px-2 text-left text-[13px] text-danger-text hover:bg-danger-soft"
            >
              Remove {kind}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
