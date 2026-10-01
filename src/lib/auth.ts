import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { renderEmail, sendEmail } from "@/lib/email";
import { allowedEmailDomains, isEmailDomainAllowed } from "@/lib/email-domains";
import { newId } from "@/lib/id";
import {
  canBootstrap,
  findUsableInvite,
  INVITE_COOKIE,
  inviteMatchesEmail,
  openSignupEnabled,
  userCount,
} from "@/lib/invites";
import { PRODUCT_NAME } from "@/lib/product";

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const auth = betterAuth({
  appName: PRODUCT_NAME,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: {
    database: { generateId: () => newId() },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    autoSignIn: true,
    revokeSessionsOnPasswordReset: true,
    resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
    sendResetPassword: async ({ user, url }) => {
      const { html, text } = renderEmail({
        heading: `Reset your ${PRODUCT_NAME} password`,
        body: "Someone (hopefully you) asked to reset the password for this account. The link works for one hour.",
        cta: { label: "Choose a new password", url },
        footer: "If you didn't ask for this, you can ignore this email. Your password won't change.",
      });
      // Not awaited: response time mustn't reveal whether an account exists.
      void sendEmail({ to: user.email, subject: `Reset your ${PRODUCT_NAME} password`, text, html });
    },
  },
  socialProviders: googleEnabled
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID!,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          prompt: "select_account",
        },
      }
    : {},
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once a day
  },
  user: {
    /**
     * Who may create an account:
     * - the very first person (becomes admin; must match ADMIN_EMAIL if set)
     * - Google sign-ins from an allowed company domain (Google verifies the address)
     * - anyone from an allowed domain when OPEN_SIGNUP=true
     * - otherwise, only people holding a valid invite link
     */
    validateUserInfo: async ({ user, source }, ctx) => {
      if (!isEmailDomainAllowed(user.email)) {
        return {
          error: "domain_not_allowed",
          errorDescription: "Use your company email address.",
        };
      }
      if (source.action !== "create-user") return;

      if ((await userCount()) === 0) {
        if (canBootstrap(user.email)) return;
        return {
          error: "bootstrap_restricted",
          errorDescription: process.env.ADMIN_EMAIL
            ? "The first account must use the configured admin email."
            : "Set ADMIN_EMAIL on the server before creating the first account.",
        };
      }
      if (source.method === "oauth" && allowedEmailDomains().length > 0) return;
      if (openSignupEnabled()) return;

      const invite = await findUsableInvite(ctx.getCookie(INVITE_COOKIE));
      if (!invite) {
        return {
          error: "invite_required",
          errorDescription: `${PRODUCT_NAME} is invite-only. Ask an admin for an invite link.`,
        };
      }
      if (!inviteMatchesEmail(invite, user.email)) {
        return {
          error: "invite_email_mismatch",
          errorDescription: `This invite is for ${invite.email}. Sign up with that address.`,
        };
      }
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          // The very first account becomes the organisation admin.
          if ((await userCount()) === 0) return { data: { ...user, role: "admin" } };

          // Claim the invite atomically, so one link can't create two accounts.
          const token = ctx?.getCookie(INVITE_COOKIE);
          if (token) {
            const email = String(user.email).trim().toLowerCase();
            const [claimed] = await db
              .update(schema.invites)
              .set({ usedAt: new Date() })
              .where(
                and(
                  eq(schema.invites.token, token),
                  isNull(schema.invites.usedAt),
                  gt(schema.invites.expiresAt, new Date()),
                  or(isNull(schema.invites.email), eq(schema.invites.email, email)),
                ),
              )
              .returning({ role: schema.invites.role });
            if (claimed)
              return { data: { ...user, role: claimed.role === "admin" ? "admin" : "user" } };
          }

          // No invite was claimed (none, or someone else used it first). The account is
          // only allowed if a rule other than the invite permits it: a verified Google
          // sign-in from a company domain, or OPEN_SIGNUP for password sign-ups.
          const isOauth = Boolean(ctx?.path?.includes("/callback/"));
          const allowedWithoutInvite = isOauth
            ? allowedEmailDomains().length > 0 && isEmailDomainAllowed(String(user.email))
            : openSignupEnabled();
          if (!allowedWithoutInvite) return false;
          return { data: { ...user, role: "user" } };
        },
        after: async (user, ctx) => {
          const token = ctx?.getCookie(INVITE_COOKIE);
          if (!token) return;
          await db
            .update(schema.invites)
            .set({ usedById: user.id })
            .where(
              and(
                eq(schema.invites.token, token),
                isNotNull(schema.invites.usedAt),
                isNull(schema.invites.usedById),
              ),
            );
        },
      },
    },
  },
  plugins: [admin(), nextCookies()],
});

export const authConfig = { googleEnabled };
export type Session = typeof auth.$Infer.Session;
