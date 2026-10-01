import { avatarColor } from "@/lib/colors";
import { cn, initials } from "@/lib/utils";

type AvatarPerson = { id: string; name: string; image?: string | null };

/**
 * Only photos from Google sign-in are shown. Anyone can set an image URL through the
 * auth API, and an arbitrary URL would let one person track colleagues' page views.
 */
function trustedImage(url: string | null | undefined) {
  return url && /^https:\/\/lh[3-6]\.googleusercontent\.com\//.test(url) ? url : null;
}

const sizes = {
  xs: "size-5 text-[9px]",
  sm: "size-6 text-[10px]",
  md: "size-7 text-[11px]",
  lg: "size-9 text-[13px]",
} as const;

export function Avatar({
  person,
  size = "sm",
  className,
}: {
  person: AvatarPerson;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const image = trustedImage(person.image);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold tracking-tight text-accent-fg",
        sizes[size],
        className,
      )}
      style={image ? undefined : { background: avatarColor(person.id) }}
      title={person.name}
      aria-label={person.name}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}

/**
 * Overlapping avatars: the first `max`, then "+N" with the others' names in its tooltip.
 * `ring` should match the background behind the stack so the overlaps read cleanly.
 */
export function AvatarStack({
  people,
  max = 4,
  size = "sm",
  ring = "ring-bg",
  className,
}: {
  people: AvatarPerson[];
  max?: number;
  size?: keyof typeof sizes;
  ring?: string;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.slice(max);
  return (
    <span className={cn("flex shrink-0 items-center -space-x-1.5", className)}>
      {shown.map((p) => (
        <Avatar key={p.id} person={p} size={size} className={cn("ring-2", ring)} />
      ))}
      {rest.length > 0 && (
        <span
          title={rest.map((p) => p.name).join(", ")}
          aria-label={`and ${rest.map((p) => p.name).join(", ")}`}
          className={cn(
            "tabular inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-medium text-muted ring-2",
            ring,
            sizes[size],
          )}
        >
          +{rest.length}
        </span>
      )}
    </span>
  );
}
