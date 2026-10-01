/**
 * Pure helpers for turning an email into a task (see src/server/inbound). Kept free of
 * server imports so they can be unit-tested.
 */

/** Longest description we keep (the task description limit), and the note we add when cut. */
export const DESCRIPTION_MAX = 20000;
export const MAX_ATTACHMENTS = 20;

export type InboundAddress = { local: string; domain: string };

/**
 * Text from an email, safe to store: control characters dropped (Postgres refuses NUL, and
 * malformed mail does carry them), line breaks and tabs kept.
 */
export function cleanText(value: string | undefined | null): string {
  return (value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

/** The mailbox in INBOUND_EMAIL_ADDRESS, split for plus-addressing. Null when unset or invalid. */
export function parseInboundAddress(value: string | undefined | null): InboundAddress | null {
  const m = /^\s*([^\s@+]+)@([^\s@]+\.[^\s@]+)\s*$/.exec(value ?? "");
  return m ? { local: m[1].toLowerCase(), domain: m[2].toLowerCase() } : null;
}

/** A workspace's email-in address: `local+key@domain`. */
export function workspaceAddress(base: InboundAddress, key: string) {
  return `${base.local}+${key}@${base.domain}`;
}

/** The workspace key from the first recipient addressed to `base` with a plus part. */
export function findWorkspaceKey(recipients: string[], base: InboundAddress): string | null {
  for (const r of recipients) {
    const m = /^([^\s@+]+)\+([a-z0-9]{8,64})@([^\s@]+)$/i.exec(r.trim());
    if (m && m[1].toLowerCase() === base.local && m[3].toLowerCase() === base.domain) {
      return m[2].toLowerCase();
    }
  }
  return null;
}

/** Every email address in a header value like `"Ann" <ann@x.com>, bob@y.com`. */
export function addressesIn(value: string | undefined | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/[^\s<>,;"']+@[^\s<>,;"']+/g)].map((m) => m[0].toLowerCase());
}

const PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|vs|tr|rv|antw)\s*(\[\d+\]|\(\d+\))?\s*:\s*)+/i;

/** A task title from the subject: forwarding and reply prefixes dropped, one line, capped. */
export function taskTitle(subject: string | undefined, body: string, senderName: string): string {
  const fromSubject = (subject ?? "").replace(/\s+/g, " ").replace(PREFIX, "").trim();
  if (fromSubject) return fromSubject.slice(0, 300);
  const firstLine = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !/^-+\s*forwarded message/i.test(l));
  if (firstLine) return firstLine.slice(0, 120);
  return `Email from ${senderName}`.slice(0, 300);
}

/** The description: the email's text, tidied, capped, with a note of anything left out. */
export function taskDescription(text: string | undefined, notAttached: string[] = []): string {
  let body = (text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const notes = notAttached.length ? `\n\nNot attached: ${notAttached.join("; ")}.` : "";
  const cut = "\n\n[Shortened: the full email was longer than a task description can hold.]";
  if (body.length + notes.length > DESCRIPTION_MAX) {
    body = body.slice(0, DESCRIPTION_MAX - notes.length - cut.length).trimEnd() + cut;
  }
  return body + notes;
}

type Headers = { get(name: string): unknown };

function headerText(headers: Headers, name: string): string {
  const v = headers.get(name);
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
  if (typeof v === "object" && "value" in v) return String((v as { value: unknown }).value);
  return String(v);
}

/** Out-of-office replies, bounces and list mail: never turned into tasks (and never answered). */
export function isAutomatic(headers: Headers): boolean {
  const auto = headerText(headers, "auto-submitted").trim().toLowerCase();
  if (auto && auto !== "no") return true;
  if (/^(bulk|junk|list|auto_reply)$/i.test(headerText(headers, "precedence").trim())) return true;
  if (headerText(headers, "x-autoreply") || headerText(headers, "x-autorespond")) return true;
  if (headerText(headers, "list-id")) return true;
  return false;
}

/**
 * True when the receiving server recorded a DMARC failure for the sender's domain, which
 * means the From address was probably forged. Absent headers prove nothing either way.
 */
export function dmarcFailed(headers: Headers): boolean {
  return /\bdmarc\s*=\s*fail\b/i.test(headerText(headers, "authentication-results"));
}

export type AttachmentLike = {
  filename?: string;
  contentType?: string;
  size?: number;
  related?: boolean;
  contentDisposition?: string;
};

/**
 * Which attachments to keep: real files, not the inline images in signatures and HTML
 * layouts, up to `maxBytes` each and MAX_ATTACHMENTS in all. Returns the indexes to keep
 * and short notes for the ones left out.
 */
export function pickAttachments(atts: AttachmentLike[], maxBytes: number) {
  const keep: number[] = [];
  const skipped: string[] = [];
  const mb = Math.round(maxBytes / 1024 / 1024);
  atts.forEach((a, i) => {
    const name = a.filename || "an unnamed file";
    if (a.related) return; // embedded in the HTML (logos, signature images)
    if (/^message\/(delivery-status|disposition-notification)/i.test(a.contentType ?? "")) return;
    if (!a.size) return;
    if (a.size > maxBytes) {
      skipped.push(`${name} (over ${mb} MB)`);
      return;
    }
    if (keep.length >= MAX_ATTACHMENTS) {
      skipped.push(`${name} (more than ${MAX_ATTACHMENTS} files)`);
      return;
    }
    keep.push(i);
  });
  return { keep, skipped };
}
