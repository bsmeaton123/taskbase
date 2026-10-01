"use client";

import { CopySimpleIcon, SparkleIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { formatDue } from "@/lib/dates";
import { joinNames } from "@/lib/insights";
import { suggestTaskDefaults, type TaskSuggestion } from "@/server/actions/ai";

/**
 * While someone types a new task title: warn about likely duplicates (always)
 * and suggest list / assignees / due date from similar tasks (with AI).
 */
export function TaskSuggestions({
  workspaceId,
  title,
  onApply,
}: {
  workspaceId: string;
  title: string;
  onApply: (d: NonNullable<TaskSuggestion["defaults"]>) => void;
}) {
  const { ai, today } = useApp();
  const [result, setResult] = useState<TaskSuggestion | null>(null);
  const [applied, setApplied] = useState(false);
  const asked = useRef<string>("");

  useEffect(() => {
    const t = title.trim();
    if (t.length < 6) return;
    const id = setTimeout(async () => {
      if (asked.current === t) return;
      asked.current = t;
      // AI suggestions only for substantial titles; duplicate checks are cheap.
      const res = await suggestTaskDefaults(workspaceId, t, ai && t.length >= 12);
      if (res.ok && asked.current === t) {
        setResult(res.data);
        setApplied(false);
      }
    }, 900);
    return () => clearTimeout(id);
  }, [title, workspaceId, ai]);

  if (!result || title.trim().length < 6) return null;
  const d = result.defaults;

  return (
    <div className="grid gap-2">
      {result.duplicates.length > 0 && (
        <div className="rounded-[10px] bg-warning-soft px-3 py-2 text-[12.5px]">
          <p className="flex items-center gap-1.5 font-medium text-warning-text">
            <CopySimpleIcon size={13} className="shrink-0" />
            {result.duplicates.length === 1
              ? "A similar open task already exists"
              : "Similar open tasks already exist"}
          </p>
          <ul className="mt-1 grid gap-0.5">
            {result.duplicates.map((x) => (
              <li key={x.id}>
                <Link href={`/t/${x.number}`} target="_blank" className="text-text hover:underline">
                  <span className="font-mono text-[11.5px] text-subtle">#{x.number}</span> {x.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d && !applied && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-accent/25 bg-accent-soft/35 px-3 py-2 text-[12.5px]">
          <SparkleIcon size={13} weight="fill" className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-muted">
            Suggested:{" "}
            <span className="tabular text-text">
              {[
                d.listName,
                joinNames(d.assignees.map((a) => a.name)),
                d.dueDate && `due ${formatDue(d.dueDate, today)}`,
              ]
                .filter(Boolean)
                .join(", ")}
            </span>
            {d.reason && <span className="block text-subtle">{d.reason}</span>}
          </span>
          <Button
            size="sm"
            onClick={() => {
              onApply(d);
              setApplied(true);
            }}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
