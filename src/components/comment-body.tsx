import { parseBody } from "@/lib/mentions";
import { cn } from "@/lib/utils";

export function CommentBody({
  body,
  viewerId,
  className,
}: {
  body: string;
  viewerId?: string;
  className?: string;
}) {
  return (
    <div className={cn("whitespace-pre-wrap break-words leading-relaxed", className)}>
      {parseBody(body).map((seg, i) => {
        if (seg.type === "mention")
          return (
            <span
              key={i}
              className={cn(
                "rounded px-0.5 font-medium",
                seg.id === viewerId
                  ? "bg-accent-soft text-accent-text"
                  : "text-accent-text",
              )}
            >
              @{seg.name}
            </span>
          );
        if (seg.type === "link")
          return (
            <a
              key={i}
              href={seg.href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-accent-text underline decoration-accent/30 hover:decoration-accent"
            >
              {seg.href}
            </a>
          );
        return <span key={i}>{seg.value}</span>;
      })}
    </div>
  );
}

/** Plain-text preview of a comment for the inbox. */
export function commentPreview(body: string, max = 140) {
  const text = parseBody(body)
    .map((s) => (s.type === "mention" ? `@${s.name}` : s.type === "link" ? s.href : s.value))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
