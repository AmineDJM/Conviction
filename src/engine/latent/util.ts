/** Small pure helpers for the Latent Signal Engine. Never throw on missing data. */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { Money } from "@/domain/money";
import { parsePeriodDate, parseScaledDetail, parseScaledNumber, toUsd } from "../metrics/normalize";
import type { LatentBasis, LatentCoverage } from "./types";

export const CURRENT_BASES: ReadonlySet<string> = new Set(["ACTUAL", "CURRENT", "LTM"]);
export const FORWARD_BASES_SET: ReadonlySet<string> = new Set(["FORECAST", "TARGET", "PIPELINE"]);
export const CONTRACTED_BASES: ReadonlySet<string> = new Set(["SIGNED", "BOOKED"]);

export const REVENUE_KEYS: ReadonlySet<string> = new Set(["arr", "mrr", "revenue_ttm"]);
export const VOLUME_KEYS: ReadonlySet<string> = new Set(["gmv", "tpv"]);
export const BRIDGE_KEYS = ["new_arr", "expansion_arr", "churned_arr", "net_new_arr"] as const;

export function lower(s: string | null | undefined): string {
  return (s ?? "").toLowerCase();
}

/** Lower-case, strip punctuation, collapse whitespace — for comparisons only. */
export function norm(s: string | null | undefined): string {
  return lower(s)
    .replace(/[^\p{L}\p{N}%$€£.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function uniqSorted<T extends string | number>(xs: Iterable<T | null | undefined>): T[] {
  const s = new Set<T>();
  for (const x of xs) if (x !== null && x !== undefined) s.add(x);
  return [...s].sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
}

export function pagesOf(xs: Iterable<number | null | undefined>): number[] {
  return uniqSorted<number>(xs);
}

export function bases(...b: (LatentBasis | null | undefined | false)[]): LatentBasis[] {
  return uniqSorted<LatentBasis>(b.filter((x): x is LatentBasis => !!x));
}

export function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Percentage 0–100 rounded to 1 dp, or null when the denominator is 0. */
export function pct(n: number, d: number): number | null {
  return d > 0 ? round((n / d) * 100, 1) : null;
}

export function coverage(available: string[], missing: string[], note: string | null = null): LatentCoverage {
  const t = available.length + missing.length;
  return { available, missing, ratio: t ? round(available.length / t, 2) : 0, note };
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "n/a";
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1e9) return `${s}$${+(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${+(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${+(a / 1e3).toFixed(1)}k`;
  return `${s}$${+a.toFixed(0)}`;
}

export function moneyUsd(m: Money | null | undefined): number | null {
  if (!m || m.amount === null || !Number.isFinite(m.amount)) return null;
  return toUsd(m.amount, m.currency)?.usd ?? null;
}

export function obsUsd(o: Pick<MetricObservation, "value" | "unit" | "currency">): number | null {
  if (o.value === null || !Number.isFinite(o.value)) return null;
  if (o.unit !== "USD_OR_CURRENCY") return o.value;
  return toUsd(o.value, o.currency)?.usd ?? null;
}

export function pageFromLocation(loc: string | null | undefined): number | null {
  const m = /(\d+)/.exec(loc ?? "");
  return m ? Number(m[1]) : null;
}

export function parseDate(s: string | null | undefined): Date | null {
  try {
    return parsePeriodDate(s);
  } catch {
    return null;
  }
}

/** Single scaled number in a text ("$4.2M" → 4200000), or null when absent/ambiguous. */
export function parseScaled(s: string | null | undefined): number | null {
  if (!s) return null;
  try {
    return parseScaledNumber(s);
  } catch {
    return null;
  }
}

/**
 * A single amount in free text with what makes it money: a currency ("€5M", "5 MEUR", "$2M", "USD 3M") or a scale
 * word ("5M", "2.5 millions"). `usd` is converted with the same FX table as every other amount (null when the
 * currency has no rate — never the unconverted amount).
 */
export function amountInText(s: string | null | undefined): { value: number | null; currency: string | null; money: boolean; usd: number | null } | null {
  if (!s) return null;
  let d: ReturnType<typeof parseScaledDetail> = null;
  try {
    d = parseScaledDetail(s);
  } catch {
    d = null;
  }
  const t = lower(s);
  const currency = /€|\beur\b|\beuros?\b|\d\s*(?:k|m|md|mds|bn)?eur\b/.test(t) ? "EUR" : /£|\bgbp\b/.test(t) ? "GBP" : /\bchf\b/.test(t) ? "CHF" : /\$|\busd\b|\bdollars?\b/.test(t) ? "USD" : null;
  if (!d) return currency ? { value: null, currency, money: true, usd: null } : null;
  return { value: d.value, currency, money: currency !== null || d.scaled, usd: toUsd(d.value, currency ?? "USD")?.usd ?? null };
}

export type DateGranularity = "DAY" | "MONTH" | "YEAR" | "NONE";
export function dateGranularity(s: string | null | undefined): DateGranularity {
  const t = (s ?? "").trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(t)) return "DAY";
  if (/^\d{4}-\d{1,2}/.test(t)) return "MONTH";
  if (/^\d{4}/.test(t)) return "YEAR";
  return "NONE";
}

export function monthKey(s: string | null | undefined): string | null {
  const d = parseDate(s);
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthsBetween(a: Date, b: Date): number {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/** Text of an observation used for lexical checks: label, raw text, stated definition and components. */
export function obsText(o: MetricObservation): string {
  return lower([o.label, o.rawText, o.definitionAsStated ?? "", ...o.components].join(" | "));
}

/** Label + raw text only (what is displayed as the number). */
export function obsHeadline(o: MetricObservation): string {
  return lower(`${o.label} | ${o.rawText}`);
}

export function isQuantitative(o: MetricObservation): boolean {
  return o.state !== "WITHHELD" && (o.value !== null || o.state === "OBSERVED");
}

/** Deduplicate observations extracted twice (same label, raw text and page). */
export function dedupeObservations(obs: MetricObservation[]): MetricObservation[] {
  const seen = new Set<string>();
  const out: MetricObservation[] = [];
  for (const o of obs) {
    const k = `${o.metricKey}|${norm(o.label)}|${norm(o.rawText)}|${o.page ?? ""}|${o.periodEnd ?? ""}|${o.basis}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
  }
  return out;
}

export function isFuture(dateText: string | null | undefined, asOf: Date, slackDays = 31): boolean {
  const d = parseDate(dateText);
  return !!d && d.getTime() > asOf.getTime() + slackDays * 864e5;
}

/** Evaluation date: explicit option, else the analysis start time, else now. */
export function resolveAsOf(deal: CanonicalDeal, asOf?: Date): Date {
  if (asOf && !Number.isNaN(asOf.getTime())) return asOf;
  const p = deal.analysis?.provenance?.startedAt;
  const d = p ? new Date(p) : null;
  if (d && !Number.isNaN(d.getTime())) return d;
  return new Date();
}

/** Primary (or freshest) normalized instance of a key with a usable current value. */
export function primaryMetric(deal: CanonicalDeal, key: string): MetricInstance | null {
  const list = (deal.metrics ?? []).filter(
    (m) => m.metricKey === key && m.normalizedValue !== null && (m.state === "OBSERVED" || m.state === "INFERRED" || m.state === "STALE") && CURRENT_BASES.has(m.basis),
  );
  if (!list.length) return null;
  const primary = list.find((m) => m.isPrimary);
  if (primary) return primary;
  return [...list].sort((a, b) => (parseDate(b.periodEnd)?.getTime() ?? 0) - (parseDate(a.periodEnd)?.getTime() ?? 0))[0] ?? null;
}

/** Freshest current observation of a key (raw audit trail), used when normalized metrics are absent. */
export function latestObservation(obs: MetricObservation[], key: string): MetricObservation | null {
  const list = obs.filter((o) => o.metricKey === key && o.value !== null && CURRENT_BASES.has(o.basis) && o.state !== "WITHHELD");
  if (!list.length) return null;
  return [...list].sort((a, b) => (parseDate(b.periodEnd)?.getTime() ?? 0) - (parseDate(a.periodEnd)?.getTime() ?? 0))[0] ?? null;
}

/** Current value of a key in dictionary units (USD for money): normalized metric first, raw observation second. */
export function currentValue(deal: CanonicalDeal, key: string): { value: number; page: number | null; source: string } | null {
  const m = primaryMetric(deal, key);
  if (m && m.normalizedValue !== null) return { value: m.normalizedValue, page: pageFromLocation(m.location), source: `${m.id} (${m.rawValue})` };
  const o = latestObservation(deal.metricObservations ?? [], key);
  if (o) {
    const v = obsUsd(o);
    if (v !== null) return { value: v, page: o.page, source: `"${o.rawText}"` };
  }
  return null;
}

/** Token set for fuzzy statement comparison. */
export function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(" ")
      .filter((t) => t.length > 2 && !STOP.has(t)),
  );
}
const STOP = new Set(["the", "and", "for", "with", "our", "are", "from", "that", "this", "has", "have", "its", "was", "were", "per", "into", "than"]);

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
