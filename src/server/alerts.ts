import "server-only";
import { PRODUCT_NAME } from "@/lib/product";

/**
 * Operational alerts (server errors, failed jobs) posted to a Slack channel through an
 * incoming webhook: SLACK_ALERTS_WEBHOOK_URL. Without it, alerts only go to the log.
 */

const recent = new Map<string, number>();
const QUIET_MS = 10 * 60 * 1000;
const MAX_PER_HOUR = 20;
let sentThisHour: number[] = [];

export async function sendAlert(key: string, text: string) {
  const url = process.env.SLACK_ALERTS_WEBHOOK_URL;
  if (!url) return;

  // Don't flood the channel: one message per distinct problem every 10 minutes,
  // and at most 20 an hour overall.
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < QUIET_MS) return;
  sentThisHour = sentThisHour.filter((t) => now - t < 60 * 60 * 1000);
  if (sentThisHour.length >= MAX_PER_HOUR) return;
  recent.set(key, now);
  sentThisHour.push(now);
  if (recent.size > 500) recent.clear();

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error("[alerts] could not post to Slack", error);
  }
}

export async function reportServerError(
  error: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string },
) {
  const message = error instanceof Error ? error.message : String(error);
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  // Redirects and not-found responses travel as errors internally; they aren't failures.
  if (digest?.startsWith("NEXT_")) return;

  const where = `${request.method} ${request.path.split("?")[0]}`;
  await sendAlert(
    `${context.routePath}:${message}`,
    [
      `:rotating_light: *${PRODUCT_NAME} server error* (${context.routeType}) on \`${where}\``,
      "```" + message.slice(0, 500) + "```",
      digest ? `Digest \`${digest}\`: search the server log for it (\`docker compose logs app\`).` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}
