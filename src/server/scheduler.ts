import "server-only";
import { PRODUCT_NAME } from "@/lib/product";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { sendAlert } from "@/server/alerts";
import { imapConfig, pollMailbox } from "@/server/inbound/imap";
import { purgeOldInboundEmails } from "@/server/inbound/ingest";
import { sendDailyReminders } from "@/server/reminders";
import { purgeOldTrash } from "@/server/trash";

/**
 * Background jobs for a single long-running server. Each tick takes a Postgres advisory
 * lock first, so if more than one app instance ever runs, only one of them does the work.
 * Started once from instrumentation.ts; harmless if called twice.
 */
const TICK_MS = 15 * 60 * 1000;
const LOCK_KEY = 7_431_220; // arbitrary, stable

/** Email in (IMAP) checks the mailbox far more often: a minute by default. */
const POLL_MS = Math.max(30, Number(process.env.INBOUND_POLL_SECONDS) || 60) * 1000;

declare global {
  var __taskbaseScheduler: ReturnType<typeof setInterval> | undefined;
  var __taskbaseInbound: ReturnType<typeof setInterval> | undefined;
}

export function startScheduler() {
  if (process.env.SCHEDULER !== undefined && process.env.SCHEDULER !== "true") return;
  if (globalThis.__taskbaseScheduler) return;
  const run = () => tick().catch((error) => console.error("[scheduler] tick failed", error));
  // First run shortly after boot, then every 15 minutes.
  setTimeout(run, 30_000).unref?.();
  globalThis.__taskbaseScheduler = setInterval(run, TICK_MS);
  globalThis.__taskbaseScheduler.unref?.();
  startInboundPolling();
}

function startInboundPolling() {
  if (globalThis.__taskbaseInbound || !imapConfig()) return;
  let running = false;
  const poll = async () => {
    if (running) return; // a slow mailbox shouldn't stack up polls
    running = true;
    try {
      const handled = await pollMailbox();
      if (handled > 0) console.log(`[inbound-email] handled ${handled} email${handled === 1 ? "" : "s"}`);
    } catch (error) {
      console.error("[inbound-email] couldn't read the mailbox", error);
      await sendAlert(
        "inbound:imap",
        `:warning: ${PRODUCT_NAME} couldn't read the email-in mailbox: ${String(error).slice(0, 300)}`,
      );
    } finally {
      running = false;
    }
  };
  setTimeout(poll, 20_000).unref?.();
  globalThis.__taskbaseInbound = setInterval(poll, POLL_MS);
  globalThis.__taskbaseInbound.unref?.();
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
  try {
    await purgeOldInboundEmails();
  } catch (error) {
    console.error("[scheduler] email-in log purge failed", error);
  }
}
