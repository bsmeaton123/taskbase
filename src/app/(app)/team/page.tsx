import { CaretLeftIcon, CaretRightIcon, UsersThreeIcon } from "@phosphor-icons/react/ssr";
import { format, parseISO } from "date-fns";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { WorkloadGrid } from "@/components/team/workload-grid";
import { Avatar } from "@/components/ui/avatar";
import { shiftDate } from "@/lib/dates";
import { getToday, requireUser, type CurrentUser } from "@/lib/session";
import { cn, pluralize } from "@/lib/utils";
import { BUSY_DAY, mondayOf, weekFromParam } from "@/lib/workload";
import { getTeam, getWorkload } from "@/server/queries";

export const metadata: Metadata = { title: "Team" };

type Props = { searchParams: Promise<{ view?: string; week?: string; task?: string }> };

/**
 * Who's doing what. Workload (the default) lays the week out by person and day, to spot who's
 * overloaded and hand work around by dragging; People lists everyone with their counts.
 */
export default async function TeamPage({ searchParams }: Props) {
  const [sp, viewer, today] = await Promise.all([searchParams, requireUser(), getToday()]);
  const view = sp.view === "people" ? "people" : "workload";

  const tab = (key: "workload" | "people", label: string) => (
    <Link
      href={key === "workload" ? "/team" : "/team?view=people"}
      role="tab"
      aria-selected={view === key}
      className={cn(
        "inline-flex h-full items-center rounded-[5px] px-2.5 text-[13px] font-medium",
        view === key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Team">
          <div
            role="tablist"
            aria-label="Team view"
            className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-0.5"
          >
            {tab("workload", "Workload")}
            {tab("people", "People")}
          </div>
        </PageHeader>
        {view === "workload" ? (
          <Workload viewer={viewer} today={today} week={sp.week} />
        ) : (
          <People viewer={viewer} today={today} />
        )}
      </div>
      <TaskPanelSlot taskId={sp.task} />
    </div>
  );
}

async function Workload({
  viewer,
  today,
  week,
}: {
  viewer: CurrentUser;
  today: string;
  week: string | undefined;
}) {
  const weekStart = weekFromParam(week, today);
  const thisWeek = mondayOf(today);
  const workload = await getWorkload(viewer, weekStart, today);
  const label =
    weekStart === thisWeek
      ? "This week"
      : weekStart === shiftDate(thisWeek, 7)
        ? "Next week"
        : `Week of ${format(parseISO(weekStart), "d MMM")}`;
  const navClass =
    "inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text";

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-2 sm:px-6">
        <nav aria-label="Week" className="flex items-center gap-1">
          {weekStart > thisWeek ? (
            <Link href={`/team?week=${shiftDate(weekStart, -7)}`} className={navClass} aria-label="Previous week">
              <CaretLeftIcon size={15} />
            </Link>
          ) : (
            <span className={cn(navClass, "pointer-events-none opacity-40")} aria-hidden>
              <CaretLeftIcon size={15} />
            </span>
          )}
          <h2 className="min-w-24 text-center text-[13px] font-semibold" aria-live="polite">
            {label}
          </h2>
          <Link href={`/team?week=${shiftDate(weekStart, 7)}`} className={navClass} aria-label="Next week">
            <CaretRightIcon size={15} />
          </Link>
          {weekStart !== thisWeek && (
            <Link
              href="/team"
              className="ml-1 inline-flex h-7 items-center rounded-md border border-border px-2.5 text-[12.5px] font-medium hover:border-border-strong"
            >
              This week
            </Link>
          )}
        </nav>
        <p className="min-w-0 flex-1 basis-64 text-[12.5px] text-muted">
          Drag a task to hand it to someone else or move its day. Days with {BUSY_DAY} or more
          due are tinted.
        </p>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto pb-10">
        {workload.people.length === 0 ? (
          <EmptyState icon={<UsersThreeIcon size={20} />} title="Nobody here yet">
            People show up once you share a workspace with them.
          </EmptyState>
        ) : (
          <WorkloadGrid workload={workload} viewerId={viewer.id} today={today} weekStart={weekStart} />
        )}
      </div>
    </>
  );
}

async function People({ viewer, today }: { viewer: CurrentUser; today: string }) {
  const team = await getTeam(viewer, today);
  const others = team.filter((p) => p.id !== viewer.id);
  const me = team.find((p) => p.id === viewer.id);
  const ordered = me ? [me, ...others] : others;

  return (
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
