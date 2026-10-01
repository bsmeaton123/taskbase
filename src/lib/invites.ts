import "server-only";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invites, user } from "@/db/schema";
import { allowedEmailDomains } from "@/lib/email-domains";
import { newId } from "@/lib/id";

export const INVITE_COOKIE = "taskbase_invite";
export const INVITE_TTL_DAYS = 14;

export function newInviteToken() {
  return newId(32);
}

/**
 * Open sign-up (no invite) is only allowed when explicitly enabled AND
 * restricted to company domains. Otherwise people need an invite link, or
 * Google sign-in with a company address (Google verifies ownership).
 */
export function openSignupEnabled() {
  return process.env.OPEN_SIGNUP === "true" && allowedEmailDomains().length > 0;
}

export async function findUsableInvite(token: string | null | undefined) {
  if (!token) return null;
  const [invite] = await db
    .select()
    .from(invites)
    .where(
      and(
        eq(invites.token, token),
        isNull(invites.usedAt),
        gt(invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return invite ?? null;
}

export function inviteMatchesEmail(
  invite: { email: string | null },
  email: unknown,
): boolean {
  if (!invite.email) return true;
  return typeof email === "string" && email.trim().toLowerCase() === invite.email;
}

export async function userCount() {
  const [{ value }] = await db.select({ value: count() }).from(user);
  return value;
}

/** Who may create the very first (admin) account on an empty database. */
/**
 * Who may create the very first (admin) account. With ADMIN_EMAIL set, only that address.
 * Without it, only in development: a fresh production deploy is reachable by anyone who
 * finds the domain, so the first account must be pinned to an email.
 */
export function canBootstrap(email: unknown) {
  const admin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!admin) return process.env.NODE_ENV !== "production";
  return typeof email === "string" && email.trim().toLowerCase() === admin;
}
