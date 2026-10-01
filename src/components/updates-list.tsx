"use client";

import {
  ArrowRightIcon,
  BellSimpleIcon,
  BroomIcon,
  ChatCircleIcon,
  XIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { createContext, startTransition, useContext, useOptimistic } from "react";
import { toast } from "sonner";
import { describeActivity, type ActivityContext } from "@/components/activity-text";
import { perform, useApp, useTaskNavigation } from "@/components/app-context";
import { EmptyState } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { formatTimestamp } from "@/lib/dates";
import { changePair, type UpdateCard, type UpdateLine, type UpdateVerb } from "@/lib/updates";
import { cn, pluralize } from "@/lib/utils";
import { clearAllUpdates, dismissUpdates, undoClearUpdates } from "@/server/actions/updates";

/** Lines shown per card before "and 3 more changes". */
const MAX_LINES = 5;

const VERBS: Record<UpdateVerb, string> = {
  created: "created the task",
  restored: "restored the task",
  commented: "commented on the task",
  updated: "updated the task",
};

type UpdatesState = {
  cards: UpdateCard[];
  dismiss: (card: UpdateCard) => void;
  clearAll: () => void;
};

const UpdatesContext = createContext<UpdatesState | null>(null);

function useUpdates() {
  const ctx = useContext(UpdatesContext);
  if (!ctx) throw new Error("useUpdates must be used inside <UpdatesProvider>");
  return ctx;
}

/**
 * Holds the cards for My tasks > Updates so the header's "Clear all" and the list share one
 * optimistic state: dismissed cards disappear at once, and come back if saving fails.
 */
export function UpdatesProvider({
  cards,
  children,
}: {
  cards: UpdateCard[];
  children: React.ReactNode;
}) {
  const [visible, hide] = useOptimistic(cards, (state: UpdateCard[], id: string | null) =>
    id === null ? [] : state.filter((c) => c.id !== id),
  );

  const value: UpdatesState = {
    cards: visible,
    dismiss: (card) =>
      startTransition(async () => {
        hide(card.id);
        await perform(dismissUpdates(card.items));
      }),
    clearAll: () => {
      const newest = cards[0];
      if (!newest) return;
      startTransition(async () => {
        hide(null);
        const res = await perform(clearAllUpdates(new Date(newest.at).toISOString()));
        if (res.ok)
          toast("Updates cleared", {
            action: {
              label: "Undo",
              onClick: () => void perform(undoClearUpdates(res.data.previous)),
            },
          });
      });
    },
  };

  return <UpdatesContext.Provider value={value}>{children}</UpdatesContext.Provider>;
}

/** In the page header from tablet width up; above the cards on phones, where the header is full. */
export function ClearAllUpdates({ className }: { className?: string }) {
  const { cards, clearAll } = useUpdates();
  if (cards.length === 0) return null;
  return (
    <Button variant="ghost" onClick={clearAll} className={className}>
      <BroomIcon size={15} />
      Clear all
    </Button>
  );
}

export function UpdatesList() {
  const { cards, dismiss } = useUpdates();
  const { hrefFor, activeTaskId } = useTaskNavigation();

  if (cards.length === 0)
    return (
      <EmptyState icon={<BellSimpleIcon size={20} />} title="No updates">
        When someone else changes or comments on a task you follow, it shows up here.
      </EmptyState>
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      <div className="-mt-1 mb-2 flex justify-end sm:hidden">
        <ClearAllUpdates />
      </div>
      <ol aria-label="Updates" className="grid gap-2">
        {cards.map((card) => (
          <UpdateCardItem
            key={card.id}
            card={card}
            href={hrefFor(card.task.id)}
            active={card.task.id === activeTaskId}
            onDismiss={(button) => {
              // Keep keyboard focus in the list rather than losing it with the card.
              const li = button.closest("li");
              const next = li?.nextElementSibling ?? li?.previousElementSibling;
              next?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
              dismiss(card);
            }}
          />
        ))}
      </ol>
    </div>
  );
}

function UpdateCardItem({
  card,
  href,
  active,
  onDismiss,
}: {
  card: UpdateCard;
  href: string;
  active: boolean;
  onDismiss: (button: HTMLElement) => void;
}) {
  const { today, viewer } = useApp();
  const ctx: ActivityContext = {
    today,
    viewerId: viewer.id,
    actorId: card.actor?.id,
    linkTasks: false,
  };
  const shown = card.lines.slice(0, MAX_LINES);
  const more = card.lines.length - shown.length;
  const at = new Date(card.at);

  return (
    <li className="relative">
      <Link
        href={href}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex gap-3 rounded-[10px] border bg-surface py-3 pl-3 pr-11 shadow-card transition-colors sm:pl-4",
          active ? "border-accent/50 bg-accent-soft/50" : "border-border hover:border-border-strong",
        )}
      >
        {/* The name follows in the text, so the avatar stays out of the link's name. */}
        <span aria-hidden className="mt-0.5 shrink-0">
          {card.actor ? (
            <Avatar person={card.actor} size="md" />
          ) : (
            <span className="block size-7 rounded-full bg-surface-3" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] text-muted">
            <span className="font-semibold text-text">{card.actor?.name ?? "Someone"}</span>{" "}
            {VERBS[card.verb]} <span className="font-medium text-text">{card.task.title}</span>
          </span>
          {shown.length > 0 && (
            <span className="mt-1.5 grid gap-1">
              {shown.map((line) => (
                <ChangeLine key={line.id} line={line} ctx={ctx} />
              ))}
              {more > 0 && (
                <span className="pl-6 text-[12.5px] text-subtle">
                  and {pluralize(more, "more change")}
                </span>
              )}
            </span>
          )}
          <span className="mt-1.5 flex items-center gap-1.5 text-[12px] text-subtle">
            <WorkspaceMark color={card.workspace.color} size={8} />
            <span className="truncate">{card.workspace.name}</span>
            <span aria-hidden>·</span>
            <time
              suppressHydrationWarning
              dateTime={at.toISOString()}
              title={formatTimestamp(at)}
              className="tabular shrink-0 whitespace-nowrap"
            >
              {card.time}
            </time>
          </span>
        </span>
      </Link>
      <Tooltip content="Dismiss">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={`Dismiss update on ${card.task.title}`}
          onClick={(e) => onDismiss(e.currentTarget)}
          className="absolute right-2 top-2 text-subtle pointer-coarse:size-9"
        >
          <XIcon size={15} />
        </Button>
      </Tooltip>
    </li>
  );
}

function ChangeLine({ line, ctx }: { line: UpdateLine; ctx: ActivityContext }) {
  if (line.type === "comment")
    return (
      <span className="flex items-start gap-2 text-[13px] text-text">
        <LineIcon>
          <ChatCircleIcon size={13} />
        </LineIcon>
        <span className="line-clamp-2 min-w-0 break-words">
          {line.excerpt ||
            (line.fileCount > 0 ? `Shared ${pluralize(line.fileCount, "file")}` : "Commented")}
        </span>
      </span>
    );

  const { icon, text } = describeActivity(line.kind, line.data, ctx);
  const pair = changePair(line.kind, line.data, ctx.today);
  return (
    <span className="flex items-start gap-2 text-[13px] text-muted">
      <LineIcon>{icon}</LineIcon>
      {pair ? (
        <span className="min-w-0 break-words">
          {pair.label}: {pair.from}
          <ArrowRightIcon size={11} aria-hidden className="mx-1 inline-block align-[-1px]" />
          <span className="sr-only">to </span>
          <span className="font-medium text-text">{pair.to}</span>
        </span>
      ) : (
        <span className="block min-w-0 break-words first-letter:uppercase">{text}</span>
      )}
    </span>
  );
}

function LineIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-px inline-flex size-4 shrink-0 items-center justify-center text-subtle">
      {children}
    </span>
  );
}
