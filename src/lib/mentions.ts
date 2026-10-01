/**
 * Mentions are stored inside comment bodies as `@[Display Name](userId)`.
 * The composer shows plain `@Display Name` text and converts it on submit.
 */
export const MENTION_RE = /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)/g;

export function extractMentionIds(body: string): string[] {
  const ids = new Set<string>();
  for (const match of body.matchAll(MENTION_RE)) ids.add(match[2]);
  return [...ids];
}

/** Replace `@Name` occurrences with mention tokens for the given people. */
export function encodeMentions(
  text: string,
  people: { id: string; name: string }[],
): string {
  // Longest names first so "Ana Lopez" wins over "Ana".
  const sorted = [...people].sort((a, b) => b.name.length - a.name.length);
  let out = text;
  for (const p of sorted) {
    const escaped = p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^\\w\\[])@${escaped}(?![\\w])`, "g");
    out = out.replace(re, `$1@[${p.name}](${p.id})`);
  }
  return out;
}

/** Convert stored tokens back to plain `@Name` text (for editing). */
export function decodeMentions(body: string): {
  text: string;
  people: { id: string; name: string }[];
} {
  const people: { id: string; name: string }[] = [];
  const text = body.replace(MENTION_RE, (_m, name: string, id: string) => {
    if (!people.some((p) => p.id === id)) people.push({ id, name });
    return `@${name}`;
  });
  return { text, people };
}

export type BodySegment =
  | { type: "text"; value: string }
  | { type: "mention"; name: string; id: string }
  | { type: "link"; href: string };

const TOKEN_RE =
  /@\[([^\]]+)\]\(([A-Za-z0-9_-]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

export function parseBody(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let last = 0;
  for (const m of body.matchAll(TOKEN_RE)) {
    const index = m.index ?? 0;
    if (index > last)
      segments.push({ type: "text", value: body.slice(last, index) });
    if (m[1] && m[2]) segments.push({ type: "mention", name: m[1], id: m[2] });
    else if (m[3]) segments.push({ type: "link", href: m[3] });
    last = index + m[0].length;
  }
  if (last < body.length)
    segments.push({ type: "text", value: body.slice(last) });
  return segments;
}
