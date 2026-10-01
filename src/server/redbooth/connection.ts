import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { redboothConnections } from "@/db/schema";
import { open, seal } from "@/server/secret-box";
import { redboothClient, type RedboothTokens } from "@/server/redbooth/client";

const PURPOSE = "redbooth-token";

/** Holds the one-time OAuth state between "Connect Redbooth" and the callback. */
export const REDBOOTH_STATE_COOKIE = "taskbase_redbooth_state";

/** Whether this server can sign in to Redbooth with OAuth (otherwise a pasted token works). */
export function redboothOAuthConfigured() {
  return Boolean(process.env.REDBOOTH_CLIENT_ID && process.env.REDBOOTH_CLIENT_SECRET);
}

export async function saveRedboothConnection(
  userId: string,
  tokens: RedboothTokens,
  me: { name?: string | null; email?: string | null } = {},
) {
  const values = {
    accessToken: seal(tokens.accessToken, PURPOSE),
    refreshToken: tokens.refreshToken ? seal(tokens.refreshToken, PURPOSE) : null,
    expiresAt: tokens.expiresAt,
    ...(me.name !== undefined ? { redboothName: me.name } : {}),
    ...(me.email !== undefined ? { redboothEmail: me.email } : {}),
  };
  await db
    .insert(redboothConnections)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: redboothConnections.userId, set: values });
}

export async function getRedboothConnection(userId: string) {
  const [row] = await db
    .select()
    .from(redboothConnections)
    .where(eq(redboothConnections.userId, userId));
  if (!row) return null;
  const accessToken = open(row.accessToken, PURPOSE);
  // Unreadable after BETTER_AUTH_SECRET changes: treat as not connected.
  if (!accessToken) return null;
  const tokens: RedboothTokens = {
    accessToken,
    refreshToken: row.refreshToken ? open(row.refreshToken, PURPOSE) : null,
    expiresAt: row.expiresAt,
  };
  return { tokens, name: row.redboothName, email: row.redboothEmail };
}

export async function deleteRedboothConnection(userId: string) {
  await db.delete(redboothConnections).where(eq(redboothConnections.userId, userId));
}

/** A client for this person's connection that stores rotated tokens as it goes. */
export async function redboothClientFor(userId: string) {
  const connection = await getRedboothConnection(userId);
  if (!connection) return null;
  return redboothClient({
    tokens: connection.tokens,
    onTokens: (tokens) => saveRedboothConnection(userId, tokens),
  });
}
