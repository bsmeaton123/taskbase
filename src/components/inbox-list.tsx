"use client";

import { ChecksIcon, EnvelopeOpenIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useTransition } from "react";
import { perform, useTaskNavigation } from "@/components/app-context";
import { commentPreview } from "@/components/comment-body";
import { WorkspaceMark } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationsRead } from "@/server/actions/account";
import type { InboxItem } from "@/server/queries";

export function MarkAllRead() {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      disabled={pending}
      aria-label="Mark all as read"
      onClick={() => startTransition(async () => void (await perform(markAllNotificationsRead())))}
    >
      <ChecksIcon size={15} />
      <span className="hidden sm:inline">Mark all as read</span>
    </Button>
  );
}

function describe(item: InboxItem) {
  const who = <span className="font-semibold">{item.actorName ?? "Someone"}</span>;
  const task = <span className="font-medium">{item.taskTitle ?? "a task"}</span>;
  switch (item.kind) {
    case "assigned":
      return item.data.subtask ? (
        <>
          {who} assigned you the subtask “{String(item.data.subtask)}” in {task}
        </>
      ) : (
        <>
          {who} assigned you {task}
        </>
      );
    case "mentioned":
      return (
        <>
          {who} mentioned you in {task}
        </>
      );
    case "commented":
      return (
        <>
          {who} commented on {task}
        </>
      );
    case "status_changed":
      return (
        <>
          {who} changed {task} to {String(item.data.to ?? "a new status")}
        </>
      );
    case "added_to_workspace":
      return (
        <>
          {who} added you to{" "}
          <span className="font-medium">{item.workspaceName ?? "a workspace"}</span>
        </>
      );
    case "unblocked":
      return (
        <>
          {task} is ready to start: {who} finished “{String(item.data.blockerTitle ?? "the task it was waiting for")}”
        </>
      );
    default:
      return <>{who} updated something</>;
  }
}

export function InboxList({ items }: { items: InboxItem[] }) {
  const { hrefFor, activeTaskId } = useTaskNavigation();

  return (
    <ul>
      {items.map((item) => {
        const unread = !item.readAt;
        const href = item.taskId
          ? hrefFor(item.taskId)
          : item.workspaceId
            ? `/w/${item.workspaceId}`
            : "#";
        return (
          <li
            key={item.id}
            className={cn(
              "group/n relative border-b border-border/70",
              item.taskId && item.taskId === activeTaskId ? "bg-accent-soft/60" : "hover:bg-surface-2/70",
            )}
          >
            <Link
              href={href}
              scroll={false}
              onClick={() => {
                if (unread && !item.taskId) perform(markNotificationsRead([item.id]));
              }}
              className="flex gap-3 py-3 pl-4 pr-14 sm:pl-6"
            >
              <span className="relative mt-0.5 shrink-0">
                {/* The name follows in the text, so the avatar stays out of the link's name. */}
                <span aria-hidden className="flex">
                  {item.actorId && item.actorName ? (
                    <Avatar
                      person={{ id: item.actorId, name: item.actorName, image: item.actorImage }}
                      size="md"
                    />
                  ) : (
                    <span className="block size-7 rounded-full bg-surface-3" />
                  )}
                </span>
                {unread && (
                  <>
                    <span
                      aria-hidden
                      className="absolute -left-2.5 top-2.5 size-1.5 rounded-full bg-accent"
                    />
                    <span className="sr-only">Unread: </span>
                  </>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[13.5px]", unread ? "text-text" : "text-muted")}>
                  {describe(item)}
                </span>
                {item.commentBody && (item.kind === "commented" || item.kind === "mentioned") && (
                  <span className="mt-1 block truncate text-[13px] text-muted">
                    {commentPreview(item.commentBody)}
                  </span>
                )}
                <span className="mt-1 flex items-center gap-1.5 text-[12px] text-subtle">
                  {item.workspaceName && (
                    <>
                      <WorkspaceMark color={item.workspaceColor ?? "slate"} size={8} />
                      <span className="truncate">{item.workspaceName}</span>
                      <span aria-hidden>·</span>
                    </>
                  )}
                  <time
                    className="tabular shrink-0 whitespace-nowrap"
                    suppressHydrationWarning
                    dateTime={new Date(item.createdAt).toISOString()}
                    title={formatTimestamp(item.createdAt)}
                  >
                    {timeAgo(item.createdAt)}
                  </time>
                </span>
              </span>
            </Link>
            <div className="absolute right-3 top-3 opacity-0 focus-within:opacity-100 group-hover/n:opacity-100 pointer-coarse:opacity-100 sm:right-5">
              <Tooltip content={unread ? "Mark as read" : "Mark as unread"}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={unread ? "Mark as read" : "Mark as unread"}
                  onClick={() => perform(markNotificationsRead([item.id], unread))}
                >
                  {unread ? <EnvelopeOpenIcon size={16} /> : <EnvelopeSimpleIcon size={16} />}
                </Button>
              </Tooltip>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
