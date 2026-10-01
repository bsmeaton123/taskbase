"use client";

import {
  ArrowClockwiseIcon,
  CheckIcon,
  CopyIcon,
  SparkleIcon,
  WarningIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { AssigneesField } from "@/components/pickers";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea } from "@/components/ui/input";
import { formatDue } from "@/lib/dates";
import { INSIGHT_LABELS, type Insight } from "@/lib/insights";
import { cn, pluralize } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import {
  createTasksFromDrafts,
  extractTasksFromNotes,
  getWorkspaceInsights,
  type DraftTask,
} from "@/server/actions/ai";
import type { Member } from "@/server/queries";
import { AiCard, NETWORK_ERROR, useAiStream } from "./ai-text";

const fieldClass =
  "h-8 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-text hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

/* -------------------------------------------------------------------------- */
/* Notes → tasks                                                               */
/* -------------------------------------------------------------------------- */

export function NotesToTasksDialog({
  open,
  onOpenChange,
  workspaceId,
  members,
  lists,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  members: Member[];
  lists: { id: string; name: string }[];
}) {
  const { today, viewer } = useApp();
  const [notes, setNotes] = useState("");
  const [drafts, setDrafts] = useState<(DraftTask & { keep: boolean })[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [noneFound, setNoneFound] = useState(false);
  const [creating, startCreate] = useTransition();

  const update = (i: number, patch: Partial<DraftTask & { keep: boolean }>) =>
    setDrafts((d) => d && d.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const kept = drafts?.filter((d) => d.keep) ?? [];
  const canCreate = kept.length > 0 && kept.every((d) => d.title.trim());

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setDrafts(null);
      setNotes("");
    }
  }

  function create() {
    if (creating || !canCreate) return;
    startCreate(async () => {
      const res = await perform(
        createTasksFromDrafts(
          workspaceId,
          kept.map((d) => ({
            title: d.title,
            description: d.description,
            assigneeIds: d.assigneeIds,
            dueDate: d.dueDate,
            list: d.list,
            urgent: d.urgent,
            subtasks: d.subtasks,
          })),
        ),
        { success: `Created ${pluralize(kept.length, "task")}` },
      );
      if (res.ok) close(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Create tasks from notes"
        description="Paste meeting notes, an email or a brief. Claude pulls out the action items for you to check before anything is created."
        className="max-w-2xl"
      >
        {!drafts ? (
          <form
            method="post"
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (extracting || notes.trim().length < 10) return;
              setExtracting(true);
              setNoneFound(false);
              const res = await perform(extractTasksFromNotes(workspaceId, notes));
              setExtracting(false);
              if (res.ok) {
                if (res.data.drafts.length === 0) setNoneFound(true);
                else setDrafts(res.data.drafts.map((d) => ({ ...d, keep: true })));
              }
            }}
          >
            <AutoTextarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              readOnly={extracting}
              minRows={8}
              autoFocus
              aria-label="Notes"
              placeholder={"e.g.\nPriya will send the pricing copy by Friday.\nWe need someone to book the photographer, urgent.\nTomasz to fix the video embeds and check 20 posts."}
              className="max-h-[45vh] overflow-y-auto"
            />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p role="status" className="min-w-0 flex-1 basis-56 text-[12.5px] text-muted">
                {extracting
                  ? "Reading your notes. This can take a minute."
                  : noneFound
                    ? "No action items found in those notes. Add more detail and try again."
                    : ""}
              </p>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={extracting || notes.trim().length < 10}
              >
                <SparkleIcon size={14} weight="fill" />
                {extracting ? "Reading notes…" : "Find action items"}
              </Button>
            </div>
          </form>
        ) : (
          <div
            className="grid gap-3"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                create();
              }
            }}
          >
            <p className="tabular flex items-center gap-1.5 text-[12.5px] text-muted">
              <SparkleIcon size={13} weight="fill" className="shrink-0 text-accent" />
              {pluralize(drafts.length, "task")} drafted from your notes. Check before creating.
            </p>
            <ul className="scrollbar-thin grid max-h-[55vh] gap-2 overflow-y-auto pr-1">
              {drafts.map((d, i) => (
                <li
                  key={i}
                  className={cn(
                    "grid gap-2 rounded-[10px] border p-2.5 transition-opacity",
                    d.keep ? "border-border" : "border-dashed border-border opacity-55",
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={d.keep}
                      onChange={(e) => update(i, { keep: e.target.checked })}
                      className="mt-2 size-4 shrink-0 accent-[var(--accent)]"
                      aria-label={`Include ${d.title || `task ${i + 1}`}`}
                    />
                    <input
                      value={d.title}
                      onChange={(e) => update(i, { title: e.target.value })}
                      maxLength={300}
                      aria-label={`Title of task ${i + 1}`}
                      // The notes field it replaces had focus; start on the first draft.
                      autoFocus={i === 0}
                      className="h-8 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 text-[14px] font-medium hover:border-border focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-6.5">
                    <AssigneesField
                      people={members}
                      value={d.assigneeIds}
                      onChange={(assigneeIds) => update(i, { assigneeIds })}
                      viewerId={viewer.id}
                      className={cn(fieldClass, "max-w-56")}
                    />
                    <input
                      type="date"
                      value={d.dueDate ?? ""}
                      onChange={(e) => update(i, { dueDate: e.target.value || null })}
                      className={fieldClass}
                      aria-label="Due date"
                    />
                    <select
                      value={d.list ?? ""}
                      onChange={(e) => update(i, { list: e.target.value || null })}
                      className={fieldClass}
                      aria-label="Task list"
                    >
                      <option value="">{lists[0]?.name ?? "Default list"}</option>
                      {lists.slice(1).map((l) => (
                        <option key={l.id} value={l.name}>
                          {l.name}
                        </option>
                      ))}
                      {d.list && !lists.some((l) => l.name.toLowerCase() === d.list!.toLowerCase()) && (
                        <option value={d.list}>{d.list} (new list)</option>
                      )}
                    </select>
                    <label className="inline-flex h-8 items-center gap-1.5 px-1 text-[13px] text-muted">
                      <input
                        type="checkbox"
                        checked={d.urgent}
                        onChange={(e) => update(i, { urgent: e.target.checked })}
                        className="accent-[var(--danger)]"
                      />
                      Urgent
                    </label>
                    {d.dueDate && (
                      <span className="tabular text-[12px] text-subtle">
                        {formatDue(d.dueDate, today)}
                      </span>
                    )}
                  </div>
                  {(d.description || d.subtasks.length > 0) && (
                    <div className="pl-6.5 text-[12.5px] text-muted">
                      {d.description && <p className="line-clamp-2">{d.description}</p>}
                      {d.subtasks.length > 0 && (
                        <p className="mt-0.5">
                          {pluralize(d.subtasks.length, "subtask")}: {d.subtasks.join(", ")}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setDrafts(null)}>
                Back to notes
              </Button>
              <Button variant="primary" disabled={creating || !canCreate} onClick={create}>
                {creating ? "Creating…" : `Create ${pluralize(kept.length, "task")}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Status report                                                               */
/* -------------------------------------------------------------------------- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={!text}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          toast.error("Couldn't copy. Select the text and copy it instead.");
          return;
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

export function StatusReportDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
}) {
  const [days, setDays] = useState(7);
  const stream = useAiStream();
  const run = (d: number) => stream.start({ kind: "report", workspaceId, days: d });

  useEffect(() => {
    if (open) run(days);
    else stream.reset();
    // Only when the dialog opens or closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Status report: ${workspaceName}`}
        description="A draft written from the workspace's recent activity. Check it before you send it."
        className="max-w-2xl"
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-md bg-surface-2 p-0.5"
              role="radiogroup"
              aria-label="Period"
              onKeyDown={radioGroupKeys}
            >
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={days === d}
                  tabIndex={days === d ? 0 : -1}
                  onClick={() => {
                    setDays(d);
                    run(d);
                  }}
                  className={cn(
                    "tabular h-7 rounded-[5px] px-2.5 text-[13px] font-medium",
                    days === d ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                  )}
                >
                  Last {d} days
                </button>
              ))}
            </div>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={stream.loading} onClick={() => run(days)}>
              <ArrowClockwiseIcon size={14} />
              Rewrite
            </Button>
            <CopyButton text={stream.loading || stream.error ? "" : stream.text} />
          </div>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
            <AiCard title="Draft report" {...stream} onRetry={() => run(days)} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Risks and health                                                            */
/* -------------------------------------------------------------------------- */

const SEVERITY_STYLE: Record<Insight["severity"], string> = {
  high: "bg-danger-soft text-danger-text",
  medium: "bg-warning-soft text-warning-text",
  low: "bg-surface-3 text-muted",
};

export function RisksDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  workspaceName: string;
}) {
  const { ai } = useApp();
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Bumped by "Try again" to re-run the effect below.
  const [attempt, setAttempt] = useState(0);
  const stream = useAiStream();
  const runBriefing = () => stream.start({ kind: "risks", workspaceId });

  useEffect(() => {
    if (!open) {
      stream.reset();
      return;
    }
    let cancelled = false;
    getWorkspaceInsights(workspaceId).then(
      (res) => {
        if (cancelled) return;
        if (res.ok) {
          setInsights(res.data.insights);
          if (ai && res.data.insights.length) runBriefing();
        } else setLoadError(res.error);
      },
      () => {
        if (!cancelled) setLoadError(NETWORK_ERROR);
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId, attempt]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Risks and health: ${workspaceName}`}
        description="Early warnings from due dates, activity and workload."
        className="max-w-2xl"
      >
        <div className="scrollbar-thin grid max-h-[65vh] gap-4 overflow-y-auto pr-1">
          {loadError ? (
            <div className="grid justify-items-start gap-2.5">
              <p className="text-[13px] text-danger-text" role="alert">
                {loadError}
              </p>
              <Button
                size="sm"
                onClick={() => {
                  setLoadError(null);
                  setInsights(null);
                  setAttempt((a) => a + 1);
                }}
              >
                <ArrowClockwiseIcon size={14} />
                Try again
              </Button>
            </div>
          ) : insights === null ? (
            <div className="grid gap-2" aria-busy="true">
              <span className="sr-only">Checking the workspace</span>
              <span className="h-10 rounded-md bg-surface-2 motion-safe:animate-pulse" />
              <span className="h-10 rounded-md bg-surface-2 motion-safe:animate-pulse" />
            </div>
          ) : insights.length === 0 ? (
            <p className="flex items-center gap-2 text-muted">
              <CheckIcon size={16} className="shrink-0 text-success" />
              Nothing needs attention: no overdue, stalled or unowned work, and nobody looks overloaded.
            </p>
          ) : (
            <>
              {ai && <AiCard title="Briefing" {...stream} onRetry={runBriefing} />}
              <ul className="divide-y divide-border rounded-[10px] border border-border">
                {insights.map((i, n) => (
                  <li key={n} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                    <span
                      className={cn(
                        "mt-0.5 inline-flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11.5px] font-medium",
                        SEVERITY_STYLE[i.severity],
                      )}
                    >
                      {i.severity === "high" && <WarningIcon size={11} weight="fill" />}
                      {INSIGHT_LABELS[i.kind]}
                    </span>
                    <span className="min-w-0 flex-1">
                      {i.taskNumber ? (
                        <Link href={`/t/${i.taskNumber}`} className="font-medium hover:underline">
                          <span className="font-mono text-[12px] text-subtle">#{i.taskNumber}</span> {i.title}
                        </Link>
                      ) : (
                        <span className="font-medium">{i.title}</span>
                      )}
                      <span className="tabular block text-muted">
                        {i.detail}
                        {i.person && i.kind !== "overloaded" ? `, ${i.person}` : ""}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
