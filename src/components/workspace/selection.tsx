"use client";

import { CheckIcon, MinusIcon } from "@phosphor-icons/react/ssr";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

/**
 * Selection mode for a workspace: pick several tasks, then change them together
 * (see BulkActionBar). Only tasks currently on screen can stay selected, so a
 * filter change never leaves hidden tasks quietly selected.
 */
type TaskSelection = {
  active: boolean;
  selected: ReadonlySet<string>;
  /** Every task in the current view, in display order. */
  visible: readonly string[];
  start: () => void;
  stop: () => void;
  /** Toggle one task; with `range`, select everything from the last clicked task to this one. */
  toggle: (id: string, range?: boolean) => void;
  setMany: (ids: readonly string[], on: boolean) => void;
  setVisible: (ids: readonly string[]) => void;
};

const SelectionContext = createContext<TaskSelection | null>(null);

export function useTaskSelection() {
  return useContext(SelectionContext);
}

export function TaskSelectionProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [visible, setVisibleIds] = useState<readonly string[]>([]);
  const anchor = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // The target can be the document or window, which have no closest().
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog], [role=menu], [data-radix-popper-content-wrapper]"))
        return;
      // Leave selection mode before anything else (like closing the task panel).
      e.preventDefault();
      setActive(false);
      setSelected(new Set());
      anchor.current = null;
    }
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [active]);

  const value = useMemo<TaskSelection>(
    () => ({
      active,
      selected,
      visible,
      start: () => setActive(true),
      stop: () => {
        setActive(false);
        setSelected(new Set());
        anchor.current = null;
      },
      toggle: (id, range) => {
        const from = anchor.current ? visible.indexOf(anchor.current) : -1;
        const to = visible.indexOf(id);
        if (range && from >= 0 && to >= 0) {
          const [a, b] = from < to ? [from, to] : [to, from];
          setSelected((prev) => new Set([...prev, ...visible.slice(a, b + 1)]));
        } else {
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
        anchor.current = id;
      },
      setMany: (ids, on) =>
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next;
        }),
      setVisible: (ids) => {
        setVisibleIds((prev) =>
          prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
        );
        const onScreen = new Set(ids);
        setSelected((prev) =>
          [...prev].every((id) => onScreen.has(id))
            ? prev
            : new Set([...prev].filter((id) => onScreen.has(id))),
        );
      },
    }),
    [active, selected, visible],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** Square checkbox visual for selection mode (the clickable element carries the role). */
export function SelectBox({ checked, mixed }: { checked: boolean; mixed?: boolean }) {
  return (
    <span
      aria-hidden
      className={
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors " +
        (checked || mixed
          ? "border-accent bg-accent text-accent-fg"
          : "border-border-strong bg-surface")
      }
    >
      {checked ? (
        <CheckIcon size={11} weight="bold" />
      ) : mixed ? (
        <MinusIcon size={11} weight="bold" />
      ) : null}
    </span>
  );
}
