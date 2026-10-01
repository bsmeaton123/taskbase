import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, count, eq, gt } from "drizzle-orm";
import type { z } from "zod";
import { db } from "@/db";
import { aiUsage } from "@/db/schema";
import { AI_NOT_CONNECTED } from "@/lib/ai-messages";
import { ActionError, type CurrentUser } from "@/lib/session";

/**
 * Claude access for taskbase's AI features.
 *
 * Configure with ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN). AI_MODEL
 * overrides the model; AI_HOURLY_LIMIT caps requests per person per hour.
 * Every call goes through here so quota, usage logging, refusal handling and
 * error messages stay consistent.
 */
export const AI_MODEL = process.env.AI_MODEL || "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** True when Claude is connected (a key is set) and AI isn't switched off. */
export function aiEnabled() {
  if (process.env.AI_ENABLED === "false") return false;
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Whether AI buttons show at all. They show even before a key is connected (using one then
 * says how to connect it); AI_ENABLED=false hides them entirely.
 */
export function aiVisible() {
  return process.env.AI_ENABLED !== "false";
}

let client: Anthropic | null = null;
function anthropic() {
  client ??= new Anthropic({ maxRetries: 2, timeout: 5 * 60 * 1000 });
  return client;
}

/**
 * Server-side refusal fallbacks: if Claude's safety classifiers decline a
 * (usually benign) request, the API retries it on the recommended model in
 * the same call. Claude API only; set AI_DISABLE_FALLBACKS=true on other
 * platforms or proxies that reject the parameter.
 */
function fallbackParams(): { betas?: string[]; fallbacks?: "default" } {
  if (process.env.AI_DISABLE_FALLBACKS === "true") return {};
  return { betas: [FALLBACK_BETA], fallbacks: "default" };
}

export type Effort = "low" | "medium" | "high";

export type AiFeature =
  | "thread_summary"
  | "digest"
  | "notes_to_tasks"
  | "quick_add"
  | "status_report"
  | "suggest_subtasks"
  | "plan_workspace"
  | "ask"
  | "risk_briefing"
  | "smart_defaults"
  | "attachment_insights";

/* -------------------------------------------------------------------------- */
/* Quota + usage                                                               */
/* -------------------------------------------------------------------------- */

function hourlyLimit() {
  const n = Number(process.env.AI_HOURLY_LIMIT);
  return Number.isFinite(n) && n > 0 ? n : 60;
}

/**
 * Checks the hourly quota and reserves a usage row for this request, so it counts from the
 * moment it starts (not after it finishes, which would let a burst of parallel requests
 * through). recordUsage() fills the row in afterwards. Returns the row id.
 */
export async function assertAiAvailable(viewer: CurrentUser, feature: AiFeature): Promise<string> {
  if (!aiEnabled()) throw new ActionError(AI_NOT_CONNECTED);
  const [{ used }] = await db
    .select({ used: count() })
    .from(aiUsage)
    .where(
      and(eq(aiUsage.userId, viewer.id), gt(aiUsage.createdAt, new Date(Date.now() - 3600_000))),
    );
  if (used >= hourlyLimit())
    throw new ActionError("You've reached the hourly limit for AI requests. Try again in a little while.");
  const [row] = await db
    .insert(aiUsage)
    .values({ userId: viewer.id, feature, model: AI_MODEL, ok: false })
    .returning({ id: aiUsage.id });
  return row.id;
}

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
} | null;

/** Fills in the usage row reserved by assertAiAvailable(). */
async function recordUsage(usageId: string, model: string, usage: Usage, ok: boolean) {
  try {
    await db
      .update(aiUsage)
      .set({
        model,
        inputTokens: usage?.input_tokens ?? 0,
        outputTokens: usage?.output_tokens ?? 0,
        cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
        ok,
      })
      .where(eq(aiUsage.id, usageId));
  } catch (error) {
    console.error("[ai] failed to record usage", error);
  }
}

/** Turns SDK errors into messages people can act on. */
export function describeAiError(error: unknown): string {
  if (error instanceof ActionError) return error.message;
  // Someone pressed Stop or left the page: nothing went wrong, and nobody is listening.
  if (error instanceof Anthropic.APIUserAbortError) return "Stopped.";
  if (error instanceof Anthropic.AuthenticationError)
    return "The AI service rejected this server's API key. Ask an admin to check ANTHROPIC_API_KEY.";
  if (error instanceof Anthropic.RateLimitError)
    return "The AI service is busy right now. Try again in a minute.";
  if (error instanceof Anthropic.BadRequestError) {
    console.error("[ai] bad request", error.message);
    return "The AI service couldn't process that request.";
  }
  if (error instanceof Anthropic.APIConnectionError)
    return "Couldn't reach the AI service. Check the server's internet connection.";
  if (error instanceof Anthropic.APIError) {
    console.error("[ai] api error", error.status, error.message);
    return "The AI service had a problem. Try again shortly.";
  }
  console.error("[ai] unexpected error", error);
  return "Something went wrong with the AI request.";
}

const REFUSED = "Claude couldn't help with this request.";

/* -------------------------------------------------------------------------- */
/* Structured output                                                           */
/* -------------------------------------------------------------------------- */

/**
 * One request, validated JSON back (structured outputs). Use for anything
 * the UI shows for review before it changes data.
 */
export async function aiStructured<S extends z.ZodType>(opts: {
  viewer: CurrentUser;
  feature: AiFeature;
  system: string;
  content: string | Anthropic.Beta.BetaContentBlockParam[];
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  const usageId = await assertAiAvailable(opts.viewer, opts.feature);
  let model = AI_MODEL;
  let usage: Usage = null;
  let ok = false;
  try {
    const response = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
      ...fallbackParams(),
    });
    usage = response.usage;
    model = response.model;
    if (response.stop_reason === "refusal") throw new ActionError(REFUSED);
    if (response.stop_reason === "max_tokens")
      throw new ActionError("That was too much to process in one go. Try a shorter input.");
    if (!response.parsed_output) throw new ActionError("Claude's reply couldn't be read. Try again.");
    ok = true;
    return response.parsed_output as z.infer<S>;
  } catch (error) {
    throw new ActionError(describeAiError(error));
  } finally {
    await recordUsage(usageId, model, usage, ok);
  }
}

/* -------------------------------------------------------------------------- */
/* Streaming text                                                              */
/* -------------------------------------------------------------------------- */

/** Events sent to the browser as newline-delimited JSON. */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

export function ndjsonResponse(
  run: (send: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const encoder = new TextEncoder();
  // Set once the reader has gone (Stop, a closed tab): later events are dropped quietly.
  let closed = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await run(send);
        send({ type: "done" });
      } catch (error) {
        send({ type: "error", text: describeAiError(error) });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Streams a written answer (summaries, reports, briefings) as text events. */
export async function aiStreamText(opts: {
  viewer: CurrentUser;
  feature: AiFeature;
  system: string;
  content: string | Anthropic.Beta.BetaContentBlockParam[];
  effort?: Effort;
  maxTokens?: number;
  send: (event: StreamEvent) => void;
  signal?: AbortSignal;
}) {
  const usageId = await assertAiAvailable(opts.viewer, opts.feature);
  const stream = anthropic().beta.messages.stream(
    {
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
      output_config: { effort: opts.effort ?? "medium" },
      ...fallbackParams(),
    },
    { signal: opts.signal },
  );
  stream.on("text", (text) => opts.send({ type: "text", text }));
  let message: Anthropic.Beta.BetaMessage | null = null;
  try {
    message = await stream.finalMessage();
  } finally {
    await recordUsage(usageId, message?.model ?? AI_MODEL, message?.usage ?? null, Boolean(message) && message?.stop_reason !== "refusal");
  }
  if (message.stop_reason === "refusal") throw new ActionError(REFUSED);
}

export { anthropic as aiClient, fallbackParams, recordUsage };
