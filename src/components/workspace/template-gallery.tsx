"use client";

import { CopySimpleIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useState } from "react";
import { useApp } from "@/components/app-context";
import { EmptyState } from "@/components/page-header";
import { WorkspaceMark } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { pluralize } from "@/lib/utils";
import type { TemplateSummary } from "@/server/queries";
import { DuplicateWorkspaceDialog } from "./duplicate-dialog";

export function TemplateGallery({ templates }: { templates: TemplateSummary[] }) {
  const { people } = useApp();
  const [using, setUsing] = useState<TemplateSummary | null>(null);

  if (templates.length === 0)
    return (
      <EmptyState icon={<CopySimpleIcon size={20} />} title="No templates yet">
        Open a workspace you run often, like client onboarding or a monthly close, and choose
        Save as template from its menu. Anyone can then start from it.
      </EmptyState>
    );

  return (
    <>
      <ul className="mx-auto grid max-w-4xl grid-cols-1 gap-3 px-4 py-6 sm:grid-cols-2 sm:px-6">
        {templates.map((t) => (
          <li
            key={t.id}
            className="flex flex-col gap-3 rounded-[10px] border border-border bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <WorkspaceMark color={t.color} size={12} className="rounded-[4px]" />
              <h2 className="min-w-0 flex-1 truncate font-semibold tracking-tight">{t.name}</h2>
            </div>
            {t.description && (
              <p className="line-clamp-2 text-[13px] text-muted">{t.description}</p>
            )}
            <p className="tabular text-[12.5px] text-subtle">
              {pluralize(t.listCount, "list")}, {pluralize(t.taskCount, "task")}
              {t.createdByName ? `. Made by ${t.createdByName}` : ""}
            </p>
            <div className="mt-auto flex gap-2">
              {/* Secondary, not primary: a gallery of cards would otherwise be a wall of blue. */}
              <Button size="sm" onClick={() => setUsing(t)}>
                Use template
              </Button>
              {t.canEdit && (
                <Button size="sm" variant="ghost" asChild>
                  <Link href={`/w/${t.id}`}>Edit</Link>
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {using && (
        <DuplicateWorkspaceDialog
          open
          onOpenChange={(o) => !o && setUsing(null)}
          mode="use-template"
          source={using}
          people={people}
        />
      )}
    </>
  );
}
