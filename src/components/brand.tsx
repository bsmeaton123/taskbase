import { PRODUCT_NAME } from "@/lib/product";
import { cn } from "@/lib/utils";

/**
 * The taskbase mark: a rounded T with a tick in its stem and three list lines. Drawn on a
 * 64-unit grid; colours follow the current text/accent so it works in light and dark.
 */
export function BrandMark({ className, size = 24 }: { className?: string; size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={cn("shrink-0 text-accent", className)}
    >
      <rect x="4" y="8" width="40" height="13" rx="6.5" fill="currentColor" />
      <rect x="12" y="8" width="16" height="48" rx="7" fill="currentColor" />
      <path
        d="M15 39.5l3.6 3.6L25 36"
        fill="none"
        stroke="var(--color-accent-fg)"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="32" y="27" width="14" height="6" rx="3" fill="currentColor" />
      <rect x="32" y="37" width="14" height="6" rx="3" fill="currentColor" />
      <rect x="32" y="47" width="14" height="6" rx="3" fill="currentColor" />
    </svg>
  );
}

export { PRODUCT_NAME };

/** The end of the name the wordmark sets in the accent, as in the logo. */
const ACCENT_TAIL = "base";

/** Wordmark: "task" in the text colour, "base" in the accent, as in the logo. */
export function BrandName({ className }: { className?: string }) {
  const tail = PRODUCT_NAME.endsWith(ACCENT_TAIL) ? ACCENT_TAIL : "";
  return (
    <span className={cn("font-bold tracking-tight", className)}>
      {PRODUCT_NAME.slice(0, PRODUCT_NAME.length - tail.length)}
      {tail && <span className="text-accent">{tail}</span>}
    </span>
  );
}

export function Brand({ className, size = "md" }: { className?: string; size?: "md" | "lg" }) {
  return (
    <span className={cn("inline-flex items-center", size === "lg" ? "gap-2.5" : "gap-2", className)}>
      <BrandMark size={size === "lg" ? 32 : 24} />
      <BrandName className={size === "lg" ? "text-[22px]" : "text-[16px]"} />
    </span>
  );
}
