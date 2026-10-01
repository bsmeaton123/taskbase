/**
 * Shown while a page in the app loads: the shape of a page header and a task list, so
 * content arrives without a jump. Pulses only for people who haven't asked for less motion.
 */
const ROWS = [62, 48, 71, 40, 55, 66, 44];

export default function Loading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-busy="true">
      <span className="sr-only" role="status">
        Loading
      </span>
      <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        <span className="h-4 w-32 rounded bg-surface-2 motion-safe:animate-pulse" />
        <span className="flex-1" />
        <span className="h-8 w-40 rounded-md bg-surface-2 motion-safe:animate-pulse" />
      </div>
      <div className="px-4 pt-5 sm:px-6" aria-hidden>
        <span className="mb-3 block h-3.5 w-24 rounded bg-surface-2 motion-safe:animate-pulse" />
        {ROWS.map((width, i) => (
          <div key={i} className="flex h-11 items-center gap-3 border-b border-border/70">
            <span className="size-[17px] shrink-0 rounded-full border border-border-strong" />
            <span
              className="h-3 rounded bg-surface-2 motion-safe:animate-pulse"
              style={{ width: `${width}%`, animationDelay: `${i * 60}ms` }}
            />
            <span className="flex-1" />
            <span className="hidden h-3 w-16 rounded bg-surface-2 motion-safe:animate-pulse sm:block" />
            <span className="size-6 shrink-0 rounded-full bg-surface-2 motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
