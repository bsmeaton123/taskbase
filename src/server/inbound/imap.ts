import "server-only";
import { sql } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { db } from "@/db";
import { sendAlert } from "@/server/alerts";
import { MAX_EMAIL_BYTES, inboundAddress, ingestEmail, refuseOversized } from "./ingest";

/**
 * Email in by reading a mailbox over IMAP, for mail hosts without a webhook (Google
 * Workspace, Microsoft 365, Hostinger and most others).
 *
 *   INBOUND_EMAIL_ADDRESS=tasks@yourcompany.com
 *   INBOUND_IMAP_URL=imaps://tasks%40yourcompany.com:app-password@imap.gmail.com:993
 *
 * Every message in the inbox (INBOUND_IMAP_MAILBOX, default INBOX) becomes a task or is
 * refused, then moves to INBOUND_IMAP_DONE_MAILBOX (default "Processed"), so the inbox is a
 * queue and someone opening the mailbox can't make messages look already handled. A message
 * that fails for a passing reason (the database restarting, say) stays and is tried again.
 */
const LOCK_KEY = 7_431_221; // arbitrary, stable; the 15-minute jobs use 7_431_220
const PER_POLL = 25;

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
  };
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
      try {
        await client.mailboxCreate(config.done);
      } catch {
        // Already there, or the server names folders differently; the move will tell.
      }
      const lock = await client.getMailboxLock(config.mailbox);
      try {
        const uids = (await client.search({ all: true }, { uid: true })) || [];
        for (const uid of uids.slice(0, PER_POLL)) {
          const range = String(uid);
          try {
            const head = await client.fetchOne(range, { size: true, envelope: true }, { uid: true });
            if (!head) continue;
            if ((head.size ?? 0) > MAX_EMAIL_BYTES) {
              const e = head.envelope;
              await refuseOversized({
                messageId: e?.messageId || `imap:${config.host}:${config.mailbox}:${uid}`,
                sender: e?.from?.[0]?.address ?? "",
                subject: e?.subject ?? "",
                recipients: [...(e?.to ?? []), ...(e?.cc ?? [])].map((a) => a.address ?? ""),
              });
            } else {
              const message = await client.fetchOne(range, { source: true }, { uid: true });
              if (!message || !message.source) continue;
              await ingestEmail(message.source);
            }
            await client.messageMove(range, config.done, { uid: true });
            handled++;
          } catch (error) {
            // Leave it in the inbox for the next poll; say so once rather than every minute.
            console.error(`[inbound-email] couldn't process message ${uid}`, error);
            await sendAlert(
              "inbound:message",
              `:warning: Email in couldn't process a message (it stays in the inbox and will be tried again): ${String(error).slice(0, 300)}`,
            );
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
