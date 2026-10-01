import "server-only";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ActionError } from "@/lib/session";

import type { ActionResult } from "@/lib/action-result";

export type { ActionResult };

/**
 * Wraps a server action body: converts expected failures into `{ ok: false }`
 * results the UI can toast, and refreshes the current route on success so
 * server-rendered lists pick up the change.
 */
export async function run<T>(
  fn: () => Promise<T>,
  opts: { refresh?: boolean } = {},
): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    if (opts.refresh !== false) refresh();
    return { ok: true, data };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ActionError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError)
      return {
        ok: false,
        error: error.issues[0]?.message ?? "Some of that input isn't valid.",
      };
    console.error(error);
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

export const idSchema = z.string().min(1).max(64);
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like 2026-10-01.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, "That date doesn't exist.")
  // Keeps typos like 0202 or 20260 out of the database (and off the Gantt).
  .refine((v) => v >= "2000-01-01" && v <= "2099-12-31", "Dates need to be between 2000 and 2099.");
