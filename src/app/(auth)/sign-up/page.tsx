import { EnvelopeSimpleIcon } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { authConfig } from "@/lib/auth";
import { allowedEmailDomains } from "@/lib/email-domains";
import {
  findUsableInvite,
  INVITE_COOKIE,
  openSignupEnabled,
  userCount,
} from "@/lib/invites";
import { AuthForm } from "../auth-form";
import { PRODUCT_NAME } from "@/lib/product";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ invite: inviteParam }, store, users] = await Promise.all([
    searchParams,
    cookies(),
    userCount(),
  ]);
  const invite = await findUsableInvite(store.get(INVITE_COOKIE)?.value);
  const domains = allowedEmailDomains();
  const bootstrap = users === 0;
  const googleForDomain = authConfig.googleEnabled && domains.length > 0;
  const canUseForm = bootstrap || Boolean(invite) || openSignupEnabled();

  if (!canUseForm && !googleForDomain) {
    return (
      <div className="grid gap-4">
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-surface-2 text-muted">
          <EnvelopeSimpleIcon size={20} />
        </span>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {inviteParam === "invalid" ? "That invite link has expired" : `${PRODUCT_NAME} is invite-only`}
        </h1>
        <p className="text-muted">
          {inviteParam === "invalid"
            ? "Invite links work once and expire after two weeks. Ask an admin to send you a new one."
            : "Ask an admin for an invite link. Once you have one, open it and you'll land back here."}
        </p>
        <p className="text-[13px] text-muted">
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-accent-text hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <Suspense>
      <AuthForm
        mode="sign-up"
        googleEnabled={authConfig.googleEnabled}
        domains={domains}
        emailFormEnabled={canUseForm}
        invite={invite ? { email: invite.email } : null}
        bootstrap={bootstrap}
      />
    </Suspense>
  );
}
