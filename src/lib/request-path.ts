/** Request header src/proxy.ts sets to the path (and query) the visitor asked for. */
export const REQUEST_PATH_HEADER = "x-taskbase-path";

/** Where to send a signed-out visitor: sign-in, then back to the page they wanted. */
export function signInHref(requested: string | null) {
  if (!requested || requested === "/" || !requested.startsWith("/")) return "/sign-in";
  return `/sign-in?next=${encodeURIComponent(requested)}`;
}
