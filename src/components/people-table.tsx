"use client";

import {
  CopyIcon,
  DotsThreeIcon,
  KeyIcon,
  ProhibitIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@phosphor-icons/react/ssr";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { perform, useApp } from "@/components/app-context";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";
import {
  setTemporaryPassword,
  setUserDeactivated,
  setUserRole,
} from "@/server/actions/account";

type Row = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  banned: boolean;
  createdAt: Date;
  workspaceCount: number;
  openTaskCount: number;
};

export function PeopleTable({ people }: { people: Row[] }) {
  const { viewer } = useApp();
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const [resetFor, setResetFor] = useState<{ id: string; name: string } | null>(null);
  const [deactivating, setDeactivating] = useState<{ id: string; name: string } | null>(null);
  return (
    <section className="grid gap-2">
      <h2 className="text-[15px] font-semibold tracking-tight">
        Accounts <span className="tabular font-normal text-subtle">{people.length}</span>
      </h2>
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-left text-[13px] sm:min-w-[640px]">
          <thead className="border-b border-border bg-surface-2 text-[12px] text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Person</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Workspaces</th>
              <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Open tasks</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Joined</th>
              <th className="w-10 px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {people.map((p) => (
              <tr key={p.id} className={cn(p.banned && "opacity-60")}>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar person={p} size="md" />
                    <div className="min-w-0 max-w-[52vw] sm:max-w-none">
                      <p className="truncate font-medium">
                        {p.name}
                        {p.id === viewer.id && <span className="font-normal text-muted"> (you)</span>}
                      </p>
                      <p className="truncate text-[12.5px] text-muted">{p.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {p.banned ? (
                    <span className="text-danger-text">Deactivated</span>
                  ) : p.role === "admin" ? (
                    <span className="inline-flex items-center gap-1 font-medium">
                      <ShieldCheckIcon size={14} weight="fill" className="text-muted" />
                      Admin
                    </span>
                  ) : (
                    <span className="text-muted">Member</span>
                  )}
                </td>
                <td className="tabular hidden px-3 py-2.5 text-right sm:table-cell">{p.workspaceCount}</td>
                <td className="tabular hidden px-3 py-2.5 text-right sm:table-cell">{p.openTaskCount}</td>
                <td className="tabular hidden px-3 py-2.5 text-muted sm:table-cell" suppressHydrationWarning>
                  {format(new Date(p.createdAt), "d MMM yyyy")}
                </td>
                <td className="px-3 py-2.5">
                  <Menu>
                    <MenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`Manage ${p.name}`}>
                        <DotsThreeIcon size={18} weight="bold" />
                      </Button>
                    </MenuTrigger>
                    <MenuContent align="end">
                      {p.role === "admin" ? (
                        <MenuItem onSelect={() => perform(setUserRole(p.id, "user"))}>
                          <UserIcon size={16} />
                          Make regular member
                        </MenuItem>
                      ) : (
                        <MenuItem onSelect={() => perform(setUserRole(p.id, "admin"))}>
                          <ShieldCheckIcon size={16} />
                          Make admin
                        </MenuItem>
                      )}
                      {p.id !== viewer.id && !p.banned && (
                        <MenuItem
                          onSelect={() => setResetFor({ id: p.id, name: p.name })}
                        >
                          <KeyIcon size={16} />
                          Set temporary password
                        </MenuItem>
                      )}
                      {p.id !== viewer.id && <MenuSeparator />}
                      {p.id !== viewer.id && (
                        <MenuItem
                          danger={!p.banned}
                          onSelect={() =>
                            p.banned
                              ? perform(setUserDeactivated(p.id, false), {
                                  success: `${p.name} can sign in again`,
                                })
                              : setDeactivating({ id: p.id, name: p.name })
                          }
                        >
                          <ProhibitIcon size={16} />
                          {p.banned ? "Reactivate" : "Deactivate"}
                        </MenuItem>
                      )}
                    </MenuContent>
                  </Menu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description="They'll be signed out straight away and can't sign back in. They stay on the tasks they're assigned to, and you can reactivate them at any time."
        confirmLabel="Deactivate"
        onConfirm={async () => {
          if (!deactivating) return;
          await perform(setUserDeactivated(deactivating.id, true), {
            success: `${deactivating.name} was deactivated`,
          });
        }}
      />
      <ConfirmDialog
        open={resetFor !== null}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={`Set a temporary password for ${resetFor?.name ?? ""}?`}
        description="They'll be signed out everywhere and will need the new password to get back in."
        confirmLabel="Set temporary password"
        danger={false}
        onConfirm={async () => {
          if (!resetFor) return;
          const res = await perform(setTemporaryPassword(resetFor.id));
          if (res.ok) setTemp({ name: resetFor.name, password: res.data.password });
        }}
      />
      <Dialog open={temp !== null} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent
          title={`Temporary password for ${temp?.name ?? ""}`}
          description="Share it privately. It's only shown once; ask them to change it from their profile after signing in."
        >
          <div className="grid gap-4">
            <code className="select-all break-all rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-[14px]">
              {temp?.password}
            </code>
            <div className="flex justify-end">
              <Button
                variant="primary"
                onClick={async () => {
                  if (!temp) return;
                  try {
                    await navigator.clipboard.writeText(temp.password);
                    toast.success("Password copied");
                  } catch {
                    toast.error("Couldn't copy. Select the password and copy it yourself.");
                  }
                }}
              >
                <CopyIcon size={15} />
                Copy password
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
