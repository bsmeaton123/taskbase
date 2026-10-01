"use client";

import { SparkleIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import { ColorSwatches } from "@/components/color-swatches";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea, Field, Input } from "@/components/ui/input";
import { formatDue, shiftDate } from "@/lib/dates";
import { cn, pluralize } from "@/lib/utils";
import { createWorkspaceFromPlan, planWorkspace, type WorkspacePlan } from "@/server/actions/ai";

type Kept = { lists: { keep: boolean; tasks: boolean[] }[] };

export function PlanWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { today } = useApp();
  const [brief, setBrief] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [kept, setKept] = useState<Kept | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>("teal");
  const [planning, setPlanning] = useState(false);
  const [emptyPlan, setEmptyPlan] = useState(false);
  const [creating, startCreate] = useTransition();

  const taskCount =
    plan && kept
      ? plan.lists.reduce(
          (n, _, i) => n + (kept.lists[i].keep ? kept.lists[i].tasks.filter(Boolean).length : 0),
          0,
        )
      : 0;

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) {
      setPlan(null);
      setBrief("");
    }
  }

  function setList(li: number, patch: Partial<Kept["lists"][number]>) {
    setKept((k) => k && { lists: k.lists.map((l, j) => (j === li ? { ...l, ...patch } : l)) });
  }

  function create() {
    if (!plan || !kept || creating || !name.trim() || taskCount === 0) return;
    startCreate(async () => {
      const trimmed: WorkspacePlan = {
        ...plan,
        lists: plan.lists
          .map((l, li) => ({ ...l, tasks: l.tasks.filter((_, ti) => kept.lists[li].tasks[ti]) }))
          .filter((_, li) => kept.lists[li].keep),
      };
      const res = await perform(
        createWorkspaceFromPlan({ plan: trimmed, name, color, startDate, memberIds: [] }),
        { success: `Workspace created with ${pluralize(taskCount, "task")}` },
      );
      if (res.ok) {
        close(false);
        router.push(`/w/${res.data.id}`);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Plan a workspace with AI"
        description="Describe the project. Claude drafts the task lists, tasks and dates; you choose what to keep."
        className="max-w-2xl"
      >
        {!plan || !kept ? (
          <form
            method="post"
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (planning || brief.trim().length < 10) return;
              setPlanning(true);
              setEmptyPlan(false);
              const res = await perform(planWorkspace(brief));
              setPlanning(false);
              if (!res.ok) return;
              const next = res.data.plan;
              if (!next.lists.some((l) => l.tasks.length > 0)) {
                setEmptyPlan(true);
                return;
              }
              setPlan(next);
              setName(next.name);
              setKept({ lists: next.lists.map((l) => ({ keep: true, tasks: l.tasks.map(() => true) })) });
            }}
          >
            <Field
              label="What's the project?"
              htmlFor="plan-brief"
              hint="Goals, deadline, team, anything that matters."
            >
              <AutoTextarea
                id="plan-brief"
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                readOnly={planning}
                minRows={4}
                autoFocus
                placeholder="e.g. Move the office to the new building by the end of November: IT, furniture, telling clients, and the handover of the old lease."
              />
            </Field>
            <Field label="Start date" htmlFor="plan-start">
              <Input
                id="plan-start"
                type="date"
                value={startDate}
                onChange={(e) => e.target.value && setStartDate(e.target.value)}
                className="w-48"
              />
            </Field>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p role="status" className="min-w-0 flex-1 basis-56 text-[12.5px] text-muted">
                {planning
                  ? "Drafting the plan. This can take a minute."
                  : emptyPlan
                    ? "Claude didn't suggest any tasks for that. Add more detail and try again."
                    : ""}
              </p>
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={planning || brief.trim().length < 10}
              >
                <SparkleIcon size={14} weight="fill" />
                {planning ? "Planning…" : "Draft the plan"}
              </Button>
            </div>
          </form>
        ) : (
          <div
            className="grid gap-4"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                create();
              }
            }}
          >
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Workspace name" htmlFor="plan-name">
                <Input
                  id="plan-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  // The brief field it replaces had focus; start the review at the top.
                  autoFocus
                />
              </Field>
              <ColorSwatches value={color} onChange={setColor} />
            </div>
            <div className="scrollbar-thin grid max-h-[45vh] gap-3 overflow-y-auto pr-1">
              {plan.lists.map((list, li) => (
                <section
                  key={li}
                  className={cn(
                    "rounded-[10px] border border-border p-2.5",
                    !kept.lists[li].keep && "opacity-55",
                  )}
                >
                  <label className="flex items-center gap-2 px-1 pb-1.5 text-[13.5px] font-semibold">
                    <input
                      type="checkbox"
                      checked={kept.lists[li].keep}
                      onChange={(e) => setList(li, { keep: e.target.checked })}
                      className="size-4 accent-[var(--accent)]"
                    />
                    {list.name}
                    <span className="tabular font-normal text-subtle">{list.tasks.length}</span>
                  </label>
                  <ul className="grid gap-0.5">
                    {list.tasks.map((t, ti) => (
                      <li key={ti}>
                        <label className="flex min-h-8 items-start gap-2.5 rounded-md px-1 py-1 hover:bg-surface-2">
                          <input
                            type="checkbox"
                            disabled={!kept.lists[li].keep}
                            checked={kept.lists[li].tasks[ti]}
                            onChange={(e) =>
                              setList(li, {
                                tasks: kept.lists[li].tasks.map((v, x) =>
                                  x === ti ? e.target.checked : v,
                                ),
                              })
                            }
                            className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[13.5px]">{t.title}</span>
                            {(t.description || t.subtasks.length > 0) && (
                              <span className="block text-[12px] text-muted">
                                {t.description}
                                {t.subtasks.length > 0 && ` ${pluralize(t.subtasks.length, "subtask")}.`}
                              </span>
                            )}
                          </span>
                          {t.dueInDays !== null && (
                            <span className="tabular shrink-0 text-[12px] text-muted">
                              {formatDue(shiftDate(startDate, t.dueInDays), today)}
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Change the brief
              </Button>
              <Button
                variant="primary"
                disabled={creating || !name.trim() || taskCount === 0}
                onClick={create}
              >
                {creating ? "Creating…" : `Create workspace with ${pluralize(taskCount, "task")}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
