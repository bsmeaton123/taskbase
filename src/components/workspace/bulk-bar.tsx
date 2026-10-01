"use client";

import {
  ArrowsLeftRightIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  CircleIcon,
  TagIcon,
  TrashIcon,
  UserCircleIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { MoveToWorkspaceDialog } from "@/components/move-to-workspace-dialog";
import { DuePicker, PeoplePicker } from "@/components/pickers";
import { TagPicker, type Tag } from "@/components/tags";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import type { TaskStatus } from "@/db/schema";
import { formatDue } from "@/lib/dates";
import { isClosed } from "@/lib/status";
import { TRASH_DAYS } from "@/lib/trash";
import { pluralize } from "@/lib/utils";
import {
  bulkDeleteTasks,
  bulkMoveToWorkspace,
  bulkSetAssignee,
  bulkSetTag,
  bulkUpdateTasks,
} from "@/server/actions/bulk";
import { createTag } from "@/server/actions/tags";
import { restoreTasks } from "@/server/actions/trash";
import type { Member, TaskSummary } from "@/server/queries";
import { useTaskSelection } from "./selection";

/** Floating toolbar for changing the selected tasks together. */
export function BulkActionBar({
  workspaceId,
  lists,
  members,
  tasks,
  tags,
}: {
  workspaceId: string;
  lists: { id: string; name: string }[];
  members: Member[];
  tasks: TaskSummary[];
  tags: Tag[];
}) {
  const selection = useTaskSelection();
  const router = useRouter();
  const { viewer, today } = useApp();
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);
  const active = Boolean(selection?.active);

  useEffect(() => {
    if (!active) return;
    document.documentElement.dataset.bulkBar = "";
    return () => {
      delete document.documentElement.dataset.bulkBar;
    };
  }, [active]);

  if (!selection?.active) return null;
  const ids = [...selection.selected];
  const n = ids.length;
  const chosen = tasks.filter((t) => selection.selected.has(t.id));
  const allClosed = chosen.length > 0 && chosen.every((t) => isClosed(t.status));
  const allSelected = n > 0 && n === selection.visible.length;
  const label = pluralize(n, "task");

  function apply(
    change: Omit<Parameters<typeof bulkUpdateTasks>[0], "ids">,
    success: string,
    undo?: () => void,
  ) {
    startTransition(async () => {
      const res = await perform(bulkUpdateTasks({ ids, ...change }));
      if (!res.ok) return;
      toast.success(success, undo ? { action: { label: "Undo", onClick: undo } } : undefined);
    });
  }

  // Tags every selected task has (shown ticked in the picker).
  const common = new Set(
    tags
      .filter((t) => chosen.length > 0 && chosen.every((c) => c.tags.some((x) => x.id === t.id)))
      .map((t) => t.id),
  );

  function setTag(tag: Tag, on: boolean) {
    startTransition(async () => {
      const res = await perform(bulkSetTag({ ids, tagId: tag.id, on }));
      if (res.ok)
        toast.success(on ? `Tagged ${label} “${tag.name}”` : `Removed “${tag.name}” from ${label}`);
    });
  }

  // People on every selected task (shown ticked). Ticking adds someone to all of them,
  // unticking takes them off all of them.
  const commonAssignees = new Set(
    members
      .filter((m) => chosen.length > 0 && chosen.every((c) => c.assignees.some((a) => a.id === m.id)))
      .map((m) => m.id),
  );

  function setAssignee(person: { id: string; name: string }, on: boolean) {
    const who = person.id === viewer.id ? "you" : person.name;
    startTransition(async () => {
      const res = await perform(bulkSetAssignee({ ids, userId: person.id, on }));
      if (res.ok) toast.success(on ? `Assigned ${label} to ${who}` : `Unassigned ${who} from ${label}`);
    });
  }

  function createAndTag(name: string) {
    startTransition(async () => {
      const created = await perform(createTag({ workspaceId, name }));
      if (!created.ok) return;
      const res = await perform(bulkSetTag({ ids, tagId: created.data.id, on: true }));
      if (res.ok) toast.success(`Tagged ${label} “${created.data.name}”`);
    });
  }

  function complete() {
    const next: TaskStatus = allClosed ? "open" : "resolved";
    // Remember each task's status so Undo puts every one back as it was.
    const before = new Map<TaskStatus, string[]>();
    for (const t of chosen) before.set(t.status, [...(before.get(t.status) ?? []), t.id]);
    apply(
      { status: next },
      allClosed ? `Reopened ${label}` : `Completed ${label}`,
      () => {
        for (const [status, group] of before)
          perform(bulkUpdateTasks({ ids: group, status }));
      },
    );
  }

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-3">
        <div
          role="toolbar"
          aria-label="Selected tasks"
          className="scrollbar-thin pointer-events-auto flex max-w-full items-center gap-1 overflow-x-auto rounded-[10px] border border-border bg-surface p-1.5 shadow-pop animate-fade-in"
        >
          <span className="tabular whitespace-nowrap px-2 text-[13px] font-medium" aria-live="polite">
            {n === 0 ? "Select tasks" : `${n} selected`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              allSelected
                ? selection.setMany(selection.visible, false)
                : selection.setMany(selection.visible, true)
            }
            disabled={selection.visible.length === 0}
          >
            {allSelected ? "Select none" : "Select all"}
          </Button>
          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />

          <Tooltip content={allClosed ? "Reopen" : "Complete"}>
            <Button
              aria-label={allClosed ? "Reopen" : "Complete"}
              size="sm"
              variant="ghost"
              disabled={!n || pending}
              onClick={complete}
            >
              {allClosed ? <CircleIcon size={15} /> : <CheckCircleIcon size={15} />}
              <span className="hidden md:inline">{allClosed ? "Reopen" : "Complete"}</span>
            </Button>
          </Tooltip>

          <PeoplePicker
            people={members}
            selected={commonAssignees}
            onToggle={setAssignee}
            viewerId={viewer.id}
            label="Assign selected tasks"
          >
            <Tooltip content="Assign">
              <Button aria-label="Assign" size="sm" variant="ghost" disabled={!n || pending}>
                <UserCircleIcon size={15} />
                <span className="hidden md:inline">Assign</span>
              </Button>
            </Tooltip>
          </PeoplePicker>

          <DuePicker
            value={null}
            today={today}
            allowClear
            onChange={(dueDate) =>
              apply(
                { dueDate },
                dueDate ? `Set ${label} due ${formatDue(dueDate, today)}` : `Removed due dates from ${label}`,
              )
            }
          >
            <Tooltip content="Due date">
              <Button aria-label="Due date" size="sm" variant="ghost" disabled={!n || pending}>
                <CalendarBlankIcon size={15} />
                <span className="hidden md:inline">Due date</span>
              </Button>
            </Tooltip>
          </DuePicker>

          <TagPicker tags={tags} selected={common} onToggle={setTag} onCreate={createAndTag}>
            <Tooltip content="Tag">
              <Button aria-label="Tag" size="sm" variant="ghost" disabled={!n || pending}>
                <TagIcon size={15} />
                <span className="hidden md:inline">Tag</span>
              </Button>
            </Tooltip>
          </TagPicker>

          <Menu>
            <MenuTrigger asChild>
              <Tooltip content="Move">
                <Button aria-label="Move" size="sm" variant="ghost" disabled={!n || pending}>
                  <ArrowsLeftRightIcon size={15} />
                  <span className="hidden md:inline">Move</span>
                </Button>
              </Tooltip>
            </MenuTrigger>
            <MenuContent align="center" side="top" className="w-56">
              <MenuLabel>Move to list</MenuLabel>
              {lists.map((l) => (
                <MenuItem
                  key={l.id}
                  onSelect={() => apply({ taskListId: l.id }, `Moved ${label} to ${l.name}`)}
                >
                  {l.name}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onSelect={() => setMoving(true)}>Another workspace…</MenuItem>
            </MenuContent>
          </Menu>

          <Tooltip content="Delete">
            <Button
              aria-label="Delete"
              size="sm"
              variant="danger-ghost"
              disabled={!n || pending}
              onClick={() => setConfirmDelete(true)}
            >
              <TrashIcon size={15} />
              <span className="hidden md:inline">Delete</span>
            </Button>
          </Tooltip>

          <span className="mx-0.5 h-5 w-px shrink-0 bg-border" />
          <Button size="icon-sm" variant="ghost" aria-label="Stop selecting" onClick={selection.stop}>
            <XIcon size={15} />
          </Button>
        </div>
      </div>

      {confirmDelete && (
        <Dialog open onOpenChange={setConfirmDelete}>
          <DialogContent
            title={`Delete ${label}?`}
            description={`They go to the workspace's trash with their subtasks, comments and files. You can restore them for ${TRASH_DAYS} days.`}
          >
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await perform(bulkDeleteTasks(ids));
                    if (res.ok) {
                      setConfirmDelete(false);
                      selection.stop();
                      const { trashIds } = res.data;
                      toast.success(`Moved ${pluralize(trashIds.length, "task")} to the trash`, {
                        action: {
                          label: "Undo",
                          onClick: () =>
                            void perform(restoreTasks(trashIds), {
                              success: `Restored ${pluralize(trashIds.length, "task")}`,
                            }),
                        },
                      });
                    }
                  })
                }
              >
                {pending ? "Deleting…" : `Delete ${label}`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {moving && (
        <MoveToWorkspaceDialog
          currentWorkspaceId={workspaceId}
          title={`Move ${label} to another workspace`}
          description="They keep their subtasks, comments and files. People who aren't members there are unassigned."
          submitLabel={`Move ${label}`}
          onClose={() => setMoving(false)}
          onMove={async (targetId, taskListId) => {
            const res = await perform(
              bulkMoveToWorkspace({ ids, workspaceId: targetId, taskListId }),
            );
            if (!res.ok) return false;
            selection.stop();
            toast.success(`Moved ${pluralize(res.data.count, "task")} to ${res.data.workspaceName}`, {
              action: { label: "Open", onClick: () => router.push(`/w/${res.data.workspaceId}`) },
            });
            return true;
          }}
        />
      )}
    </>
  );
}
