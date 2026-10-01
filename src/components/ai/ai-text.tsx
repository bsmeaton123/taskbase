"use client";

import { ArrowClockwiseIcon, SparkleIcon, StopIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AI_NOT_CONNECTED } from "@/lib/ai-messages";
import { cn } from "@/lib/utils";

export const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";

/* -------------------------------------------------------------------------- */
/* Streaming                                                                   */
/* -------------------------------------------------------------------------- */

type StreamEvent =
  | { type: "text"; text: string }
  | { type: "status"; text: string }
  | { type: "error"; text: string }
  | { type: "done" };

/** Reads newline-delimited JSON events from an AI endpoint. */
export async function readAiStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
) {
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    onEvent({ type: "error", text: data.error ?? "The AI request failed. Try again." });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as StreamEvent);
    }
  }
}

export function useAiStream(endpoint = "/api/ai/stream") {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // True once a run finishes without being stopped, so an empty answer can say so.
  const [done, setDone] = useState(false);
  // True when someone pressed Stop; what was written so far stays on screen.
  const [stopped, setStopped] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const start = useCallback(
    async (body: unknown) => {
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setText("");
      setError(null);
      setStatus(null);
      setDone(false);
      setStopped(false);
      setLoading(true);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        await readAiStream(res, (e) => {
          if (e.type === "text") {
            setStatus(null);
            setText((t) => t + e.text);
          } else if (e.type === "status") setStatus(e.text);
          else if (e.type === "error") setError(e.text);
        });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setError(NETWORK_ERROR);
      } finally {
        if (abort.current === controller) {
          setLoading(false);
          setStatus(null);
          if (!controller.signal.aborted) setDone(true);
        }
      }
    },
    [endpoint],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setStopped(true);
  }, []);

  const reset = useCallback(() => {
    abort.current?.abort();
    setText("");
    setError(null);
    setStatus(null);
    setDone(false);
    setStopped(false);
    setLoading(false);
  }, []);

  return { text, status, error, loading, done, stopped, start, stop, reset };
}

/* -------------------------------------------------------------------------- */
/* Rendering                                                                   */
/* -------------------------------------------------------------------------- */

/** Inline formatting: **bold** and #123 task links. No HTML is ever injected. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|#\d{1,9}\b)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p))
          return (
            <strong key={i} className="font-semibold text-text">
              {p.slice(2, -2)}
            </strong>
          );
        if (/^#\d{1,9}$/.test(p))
          return (
            <Link
              key={i}
              href={`/t/${p.slice(1)}`}
              className="font-mono text-[0.92em] text-accent-text hover:underline"
            >
              {p}
            </Link>
          );
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

/** Renders the small markdown subset the prompts ask for. */
export function AiMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="grid gap-1 pl-4 [&>li]:list-disc">
          {bullets.map((b, i) => (
            <li key={i} className="pl-0.5 marker:text-subtle">
              <Inline text={b} />
            </li>
          ))}
        </ul>,
      );
      bullets = [];
    }
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading)
      blocks.push(
        <h4
          key={blocks.length}
          className="mt-1 text-[13px] font-semibold tracking-tight text-text first:mt-0"
        >
          <Inline text={heading[1]} />
        </h4>,
      );
    else
      blocks.push(
        <p key={blocks.length}>
          <Inline text={line} />
        </p>,
      );
  }
  flush();
  return (
    <div className={cn("grid gap-2 text-[13.5px] leading-relaxed text-muted", className)}>
      {blocks}
    </div>
  );
}

/** Pulsing bars that hold the place of an answer still being written. */
export function AiSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-2">
      <p className="text-[12.5px] text-muted">{label}…</p>
      <span className="h-3 w-4/5 rounded bg-accent/15 motion-safe:animate-pulse" />
      <span className="h-3 w-3/5 rounded bg-accent/15 motion-safe:animate-pulse" />
      <span className="h-3 w-2/3 rounded bg-accent/15 motion-safe:animate-pulse" />
    </div>
  );
}

/** Card for an AI answer: header, streamed body, status, Stop, errors and a retry. */
export function AiCard({
  title,
  text,
  status,
  error,
  loading,
  done,
  stopped,
  stop,
  onRetry,
  actions,
  className,
}: {
  title: string;
  text: string;
  status?: string | null;
  error?: string | null;
  loading?: boolean;
  done?: boolean;
  stopped?: boolean;
  /** Shows a Stop button while Claude is writing. */
  stop?: () => void;
  onRetry?: () => void;
  actions?: React.ReactNode;
  className?: string;
}) {
  const empty = done && !text && !error;
  return (
    <section
      aria-live="polite"
      aria-busy={loading}
      className={cn("rounded-[10px] border border-accent/25 bg-accent-soft/35 p-3.5", className)}
    >
      <div className="mb-2 flex items-center gap-2">
        <SparkleIcon size={15} weight="fill" className="text-accent" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="flex-1" />
        {loading && stop && (
          <Button size="sm" variant="ghost" onClick={stop}>
            <StopIcon size={12} weight="fill" />
            Stop
          </Button>
        )}
        {actions}
      </div>
      {error ? (
        <p className="text-[13px] text-danger-text">{error}</p>
      ) : text ? (
        <AiMarkdown text={text} />
      ) : loading ? (
        <AiSkeleton label={status ?? "Thinking"} />
      ) : empty ? (
        <p className="text-[13px] text-muted">Claude didn&apos;t write anything this time.</p>
      ) : null}
      {loading && text && (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] text-muted">
          <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
          {status ?? "Writing"}…
        </p>
      )}
      {stopped && !loading && !error && (
        <p className="mt-2 text-[12.5px] text-muted">
          {text ? "Stopped." : "Stopped before Claude wrote anything."}
        </p>
      )}
      {/* Retrying can't help until a key is connected. */}
      {(error || empty || stopped) && error !== AI_NOT_CONNECTED && onRetry && !loading && (
        <Button size="sm" className="mt-2.5" onClick={onRetry}>
          <ArrowClockwiseIcon size={14} />
          Try again
        </Button>
      )}
    </section>
  );
}
