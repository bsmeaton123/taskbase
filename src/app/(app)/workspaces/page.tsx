import { SquaresFourIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import { JoinWorkspaceButton } from "@/components/workspace/join-button";
import { TemplateGallery } from "@/components/workspace/template-gallery";
import { getToday, requireUser } from "@/lib/session";
import { cn, pluralize } from "@/lib/utils";
import {
  getArchivedWorkspaces,
  getMyWorkspaceOverview,
  getOtherWorkspaces,
  getTemplates,
} from "@/server/queries";

export const metadata: Metadata = { title: "Workspaces" };

const EMPTY = {
  mine: {
    title: "No workspaces yet",
    body: "Workspaces you're a member of will be listed here. Create one from the sidebar to get started.",
  },
  archived: {
    title: "No archived workspaces",
    body: "Archived workspaces you belong to will be listed here.",
  },
  other: {
    title: "You're in every workspace",
    body: "Workspaces you're not a member of will be listed here, so you can open or join them.",
  },
};

export default async function WorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: tabParam } = await searchParams;
  const viewer = await requireUser();
  const tab =
    tabParam === "archived" || tabParam === "templates"
      ? tabParam
      : tabParam === "other" && viewer.isAdmin
        ? "other"
        : "mine";

  const today = await getToday();
  const [mine, archived, others, templates] = await Promise.all([
    getMyWorkspaceOverview(viewer, today),
    getArchivedWorkspaces(viewer),
    getOtherWorkspaces(viewer),
    getTemplates(viewer),
  ]);

  const tabs = [
    { key: "mine", label: "Your workspaces", count: mine.length },
    { key: "templates", label: "Templates", count: templates.length },
    { key: "archived", label: "Archived", count: archived.length },
    ...(viewer.isAdmin ? [{ key: "other", label: "Other workspaces", count: others.length }] : []),
  ];

  const rows =
    tab === "mine"
      ? []
      : tab === "archived"
        ? archived.map((w) => ({ ...w, note: "Archived", join: false }))
        : others.map((w) => ({
            ...w,
            note: `${pluralize(w.memberCount, "member")}${w.archivedAt ? ", archived" : ""}`,
            join: true,
          }));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Workspaces" />
      <div className="border-b border-border">
        <div className="scrollbar-thin flex gap-1 overflow-x-auto px-4 sm:px-6" role="tablist">
          {tabs.map((t) => (
            <Link
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              href={t.key === "mine" ? "/workspaces" : `/workspaces?tab=${t.key}`}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-2 text-[13px] font-medium",
                tab === t.key
                  ? "border-accent text-text"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
              <span className="tabular text-[12px] text-subtle">{t.count}</span>
            </Link>
          ))}
        </div>
      </div>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {tab === "templates" ? (
          <TemplateGallery templates={templates} />
        ) : tab === "mine" && mine.length > 0 ? (
          <ul className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-px px-4 py-6 sm:px-6">
            {mine.map((w) => (
              <li key={w.id}>
                <Link
                  href={`/w/${w.id}`}
                  className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-2"
                >
                  <WorkspaceMark color={w.color} size={12} className="rounded-[4px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{w.name}</span>
                    {w.description && (
                      <span className="block truncate text-[12.5px] text-muted">{w.description}</span>
                    )}
                  </span>
                  <span className="tabular shrink-0 text-right text-[12.5px] text-muted">
                    {w.open === 0 ? "Nothing open" : `${w.open} open`}
                    {w.overdue > 0 && <span className="text-danger-text">, {w.overdue} overdue</span>}
                  </span>
                  <span className="tabular hidden w-24 shrink-0 text-right text-[12.5px] text-subtle sm:inline">
                    {pluralize(w.members, "person", "people")}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : tab === "mine" || rows.length === 0 ? (
          <EmptyState icon={<SquaresFourIcon size={20} />} title={EMPTY[tab].title}>
            {EMPTY[tab].body}
          </EmptyState>
        ) : (
          <ul className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)] gap-px px-4 py-6 sm:px-6">
            {rows.map((w) => (
              <li
                key={w.id}
                className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-surface-2"
              >
                <WorkspaceMark color={w.color} size={12} className="rounded-[4px]" />
                <Link href={`/w/${w.id}`} className="min-w-0 flex-1 truncate font-medium">
                  {w.name}
                </Link>
                {w.note && <span className="tabular shrink-0 text-[12.5px] text-muted">{w.note}</span>}
                {w.join && <JoinWorkspaceButton workspaceId={w.id} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
