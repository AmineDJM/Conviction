/**
 * CONCERN RANKING — which operating variable should worry an investor most.
 *
 * Severity is read from the active benchmark registry (the same curves the
 * scoring engine uses): severity = (100 − curve score) / 100 for the deal's
 * peer group. Then a small set of documented expert adjustments turns the
 * naive reading into the institutional one (TRAINING HEURISTICS, stated in
 * every answer key):
 *
 *  1. Pre-round runway is short by design: if cash + the round covers ≥ 18
 *     months of planned burn, runway severity × 0.35 — but only while there
 *     are ≥ 6 months left to close the round (below that the company can die
 *     before the money arrives, and the raw reading stands).
 *  2. CAC that the integrity engine flags as not fully loaded understates
 *     payback: +0.15 to CAC-payback severity.
 *  3. Growth that the integrity engine flags as computed on a tiny base: +0.25.
 *  4. Retention stated without cohorts / sample: +0.05 (the number is less
 *     reassuring than it looks).
 *  5. Pre-seed / seed: efficiency metrics (burn multiple, payback) × 0.8.
 *
 * `rawSeverity` is the reading before adjustments: when the raw and adjusted
 * rankings disagree, the obvious answer is wrong (case pattern).
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { findBenchmark, interpolate } from "@/engine/scoring/curve";
import { getRegistry } from "@/engine/benchmarks";
import { toUsd } from "@/engine/metrics/normalize";
import type { Concept } from "./types";
import { formatMetric } from "./format";

export interface Concern {
  metricKey: string;
  metricId: string;
  label: string;
  display: string;
  value: number;
  severity: number;
  rawSeverity: number;
  benchmarkId: string;
  concept: Concept;
  adjustments: string[];
  /** Neutral one-line implication used as option text. */
  implication: string;
  /** True when the metric was derived by code from deck inputs (not stated on the deck). */
  derived: boolean;
}

export const CONCERN_METRICS: Record<string, { concept: Concept; implication: (v: string) => string }> = {
  nrr: { concept: "RETENTION_RISK", implication: (v) => `net revenue retention of ${v} decides whether the installed base compounds or leaks` },
  grr: { concept: "RETENTION_RISK", implication: (v) => `gross revenue retention of ${v} shows how much of the base survives each year` },
  logo_retention: { concept: "RETENTION_RISK", implication: (v) => `${v} of customers stay each year` },
  d30_retention: { concept: "RETENTION_RISK", implication: (v) => `${v} of users are still active after 30 days` },
  d1_retention: { concept: "RETENTION_RISK", implication: (v) => `${v} of users return the next day` },
  dau_mau: { concept: "RETENTION_RISK", implication: (v) => `DAU/MAU of ${v} measures how habitual the product is` },
  repeat_rate: { concept: "RETENTION_RISK", implication: (v) => `${v} of buyers transact again` },
  cac_payback_months: { concept: "UNIT_ECONOMICS", implication: (v) => `each new customer takes ${v} of gross profit to repay its acquisition cost` },
  ltv_to_cac: { concept: "UNIT_ECONOMICS", implication: (v) => `lifetime value is ${v} the cost of acquiring a customer` },
  gross_margin: { concept: "UNIT_ECONOMICS", implication: (v) => `gross margin of ${v} caps what each revenue dollar is worth` },
  burn_multiple: { concept: "CAPITAL_EFFICIENCY", implication: (v) => `the company burns ${v} for every dollar of net new ARR` },
  runway_months: { concept: "RUNWAY_FINANCING", implication: (v) => `the company has ${v} of cash at current burn` },
  customer_concentration_top1: { concept: "CUSTOMER_CONCENTRATION", implication: (v) => `the largest customer is ${v} of revenue` },
  customer_concentration_top5: { concept: "CUSTOMER_CONCENTRATION", implication: (v) => `the top five customers are ${v} of revenue` },
  founder_led_revenue_share: { concept: "FOUNDER_DEPENDENCE", implication: (v) => `founders are still involved in ${v} of closed revenue` },
  arr_growth_yoy: { concept: "GROWTH_QUALITY", implication: (v) => `ARR growth of ${v} must persist for years to reach venture scale` },
  revenue_growth_yoy: { concept: "GROWTH_QUALITY", implication: (v) => `revenue growth of ${v} must persist for years to reach venture scale` },
  mom_growth: { concept: "GROWTH_QUALITY", implication: (v) => `month-on-month growth of ${v} must compound for years` },
  pilot_to_production_rate: { concept: "CUSTOMER_QUALITY", implication: (v) => `${v} of pilots convert into production contracts` },
  win_rate: { concept: "COMPETITION", implication: (v) => `the company wins ${v} of qualified opportunities` },
  sales_cycle_days: { concept: "UNIT_ECONOMICS", implication: (v) => `a sales cycle of ${v} sets how fast sales capacity turns into revenue` },
  fill_rate: { concept: "PMF_EVIDENCE", implication: (v) => `only ${v} of demand is matched with supply` },
  loss_rate: { concept: "UNIT_ECONOMICS", implication: (v) => `credit losses of ${v} come straight out of the margin` },
  organic_acquisition_share: { concept: "GROWTH_QUALITY", implication: (v) => `${v} of new users arrive organically` },
};

const round2 = (x: number) => Math.round(x * 1000) / 1000;
/** Below this many months of pre-round runway the round may not close in time: no mitigation. */
export const PRE_ROUND_MIN_MONTHS = 6;

function findingKinds(derived: DerivedAnalysis): Set<string> {
  return new Set((derived.integrity?.findings ?? []).map((f) => f.kind));
}

/** Post-round runway in months, when the round size and a burn figure are known. */
export function postRoundRunwayMonths(deal: CanonicalDeal, metrics: Record<string, MetricInstance>): number | null {
  const f = deal.financing;
  const usd = (m: { amount: number | null; currency: string } | null | undefined) => (m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null);
  const raise = usd(f?.raiseAmount);
  const cash = usd(f?.cashBalance) ?? metrics.cash_balance?.normalizedValue ?? null;
  const burn = deal.financingPath?.plannedMonthlyBurnUsd ?? usd(f?.monthlyBurn) ?? metrics.monthly_net_burn?.normalizedValue ?? null;
  if (raise === null || cash === null || !burn || burn <= 0) return null;
  return (cash + raise) / burn;
}

/**
 * Candidate concern metrics: the deck-reported primary metrics plus metrics derived by code from
 * deck inputs (runway, burn multiple, payback …). Never metrics from calls or research.
 */
export function concernMetrics(deal: CanonicalDeal, deckMetrics: Record<string, MetricInstance>): MetricInstance[] {
  const out = new Map<string, MetricInstance>();
  for (const [k, m] of Object.entries(deckMetrics)) if (CONCERN_METRICS[k]) out.set(k, m);
  for (const m of deal.metrics)
    if (m.isPrimary && m.calculationMethod === "DERIVED" && m.normalizedValue !== null && Number.isFinite(m.normalizedValue) && CONCERN_METRICS[m.metricKey] && !out.has(m.metricKey))
      out.set(m.metricKey, m);
  // Runway and CAC payback computed by code from the deck's own inputs when neither the deck nor the engine states them.
  const v = (k: string) => deckMetrics[k]?.normalizedValue ?? null;
  const synth = (key: string, value: number, basis: MetricInstance): MetricInstance => ({ ...basis, id: `CALC-${key}`, metricKey: key, label: key, rawValue: String(value), normalizedValue: value, calculationMethod: "DERIVED", claimId: null, qualityFlags: [], sampleSize: null });
  if (!out.has("runway_months")) {
    const cash = v("cash_balance");
    const burn = v("monthly_net_burn");
    if (cash !== null && burn !== null && burn > 0) out.set("runway_months", synth("runway_months", cash / burn, deckMetrics.cash_balance!));
  }
  if (!out.has("cac_payback_months")) {
    const cac = v("cac");
    const gm = v("gross_margin");
    const acv = v("acv") ?? (v("arr") !== null && v("paying_customers") ? v("arr")! / v("paying_customers")! : null);
    if (cac !== null && gm !== null && gm > 0 && acv !== null && acv > 0) out.set("cac_payback_months", synth("cac_payback_months", cac / ((acv / 12) * (gm / 100)), deckMetrics.cac!));
  }
  // Prefer ARR growth over revenue growth when both exist (same underlying signal).
  if (out.has("arr_growth_yoy") && out.has("revenue_growth_yoy")) out.delete("revenue_growth_yoy");
  return [...out.values()];
}

export function rankConcerns(deal: CanonicalDeal, derived: DerivedAnalysis, deckMetrics: Record<string, MetricInstance>): Concern[] {
  const registry = getRegistry(derived.registryId);
  const { profile, stageBand } = derived.peerGroup;
  const kinds = findingKinds(derived);
  const out: Concern[] = [];
  for (const m of concernMetrics(deal, deckMetrics)) {
    const spec = CONCERN_METRICS[m.metricKey]!;
    const bench = findBenchmark(registry, m.metricKey, profile, stageBand);
    if (!bench?.curve || m.normalizedValue === null) continue;
    const raw = Math.max(0, Math.min(1, (100 - interpolate(bench.curve, m.normalizedValue)) / 100));
    let sev = raw;
    const adjustments: string[] = [];
    if (m.metricKey === "runway_months" && m.normalizedValue >= PRE_ROUND_MIN_MONTHS) {
      const post = postRoundRunwayMonths(deal, deckMetrics);
      if (post !== null && post >= 18) {
        sev *= 0.35;
        adjustments.push(`Pre-round runway is short by design: cash plus the round funds ~${post.toFixed(0)} months of planned burn.`);
      }
    }
    if (m.metricKey === "cac_payback_months" && (kinds.has("CAC_INCOMPLETE") || kinds.has("CAC_NOT_FULLY_LOADED"))) {
      sev += 0.15;
      adjustments.push("CAC is not fully loaded, so the true payback is longer than the number shown.");
    }
    if (spec.concept === "GROWTH_QUALITY" && kinds.has("GROWTH_ON_TINY_BASE")) {
      sev += 0.25;
      adjustments.push("Growth is computed on a tiny base — the percentage overstates momentum.");
    }
    if (spec.concept === "RETENTION_RISK" && (kinds.has("RETENTION_WITHOUT_COHORTS") || m.sampleSize === null)) {
      sev += 0.05;
      adjustments.push("Retention is stated without cohorts or sample — it is less reassuring than it looks.");
    }
    if (stageBand === "EARLY" && (m.metricKey === "burn_multiple" || m.metricKey === "cac_payback_months")) {
      sev *= 0.8;
      adjustments.push("At pre-seed / seed, efficiency metrics are noisy and weigh less.");
    }
    const def = metricDef(m.metricKey);
    const display = formatMetric(m);
    out.push({
      metricKey: m.metricKey,
      metricId: m.id,
      label: def?.shortName ?? m.metricKey,
      display,
      value: m.normalizedValue,
      severity: round2(Math.min(1, sev)),
      rawSeverity: round2(raw),
      benchmarkId: bench.id,
      concept: spec.concept,
      adjustments,
      implication: spec.implication(display),
      derived: m.calculationMethod === "DERIVED",
    });
  }
  return out.sort((a, b) => b.severity - a.severity || b.rawSeverity - a.rawSeverity || (a.metricKey < b.metricKey ? -1 : 1));
}

/** The concern a naive (unadjusted) reading would pick. */
export function naiveTopConcern(concerns: Concern[]): Concern | null {
  return [...concerns].sort((a, b) => b.rawSeverity - a.rawSeverity || (a.metricKey < b.metricKey ? -1 : 1))[0] ?? null;
}
