import type { Instrumentation } from "next";

/** Runs once when the server starts: background jobs (daily reminders). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Not during `next build`, which also loads this file.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { startScheduler } = await import("@/server/scheduler");
  startScheduler();
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("@/server/alerts");
  await reportServerError(error, request, context);
};
