"use client";

import { CopyIcon, LinkSimpleIcon, TrashIcon, UserPlusIcon } from "@phosphor-icons/react/ssr";
import { format } from "date-fns";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { perform } from "@/components/app-context";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import { createInvite, revokeInvite } from "@/server/actions/account";

type PendingInvite = {
  id: string;
  token: string;
  email: string | null;
  role: string;
  expiresAt: Date;
  createdByName: string | null;
};

function inviteUrl(token: string) {
  return `${window.location.origin}/invite/${token}`;
}

async function copy(token: string) {
  try {
    await navigator.clipboard.writeText(inviteUrl(token));
    toast.success("Invite link copied");
  } catch {
    toast.error("Couldn't copy the link. Select it and copy it yourself.");
  }
}

export function InviteButton() {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [created, setCreated] = useState<{
    token: string;
    email: string | null;
    emailed: boolean;
  } | null>(null);
  const [pending, startTransition] = useTransition();

  function close(o: boolean) {
    setOpen(o);
    if (!o) {
      setCreated(null);
      setRole("user");
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <UserPlusIcon size={15} />
        Invite people
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent
          title={created ? "Invite link ready" : "Invite someone"}
          description={
            created
              ? "Send this link over Slack or email. It works once and expires in 14 days."
              : "Create a sign-up link. Add their email to make sure only they can use it."
          }
        >
          {created ? (
            <div className="grid gap-4">
              <div className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2">
                <LinkSimpleIcon size={15} className="shrink-0 text-muted" />
                <code className="min-w-0 flex-1 select-all truncate font-mono text-[12.5px]">
                  {inviteUrl(created.token)}
                </code>
              </div>
              {created.email && (
                <p className="text-[13px] text-muted">
                  {created.emailed
                    ? `We've emailed the link to ${created.email}. Only they can use it.`
                    : `Only ${created.email} can use this link.`}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setCreated(null)}>
                  Invite someone else
                </Button>
                <Button variant="primary" onClick={() => copy(created.token)}>
                  <CopyIcon size={15} />
                  Copy link
                </Button>
              </div>
            </div>
          ) : (
            <form
              method="post"
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
                startTransition(async () => {
                  const res = await perform(createInvite({ email, role }));
                  if (res.ok)
                    setCreated({
                      token: res.data.token,
                      email: email.toLowerCase() || null,
                      emailed: res.data.emailed,
                    });
                });
              }}
            >
              <Field
                label="Email"
                htmlFor="invite-email"
                hint="Optional. Leave empty for a link anyone can use once."
              >
                <Input id="invite-email" name="email" type="email" autoComplete="off" autoFocus />
              </Field>
              <div className="grid gap-1.5">
                <span id="invite-role" className="text-[13px] font-medium">
                  Role
                </span>
                <div
                  className="inline-flex w-fit rounded-md bg-surface-2 p-0.5"
                  role="radiogroup"
                  onKeyDown={radioGroupKeys}
                  aria-labelledby="invite-role"
                >
                  {(
                    [
                      ["user", "Member"],
                      ["admin", "Admin"],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={role === value}
                      tabIndex={role === value ? 0 : -1}
                      onClick={() => setRole(value)}
                      className={cn(
                        "h-7 rounded-[5px] px-3 text-[13px] font-medium",
                        role === value ? "bg-surface text-text shadow-card" : "text-muted hover:text-text",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => close(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={pending}>
                  {pending ? "Creating…" : "Create invite link"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PendingInvites({ invites }: { invites: PendingInvite[] }) {
  if (invites.length === 0) return null;
  return (
    <section className="grid gap-2">
      <h2 className="text-[15px] font-semibold tracking-tight">
        Pending invites <span className="tabular font-normal text-subtle">{invites.length}</span>
      </h2>
      <ul className="divide-y divide-border rounded-[10px] border border-border">
        {invites.map((inv) => {
          const who = inv.email ?? "anyone with the link";
          return (
            <li
              key={inv.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-[13px]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {inv.email ?? "Anyone with the link"}
                </span>
                <span className="tabular block text-[12.5px] text-muted" suppressHydrationWarning>
                  {inv.role === "admin" ? "Admin" : "Member"}, expires{" "}
                  {format(new Date(inv.expiresAt), "d MMM")}
                  {inv.createdByName ? `, from ${inv.createdByName}` : ""}
                </span>
              </span>
              <Tooltip content="Copy invite link">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Copy invite link for ${who}`}
                  onClick={() => copy(inv.token)}
                >
                  <CopyIcon size={15} />
                </Button>
              </Tooltip>
              <Tooltip content="Revoke invite">
                <Button
                  size="icon-sm"
                  variant="danger-ghost"
                  aria-label={`Revoke invite for ${who}`}
                  onClick={() => perform(revokeInvite(inv.id), { success: "Invite revoked" })}
                >
                  <TrashIcon size={15} />
                </Button>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
