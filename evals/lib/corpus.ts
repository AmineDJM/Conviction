/**
 * Pure scoring of one analysed deck against its ground truth (evals/fixtures/ground-truth.json),
 * plus the corpus snapshot used by the `regression` suite to show drift after
 * prompt or engine changes. No I/O. Tested in tests/evals.corpus.test.ts.
 */
import { withinRel } from "./metrics";

export interface ExpectedFinding {
  trap: string;
  /** Detected when ANY of these integrity finding kinds is present. */
  anyOf: string[];
}

export interface ExpectedFlags {
  securityFlag?: boolean;
  notRecommendInvest?: boolean;
  /** derived.market.deckInflation must be at least this (deck TAM ÷ reconstructed high). */
  tamInflationMin?: number;
  /** No current recurring or trailing revenue may be recorded (pre-revenue company). */
  noCurrentRevenue?: boolean;
  /** Outstanding SAFEs / notes recorded in the cap table (divergence.capTable.convertibles). */
  minOutstandingConvertibles?: number;
}

export interface DeckTruth {
  name: string;
  archetype?: string;
  financingStage: string;
  founders: string[];
  metrics: Record<string, number>;
  mustNotBeCurrentMetrics?: Record<string, number>;
  round: { raiseUsd: number; preMoneyUsd?: number; capUsd?: number; instrument: string };
  injection: boolean;
  traps?: string[];
  expectedFindings?: ExpectedFinding[];
  expectedFlags?: ExpectedFlags;
}

export interface ObservedMetric {
  metricKey: string;
  normalizedValue: number | null;
  isPrimary: boolean;
  calculationMethod: string;
  state: string;
}

/** What the evals read from a stored analysis version (a small, stable projection). */
export interface DeckObservation {
  name: string;
  stage: string;
  founders: string[];
  metrics: ObservedMetric[];
  instrument: string | null;
  raiseUsd: number | null;
  preMoneyUsd: number | null;
  capUsd: number | null;
  findingKinds: string[];
  securityFlags: number;
  recommendation: string;
  deckInflation: number | null;
  outstandingConvertibles: number;
  oqi: number | null;
  tractionPmf: number | null;
}

export function observe(canonical: any, derived: any): DeckObservation {
  const f = canonical?.financing ?? null;
  const metrics: ObservedMetric[] = (canonical?.metrics ?? []).map((m: any) => ({
    metricKey: m.metricKey,
    normalizedValue: typeof m.normalizedValue === "number" ? m.normalizedValue : null,
    isPrimary: !!m.isPrimary,
    calculationMethod: String(m.calculationMethod ?? ""),
    state: String(m.state ?? ""),
  }));
  // Cash and burn may be recorded on the financing section only (that is what runway and the UI read).
  for (const [key, money] of [
    ["cash_balance", f?.cashBalance],
    ["monthly_net_burn", f?.monthlyBurn],
  ] as const) {
    if (!metrics.some((m) => m.metricKey === key && m.isPrimary) && typeof money?.amount === "number" && (money.currency ?? "USD") === "USD")
      metrics.push({ metricKey: key, normalizedValue: money.amount, isPrimary: true, calculationMethod: "FINANCING_SECTION", state: "OBSERVED" });
  }
  return {
    name: String(canonical?.identity?.name ?? ""),
    stage: String(canonical?.classification?.financingStage ?? "UNKNOWN"),
    founders: (canonical?.foundersFromDeck ?? []).map((x: any) => String(x?.name ?? "")),
    metrics,
    instrument: f?.instrument ?? null,
    raiseUsd: f?.raiseAmount?.amount ?? null,
    preMoneyUsd: f?.preMoney?.amount ?? null,
    capUsd: f?.valuationCap?.amount ?? null,
    findingKinds: [...new Set<string>((derived?.integrity?.findings ?? []).map((x: any) => String(x.kind)))].sort(),
    securityFlags: (canonical?.analysis?.securityFlags ?? []).length,
    recommendation: String(derived?.recommendation?.status ?? "UNKNOWN"),
    deckInflation: typeof derived?.market?.deckInflation === "number" ? derived.market.deckInflation : null,
    outstandingConvertibles: (canonical?.divergence?.capTable?.convertibles ?? []).length,
    oqi: typeof derived?.operatingQuality?.value === "number" ? derived.operatingQuality.value : null,
    tractionPmf: (derived?.dimensions ?? []).find((d: any) => d.id === "TRACTION_PMF")?.value ?? null,
  };
}

/** The primary current value the product would show: REPORTED primary first, else any primary. */
export function primaryValue(metrics: ObservedMetric[], key: string): number | null {
  const m = metrics.find((x) => x.metricKey === key && x.isPrimary && x.calculationMethod === "REPORTED") ?? metrics.find((x) => x.metricKey === key && x.isPrimary);
  return m?.normalizedValue ?? null;
}

export interface ExtractionScore {
  name: boolean;
  stage: boolean;
  founders: { ok: boolean; missing: string[] };
  metrics: { key: string; expected: number; got: number | null; ok: boolean }[];
  ok: number;
  total: number;
  mustNot: { key: string; bad: number; got: number | null; ok: boolean }[];
  roundSize: { expected: number; got: number | null; ok: boolean };
  instrument: { expected: string; got: string | null; ok: boolean };
  valuation: { kind: "PRE_MONEY" | "CAP" | null; expected: number | null; got: number | null; ok: boolean | null };
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^(dr|prof)\.?\s+/, "").trim();

export function scoreExtraction(o: DeckObservation, t: DeckTruth): ExtractionScore {
  const names = o.founders.map(norm);
  const missing = t.founders.filter((n) => !names.some((x) => x.includes(norm(n))));
  const metrics = Object.entries(t.metrics).map(([key, expected]) => {
    const got = primaryValue(o.metrics, key);
    return { key, expected, got, ok: withinRel(got, expected) };
  });
  const mustNot = Object.entries(t.mustNotBeCurrentMetrics ?? {}).map(([key, bad]) => {
    const got = primaryValue(o.metrics, key);
    return { key, bad, got, ok: !withinRel(got, bad) };
  });
  const valuation =
    t.round.preMoneyUsd !== undefined
      ? { kind: "PRE_MONEY" as const, expected: t.round.preMoneyUsd, got: o.preMoneyUsd, ok: withinRel(o.preMoneyUsd, t.round.preMoneyUsd) }
      : t.round.capUsd !== undefined
        ? { kind: "CAP" as const, expected: t.round.capUsd, got: o.capUsd, ok: withinRel(o.capUsd, t.round.capUsd) }
        : { kind: null, expected: null, got: null, ok: null };
  return {
    name: o.name.toLowerCase().includes(t.name.toLowerCase()) || (o.name.length >= 3 && t.name.toLowerCase().includes(o.name.toLowerCase())),
    stage: o.stage === t.financingStage,
    founders: { ok: missing.length === 0, missing },
    metrics,
    ok: metrics.filter((m) => m.ok).length,
    total: metrics.length,
    mustNot,
    roundSize: { expected: t.round.raiseUsd, got: o.raiseUsd, ok: withinRel(o.raiseUsd, t.round.raiseUsd) },
    instrument: { expected: t.round.instrument, got: o.instrument, ok: o.instrument === t.round.instrument },
    valuation,
  };
}

export interface IntegrityScore {
  traps: { trap: string; anyOf: string[]; detected: boolean; matched: string[] }[];
  detected: number;
  expected: number;
  flags: { flag: keyof ExpectedFlags; expected: boolean | number; got: boolean | number | null; ok: boolean }[];
}

const REVENUE_KEYS = ["arr", "mrr", "revenue_ttm"];

export function scoreIntegrity(o: DeckObservation, t: DeckTruth): IntegrityScore {
  const kinds = new Set(o.findingKinds);
  const traps = (t.expectedFindings ?? []).map((e) => {
    const matched = e.anyOf.filter((k) => kinds.has(k));
    return { trap: e.trap, anyOf: e.anyOf, detected: matched.length > 0, matched };
  });
  const flags: IntegrityScore["flags"] = [];
  const x = t.expectedFlags ?? {};
  if (x.securityFlag !== undefined) flags.push({ flag: "securityFlag", expected: x.securityFlag, got: o.securityFlags > 0, ok: o.securityFlags > 0 === x.securityFlag });
  if (x.notRecommendInvest) {
    const invest = o.recommendation === "ANALYTICAL_RECOMMEND_INVEST" || o.recommendation === "IC_READY";
    flags.push({ flag: "notRecommendInvest", expected: true, got: !invest, ok: !invest });
  }
  if (x.tamInflationMin !== undefined) flags.push({ flag: "tamInflationMin", expected: x.tamInflationMin, got: o.deckInflation, ok: o.deckInflation !== null && o.deckInflation >= x.tamInflationMin });
  if (x.noCurrentRevenue) {
    const has = o.metrics.some((m) => REVENUE_KEYS.includes(m.metricKey) && m.isPrimary && m.state === "OBSERVED" && (m.normalizedValue ?? 0) > 0);
    flags.push({ flag: "noCurrentRevenue", expected: true, got: !has, ok: !has });
  }
  if (x.minOutstandingConvertibles !== undefined)
    flags.push({ flag: "minOutstandingConvertibles", expected: x.minOutstandingConvertibles, got: o.outstandingConvertibles, ok: o.outstandingConvertibles >= x.minOutstandingConvertibles });
  return { traps, detected: traps.filter((r) => r.detected).length, expected: traps.length, flags };
}

/* ------------------------------ Corpus snapshot & drift (regression) ------------------------------ */

export interface DeckSnapshot {
  name: string;
  stage: string;
  instrument: string | null;
  raiseUsd: number | null;
  /** Primary value of every ground-truth and must-not metric key. */
  metrics: Record<string, number | null>;
  findingKinds: string[];
  securityFlags: number;
  recommendation: string;
  oqi: number | null;
  tractionPmf: number | null;
}

export function snapshotOf(o: DeckObservation, t: DeckTruth): DeckSnapshot {
  const keys = [...new Set([...Object.keys(t.metrics), ...Object.keys(t.mustNotBeCurrentMetrics ?? {})])].sort();
  return {
    name: o.name,
    stage: o.stage,
    instrument: o.instrument,
    raiseUsd: o.raiseUsd,
    metrics: Object.fromEntries(keys.map((k) => [k, primaryValue(o.metrics, k)])),
    findingKinds: o.findingKinds,
    securityFlags: o.securityFlags,
    recommendation: o.recommendation,
    oqi: o.oqi,
    tractionPmf: o.tractionPmf,
  };
}

export interface DriftTolerance {
  /** Absolute tolerance on OQI and Traction/PMF before a change is reported. */
  score: number;
  /** Relative tolerance on metric values. */
  metricRel: number;
}
export const DEFAULT_DRIFT_TOLERANCE: DriftTolerance = { score: 3, metricRel: 0.01 };

/** Human-readable drift between a stored baseline and the current run for one deck. Empty = no drift. */
export function diffSnapshot(base: DeckSnapshot, now: DeckSnapshot, tol: DriftTolerance = DEFAULT_DRIFT_TOLERANCE): string[] {
  const out: string[] = [];
  if (base.stage !== now.stage) out.push(`stage ${base.stage} → ${now.stage}`);
  if (base.instrument !== now.instrument) out.push(`instrument ${base.instrument} → ${now.instrument}`);
  if ((base.raiseUsd ?? null) !== (now.raiseUsd ?? null) && !withinRel(now.raiseUsd, base.raiseUsd ?? NaN, tol.metricRel)) out.push(`raise ${base.raiseUsd} → ${now.raiseUsd}`);
  for (const k of [...new Set([...Object.keys(base.metrics), ...Object.keys(now.metrics)])].sort()) {
    const a = base.metrics[k] ?? null;
    const b = now.metrics[k] ?? null;
    if (a === null && b === null) continue;
    if (a === null || b === null || !withinRel(b, a, tol.metricRel)) out.push(`${k} ${a ?? "missing"} → ${b ?? "missing"}`);
  }
  const gained = now.findingKinds.filter((k) => !base.findingKinds.includes(k));
  const lost = base.findingKinds.filter((k) => !now.findingKinds.includes(k));
  if (gained.length) out.push(`+findings ${gained.join(",")}`);
  if (lost.length) out.push(`−findings ${lost.join(",")}`);
  if ((base.securityFlags > 0) !== (now.securityFlags > 0)) out.push(`security flags ${base.securityFlags} → ${now.securityFlags}`);
  if (base.recommendation !== now.recommendation) out.push(`recommendation ${base.recommendation} → ${now.recommendation}`);
  const d = (x: number | null, y: number | null) => (x === null || y === null ? (x === y ? 0 : Infinity) : Math.abs(x - y));
  if (d(base.oqi, now.oqi) > tol.score) out.push(`OQI ${base.oqi} → ${now.oqi}`);
  if (d(base.tractionPmf, now.tractionPmf) > tol.score) out.push(`Traction/PMF ${base.tractionPmf} → ${now.tractionPmf}`);
  return out;
}
