"use client";

import { ArrowClockwiseIcon, SparkleIcon, XIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { INSIGHT_LABELS, type Insight } from "@/lib/insights";
import { AiCard, useAiStream } from "./ai-text";

/** "Catch me up": a personal digest of what needs you today. */
export function CatchMeUp() {
  const { ai, viewer } = useApp();
  const stream = useAiStream();
  const [open, setOpen] = useState(false);
  if (!ai) return null;
  const run = () => stream.start({ kind: "digest" });

  return (
    <div className="border-b border-border px-4 py-3 sm:px-6">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-[13.5px] text-muted">
            Good to see you, {viewer.name.split(" ")[0]}. Want the short version of what needs you?
          </p>
          <Button
            size="sm"
            onClick={() => {
              setOpen(true);
              run();
            }}
          >
            <SparkleIcon size={14} weight="fill" className="text-accent" />
            Catch me up
          </Button>
        </div>
      ) : (
        <AiCard
          title="Your catch-up"
          {...stream}
          onRetry={run}
          className="max-w-3xl"
          actions={
            <>
              <Tooltip content="Refresh">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Refresh catch-up"
                  disabled={stream.loading}
                  onClick={run}
                >
                  <ArrowClockwiseIcon size={14} />
                </Button>
              </Tooltip>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close catch-up"
                onClick={() => {
                  stream.reset();
                  setOpen(false);
                }}
              >
                <XIcon size={14} />
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** Rule-based heads-up for the viewer's own tasks (no AI needed). */
export function HeadsUp({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <section aria-label="Heads up" className="border-b border-border px-4 py-3 sm:px-6">
      <h2 className="mb-1.5 text-[12.5px] font-semibold text-warning-text">Heads up</h2>
      <ul className="grid gap-1">
        {insights.slice(0, 5).map((i, n) => (
          <li key={n} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className="text-[12px] font-medium text-muted">{INSIGHT_LABELS[i.kind]}</span>
            {i.taskNumber ? (
              <Link href={`/t/${i.taskNumber}`} className="hover:underline">
                <span className="font-mono text-[12px] text-subtle">#{i.taskNumber}</span> {i.title}
              </Link>
            ) : (
              <span>{i.title}</span>
            )}
            <span className="tabular text-subtle">{i.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
