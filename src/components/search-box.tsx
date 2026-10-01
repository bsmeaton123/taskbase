"use client";

import { MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

/** Search as you type: after a short pause the URL, and so the results, follow the box. */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  // The last query this box put in the URL, to tell its own updates from outside ones.
  const [sent, setSent] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const [pending, startTransition] = useTransition();

  // The URL changed from elsewhere (Cmd+K's "Search everywhere" while already here).
  if (initial !== seen) {
    setSeen(initial);
    if (initial !== sent) {
      setSent(initial);
      setValue(initial);
    }
  }

  useEffect(() => {
    const q = value.trim();
    if (q === sent) return;
    const id = setTimeout(() => {
      setSent(q);
      startTransition(() => {
        router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });
      });
    }, 250);
    return () => clearTimeout(id);
  }, [value, sent, router]);

  return (
    <label className="flex h-10 max-w-2xl items-center gap-2.5 rounded-md border border-border bg-surface px-3 transition-colors hover:not-focus-within:border-border-strong focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
      <MagnifyingGlassIcon size={17} className="shrink-0 text-subtle" />
      <input
        autoFocus
        type="search"
        aria-label="Search tasks"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search tasks, subtasks and comments"
        className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none"
      />
      <span aria-live="polite" className="shrink-0 text-[12px] text-subtle">
        {pending ? "Searching…" : ""}
      </span>
    </label>
  );
}
