/**
 * The taskbase mark as SVG: a rounded "T" with a tick in its stem and three list lines to
 * the right, on a 64-unit grid. Redrawn as vectors from the supplied logo so it stays sharp
 * at every size. Keep src/app/icon.svg in sync with brandIconSvg().
 */
export const BRAND_BLUE = "#1f6fe8";
export const BRAND_INK = "#232b3a";

/** The mark's shapes, for a 64x64 viewBox. */
export function brandMarkShapes(fill: string, tick = "#ffffff") {
  return [
    // T crossbar
    `<rect x="4" y="8" width="40" height="13" rx="6.5" fill="${fill}"/>`,
    // T stem
    `<rect x="12" y="8" width="16" height="48" rx="7" fill="${fill}"/>`,
    // Tick inside the stem
    `<path d="M15 39.5l3.6 3.6L25 36" fill="none" stroke="${tick}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    // Three list lines
    `<rect x="32" y="27" width="14" height="6" rx="3" fill="${fill}"/>`,
    `<rect x="32" y="37" width="14" height="6" rx="3" fill="${fill}"/>`,
    `<rect x="32" y="47" width="14" height="6" rx="3" fill="${fill}"/>`,
  ].join("");
}

/** App icon: the mark in white on a blue rounded square. */
export function brandIconSvg(size: number, radius: number) {
  const scale = (size * 0.72) / 64;
  const inset = (size - 64 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="${BRAND_BLUE}"/><g transform="translate(${inset} ${inset}) scale(${scale})">${brandMarkShapes("#ffffff", BRAND_BLUE)}</g></svg>`;
}
