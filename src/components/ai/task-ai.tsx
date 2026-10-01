"use client";

import { ArrowClockwiseIcon, SparkleIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { pluralize } from "@/lib/utils";
import {
  addSubtasksBulk,
  attachmentInsights,
  suggestSubtasks,
} from "@/server/actions/ai";
import { AiCard, AiSkeleton, useAiStream } from "./ai-text";

/* -------------------------------------------------------------------------- */
/* Catch me up on this task                                                    */
/* -------------------------------------------------------------------------- */

export function ThreadSummary({ taskId, worthIt }: { taskId: string; worthIt: boolean }) {
  const { ai } = useApp();
  const stream = useAiStream();
  const [open, setOpen] = useState(false);
  if (!ai || !worthIt) return null;
  const run = () => stream.start({ kind: "thread", taskId });

  if (!open)
    return (
      <div className="px-4 pt-3 sm:px-6">
        <Button
          size="sm"
          variant="ghost"
          className="-ml-2 text-accent-text"
          onClick={() => {
            setOpen(true);
            run();
          }}
        >
          <SparkleIcon size={14} weight="fill" />
          Catch me up on this task
        </Button>
      </div>
    );

  return (
    <div className="px-4 pt-3 sm:px-6">
      <AiCard
        title="Catch-up"
        {...stream}
        onRetry={run}
        actions={
          <>
            <Tooltip content="Regenerate">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Regenerate summary"
                disabled={stream.loading}
                onClick={run}
              >
                <ArrowClockwiseIcon size={14} />
              </Button>
            </Tooltip>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close summary"
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
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pick-from-suggestions list (subtasks and file action items)                 */
/* -------------------------------------------------------------------------- */

type Suggestion = { title: string; assigneeId: string | null };

function SuggestionPicker({
  items,
  onAdd,
  onCancel,
}: {
  items: Suggestion[];
  onAdd: (picked: Suggestion[]) => Promise<void>;
  onCancel: () => void;
}) {
  const { people } = useApp();
  const [picked, setPicked] = useState<boolean[]>(() => items.map(() => true));
  const [pending, startTransition] = useTransition();
  const chosen = items.filter((_, i) => picked[i]);

  return (
    <div className="grid gap-2">
      <ul className="grid gap-0.5">
        {items.map((s, i) => {
          const person = people.find((p) => p.id === s.assigneeId);
          return (
            <li key={i}>
              <label className="flex min-h-8 items-center gap-2.5 rounded-md px-2 hover:bg-surface-2">
                <input
                  type="checkbox"
                  checked={picked[i]}
                  onChange={(e) => setPicked((p) => p.map((v, j) => (j === i ? e.target.checked : v)))}
                  className="size-4 shrink-0 accent-[var(--accent)]"
                />
                <span className="min-w-0 flex-1 text-[13.5px]">{s.title}</span>
                {person && <Avatar person={person} size="xs" />}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Dismiss
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={pending || chosen.length === 0}
          onClick={() => startTransition(() => onAdd(chosen))}
        >
          {pending ? "Adding…" : `Add ${pluralize(chosen.length, "subtask")}`}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Suggest subtasks                                                            */
/* -------------------------------------------------------------------------- */

export function SuggestSubtasksButton({ taskId }: { taskId: string }) {
  const { ai } = useApp();
  const [state, setState] = useState<"idle" | "loading" | "ready">("idle");
  const [items, setItems] = useState<Suggestion[]>([]);
  if (!ai) return null;

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="ml-auto text-accent-text"
        disabled={state === "loading"}
        onClick={async () => {
          setState("loading");
          const res = await perform(suggestSubtasks(taskId));
          if (res.ok && res.data.suggestions.length) {
            setItems(res.data.suggestions);
            setState("ready");
          } else {
            if (res.ok) toast("No new subtasks to suggest.");
            setState("idle");
          }
        }}
      >
        <SparkleIcon size={13} weight="fill" />
        {state === "loading" ? "Thinking…" : "Suggest"}
      </Button>
      {state === "ready" && (
        <div className="mt-2 w-full rounded-[10px] border border-accent/25 bg-accent-soft/35 p-2.5">
          <p className="mb-1.5 flex items-center gap-1.5 px-2 text-[12.5px] font-medium text-muted">
            <SparkleIcon size={13} weight="fill" className="text-accent" />
            Suggested subtasks
          </p>
          <SuggestionPicker
            items={items}
            onCancel={() => setState("idle")}
            onAdd={async (picked) => {
              const res = await perform(addSubtasksBulk(taskId, picked), {
                success: `Added ${pluralize(picked.length, "subtask")}`,
              });
              if (res.ok) setState("idle");
            }}
          />
        </div>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Summarise an attachment                                                     */
/* -------------------------------------------------------------------------- */

const SUMMARISABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/|application\/(json|xml|csv))/;

export function canSummarise(contentType: string, name: string) {
  return SUMMARISABLE.test(contentType) || /\.(md|txt|csv|json|log)$/i.test(name);
}

export function AttachmentInsightsButton({
  attachmentId,
  taskId,
  name,
}: {
  attachmentId: string;
  taskId: string;
  name: string;
}) {
  const { ai } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ summary: string[]; actionItems: string[] } | null>(null);
  if (!ai) return null;

  async function load() {
    setLoading(true);
    setResult(null);
    const res = await perform(attachmentInsights(attachmentId));
    setLoading(false);
    if (res.ok) setResult(res.data);
    else setOpen(false);
  }

  return (
    <>
      <Tooltip content="Summarise with AI">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            if (!result && !loading) load();
          }}
          className="inline-flex size-7 items-center justify-center rounded-md text-accent-text hover:bg-accent-soft"
          aria-label={`Summarise ${name}`}
        >
          <SparkleIcon size={15} weight="fill" />
        </button>
      </Tooltip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={name}
          description="What's in this file and what it means for the task."
          className="max-w-lg"
        >
          <div aria-live="polite" aria-busy={loading || !result}>
            {loading || !result ? (
              <AiSkeleton label="Reading the file" />
            ) : result.summary.length === 0 && result.actionItems.length === 0 ? (
              <p className="text-[13.5px] text-muted">
                Claude couldn&apos;t find anything to summarise in this file.
              </p>
            ) : (
              <div className="grid gap-4">
                {result.summary.length > 0 && (
                  <ul className="grid gap-1.5 pl-4 text-[13.5px] leading-relaxed text-muted [&>li]:list-disc">
                    {result.summary.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
                {result.actionItems.length > 0 && (
                  <div className="grid gap-1.5">
                    <h3 className="text-[13px] font-semibold">Action items</h3>
                    <SuggestionPicker
                      items={result.actionItems.map((title) => ({ title, assigneeId: null }))}
                      onCancel={() => setOpen(false)}
                      onAdd={async (picked) => {
                        const res = await perform(addSubtasksBulk(taskId, picked), {
                          success: `Added ${pluralize(picked.length, "subtask")}`,
                        });
                        if (res.ok) setOpen(false);
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

