import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/email";
import { getCurrentUser } from "@/lib/session";
import { redboothAuthorizeUrl } from "@/server/redbooth/client";
import { REDBOOTH_STATE_COOKIE as STATE_COOKIE, redboothOAuthConfigured } from "@/server/redbooth/connection";

/** Starts "Connect Redbooth": admins only, with a one-time state to check on the way back. */
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer?.isAdmin) return NextResponse.redirect(appUrl("/"));
  if (!redboothOAuthConfigured()) return NextResponse.redirect(appUrl("/import?error=not-configured"));

  const state = randomBytes(24).toString("base64url");
  const res = NextResponse.redirect(redboothAuthorizeUrl(state, appUrl("/api/redbooth/callback")));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: appUrl().startsWith("https:") || request.nextUrl.protocol === "https:",
    path: "/api/redbooth",
    maxAge: 10 * 60,
  });
  return res;
}
