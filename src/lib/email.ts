import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { PRODUCT_NAME } from "@/lib/product";

/**
 * Outgoing email over SMTP (works with Google Workspace, Microsoft 365,
 * Postmark, SendGrid, SES, Resend and most other providers).
 *
 *   SMTP_URL=smtps://user:password@smtp.example.com:465
 *   EMAIL_FROM="taskbase <tasks@yourcompany.com>"
 *
 * Without SMTP_URL, emails are printed to the server console in development
 * and skipped in production.
 */
let transporter: Transporter | null = null;

export function emailEnabled() {
  return Boolean(process.env.SMTP_URL);
}

/** Whether features that depend on email (like password reset) should show. */
export function emailAvailable() {
  return emailEnabled() || process.env.NODE_ENV !== "production";
}

export function appUrl(path = "") {
  const base = (process.env.BETTER_AUTH_URL || "http://localhost:3100").replace(/\/$/, "");
  return `${base}${path}`;
}

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail(message: EmailMessage): Promise<boolean> {
  if (!emailEnabled()) {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `\n[email] (SMTP_URL not set, not sent)\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`,
      );
    }
    return false;
  }
  transporter ??= nodemailer.createTransport(process.env.SMTP_URL);
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `${PRODUCT_NAME} <no-reply@localhost>`,
      ...message,
    });
    return true;
  } catch (error) {
    console.error("[email] send failed", error);
    return false;
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Minimal, client-safe HTML layout: a heading, optional quote, one button.
 * Plain text is always sent alongside.
 */
export function renderEmail(opts: {
  heading: string;
  body?: string;
  quote?: string;
  cta: { label: string; url: string };
  footer?: string;
}) {
  const quote = opts.quote
    ? `<blockquote style="margin:16px 0;padding:10px 14px;border-left:3px solid #d4d9e3;color:#3d4452;white-space:pre-wrap">${escapeHtml(opts.quote)}</blockquote>`
    : "";
  const body = opts.body ? `<p style="margin:8px 0 0;color:#3d4452">${escapeHtml(opts.body)}</p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1f2430">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<div style="background:#ffffff;border:1px solid #e3e6ec;border-radius:10px;padding:24px">
<p style="margin:0 0 4px;font-size:13px;font-weight:600;color:#1f6fe8">${escapeHtml(PRODUCT_NAME)}</p>
<h1 style="margin:0;font-size:18px;line-height:1.35">${escapeHtml(opts.heading)}</h1>
${body}${quote}
<p style="margin:20px 0 0"><a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;background:#1a6fe1;color:#ffffff;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:6px">${escapeHtml(opts.cta.label)}</a></p>
</div>
<p style="margin:16px 4px 0;font-size:12px;color:#6b7280">${escapeHtml(opts.footer ?? `You can change which emails you get in your ${PRODUCT_NAME} profile.`)}</p>
</div></body></html>`;
  const text = [
    opts.heading,
    opts.body,
    opts.quote ? `\n> ${opts.quote.replace(/\n/g, "\n> ")}\n` : undefined,
    `${opts.cta.label}: ${opts.cta.url}`,
    "",
    opts.footer ?? `You can change which emails you get in your ${PRODUCT_NAME} profile.`,
  ]
    .filter((l) => l !== undefined)
    .join("\n");
  return { html, text };
}
