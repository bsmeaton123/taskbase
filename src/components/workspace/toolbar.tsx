"use client";

import {
  CalendarBlankIcon,
  ChartBarHorizontalIcon,
  CopyIcon,
  CopySimpleIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  FadersHorizontalIcon,
  FileArrowUpIcon,
  HeartbeatIcon,
  FlagIcon,
  GearSixIcon,
  KanbanIcon,
  ListBulletsIcon,
  ListChecksIcon,
  PlusIcon,
  PlusSquareIcon,
  RepeatIcon,
  SparkleIcon,
  TrashIcon,
  UserCircleDashedIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp, useTaskNavigation } from "@/components/app-context";
import { DuePicker, PeoplePicker } from "@/components/pickers";
import { RepeatPicker } from "@/components/repeat-picker";
import { DueLabel } from "@/components/task-bits";
import { Avatar, AvatarStack } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { Tag } from "@/components/tags";
import { workspaceSwatch } from "@/lib/colors";
import { describeRecurrence, type Recurrence } from "@/lib/recurrence";
import { cn } from "@/lib/utils";
import { createTask } from "@/server/actions/tasks";
import type { Member } from "@/server/queries";
import { TaskSuggestions } from "@/components/ai/task-suggestions";
import {
  NotesToTasksDialog,
  RisksDialog,
  StatusReportDialog,
} from "@/components/ai/workspace-ai";
import { DuplicateWorkspaceDialog, type DuplicateMode } from "./duplicate-dialog";
import { ImportTasksDialog } from "./import-dialog";
import { useTaskSelection } from "./selection";

export function WorkspaceToolbar({
  workspace,
  view,
  show,
  assignee,
  tag,
  tags,
  members,
  lists,
}: {
  workspace: {
    id: string;
    name: string;
    color: string;
    isTemplate: boolean;
    canManage: boolean;
    /** Its email-in address, when a mailbox is connected. */
    emailAddress: string | null;
  };
  view: "list" | "board" | "gantt";
  show: "open" | "all" | "closed";
  assignee: string;
  tag: string | null;
  tags: (Tag & { count: number })[];
  members: Member[];
  lists: { id: string; name: string }[];
}) {
  const workspaceId = workspace.id;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { viewer, people, ai } = useApp();
  const { activeTaskId } = useTaskNavigation();
  const [creating, setCreating] = useState(false);
  const [copyMode, setCopyMode] = useState<DuplicateMode | null>(null);
  const [importing, setImporting] = useState(false);
  const [aiDialog, setAiDialog] = useState<"notes" | "report" | "risks" | null>(null);
  const selection = useTaskSelection();

  function hrefWith(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  const activeTag = tag ? tags.find((t) => t.id === tag) : undefined;
  const filtered = show !== "open" || assignee !== "anyone" || Boolean(activeTag);
  const assigneeLabel =
    assignee === "anyone"
      ? null
      : assignee === "me"
        ? "Assigned to me"
        : assignee === "unassigned"
          ? "Unassigned"
          : members.find((m) => m.id === assignee)?.name;

  const filterLabel = filtered
    ? [
        show === "all" ? "All tasks" : show === "closed" ? "Completed" : null,
        assigneeLabel,
        activeTag ? `Tag: ${activeTag.name}` : null,
      ]
        .filter(Boolean)
        .join(", ") || "Filter"
    : "Filter";

  return (
    <>
      <nav
        className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-0.5"
        aria-label="View"
      >
        {(
          [
            { key: "list", label: "List", icon: <ListBulletsIcon size={15} /> },
            { key: "board", label: "Board", icon: <KanbanIcon size={15} /> },
            { key: "gantt", label: "Gantt", icon: <ChartBarHorizontalIcon size={15} /> },
          ] as const
        ).map((v) => (
          <Link
            key={v.key}
            href={hrefWith({ view: v.key === "list" ? null : v.key })}
            aria-current={view === v.key ? "page" : undefined}
            aria-label={v.label}
            scroll={false}
            className={cn(
              "inline-flex h-full items-center gap-1.5 rounded-[5px] px-2.5 text-[13px] font-medium",
              view === v.key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
            )}
          >
            {v.icon}
            {/* Labels follow the header's own width: beside the task panel the views are icons. */}
            <span className="hidden @[40rem]:inline">{v.label}</span>
          </Link>
        ))}
      </nav>

      <Menu>
        <MenuTrigger asChild>
          <Button
            size="md"
            variant={filtered ? "secondary" : "ghost"}
            aria-label={filterLabel}
            className={cn(filtered && "text-accent-text")}
          >
            <FadersHorizontalIcon size={15} />
            <span className="hidden @[40rem]:inline">{filterLabel}</span>
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-60">
          <MenuLabel>Show</MenuLabel>
          <MenuRadioGroup
            value={show}
            onValueChange={(v) => router.push(hrefWith({ show: v === "open" ? null : v }), { scroll: false })}
          >
            <MenuRadioItem value="open">Open tasks</MenuRadioItem>
            <MenuRadioItem value="all">All tasks</MenuRadioItem>
            <MenuRadioItem value="closed">Completed tasks</MenuRadioItem>
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuLabel>Assignee</MenuLabel>
          <MenuRadioGroup
            value={assignee}
            onValueChange={(v) =>
              router.push(hrefWith({ assignee: v === "anyone" ? null : v }), { scroll: false })
            }
          >
            <MenuRadioItem value="anyone">Anyone</MenuRadioItem>
            <MenuRadioItem value="me">Me</MenuRadioItem>
            <MenuRadioItem value="unassigned">Unassigned</MenuRadioItem>
            {members
              .filter((m) => m.id !== viewer.id)
              .map((m) => (
                <MenuRadioItem key={m.id} value={m.id}>
                  <Avatar person={m} size="xs" />
                  <span className="truncate">{m.name}</span>
                </MenuRadioItem>
              ))}
          </MenuRadioGroup>
          {tags.length > 0 && (
            <>
              <MenuSeparator />
              <MenuLabel>Tag</MenuLabel>
              <MenuRadioGroup
                value={activeTag?.id ?? "any"}
                onValueChange={(v) =>
                  router.push(hrefWith({ tag: v === "any" ? null : v }), { scroll: false })
                }
              >
                <MenuRadioItem value="any">Any tag</MenuRadioItem>
                {tags.map((t) => (
                  <MenuRadioItem key={t.id} value={t.id}>
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: workspaceSwatch(t.color) }}
                    />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="tabular text-[12px] text-subtle">{t.count}</span>
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </>
          )}
          {filtered && (
            <>
              <MenuSeparator />
              <MenuItem
                onSelect={() =>
                  router.push(hrefWith({ show: null, assignee: null, tag: null }), { scroll: false })
                }
              >
                Clear filters
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>

      <Tooltip content="Settings and members">
        <Link
          href={`/w/${workspaceId}/settings`}
          className={cn(
            "hidden h-8 items-center gap-2 rounded-md px-1.5 text-muted hover:bg-surface-2 hover:text-text",
            // Make room for the task panel on laptop-sized screens.
            activeTaskId ? "2xl:inline-flex" : "md:inline-flex",
          )}
          aria-label="Settings and members"
        >
          <AvatarStack people={members} max={4} size="sm" />
          <GearSixIcon size={16} />
        </Link>
      </Tooltip>

      <Menu>
        <MenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="More workspace options">
            <DotsThreeIcon size={18} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-60">
          {selection && (
            <>
              <MenuItem onSelect={() => (selection.active ? selection.stop() : selection.start())}>
                <ListChecksIcon size={16} />
                {selection.active ? "Stop selecting" : "Select tasks"}
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          {ai && !workspace.isTemplate && (
            <>
              <MenuItem onSelect={() => setAiDialog("notes")}>
                <SparkleIcon size={16} weight="fill" className="!text-accent" />
                Create tasks from notes
              </MenuItem>
              <MenuItem onSelect={() => setAiDialog("report")}>
                <SparkleIcon size={16} weight="fill" className="!text-accent" />
                Write status report
              </MenuItem>
            </>
          )}
          {!workspace.isTemplate && (
            <MenuItem onSelect={() => setAiDialog("risks")}>
              <HeartbeatIcon size={16} />
              Risks and health
            </MenuItem>
          )}
          {!workspace.isTemplate && <MenuSeparator />}
          {workspace.isTemplate && (
            <MenuItem onSelect={() => setCopyMode("use-template")}>
              <PlusSquareIcon size={16} />
              New workspace from this
            </MenuItem>
          )}
          <MenuItem onSelect={() => setCopyMode("duplicate")}>
            <CopyIcon size={16} />
            Duplicate {workspace.isTemplate ? "template" : "workspace"}
          </MenuItem>
          {!workspace.isTemplate && workspace.canManage && (
            <MenuItem onSelect={() => setCopyMode("save-template")}>
              <CopySimpleIcon size={16} />
              Save as template
            </MenuItem>
          )}
          <MenuItem onSelect={() => setImporting(true)}>
            <FileArrowUpIcon size={16} />
            Import tasks from CSV
          </MenuItem>
          {workspace.emailAddress && (
            <MenuItem
              onSelect={async () => {
                try {
                  await navigator.clipboard.writeText(workspace.emailAddress!);
                  toast.success("Email address copied", {
                    description: "Emails sent to it become tasks here.",
                  });
                } catch {
                  router.push(`/w/${workspaceId}/settings`);
                }
              }}
            >
              <EnvelopeSimpleIcon size={16} />
              Copy email address
            </MenuItem>
          )}
          <MenuItem onSelect={() => router.push(`/w/${workspaceId}/trash`)}>
            <TrashIcon size={16} />
            Trash
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => router.push(`/w/${workspaceId}/settings`)}>
            <GearSixIcon size={16} />
            Settings and members
          </MenuItem>
        </MenuContent>
      </Menu>

      <Button
        variant="primary"
        aria-label="New task"
        onClick={() => setCreating(true)}
        disabled={lists.length === 0}
      >
        <PlusIcon size={14} weight="bold" />
        <span className="hidden @[32rem]:inline">New task</span>
      </Button>

      {copyMode && (
        <DuplicateWorkspaceDialog
          open
          onOpenChange={(o) => !o && setCopyMode(null)}
          mode={copyMode}
          source={workspace}
          people={people}
        />
      )}
      {aiDialog === "notes" && (
        <NotesToTasksDialog
          open
          onOpenChange={(o) => !o && setAiDialog(null)}
          workspaceId={workspaceId}
          members={members}
          lists={lists}
        />
      )}
      {aiDialog === "report" && (
        <StatusReportDialog
          open
          onOpenChange={(o) => !o && setAiDialog(null)}
          workspaceId={workspaceId}
          workspaceName={workspace.name}
        />
      )}
      {aiDialog === "risks" && (
        <RisksDialog
          open
          onOpenChange={(o) => !o && setAiDialog(null)}
          workspaceId={workspaceId}
          workspaceName={workspace.name}
        />
      )}
      {importing && (
        <ImportTasksDialog
          open
          onOpenChange={setImporting}
          workspaceId={workspaceId}
          lists={lists}
          members={members}
        />
      )}

      <NewTaskDialog
        open={creating}
        onOpenChange={setCreating}
        workspaceId={workspaceId}
        lists={lists}
        members={members}
      />
    </>
  );
}

function NewTaskDialog({
  open,
  onOpenChange,
  workspaceId,
  lists,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  lists: { id: string; name: string }[];
  members: Member[];
}) {
  const { viewer, today } = useApp();
  const { openTask } = useTaskNavigation();
  const [listId, setListId] = useState<string>(lists[0]?.id ?? "");
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [urgent, setUrgent] = useState(false);
  const [recurrence, setRecurrence] = useState<Recurrence | null>(null);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  // The dialog stays mounted, so a remembered list may since have been deleted.
  const list = lists.find((l) => l.id === listId) ?? lists[0];
  const assignees = assigneeIds
    .map((id) => members.find((m) => m.id === id))
    .filter((m): m is Member => Boolean(m));

  function reset() {
    setAssigneeIds([]);
    setDueDate(null);
    setUrgent(false);
    setRecurrence(null);
    setTitle("");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent title="New task" className="max-w-lg">
        <form method="post"
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              const res = await perform(
                createTask({
                  workspaceId,
                  taskListId: list.id,
                  title,
                  assigneeIds,
                  dueDate,
                  recurrence,
                  urgent,
                  position: "top",
                }),
              );
              if (res.ok) {
                onOpenChange(false);
                reset();
                openTask(res.data.id);
              }
            });
          }}
        >
          <Field label="Title" htmlFor="new-task-title">
            <Input
              id="new-task-title"
              name="title"
              required
              maxLength={300}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
            />
          </Field>
          <TaskSuggestions
            workspaceId={workspaceId}
            title={title}
            onApply={(d) => {
              if (d.taskListId) setListId(d.taskListId);
              if (d.assignees.length) setAssigneeIds(d.assignees.map((a) => a.id));
              if (d.dueDate) setDueDate(d.dueDate);
            }}
          />
          <div className="flex flex-wrap gap-1.5">
            <Menu>
              <MenuTrigger asChild>
                <Button size="sm">
                  <ListBulletsIcon size={14} />
                  {list?.name}
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuRadioGroup value={list?.id} onValueChange={setListId}>
                  {lists.map((l) => (
                    <MenuRadioItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </MenuContent>
            </Menu>
            <PeoplePicker
              people={members}
              selected={new Set(assigneeIds)}
              onToggle={(person, on) =>
                setAssigneeIds((ids) =>
                  on ? [...ids.filter((id) => id !== person.id), person.id] : ids.filter((id) => id !== person.id),
                )
              }
              viewerId={viewer.id}
            >
              <Button size="sm" className="max-w-full">
                {assignees.length === 0 ? (
                  <>
                    <UserCircleDashedIcon size={15} />
                    Assignees
                  </>
                ) : assignees.length === 1 ? (
                  <>
                    <Avatar person={assignees[0]} size="xs" />
                    <span className="truncate">{assignees[0].name}</span>
                  </>
                ) : (
                  <>
                    <AvatarStack people={assignees} max={3} size="xs" ring="ring-surface" />
                    {assignees.length} people
                  </>
                )}
              </Button>
            </PeoplePicker>
            <DuePicker value={dueDate} today={today} onChange={setDueDate}>
              <Button size="sm">
                <CalendarBlankIcon size={14} />
                {dueDate ? <DueLabel dueDate={dueDate} today={today} className="text-[13px]" /> : "Due date"}
              </Button>
            </DuePicker>
            <RepeatPicker
              value={recurrence}
              anchor={dueDate ?? today}
              hasDue={Boolean(dueDate)}
              onChange={setRecurrence}
            >
              <Button size="sm" className={cn(recurrence && "text-accent-text")}>
                <RepeatIcon size={14} />
                {recurrence ? describeRecurrence(recurrence, dueDate) : "Repeat"}
              </Button>
            </RepeatPicker>
            <Button
              size="sm"
              aria-pressed={urgent}
              onClick={() => setUrgent((u) => !u)}
              className={cn(urgent && "border-danger/40 text-danger-text")}
            >
              <FlagIcon size={14} weight={urgent ? "fill" : "regular"} />
              Urgent
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                onOpenChange(false);
                reset();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Creating…" : "Create task"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
