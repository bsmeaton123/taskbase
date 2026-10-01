"use client";

import { CheckIcon, MagnifyingGlassIcon, PlusIcon } from "@phosphor-icons/react/ssr";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { workspaceSwatch } from "@/lib/colors";
import { cn } from "@/lib/utils";

export type Tag = { id: string; name: string; color: string };

/** A small neutral pill with a coloured dot, so tags never compete with the accent. */
export function TagChip({
  tag,
  className,
  children,
}: {
  tag: Pick<Tag, "name" | "color">;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-full border border-border bg-surface px-1.5 text-[11.5px] font-medium text-muted",
        className,
      )}
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: workspaceSwatch(tag.color) }}
      />
      <span className="truncate">{tag.name}</span>
      {children}
    </span>
  );
}

/** Tags on a row or card: the first few, then "+N". */
export function TagList({ tags, max = 3, className }: { tags: Tag[]; max?: number; className?: string }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} className="max-w-32" />
      ))}
      {rest > 0 && (
        <span
          className="tabular text-[11.5px] text-subtle"
          title={tags.slice(max).map((t) => t.name).join(", ")}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}

/**
 * Choose tags: search, tick existing ones, or create a new one by typing its name.
 * `selected` are the tag ids that are on (for many tasks, those on all of them).
 */
export function TagPicker({
  tags,
  selected,
  onToggle,
  onCreate,
  children,
  align = "start",
}: {
  tags: Tag[];
  selected: Set<string>;
  onToggle: (tag: Tag, on: boolean) => void;
  onCreate?: (name: string) => void;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listId = useId();

  const q = query.trim();
  const matches = useMemo(
    () => tags.filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase())),
    [tags, q],
  );
  const exact = tags.some((t) => t.name.toLowerCase() === q.toLowerCase());
  const canCreate = Boolean(onCreate && q && !exact && q.length <= 40);
  const options = matches.length + (canCreate ? 1 : 0);
  // The list can shrink under the cursor (a created tag replaces the "Create" option).
  const active = Math.min(cursor, Math.max(options - 1, 0));
  const optionId = (i: number) => `${listId}-${i}`;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(i: number) {
    if (i < matches.length) {
      const t = matches[i];
      onToggle(t, !selected.has(t.id));
    } else if (canCreate) {
      onCreate!(q);
      setQuery("");
    }
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
            maxLength={40}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor(Math.min(active + 1, Math.max(options - 1, 0)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor(Math.max(active - 1, 0));
              } else if (e.key === "Enter" && options > 0) {
                e.preventDefault();
                choose(active);
              }
            }}
            placeholder={onCreate ? "Find or create a tag" : "Find a tag"}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options > 0 ? optionId(active) : undefined}
            aria-label="Search tags"
            className="h-9 w-full bg-transparent text-[13px] outline-none"
          />
        </div>
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Tags"
          aria-multiselectable
          className={cn("scrollbar-thin max-h-64 overflow-y-auto", options > 0 && "p-1")}
        >
          {matches.map((t, i) => {
            const on = selected.has(t.id);
            return (
              <button
                key={t.id}
                id={optionId(i)}
                type="button"
                role="option"
                aria-selected={on}
                data-active={i === active}
                tabIndex={-1}
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  setCursor(i);
                  choose(i);
                }}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px]",
                  i === active && "bg-surface-2",
                )}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: workspaceSwatch(t.color) }}
                />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                {on && <CheckIcon size={14} weight="bold" className="shrink-0 text-accent" />}
              </button>
            );
          })}
          {canCreate && (
            <button
              id={optionId(matches.length)}
              type="button"
              role="option"
              aria-selected={false}
              data-active={active === matches.length}
              tabIndex={-1}
              onMouseEnter={() => setCursor(matches.length)}
              onClick={() => choose(matches.length)}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] text-accent-text",
                active === matches.length && "bg-surface-2",
              )}
            >
              <PlusIcon size={13} className="shrink-0" />
              <span className="truncate">Create “{q}”</span>
            </button>
          )}
        </div>
        {options === 0 && (
          <p className="px-3 py-3 text-center text-[12.5px] text-muted">
            {tags.length === 0 ? "No tags yet. Type a name to create one." : "No matching tags."}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
