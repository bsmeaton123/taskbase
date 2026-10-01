import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { getCurrentUser, getToday } from "@/lib/session";
import {
  AI_MODEL,
  aiClient,
  assertAiAvailable,
  fallbackParams,
  ndjsonResponse,
  recordUsage,
} from "@/server/ai/client";
import { aiGetTask, aiListWorkspaces, aiSearchTasks } from "@/server/ai/context";
import { PROMPTS } from "@/server/ai/prompts";

const body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(8000),
      }),
    )
    .min(1)
    .max(20)
    .refine((m) => m[0].role === "user" && m[m.length - 1].role === "user", {
      message: "Conversation must start and end with a question.",
    }),
});

/**
 * "Ask your workspaces": Claude answers with read-only tools that only see
 * the asking person's workspaces. Streams status, text and done events.
 */
export async function POST(request: Request) {
  const viewer = await getCurrentUser();
  if (!viewer) return Response.json({ error: "Sign in again." }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Bad request." }, { status: 400 });

  return ndjsonResponse(async (send) => {
    const usageId = await assertAiAvailable(viewer, "ask");
    const today = await getToday();

    // Tool inputs are small, but stream them as they're generated (the runner
    // validates each against its Zod schema before calling run()).
    const tools = [
      {
        ...betaZodTool({
          name: "list_workspaces",
          description:
            "List the workspaces the person can see, with open task counts, lists and members.",
          inputSchema: z.object({}),
          run: async () => {
            send({ type: "status", text: "Looking at your workspaces" });
            return aiListWorkspaces(viewer);
          },
        }),
        eager_input_streaming: true,
      },
      {
        ...betaZodTool({
          name: "search_tasks",
          description:
            "Search tasks in the person's workspaces. All filters are optional and combine. Returns task number, title, workspace/list, status, assignees (a task can have several), due date and comment count.",
          inputSchema: z.object({
            query: z.string().optional().describe("Words to match in titles, descriptions, subtasks and comments"),
            workspace: z.string().optional().describe("Part of a workspace name"),
            assignee: z.string().optional().describe('A person\'s name or email (matches tasks they are one of the assignees of), "me" for the person asking, or "unassigned"'),
            status: z.enum(["open", "closed", "any"]).optional().describe("Defaults to open"),
            due_before: z.string().optional().describe("YYYY-MM-DD; only tasks due on or before this date"),
            limit: z.number().int().min(1).max(50).optional(),
          }),
          run: async (input) => {
            const bits = [input.query && `“${input.query}”`, input.assignee && `for ${input.assignee}`, input.workspace && `in ${input.workspace}`]
              .filter(Boolean)
              .join(" ");
            send({ type: "status", text: `Searching tasks${bits ? ` ${bits}` : ""}` });
            return aiSearchTasks(viewer, {
              query: input.query,
              workspace: input.workspace,
              assignee: input.assignee,
              status: input.status,
              dueBefore: input.due_before,
              limit: input.limit,
            });
          },
        }),
        eager_input_streaming: true,
      },
      {
        ...betaZodTool({
          name: "get_task",
          description:
            "Get one task's full details: description, subtasks, files and its whole comment and activity history.",
          inputSchema: z.object({ number: z.number().int().describe("Task number without the #") }),
          run: async ({ number }) => {
            send({ type: "status", text: `Reading #${number}` });
            return aiGetTask(viewer, number);
          },
        }),
        eager_input_streaming: true,
      },
    ];

    const history = parsed.data.messages;
    const last = history[history.length - 1];
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      {
        role: "user",
        content: `Today is ${today}. I'm ${viewer.name}.\n<question>${last.content}</question>`,
      },
    ];

    // Stop (or closing the tab) aborts the request, so the run and its cost end there too.
    const options = { signal: request.signal };
    let runner = aiClient().beta.messages.toolRunner(
      {
        model: AI_MODEL,
        max_tokens: 16000,
        system: PROMPTS.ask,
        output_config: { effort: "medium" },
        tools,
        messages,
        max_iterations: 8,
        stream: true,
        ...fallbackParams(),
      },
      options,
    );

    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
    let model = AI_MODEL;
    let refused = false;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          for await (const messageStream of runner) {
            for await (const event of messageStream) {
              if (event.type === "content_block_delta" && event.delta.type === "text_delta")
                send({ type: "text", text: event.delta.text });
            }
            const message = await messageStream.finalMessage();
            attempt = 0;
            model = message.model;
            usage.input_tokens += message.usage.input_tokens ?? 0;
            usage.output_tokens += message.usage.output_tokens ?? 0;
            usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;
            // Never run tools from a truncated or refused turn.
            if (message.stop_reason === "refusal") {
              refused = true;
              break;
            }
            if (message.stop_reason === "max_tokens" && message.content.some((b) => b.type === "tool_use"))
              throw new Error("tool input truncated");
          }
          break;
        } catch (error) {
          // Unparseable tool JSON: re-issue the turn (bounded). API errors and a stopped
          // request bubble up instead of retrying.
          if (error instanceof Anthropic.APIError || request.signal.aborted || attempt >= 2) throw error;
          runner = aiClient().beta.messages.toolRunner({ ...runner.params }, options);
        }
      }
    } finally {
      await recordUsage(usageId, model, usage, !refused);
    }
    if (refused) send({ type: "error", text: "Claude couldn't help with this question." });
  });
}
