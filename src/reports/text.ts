/**
 * Deterministic text helpers shared by report renderers. Pure, no I/O.
 */

const REF_RE = /\s*[(\[]?\b(?:(?:CLM|SRC|MET)-\d{3}|RSK-\d{2}|Q-\d{2}|GAP-\d{2})\b(?:\s*[;,]\s*\b(?:(?:CLM|SRC|MET)-\d{3}|RSK-\d{2}|Q-\d{2}|GAP-\d{2})\b)*[)\]]?\.?/g;

/** Remove inline evidence references (CLM-001; MET-003 …) for compact views. */
export function stripRefs(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(REF_RE, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:])/g, "$1")
    .replace(/[;,]\s*$/, "")
    .trim();
}

/** First sentence of a text (keeps decimals like "3.84" intact). */
export function firstSentence(s: string | null | undefined): string {
  if (!s) return "";
  const m = s.match(/^(.+?[.!?])(\s+[A-Z(“"]|$)/);
  return (m?.[1] ?? s).trim();
}

/** Clip to `max` characters on a word boundary, adding an ellipsis when clipped. */
export function clip(s: string | null | undefined, max: number): string {
  if (!s) return "";
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.–—-]+$/, "")}…`;
}

/** Short line: first sentence without refs, clipped. */
export function brief(s: string | null | undefined, max = 160): string {
  return clip(firstSentence(stripRefs(s)), max);
}

export function humanList(items: string[], max = items.length): string {
  const xs = items.filter(Boolean).slice(0, max);
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

export const NOT_DISCLOSED = "Not disclosed";
