"use client";

import { ArrowCounterClockwiseIcon, TrashIcon } from "@phosphor-icons/react/ssr";
import { addDays, format } from "date-fns";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform } from "@/components/app-context";
import { EmptyState } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { cn, pluralize } from "@/lib/utils";
import { deleteForever, emptyTrash, restoreTasks } from "@/server/actions/trash";
import type { TrashEntry } from "@/server/trash";

export function TrashList({
  workspaceId,
  entries,
  canManage,
  highlight,
  days,
}: {
  workspaceId: string;
  entries: TrashEntry[];
  canManage: boolean;
  /** Task number to point out (arriving from an old /t/ link). */
  highlight: number | null;
  days: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [forever, setForever] = useState<TrashEntry | null>(null);
  const [emptying, setEmptying] = useState(false);

  useEffect(() => {
    if (highlight) document.getElementById(`trash-${highlight}`)?.scrollIntoView({ block: "center" });
  }, [highlight]);

  function restore(items: TrashEntry[]) {
    startTransition(async () => {
      const res = await perform(restoreTasks(items.map((e) => e.id)));
      if (!res.ok) return;
      const [first] = items;
      if (items.length === 1)
        toast.success(`Restored “${first.title}”`, {
          action: { label: "Open", onClick: () => router.push(`/t/${first.number}`) },
        });
      else toast.success(`Restored ${pluralize(res.data.count, "task")}`);
    });
  }

  const highlighted = highlight !== null && entries.some((e) => e.number === highlight);

  return (
    <div className="mx-auto max-w-3xl py-6">
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-4 sm:px-6">
          <p className="min-w-0 flex-1 text-[13.5px] text-muted">
            Deleted tasks stay here for {days} days with their subtasks, comments and files, then
            they&apos;re deleted for good.
          </p>
          {entries.length > 1 && (
            <div className="flex items-center gap-1.5">
              <Button size="sm" disabled={pending} onClick={() => restore(entries)}>
                <ArrowCounterClockwiseIcon size={14} />
                Restore all
              </Button>
              {canManage && (
                <Button size="sm" variant="danger-ghost" onClick={() => setEmptying(true)}>
                  Empty trash
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {highlight !== null && !highlighted && (
        <p className="mx-4 mb-3 rounded-[10px] border border-border bg-surface px-3 py-2 text-[13px] text-muted sm:mx-6">
          Task #{highlight} isn&apos;t in the trash any more.
        </p>
      )}

      {entries.length === 0 ? (
        <EmptyState icon={<TrashIcon size={20} />} title="The trash is empty">
          Tasks deleted from this workspace stay here for {days} days, so they can be restored.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {entries.map((e) => {
            const parts = [
              e.listName ? `was in ${e.listName}` : null,
              e.subtasks ? pluralize(e.subtasks, "subtask") : null,
              e.comments ? pluralize(e.comments, "comment") : null,
              e.files ? pluralize(e.files, "file") : null,
            ].filter(Boolean);
            return (
              <li
                key={e.id}
                id={`trash-${e.number}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 sm:px-6",
                  e.number === highlight && "bg-accent-soft",
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{e.title}</p>
                  <p className="mt-0.5 truncate text-[12.5px] text-muted">
                    <span className="font-mono text-[11.5px] text-subtle">#{e.number}</span>
                    {parts.length > 0 && <> · {parts.join(", ")}</>}
                  </p>
                  <p className="tabular mt-0.5 text-[12px] text-subtle">
                    <span title={formatTimestamp(e.deletedAt)}>
                      Deleted {timeAgo(e.deletedAt)}
                      {e.deletedBy ? ` by ${e.deletedBy}` : ""}
                    </span>
                    {" · "}kept until {format(addDays(new Date(e.deletedAt), days), "d MMM")}
                  </p>
                </div>
                <Button size="sm" disabled={pending} onClick={() => restore([e])}>
                  <ArrowCounterClockwiseIcon size={14} />
                  Restore
                </Button>
                {canManage && (
                  <Tooltip content="Delete for good">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete “${e.title}” for good`}
                      onClick={() => setForever(e)}
                    >
                      <TrashIcon size={15} />
                    </Button>
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={forever !== null}
        onOpenChange={(open) => !open && setForever(null)}
        title={`Delete “${forever?.title ?? ""}” for good?`}
        description="Its subtasks, comments and files go too. This can't be undone."
        confirmLabel="Delete for good"
        onConfirm={() =>
          forever && perform(deleteForever([forever.id]), { success: "Deleted for good" })
        }
      />
      <ConfirmDialog
        open={emptying}
        onOpenChange={setEmptying}
        title="Empty the trash?"
        description={`${pluralize(entries.length, "task")} and everything on them will be deleted for good. This can't be undone.`}
        confirmLabel="Empty trash"
        onConfirm={() => perform(emptyTrash(workspaceId), { success: "Trash emptied" })}
      />
    </div>
  );
}
