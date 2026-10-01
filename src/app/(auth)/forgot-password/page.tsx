import type { Metadata } from "next";
import Link from "next/link";
import { emailAvailable } from "@/lib/email";
import { ForgotPasswordForm } from "../password-forms";
import { PRODUCT_NAME } from "@/lib/product";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  if (!emailAvailable())
    return (
      <div className="grid gap-3">
        <h1 className="text-[22px] font-semibold tracking-tight">Forgot your password?</h1>
        <p className="text-muted">
          Ask a {PRODUCT_NAME} admin to set a temporary password for you. They can do it from the
          People page.
        </p>
        <Link href="/sign-in" className="text-[13px] font-medium text-accent-text hover:underline">
          Back to sign in
        </Link>
      </div>
    );
  return <ForgotPasswordForm />;
}
