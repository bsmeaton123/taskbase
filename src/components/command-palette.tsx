"use client";

import {
  ArrowSquareInIcon,
  ChatCircleDotsIcon,
  CheckSquareIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  SquaresFourIcon,
  TrayIcon,
  UsersIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react/ssr";
import { Dialog as D } from "radix-ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-context";
import { StatusIcon, WorkspaceMark } from "@/components/task-bits";
import { cn } from "@/lib/utils";
import { quickFind, type FoundTask } from "@/server/actions/find";

type Item = {
  key: string;
  group: "Tasks" | "Workspaces" | "Go to";
  label: string;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  href: string;
};

/**
 * Cmd+K (Ctrl+K on Windows) from anywhere: jump to a task by title or number, a workspace,
 * or a page. Enter opens the highlighted result; anything else goes to full search.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-overlay animate-fade-in" />
        <D.Content
          className="fixed left-1/2 top-[8vh] z-50 flex max-h-[80dvh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-pop outline-none animate-pop-in sm:top-[14vh] sm:max-h-[70dvh]"
          aria-describedby={undefined}
        >
          <D.Title className="sr-only">Jump to</D.Title>
          {open && <Palette onDone={() => setOpen(false)} />}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

function Palette({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { workspaces, ai, viewer } = useApp();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [found, setFound] = useState<{ q: string; tasks: FoundTask[] } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim();

  // Search tasks as you type; only the latest answer is shown.
  useEffect(() => {
    if (!q) return;
    let live = true;
    const id = setTimeout(async () => {
      // On failure (offline, say) show no tasks rather than "Searching…" for ever;
      // the palette still offers pages, workspaces and full search.
      let tasks: FoundTask[] = [];
      try {
        const res = await quickFind(q);
        if (res.ok) tasks = res.data;
      } catch {
        // Falls through with no tasks.
      }
      if (live) setFound({ q, tasks });
    }, 150);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [q]);

  const items = useMemo(() => {
    const lower = q.toLowerCase();
    const matches = (s: string) => !lower || s.toLowerCase().includes(lower);
    const tasks: Item[] =
      q && found?.q === q
        ? found.tasks.map((t) => ({
            key: `t-${t.id}`,
            group: "Tasks" as const,
            label: t.title,
            hint: (
              <>
                <span className="font-mono text-[11.5px]">#{t.number}</span> · {t.workspace.name}
              </>
            ),
            icon: <StatusIcon status={t.status} size={15} />,
            href: `/w/${t.workspace.id}?task=${t.id}`,
          }))
        : [];
    const spaces: Item[] = workspaces
      .filter((w) => matches(w.name))
      .slice(0, q ? 5 : 8)
      .map((w) => ({
        key: `w-${w.id}`,
        group: "Workspaces",
        label: w.name,
        icon: <WorkspaceMark color={w.color} size={10} />,
        href: `/w/${w.id}`,
      }));
    const pages: Item[] = [
      { label: "My tasks", href: "/my-tasks", icon: <CheckSquareIcon size={16} /> },
      { label: "Inbox", href: "/inbox", icon: <TrayIcon size={16} /> },
      { label: "Team", href: "/team", icon: <UsersThreeIcon size={16} /> },
      ...(ai ? [{ label: "Ask", href: "/ask", icon: <ChatCircleDotsIcon size={16} /> }] : []),
      { label: "All workspaces", href: "/workspaces", icon: <SquaresFourIcon size={16} /> },
      { label: "Settings", href: "/settings", icon: <GearSixIcon size={16} /> },
      ...(viewer.isAdmin
        ? [
            { label: "People", href: "/people", icon: <UsersIcon size={16} /> },
            { label: "Import from Redbooth", href: "/import", icon: <ArrowSquareInIcon size={16} /> },
          ]
        : []),
    ]
      .filter((p) => matches(p.label))
      .map((p) => ({ ...p, key: `p-${p.href}`, group: "Go to" as const }));
    const searchAll: Item[] = q
      ? [
          {
            key: "search",
            group: "Go to",
            label: `Search everywhere for “${q}”`,
            icon: <MagnifyingGlassIcon size={16} />,
            href: `/search?q=${encodeURIComponent(q)}`,
          },
        ]
      : [];
    return [...tasks, ...spaces, ...pages, ...searchAll];
  }, [q, found, workspaces, ai, viewer.isAdmin]);

  const active = Math.min(cursor, Math.max(items.length - 1, 0));
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, items]);

  function go(item: Item | undefined) {
    if (!item) return;
    onDone();
    router.push(item.href);
  }

  const searching = Boolean(q) && found?.q !== q;
  let lastGroup: Item["group"] | null = null;

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <MagnifyingGlassIcon size={17} className="shrink-0 text-subtle" />
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
              setCursor(Math.min(active + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor(Math.max(active - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder="Jump to a task, workspace or page"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={items[active] ? `${listId}-${items[active].key}` : undefined}
          aria-label="Jump to"
          className="h-12 min-w-0 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-subtle"
        />
        <span aria-live="polite" className="shrink-0 text-[12px] text-subtle">
          {searching ? "Searching…" : ""}
        </span>
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Results"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {items.map((item, i) => {
          const heading = item.group !== lastGroup ? item.group : null;
          lastGroup = item.group;
          return (
            <div key={item.key}>
              {heading && (
                <p className="px-2.5 pb-1 pt-2.5 text-[11.5px] font-medium text-subtle" aria-hidden>
                  {heading}
                </p>
              )}
              <div
                id={`${listId}-${item.key}`}
                role="option"
                aria-selected={i === active}
                data-active={i === active}
                onMouseMove={() => i !== active && setCursor(i)}
                onClick={() => go(item)}
                className={cn(
                  "flex h-9 cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-[13.5px]",
                  i === active && "bg-surface-2",
                )}
              >
                <span className="inline-flex w-4 shrink-0 justify-center text-muted">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && (
                  <span className="max-w-[45%] shrink-0 truncate text-[12px] text-subtle">
                    {item.hint}
                  </span>
                )}
              </div>
            </div>
          );
        })}
        {q && !searching && items.length === 1 && (
          <p className="px-2.5 py-2 text-[12.5px] text-muted">No tasks or workspaces match.</p>
        )}
      </div>
      <p className="hidden border-t border-border px-4 py-2 text-[11.5px] text-subtle sm:block">
        Arrow keys to move, Enter to open, Esc to close
      </p>
    </>
  );
}
