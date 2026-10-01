"use client";

import { XIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTaskNavigation } from "@/components/app-context";
import { Button } from "@/components/ui/button";

/**
 * Right-hand task panel. A docked column on wide screens, a slide-over
 * drawer on smaller ones. Escape closes it when focus isn't in a field.
 */
export function TaskPanelShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { hrefFor } = useTaskNavigation();
  const closeHref = hrefFor(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // The target can be the document or window, which have no closest().
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      if (document.querySelector("[role=dialog], [role=menu], [data-radix-popper-content-wrapper]"))
        return;
      router.push(closeHref, { scroll: false });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, closeHref]);

  return (
    <>
      <Link
        href={closeHref}
        scroll={false}
        aria-label="Close task"
        tabIndex={-1}
        className="fixed inset-0 z-30 bg-overlay animate-fade-in xl:hidden"
      />
      <aside
        aria-label="Task details"
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[620px] flex-col border-l border-border bg-surface shadow-panel animate-panel-in xl:static xl:z-auto xl:w-[560px] xl:max-w-none xl:shrink-0 xl:shadow-none 2xl:w-[620px]"
      >
        {children}
      </aside>
    </>
  );
}

export function TaskPanelSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Loading task
      </span>
      <div className="flex h-12 items-center gap-2 border-b border-border px-4 sm:px-6" aria-hidden>
        <span className="h-3 w-40 rounded bg-surface-2 motion-safe:animate-pulse" />
      </div>
      <div className="grid gap-4 px-4 pt-6 sm:px-6" aria-hidden>
        <span className="h-6 w-3/4 rounded bg-surface-2 motion-safe:animate-pulse" />
        <div className="grid grid-cols-[108px_1fr] gap-x-3 gap-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="contents">
              <span className="h-3.5 w-16 rounded bg-surface-2 motion-safe:animate-pulse" />
              <span className="h-3.5 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
            </div>
          ))}
        </div>
        <span className="mt-2 h-16 w-full rounded-md bg-surface-2 motion-safe:animate-pulse" />
      </div>
    </div>
  );
}

export function MissingTask() {
  const { hrefFor } = useTaskNavigation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-end border-b border-border px-2">
        <Button size="icon-sm" variant="ghost" asChild aria-label="Close task">
          <Link href={hrefFor(null)} scroll={false}>
            <XIcon size={16} />
          </Link>
        </Button>
      </div>
      <div className="grid gap-1 px-4 py-10 sm:px-6">
        <p className="text-[15px] font-semibold">This task isn&apos;t available</p>
        <p className="text-muted">
          It may have been deleted, or it&apos;s in a workspace you&apos;re not a member of.
        </p>
      </div>
    </div>
  );
}
