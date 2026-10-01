"use client";

import { DotsThreeIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react/ssr";
import { useState, useTransition } from "react";
import { describeActivity } from "@/components/activity-text";
import { perform, useApp } from "@/components/app-context";
import { CommentFiles } from "@/components/attachments";
import { CommentBody } from "@/components/comment-body";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { decodeMentions, encodeMentions } from "@/lib/mentions";
import { cn } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import { deleteComment, editComment } from "@/server/actions/comments";
import type { FeedItem } from "@/server/queries";
import { MentionTextarea, type Person } from "./composer";

export function Feed({
  items,
  people,
}: {
  items: FeedItem[];
  people: Person[];
}) {
  const [filter, setFilter] = useState<"all" | "comments">("all");
  const shown = filter === "all" ? items : items.filter((i) => i.type === "comment");
  const commentCount = items.filter((i) => i.type === "comment").length;

  return (
    <section aria-label="Comments and activity" className="px-4 pb-6 pt-2 sm:px-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">
          Comments
          {commentCount > 0 && (
            <span className="tabular ml-1.5 font-normal text-subtle">{commentCount}</span>
          )}
        </h3>
        <div
          className="inline-flex rounded-md bg-surface-2 p-0.5 text-[12px]"
          role="radiogroup"
          onKeyDown={radioGroupKeys}
          aria-label="Show"
        >
          {(["all", "comments"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              tabIndex={filter === f ? 0 : -1}
              onClick={() => setFilter(f)}
              className={cn(
                "h-6 rounded-[5px] px-2 font-medium",
                filter === f ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
              )}
            >
              {f === "all" ? "All activity" : "Comments only"}
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="py-4 text-[13px] text-subtle">
          No comments yet. Ask a question or share an update below.
        </p>
      ) : (
        <ol className="relative grid gap-1">
          {shown.map((item) =>
            item.type === "comment" ? (
              <CommentItem key={item.id} item={item} people={people} />
            ) : (
              <ActivityItem key={item.id} item={item} />
            ),
          )}
        </ol>
      )}
    </section>
  );
}

function CommentItem({
  item,
  people,
}: {
  item: Extract<FeedItem, { type: "comment" }>;
  people: Person[];
}) {
  const { viewer } = useApp();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState("");
  const [mentioned, setMentioned] = useState<{ id: string; name: string }[]>([]);
  const [pending, startTransition] = useTransition();
  const mine = item.author?.id === viewer.id;
  const canDelete = mine || viewer.isAdmin;

  function startEdit() {
    const decoded = decodeMentions(item.body);
    setDraft(decoded.text);
    setMentioned(decoded.people);
    setEditing(true);
  }

  function save() {
    const text = draft.trim();
    if (!text || pending) return;
    const body = encodeMentions(text, mentioned);
    // Saving without a change would only mark the comment "(edited)".
    if (body === item.body.trim()) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const res = await perform(editComment(item.id, body));
      if (res.ok) setEditing(false);
    });
  }

  return (
    <li className="group/comment flex gap-3 py-2.5">
      {item.author ? (
        <Avatar person={item.author} size="md" />
      ) : (
        <span className="size-7 shrink-0 rounded-full bg-surface-3" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[13px] font-semibold">
            {item.author?.name ?? "Former member"}
          </span>
          <time
            suppressHydrationWarning
            dateTime={new Date(item.createdAt).toISOString()}
            title={formatTimestamp(item.createdAt)}
            className="tabular text-[12px] text-subtle"
          >
            {timeAgo(item.createdAt)}
          </time>
          {item.editedAt && <span className="text-[12px] text-subtle">(edited)</span>}
          {canDelete && !editing && (
            <Menu>
              <MenuTrigger asChild>
                <button
                  type="button"
                  className="ml-auto inline-flex size-6 items-center justify-center rounded-md text-subtle opacity-0 hover:bg-surface-2 hover:text-text focus-visible:opacity-100 group-hover/comment:opacity-100 pointer-coarse:opacity-100 data-[state=open]:opacity-100"
                  aria-label="Comment options"
                >
                  <DotsThreeIcon size={16} weight="bold" />
                </button>
              </MenuTrigger>
              <MenuContent align="end">
                {mine && (
                  <MenuItem onSelect={startEdit}>
                    <PencilSimpleIcon size={16} />
                    Edit comment
                  </MenuItem>
                )}
                {canDelete && (
                  <MenuItem
                    danger
                    onSelect={() => setConfirmDelete(true)}
                  >
                    <TrashIcon size={16} />
                    Delete comment
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          )}
        </div>
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this comment?"
          description="Any files attached to it go too. This can't be undone."
          confirmLabel="Delete comment"
          onConfirm={() => perform(deleteComment(item.id), { success: "Comment deleted" })}
        />
        {editing ? (
          <div className="mt-1.5 rounded-[10px] border border-accent px-3 py-2 ring-3 ring-accent/15">
            <MentionTextarea
              value={draft}
              onChange={setDraft}
              people={people.filter((p) => p.id !== viewer.id)}
              onMention={(p) =>
                setMentioned((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]))
              }
              onSubmit={save}
              onCancel={() => setEditing(false)}
              autoFocus
              ariaLabel="Edit comment"
            />
            <div className="mt-2 flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save} disabled={pending || !draft.trim()}>
                {pending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        ) : (
          item.body && (
            <CommentBody body={item.body} viewerId={viewer.id} className="mt-0.5 text-[14px]" />
          )
        )}
        <CommentFiles files={item.attachments} />
      </div>
    </li>
  );
}

function ActivityItem({ item }: { item: Extract<FeedItem, { type: "activity" }> }) {
  const { today, viewer } = useApp();
  const actor = item.actor?.id === viewer.id ? "You" : (item.actor?.name ?? "Someone");
  const { icon, text } = describeActivity(item.kind, item.data, {
    today,
    viewerId: viewer.id,
    actorId: item.actor?.id,
  });

  return (
    <li className="flex items-start gap-3 py-1 pl-1.5 text-[12.5px] text-muted">
      <span className="mt-px inline-flex size-4 shrink-0 items-center justify-center text-subtle">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-text">{actor}</span> {text}
        <time
          suppressHydrationWarning
          dateTime={new Date(item.createdAt).toISOString()}
          title={formatTimestamp(item.createdAt)}
          className="tabular ml-1.5 whitespace-nowrap text-subtle"
        >
          {timeAgo(item.createdAt)}
        </time>
      </span>
    </li>
  );
}
