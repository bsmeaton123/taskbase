import "server-only";
import { sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { db } from "@/db";
import { sendAlert } from "@/server/alerts";
import { MAX_EMAIL_BYTES, inboundAddress, ingestEmail, refuseUnreadable } from "./ingest";

/**
 * Email in by reading a mailbox over IMAP, for mail hosts without a webhook (Google
 * Workspace, Hostinger and most others).
 *
 *   INBOUND_EMAIL_ADDRESS=tasks@yourcompany.com
 *   INBOUND_IMAP_URL=imaps://tasks%40yourcompany.com:app-password@imap.gmail.com:993
 *
 * Every message in the inbox (INBOUND_IMAP_MAILBOX, default INBOX) becomes a task or is
 * refused, then moves to INBOUND_IMAP_DONE_MAILBOX (default "Processed"), so the inbox is a
 * queue and someone opening the mailbox can't make messages look already handled. A message
 * that fails for a passing reason (the database restarting, say) stays and is tried again; one
 * that fails MAX_FAILURES times moves to INBOUND_IMAP_FAILED_MAILBOX (default "Failed") so it
 * can't hold up the rest.
 */
const LOCK_KEY = 7_431_221; // arbitrary, stable; the 15-minute jobs use 7_431_220
const PER_POLL = 25;
const MAX_FAILURES = 3;

/** Failed attempts per message, for this server process. */
const failures = new Map<string, number>();
/** Messages that failed for good and couldn't even be moved aside: left alone from now on. */
const skipped = new Set<string>();

export function imapConfig() {
  const value = process.env.INBOUND_IMAP_URL;
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "imaps:" && url.protocol !== "imap:") return null;
  const secure = url.protocol === "imaps:";
  return {
    host: url.hostname,
    port: Number(url.port) || (secure ? 993 : 143),
    secure,
    auth: { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) },
    mailbox: process.env.INBOUND_IMAP_MAILBOX || "INBOX",
    done: process.env.INBOUND_IMAP_DONE_MAILBOX || "Processed",
    failed: process.env.INBOUND_IMAP_FAILED_MAILBOX || "Failed",
  };
}

/**
 * The real path of a folder, created if missing. Many servers (Dovecot, cPanel, Hostinger)
 * only allow folders under the inbox, as "INBOX.Processed"; Gmail allows "Processed" itself.
 */
async function folder(client: ImapFlow, name: string): Promise<string> {
  const boxes = await client.list();
  const prefix = client.namespace?.prefix ?? "";
  const candidates = [...new Set([name, ...(prefix && !name.startsWith(prefix) ? [prefix + name] : [])])];
  const existing = boxes.find((b) => candidates.includes(b.path));
  if (existing) return existing.path;
  for (const path of candidates) {
    try {
      return (await client.mailboxCreate(path)).path;
    } catch {
      // Not allowed there: try the next form.
    }
  }
  throw new Error(
    `Couldn't find or create the "${name}" folder in the email-in mailbox. Create it, or point INBOUND_IMAP_${name === "Failed" ? "FAILED" : "DONE"}_MAILBOX at an existing folder (for example INBOX.${name}).`,
  );
}

/** Reads the inbox once. Returns how many messages were dealt with. */
export async function pollMailbox(): Promise<number> {
  const config = imapConfig();
  if (!config || !inboundAddress()) return 0;

  // One poller at a time, even with several app instances.
  return db.transaction(async (tx) => {
    const [{ locked }] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(${LOCK_KEY}) as locked`,
    );
    if (!locked) return 0;

    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
      logger: false,
    });
    await client.connect();
    let handled = 0;
    try {
      // Before touching any message: with nowhere to put handled mail, every poll would
      // re-read the same emails.
      const done = await folder(client, config.done);
      const lock = await client.getMailboxLock(config.mailbox);
      try {
        const uids = (await client.search({ all: true }, { uid: true })) || [];
        for (const uid of uids.slice(0, PER_POLL)) {
          const range = String(uid);
          const key = `${config.mailbox}:${uid}`;
          if (skipped.has(key)) continue;
          let envelope: { messageId: string; sender: string; subject: string; recipients: string[] } | null =
            null;
          try {
            const head = await client.fetchOne(range, { size: true, envelope: true }, { uid: true });
            if (!head) continue;
            const e = head.envelope;
            envelope = {
              messageId: e?.messageId || `imap:${config.host}:${config.mailbox}:${uid}`,
              sender: e?.from?.[0]?.address ?? "",
              subject: e?.subject ?? "",
              recipients: [...(e?.to ?? []), ...(e?.cc ?? [])].map((a) => a.address ?? ""),
            };
            if ((head.size ?? 0) > MAX_EMAIL_BYTES) {
              const mb = Math.round(MAX_EMAIL_BYTES / 1024 / 1024);
              await refuseUnreadable(envelope, `The email was over ${mb} MB. Attach large files to the task instead.`);
            } else {
              const message = await client.fetchOne(range, { source: true }, { uid: true });
              if (!message || !message.source) continue;
              await ingestEmail(message.source);
            }
            await client.messageMove(range, done, { uid: true });
            failures.delete(key);
            handled++;
          } catch (error) {
            const count = (failures.get(key) ?? 0) + 1;
            failures.set(key, count);
            if (failures.size > 1000) failures.clear();
            console.error(`[inbound-email] couldn't process message ${uid} (attempt ${count})`, error);
            if (count < MAX_FAILURES) {
              // Leave it for the next poll; say so once rather than every minute.
              await sendAlert(
                "inbound:message",
                `:warning: Email in couldn't process a message (it stays in the inbox and will be tried again): ${String(error).slice(0, 300)}`,
              );
              continue;
            }
            // Out of chances: set it aside so it can't hold up the queue.
            try {
              if (envelope)
                await refuseUnreadable(
                  envelope,
                  "It couldn't be read. Try forwarding it again, or add the task by hand.",
                ).catch(() => null);
              await client.messageMove(range, await folder(client, config.failed), { uid: true });
              failures.delete(key);
              await sendAlert(
                "inbound:failed",
                `:warning: Email in gave up on a message after ${MAX_FAILURES} tries and moved it to "${config.failed}": ${String(error).slice(0, 300)}`,
              );
            } catch (moveError) {
              console.error("[inbound-email] couldn't set the message aside", moveError);
              skipped.add(key);
            }
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => client.close());
    }
    return handled;
  });
}
