import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { addressesIn } from "@/lib/inbound-email";
import { sendAlert } from "@/server/alerts";
import { MAX_EMAIL_BYTES, ingestEmail } from "@/server/inbound/ingest";

/**
 * Email in over a webhook, for mail services that post incoming messages to a URL
 * (Cloudflare Email Routing via a small Worker, Mailgun routes, SendGrid Inbound Parse).
 *
 * Authenticate with INBOUND_EMAIL_SECRET, either as `Authorization: Bearer <secret>` or as
 * the password in basic auth (`https://any:<secret>@host/api/inbound-email`), since some
 * services can only set a URL. The body is the raw message (any content type), or a form
 * with the raw message in `email` (SendGrid, "POST the raw, full MIME message") or
 * `body-mime` (Mailgun, a forward() URL ending in /mime).
 *
 * Replies 200 for every handled email, including ones that were refused (so the service
 * doesn't retry them), and 500 only when something went wrong and a retry could help.
 */

function secretMatches(given: string, secret: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function authorised(request: Request, secret: string) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer) return secretMatches(bearer[1].trim(), secret);
  const basic = /^Basic\s+(.+)$/i.exec(header);
  if (basic) {
    const decoded = Buffer.from(basic[1].trim(), "base64").toString("utf8");
    return secretMatches(decoded.slice(decoded.indexOf(":") + 1), secret);
  }
  return false;
}

/** Reads the body without ever holding more than `limit` bytes. */
async function readCapped(request: Request, limit: number): Promise<Buffer | null> {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export async function POST(request: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!authorised(request, secret))
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Room for form encoding around the largest message we take.
  const limit = MAX_EMAIL_BYTES + 1024 * 1024;
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit)
    return NextResponse.json({ error: "Too large" }, { status: 413 });

  const recipients = addressesIn(request.headers.get("x-envelope-to"));
  let raw: Buffer | null;
  const type = request.headers.get("content-type") ?? "";
  // Only multipart is a form: a raw message posted without a type (curl and some Workers
  // label it x-www-form-urlencoded) is still a raw message.
  if (/^multipart\/form-data/i.test(type)) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: "Unreadable form" }, { status: 400 });
    }
    const field = form.get("email") ?? form.get("body-mime");
    raw =
      typeof field === "string"
        ? Buffer.from(field, "utf8")
        : field instanceof File
          ? Buffer.from(await field.arrayBuffer())
          : null;
    if (!raw) return NextResponse.json({ error: "No email in the form" }, { status: 400 });
    // Envelope recipients: SendGrid sends JSON, Mailgun a plain address.
    const envelope = form.get("envelope");
    if (typeof envelope === "string") {
      try {
        const to = (JSON.parse(envelope) as { to?: unknown }).to;
        if (Array.isArray(to)) recipients.push(...to.flatMap((t) => addressesIn(String(t))));
      } catch {
        // Not JSON: the headers still carry the recipients.
      }
    }
    const recipient = form.get("recipient");
    if (typeof recipient === "string") recipients.push(...addressesIn(recipient));
  } else {
    raw = await readCapped(request, limit);
    if (!raw) return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  if (raw.length === 0) return NextResponse.json({ error: "Empty email" }, { status: 400 });
  if (raw.length > MAX_EMAIL_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });

  try {
    const outcome = await ingestEmail(raw, { recipients });
    return NextResponse.json(outcome);
  } catch (error) {
    console.error("[inbound-email] webhook failed", error);
    await sendAlert("inbound:webhook", `:warning: Email in couldn't process an email: ${String(error).slice(0, 300)}`);
    return NextResponse.json({ error: "Couldn't process that email" }, { status: 500 });
  }
}
