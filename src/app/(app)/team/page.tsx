import { UsersThreeIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { getToday, requireUser } from "@/lib/session";
import { cn, pluralize } from "@/lib/utils";
import { getTeam } from "@/server/queries";

export const metadata: Metadata = { title: "Team" };

/** Everyone you work with, and what's on their plate. Click a person to see their tasks. */
export default async function TeamPage() {
  const viewer = await requireUser();
  const team = await getTeam(viewer, await getToday());
  const others = team.filter((p) => p.id !== viewer.id);
  const me = team.find((p) => p.id === viewer.id);
  const ordered = me ? [me, ...others] : others;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Team" />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {ordered.length === 0 ? (
          <EmptyState icon={<UsersThreeIcon size={20} />} title="Nobody here yet">
            People show up once you share a workspace with them.
          </EmptyState>
        ) : (
          <div className="mx-auto grid max-w-4xl gap-4 px-4 py-6 sm:px-6">
            <p className="max-w-[70ch] text-[13px] text-muted">
              Open tasks per person, counted across the workspaces you share with them.
            </p>
            <ul className="grid gap-2 sm:grid-cols-2">
              {ordered.map((p) => {
                const isMe = p.id === viewer.id;
                return (
                  <li key={p.id}>
                    <Link
                      href={isMe ? "/my-tasks" : `/team/${p.id}`}
                      className="flex items-center gap-3 rounded-[10px] border border-border bg-surface p-3 shadow-card transition-colors hover:border-border-strong"
                    >
                      <Avatar person={p} size="lg" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="min-w-0 truncate text-[14px] font-medium">{p.name}</span>
                          {isMe && <span className="shrink-0 text-[12px] text-subtle">(you)</span>}
                        </span>
                        <span className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                          <span>{p.open === 0 ? "Nothing open" : pluralize(p.open, "open task")}</span>
                          {p.overdue > 0 && (
                            <span className="font-medium text-danger-text">{p.overdue} overdue</span>
                          )}
                          {p.dueSoon > 0 && <span>{p.dueSoon} due this week</span>}
                        </span>
                      </span>
                      <Load open={p.open} overdue={p.overdue} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** Up to five dots: one per open task, red ones for overdue. "+N" beyond five. Decorative: the
 * counts are spelled out beside the name. */
function Load({ open, overdue }: { open: number; overdue: number }) {
  const shown = Math.min(open, 5);
  return (
    <span
      className="hidden shrink-0 items-center gap-1 sm:inline-flex"
      aria-hidden
      title={`${open} open${overdue ? `, ${overdue} overdue` : ""}`}
    >
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={cn("size-1.5 rounded-full", i < overdue ? "bg-danger" : "bg-subtle")}
        />
      ))}
      {open > 5 && <span className="tabular text-[11px] text-subtle">+{open - 5}</span>}
    </span>
  );
}
