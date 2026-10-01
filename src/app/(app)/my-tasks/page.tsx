import { CheckCircleIcon, CoffeeIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { CatchMeUp, HeadsUp } from "@/components/ai/digest";
import { EmptyState, PageHeader } from "@/components/page-header";
import { SubtaskGroup, TaskGroup } from "@/components/task-groups";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { ClearAllUpdates, UpdatesList, UpdatesProvider } from "@/components/updates-list";
import { DUE_BUCKET_LABELS, dueBucket, type DueBucket } from "@/lib/dates";
import { getToday, requireUser } from "@/lib/session";
import { updatesCountLabel } from "@/lib/updates";
import { cn } from "@/lib/utils";
import { myInsights } from "@/server/ai/context";
import { getMyTasks, type MyTask } from "@/server/queries";
import { getUpdates } from "@/server/updates";

export const metadata: Metadata = { title: "My tasks" };

const BUCKETS: DueBucket[] = ["overdue", "today", "tomorrow", "this_week", "later", "no_date"];

const TAB_HREFS = {
  open: "/my-tasks",
  closed: "/my-tasks?show=completed",
  updates: "/my-tasks?show=updates",
};

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ task?: string; show?: string }>;
}) {
  const sp = await searchParams;
  const show = sp.show === "completed" ? "closed" : sp.show === "updates" ? "updates" : "open";
  const viewer = await requireUser();
  const [{ tasks, subtasks }, today, insights, updates] = await Promise.all([
    show === "updates" ? { tasks: [], subtasks: [] } : getMyTasks(viewer, show),
    getToday(),
    show === "open" ? myInsights(viewer) : Promise.resolve([]),
    // Always loaded: the Updates tab shows how many there are.
    getUpdates(viewer),
  ]);
  // Overdue and due-soon work already has its own groups below.
  const headsUp = insights.filter((i) => i.kind === "stale" || i.kind === "long_on_hold");

  const groups = new Map<DueBucket, MyTask[]>(BUCKETS.map((b) => [b, []]));
  if (show === "open") {
    for (const t of tasks) groups.get(dueBucket(t.dueDate, today))!.push(t);
  }

  const tab = (key: typeof show, label: string, count?: number) => (
    <Link
      href={TAB_HREFS[key]}
      role="tab"
      aria-selected={show === key}
      className={cn(
        "inline-flex h-full items-center rounded-[5px] px-2 text-[13px] font-medium sm:px-2.5",
        show === key ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
      )}
    >
      {label}
      {count ? (
        <span className="tabular ml-1.5 font-normal text-subtle">{updatesCountLabel(count)}</span>
      ) : null}
    </Link>
  );

  const page = (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="My tasks" keepTitle>
          {show === "updates" && <ClearAllUpdates className="max-sm:hidden" />}
          <div
            role="tablist"
            className="inline-flex h-8 items-center rounded-md border border-border bg-surface-2 p-0.5"
          >
            {tab("open", "To do")}
            {tab("closed", "Completed")}
            {tab("updates", "Updates", updates.length)}
          </div>
        </PageHeader>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-16">
          {show === "open" && (tasks.length > 0 || subtasks.length > 0) && <CatchMeUp />}
          {show === "open" && <HeadsUp insights={headsUp} />}
          {show === "updates" ? (
            <UpdatesList />
          ) : show === "open" ? (
            tasks.length === 0 && subtasks.length === 0 ? (
              <EmptyState icon={<CoffeeIcon size={20} />} title="Nothing assigned to you">
                Tasks and subtasks assigned to you across every workspace show up here,
                grouped by when they&apos;re due.
              </EmptyState>
            ) : (
              <>
                {BUCKETS.map((b) => (
                  <TaskGroup
                    key={b}
                    title={DUE_BUCKET_LABELS[b]}
                    tasks={groups.get(b)!}
                    tone={b === "overdue" ? "danger" : undefined}
                    // Today always shows in full; long backlogs fold after 10 so Today stays near the top.
                    collapseAfter={b === "today" ? undefined : 10}
                  />
                ))}
                <SubtaskGroup subtasks={subtasks} />
              </>
            )
          ) : tasks.length === 0 ? (
            <EmptyState icon={<CheckCircleIcon size={20} />} title="No completed tasks yet">
              When you resolve tasks assigned to you, they&apos;ll be listed here.
            </EmptyState>
          ) : (
            <TaskGroup title="Recently completed" tasks={tasks} />
          )}
        </div>
      </div>
      <TaskPanelSlot taskId={sp.task} />
    </div>
  );

  return show === "updates" ? <UpdatesProvider cards={updates}>{page}</UpdatesProvider> : page;
}
