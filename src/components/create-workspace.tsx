"use client";

import { SparkleIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea, Field, Input } from "@/components/ui/input";
import { PersonPicker } from "@/components/pickers";
import { WorkspaceMark } from "@/components/task-bits";
import { DuplicateWorkspaceDialog } from "@/components/workspace/duplicate-dialog";
import { PlanWorkspaceDialog } from "@/components/ai/plan-workspace";
import { ColorSwatches } from "@/components/color-swatches";
import { createWorkspace } from "@/server/actions/workspaces";
import type { TemplateSummary } from "@/server/queries";

type Person = { id: string; name: string; email: string; image: string | null };

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  people,
  templates = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: Person[];
  templates?: TemplateSummary[];
}) {
  const [template, setTemplate] = useState<TemplateSummary | null>(null);
  const [planning, setPlanning] = useState(false);
  const router = useRouter();
  const { viewer, ai } = useApp();
  const [color, setColor] = useState<string>("blue");
  const [members, setMembers] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  const available = people.filter((p) => p.id !== viewer.id && !members.includes(p.id));

  function reset() {
    setColor("blue");
    setMembers([]);
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) reset();
        }}
      >
        <DialogContent
          title="New workspace"
          description="A workspace holds a project's task lists, tasks and conversations."
        >
          {ai && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                setPlanning(true);
              }}
              className="mb-4 flex w-full items-center gap-3 rounded-[10px] border border-accent/25 bg-accent-soft/35 px-3 py-2.5 text-left hover:border-accent/50"
            >
              <SparkleIcon size={18} weight="fill" className="shrink-0 text-accent" />
              <span className="grid">
                <span className="text-[13.5px] font-medium">Plan it with AI</span>
                <span className="text-[12.5px] text-muted">
                  Describe the project and get lists, tasks and dates to review.
                </span>
              </span>
            </button>
          )}
          {templates.length > 0 && (
            <div className="mb-4 grid gap-1.5">
              <span className="text-[13px] font-medium">Start from a template</span>
              <div className="scrollbar-thin -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {templates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      setTemplate(t);
                    }}
                    className="flex h-9 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-[13px] hover:border-accent hover:bg-accent-soft/40"
                  >
                    <WorkspaceMark color={t.color} />
                    <span className="max-w-40 truncate">{t.name}</span>
                    <span className="tabular text-[12px] text-subtle">{t.taskCount}</span>
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-subtle">Or start blank below.</span>
            </div>
          )}
          <form method="post"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              startTransition(async () => {
                const res = await perform(
                  createWorkspace({
                    name: String(form.get("name") ?? ""),
                    description: String(form.get("description") ?? ""),
                    color,
                    memberIds: members,
                  }),
                );
                if (res.ok) {
                  onOpenChange(false);
                  reset();
                  router.push(`/w/${res.data.id}`);
                }
              });
            }}
          >
            <Field label="Name" htmlFor="new-ws-name">
              <Input
                id="new-ws-name"
                name="name"
                required
                maxLength={80}
                autoFocus
                placeholder="e.g. Website relaunch"
              />
            </Field>
            <Field label="Description" htmlFor="new-ws-description" hint="Optional. What is this workspace for?">
              <AutoTextarea id="new-ws-description" name="description" maxLength={500} minRows={2} />
            </Field>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Colour</span>
              <ColorSwatches value={color} onChange={setColor} />
            </div>
            <div className="grid gap-1.5">
              <span className="text-[13px] font-medium">Members</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-[12.5px]">
                  <Avatar person={viewer} size="sm" />
                  You
                </span>
                {members.map((id) => {
                  const p = people.find((x) => x.id === id);
                  if (!p) return null;
                  return (
                    <span
                      key={id}
                      className="inline-flex h-7 items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-1 text-[12.5px]"
                    >
                      <Avatar person={p} size="sm" />
                      {p.name}
                      <button
                        type="button"
                        onClick={() => setMembers((m) => m.filter((x) => x !== id))}
                        className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-text"
                        aria-label={`Remove ${p.name}`}
                      >
                        <XIcon size={11} weight="bold" />
                      </button>
                    </span>
                  );
                })}
                {available.length > 0 && (
                  <PersonPicker
                    allowNone={false}
                    people={available}
                    value={null}
                    onChange={(id) => id && setMembers((m) => [...m, id])}
                  >
                    <Button size="sm" variant="ghost">
                      Add people
                    </Button>
                  </PersonPicker>
                )}
              </div>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending}>
                {pending ? "Creating…" : "Create workspace"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {planning && <PlanWorkspaceDialog open onOpenChange={setPlanning} />}
      {template && (
        <DuplicateWorkspaceDialog
          open
          onOpenChange={(o) => !o && setTemplate(null)}
          mode="use-template"
          source={template}
          people={people}
        />
      )}
    </>
  );
}
