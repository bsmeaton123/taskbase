import type { Metadata } from "next";
import { Suspense } from "react";
import { authConfig } from "@/lib/auth";
import { allowedEmailDomains } from "@/lib/email-domains";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <AuthForm
        mode="sign-in"
        googleEnabled={authConfig.googleEnabled}
        domains={allowedEmailDomains()}
      />
    </Suspense>
  );
}
