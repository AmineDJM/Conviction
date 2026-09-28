/**
 * Integrity context: a sanitized, read-only view of the canonical deal with
 * the lookups every module needs. Tolerates partial / FAST_SCREEN objects in
 * which whole sections are null or arrays are missing.
 */
import type { CanonicalDeal, Claim, MetricInstance, Source } from "@/domain/canonical";
import { FORWARD_BASES, type Classification, type MetricObservation } from "@/domain/sections";
import type { BenchmarkRegistry, ProfileId, StageBand } from "../benchmarks/types";
import { resolvePeerGroup, type PeerGroupRef } from "../scoring/peer";
import { metricDef } from "../metrics/dictionary";
import { toUsd } from "../metrics/normalize";
import { arr, isNum, monthsBetween, pageOf, parseDate, str } from "./util";

export const CURRENT_BASES = ["ACTUAL", "CURRENT", "LTM"] as const;
export const CONTRACTED_BASES = ["SIGNED", "BOOKED"] as const;
const USABLE_STATES = new Set(["OBSERVED", "INFERRED", "STALE"]);

export interface SeriesPoint {
  value: number;
  date: Date;
  ref: string;
  page: number | null;
}

export interface SeriesGrowth {
  growthPct: number;
  months: number;
  latest: SeriesPoint;
  prior: SeriesPoint;
}

export interface IntegrityContext {
  deal: CanonicalDeal;
  registry: BenchmarkRegistry | null;
  profile: ProfileId;
  stageBand: StageBand;
  asOf: Date | null;
  classification: Classification;
  metrics: MetricInstance[];
  observations: MetricObservation[];
  claims: Claim[];
  sources: Source[];
  sourceById: Map<string, Source>;
  isSoftware: boolean;
  isAiHeavy: boolean;
  leadMonths: number;
  /** Usable primary instance for a key (finite value, usable state, not forward). */
  primary(key: string): MetricInstance | null;
  /** Usable company-stated (REPORTED / USER_CORRECTED) instance for a key. */
  stated(key: string): MetricInstance | null;
  /** Current-basis observations for a key. */
  currentObs(key: string): MetricObservation[];
  /** ≈12-month growth from a dated series of instances + current observations. */
  seriesGrowth(key: string): SeriesGrowth | null;
  series(key: string): SeriesPoint[];
  claimPages(c: Claim): number[];
  metricPage(m: MetricInstance): number | null;
}

const DEFAULT_CLASSIFICATION: Classification = {
  industry: [],
  productType: [],
  technology: [],
  revenueModel: [],
  gtm: [],
  operationalMaturity: "PRE_PRODUCT",
  financingStage: "UNKNOWN",
  declaredStage: null,
  rationale: "",
};

function sanitizeClaim(c: Claim): Claim {
  return {
    ...c,
    statement: str(c.statement),
    evidence: arr(c.evidence).filter(Boolean),
    contradictions: arr(c.contradictions),
    history: arr(c.history),
    unusualness: isNum(c.unusualness) ? c.unusualness : 2,
  };
}

function sanitizeMetric(m: MetricInstance): MetricInstance {
  return { ...m, qualityFlags: arr(m.qualityFlags), components: arr(m.components), inputs: arr(m.inputs), lineage: arr(m.lineage), basis: m.basis ?? "CURRENT" };
}

/** Deterministic reference date: analysis start, else the latest retrieval / history timestamp, else latest metric period. */
export function resolveAsOf(deal: CanonicalDeal): Date | null {
  const started = deal.analysis?.provenance?.startedAt;
  const d0 = started ? new Date(started) : null;
  if (d0 && !Number.isNaN(d0.getTime())) {
    // A stale-data refresh moves the reference date: ages are measured at the latest refresh (orchestration/refresh.ts).
    const refreshed = arr(deal.analysis?.refreshes)
      .map((r) => new Date(r?.asOf ?? ""))
      .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > d0.getTime())
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return refreshed ?? d0;
  }
  let best: number | null = null;
  const consider = (s: string | null | undefined) => {
    if (!s) return;
    const t = new Date(s).getTime();
    if (!Number.isNaN(t) && (best === null || t > best)) best = t;
  };
  for (const s of arr(deal.sources)) consider(s?.retrievedAt);
  for (const c of arr(deal.claims)) for (const h of arr(c?.history)) consider(h?.at);
  if (best !== null) return new Date(best);
  for (const m of arr(deal.metrics)) {
    const d = parseDate(m?.periodEnd);
    if (d && (best === null || d.getTime() > best)) best = d.getTime();
  }
  return best !== null ? new Date(best) : null;
}

export function buildContext(deal: CanonicalDeal, registry: BenchmarkRegistry | null | undefined, peer: PeerGroupRef | null | undefined): IntegrityContext {
  const classification: Classification = { ...DEFAULT_CLASSIFICATION, ...(deal.classification ?? {}) };
  for (const k of ["industry", "productType", "technology", "revenueModel", "gtm"] as const) classification[k] = arr(classification[k]) as never;
  let resolved: { profile: ProfileId; stageBand: StageBand };
  if (peer && peer.profile && peer.stageBand) resolved = peer;
  else {
    try {
      resolved = resolvePeerGroup(classification);
    } catch {
      resolved = { profile: "GENERAL", stageBand: "EARLY" };
    }
  }
  const metrics = arr(deal.metrics).filter(Boolean).map(sanitizeMetric);
  const observations = arr(deal.metricObservations).filter(Boolean).map((o) => ({ ...o, components: arr(o.components) }));
  const claims = arr(deal.claims).filter(Boolean).map(sanitizeClaim);
  const sources = arr(deal.sources).filter(Boolean);
  const sourceById = new Map(sources.map((s) => [s.id, s] as const));
  const pt = new Set(classification.productType);
  const isSoftware = ["SAAS", "AI_AGENT", "SOFTWARE_INFRASTRUCTURE", "API_PLATFORM"].some((x) => pt.has(x as never));
  const isAiHeavy = classification.technology.includes("AI") || pt.has("AI_AGENT") || pt.has("TECH_ENABLED_SERVICE");

  const usable = (m: MetricInstance) =>
    isNum(m.normalizedValue) && USABLE_STATES.has(m.state) && !(FORWARD_BASES as readonly string[]).includes(m.basis);
  const byKey = new Map<string, MetricInstance[]>();
  for (const m of metrics) {
    const l = byKey.get(m.metricKey) ?? [];
    l.push(m);
    byKey.set(m.metricKey, l);
  }
  const pick = (list: MetricInstance[]): MetricInstance | null => {
    const c = list.filter(usable);
    if (!c.length) return null;
    return [...c].sort((a, b) => {
      const p = Number(b.isPrimary) - Number(a.isPrimary);
      if (p) return p;
      const s = Number(a.state === "STALE") - Number(b.state === "STALE");
      if (s) return s;
      const da = parseDate(a.periodEnd)?.getTime() ?? 0;
      const db = parseDate(b.periodEnd)?.getTime() ?? 0;
      if (da !== db) return db - da;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })[0]!;
  };
  const primaryCache = new Map<string, MetricInstance | null>();
  const primary = (key: string) => {
    if (!primaryCache.has(key)) primaryCache.set(key, pick(byKey.get(key) ?? []));
    return primaryCache.get(key)!;
  };
  const stated = (key: string) => pick((byKey.get(key) ?? []).filter((m) => m.calculationMethod !== "DERIVED"));

  const currentObs = (key: string) =>
    observations.filter((o) => o.metricKey === key && (CURRENT_BASES as readonly string[]).includes(o.basis) && o.state !== "WITHHELD");

  const seriesCache = new Map<string, SeriesPoint[]>();
  const series = (key: string): SeriesPoint[] => {
    const cached = seriesCache.get(key);
    if (cached) return cached;
    const def = metricDef(key);
    const pts: SeriesPoint[] = [];
    const seen = new Set<number>();
    for (const m of byKey.get(key) ?? []) {
      if (!usable(m) || m.calculationMethod === "DERIVED") continue;
      const d = parseDate(m.periodEnd);
      if (!d || seen.has(d.getTime())) continue;
      seen.add(d.getTime());
      pts.push({ value: m.normalizedValue!, date: d, ref: m.id, page: pageOf(m.location) });
    }
    for (const o of currentObs(key)) {
      const d = parseDate(o.periodEnd);
      if (!d || seen.has(d.getTime()) || !isNum(o.value)) continue;
      let v = o.value;
      if (def?.unit === "USD") {
        const fx = toUsd(v, o.currency);
        if (!fx) continue;
        v = fx.usd;
        if (key === "arr" && o.periodType === "MONTHLY") v *= 12;
      }
      seen.add(d.getTime());
      pts.push({ value: v, date: d, ref: `obs:${key}@${o.periodEnd}${o.page !== null ? `#p${o.page}` : ""}`, page: o.page });
    }
    pts.sort((a, b) => a.date.getTime() - b.date.getTime() || (a.ref < b.ref ? -1 : 1));
    seriesCache.set(key, pts);
    return pts;
  };
  const seriesGrowth = (key: string): SeriesGrowth | null => {
    const pts = series(key);
    const latest = pts[pts.length - 1];
    if (!latest) return null;
    let prior: SeriesPoint | null = null;
    let bestDist = Infinity;
    for (const p of pts) {
      const months = monthsBetween(p.date, latest.date);
      if (months < 10 || months > 14 || p.value <= 0) continue;
      const dist = Math.abs(months - 12);
      if (dist < bestDist) {
        bestDist = dist;
        prior = p;
      }
    }
    if (!prior) return null;
    const months = monthsBetween(prior.date, latest.date);
    return { growthPct: (latest.value / prior.value - 1) * 100, months, latest, prior };
  };

  const claimPages = (c: Claim) => {
    const ps = arr(c.evidence)
      .filter((e) => e.effect === "ORIGIN" || sourceById.get(e.sourceId)?.kind === "DOCUMENT")
      .map((e) => pageOf(e.location))
      .filter((p): p is number => p !== null);
    return [...new Set(ps)].sort((a, b) => a - b);
  };

  return {
    deal,
    registry: registry ?? null,
    profile: resolved.profile,
    stageBand: resolved.stageBand,
    asOf: resolveAsOf(deal),
    classification,
    metrics,
    observations,
    claims,
    sources,
    sourceById,
    isSoftware,
    isAiHeavy,
    leadMonths: registry?.returns?.fundraisingLeadMonths ?? 6,
    primary,
    stated,
    currentObs,
    series,
    seriesGrowth,
    claimPages,
    metricPage: (m) => pageOf(m.location),
  };
}

/** All text a metric instance carries about its own definition. */
export function metricText(m: MetricInstance): string {
  return [m.label, m.rawValue, m.definitionUsed ?? "", m.components.join(" "), m.cohortDefinition ?? "", m.excerpt ?? ""].join(" ").toLowerCase();
}

export function obsText(o: MetricObservation): string {
  return [o.label, o.rawText, o.definitionAsStated ?? "", arr(o.components).join(" "), o.excerpt].join(" ").toLowerCase();
}

export function hasFlag(m: MetricInstance, prefix: string): boolean {
  return m.qualityFlags.some((f) => f.startsWith(prefix));
}
