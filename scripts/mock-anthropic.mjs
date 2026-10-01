// Development-only stand-in for the Claude Messages API, so the AI features
// can be exercised end to end without an API key or spending tokens.
//
//   npm run ai:mock                             # listens on :3999
//   ANTHROPIC_BASE_URL=http://127.0.0.1:3999 ANTHROPIC_API_KEY=mock npm run dev
//
// It also rejects request shapes the real API rejects for claude-opus-5-5
// (sampling params, disabled thinking, forced tool_choice, bad fallback
// headers, assistant prefill), so integration mistakes surface locally.
// Responses are deterministic and derived from the request content.
// MOCK_DELTA_MS slows streamed text down (default 15ms a chunk), to test Stop and loading states.
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT || 3999);
const DELTA_MS = Number(process.env.MOCK_DELTA_MS || 15);

function bad(res, message) {
  console.error(`[mock] 400 ${message}`);
  res.writeHead(400, { "content-type": "application/json" });
  res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } }));
}

function validate(body, headers) {
  if (!headers["x-api-key"] && !headers.authorization) return "missing credentials";
  if (typeof body.model !== "string") return "model: required";
  if (typeof body.max_tokens !== "number") return "max_tokens: required";
  for (const k of ["temperature", "top_p", "top_k"])
    if (k in body) return `${k}: not supported on ${body.model}`;
  if (body.thinking && body.thinking.type !== "adaptive")
    return `thinking.type: ${body.thinking.type} is not supported on ${body.model}`;
  if (body.tool_choice && ["any", "tool"].includes(body.tool_choice.type))
    return 'tool_choice: type "tool" and "any" are not supported for this model.';
  const effort = body.output_config?.effort;
  if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) return "output_config.effort: invalid";
  const betas = String(headers["anthropic-beta"] || "");
  if ("fallbacks" in body) {
    if (body.fallbacks === "default" && !betas.includes("server-side-fallback-2026-07-01"))
      return "fallbacks: requires anthropic-beta: server-side-fallback-2026-07-01";
    if (Array.isArray(body.fallbacks) && !betas.includes("server-side-fallback-2026-06-01"))
      return "fallbacks: array form requires server-side-fallback-2026-06-01";
  }
  if (!Array.isArray(body.messages) || body.messages[0]?.role !== "user") return "messages: first message must be user";
  const last = body.messages.at(-1);
  if (last.role === "assistant") return "This model does not support assistant message prefill.";
  if ("output_format" in body) return "output_format: deprecated, use output_config.format";
  return null;
}

/* ------------------------------------------------------------------------ */
/* Helpers to read the prompt                                                */
/* ------------------------------------------------------------------------ */

const textOf = (content) =>
  typeof content === "string"
    ? content
    : content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? textOf(b.content ?? "") : "")).join("\n");

const between = (s, tag) => {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(s);
  return m ? m[1].trim() : "";
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
function todayFrom(s) {
  return /Today is (\d{4}-\d{2}-\d{2})/.exec(s)?.[1] ?? new Date().toISOString().slice(0, 10);
}
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function resolveDate(text, today) {
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b/.test(t)) return today;
  if (/\bnext week\b/.test(t)) return addDays(today, 7);
  const day = WEEKDAYS.findIndex((d) => t.includes(d));
  if (day >= 0) {
    const cur = new Date(`${today}T12:00:00Z`).getUTCDay();
    return addDays(today, ((day - cur + 7) % 7) || 7);
  }
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(t);
  return iso ? iso[1] : null;
}
function membersFrom(s) {
  const line = /Members: (.*)/.exec(s)?.[1] ?? "";
  return line.split(",").map((x) => x.trim()).filter(Boolean);
}
/** Every member the text mentions (full or first name), in member-list order. */
function findMembers(text, members) {
  const t = text.toLowerCase();
  return members.filter((m) => m && (t.includes(m.toLowerCase()) || t.includes(m.split(" ")[0].toLowerCase())));
}
const clean = (s) =>
  s
    .replace(/\b(by|before|on|due)\s+(tomorrow|today|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/[,.]?\s*\b(urgent|asap)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,.]$/, "");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ------------------------------------------------------------------------ */
/* Structured responses                                                      */
/* ------------------------------------------------------------------------ */

function structured(system, user) {
  const today = todayFrom(user);
  const members = membersFrom(user);

  if (system.includes("Extract the concrete action items")) {
    const notes = between(user, "notes");
    const lines = notes.split(/\n+/).map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim()).filter((l) => l.length > 8);
    const actionable = lines.filter((l) => /\b(will|to|need|needs|should|send|book|draft|update|review|fix|call|share|prepare|order|set up|write)\b/i.test(l));
    return {
      tasks: (actionable.length ? actionable : lines).slice(0, 8).map((l) => {
        const who = findMembers(l, members);
        return {
          title: cap(clean(l.replace(new RegExp(`^${who[0] ?? "$^"}\\s+(will|to)\\s+`, "i"), "")).slice(0, 80)),
          description: `From the notes: "${l}"`,
          assignees: who,
          dueDate: resolveDate(l, today),
          list: null,
          urgent: /urgent|asap/i.test(l),
          subtasks: /and/i.test(l) ? l.split(/\band\b/i).map((p) => cap(p.trim())).filter((p) => p.length > 3).slice(0, 3) : [],
        };
      }),
    };
  }

  if (system.includes("typed what's on their mind about a piece of work")) {
    const notes = between(user, "notes");
    const lines = notes.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? notes;
    const firstWs = /- ([^|]+)\|/.exec(user)?.[1].trim() ?? "";
    const wsLine = user.split("\n").find((l) => l.startsWith("- ") && notes.toLowerCase().includes(l.slice(2).split("|")[0].trim().toLowerCase().split(" ")[0])) ?? "";
    const workspace = wsLine ? wsLine.slice(2).split("|")[0].trim() : firstWs;
    const chosen = wsLine || user.split("\n").find((l) => l.startsWith("- ")) || "";
    const wsMembers = (/members: ([^|]*)/.exec(chosen)?.[1] ?? "").split(",").map((x) => x.trim());
    const wsTags = (/tags: (.*)$/.exec(chosen)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const named = findMembers(notes, wsMembers);
    const assignees = /\b(me|my|i|i'll)\b/i.test(first) ? ["me", ...named] : named;
    const who = named[0] ?? null;
    const weekly = /every (monday|tuesday|wednesday|thursday|friday|week)/i.exec(notes);
    const days = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const repeat = /every day|daily/i.test(notes)
      ? { freq: "daily", interval: 1, weekdays: null, monthDay: null }
      : weekly
        ? { freq: "weekly", interval: 1, weekdays: weekly[1].toLowerCase() === "week" ? null : [days[weekly[1].toLowerCase()]], monthDay: null }
        : /monthly|every month/i.test(notes)
          ? { freq: "monthly", interval: 1, weekdays: null, monthDay: null }
          : null;
    const title = cap(clean(first.replace(/^every \w+:?\s*/i, "").replace(new RegExp(`^(ask|remind|tell)\\s+${who ? who.split(" ")[0] : "$^"}\\s+(to\\s+|for\\s+)?`, "i"), "").replace(/^(ask|remind)\s+\w+\s+(to\s+|for\s+)?/i, "").split(/[.;]/)[0]));
    const rest = lines.slice(1);
    const subtasks = rest.filter((l) => /^[-*•]|^\d+[.)]/.test(l)).map((l) => cap(l.replace(/^[-*•\d.)\s]+/, "")));
    const description = rest.filter((l) => !/^[-*•]|^\d+[.)]/.test(l)).join("\n");
    return {
      workspace,
      list: null,
      title: title.slice(0, 80) || "New task",
      description,
      subtasks,
      assignees,
      startDate: /starting|from (next )?monday/i.test(notes) ? resolveDate("next monday", today) : null,
      dueDate: resolveDate(notes, today),
      repeat,
      tags: wsTags.filter((t) => notes.toLowerCase().includes(t.toLowerCase())).slice(0, 3),
      urgent: /urgent|asap|critical|blocking/i.test(notes),
    };
  }

  if (system.includes("Break a task into the concrete steps")) {
    const title = /Title: (.*)/.exec(user)?.[1] ?? "the task";
    const subject = title.replace(/^(write|create|set up|build|prepare|plan|order)\s+/i, "");
    return {
      subtasks: [
        { title: `Agree scope and owner for ${subject}`, assignee: null },
        { title: `Draft ${subject}`, assignee: null },
        { title: `Review ${subject} with the team`, assignee: null },
        { title: `Make final changes to ${subject}`, assignee: null },
        { title: `Share ${subject} and close out`, assignee: null },
      ],
    };
  }

  if (system.startsWith("Plan a project")) {
    const brief = between(user, "brief");
    const topic = brief.split(/[.\n]/)[0].slice(0, 50);
    return {
      name: cap(topic),
      description: `Plan for: ${brief.slice(0, 140)}`,
      lists: [
        { name: "Kick-off", tasks: [
          { title: "Agree goals and success measures", description: "Write down what done looks like.", dueInDays: 2, subtasks: ["List goals", "Agree measures"] },
          { title: "Confirm owners and timeline", description: "Name an owner for each workstream.", dueInDays: 3, subtasks: [] },
        ] },
        { name: "Delivery", tasks: [
          { title: `Build the first version of ${topic.toLowerCase()}`, description: "Get a usable first cut.", dueInDays: 14, subtasks: ["Draft", "Review", "Revise"] },
          { title: "Weekly check-in", description: "Review progress and blockers.", dueInDays: 7, subtasks: [] },
        ] },
        { name: "Wrap-up", tasks: [
          { title: "Launch and announce", description: "Tell the people who need to know.", dueInDays: 21, subtasks: [] },
          { title: "Retrospective", description: "What to keep and change next time.", dueInDays: 25, subtasks: [] },
        ] },
      ],
    };
  }

  if (system.includes("suggest defaults for the new task")) {
    const rows = between(user, "recent_tasks").split("\n").filter(Boolean);
    const count = (re) => {
      const tally = new Map();
      for (const r of rows) {
        const v = re.exec(r)?.[1]?.trim();
        if (v && v !== "none") tally.set(v, (tally.get(v) ?? 0) + 1);
      }
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    return {
      list: count(/list: ([^|]+)/),
      assignees: (count(/assignees: ([^|]+)/) ?? "").split(",").map((x) => x.trim()).filter(Boolean),
      dueInDays: 5,
      reason: "Most recent tasks like this go to that list and person, due within a week.",
    };
  }

  if (system.includes("Read the attached file")) {
    const name = /File: (.*)/.exec(user)?.[1] ?? "the file";
    return {
      summary: [`${name} is attached to this task.`, "It covers the main points the task depends on.", "Nothing in it contradicts the task description."],
      actionItems: [`Review ${name} with the owner`, "Confirm the numbers before sign-off"],
    };
  }

  return {};
}

/* ------------------------------------------------------------------------ */
/* Text responses                                                            */
/* ------------------------------------------------------------------------ */

function written(system, user) {
  const refs = [...new Set([...user.matchAll(/#(\d+)/g)].map((m) => `#${m[1]}`))].slice(0, 4);
  const ref = refs[0] ?? "the task";
  if (system.includes("Summarise one task")) {
    const status = /Status: ([^|]+)/.exec(user)?.[1]?.trim() ?? "Open";
    const owner = /Assignees: ([^|]+)/.exec(user)?.[1]?.trim() ?? "nobody";
    const comments = (user.match(/ commented: /g) ?? []).length;
    return `## Where it stands\n${ref} is **${status}**, owned by **${owner}**, with ${comments} comment${comments === 1 ? "" : "s"} so far.\n\n## Open questions\n- Waiting on confirmation of the details raised in the latest comment.\n\n## Next steps\n- **${owner}** to finish the remaining subtasks and post an update.`;
  }
  if (system.includes("personal catch-up")) {
    const overdue = /Overdue \((\d+)\)/.exec(user)?.[1] ?? "0";
    return `## Needs you today\n- You have **${overdue}** overdue task${overdue === "1" ? "" : "s"}${refs.length ? `, starting with ${refs.slice(0, 2).join(" and ")}` : ""}.\n- Reply to the mentions in your inbox.\n\n## Coming up\n- Keep an eye on what's due in the next two days.`;
  }
  if (system.includes("status report")) {
    const name = /Workspace: ([^(\n]+)/.exec(user)?.[1]?.trim() ?? "This workspace";
    const done = /<completed_in_period count="(\d+)">/.exec(user)?.[1] ?? "0";
    const overdue = /<overdue count="(\d+)">/.exec(user)?.[1] ?? "0";
    return `## Summary\n${name} is **${Number(overdue) > 0 ? "At risk" : "On track"}**: ${done} task${done === "1" ? "" : "s"} completed this period and ${overdue} overdue.\n\n## Done\n- ${done} tasks closed.\n\n## In progress\n- Work continues on ${refs.slice(0, 2).join(" and ") || "the open tasks"}.\n\n## Risks and blockers\n- ${overdue} overdue task${overdue === "1" ? "" : "s"} need an owner check-in.\n\n## Next 7 days\n- Focus on what's due this week.`;
  }
  if (system.includes("early-warning signals")) {
    return `## Act now\n- ${refs[0] ?? "The top item"} is overdue: chase the owner today or move the date.\n\n## Keep an eye on\n- ${refs.slice(1).join(", ") || "Other items"}: check in at the next stand-up.`;
  }
  return "Done.";
}

/* ------------------------------------------------------------------------ */
/* Ask (tool use)                                                            */
/* ------------------------------------------------------------------------ */

function askTurn(body) {
  const last = body.messages.at(-1);
  const lastIsToolResult = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
  if (!lastIsToolResult) {
    const q = between(textOf(last.content), "question") || textOf(last.content);
    const mine = /\b(my|me|i)\b/i.test(q);
    const keyword = q
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 4 && !["what", "which", "where", "about", "tasks", "there", "should", "blocking", "working"].includes(w))[0];
    const input = mine ? { assignee: "me", status: "open" } : keyword ? { query: keyword } : { status: "open" };
    return { toolUse: { id: `toolu_${Math.random().toString(36).slice(2, 10)}`, name: "search_tasks", input } };
  }
  const result = textOf(last.content);
  const lines = result.split("\n").filter((l) => l.startsWith("#")).slice(0, 3);
  return {
    text: lines.length
      ? `Here's what I found:\n${lines.map((l) => `- ${l.split(" [")[0]}`).join("\n")}`
      : "I couldn't find any matching tasks. Try searching for a different word.",
  };
}

/* ------------------------------------------------------------------------ */
/* HTTP                                                                      */
/* ------------------------------------------------------------------------ */

function sse(res, events) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let i = 0;
  const tick = () => {
    if (i >= events.length) return res.end();
    const [type, data] = events[i++];
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    setTimeout(tick, type === "content_block_delta" ? DELTA_MS : 0);
  };
  tick();
}

function buildMessage(model, content, stopReason) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 420, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function streamEvents(message) {
  const events = [["message_start", { type: "message_start", message: { ...message, content: [], stop_reason: null } }]];
  message.content.forEach((block, index) => {
    if (block.type === "text") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
      for (const chunk of block.text.match(/[\s\S]{1,24}/g) ?? [])
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: chunk } }]);
    } else if (block.type === "tool_use") {
      events.push(["content_block_start", { type: "content_block_start", index, content_block: { ...block, input: {} } }]);
      const json = JSON.stringify(block.input);
      for (const chunk of json.match(/[\s\S]{1,10}/g) ?? [])
        events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: chunk } }]);
    }
    events.push(["content_block_stop", { type: "content_block_stop", index }]);
  });
  events.push(["message_delta", { type: "message_delta", delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } }]);
  events.push(["message_stop", { type: "message_stop" }]);
  return events;
}

http
  .createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        return bad(res, "invalid JSON");
      }
      const error = validate(body, req.headers);
      if (error) return bad(res, error);

      const system = typeof body.system === "string" ? body.system : textOf(body.system ?? []);
      const user = body.messages.map((m) => textOf(m.content)).join("\n");
      const feature = body.tools?.length ? "ask" : body.output_config?.format ? "structured" : "text";
      console.log(`[mock] ${feature} effort=${body.output_config?.effort ?? "-"} stream=${!!body.stream} fallbacks=${body.fallbacks ?? "-"}`);

      let message;
      if (feature === "structured") {
        message = buildMessage(body.model, [{ type: "text", text: JSON.stringify(structured(system, user)) }], "end_turn");
      } else if (feature === "ask") {
        const turn = askTurn(body);
        message = turn.toolUse
          ? buildMessage(body.model, [{ type: "text", text: "Let me look that up. " }, { type: "tool_use", ...turn.toolUse }], "tool_use")
          : buildMessage(body.model, [{ type: "text", text: turn.text }], "end_turn");
      } else {
        message = buildMessage(body.model, [{ type: "text", text: written(system, user) }], "end_turn");
      }

      if (body.stream) return sse(res, streamEvents(message));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(message));
    });
  })
  .listen(PORT, "127.0.0.1", () => console.log(`[mock] Claude API mock on http://127.0.0.1:${PORT}`));
