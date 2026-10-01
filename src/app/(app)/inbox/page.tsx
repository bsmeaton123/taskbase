import { TrayIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { InboxList, MarkAllRead } from "@/components/inbox-list";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getInbox } from "@/server/queries";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; filter?: string }>;
}) {
  const sp = await searchParams;
  const filter = sp.filter === "all" ? "all" : "unread";
  const viewer = await requireUser();
  const items = await getInbox(viewer, filter);
  const unreadCount = items.filter((i) => !i.readAt).length;

  const tab = (key: "unread" | "all", label: string) => (
    <Link
      href={key === "unread" ? "/inbox" : "/inbox?filter=all"}
      role="tab"
      aria-selected={filter === key}
      className={cn(
        "inline-flex h-full items-center rounded-[5px] px-2.5 text-[13px] font-medium",
        filter === key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Inbox">
          {unreadCount > 0 && <MarkAllRead />}
          <div
            role="tablist"
            className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-0.5"
          >
            {tab("unread", "Unread")}
            {tab("all", "All")}
          </div>
        </PageHeader>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-16">
          {items.length === 0 ? (
            <EmptyState
              icon={<TrayIcon size={20} />}
              title={filter === "unread" ? "You're all caught up" : "No notifications yet"}
            >
              You&apos;ll hear here when someone assigns you a task, mentions you, or
              comments on a task you follow.
            </EmptyState>
          ) : (
            <InboxList items={items} />
          )}
        </div>
      </div>
      <TaskPanelSlot taskId={sp.task} />
    </div>
  );
}
