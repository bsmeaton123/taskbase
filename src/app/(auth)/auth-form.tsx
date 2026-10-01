"use client";

import { GoogleLogoIcon } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "@/lib/safe-next";
import { PRODUCT_NAME } from "@/lib/product";

type Mode = "sign-in" | "sign-up";

/**
 * Google sign-in failures come back as `?error=google&error=<code>`. Only known codes get
 * their own copy, so a crafted link can't put its own words on this page.
 */
const GOOGLE_ERRORS: Record<string, string> = {
  domain_not_allowed: "That isn't a company Google account. Sign in with your work account.",
  invite_required: "You need an invite to join. Ask an admin for an invite link.",
  invite_email_mismatch:
    "That Google account doesn't match the email your invite was sent to. Use the invited address.",
  bootstrap_restricted: "The first account must use the admin email set on the server.",
  access_denied: "Google sign-in was cancelled. Try again when you're ready.",
};

function googleError(codes: string[]) {
  if (codes.length === 0) return null;
  const known = codes.find((c) => Object.hasOwn(GOOGLE_ERRORS, c));
  if (known) return GOOGLE_ERRORS[known];
  return "That Google account can't sign in here. Use your work account, or ask an admin for an invite.";
}

function formError(error: { status?: number; code?: string; message?: string }) {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "That email and password don't match an account. Check them and try again.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "There's already an account with that email. Sign in instead.";
    case "BANNED_USER":
      return "This account has been deactivated. Ask an admin to restore it.";
    case "INVALID_EMAIL":
      return "Enter your email address, like name@company.com.";
    case "PASSWORD_TOO_SHORT":
      return "Use a password of at least 8 characters.";
    case "PASSWORD_TOO_LONG":
      return "That password is too long. Use 128 characters or fewer.";
    // The request came from an address the server doesn't trust (a wrong BETTER_AUTH_URL,
    // or an old bookmark on another domain).
    case "INVALID_ORIGIN":
    case "MISSING_OR_NULL_ORIGIN":
    case "CROSS_SITE_NAVIGATION_LOGIN_BLOCKED":
      return `Sign-in is blocked from this address. Open ${PRODUCT_NAME} from its usual link and try again.`;
  }
  if (error.status === 401)
    return "That email and password don't match an account. Check them and try again.";
  if (error.status === 429) return "Too many attempts. Wait a minute, then try again.";
  if (!error.status || error.status >= 500) return "Something went wrong. Try again.";
  // Sign-up rules in src/lib/auth.ts send their own plain-English reasons.
  return error.message || "Something went wrong. Try again.";
}

export function AuthForm({
  mode,
  googleEnabled,
  domains,
  emailFormEnabled = true,
  invite = null,
  bootstrap = false,
}: {
  mode: Mode;
  googleEnabled: boolean;
  domains: string[];
  emailFormEnabled?: boolean;
  invite?: { email: string | null } | null;
  bootstrap?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [error, setError] = useState<string | null>(() => googleError(params.getAll("error")));
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const { error } =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({
            email,
            password,
            name: String(form.get("name") ?? "").trim(),
          });

    if (error) {
      setPending(false);
      setError(formError(error));
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function google() {
    setError(null);
    setPending(true);
    const { error } = await authClient.signIn.social({
      provider: "google",
      callbackURL: next,
      errorCallbackURL: `/${mode}?error=google`,
    });
    // On success the browser is already leaving for Google.
    if (error) {
      setPending(false);
      setError("Couldn't reach Google sign-in. Try again in a minute.");
    }
  }

  const isSignUp = mode === "sign-up";
  const lockedEmail = isSignUp ? (invite?.email ?? null) : null;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-tight">
          {isSignUp ? "Create your account" : "Sign in"}
        </h1>
        <p className="text-muted">
          {isSignUp
            ? "Join your team's workspaces, tasks and conversations."
            : "Welcome back. Pick up where the team left off."}
        </p>
      </div>

      {isSignUp && (bootstrap || invite) && (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-[13px] text-accent-text">
          {bootstrap
            ? `You're setting up ${PRODUCT_NAME}. This first account becomes the admin.`
            : lockedEmail
              ? `You've been invited as ${lockedEmail}.`
              : "You've been invited to join the team."}
        </p>
      )}

      {googleEnabled && (
        <>
          <Button size="lg" onClick={google} disabled={pending} className="w-full justify-center">
            <GoogleLogoIcon size={16} weight="bold" />
            Continue with Google
          </Button>
          {emailFormEnabled && (
            <div className="flex items-center gap-3 text-[12px] text-subtle">
              <span className="h-px flex-1 bg-border" />
              or use email
              <span className="h-px flex-1 bg-border" />
            </div>
          )}
        </>
      )}

      {!emailFormEnabled && isSignUp && (
        <p className="text-[13px] text-muted">
          Use your {domains.map((d) => `@${d}`).join(" or ")} Google account, or ask an admin
          for an invite link to sign up with a password.
        </p>
      )}

      {emailFormEnabled && (
        <form method="post" onSubmit={onSubmit} className="grid gap-4">
          {isSignUp && (
            <Field label="Full name" htmlFor="name">
              <Input id="name" name="name" autoComplete="name" required maxLength={80} />
            </Field>
          )}
          <Field
            label="Work email"
            htmlFor="email"
            hint={
              isSignUp && domains.length
                ? `Use your ${domains.map((d) => `@${d}`).join(" or ")} address.`
                : undefined
            }
          >
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              defaultValue={lockedEmail ?? undefined}
              readOnly={Boolean(lockedEmail)}
            />
          </Field>
          <Field
            label="Password"
            htmlFor="password"
            hint={isSignUp ? "At least 8 characters." : undefined}
          >
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              minLength={8}
              required
            />
          </Field>
          {!isSignUp && (
            <Link
              href="/forgot-password"
              className="-mt-2 justify-self-start text-[13px] font-medium text-accent-text hover:underline"
            >
              Forgot password?
            </Link>
          )}

          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-[13px] text-danger-text">
              {error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full justify-center">
            {pending ? (isSignUp ? "Creating account…" : "Signing in…") : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>
      )}

      <p className="text-[13px] text-muted">
        {isSignUp ? "Already have an account? " : "New to the team? "}
        <Link
          href={`/${isSignUp ? "sign-in" : "sign-up"}${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-medium text-accent-text hover:underline"
        >
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
