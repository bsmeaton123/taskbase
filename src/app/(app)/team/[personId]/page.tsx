import { ArrowLeftIcon, CheckCircleIcon, CoffeeIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { TaskGroup } from "@/components/task-groups";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { Avatar } from "@/components/ui/avatar";
import { DUE_BUCKET_LABELS, dueBucket, type DueBucket } from "@/lib/dates";
import { getToday, requireUser } from "@/lib/session";
import { cn } from "@/lib/utils";
import { getPersonTasks, type MyTask } from "@/server/queries";

type Props = {
  params: Promise<{ personId: string }>;
  searchParams: Promise<{ task?: string; show?: string }>;
};

/** The title and the page load the same tasks; this runs the query once per request. */
const loadPersonTasks = cache(getPersonTasks);

function showParam(show: string | undefined) {
  return show === "completed" ? "closed" : "open";
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const [{ personId }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireUser();
  const data = await loadPersonTasks(viewer, personId, showParam(sp.show));
  return { title: data ? `${data.person.name}'s tasks` : "Team" };
}

const BUCKETS: DueBucket[] = ["overdue", "today", "tomorrow", "this_week", "later", "no_date"];

/** One person's tasks, grouped by due date, across the workspaces you share with them. */
export default async function PersonPage({ params, searchParams }: Props) {
  const [{ personId }, sp] = await Promise.all([params, searchParams]);
  const viewer = await requireUser();
  if (personId === viewer.id) redirect(sp.show === "completed" ? "/my-tasks?show=completed" : "/my-tasks");
  const show = showParam(sp.show);
  const [data, today] = await Promise.all([loadPersonTasks(viewer, personId, show), getToday()]);
  if (!data) notFound();
  const { person, tasks } = data;
  const first = person.name.split(" ")[0];

  const groups = new Map<DueBucket, MyTask[]>(BUCKETS.map((b) => [b, []]));
  if (show === "open") for (const t of tasks) groups.get(dueBucket(t.dueDate, today))!.push(t);

  const tab = (key: "open" | "closed", label: string) => (
    <Link
      href={key === "open" ? `/team/${person.id}` : `/team/${person.id}?show=completed`}
      role="tab"
      aria-selected={show === key}
      className={cn(
        "inline-flex h-full items-center rounded-[5px] px-2.5 text-[13px] font-medium",
        show === key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          title={
            <span className="flex min-w-0 items-center gap-2">
              <Avatar person={person} size="sm" />
              <span className="truncate">{person.name}</span>
              {person.banned && (
                <span className="shrink-0 text-[12px] font-normal text-subtle">(deactivated)</span>
              )}
            </span>
          }
          leading={
            <Link
              href="/team"
              className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-text"
              aria-label="Back to team"
            >
              <ArrowLeftIcon size={15} />
              <span className="hidden sm:inline">Team</span>
              <span className="text-subtle">/</span>
            </Link>
          }
        >
          <div
            role="tablist"
            className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-0.5"
          >
            {tab("open", "To do")}
            {tab("closed", "Completed")}
          </div>
        </PageHeader>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-16">
          {show === "open" ? (
            tasks.length === 0 ? (
              <EmptyState icon={<CoffeeIcon size={20} />} title={`Nothing open for ${first}`}>
                Tasks assigned to {first} in the workspaces you share show up here.
              </EmptyState>
            ) : (
              BUCKETS.map((b) => (
                <TaskGroup
                  key={b}
                  title={DUE_BUCKET_LABELS[b]}
                  tasks={groups.get(b)!}
                  tone={b === "overdue" ? "danger" : undefined}
                  // Today always shows in full; long backlogs fold after 10 so Today stays near the top.
                  collapseAfter={b === "today" ? undefined : 10}
                />
              ))
            )
          ) : tasks.length === 0 ? (
            <EmptyState icon={<CheckCircleIcon size={20} />} title="No completed tasks yet">
              Tasks {first} resolves in your shared workspaces are listed here.
            </EmptyState>
          ) : (
            <TaskGroup title="Recently completed" tasks={tasks} />
          )}
        </div>
      </div>
      <TaskPanelSlot taskId={sp.task} />
    </div>
  );
}
