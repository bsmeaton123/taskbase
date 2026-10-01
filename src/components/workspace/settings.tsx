"use client";

import {
  CheckCircleIcon,
  CopyIcon,
  CrownSimpleIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  MinusCircleIcon,
  PencilSimpleIcon,
  SignOutIcon,
  TrashIcon,
  UserMinusIcon,
  UserPlusIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { ColorSwatches } from "@/components/color-swatches";
import { PersonPicker } from "@/components/pickers";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AutoTextarea, Field, Input } from "@/components/ui/input";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { workspaceSwatch } from "@/lib/colors";
import { formatTimestamp, timeAgo } from "@/lib/dates";
import { pluralize } from "@/lib/utils";
import { createTag, deleteTag, updateTag } from "@/server/actions/tags";
import {
  addWorkspaceMembers,
  deleteWorkspace,
  newInboundAddress,
  removeWorkspaceMember,
  setWorkspaceArchived,
  setWorkspaceMemberRole,
  updateWorkspace,
} from "@/server/actions/workspaces";
import { setWorkspaceTemplate } from "@/server/actions/templates";
import type { Member, Person } from "@/server/queries";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {description && <p className="text-[13px] text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function GeneralSettings({
  workspace,
  canManage,
}: {
  workspace: { id: string; name: string; description: string | null; color: string };
  canManage: boolean;
}) {
  const [color, setColor] = useState<string>(workspace.color);
  const [pending, startTransition] = useTransition();

  return (
    <Section
      title="General"
      description={canManage ? undefined : "Only workspace owners can change these."}
    >
      <form method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          startTransition(async () => {
            await perform(
              updateWorkspace({
                id: workspace.id,
                name: String(form.get("name") ?? ""),
                description: String(form.get("description") ?? ""),
                color,
              }),
              { success: "Workspace updated" },
            );
          });
        }}
      >
        <fieldset disabled={!canManage} className="grid gap-4">
          <Field label="Name" htmlFor="ws-name">
            <Input id="ws-name" name="name" defaultValue={workspace.name} required maxLength={80} />
          </Field>
          <Field label="Description" htmlFor="ws-description">
            <AutoTextarea
              id="ws-description"
              name="description"
              defaultValue={workspace.description ?? ""}
              maxLength={500}
              minRows={2}
            />
          </Field>
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium">Colour</span>
            <ColorSwatches value={color} onChange={setColor} />
          </div>
        </fieldset>
        {canManage && (
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        )}
      </form>
    </Section>
  );
}

export function MembersSettings({
  workspaceId,
  members,
  people,
  canManage,
  isMember,
}: {
  workspaceId: string;
  members: Member[];
  people: Person[];
  canManage: boolean;
  isMember: boolean;
}) {
  const { viewer } = useApp();
  const router = useRouter();
  const [, startTransition] = useTransition();
  // Removing someone also unassigns them from every task here, so it asks first.
  const [removing, setRemoving] = useState<Member | null>(null);
  const candidates = people.filter((p) => !members.some((m) => m.id === p.id));
  const leaving = removing?.id === viewer.id;

  return (
    <Section
      title="Members"
      description="Members can see and edit everything in this workspace. Owners can also rename, archive and remove people."
    >
      <div className="flex">
        {(isMember || canManage) && candidates.length > 0 ? (
          <PersonPicker
            allowNone={false}
            people={candidates}
            value={null}
            onChange={(id) =>
              id &&
              startTransition(async () => {
                await perform(addWorkspaceMembers(workspaceId, [id]), {
                  success: "Member added",
                });
              })
            }
          >
            <Button>
              <UserPlusIcon size={15} />
              Add member
            </Button>
          </PersonPicker>
        ) : isMember || canManage ? (
          <p className="text-[13px] text-muted">
            Everyone in the company is already a member. New people appear here once they sign up.
          </p>
        ) : null}
      </div>
      <ul className="divide-y divide-border rounded-[10px] border border-border">
        {members.map((m) => {
          const isSelf = m.id === viewer.id;
          return (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar person={m} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-medium">
                  {m.name}
                  {isSelf && <span className="font-normal text-muted"> (you)</span>}
                </p>
                <p className="truncate text-[12.5px] text-muted">{m.email}</p>
              </div>
              {m.role === "owner" && (
                <span className="inline-flex items-center gap-1 text-[12.5px] text-muted">
                  <CrownSimpleIcon size={13} weight="fill" className="text-warning" />
                  Owner
                </span>
              )}
              {(canManage || isSelf) && (
                <Menu>
                  <MenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`Options for ${m.name}`}>
                      <DotsThreeIcon size={18} weight="bold" />
                    </Button>
                  </MenuTrigger>
                  <MenuContent align="end">
                    {canManage && (
                      <MenuItem
                        onSelect={() =>
                          perform(
                            setWorkspaceMemberRole(
                              workspaceId,
                              m.id,
                              m.role === "owner" ? "member" : "owner",
                            ),
                          )
                        }
                      >
                        <CrownSimpleIcon size={16} />
                        {m.role === "owner" ? "Make regular member" : "Make owner"}
                      </MenuItem>
                    )}
                    <MenuItem danger onSelect={() => setRemoving(m)}>
                      {isSelf ? <SignOutIcon size={16} /> : <UserMinusIcon size={16} />}
                      {isSelf ? "Leave workspace" : "Remove from workspace"}
                    </MenuItem>
                  </MenuContent>
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={leaving ? "Leave this workspace?" : `Remove ${removing?.name ?? ""}?`}
        description={
          leaving
            ? "You lose access to it and are unassigned from its tasks. An owner can add you back."
            : "They lose access to this workspace and are unassigned from its tasks. You can add them back later, but their tasks stay unassigned."
        }
        confirmLabel={leaving ? "Leave workspace" : "Remove"}
        onConfirm={async () => {
          if (!removing) return;
          const res = await perform(removeWorkspaceMember(workspaceId, removing.id), {
            success: leaving ? "You left the workspace" : `Removed ${removing.name}`,
          });
          if (res.ok && leaving) router.push("/my-tasks");
        }}
      />
    </Section>
  );
}

export function DangerZone({
  workspace,
}: {
  workspace: { id: string; name: string; archived: boolean };
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();

  function setConfirmOpen(open: boolean) {
    setConfirming(open);
    if (!open) setTyped("");
  }

  return (
    <Section title="Archive or delete">
      <div className="grid gap-3 rounded-[10px] border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">
              {workspace.archived ? "Restore this workspace" : "Archive this workspace"}
            </p>
            <p className="text-[13px] text-muted">
              {workspace.archived
                ? "Bring it back to everyone's sidebar."
                : "Hide it from the sidebar and My tasks. Nothing is deleted."}
            </p>
          </div>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await perform(setWorkspaceArchived(workspace.id, !workspace.archived), {
                  success: workspace.archived ? "Workspace restored" : "Workspace archived",
                });
              })
            }
          >
            {workspace.archived ? "Restore" : "Archive"}
          </Button>
        </div>
        <div className="h-px bg-border" />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium text-danger-text">Delete this workspace</p>
            <p className="text-[13px] text-muted">
              Permanently deletes every list, task, subtask, comment and file in it.
            </p>
          </div>
          <Button variant="danger-ghost" onClick={() => setConfirming(true)}>
            Delete workspace
          </Button>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={setConfirmOpen}>
        <DialogContent
          title="Delete workspace?"
          description="This permanently deletes the workspace for everyone. It can't be undone."
        >
          <form method="post"
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              startTransition(async () => {
                const res = await perform(deleteWorkspace(workspace.id), {
                  success: "Workspace deleted",
                });
                if (res.ok) router.push("/my-tasks");
              });
            }}
          >
            <Field label={`Type “${workspace.name}” to confirm`} htmlFor="confirm-name">
              <Input
                id="confirm-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="danger"
                disabled={pending || typed.trim() !== workspace.name}
              >
                {pending ? "Deleting…" : "Delete workspace"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

export type InboundEmailRow = {
  id: string;
  senderEmail: string;
  subject: string;
  status: string;
  reason: string | null;
  createdAt: Date;
  taskNumber: number | null;
};

/** The workspace's email-in address, and what recently arrived at it. */
export function EmailInSettings({
  workspaceId,
  address,
  archived,
  canManage,
  recent,
}: {
  workspaceId: string;
  /** Null until an admin connects a mailbox on the server. */
  address: string | null;
  archived: boolean;
  canManage: boolean;
  recent: InboundEmailRow[];
}) {
  const [confirming, setConfirming] = useState(false);

  async function copy() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Email address copied");
    } catch {
      toast.error("Couldn't copy the address. Select it and copy it yourself.");
    }
  }

  return (
    <Section
      title="Email in"
      description="Forward or send an email to this address and it becomes a task in the first list, assigned to whoever sent it. The subject becomes the title, the message the description, and attachments come along. Only members can email in, from the address on their account."
    >
      {!address ? (
        <p className="rounded-[10px] border border-dashed border-border-strong px-3.5 py-3 text-[13px] text-muted">
          Not connected yet. An admin can turn it on by connecting a mailbox to the server
          (INBOUND_EMAIL_ADDRESS); the README explains how.
        </p>
      ) : (
        <>
          <div className="grid gap-2">
            <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
              <EnvelopeSimpleIcon size={15} className="shrink-0 text-muted" />
              <code className="min-w-0 flex-1 select-all truncate font-mono text-[12.5px]">
                {address}
              </code>
            </div>
            {archived && (
              <p className="text-[12.5px] text-warning-text">
                Emails are refused while the workspace is archived.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button onClick={copy}>
                <CopyIcon size={15} />
                Copy address
              </Button>
              {canManage && (
                <Button variant="ghost" onClick={() => setConfirming(true)}>
                  Get a new address
                </Button>
              )}
            </div>
          </div>
          <div className="grid gap-2">
            <h3 className="text-[13px] font-semibold">Recent emails</h3>
            {recent.length === 0 ? (
              <p className="text-[13px] text-muted">
                Nothing yet. Emails sent here show up in this list, including any that didn&apos;t
                become a task and why.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-[10px] border border-border">
                {recent.map((r) => (
                  <InboundRow key={r.id} row={r} />
                ))}
              </ul>
            )}
          </div>
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title="Get a new address?"
            description="The current address stops working straight away. Anyone who saved it, or set up a forwarding rule with it, will need the new one."
            confirmLabel="Get a new address"
            onConfirm={() =>
              perform(newInboundAddress(workspaceId), { success: "New address ready" })
            }
          />
        </>
      )}
    </Section>
  );
}

function InboundRow({ row }: { row: InboundEmailRow }) {
  const created = row.status === "created";
  return (
    <li className="flex items-start gap-2.5 px-3 py-2.5 text-[13px]">
      {created ? (
        <CheckCircleIcon size={16} weight="fill" className="mt-px shrink-0 text-success" aria-hidden />
      ) : row.status === "rejected" ? (
        <WarningCircleIcon size={16} weight="fill" className="mt-px shrink-0 text-danger-text" aria-hidden />
      ) : (
        <MinusCircleIcon size={16} className="mt-px shrink-0 text-subtle" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{row.subject || "(no subject)"}</p>
        <p className="truncate text-[12.5px] text-muted">
          {row.senderEmail || "Unknown sender"},{" "}
          <span title={formatTimestamp(row.createdAt)}>{timeAgo(row.createdAt)}</span>
        </p>
        <p className="mt-0.5 text-[12.5px]">
          {created ? (
            row.taskNumber ? (
              <Link href={`/t/${row.taskNumber}`} className="text-accent-text hover:underline">
                Added as #{row.taskNumber}
              </Link>
            ) : (
              <span className="text-muted">Added as a task (since deleted)</span>
            )
          ) : (
            <span className={row.status === "rejected" ? "text-danger-text" : "text-muted"}>
              {row.status === "rejected" ? "Not added: " : "Skipped: "}
              {row.reason}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

export function TemplateSettings({
  workspace,
}: {
  workspace: { id: string; name: string; isTemplate: boolean };
}) {
  const [pending, startTransition] = useTransition();
  return (
    <Section
      title="Template"
      description={
        workspace.isTemplate
          ? "This workspace is a template. Anyone can start a new workspace from it; it doesn't appear in sidebars or My tasks."
          : "Turn this workspace into a template so anyone can start new workspaces from it. To keep this one as it is, use Save as template from the workspace menu instead."
      }
    >
      <div>
        <Button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await perform(setWorkspaceTemplate(workspace.id, !workspace.isTemplate), {
                success: workspace.isTemplate
                  ? "It's a regular workspace again"
                  : "Workspace turned into a template",
              });
            })
          }
        >
          {workspace.isTemplate ? "Convert to a regular workspace" : "Turn into a template"}
        </Button>
      </div>
    </Section>
  );
}

export function TagSettings({
  workspaceId,
  tags,
}: {
  workspaceId: string;
  tags: { id: string; name: string; color: string; count: number }[];
}) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();

  return (
    <Section
      title="Tags"
      description="Label tasks across lists, then filter by tag. Everyone in the workspace can use and edit these."
    >
      {tags.length > 0 ? (
        <ul className="divide-y divide-border rounded-[10px] border border-border">
          {tags.map((t) => (
            <TagRow key={t.id} workspaceId={workspaceId} tag={t} />
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">No tags yet. Add one below, or from any task.</p>
      )}
      <form method="post"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const res = await perform(createTag({ workspaceId, name }), { success: "Tag added" });
            if (res.ok) setName("");
          });
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="New tag, e.g. Design"
          aria-label="New tag name"
          className="max-w-xs"
        />
        <Button type="submit" disabled={pending || !name.trim()}>
          Add tag
        </Button>
      </form>
    </Section>
  );
}

function TagRow({
  workspaceId,
  tag,
}: {
  workspaceId: string;
  tag: { id: string; name: string; color: string; count: number };
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(tag.name);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  function save(patch: { name?: string; color?: string }) {
    startTransition(async () => {
      const res = await perform(updateTag({ id: tag.id, ...patch }));
      if (res.ok) setEditing(false);
    });
  }

  return (
    <li className="flex min-h-12 items-center gap-3 px-3 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Colour for ${tag.name}`}
            className="inline-flex size-6 items-center justify-center rounded-md hover:bg-surface-2"
          >
            <span className="size-3 rounded-full" style={{ background: workspaceSwatch(tag.color) }} />
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-2">
          <ColorSwatches value={tag.color} onChange={(color) => save({ color })} />
        </PopoverContent>
      </Popover>
      {editing ? (
        <form method="post"
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ name });
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setName(tag.name);
                setEditing(false);
              }
            }}
            aria-label="Tag name"
            className="h-8"
          />
          <Button type="submit" size="sm" variant="primary" disabled={pending || !name.trim()}>
            Save
          </Button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{tag.name}</span>
          <Link
            href={`/w/${workspaceId}?tag=${tag.id}`}
            className="tabular text-[12.5px] text-muted hover:text-text hover:underline"
          >
            {pluralize(tag.count, "task")}
          </Link>
          <Menu>
            <MenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label={`Options for ${tag.name}`}>
                <DotsThreeIcon size={16} weight="bold" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem onSelect={() => setEditing(true)}>
                <PencilSimpleIcon size={16} />
                Rename tag
              </MenuItem>
              <MenuItem danger onSelect={() => setConfirming(true)}>
                <TrashIcon size={16} />
                Delete tag
              </MenuItem>
            </MenuContent>
          </Menu>
        </>
      )}
      {confirming && (
        <Dialog open onOpenChange={setConfirming}>
          <DialogContent
            title={`Delete “${tag.name}”?`}
            description={
              tag.count > 0
                ? `It comes off ${pluralize(tag.count, "task")}. The tasks themselves stay.`
                : "No tasks use it."
            }
          >
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const res = await perform(deleteTag(tag.id), { success: "Tag deleted" });
                    if (res.ok) setConfirming(false);
                  })
                }
              >
                {pending ? "Deleting…" : "Delete tag"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}
