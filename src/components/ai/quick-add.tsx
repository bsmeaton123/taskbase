"use client";

import { FlagIcon, RepeatIcon, SparkleIcon, XIcon } from "@phosphor-icons/react/ssr";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { AssigneesField } from "@/components/pickers";
import { TagChip } from "@/components/tags";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea, Input } from "@/components/ui/input";
import { formatDue } from "@/lib/dates";
import { describeRecurrence } from "@/lib/recurrence";
import { useIsMac } from "@/lib/use-is-mac";
import { cn, pluralize } from "@/lib/utils";
import { createFromQuickAdd, parseQuickAdd, type QuickAddDraft } from "@/server/actions/ai";

type Directory = {
  id: string;
  name: string;
  lists: { id: string; name: string }[];
  members: { id: string; name: string; email: string }[];
  tags: { id: string; name: string }[];
}[];

const fieldClass =
  "h-8 min-w-0 rounded-md border border-border bg-surface px-2 text-[13px] text-text hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

const EXAMPLES = [
  "Ask Priya for the brand assets by Friday, urgent",
  "Every Monday: check the supplier invoices and approve the payment run",
  "Photographer for the team photos. Sofia has a contact. Need it done before the About page goes live on the 20th, budget is 400",
];

/**
 * Dump what's in your head about a task; Claude shapes it into a proper task (title,
 * description, subtasks, dates, owner, tags, repeat) for you to check and create.
 */
export function QuickAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { today, viewer } = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<QuickAddDraft | null>(null);
  const [dir, setDir] = useState<Directory>([]);
  const [parsing, setParsing] = useState(false);
  const [creating, startCreate] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  const isMac = useIsMac();

  const currentWorkspace = /^\/w\/([^/]+)/.exec(pathname)?.[1] ?? null;
  const ws = draft ? dir.find((w) => w.id === draft.workspaceId) : null;

  async function parse() {
    if (text.trim().length < 3 || parsing) return;
    setParsing(true);
    const res = await perform(parseQuickAdd(text, currentWorkspace));
    setParsing(false);
    if (res.ok) {
      setDir(res.data.workspaces);
      setDraft(res.data.draft);
    }
  }

  function create() {
    if (!draft || creating || !draft.title.trim() || !draft.taskListId) return;
    startCreate(async () => {
      const res = await perform(
        createFromQuickAdd({
          workspaceId: draft.workspaceId,
          taskListId: draft.taskListId,
          title: draft.title,
          description: draft.description,
          subtasks: draft.subtasks,
          assigneeIds: draft.assigneeIds,
          startDate: draft.startDate,
          dueDate: draft.dueDate,
          recurrence: draft.recurrence,
          tagIds: draft.tagIds,
          newTags: draft.newTags,
          urgent: draft.urgent,
        }),
      );
      if (res.ok) {
        toast.success(`Added to ${draft.workspaceName}`, {
          action: {
            label: "Open",
            onClick: () => router.push(`/w/${draft.workspaceId}?task=${res.data.id}`),
          },
        });
        onOpenChange(false);
        setText("");
        setDraft(null);
      }
    });
  }

  const tagNames = draft
    ? [
        ...draft.tagIds.map((id) => ws?.tags.find((t) => t.id === id)?.name).filter((n): n is string => Boolean(n)),
        ...draft.newTags,
      ]
    : [];
  const repeatLabel = draft?.recurrence ? describeRecurrence(draft.recurrence, draft.dueDate) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setText("");
          setDraft(null);
        }
      }}
    >
      <DialogContent
        title="Quick add"
        description="Dump whatever's in your head about it. Claude turns it into a proper task for you to check."
        className="max-w-xl"
      >
        <div className="grid gap-3">
          {!draft && (
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                parse();
              }}
              className="grid gap-2"
            >
              <div className="flex min-w-0 items-start gap-2 overflow-hidden rounded-[10px] border border-border bg-surface px-3 py-2 focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15">
                <SparkleIcon size={16} weight="fill" className="mt-2 shrink-0 text-accent" />
                <AutoTextarea
                  ref={input}
                  bare
                  autoFocus
                  value={text}
                  readOnly={parsing}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      parse();
                    }
                  }}
                  maxLength={4000}
                  minRows={3}
                  aria-label="Describe the task"
                  placeholder="e.g. Need the photographer booked for team photos before the About page goes live on the 20th. Sofia has a contact. Budget around 400."
                  className="max-h-64 w-full min-w-0 flex-1 overflow-y-auto break-words py-1.5 text-[14px]"
                />
              </div>
              <div className="grid gap-2">
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {EXAMPLES.map((ex, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={parsing}
                      onClick={() => {
                        setText(ex);
                        input.current?.focus();
                      }}
                      className="max-w-full truncate rounded-full border border-border px-2.5 py-1 text-[12.5px] text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
                      title={ex}
                    >
                      {ex.length > 48 ? `${ex.slice(0, 46).trimEnd()}…` : ex}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-3">
                  <span className="hidden text-[12px] text-subtle sm:inline">
                    {isMac ? "⌘" : "Ctrl"}+Enter
                  </span>
                  <Button type="submit" size="sm" variant="primary" disabled={parsing || text.trim().length < 3}>
                    {parsing ? "Reading…" : "Shape it"}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {draft && ws && (
            <div
              className="grid gap-3"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  create();
                }
              }}
            >
              <p className="line-clamp-2 rounded-md bg-surface-2 px-3 py-2 text-[12.5px] text-muted" title={text}>
                {text}
              </p>
              <div className="grid gap-2.5 rounded-[10px] border border-accent/25 bg-accent-soft/35 p-3.5">
                <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  <SparkleIcon size={13} weight="fill" className="shrink-0 text-accent" />
                  Drafted from what you wrote. Check it before creating.
                </p>
                <Input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  maxLength={300}
                  aria-label="Task title"
                  className="font-medium"
                  // The textarea it replaces had focus; keep keyboard users in the draft.
                  autoFocus
                />
                <AutoTextarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  minRows={2}
                  maxLength={20000}
                  aria-label="Description"
                  placeholder="Description (optional)"
                  className="max-h-40 overflow-y-auto text-[13px]"
                />
                {draft.subtasks.length > 0 && (
                  <ul className="grid gap-1" aria-label="Subtasks">
                    {draft.subtasks.map((s, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="size-3.5 shrink-0 rounded-[4px] border border-border-strong" aria-hidden />
                        <input
                          value={s}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              subtasks: draft.subtasks.map((x, j) => (j === i ? e.target.value : x)),
                            })
                          }
                          maxLength={200}
                          aria-label={`Subtask ${i + 1}`}
                          className="h-7 min-w-0 flex-1 rounded-md bg-transparent px-1 text-[13px] hover:bg-surface focus:bg-surface focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setDraft({ ...draft, subtasks: draft.subtasks.filter((_, j) => j !== i) })}
                          aria-label={`Remove subtask ${i + 1}`}
                          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface hover:text-text"
                        >
                          <XIcon size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    value={draft.workspaceId}
                    aria-label="Workspace"
                    className={fieldClass}
                    onChange={(e) => {
                      const next = dir.find((w) => w.id === e.target.value)!;
                      setDraft({
                        ...draft,
                        workspaceId: next.id,
                        workspaceName: next.name,
                        taskListId: next.lists[0]?.id ?? "",
                        listName: next.lists[0]?.name ?? "",
                        assigneeIds: draft.assigneeIds.filter((id) => next.members.some((m) => m.id === id)),
                        // Tags belong to a workspace: carry names over as new tags there.
                        tagIds: [],
                        newTags: tagNames,
                      });
                    }}
                  >
                    {dir.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={draft.taskListId}
                    aria-label="Task list"
                    className={fieldClass}
                    onChange={(e) => setDraft({ ...draft, taskListId: e.target.value })}
                  >
                    {ws.lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <AssigneesField
                    people={ws.members}
                    value={draft.assigneeIds}
                    onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
                    viewerId={viewer.id}
                    className={fieldClass}
                  />
                  <label className="flex items-center gap-2 text-[12.5px] text-muted">
                    <span className="w-8 shrink-0">Due</span>
                    <input
                      type="date"
                      value={draft.dueDate ?? ""}
                      aria-label="Due date"
                      className={cn(fieldClass, "flex-1")}
                      onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })}
                    />
                  </label>
                  {(draft.startDate || draft.dueDate) && (
                    <label className="flex items-center gap-2 text-[12.5px] text-muted sm:col-start-2">
                      <span className="w-8 shrink-0">Start</span>
                      <input
                        type="date"
                        value={draft.startDate ?? ""}
                        max={draft.dueDate ?? undefined}
                        aria-label="Start date"
                        className={cn(fieldClass, "flex-1")}
                        onChange={(e) => setDraft({ ...draft, startDate: e.target.value || null })}
                      />
                    </label>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    aria-pressed={draft.urgent}
                    onClick={() => setDraft({ ...draft, urgent: !draft.urgent })}
                    className={cn(
                      "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[12.5px] font-medium",
                      draft.urgent ? "bg-danger-soft text-danger-text" : "text-muted hover:bg-surface-2",
                    )}
                  >
                    <FlagIcon size={13} weight={draft.urgent ? "fill" : "regular"} />
                    Urgent
                  </button>
                  {repeatLabel && (
                    <button
                      type="button"
                      onClick={() => setDraft({ ...draft, recurrence: null })}
                      title="Click to make it a one-off"
                      aria-label={`${repeatLabel}. Make it a one-off`}
                      className="inline-flex h-7 items-center gap-1.5 rounded-md bg-surface-2 px-2 text-[12.5px] text-accent-text hover:bg-surface"
                    >
                      <RepeatIcon size={13} />
                      {repeatLabel}
                      <XIcon size={11} className="text-subtle" />
                    </button>
                  )}
                  {tagNames.map((name) => (
                    <TagChip key={name} tag={{ name, color: "slate" }} className="h-6 pr-0.5">
                      <button
                        type="button"
                        aria-label={`Remove tag ${name}`}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            tagIds: draft.tagIds.filter((id) => ws.tags.find((t) => t.id === id)?.name !== name),
                            newTags: draft.newTags.filter((n) => n !== name),
                          })
                        }
                        className="inline-flex size-5 items-center justify-center rounded-full text-subtle hover:bg-surface-2 hover:text-text"
                      >
                        <XIcon size={10} weight="bold" />
                      </button>
                    </TagChip>
                  ))}
                  {draft.dueDate && (
                    <span className="tabular text-[12.5px] text-muted">
                      Due {formatDue(draft.dueDate, today)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => setDraft(null)}>
                  Edit what I wrote
                </Button>
                <Button
                  variant="primary"
                  disabled={creating || !draft.title.trim() || !draft.taskListId}
                  onClick={create}
                >
                  {creating
                    ? "Creating…"
                    : draft.subtasks.length
                      ? `Create task with ${pluralize(draft.subtasks.length, "subtask")}`
                      : "Create task"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
