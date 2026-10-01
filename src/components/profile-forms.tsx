"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { perform } from "@/components/app-context";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { radioGroupKeys } from "@/lib/radio-group";
import { setDailyReminder, setEmailPreference } from "@/server/actions/account";

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <section className="grid gap-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Profile</h2>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const value = String(new FormData(e.currentTarget).get("name") ?? "").trim();
          if (!value) return;
          setPending(true);
          const { error } = await authClient.updateUser({ name: value });
          setPending(false);
          if (error) toast.error("Couldn't save your name. Try again.");
          else {
            toast.success("Profile updated");
            router.refresh();
          }
        }}
      >
        <Field label="Full name" htmlFor="profile-name">
          <Input
            id="profile-name"
            name="name"
            autoComplete="name"
            defaultValue={name}
            required
            maxLength={80}
          />
        </Field>
        <Field label="Email" htmlFor="profile-email" hint="Ask an admin if your email needs to change.">
          <Input id="profile-email" value={email} disabled readOnly />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function PasswordForm({ email }: { email: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: "current" | "next"; text: string } | null>(null);
  return (
    <section className="grid gap-4">
      <h2 className="text-[15px] font-semibold tracking-tight">Password</h2>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const formEl = e.currentTarget;
          const form = new FormData(formEl);
          setError(null);
          setPending(true);
          const { error } = await authClient.changePassword({
            currentPassword: String(form.get("current") ?? ""),
            newPassword: String(form.get("next") ?? ""),
            revokeOtherSessions: true,
          });
          setPending(false);
          if (error) setError(passwordError(error.code));
          else {
            formEl.reset();
            toast.success("Password changed. Other devices were signed out.");
          }
        }}
      >
        {/* Lets password managers tell which account the new password belongs to. */}
        <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
        <Field
          label="Current password"
          htmlFor="pw-current"
          error={error?.field === "current" ? error.text : null}
        >
          <Input id="pw-current" name="current" type="password" autoComplete="current-password" required />
        </Field>
        <Field
          label="New password"
          htmlFor="pw-next"
          hint="At least 8 characters."
          error={error?.field === "next" ? error.text : null}
        >
          <Input id="pw-next" name="next" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Changing…" : "Change password"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Turns Better Auth's terse error codes into a message beside the field that caused it. */
function passwordError(code: string | undefined): { field: "current" | "next"; text: string } {
  switch (code) {
    case "INVALID_PASSWORD":
      return { field: "current", text: "That isn't your current password. Check it and try again." };
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return {
        field: "current",
        text: "Your account signs in with Google, so it has no password to change.",
      };
    case "PASSWORD_TOO_SHORT":
      return { field: "next", text: "Use at least 8 characters." };
    case "PASSWORD_TOO_LONG":
      return { field: "next", text: "That password is too long. Use 128 characters or fewer." };
    default:
      return { field: "next", text: "Couldn't change your password. Try again." };
  }
}

const EMAIL_OPTIONS = [
  {
    value: "important",
    label: "Important only",
    hint: "When you're assigned something, mentioned, or added to a workspace.",
  },
  {
    value: "all",
    label: "Everything I follow",
    hint: "Also new comments and status changes on tasks you follow.",
  },
  { value: "none", label: "Nothing", hint: "Use the Inbox instead." },
] as const;

export function EmailPreferenceForm({
  value,
  dailyReminder,
  configured,
}: {
  value: "all" | "important" | "none";
  dailyReminder: boolean;
  configured: boolean;
}) {
  const [current, setCurrent] = useState(value);
  const [reminder, setReminder] = useState(dailyReminder);
  const [, startTransition] = useTransition();
  return (
    <section className="grid gap-4">
      <div className="grid gap-0.5">
        <h2 className="text-[15px] font-semibold tracking-tight">Email notifications</h2>
        {!configured && (
          <p className="text-[13px] text-muted">
            Email isn&apos;t set up on this server yet, so nothing is sent. Your choice is saved
            for when it is.
          </p>
        )}
      </div>
      <div
        role="radiogroup"
        aria-label="Email notifications"
        className="grid gap-2"
        onKeyDown={radioGroupKeys}
      >
        {EMAIL_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={current === o.value}
            tabIndex={current === o.value ? 0 : -1}
            onClick={() => {
              if (o.value === current) return;
              const previous = current;
              setCurrent(o.value);
              startTransition(async () => {
                const res = await perform(setEmailPreference(o.value), {
                  success: "Email preference saved",
                });
                if (!res.ok) setCurrent(previous);
              });
            }}
            className={cn(
              "flex items-start gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors",
              current === o.value
                ? "border-accent bg-accent-soft/50"
                : "border-border hover:border-border-strong",
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                current === o.value ? "border-accent" : "border-border-strong",
              )}
            >
              {current === o.value && <span className="size-2 rounded-full bg-accent" />}
            </span>
            <span className="grid gap-0.5">
              <span className="text-[13.5px] font-medium">{o.label}</span>
              <span className="text-[12.5px] text-muted">{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
      <label
        className={cn(
          "flex items-start gap-3 rounded-[10px] border border-border px-3 py-2.5",
          current === "none" && "opacity-60",
        )}
      >
        <input
          type="checkbox"
          checked={reminder}
          disabled={current === "none"}
          onChange={(e) => {
            const on = e.target.checked;
            setReminder(on);
            startTransition(async () => {
              const res = await perform(setDailyReminder(on), {
                success: on ? "Morning reminder on" : "Morning reminder off",
              });
              if (!res.ok) setReminder(!on);
            });
          }}
          className="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span className="grid gap-0.5">
          <span className="text-[13.5px] font-medium">Morning reminder</span>
          <span className="text-[12.5px] text-muted">
            One email each morning listing your tasks that are overdue or due today. Nothing is
            sent on days when there aren&apos;t any.
            {current === "none" && " Turn email notifications on to receive it."}
          </span>
        </span>
      </label>
    </section>
  );
}
