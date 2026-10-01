import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_PATH_HEADER } from "@/lib/request-path";

/**
 * Tells pages which path was asked for, so a signed-out visitor who opens a task link
 * (say, from a notification email) comes back to it after signing in. Layouts can't
 * read the URL, and requireUser() may run in either. Always overwritten here, so a
 * client can't supply its own; sign-in still passes it through safeNext().
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const search = new URLSearchParams(url.search);
  search.delete("_rsc");
  const query = search.toString();

  const headers = new Headers(request.headers);
  headers.set(REQUEST_PATH_HEADER, url.pathname + (query ? `?${query}` : ""));
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Pages only: not API routes, Next's own files, or anything with a file extension.
  matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"],
};
