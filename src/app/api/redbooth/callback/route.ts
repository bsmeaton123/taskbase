import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { appUrl } from "@/lib/email";
import { getCurrentUser } from "@/lib/session";
import { exchangeRedboothToken, redboothClient } from "@/server/redbooth/client";
import { REDBOOTH_STATE_COOKIE as STATE_COOKIE, saveRedboothConnection } from "@/server/redbooth/connection";
import { personName } from "@/lib/redbooth";

function sameState(a: string | undefined, b: string | null) {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Redbooth sends people back here with a code; swap it for tokens and remember them. */
export async function GET(request: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer?.isAdmin) return NextResponse.redirect(appUrl("/"));
  const params = request.nextUrl.searchParams;
  const done = (query: string) => {
    const res = NextResponse.redirect(appUrl(`/import${query}`));
    res.cookies.delete({ name: STATE_COOKIE, path: "/api/redbooth" });
    return res;
  };
  if (!sameState(request.cookies.get(STATE_COOKIE)?.value, params.get("state")))
    return done("?error=state");
  const code = params.get("code");
  if (!code) return done("?error=denied");

  try {
    const tokens = await exchangeRedboothToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: appUrl("/api/redbooth/callback"),
    });
    const me = await redboothClient({ tokens }).me();
    await saveRedboothConnection(viewer.id, tokens, { name: personName(me), email: me.email ?? null });
    return done("?connected=1");
  } catch (error) {
    console.error("[redbooth] connect failed", error);
    return done("?error=connect");
  }
}
