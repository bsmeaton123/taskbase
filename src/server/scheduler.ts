import "server-only";
import { PRODUCT_NAME } from "@/lib/product";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sendAlert } from "@/server/alerts";
import { sendDailyReminders } from "@/server/reminders";
import { purgeOldTrash } from "@/server/trash";

/**
 * Background jobs for a single long-running server. Each tick takes a Postgres advisory
 * lock first, so if more than one app instance ever runs, only one of them does the work.
 * Started once from instrumentation.ts; harmless if called twice.
 */
const TICK_MS = 15 * 60 * 1000;
const LOCK_KEY = 7_431_220; // arbitrary, stable

declare global {
  var __taskbaseScheduler: ReturnType<typeof setInterval> | undefined;
}

export function startScheduler() {
  if (process.env.SCHEDULER !== undefined && process.env.SCHEDULER !== "true") return;
  if (globalThis.__taskbaseScheduler) return;
  const run = () => tick().catch((error) => console.error("[scheduler] tick failed", error));
  // First run shortly after boot, then every 15 minutes.
  setTimeout(run, 30_000).unref?.();
  globalThis.__taskbaseScheduler = setInterval(run, TICK_MS);
  globalThis.__taskbaseScheduler.unref?.();
}

async function tick() {
  // A transaction-scoped lock: released automatically when the transaction ends, on
  // whichever pooled connection holds it. (A session lock taken and released with two
  // separate queries can land on two different connections and never be released.)
  await db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`,
    );
    if (!locked) return;
    await runJobs();
  });
}

async function runJobs() {
  try {
    const { sent } = await sendDailyReminders();
    if (sent > 0) console.log(`[scheduler] sent ${sent} daily reminder${sent === 1 ? "" : "s"}`);
  } catch (error) {
    console.error("[scheduler] reminders failed", error);
    await sendAlert(
      "scheduler:reminders",
      `:warning: ${PRODUCT_NAME} couldn't send the daily reminders: ${String(error).slice(0, 300)}`,
    );
  }
  try {
    const purged = await purgeOldTrash();
    if (purged > 0) console.log(`[scheduler] emptied ${purged} old trashed task${purged === 1 ? "" : "s"}`);
  } catch (error) {
    console.error("[scheduler] trash purge failed", error);
  }
}
