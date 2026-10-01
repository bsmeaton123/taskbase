import { MobileNavButton } from "@/components/sidebar";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  leading,
  children,
  className,
  keepTitle,
}: {
  title: React.ReactNode;
  leading?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  /**
   * Below desktop width, move the controls onto a second row rather than truncating a short
   * title. From desktop width the title truncates instead, so a page beside the task panel
   * keeps a one-row header.
   */
  keepTitle?: boolean;
}) {
  return (
    <header
      className={cn(
        "@container flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5 sm:px-6",
        className,
      )}
    >
      <div className={cn("flex min-w-0 items-center gap-2", keepTitle ? "flex-auto lg:flex-1" : "flex-1")}>
        <MobileNavButton />
        {leading}
        <h1 className="truncate text-[15px] font-semibold tracking-tight">{title}</h1>
      </div>
      {/* Wraps rather than running off the side when the actions outgrow a phone. */}
      {children && <div className="flex flex-wrap items-center gap-1.5">{children}</div>}
    </header>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-sm flex-col items-start gap-3 px-6 py-16", className)}>
      {icon && (
        <span className="inline-flex size-10 items-center justify-center rounded-[10px] bg-surface-2 text-muted">
          {icon}
        </span>
      )}
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {children && <p className="text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}
