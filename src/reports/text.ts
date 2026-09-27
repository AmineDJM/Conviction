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

/** Enum → human label with acronyms preserved (AI, PMF, GTM, SaaS, API, IP, B2B). */
export function enumLabel(s: string | null | undefined): string {
  if (!s) return "—";
  const w = s.toLowerCase().split("_");
  const ACR: Record<string, string> = { ai: "AI", pmf: "PMF", gtm: "GTM", saas: "SaaS", api: "API", ip: "IP", smb: "SMB", plg: "PLG", ic: "IC", dd: "DD", erp: "ERP", safe: "SAFE" };
  return w.map((x, i) => ACR[x] ?? (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(" ");
}

/**
 * The gate-admitted recommendation rationale without the engine's
 * "Model suggested X, which the gates do not admit. Applied Y." preamble
 * (the AI suggestion is shown separately in the gate trace). Falls back to
 * the blocking gates when no analysed rationale exists.
 */
export function gateRationale(rec: { rationale: string; trace: { outcome: string; detail: string }[] }): string {
  const body = rec.rationale.replace(/^Model suggested [A-Za-z_]+, which the gates do not admit\. Applied [A-Z_]+\.\s*/, "").trim();
  if (body) return body;
  const blocks = rec.trace.filter((t) => t.outcome === "BLOCK").map((t) => t.detail);
  return blocks.length ? `Set by the recommendation gates: ${blocks.join("; ")}.` : "Set by the recommendation gates.";
}
