"use client";

import { XIcon } from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { ColorSwatches } from "@/components/color-swatches";
import { PersonPicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { cn, pluralize } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import { duplicateWorkspace } from "@/server/actions/templates";

export type DuplicateMode = "duplicate" | "save-template" | "use-template";

type Person = { id: string; name: string; email: string; image: string | null };

const COPY: Record<DuplicateMode, { title: string; description: string; submit: string; pending: string }> = {
  duplicate: {
    title: "Duplicate workspace",
    description: "Copies lists, tasks and subtasks. Comments, files and history stay with the original.",
    submit: "Duplicate",
    pending: "Duplicating…",
  },
  "save-template": {
    title: "Save as template",
    description: "Anyone can start a new workspace from a template. Your workspace isn't changed.",
    submit: "Save template",
    pending: "Saving…",
  },
  "use-template": {
    title: "New workspace from template",
    description: "Starts a fresh workspace with the template's lists, tasks and subtasks.",
    submit: "Create workspace",
    pending: "Creating…",
  },
};

function Check({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex items-start gap-2.5", disabled && "opacity-50")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span className="grid gap-0.5">
        <span className="text-[13.5px]">{label}</span>
        {hint && <span className="text-[12.5px] text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function DuplicateWorkspaceDialog({
  open,
  onOpenChange,
  mode,
  source,
  people,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: DuplicateMode;
  source: { id: string; name: string; color: string };
  people: Person[];
}) {
  const router = useRouter();
  const { viewer, today } = useApp();
  const isTemplateUse = mode === "use-template";
  const [color, setColor] = useState<string>(source.color);
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeSubtasks, setIncludeSubtasks] = useState(true);
  const [includeCompleted, setIncludeCompleted] = useState(false);
  const [keepAssignees, setKeepAssignees] = useState(mode === "duplicate");
  const [resetProgress, setResetProgress] = useState(mode !== "duplicate");
  const [copyMembers, setCopyMembers] = useState(mode === "duplicate");
  const [dateMode, setDateMode] = useState<"keep" | "clear" | "shift">(
    isTemplateUse ? "shift" : "keep",
  );
  const [startOn, setStartOn] = useState(today);
  const [members, setMembers] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const copy = COPY[mode];

  const defaultName =
    mode === "duplicate"
      ? `${source.name} (copy)`
      : mode === "save-template"
        ? `${source.name} template`
        : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={copy.title} description={copy.description} className="max-w-lg">
        <form method="post"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const name = String(new FormData(e.currentTarget).get("name") ?? "");
            startTransition(async () => {
              const res = await perform(
                duplicateWorkspace({
                  sourceId: source.id,
                  name,
                  color,
                  asTemplate: mode === "save-template",
                  includeTasks,
                  includeSubtasks,
                  includeCompleted,
                  keepAssignees,
                  resetProgress,
                  dates: dateMode === "shift" ? { mode: "shift", startOn } : { mode: dateMode },
                  copyMembers: !isTemplateUse && copyMembers,
                  memberIds: isTemplateUse ? members : undefined,
                }),
              );
              if (res.ok) {
                toast.success(
                  mode === "save-template"
                    ? `Template saved with ${pluralize(res.data.tasks, "task")}`
                    : `Workspace created with ${pluralize(res.data.tasks, "task")}`,
                );
                onOpenChange(false);
                router.push(`/w/${res.data.id}`);
              }
            });
          }}
        >
          <Field label={mode === "save-template" ? "Template name" : "Workspace name"} htmlFor="dup-name">
            <Input
              id="dup-name"
              name="name"
              required
              maxLength={80}
              autoFocus
              defaultValue={defaultName}
              placeholder={isTemplateUse ? "Name the new workspace" : undefined}
            />
          </Field>

          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Colour</span>
            <ColorSwatches value={color} onChange={setColor} />
          </div>

          <fieldset className="grid gap-2.5 rounded-[10px] border border-border p-3">
            <legend className="px-1 text-[12.5px] font-medium text-muted">What to copy</legend>
            <Check checked={includeTasks} onChange={setIncludeTasks} label="Tasks" hint="Task lists are always copied." />
            <Check
              checked={includeSubtasks}
              onChange={setIncludeSubtasks}
              label="Subtasks"
              disabled={!includeTasks}
            />
            {!isTemplateUse && (
              <Check
                checked={includeCompleted}
                onChange={setIncludeCompleted}
                label="Completed tasks"
                disabled={!includeTasks}
              />
            )}
            <Check
              checked={resetProgress}
              onChange={setResetProgress}
              label="Start fresh"
              hint="Reopen tasks and uncheck subtasks."
              disabled={!includeTasks}
            />
            <Check
              checked={keepAssignees}
              onChange={setKeepAssignees}
              label="Keep assignees"
              hint={
                isTemplateUse
                  ? "Only people who are members of the new workspace stay assigned."
                  : undefined
              }
              disabled={!includeTasks}
            />
            {mode === "duplicate" && (
              <Check checked={copyMembers} onChange={setCopyMembers} label="Members" hint="Add the same people to the copy." />
            )}
          </fieldset>

          <div className="grid gap-1.5">
            <span id="dup-dates" className="text-[13px] font-medium">
              Due dates
            </span>
            <div
              className="inline-flex w-fit rounded-md bg-surface-2 p-0.5"
              role="radiogroup"
              onKeyDown={radioGroupKeys}
              aria-labelledby="dup-dates"
            >
              {(
                [
                  ["keep", "Keep"],
                  ["shift", "Shift to start on…"],
                  ["clear", "Remove"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={dateMode === value}
                  tabIndex={dateMode === value ? 0 : -1}
                  onClick={() => setDateMode(value)}
                  disabled={!includeTasks}
                  className={cn(
                    "h-7 rounded-[5px] px-2.5 text-[13px] font-medium disabled:opacity-50",
                    dateMode === value ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {dateMode === "shift" && includeTasks && (
              <label className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
                The earliest due date lands on
                <Input
                  type="date"
                  value={startOn}
                  onChange={(e) => e.target.value && setStartOn(e.target.value)}
                  className="tabular h-8 w-auto px-2 text-[13px]"
                />
              </label>
            )}
          </div>

          {isTemplateUse && (
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
                <PersonPicker
                  allowNone={false}
                  people={people.filter((p) => p.id !== viewer.id && !members.includes(p.id))}
                  value={null}
                  onChange={(id) => id && setMembers((m) => [...m, id])}
                >
                  <Button size="sm" variant="ghost">
                    Add people
                  </Button>
                </PersonPicker>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? copy.pending : copy.submit}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
