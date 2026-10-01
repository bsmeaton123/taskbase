"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/action-result";

export type Viewer = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
};

export type PersonLite = { id: string; name: string; email: string; image: string | null };

export type WorkspaceLite = { id: string; name: string; color: string };

type AppContextValue = {
  viewer: Viewer;
  today: string;
  people: PersonLite[];
  workspaces: WorkspaceLite[];
  /** Whether Claude-powered features are configured on this server. */
  ai: boolean;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  value,
  children,
}: {
  value: AppContextValue;
  children: React.ReactNode;
}) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

/** Unwraps an action result, toasting the error when it failed. */
export async function perform<T>(
  promise: Promise<ActionResult<T>>,
  opts: { success?: string } = {},
): Promise<{ ok: true; data: T } | { ok: false }> {
  try {
    const res = await promise;
    if (!res.ok) {
      toast.error(res.error);
      return { ok: false };
    }
    if (opts.success) toast.success(opts.success);
    return res;
  } catch {
    toast.error("Couldn't reach the server. Check your connection and try again.");
    return { ok: false };
  }
}

/** Opens (or closes, with null) the task panel on the current page. */
export function useTaskNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = useCallback(
    (taskId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (taskId) params.set("task", taskId);
      else params.delete("task");
      const qs = params.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [pathname, searchParams],
  );

  const openTask = useCallback(
    (taskId: string | null) => router.push(hrefFor(taskId), { scroll: false }),
    [router, hrefFor],
  );

  return { openTask, hrefFor, activeTaskId: searchParams.get("task") };
}
