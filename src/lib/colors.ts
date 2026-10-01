/**
 * Workspace colors. Only used for small identity marks (sidebar squares,
 * breadcrumbs, board headers) so they never compete with the single UI accent.
 */
export const WORKSPACE_COLORS = {
  slate: { label: "Slate", swatch: "oklch(0.55 0.02 260)" },
  red: { label: "Red", swatch: "oklch(0.6 0.19 25)" },
  orange: { label: "Orange", swatch: "oklch(0.68 0.16 50)" },
  amber: { label: "Amber", swatch: "oklch(0.76 0.15 80)" },
  green: { label: "Green", swatch: "oklch(0.62 0.14 150)" },
  teal: { label: "Teal", swatch: "oklch(0.62 0.1 195)" },
  blue: { label: "Blue", swatch: "oklch(0.58 0.16 250)" },
  violet: { label: "Violet", swatch: "oklch(0.56 0.17 295)" },
  pink: { label: "Pink", swatch: "oklch(0.64 0.18 350)" },
} as const;

export type WorkspaceColor = keyof typeof WORKSPACE_COLORS;

export const WORKSPACE_COLOR_KEYS = Object.keys(
  WORKSPACE_COLORS,
) as WorkspaceColor[];

/** A palette key, or a custom colour as #rrggbb. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isValidColor(color: unknown): color is string {
  return (
    typeof color === "string" &&
    (Object.hasOwn(WORKSPACE_COLORS, color) || HEX_COLOR.test(color))
  );
}

/** Normalises a colour for storage: palette keys as-is, hex lower-cased; anything else -> slate. */
export function normalizeColor(color: unknown): string {
  if (!isValidColor(color)) return "slate";
  return HEX_COLOR.test(color) ? color.toLowerCase() : color;
}

export function workspaceSwatch(color: string | null | undefined): string {
  if (color && HEX_COLOR.test(color)) return color;
  return color && Object.hasOwn(WORKSPACE_COLORS, color)
    ? WORKSPACE_COLORS[color as WorkspaceColor].swatch
    : WORKSPACE_COLORS.slate.swatch;
}

/** Deterministic avatar background for people without a photo. Dark enough for white initials (4.5:1+). */
const AVATAR_HUES = [20, 50, 95, 150, 190, 230, 265, 300, 340];
export function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const hue = AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length];
  return `oklch(0.54 0.11 ${hue})`;
}
