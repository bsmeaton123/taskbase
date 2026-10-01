/**
 * Where to go after signing in: only paths on this site. Anything that could leave it
 * ("//evil.com", "/\\evil.com", absolute URLs, or input the URL parser normalises into
 * those) falls back to the home page.
 */
export function safeNext(next: string | null) {
  if (!next || !next.startsWith("/") || /^\/[\\/]/.test(next)) return "/";
  try {
    return new URL(next, "http://local").origin === "http://local" ? next : "/";
  } catch {
    return "/";
  }
}
