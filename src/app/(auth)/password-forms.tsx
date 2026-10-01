"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (sent)
    return (
      <div className="grid gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Check your email</h1>
        <p className="text-muted">
          If there&apos;s an account for {sent}, we&apos;ve sent a link to reset the password.
          It works for one hour.
        </p>
        <Link href="/sign-in" className="text-[13px] font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </div>
    );

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-muted">Enter your work email and we&apos;ll send you a reset link.</p>
      </div>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const email = String(new FormData(e.currentTarget).get("email") ?? "").trim();
          setPending(true);
          setError(null);
          const { error } = await authClient.requestPasswordReset({
            email,
            redirectTo: "/reset-password",
          });
          setPending(false);
          if (error)
            setError(
              error.code === "INVALID_EMAIL"
                ? "Enter your email address, like name@company.com."
                : "Couldn't send the email. Try again in a minute.",
            );
          else setSent(email);
        }}
      >
        <Field label="Work email" htmlFor="email" error={error}>
          <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full justify-center">
          {pending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
      <Link href="/sign-in" className="text-[13px] font-medium text-accent-text hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}

export function ResetPasswordForm({ token, invalid }: { token: string | null; invalid: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(invalid);

  if (!token || expired)
    return (
      <div className="grid gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">That link has expired</h1>
        <p className="text-muted">Reset links work once and only for an hour. Request a new one.</p>
        <Link href="/forgot-password" className="text-[13px] font-medium text-accent-text hover:underline">
          Send a new link
        </Link>
      </div>
    );

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-muted">You&apos;ll be signed out on your other devices.</p>
      </div>
      <form
        method="post"
        className="grid gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const password = String(form.get("password") ?? "");
          if (password !== String(form.get("confirm") ?? "")) {
            setError("The two passwords don't match. Type the same password in both.");
            return;
          }
          setPending(true);
          setError(null);
          const { error } = await authClient.resetPassword({ newPassword: password, token });
          setPending(false);
          if (error) {
            if (error.code === "INVALID_TOKEN") setExpired(true);
            else
              setError(
                error.code === "PASSWORD_TOO_SHORT"
                  ? "Use at least 8 characters."
                  : error.code === "PASSWORD_TOO_LONG"
                    ? "That password is too long. Use 128 characters or fewer."
                    : "Couldn't reset your password. Try again, or request a new link.",
              );
            return;
          }
          toast.success("Password changed. Sign in with your new password.");
          router.replace("/sign-in");
        }}
      >
        <Field label="New password" htmlFor="password" hint="At least 8 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required autoFocus />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm" error={error}>
          <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} required />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full justify-center">
          {pending ? "Saving…" : "Set new password"}
        </Button>
      </form>
    </div>
  );
}
