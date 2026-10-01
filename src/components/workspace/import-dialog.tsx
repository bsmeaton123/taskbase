"use client";

import { FileArrowUpIcon, WarningIcon } from "@phosphor-icons/react/ssr";
import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { StatusPill } from "@/components/task-bits";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  FIELD_LABELS,
  guessDateOrder,
  guessMapping,
  IMPORT_FIELDS,
  matchPeople,
  parseCsv,
  parseDate,
  parseStatus,
  parseTags,
  parseUrgent,
  type DateOrder,
  type ImportField,
} from "@/lib/csv-import";
import { formatDue } from "@/lib/dates";
import { cn, pluralize } from "@/lib/utils";
import { importTasks, type ImportRow } from "@/server/actions/import";
import type { Member } from "@/server/queries";

// Matches the Input field: stronger border on hover, blue border and halo on focus.
const selectClass =
  "h-8 w-full rounded-md border border-border bg-surface px-2 text-[13px] text-text transition-colors hover:border-border-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

export function ImportTasksDialog({
  open,
  onOpenChange,
  workspaceId,
  lists,
  members,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  lists: { id: string; name: string }[];
  members: Member[];
}) {
  const { today } = useApp();
  const [table, setTable] = useState<{ fileName: string; headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [dateOrder, setDateOrder] = useState<DateOrder>("dmy");
  const [defaultListId, setDefaultListId] = useState(lists[0]?.id ?? "");
  const [pending, startTransition] = useTransition();
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function load(text: string, fileName: string) {
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      toast.error("That file needs a header row and at least one task.");
      return;
    }
    const [headers, ...rows] = parsed;
    const guess = guessMapping(headers);
    setTable({ fileName, headers, rows });
    setMapping(guess);
    setDateOrder(
      guess.dueDate !== undefined ? guessDateOrder(rows.map((r) => r[guess.dueDate!] ?? "")) : "dmy",
    );
  }

  const prepared = useMemo(() => {
    if (!table) return null;
    const cell = (row: string[], field: ImportField) =>
      mapping[field] === undefined ? "" : (row[mapping[field]!] ?? "").trim();
    let missingTitle = 0;
    let unmatched = 0;
    let badDates = 0;
    const rows: ImportRow[] = [];
    for (const r of table.rows) {
      const title = cell(r, "title");
      if (!title) {
        missingTitle++;
        continue;
      }
      // One cell can name several people: "Priya, Sam and Lee".
      const who = cell(r, "assignee");
      const people = who ? matchPeople(who, members) : { matched: [], unmatched: [] };
      unmatched += people.unmatched.length;
      const rawDate = cell(r, "dueDate");
      const dueDate = rawDate ? parseDate(rawDate, dateOrder) : null;
      if (rawDate && !dueDate) badDates++;
      const rawStart = cell(r, "startDate");
      let startDate = rawStart ? parseDate(rawStart, dateOrder) : null;
      if (rawStart && !startDate) badDates++;
      if (startDate && dueDate && startDate > dueDate) startDate = null;
      rows.push({
        title: title.slice(0, 300),
        description: cell(r, "description").slice(0, 20000) || undefined,
        list: cell(r, "list").slice(0, 80) || undefined,
        assigneeIds: people.matched.slice(0, 20).map((p) => p.id),
        startDate,
        dueDate,
        status: mapping.status !== undefined ? parseStatus(cell(r, "status")) : "open",
        // A "Completed At" column doubles as the completion date.
        completedOn:
          mapping.status !== undefined ? parseDate(cell(r, "status"), dateOrder) : null,
        urgent: mapping.urgent !== undefined ? parseUrgent(cell(r, "urgent")) : false,
        tags: mapping.tags !== undefined ? parseTags(cell(r, "tags")) : undefined,
      });
    }
    const existing = new Set(lists.map((l) => l.name.trim().toLowerCase()));
    const newLists = [
      ...new Set(rows.map((r) => r.list).filter((l): l is string => Boolean(l))),
    ].filter((l) => !existing.has(l.toLowerCase()));
    return { rows, missingTitle, unmatched, badDates, newLists };
  }, [table, mapping, dateOrder, members, lists]);

  function close(o: boolean) {
    onOpenChange(o);
    if (!o) setTable(null);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        title="Import tasks"
        description="Bring tasks in from a CSV export (Redbooth, Asana, Trello, a spreadsheet…)."
        className="max-w-2xl"
      >
        {!table ? (
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragOver(false);
                const file = e.dataTransfer.files[0];
                if (!file) return;
                if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
                  toast.error("That isn't a CSV file. Export your tasks as CSV and drop that file here.");
                  return;
                }
                load(await file.text(), file.name);
              }}
              className={cn(
                // Children ignore the pointer so moving over them doesn't end the drag highlight.
                "flex flex-col items-center gap-2 rounded-[10px] border border-dashed border-border-strong px-4 py-8 text-center transition-colors hover:border-accent hover:bg-accent-soft/30 [&_*]:pointer-events-none",
                dragOver && "border-accent bg-accent-soft/30",
              )}
            >
              <FileArrowUpIcon size={24} className="text-muted" />
              <span className="font-medium">Choose a CSV file or drop it here</span>
              <span className="text-[12.5px] text-muted">
                The first row should be column names, like Task, Assignee, Due date, List.
              </span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.tsv,.txt,text/csv"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) load(await file.text(), file.name);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-[13px] text-muted">
              {table.fileName}: {pluralize(table.rows.length, "row")}. Check which column holds
              what.
            </p>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
              {IMPORT_FIELDS.map((field) => (
                <label key={field} className="grid gap-1 text-[12.5px] font-medium">
                  {FIELD_LABELS[field]}
                  {field === "title" && <span className="sr-only">(required)</span>}
                  <select
                    className={selectClass}
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((m) => ({
                        ...m,
                        [field]: e.target.value === "" ? undefined : Number(e.target.value),
                      }))
                    }
                  >
                    <option value="">{field === "title" ? "Choose a column" : "Don't import"}</option>
                    {table.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label className="grid gap-1 text-[12.5px] font-medium">
                Tasks without a list go to
                <select
                  className={selectClass}
                  value={defaultListId}
                  onChange={(e) => setDefaultListId(e.target.value)}
                >
                  {lists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              {mapping.dueDate !== undefined && (
                <label className="grid gap-1 text-[12.5px] font-medium">
                  Dates like 03/04/2026 mean
                  <select
                    className={selectClass}
                    value={dateOrder}
                    onChange={(e) => setDateOrder(e.target.value as DateOrder)}
                  >
                    <option value="dmy">3 April (day first)</option>
                    <option value="mdy">March 4 (month first)</option>
                  </select>
                </label>
              )}
            </div>

            {prepared && mapping.title !== undefined && (
              <>
                <div className="overflow-x-auto rounded-[10px] border border-border">
                  <table className="w-full min-w-[520px] text-left text-[12.5px]">
                    <thead className="bg-surface-2 text-muted">
                      <tr>
                        <th className="px-2.5 py-1.5 font-medium">Task</th>
                        <th className="px-2.5 py-1.5 font-medium">List</th>
                        <th className="px-2.5 py-1.5 font-medium">Assignees</th>
                        <th className="px-2.5 py-1.5 font-medium">Due</th>
                        <th className="px-2.5 py-1.5 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {prepared.rows.slice(0, 5).map((r, i) => (
                        <tr key={i}>
                          <td className="px-2.5 py-1.5">
                            {/* Table cells ignore max-width, so the title truncates inside. */}
                            <span className="block max-w-56 truncate">{r.title}</span>
                          </td>
                          <td className="px-2.5 py-1.5 text-muted">
                            {r.list ?? lists.find((l) => l.id === defaultListId)?.name}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted">
                            {(r.assigneeIds ?? [])
                              .map((id) => members.find((m) => m.id === id)?.name)
                              .filter(Boolean)
                              .join(", ")}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted">
                            {r.dueDate ? formatDue(r.dueDate, today) : ""}
                          </td>
                          <td className="px-2.5 py-1.5">
                            {r.status && r.status !== "open" ? <StatusPill status={r.status} /> : "Open"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {(prepared.missingTitle > 0 ||
                  prepared.unmatched > 0 ||
                  prepared.badDates > 0 ||
                  prepared.newLists.length > 0) && (
                  <ul className="grid gap-1 text-[12.5px] text-muted">
                    {prepared.newLists.length > 0 && (
                      <li>
                        New lists will be created: {prepared.newLists.slice(0, 6).join(", ")}
                        {prepared.newLists.length > 6 ? ` and ${prepared.newLists.length - 6} more` : ""}.
                      </li>
                    )}
                    {prepared.missingTitle > 0 && (
                      <li className="flex items-center gap-1.5 text-warning-text">
                        <WarningIcon size={13} className="shrink-0" />
                        {pluralize(prepared.missingTitle, "row")} without a title will be skipped.
                      </li>
                    )}
                    {prepared.unmatched > 0 && (
                      <li className="flex items-center gap-1.5 text-warning-text">
                        <WarningIcon size={13} className="shrink-0" />
                        {pluralize(prepared.unmatched, "assignee")} didn&apos;t match a member of this
                        workspace and won&apos;t be assigned.
                      </li>
                    )}
                    {prepared.badDates > 0 && (
                      <li className="flex items-center gap-1.5 text-warning-text">
                        <WarningIcon size={13} className="shrink-0" />
                        {pluralize(prepared.badDates, "date")} couldn&apos;t be read and will be left empty.
                      </li>
                    )}
                  </ul>
                )}
              </>
            )}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" disabled={pending} onClick={() => setTable(null)}>
                Choose another file
              </Button>
              <Button
                variant="primary"
                disabled={pending || !prepared || mapping.title === undefined || prepared.rows.length === 0}
                onClick={() =>
                  startTransition(async () => {
                    if (!prepared) return;
                    // Send in batches so large files stay under request size limits.
                    let created = 0;
                    let listsCreated = 0;
                    for (let i = 0; i < prepared.rows.length; i += 200) {
                      const res = await perform(
                        importTasks({
                          workspaceId,
                          defaultListId,
                          rows: prepared.rows.slice(i, i + 200),
                        }),
                      );
                      if (!res.ok) {
                        if (created > 0)
                          toast.warning(
                            `Imported the first ${pluralize(created, "task")} before stopping.`,
                          );
                        return;
                      }
                      created += res.data.created;
                      listsCreated += res.data.listsCreated;
                    }
                    toast.success(
                      `Imported ${pluralize(created, "task")}${
                        listsCreated ? ` and created ${pluralize(listsCreated, "list")}` : ""
                      }`,
                    );
                    close(false);
                  })
                }
              >
                {pending
                  ? "Importing…"
                  : `Import ${prepared ? pluralize(prepared.rows.length, "task") : "tasks"}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
