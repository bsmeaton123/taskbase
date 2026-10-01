import { MagnifyingGlassIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { EmptyState, PageHeader } from "@/components/page-header";
import { SearchBox } from "@/components/search-box";
import { TaskGroup } from "@/components/task-groups";
import { TaskPanelSlot } from "@/components/task-panel/task-panel-slot";
import { requireUser } from "@/lib/session";
import { searchTasks } from "@/server/queries";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; task?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 200);
  const viewer = await requireUser();
  const results = q ? await searchTasks(viewer, q) : [];

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <PageHeader title="Search" />
        <div className="border-b border-border px-4 py-3 sm:px-6">
          <SearchBox initial={q} />
        </div>
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-16">
          {!q ? (
            <EmptyState icon={<MagnifyingGlassIcon size={20} />} title="Search every workspace">
              Find tasks by title, description, subtask or comment text. Type a number
              like #142 to find that task.
            </EmptyState>
          ) : results.length === 0 ? (
            <EmptyState icon={<MagnifyingGlassIcon size={20} />} title="No matches">
              Nothing in your workspaces matches “{q}”. Try a shorter or different phrase.
            </EmptyState>
          ) : (
            <TaskGroup
              title={results.length === 60 ? "First 60 results" : "Results"}
              tasks={results}
            />
          )}
        </div>
      </div>
      <TaskPanelSlot taskId={sp.task} />
    </div>
  );
}
