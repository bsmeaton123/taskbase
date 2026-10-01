"use client";

import { themeScript } from "@/lib/theme";

/**
 * Inline <head> script that sets the theme before first paint. On the
 * client it renders as inert text/plain so React doesn't warn about
 * rendering scripts (see Next's "Preventing flash before hydration" guide).
 */
export function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: themeScript }}
    />
  );
}
