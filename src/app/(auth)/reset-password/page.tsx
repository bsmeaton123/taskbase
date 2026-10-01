import type { Metadata } from "next";
import { ResetPasswordForm } from "../password-forms";

export const metadata: Metadata = { title: "Reset password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  return <ResetPasswordForm token={token ?? null} invalid={Boolean(error)} />;
}
