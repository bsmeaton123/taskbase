import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, isNull, max, or, sql } from "drizzle-orm";
import { simpleParser, type AddressObject } from "mailparser";
import { db } from "@/db";
import {
  attachments,
  inboundEmails,
  taskLists,
  tasks,
  user,
  workspaceMembers,
  workspaces,
} from "@/db/schema";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import {
  addressesIn,
  dmarcFailed,
  findWorkspaceKey,
  isAutomatic,
  parseInboundAddress,
  pickAttachments,
  taskDescription,
  taskTitle,
  workspaceAddress,
} from "@/lib/inbound-email";
import { PRODUCT_NAME } from "@/lib/product";
import { maxUploadBytes, sanitizeFileName, storageDriver, storeFile } from "@/lib/storage";
import { insertAssignees } from "@/server/assignees";
import { addFollowers, logActivity } from "@/server/events";

/**
 * Email in: an email sent to a workspace's address (`tasks+<key>@domain`) becomes a task in
 * that workspace's first list, assigned to the sender. Transports (the IMAP poller and the
 * webhook) only hand over the raw message; every rule lives here.
 *
 * Who can email in: an active person who is a member of the workspace, sending from the
 * address on their account. The key in the address is the real secret (anyone can type a
 * From header); a DMARC failure recorded by the receiving server is rejected outright.
 * Rejections are only ever explained by email to people with an account, so strangers
 * (and spammers forging addresses) never get a reply.
 */

/** INBOUND_EMAIL_ADDRESS, the mailbox workspace addresses are built on. */
export function inboundAddress() {
  return parseInboundAddress(process.env.INBOUND_EMAIL_ADDRESS);
}

export function inboundAddressFor(key: string) {
  const base = inboundAddress();
  return base ? workspaceAddress(base, key) : null;
}

/** The largest raw email either transport accepts. */
export const MAX_EMAIL_BYTES = 40 * 1024 * 1024;

export type IngestOutcome =
  | { status: "created"; taskId: string; number: number }
  | { status: "duplicate" }
  | { status: "rejected" | "ignored"; reason: string };

/** Headers that can carry the address a message was delivered to. */
const DELIVERY_HEADERS = /^(delivered-to|x-original-to|x-forwarded-to|x-envelope-to|envelope-to)$/i;

function addressList(value: AddressObject | AddressObject[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.flatMap((a) => a.value.map((v) => v.address?.toLowerCase() ?? "")).filter(Boolean);
}

/** The address our own emails go out from, so we never ingest (and loop on) them. */
function ownAddresses(): string[] {
  const own = addressesIn(process.env.EMAIL_FROM);
  const base = inboundAddress();
  return base ? [...own, `${base.local}@${base.domain}`] : own;
}

type Workspace = { id: string; name: string; isTemplate: boolean; archivedAt: Date | null };
type Person = { id: string; name: string; email: string };

async function workspaceByKey(key: string | null): Promise<Workspace | undefined> {
  if (!key) return undefined;
  const [workspace] = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      isTemplate: workspaces.isTemplate,
      archivedAt: workspaces.archivedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.inboundKey, key));
  return workspace;
}

/** An active person whose account uses this address. */
async function personByEmail(email: string): Promise<Person | undefined> {
  if (!email) return undefined;
  const [person] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${email}`, or(isNull(user.banned), eq(user.banned, false))));
  return person;
}

type Refusal = {
  messageId: string;
  workspace?: Workspace;
  sender: string;
  person?: Person;
  subject: string;
};

/** Logs a refusal once per Message-ID and, only for people with an account, says why. */
async function refuse(
  ctx: Refusal,
  status: "rejected" | "ignored",
  reason: string,
  explain = false,
): Promise<IngestOutcome> {
  const [logged] = await db
    .insert(inboundEmails)
    .values({
      messageId: ctx.messageId,
      workspaceId: ctx.workspace?.id ?? null,
      senderEmail: ctx.sender.slice(0, 320),
      subject: ctx.subject,
      status,
      reason,
    })
    .onConflictDoNothing()
    .returning({ id: inboundEmails.id });
  if (!logged) return { status: "duplicate" };
  if (explain && ctx.person) {
    const { html, text } = renderEmail({
      heading: "Your email didn't become a task",
      body: reason,
      quote: ctx.subject || undefined,
      cta: { label: `Open ${PRODUCT_NAME}`, url: appUrl("/workspaces") },
      footer: "Each workspace's email address is in its settings.",
    });
    await sendEmail({
      to: ctx.person.email,
      subject: `Not added: ${ctx.subject || "your email"}`,
      text,
      html,
    });
  }
  return { status, reason };
}

/**
 * For a message too big to download (the IMAP poller sees its size first): logged against
 * its workspace and explained to the sender, so it doesn't vanish without a word.
 */
export async function refuseOversized(message: {
  messageId: string;
  sender: string;
  subject: string;
  recipients: string[];
}) {
  const base = inboundAddress();
  const key = base ? findWorkspaceKey(message.recipients, base) : null;
  const workspace = await workspaceByKey(key);
  const sender = message.sender.trim().toLowerCase();
  const person = await personByEmail(sender);
  const mb = Math.round(MAX_EMAIL_BYTES / 1024 / 1024);
  return refuse(
    {
      messageId: message.messageId.slice(0, 500),
      workspace,
      sender,
      person,
      subject: message.subject.slice(0, 300),
    },
    "rejected",
    `The email was over ${mb} MB. Attach large files to the task instead.`,
    Boolean(workspace),
  );
}

export async function ingestEmail(
  raw: Buffer,
  opts: { recipients?: string[] } = {},
): Promise<IngestOutcome> {
  const base = inboundAddress();
  if (!base) return { status: "ignored", reason: "Email in isn't set up (INBOUND_EMAIL_ADDRESS)." };

  const mail = await simpleParser(raw, {
    skipTextLinks: true,
    skipImageLinks: true,
    skipTextToHtml: true,
  });
  const messageId = (
    mail.messageId?.trim() || `sha256:${createHash("sha256").update(raw).digest("hex")}`
  ).slice(0, 500);
  const fromValue = (Array.isArray(mail.from) ? mail.from[0] : mail.from)?.value[0];
  const sender = fromValue?.address?.trim().toLowerCase() ?? "";
  const senderName = fromValue?.name?.trim() || sender || "someone";
  const subject = (mail.subject ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

  const recipients = [
    ...(opts.recipients ?? []),
    ...addressList(mail.to),
    ...addressList(mail.cc),
    ...mail.headerLines
      .filter((h) => DELIVERY_HEADERS.test(h.key))
      .flatMap((h) => addressesIn(h.line.slice(h.line.indexOf(":") + 1))),
  ];
  const key = findWorkspaceKey(recipients, base);
  const workspace = await workspaceByKey(key);
  const person = await personByEmail(sender);
  const ctx: Refusal = { messageId, workspace, sender, person, subject };

  // Automatic mail never becomes a task, and is never answered (that's how loops start).
  if (isAutomatic(mail.headers))
    return refuse(ctx, "ignored", "An automatic reply or list email.");
  if (ownAddresses().includes(sender))
    return refuse(ctx, "ignored", `An email sent by ${PRODUCT_NAME}.`);
  // Before anything that could send a reply: a forged From must never earn one.
  if (dmarcFailed(mail.headers))
    return refuse(ctx, "rejected", "The sender's address failed verification (DMARC), so it may be forged.");

  if (!key) return refuse(ctx, "rejected", "It wasn't sent to a workspace's own address.", true);
  if (!workspace)
    return refuse(
      ctx,
      "rejected",
      "That workspace address doesn't exist any more. It may have been replaced with a new one.",
      true,
    );
  if (!person)
    return refuse(ctx, "rejected", `${sender || "The sender"} doesn't have an account here.`);
  if (workspace.isTemplate) return refuse(ctx, "rejected", "Templates can't take emailed tasks.", true);
  if (workspace.archivedAt) return refuse(ctx, "rejected", `${workspace.name} is archived.`, true);

  const [membership] = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, person.id)));
  if (!membership)
    return refuse(ctx, "rejected", `${person.name} isn't a member of ${workspace.name}.`, true);

  const [list] = await db
    .select({ id: taskLists.id })
    .from(taskLists)
    .where(eq(taskLists.workspaceId, workspace.id))
    .orderBy(asc(taskLists.position), asc(taskLists.createdAt))
    .limit(1);
  if (!list) return refuse(ctx, "rejected", `${workspace.name} has no task lists to add it to.`, true);

  const { keep, skipped } = pickAttachments(mail.attachments, maxUploadBytes());
  const body = mail.text ?? "";
  const title = taskTitle(subject, body, senderName);
  const description = taskDescription(body, skipped);
  const driver = storageDriver();

  return db.transaction(async (tx) => {
    // Claim the Message-ID first: providers retry and pollers re-read, so the same email
    // can arrive twice, even at the same moment.
    const [logged] = await tx
      .insert(inboundEmails)
      .values({
        messageId,
        workspaceId: workspace.id,
        senderEmail: sender.slice(0, 320),
        subject,
        status: "created",
      })
      .onConflictDoNothing()
      .returning({ id: inboundEmails.id });
    if (!logged) return { status: "duplicate" } as const;

    const [{ hi }] = await tx
      .select({ hi: max(tasks.position) })
      .from(tasks)
      .where(eq(tasks.taskListId, list.id));
    const [task] = await tx
      .insert(tasks)
      .values({
        workspaceId: workspace.id,
        taskListId: list.id,
        title,
        description,
        position: (hi ?? 0) + 1024,
        createdById: person.id,
      })
      .returning({ id: tasks.id, number: tasks.number });

    await logActivity(tx, {
      workspaceId: workspace.id,
      taskId: task.id,
      actorId: person.id,
      kind: "task_created",
      data: { via: "email" },
    });
    // The sender owns it until they hand it on: an unassigned task is the one that slips.
    await insertAssignees(tx, [{ taskId: task.id, userIds: [person.id] }]);
    await addFollowers(tx, task.id, [person.id]);

    for (const i of keep) {
      const a = mail.attachments[i];
      const [row] = await tx
        .insert(attachments)
        .values({
          taskId: task.id,
          uploaderId: person.id,
          name: sanitizeFileName(a.filename || "attachment"),
          contentType: (a.contentType || "application/octet-stream").slice(0, 120),
          size: a.size,
          storage: driver,
        })
        .returning({ id: attachments.id });
      await storeFile(tx, row.id, driver, a.content);
    }

    await tx.update(inboundEmails).set({ taskId: task.id }).where(eq(inboundEmails.id, logged.id));
    return { status: "created", taskId: task.id, number: task.number } as const;
  });
}

/** The latest emails sent to a workspace's address, newest first, for its settings page. */
export async function recentInboundEmails(workspaceId: string, limit = 10) {
  return db
    .select({
      id: inboundEmails.id,
      senderEmail: inboundEmails.senderEmail,
      subject: inboundEmails.subject,
      status: inboundEmails.status,
      reason: inboundEmails.reason,
      createdAt: inboundEmails.createdAt,
      taskNumber: tasks.number,
    })
    .from(inboundEmails)
    .leftJoin(tasks, eq(tasks.id, inboundEmails.taskId))
    .where(eq(inboundEmails.workspaceId, workspaceId))
    .orderBy(sql`${inboundEmails.createdAt} desc`)
    .limit(limit);
}

/** Keeps the log short: entries older than 90 days go. */
export async function purgeOldInboundEmails() {
  const rows = await db
    .delete(inboundEmails)
    .where(sql`${inboundEmails.createdAt} < now() - interval '90 days'`)
    .returning({ id: inboundEmails.id });
  return rows.length;
}
