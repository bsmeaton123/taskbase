import { z } from "zod";
import { getCurrentUser } from "@/lib/session";
import { aiStreamText, ndjsonResponse } from "@/server/ai/client";
import {
  digestContext,
  insightsText,
  taskThreadContext,
  workspaceInsights,
  workspaceReportContext,
} from "@/server/ai/context";
import { PROMPTS } from "@/server/ai/prompts";

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("thread"), taskId: z.string().min(1).max(64) }),
  z.object({ kind: z.literal("digest") }),
  z.object({
    kind: z.literal("report"),
    workspaceId: z.string().min(1).max(64),
    days: z.number().int().min(1).max(90).default(7),
  }),
  z.object({ kind: z.literal("risks"), workspaceId: z.string().min(1).max(64) }),
]);

/** Streams written AI answers as newline-delimited JSON events. */
export async function POST(request: Request) {
  const viewer = await getCurrentUser();
  if (!viewer) return Response.json({ error: "Sign in again." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });
  const input = parsed.data;

  return ndjsonResponse(async (send) => {
    const common = { viewer, send, signal: request.signal };
    switch (input.kind) {
      case "thread": {
        const ctx = await taskThreadContext(viewer, input.taskId);
        if (!ctx) return send({ type: "error", text: "That task isn't available." });
        await aiStreamText({
          ...common,
          feature: "thread_summary",
          system: PROMPTS.threadSummary,
          content: ctx.text,
          effort: "low",
        });
        return;
      }
      case "digest": {
        const ctx = await digestContext(viewer);
        if (ctx.empty) {
          send({ type: "text", text: "You're all caught up: nothing is assigned to you, your inbox is empty and nothing you follow changed in the last day." });
          return;
        }
        await aiStreamText({
          ...common,
          feature: "digest",
          system: PROMPTS.digest,
          content: ctx.text,
          effort: "low",
        });
        return;
      }
      case "report": {
        const ctx = await workspaceReportContext(viewer, input.workspaceId, input.days);
        if (!ctx) return send({ type: "error", text: "You don't have access to that workspace." });
        await aiStreamText({
          ...common,
          feature: "status_report",
          system: PROMPTS.statusReport,
          content: ctx.text,
          effort: "medium",
        });
        return;
      }
      case "risks": {
        const result = await workspaceInsights(viewer, input.workspaceId);
        if (!result) return send({ type: "error", text: "You don't have access to that workspace." });
        if (result.insights.length === 0) {
          send({ type: "text", text: "Nothing needs attention right now: no overdue, stalled or unowned work, and nobody looks overloaded." });
          return;
        }
        await aiStreamText({
          ...common,
          feature: "risk_briefing",
          system: PROMPTS.riskBriefing,
          content: `Workspace: ${result.workspace.name}. Today is ${result.today}. Open tasks: ${result.openCount}.\n<signals>\n${insightsText(result.insights)}\n</signals>`,
          effort: "low",
        });
        return;
      }
    }
  });
}
