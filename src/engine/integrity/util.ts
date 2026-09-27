/**
 * Small pure helpers shared by the integrity modules. No wall clock, no
 * randomness: everything is a function of its arguments.
 */
import type { IntegrityFinding, IntegrityModule, IntegritySeverity } from "./types";
import { toUsd } from "../metrics/normalize";

export const SEVERITIES: readonly IntegritySeverity[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export function sevRank(s: IntegritySeverity | null | undefined): number {
  return s ? SEVERITIES.indexOf(s) : -1;
}

export function maxSeverity(...s: (IntegritySeverity | null | undefined)[]): IntegritySeverity | null {
  let best: IntegritySeverity | null = null;
  for (const x of s) if (x && sevRank(x) > sevRank(best)) best = x;
  return best;
}

/** Move a severity up (n > 0) or down (n < 0), clamped. Going below LOW returns null. */
export function shiftSeverity(s: IntegritySeverity, n: number): IntegritySeverity | null {
  const i = SEVERITIES.indexOf(s) + n;
  if (i < 0) return null;
  return SEVERITIES[Math.min(SEVERITIES.length - 1, i)]!;
}

/**
 * Tolerance-based severity for a relative delta in percent:
 *   < 2% rounding (none) · 2–10% LOW · 10–25% MODERATE · 25–50% HIGH · > 50% CRITICAL.
 */
export function severityForDeltaPct(deltaPct: number | null): IntegritySeverity | null {
  if (deltaPct === null || Number.isNaN(deltaPct)) return null;
  const d = Math.abs(deltaPct);
  if (!Number.isFinite(d)) return "CRITICAL";
  if (d < 2) return null;
  if (d < 10) return "LOW";
  if (d < 25) return "MODERATE";
  if (d <= 50) return "HIGH";
  return "CRITICAL";
}

/** |stated − implied| / |implied| × 100. */
export function relDeltaPct(stated: number, implied: number): number {
  if (stated === implied) return 0;
  const den = Math.abs(implied);
  if (den < 1e-12) return Number.POSITIVE_INFINITY;
  return (Math.abs(stated - implied) / den) * 100;
}

export function isNum(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return n;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function arr<T>(x: T[] | null | undefined): T[] {
  return Array.isArray(x) ? x : [];
}

export function str(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/** Money (as extracted) → USD, or null when absent / unsupported currency. */
export function moneyUsd(m: { amount: number | null; currency: string } | null | undefined): number | null {
  if (!m || !isNum(m.amount)) return null;
  return toUsd(m.amount, m.currency)?.usd ?? null;
}

/** "p. 7", "deck.pdf p. 12", "page 3", "pp. 4-5" → first page number. */
export function pageOf(location: string | null | undefined): number | null {
  if (!location) return null;
  const m = /\b(?:pp?\.|pages?)\s*(\d{1,4})/i.exec(location);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function uniqSorted<T extends string | number>(xs: (T | null | undefined)[]): T[] {
  const s = [...new Set(xs.filter((x): x is T => x !== null && x !== undefined))];
  return s.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
}

/** FNV-1a 32-bit, hex. Stable across runtimes. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Period strings → UTC date at the END of the period. Supports YYYY, YYYY-MM,
 * YYYY-MM-DD, YYYY-Qn, Qn YYYY, FYYYYY, Hn YYYY. Returns null when unparseable.
 */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{4})-(\d{1,2})(?!\d)/.exec(t);
  if (m) return endOfMonth(Number(m[1]), Number(m[2]) - 1);
  m = /^(\d{4})[-\s]?Q([1-4])\b/i.exec(t) ?? null;
  if (m) return endOfMonth(Number(m[1]), Number(m[2]) * 3 - 1);
  m = /^Q([1-4])[-\s']*(\d{4})\b/i.exec(t);
  if (m) return endOfMonth(Number(m[2]), Number(m[1]) * 3 - 1);
  m = /^H([12])[-\s']*(\d{4})\b/i.exec(t);
  if (m) return endOfMonth(Number(m[2]), Number(m[1]) * 6 - 1);
  m = /^FY[-\s']*(\d{4})\b/i.exec(t);
  if (m) return endOfMonth(Number(m[1]), 11);
  m = /^(\d{4})\b/.exec(t);
  if (m) return endOfMonth(Number(m[1]), 11);
  return null;
}

function utc(y: number, mo: number, d: number): Date | null {
  if (!(y > 1900 && y < 2200) || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfMonth(y: number, mo: number): Date | null {
  if (mo < 0 || mo > 11) return null;
  return utc(y, mo, new Date(Date.UTC(y, mo + 1, 0)).getUTCDate());
}

const MS_PER_MONTH = 30.4375 * 864e5;

/** Fractional months from a to b (b later → positive). */
export function monthsBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / MS_PER_MONTH;
}

export function isoMonth(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 7) : null;
}

/* ---------------------------------------------------------------- */
/* Text                                                                */
/* ---------------------------------------------------------------- */

export function words(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}%$€£.]+/gu, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Word 2-shingles (unigrams when the text has a single word). */
export function shingles(s: string): Set<string> {
  const w = words(s);
  if (w.length < 2) return new Set(w);
  const out = new Set<string>();
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Simple union-find over indices, deterministic (smallest index is the root). */
export class UnionFind {
  private p: number[];
  constructor(n: number) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]!]!;
      i = this.p[i]!;
    }
    return i;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.p[rb] = ra;
    else this.p[ra] = rb;
  }
}

/** Parse a duration phrase ("6-9 months", "90 days", "2 quarters") to days (mean of the numbers). */
export function parseDurationDays(text: string | null | undefined): number | null {
  if (!text) return null;
  const t = text.toLowerCase();
  const m = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(days?|weeks?|wks?|months?|mos?|quarters?|years?|yrs?)\b/.exec(t);
  if (!m) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  const unit = m[3]!;
  const f = unit.startsWith("d") ? 1 : unit.startsWith("w") ? 7 : unit.startsWith("q") ? 91.31 : unit.startsWith("y") ? 365.25 : 30.44;
  const v = ((a + b) / 2) * f;
  return Number.isFinite(v) ? v : null;
}

export function fmtUsd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

export function fmtNum(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

export interface FindingInput {
  kind: string;
  module: IntegrityModule;
  severity: IntegritySeverity;
  title: string;
  detail: string;
  origin?: "COMPUTED" | "MODEL";
  metricIds?: (string | null | undefined)[];
  claimIds?: (string | null | undefined)[];
  sourceIds?: (string | null | undefined)[];
  pages?: (number | null | undefined)[];
  /** Extra discriminator for the id when a kind can fire more than once on the same refs. */
  key?: string;
}

export function finding(f: FindingInput): IntegrityFinding {
  const metricIds = uniqSorted(f.metricIds ?? []);
  const claimIds = uniqSorted(f.claimIds ?? []);
  const sourceIds = uniqSorted(f.sourceIds ?? []);
  const pages = uniqSorted((f.pages ?? []).filter((p): p is number => typeof p === "number" && Number.isInteger(p) && p > 0));
  const idBasis = [f.kind, f.key ?? "", metricIds.join(","), claimIds.join(","), sourceIds.join(","), pages.join(",")].join("|");
  return {
    id: `INT-${f.kind}-${hash(idBasis)}`,
    kind: f.kind,
    module: f.module,
    origin: f.origin ?? "COMPUTED",
    severity: f.severity,
    title: f.title,
    detail: f.detail,
    metricIds,
    claimIds,
    sourceIds,
    pages,
  };
}
