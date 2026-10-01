"use client";

import { PlusIcon, XIcon } from "@phosphor-icons/react/ssr";
import { useOptimistic, useTransition } from "react";
import { perform } from "@/components/app-context";
import { TagChip, TagPicker, type Tag } from "@/components/tags";
import { setTaskTag } from "@/server/actions/tags";

type Change = { add: Tag } | { remove: string };

/** The "Tags" row in the task panel's property list. */
export function TaskTagsRow({
  taskId,
  tags,
  workspaceTags,
}: {
  taskId: string;
  tags: Tag[];
  workspaceTags: Tag[];
}) {
  const [current, apply] = useOptimistic(tags, (list: Tag[], change: Change) =>
    "add" in change
      ? [...list.filter((t) => t.id !== change.add.id), change.add].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      : list.filter((t) => t.id !== change.remove),
  );
  const [, startTransition] = useTransition();
  const selected = new Set(current.map((t) => t.id));

  function toggle(tag: Tag, on: boolean) {
    startTransition(async () => {
      apply(on ? { add: tag } : { remove: tag.id });
      await perform(setTaskTag({ taskId, tagId: tag.id, on }));
    });
  }

  function create(name: string) {
    startTransition(async () => {
      apply({ add: { id: `new:${name}`, name, color: "slate" } });
      await perform(setTaskTag({ taskId, name, on: true }));
    });
  }

  return (
    <>
      <dt className="self-start pt-1.5 text-muted">Tags</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1 py-0.5">
        {current.map((t) => (
          <TagChip key={t.id} tag={t} className="h-6 pr-0.5">
            <button
              type="button"
              onClick={() => toggle(t, false)}
              aria-label={`Remove tag ${t.name}`}
              // The pseudo-element widens the hit area for fingers without changing the chip.
              className="relative inline-flex size-4 items-center justify-center rounded-full text-subtle after:absolute after:-inset-1 hover:bg-surface-2 hover:text-text"
            >
              <XIcon size={10} weight="bold" />
            </button>
          </TagChip>
        ))}
        <TagPicker tags={workspaceTags} selected={selected} onToggle={toggle} onCreate={create}>
          {current.length === 0 ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
            >
              <PlusIcon size={15} className="shrink-0" />
              Add a tag
            </button>
          ) : (
            <button
              type="button"
              aria-label="Add a tag"
              className="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px] text-subtle hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
            >
              <PlusIcon size={13} />
              Add
            </button>
          )}
        </TagPicker>
      </dd>
    </>
  );
}
