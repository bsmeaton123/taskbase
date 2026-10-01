"use client";

import { PlusIcon, UserCircleDashedIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useOptimistic, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import { PeoplePicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { setTaskAssignee } from "@/server/actions/tasks";
import type { AssigneeInfo, Member } from "@/server/queries";

type Change = { add: AssigneeInfo } | { remove: string };

/**
 * The "Assignees" row in the task panel's property list: everyone on the task, each with a
 * remove button, and a picker to tick more people. Every change saves straight away.
 */
export function TaskAssigneesRow({
  taskId,
  assignees,
  members,
}: {
  taskId: string;
  assignees: AssigneeInfo[];
  members: Member[];
}) {
  const { viewer } = useApp();
  const [current, apply] = useOptimistic(assignees, (list: AssigneeInfo[], change: Change) =>
    "add" in change
      ? [...list.filter((p) => p.id !== change.add.id), change.add]
      : list.filter((p) => p.id !== change.remove),
  );
  const [, startTransition] = useTransition();
  const selected = new Set(current.map((p) => p.id));

  function toggle(person: { id: string; name: string; image?: string | null }, on: boolean) {
    startTransition(async () => {
      apply(
        on
          ? { add: { id: person.id, name: person.name, image: person.image ?? null } }
          : { remove: person.id },
      );
      await perform(setTaskAssignee({ taskId, userId: person.id, on }));
    });
  }

  const me = members.find((m) => m.id === viewer.id);

  return (
    <>
      <dt className="self-start pt-1.5 text-muted">Assignees</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
        {current.map((p) => (
          <span
            key={p.id}
            className="inline-flex h-7 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-0.5 text-[13px]"
          >
            <Avatar person={p} size="xs" />
            <span className="min-w-0 truncate">
              {p.id === viewer.id ? `${p.name} (you)` : p.name}
            </span>
            <button
              type="button"
              onClick={() => toggle(p, false)}
              aria-label={`Unassign ${p.name}`}
              title={`Unassign ${p.name}`}
              // The pseudo-element widens the hit area for fingers without changing the chip.
              className="relative inline-flex size-5 shrink-0 items-center justify-center rounded-full text-subtle after:absolute after:-inset-1 hover:bg-surface-2 hover:text-text"
            >
              <XIcon size={10} weight="bold" />
            </button>
          </span>
        ))}
        <PeoplePicker
          people={members}
          selected={selected}
          onToggle={toggle}
          viewerId={viewer.id}
          label="Assignees"
        >
          {current.length === 0 ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
            >
              <UserCircleDashedIcon size={15} className="shrink-0" />
              <span className="sr-only">Assignees: </span>
              Unassigned
            </button>
          ) : (
            <button
              type="button"
              aria-label="Add or remove assignees"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
            >
              <PlusIcon size={13} />
              Add
            </button>
          )}
        </PeoplePicker>
        {current.length === 0 && me && (
          <button
            type="button"
            onClick={() => toggle(me, true)}
            className="inline-flex h-7 items-center rounded-md px-1.5 text-[12.5px] font-medium text-accent-text hover:underline"
          >
            Assign to me
          </button>
        )}
      </dd>
    </>
  );
}
