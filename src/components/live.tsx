"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { setTimeZone } from "@/server/actions/account";

/** Reports the browser time zone so "today" and "overdue" match the viewer. */
export function TimeZoneSync({ current }: { current: string }) {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && tz !== current) {
      // Offline or failed: try again on the next page load rather than surfacing an error.
      setTimeZone(tz)
        .then(() => router.refresh())
        .catch(() => {});
    }
  }, [current, router]);
  return null;
}

/**
 * Keeps shared data fresh without websockets: refreshes server components
 * every 20s while the tab is visible and the person isn't typing, and
 * immediately when the tab regains focus.
 */
export function LiveRefresh({ intervalMs = 20000 }: { intervalMs?: number }) {
  const router = useRouter();
  const last = useRef(0);

  useEffect(() => {
    last.current = Date.now();
    const isTyping = () => {
      const el = document.activeElement;
      return (
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLInputElement && el.type !== "checkbox") ||
        (el instanceof HTMLElement && el.isContentEditable)
      );
    };
    const tick = () => {
      if (document.visibilityState !== "visible" || isTyping()) return;
      if (
        document.body.dataset.dragging ||
        document.querySelector("[data-radix-popper-content-wrapper], [role=dialog]")
      )
        return;
      last.current = Date.now();
      router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onFocus = () => {
      if (Date.now() - last.current > 5000) tick();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [router, intervalMs]);

  return null;
}
