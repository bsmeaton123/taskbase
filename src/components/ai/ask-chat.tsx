"use client";

import {
  ArrowClockwiseIcon,
  ArrowUpIcon,
  SparkleIcon,
  StopIcon,
  TrashIcon,
} from "@phosphor-icons/react/ssr";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AutoTextarea } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { AiMarkdown, NETWORK_ERROR, readAiStream } from "./ai-text";

type Turn = { role: "user" | "assistant"; content: string; error?: boolean; stopped?: boolean };

const STARTERS = [
  "What's overdue across my workspaces?",
  "What am I on the hook for this week?",
  "Which open tasks have nobody assigned?",
  "What did the team finish recently?",
];

export function AskChat() {
  const { viewer } = useApp();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end", behavior: busy ? "auto" : "smooth" });
  }, [turns, status, busy]);

  /** Asks after the turns in `base`; a retry passes the turns before the failed question. */
  async function ask(question: string, base: Turn[] = turns) {
    const q = question.trim();
    if (!q || busy) return;
    // Failed answers, and ones stopped before any text, aren't sent back as context.
    const history: Turn[] = [
      ...base.filter((t) => !t.error && t.content.trim()),
      { role: "user", content: q },
    ];
    setTurns([...history, { role: "assistant", content: "" }]);
    setDraft("");
    setBusy(true);
    setStatus("Thinking");
    const controller = new AbortController();
    abort.current = controller;
    const update = (fn: (t: Turn) => Turn) =>
      setTurns((all) => [...all.slice(0, -1), fn(all[all.length - 1])]);
    try {
      const res = await fetch("/api/ai/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Keep the conversation short: the last few exchanges are plenty of context.
        body: JSON.stringify({
          messages: history.slice(-12).map(({ role, content }) => ({ role, content })),
        }),
        signal: controller.signal,
      });
      await readAiStream(res, (e) => {
        if (e.type === "text") {
          setStatus("Writing");
          update((t) => ({ ...t, content: t.content + e.text }));
        } else if (e.type === "status") setStatus(e.text);
        else if (e.type === "error") update((t) => ({ ...t, content: e.text, error: true }));
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") update((t) => ({ ...t, stopped: true }));
      else update((t) => ({ ...t, content: NETWORK_ERROR, error: true }));
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  const stop = () => abort.current?.abort();
  // The last question failed: offer to ask it again in place.
  const failed = !busy && turns.at(-1)?.error ? turns.at(-2) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-3xl gap-5 px-4 py-6 sm:px-6">
          {turns.length === 0 ? (
            <div className="grid gap-4 py-8">
              <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-accent-soft text-accent">
                <SparkleIcon size={20} weight="fill" />
              </span>
              <div className="grid gap-1">
                <h2 className="text-[15px] font-semibold tracking-tight">Ask about your work</h2>
                <p className="max-w-[60ch] text-muted">
                  Questions about tasks, owners, deadlines and progress in your workspaces. Answers
                  link to the tasks they&apos;re based on, and only use what you can already see.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-border px-3 py-1.5 text-[13px] text-muted hover:border-border-strong hover:text-text"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div role="log" aria-label="Conversation" aria-busy={busy} className="grid gap-5">
              {turns.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="flex items-start gap-3">
                    <Avatar person={viewer} size="md" className="mt-0.5" />
                    <p className="min-w-0 flex-1 whitespace-pre-wrap pt-1 text-[14px] font-medium">
                      {t.content}
                    </p>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                      <SparkleIcon size={14} weight="fill" />
                    </span>
                    <div className="min-w-0 flex-1 pt-1">
                      {t.error ? (
                        <p className="text-[13.5px] text-danger-text">{t.content}</p>
                      ) : t.content ? (
                        <AiMarkdown text={t.content} className="text-[14px]" />
                      ) : !t.stopped && !(busy && i === turns.length - 1) ? (
                        <p className="text-[13.5px] text-muted">
                          Claude didn&apos;t write an answer this time. Try asking another way.
                        </p>
                      ) : null}
                      {t.stopped && (
                        <p className="mt-1 text-[12.5px] text-subtle">
                          {t.content ? "Stopped." : "Stopped before answering."}
                        </p>
                      )}
                      {busy && i === turns.length - 1 && status && (
                        <p className="mt-1 flex items-center gap-2 text-[12.5px] text-muted">
                          <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
                          {status}…
                        </p>
                      )}
                      {failed && i === turns.length - 1 && (
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => ask(failed.content, turns.slice(0, -2))}
                        >
                          <ArrowClockwiseIcon size={14} />
                          Try again
                        </Button>
                      )}
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="border-t border-border px-4 py-3 sm:px-6">
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15"
        >
          <AutoTextarea
            bare
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(draft);
              } else if (e.key === "Escape" && busy) {
                e.preventDefault();
                stop();
              }
            }}
            maxLength={2000}
            minRows={1}
            aria-label="Ask a question"
            placeholder="Ask about tasks, people or deadlines…"
            className="max-h-40 overflow-y-auto py-1.5 text-[14px]"
          />
          {turns.length > 0 && (
            <Tooltip content="Start over">
              <Button
                size="icon"
                variant="ghost"
                aria-label="Start over"
                disabled={busy}
                onClick={() => setTurns([])}
              >
                <TrashIcon size={15} />
              </Button>
            </Tooltip>
          )}
          {busy ? (
            <Tooltip content="Stop">
              <Button size="icon" aria-label="Stop answering" onClick={stop}>
                <StopIcon size={14} weight="fill" />
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="submit"
              size="icon"
              variant="primary"
              aria-label="Ask"
              disabled={!draft.trim()}
            >
              <ArrowUpIcon size={15} weight="bold" />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
