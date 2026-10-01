"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { account, invites, notifications, session, user } from "@/db/schema";
import { appUrl, renderEmail, sendEmail } from "@/lib/email";
import { newId } from "@/lib/id";
import { INVITE_TTL_DAYS, newInviteToken } from "@/lib/invites";
import { ActionError, requireActionUser } from "@/lib/session";
import { idSchema, run } from "@/server/action-utils";
import { PRODUCT_NAME } from "@/lib/product";

/* -------------------------------------------------------------------------- */
/* Inbox                                                                       */
/* -------------------------------------------------------------------------- */

export async function markNotificationsRead(ids: string[], read = true) {
  return run(async () => {
    const viewer = await requireActionUser();
    const parsed = z.array(idSchema).min(1).max(500).parse(ids);
    await db
      .update(notifications)
      .set({ readAt: read ? new Date() : null })
      .where(
        and(eq(notifications.userId, viewer.id), inArray(notifications.id, parsed)),
      );
    return null;
  });
}

export async function markAllNotificationsRead() {
  return run(async () => {
    const viewer = await requireActionUser();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, viewer.id), isNull(notifications.readAt)));
    return null;
  });
}

/* -------------------------------------------------------------------------- */
/* Preferences                                                                 */
/* -------------------------------------------------------------------------- */

export async function setTimeZone(tz: string) {
  const store = await cookies();
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    return;
  }
  if (store.get("tz")?.value === tz) return;
  store.set("tz", tz, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}

export async function setDailyReminder(on: boolean) {
  return run(async () => {
    const viewer = await requireActionUser();
    await db.update(user).set({ dailyReminder: z.boolean().parse(on) }).where(eq(user.id, viewer.id));
    return null;
  });
}

export async function setEmailPreference(preference: "all" | "important" | "none") {
  return run(async () => {
    const viewer = await requireActionUser();
    const value = z.enum(["all", "important", "none"]).parse(preference);
    await db.update(user).set({ emailNotifications: value }).where(eq(user.id, viewer.id));
    return null;
  });
}

/* -------------------------------------------------------------------------- */
/* People (org admins)                                                         */
/* -------------------------------------------------------------------------- */

async function requireAdmin() {
  const viewer = await requireActionUser();
  if (!viewer.isAdmin) throw new ActionError("Only admins can manage people.");
  return viewer;
}

export async function setUserRole(userId: string, role: "admin" | "user") {
  return run(async () => {
    const viewer = await requireAdmin();
    idSchema.parse(userId);
    z.enum(["admin", "user"]).parse(role);
    await db.transaction(async (tx) => {
      // Lock the admin rows so two admins can't demote themselves at once.
      const admins = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.role, "admin"), eq(user.banned, false)))
        .for("update");
      if (role === "user" && admins.length <= 1 && admins[0]?.id === userId)
        throw new ActionError(
          userId === viewer.id
            ? "You're the only admin. Make someone else an admin first."
            : "There must be at least one admin.",
        );
      await tx.update(user).set({ role }).where(eq(user.id, userId));
    });
    return null;
  });
}

/**
 * Deactivating signs someone out and blocks sign-in. By decision, they stay on the tasks
 * they're assigned to, so their work stays visible (and comes back if they're reactivated);
 * they just can't be newly assigned, copied onto duplicates or carried into moves.
 */
export async function setUserDeactivated(userId: string, deactivated: boolean) {
  return run(async () => {
    const viewer = await requireAdmin();
    idSchema.parse(userId);
    if (userId === viewer.id) throw new ActionError("You can't deactivate yourself.");
    await db.transaction(async (tx) => {
      if (deactivated) {
        const admins = await tx
          .select({ id: user.id })
          .from(user)
          .where(and(eq(user.role, "admin"), eq(user.banned, false)))
          .for("update");
        if (admins.length <= 1 && admins[0]?.id === userId)
          throw new ActionError("There must be at least one active admin.");
      }
      await tx
        .update(user)
        .set({
          banned: deactivated,
          banReason: deactivated ? "Deactivated by an admin" : null,
        })
        .where(eq(user.id, userId));
      if (deactivated) await tx.delete(session).where(eq(session.userId, userId));
    });
    return null;
  });
}

/**
 * Sets a new password for someone who's locked out (e.g. when email isn't
 * configured). Signs them out everywhere; they should change it after.
 */
export async function setTemporaryPassword(userId: string) {
  return run(async () => {
    await requireAdmin();
    idSchema.parse(userId);
    const password = newId(6).toLowerCase() + "-" + newId(6).toLowerCase();
    const hashed = await hashPassword(password);
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(account)
        .set({ password: hashed })
        .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
        .returning({ id: account.id });
      if (updated.length === 0) {
        await tx.insert(account).values({
          id: newId(),
          accountId: userId,
          providerId: "credential",
          userId,
          password: hashed,
        });
      }
      await tx.delete(session).where(eq(session.userId, userId));
    });
    return { password };
  });
}

/* -------------------------------------------------------------------------- */
/* Invites (org admins)                                                        */
/* -------------------------------------------------------------------------- */

export async function createInvite(input: { email?: string; role: "admin" | "user" }) {
  return run(async () => {
    const viewer = await requireAdmin();
    const data = z
      .object({
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email("That doesn't look like an email address.")
          .optional()
          .or(z.literal("")),
        role: z.enum(["admin", "user"]),
      })
      .parse(input);
    const email = data.email || null;
    if (email) {
      const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, email));
      if (existing) throw new ActionError("Someone with that email already has an account.");
    }
    const token = newInviteToken();
    await db.insert(invites).values({
      token,
      email,
      role: data.role,
      createdById: viewer.id,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    });
    let emailed = false;
    if (email) {
      const url = appUrl(`/invite/${token}`);
      const { html, text } = renderEmail({
        heading: `${viewer.name} invited you to ${PRODUCT_NAME}`,
        body: `${PRODUCT_NAME} is where the team keeps its workspaces, tasks and conversations. The link works once and expires in 14 days.`,
        cta: { label: "Accept invite", url },
        footer: "If you weren't expecting this, you can ignore this email.",
      });
      emailed = await sendEmail({
        to: email,
        subject: `${viewer.name} invited you to ${PRODUCT_NAME}`,
        text,
        html,
      });
    }
    return { token, emailed };
  });
}

export async function revokeInvite(id: string) {
  return run(async () => {
    await requireAdmin();
    await db
      .delete(invites)
      .where(and(eq(invites.id, idSchema.parse(id)), isNull(invites.usedAt)));
    return null;
  });
}
