import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/email";
import { findUsableInvite, INVITE_COOKIE, INVITE_TTL_DAYS } from "@/lib/invites";
import { getCurrentUser } from "@/lib/session";

/** Invite links: remember the token in a cookie, then send people to sign up. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // Behind the reverse proxy the request looks like plain HTTP; the public URL knows better.
  const isHttps = appUrl().startsWith("https:") || request.nextUrl.protocol === "https:";
  if (await getCurrentUser()) return NextResponse.redirect(appUrl("/"));

  const invite = await findUsableInvite(token);
  if (!invite) return NextResponse.redirect(appUrl("/sign-up?invite=invalid"));

  const res = NextResponse.redirect(appUrl("/sign-up"));
  res.cookies.set(INVITE_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 24 * INVITE_TTL_DAYS,
  });
  return res;
}
