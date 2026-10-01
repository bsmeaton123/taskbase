"use client";

import { useEffect, useState, useTransition } from "react";
import { perform, useApp } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { getWorkspaceLists } from "@/server/actions/templates";

/** Pick a workspace and one of its lists; used to move one task or many. */
export function MoveToWorkspaceDialog({
  currentWorkspaceId,
  title,
  description,
  submitLabel,
  onMove,
  onClose,
}: {
  currentWorkspaceId: string;
  title: string;
  description: string;
  submitLabel: string;
  /** Resolves true when the move worked, which closes the dialog. */
  onMove: (workspaceId: string, taskListId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { workspaces } = useApp();
  const options = workspaces.filter((w) => w.id !== currentWorkspaceId);
  const [workspaceId, setWorkspaceId] = useState(options[0]?.id ?? "");
  const [lists, setLists] = useState<{ id: string; name: string }[] | null>(null);
  const [listId, setListId] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    // perform() toasts the reason when loading fails.
    perform(getWorkspaceLists(workspaceId)).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setFailed(true);
        return;
      }
      setLists(res.data);
      setListId(res.data[0]?.id ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  // Matches the Input field: stronger border on hover, blue border and halo on focus.
  const selectClass =
    "h-9 w-full rounded-md border border-border bg-surface px-2 text-[14px] text-text transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:opacity-60";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={title} description={description}>
        {options.length === 0 ? (
          <p className="text-muted">You&apos;re not a member of any other workspace yet.</p>
        ) : (
          <form method="post"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                if (await onMove(workspaceId, listId)) onClose();
              });
            }}
          >
            <label className="grid gap-1.5 text-[13px] font-medium">
              Workspace
              <select
                className={selectClass}
                value={workspaceId}
                onChange={(e) => {
                  setLists(null);
                  setListId("");
                  setFailed(false);
                  setWorkspaceId(e.target.value);
                }}
              >
                {options.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-[13px] font-medium">
              List
              <select
                className={selectClass}
                value={listId}
                onChange={(e) => setListId(e.target.value)}
                disabled={!lists}
              >
                {!lists && <option>{failed ? "Couldn't load lists" : "Loading lists…"}</option>}
                {lists?.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            {lists?.length === 0 && (
              <p className="text-[13px] text-muted">That workspace has no lists yet. Add one there first.</p>
            )}
            {failed && (
              <p className="text-[12.5px] text-danger-text" role="alert">
                Couldn&apos;t load that workspace&apos;s lists. Close this and try again.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !listId}>
                {pending ? "Moving…" : submitLabel}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
