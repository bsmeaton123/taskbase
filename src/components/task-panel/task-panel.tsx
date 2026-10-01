"use client";

import {
  ArrowsLeftRightIcon,
  BellIcon,
  BellSlashIcon,
  CalendarBlankIcon,
  CalendarDotsIcon,
  CaretDownIcon,
  CopyIcon,
  DotsThreeIcon,
  FlagIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  RepeatIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp, useTaskNavigation } from "@/components/app-context";
import { ThreadSummary } from "@/components/ai/task-ai";
import { FileDropZone, TaskFiles, useTaskUploads } from "@/components/attachments";
import { MoveToWorkspaceDialog } from "@/components/move-to-workspace-dialog";
import { RepeatPicker } from "@/components/repeat-picker";
import { announceNext } from "@/components/task-row";
import { DuePicker } from "@/components/pickers";
import { DueLabel, StatusIcon, TaskCheck, WorkspaceMark } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea } from "@/components/ui/input";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import type { TaskStatus } from "@/db/schema";
import { formatDue, formatTimestamp, timeAgo } from "@/lib/dates";
import { describeRecurrence, type Recurrence } from "@/lib/recurrence";
import { isClosed, STATUS_META, STATUS_ORDER } from "@/lib/status";
import { TRASH_DAYS } from "@/lib/trash";
import { cn } from "@/lib/utils";
import { addComment } from "@/server/actions/comments";
import { restoreTasks } from "@/server/actions/trash";
import {
  deleteTask,
  markTaskNotificationsRead,
  setFollowing,
  updateTask,
} from "@/server/actions/tasks";
import {
  duplicateTask,
  moveTaskToWorkspace,
} from "@/server/actions/templates";
import type { TaskDetail } from "@/server/queries";
import { CommentComposer } from "./composer";
import { DependencyRows } from "./dependencies";
import { TaskAssigneesRow } from "./task-assignees";
import { TaskTagsRow } from "./task-tags";
import { Feed } from "./feed";
import { Subtasks } from "./subtasks";

type Editable = {
  title: string;
  description: string;
  status: TaskStatus;
  urgent: boolean;
  startDate: string | null;
  dueDate: string | null;
  recurrence: Recurrence | null;
  taskListId: string;
};

export function TaskPanel({ detail }: { detail: TaskDetail }) {
  const { today } = useApp();
  const router = useRouter();
  const { hrefFor, openTask } = useTaskNavigation();
  const { task } = detail;
  const [, startTransition] = useTransition();

  const [state, applyPatch] = useOptimistic<Editable, Partial<Editable>>(
    {
      title: task.title,
      description: task.description,
      status: task.status,
      urgent: task.urgent,
      startDate: task.startDate,
      dueDate: task.dueDate,
      recurrence: task.recurrence,
      taskListId: task.taskListId,
    },
    (s, patch) => ({ ...s, ...patch }),
  );
  const [following, setFollowingOptimistic] = useOptimistic(detail.following);
  const { upload } = useTaskUploads(task.id);

  function update(patch: Partial<Editable>) {
    startTransition(async () => {
      applyPatch(patch);
      const res = await perform(updateTask({ id: task.id, ...patch }));
      if (res.ok && res.data?.next) announceNext(res.data.next, today, openTask);
    });
  }

  // Opening a task clears its inbox items.
  useEffect(() => {
    markTaskNotificationsRead(task.id)
      .then((res) => {
        if (res.ok && res.data.count > 0) router.refresh();
      })
      .catch(() => {}); // Best effort: they clear next time the task is opened.
  }, [task.id, router]);

  const list = detail.lists.find((l) => l.id === state.taskListId) ?? detail.list;
  const closeHref = hrefFor(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border pl-4 pr-2 sm:pl-6">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-muted">
          <Link
            href={`/w/${detail.workspace.id}`}
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md hover:text-text"
          >
            <WorkspaceMark color={detail.workspace.color} />
            <span className="truncate">{detail.workspace.name}</span>
          </Link>
          <span className="text-subtle" aria-hidden>
            /
          </span>
          <Menu>
            <MenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-1 rounded-md px-1 hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2 data-[state=open]:text-text"
                aria-label={`${list.name}: move to another task list`}
              >
                <span className="truncate">{list.name}</span>
                <CaretDownIcon size={11} weight="bold" className="shrink-0" />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuRadioGroup
                value={state.taskListId}
                onValueChange={(taskListId) => update({ taskListId })}
              >
                {detail.lists.map((l) => (
                  <MenuRadioItem key={l.id} value={l.id}>
                    <ListBulletsIcon size={16} />
                    {l.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
          <span className="ml-1 shrink-0 font-mono text-[11.5px] text-subtle">#{task.number}</span>
        </div>

        <Tooltip content={following ? "Stop following" : "Follow for updates"}>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-pressed={following}
            aria-label="Follow this task"
            onClick={() =>
              startTransition(async () => {
                setFollowingOptimistic(!following);
                await perform(setFollowing(task.id, !following), {
                  success: following
                    ? "You won't get updates on this task"
                    : "You'll get updates on this task",
                });
              })
            }
            className={cn(following && "text-accent-text")}
          >
            {following ? <BellIcon size={16} weight="fill" /> : <BellSlashIcon size={16} />}
          </Button>
        </Tooltip>
        <Tooltip content="Copy link">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Copy link to task"
            onClick={async () => {
              // The clipboard API is missing on plain-HTTP origins and can be refused.
              try {
                await navigator.clipboard.writeText(`${window.location.origin}/t/${task.number}`);
                toast.success("Link copied");
              } catch {
                toast.error("Couldn't copy the link. Copy it from the address bar instead.");
              }
            }}
          >
            <LinkSimpleIcon size={16} />
          </Button>
        </Tooltip>
        <TaskMenu
          taskId={task.id}
          title={state.title}
          closeHref={closeHref}
          workspaceId={detail.workspace.id}
        />
        <Tooltip content="Close (Esc)">
          <Button size="icon-sm" variant="ghost" asChild aria-label="Close task">
            <Link href={closeHref} scroll={false}>
              <XIcon size={16} />
            </Link>
          </Button>
        </Tooltip>
      </div>

      {/* Body */}
      <FileDropZone onFiles={(files) => upload(files)} className="flex min-h-0 flex-1 flex-col">
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
          <div className="px-4 pb-4 pt-5 sm:px-6">
            <div className="flex items-start gap-3">
              <div className="pt-[5px]">
                <TaskCheck
                  size="lg"
                  title={state.title}
                  status={state.status}
                  onToggle={() => update({ status: isClosed(state.status) ? "open" : "resolved" })}
                />
              </div>
              <TitleEditor
                key={task.id}
                value={state.title}
                closed={isClosed(state.status)}
                onSave={(title) => update({ title })}
              />
            </div>

            <dl className="mt-4 grid grid-cols-[108px_1fr] items-center gap-x-3 gap-y-1 text-[13px]">
              <dt className="text-muted">Status</dt>
              <dd>
                <Menu>
                  <MenuTrigger asChild>
                    <PropertyButton label="Status">
                      <StatusIcon status={state.status} size={15} />
                      {STATUS_META[state.status].label}
                    </PropertyButton>
                  </MenuTrigger>
                  <MenuContent>
                    <MenuRadioGroup
                      value={state.status}
                      onValueChange={(v) => update({ status: v as TaskStatus })}
                    >
                      {STATUS_ORDER.map((s) => (
                        <MenuRadioItem key={s} value={s}>
                          <StatusIcon status={s} size={15} />
                          {STATUS_META[s].label}
                        </MenuRadioItem>
                      ))}
                    </MenuRadioGroup>
                  </MenuContent>
                </Menu>
              </dd>

              <TaskAssigneesRow
                key={`assignees-${task.id}`}
                taskId={task.id}
                assignees={detail.assignees}
                members={detail.members}
              />

              <dt className="text-muted">Start date</dt>
              <dd>
                <DuePicker
                  value={state.startDate}
                  today={today}
                  kind="start date"
                  onChange={(startDate) => update({ startDate })}
                >
                  <PropertyButton label="Start date">
                    <CalendarDotsIcon size={15} className="text-subtle" />
                    {state.startDate ? (
                      <span className="tabular">{formatDue(state.startDate, today)}</span>
                    ) : (
                      <span className="text-subtle">No start date</span>
                    )}
                  </PropertyButton>
                </DuePicker>
              </dd>

              <dt className="text-muted">Due date</dt>
              <dd>
                <DuePicker value={state.dueDate} today={today} onChange={(dueDate) => update({ dueDate })}>
                  <PropertyButton label="Due date">
                    <CalendarBlankIcon size={15} className="text-subtle" />
                    {state.dueDate ? (
                      <DueLabel
                        dueDate={state.dueDate}
                        today={today}
                        closed={isClosed(state.status)}
                        className="text-[13px]"
                      />
                    ) : (
                      <span className="text-subtle">No due date</span>
                    )}
                  </PropertyButton>
                </DuePicker>
              </dd>

              <dt className="text-muted">Repeats</dt>
              <dd>
                <RepeatPicker
                  value={state.recurrence}
                  anchor={state.dueDate ?? today}
                  hasDue={Boolean(state.dueDate)}
                  onChange={(recurrence) => update({ recurrence })}
                >
                  <PropertyButton label="Repeats">
                    <RepeatIcon size={15} className="text-subtle" />
                    {state.recurrence ? (
                      <span>{describeRecurrence(state.recurrence, state.dueDate)}</span>
                    ) : (
                      <span className="text-subtle">Doesn&apos;t repeat</span>
                    )}
                  </PropertyButton>
                </RepeatPicker>
              </dd>

              <dt className="text-muted">Priority</dt>
              <dd>
                <Tooltip content={state.urgent ? "Mark as normal priority" : "Mark as urgent"}>
                  <PropertyButton label="Priority" onClick={() => update({ urgent: !state.urgent })}>
                    <FlagIcon
                      size={15}
                      weight={state.urgent ? "fill" : "regular"}
                      className={state.urgent ? "text-danger-text" : "text-subtle"}
                    />
                    {state.urgent ? (
                      <span className="font-medium text-danger-text">Urgent</span>
                    ) : (
                      <span className="text-subtle">Normal</span>
                    )}
                  </PropertyButton>
                </Tooltip>
              </dd>

              <TaskTagsRow
                key={`tags-${task.id}`}
                taskId={task.id}
                tags={detail.tags}
                workspaceTags={detail.workspaceTags}
              />

              <DependencyRows
                taskId={task.id}
                workspaceId={detail.workspace.id}
                blockedBy={detail.blockedBy}
                blocking={detail.blocking}
              />

              <dt className="text-muted">Created</dt>
              <dd
                className="tabular px-2 text-muted"
                title={formatTimestamp(task.createdAt)}
                suppressHydrationWarning
              >
                {timeAgo(task.createdAt)}
                {detail.creatorName ? ` by ${detail.creatorName}` : ""}
              </dd>
            </dl>

            <DescriptionEditor
              key={`d-${task.id}`}
              value={state.description}
              onSave={(description) => update({ description })}
            />

            <Subtasks taskId={task.id} subtasks={detail.subtasks} members={detail.members} />

            <TaskFiles taskId={task.id} files={detail.files} canManage={detail.access.canManage} />
          </div>

          <div className="border-t border-border" />
          <ThreadSummary
            taskId={task.id}
            worthIt={detail.commentCount >= 2 || detail.feed.length >= 6}
          />
          <Feed items={detail.feed} people={detail.members} />
        </div>
      </FileDropZone>

      <CommentComposer
        taskId={task.id}
        people={detail.members}
        onSubmit={async (body, files) => (await perform(addComment(task.id, body, files))).ok}
      />
    </div>
  );
}

/**
 * The value in a property row. `label` repeats the row's name for screen readers, so the
 * button reads "Due date: Tomorrow" rather than just "Tomorrow". Long values wrap.
 */
function PropertyButton({
  label,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex min-h-8 max-w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[13px] text-text hover:bg-surface-2 data-[state=open]:bg-surface-2 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    >
      <span className="sr-only">{label}: </span>
      {children}
    </button>
  );
}

function TitleEditor({
  value,
  closed,
  onSave,
}: {
  value: string;
  closed: boolean;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [prev, setPrev] = useState(value);
  if (value !== prev && !focused) {
    setPrev(value);
    setDraft(value);
  }

  return (
    <AutoTextarea
      bare
      value={draft}
      aria-label="Task title"
      maxLength={300}
      onChange={(e) => setDraft(e.target.value.replace(/\n/g, ""))}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const title = draft.trim();
        if (!title) setDraft(value);
        else if (title !== value) onSave(title);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          e.stopPropagation();
          setDraft(value);
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur());
        }
      }}
      // Already above 16px, so phones keep the headline size (see globals.css).
      data-keep-size
      className={cn(
        // Same hover and focus treatment as the description below.
        "-mx-1.5 rounded-md px-1.5 text-[20px] font-semibold leading-snug tracking-tight hover:bg-surface-2/70 focus:bg-surface focus:ring-1 focus:ring-border-strong",
        closed && "text-muted",
      )}
    />
  );
}

function DescriptionEditor({
  value,
  onSave,
}: {
  value: string;
  onSave: (description: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [prev, setPrev] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  if (value !== prev && !focused) {
    setPrev(value);
    setDraft(value);
  }

  return (
    <div className="mt-5">
      <h3 className="mb-1 text-[13px] font-semibold">Description</h3>
      <div
        className={cn(
          "-mx-2 rounded-md px-2 py-1.5 transition-colors",
          focused ? "bg-surface ring-1 ring-border-strong" : "hover:bg-surface-2/70",
        )}
        onClick={() => ref.current?.focus()}
      >
        <AutoTextarea
          ref={ref}
          bare
          value={draft}
          minRows={2}
          maxLength={20000}
          aria-label="Task description"
          placeholder="Add details, links or acceptance criteria…"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft !== value) onSave(draft);
          }}
          onKeyDown={(e) => {
            // Escape keeps what was typed (blur saves it): losing a long description by
            // reflex would be worse than an edit the person then undoes.
            if (e.key === "Escape") {
              e.stopPropagation();
              e.currentTarget.blur();
            }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.blur();
          }}
          className="text-[14px] leading-relaxed"
        />
      </div>
    </div>
  );
}

function TaskMenu({
  taskId,
  title,
  closeHref,
  workspaceId,
}: {
  taskId: string;
  title: string;
  closeHref: string;
  workspaceId: string;
}) {
  const router = useRouter();
  const { openTask } = useTaskNavigation();
  const [confirming, setConfirming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button size="icon-sm" variant="ghost" aria-label="More task options">
            <DotsThreeIcon size={18} weight="bold" />
          </Button>
        </MenuTrigger>
        <MenuContent align="end" className="w-60">
          <MenuItem
            onSelect={async () => {
              const res = await perform(duplicateTask(taskId), { success: "Task duplicated" });
              if (res.ok) openTask(res.data.id);
            }}
          >
            <CopyIcon size={16} />
            Duplicate task
          </MenuItem>
          <MenuItem onSelect={() => setMoving(true)}>
            <ArrowsLeftRightIcon size={16} />
            Move to another workspace
          </MenuItem>
          <MenuSeparator />
          <MenuItem danger onSelect={() => setConfirming(true)}>
            <TrashIcon size={16} />
            Delete task
          </MenuItem>
        </MenuContent>
      </Menu>
      {moving && (
        <MoveTaskDialog
          taskId={taskId}
          currentWorkspaceId={workspaceId}
          onClose={() => setMoving(false)}
        />
      )}
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent
          title="Delete this task?"
          description={`“${title}” goes to the workspace's trash with its subtasks, comments and files. You can restore it for ${TRASH_DAYS} days.`}
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const res = await perform(deleteTask(taskId));
                  if (res.ok) {
                    setConfirming(false);
                    router.push(closeHref, { scroll: false });
                    toast.success("Task moved to the trash", {
                      action: {
                        label: "Undo",
                        onClick: () =>
                          void perform(restoreTasks(res.data.trashIds), { success: "Task restored" }),
                      },
                    });
                  }
                })
              }
            >
              {pending ? "Deleting…" : "Delete task"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function MoveTaskDialog({
  taskId,
  currentWorkspaceId,
  onClose,
}: {
  taskId: string;
  currentWorkspaceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  return (
    <MoveToWorkspaceDialog
      currentWorkspaceId={currentWorkspaceId}
      title="Move to another workspace"
      description="The task keeps its subtasks, comments and files. People who aren't members there are unassigned."
      submitLabel="Move task"
      onClose={onClose}
      onMove={async (workspaceId, taskListId) => {
        const res = await perform(moveTaskToWorkspace({ taskId, workspaceId, taskListId }), {
          success: "Task moved",
        });
        if (res.ok) router.push(`/w/${res.data.workspaceId}?task=${taskId}`, { scroll: false });
        return res.ok;
      }}
    />
  );
}
