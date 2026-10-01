import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "@/lib/auth";
import { todayIn } from "@/lib/dates";
import { REQUEST_PATH_HEADER, signInHref } from "@/lib/request-path";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.banned) return null;
  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image ?? null,
    isAdmin: u.role === "admin",
  };
});

/** For pages and layouts: redirect to sign-in (and back here after) when there is no session. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(signInHref((await headers()).get(REQUEST_PATH_HEADER)));
  return user;
}

export class ActionError extends Error {}

/** For server actions: throw instead of redirecting. */
export async function requireActionUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has expired. Sign in again.");
  return user;
}

/** The viewer's time zone, reported by the browser via the `tz` cookie. */
export const getTimeZone = cache(async (): Promise<string> => {
  const tz = (await cookies()).get("tz")?.value;
  if (tz) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return tz;
    } catch {
      /* fall through */
    }
  }
  return process.env.DEFAULT_TIMEZONE || "UTC";
});

export async function getToday(): Promise<string> {
  return todayIn(await getTimeZone());
}
