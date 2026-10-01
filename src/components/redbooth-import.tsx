"use client";

import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  PlugsConnectedIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { perform } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/input";
import { formatTimestamp } from "@/lib/dates";
import { joinNames } from "@/lib/insights";
import type { ImportProgress, ImportProjectState } from "@/lib/redbooth";
import { pluralize } from "@/lib/utils";
import {
  connectRedboothWithToken,
  disconnectRedbooth,
  startRedboothImport,
} from "@/server/actions/redbooth";
import { PRODUCT_NAME } from "@/lib/product";

export type ImportView = {
  oauth: boolean;
  callbackUrl: string;
  connection: { name: string | null; email: string | null; expires: boolean } | null;
  /** The outcome of coming back from Redbooth sign-in. */
  notice: { text: string; error: boolean } | null;
  loadError: string | null;
  catalogue: {
    projects: { id: string; name: string; importedAs: { id: string; name: string } | null }[];
    people: {
      total: number;
      matched: number;
      missing: { name: string; email: string | null }[];
      deactivated: string[];
    };
  } | null;
  job: {
    state: "running" | "interrupted" | "done" | "failed";
    progress: ImportProgress;
    error: string | null;
    finishedAt: Date | null;
  } | null;
};

export function RedboothImport({ view }: { view: ImportView }) {
  const router = useRouter();
  const running = view.job?.state === "running";

  // Back from Redbooth sign-in: confirm once (as connecting with a token does), then drop
  // ?connected from the address so the message doesn't linger or return on refresh.
  const connected = view.notice && !view.notice.error ? view.notice.text : null;
  useEffect(() => {
    if (!connected) return;
    toast.success(connected, { id: "redbooth-connected" });
    router.replace("/import", { scroll: false });
  }, [connected, router]);

  // While an import runs, keep the page fresh.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [running, router]);

  return (
    <div className="mx-auto grid max-w-2xl gap-10 px-4 py-8 sm:px-6">
      <p className="max-w-[70ch] text-[13.5px] text-muted">
        Bring your Redbooth projects across. Each project becomes a workspace with its task
        lists, tasks, subtasks, comments, files and who&apos;s on what. Nothing changes in
        Redbooth, and a project is only ever imported once.
      </p>

      {view.notice?.error && (
        <p
          role="alert"
          className="-mt-4 flex items-start gap-2 rounded-[10px] bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger-text"
        >
          <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
          {view.notice.text}
        </p>
      )}

      <Connection view={view} />
      {view.job && <Progress job={view.job} />}
      {view.loadError && (
        <p role="alert" className="flex items-start gap-2 text-[13px] text-danger-text">
          <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0" />
          {view.loadError}
        </p>
      )}
      {view.catalogue && <People people={view.catalogue.people} />}
      {view.catalogue && <Projects projects={view.catalogue.projects} busy={running} />}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Connection({ view }: { view: ImportView }) {
  const [token, setToken] = useState("");
  const [pending, startTransition] = useTransition();
  const [disconnecting, setDisconnecting] = useState(false);

  if (view.connection) {
    const who = [view.connection.name, view.connection.email && `(${view.connection.email})`]
      .filter(Boolean)
      .join(" ");
    return (
      <Section title="Redbooth account">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] border border-border bg-surface px-3.5 py-3">
          <PlugsConnectedIcon size={18} className="shrink-0 text-success" />
          <p className="min-w-0 flex-1 text-[13.5px]">
            Connected as <span className="font-medium">{who || "your Redbooth account"}</span>
            {view.connection.expires && (
              <span className="block text-[12.5px] text-muted">
                Access tokens last two hours; paste a new one if it runs out.
              </span>
            )}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setDisconnecting(true)}>
            Disconnect
          </Button>
        </div>
        <ConfirmDialog
          open={disconnecting}
          onOpenChange={setDisconnecting}
          title="Disconnect Redbooth?"
          description="Imported workspaces stay as they are. You can connect again at any time."
          confirmLabel="Disconnect"
          danger={false}
          onConfirm={() => perform(disconnectRedbooth())}
        />
      </Section>
    );
  }

  return (
    <Section title="Redbooth account">
      {view.oauth ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" asChild>
            <a href="/api/redbooth/connect">Connect Redbooth</a>
          </Button>
          <p className="text-[12.5px] text-muted">
            You&apos;ll sign in to Redbooth and allow {PRODUCT_NAME} to read your projects.
          </p>
        </div>
      ) : (
        <>
          <form
            method="post"
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await perform(connectRedboothWithToken(token), {
                  success: "Redbooth is connected",
                });
                if (res.ok) setToken("");
              });
            }}
          >
            <Field
              label="Redbooth access token"
              htmlFor="rb-token"
              hint="An OAuth access token for an admin's Redbooth account. It's stored encrypted and lasts two hours."
            >
              <Input
                id="rb-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the token"
              />
            </Field>
            <div>
              <Button type="submit" variant="primary" disabled={pending || token.trim().length < 10}>
                {pending ? "Checking…" : "Connect"}
              </Button>
            </div>
          </form>
          <p className="max-w-[70ch] text-[12.5px] text-muted">
            To use Redbooth sign-in instead, register an app in Redbooth with the callback URL{" "}
            <code className="rounded bg-surface-2 px-1 font-mono text-[12px] text-text">
              {view.callbackUrl}
            </code>
            , then set <code className="font-mono text-[12px] text-text">REDBOOTH_CLIENT_ID</code>{" "}
            and <code className="font-mono text-[12px] text-text">REDBOOTH_CLIENT_SECRET</code> on
            the server.
          </p>
        </>
      )}
    </Section>
  );
}

function People({ people }: { people: NonNullable<ImportView["catalogue"]>["people"] }) {
  const allMatched = people.missing.length === 0;
  return (
    <Section title="People">
      <p className="text-[13.5px]">
        <span className="tabular font-medium">{people.matched}</span> of{" "}
        <span className="tabular">{people.total}</span> people in Redbooth have a {PRODUCT_NAME} account
        with the same email.
      </p>
      {!allMatched && (
        <div className="grid gap-2 rounded-[10px] border border-border bg-surface p-3.5">
          <p className="text-[13px] text-muted">
            Invite these people from{" "}
            <Link href="/people" className="font-medium text-accent-text hover:underline">
              People
            </Link>{" "}
            before importing, so their tasks and comments stay theirs. Anyone without an account
            is left off assignments, and their comments start with their name.
          </p>
          <ul className="grid gap-1 text-[13px]">
            {people.missing.map((p) => (
              <li key={`${p.name}-${p.email}`} className="flex min-w-0 gap-2">
                <span className="truncate">{p.name}</span>
                {p.email && <span className="truncate text-subtle">{p.email}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {people.deactivated.length > 0 && (
        <p className="text-[12.5px] text-muted">
          Deactivated here, so left off assignments: {people.deactivated.join(", ")}.
        </p>
      )}
    </Section>
  );
}

function Projects({
  projects,
  busy,
}: {
  projects: NonNullable<ImportView["catalogue"]>["projects"];
  busy: boolean;
}) {
  const router = useRouter();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const available = projects.filter((p) => !p.importedAs);
  const allOn = available.length > 0 && available.every((p) => chosen.has(p.id));

  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Section title="Projects">
      {projects.length === 0 ? (
        <p className="text-[13.5px] text-muted">This Redbooth account can&apos;t see any projects.</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
            {available.length > 1 && (
              <label className="flex h-10 cursor-pointer items-center gap-3 border-b border-border px-3.5 text-[13px] font-medium text-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  ref={(el) => {
                    if (el) el.indeterminate = chosen.size > 0 && !allOn;
                  }}
                  checked={allOn}
                  onChange={() => setChosen(allOn ? new Set() : new Set(available.map((p) => p.id)))}
                />
                Select all
              </label>
            )}
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id}>
                  {p.importedAs ? (
                    <div className="flex min-h-11 items-center gap-3 px-3.5 py-2">
                      <CheckCircleIcon size={16} weight="fill" className="shrink-0 text-success" />
                      <span className="min-w-0 flex-1 truncate text-[14px] text-muted">{p.name}</span>
                      <Link
                        href={`/w/${p.importedAs.id}`}
                        className="shrink-0 text-[12.5px] font-medium text-accent-text hover:underline"
                      >
                        Imported
                      </Link>
                    </div>
                  ) : (
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3.5 py-2 hover:bg-surface-2/60">
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-accent"
                        checked={chosen.has(p.id)}
                        onChange={() => toggle(p.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
                    </label>
                  )}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              disabled={busy || pending || chosen.size === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await perform(startRedboothImport([...chosen]));
                  if (res.ok) {
                    setChosen(new Set());
                    router.refresh();
                  }
                })
              }
            >
              {pending
                ? "Starting…"
                : chosen.size > 0
                  ? `Import ${pluralize(chosen.size, "project")}`
                  : "Import projects"}
            </Button>
            {busy && (
              <p className="text-[12.5px] text-muted">
                An import is running. You can start another when it finishes.
              </p>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

const STATUS: Record<ImportProjectState["status"], { icon: React.ReactNode; label: string }> = {
  waiting: { icon: <CircleDashedIcon size={16} className="text-subtle" />, label: "Waiting" },
  importing: {
    icon: <CircleNotchIcon size={16} className="text-accent motion-safe:animate-spin" />,
    label: "Importing",
  },
  done: { icon: <CheckCircleIcon size={16} weight="fill" className="text-success" />, label: "Imported" },
  skipped: { icon: <MinusCircleIcon size={16} className="text-muted" />, label: "Skipped" },
  failed: { icon: <XCircleIcon size={16} weight="fill" className="text-danger-text" />, label: "Failed" },
};

function Progress({ job }: { job: NonNullable<ImportView["job"]> }) {
  const title =
    job.state === "running"
      ? "Importing"
      : job.state === "interrupted"
        ? "Import stopped part-way"
        : job.state === "failed"
          ? "Import didn't finish"
          : "Last import";
  return (
    <Section title={title}>
      <div aria-live="polite" className="grid gap-3">
        {job.state === "running" && job.progress.step && (
          <p className="text-[13px] text-muted">{job.progress.step}…</p>
        )}
        {job.state === "interrupted" && (
          <p className="text-[13px] text-muted">
            The import stopped making progress, probably because the server restarted. Start it
            again: projects that finished are skipped.
          </p>
        )}
        {job.error && (
          <p role="alert" className="text-[13px] text-danger-text">
            {job.error}
          </p>
        )}
        <ul className="divide-y divide-border overflow-hidden rounded-[10px] border border-border bg-surface">
          {job.progress.projects.map((p) => {
            const s = STATUS[p.status];
            const c = p.counts;
            return (
              <li key={p.id} className="flex items-start gap-3 px-3.5 py-2.5">
                <span className="mt-0.5 inline-flex shrink-0" title={s.label}>
                  {s.icon}
                  <span className="sr-only">{s.label}: </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px]">
                    {p.workspaceId && p.status === "done" ? (
                      <Link href={`/w/${p.workspaceId}`} className="hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      p.name
                    )}
                  </p>
                  {c && (
                    <p className="tabular text-[12.5px] text-muted">
                      {/* Tasks always; the rest only when there were some. */}
                      {joinNames([
                        pluralize(c.tasks, "task"),
                        ...(c.subtasks ? [pluralize(c.subtasks, "subtask")] : []),
                        ...(c.comments ? [pluralize(c.comments, "comment")] : []),
                        ...(c.files ? [pluralize(c.files, "file")] : []),
                      ])}
                      {c.filesSkipped > 0 && (
                        <span className="text-warning-text">
                          {" "}
                          ({pluralize(c.filesSkipped, "file")} too big or unavailable)
                        </span>
                      )}
                    </p>
                  )}
                  {p.note && <p className="text-[12.5px] text-muted">{p.note}</p>}
                </div>
              </li>
            );
          })}
        </ul>
        {job.finishedAt && job.state !== "running" && (
          <p className="tabular text-[12px] text-subtle" suppressHydrationWarning>
            Finished {formatTimestamp(job.finishedAt)}
          </p>
        )}
      </div>
    </Section>
  );
}
