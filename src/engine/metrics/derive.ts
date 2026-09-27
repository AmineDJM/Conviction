/**
 * Deterministic derivation of metrics from other metrics (formulas from the
 * dictionary). Derived instances never overwrite reported ones; when both
 * exist and disagree materially, the reported one is flagged.
 */
import type { MetricInstance } from "@/domain/canonical";
import type { DataState, VerificationStatus } from "@/domain/enums";
import { burnMultiple, cacPaybackMonths, ratio, runwayMonths } from "../calc/finance";
import { parsePeriodDate, selectPrimary } from "./normalize";

const STATE_RANK: DataState[] = ["OBSERVED", "INFERRED", "STALE", "UNKNOWN", "WITHHELD", "CONTRADICTED", "NOT_APPLICABLE", "NOT_YET_MEANINGFUL"];
const VER_RANK: VerificationStatus[] = ["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "CONTRADICTED"];

function weakestState(ms: MetricInstance[]): DataState {
  return ms.map((m) => m.state).sort((a, b) => STATE_RANK.indexOf(b) - STATE_RANK.indexOf(a))[0] ?? "UNKNOWN";
}
function weakestVerification(ms: MetricInstance[]): VerificationStatus {
  return ms.map((m) => m.verification).sort((a, b) => VER_RANK.indexOf(b) - VER_RANK.indexOf(a))[0] ?? "UNVERIFIED";
}

export function deriveMetrics(input: MetricInstance[], nextId: () => string): MetricInstance[] {
  let metrics = selectPrimary(input);
  const primary = (k: string) => metrics.find((m) => m.metricKey === k && m.isPrimary && m.normalizedValue !== null && (m.state === "OBSERVED" || m.state === "INFERRED" || m.state === "STALE"));
  const has = (k: string) => metrics.some((m) => m.metricKey === k && m.isPrimary && m.normalizedValue !== null && m.state !== "UNKNOWN");

  /**
   * `stateFrom`: inputs whose state/verification govern the derived value. For period-over-period
   * metrics (growth, burn multiple) the comparison point is necessarily old; only the latest
   * point decides staleness.
   */
  const add = (key: string, value: number | null, inputs: MetricInstance[], derivation: string, unit: string, extraFlags: string[] = [], stateFrom: MetricInstance[] = inputs) => {
    if (value === null || !Number.isFinite(value)) return;
    const periodEnd = inputs.map((i) => i.periodEnd).filter(Boolean).sort().pop() ?? null;
    metrics.push({
      id: nextId(),
      metricKey: key,
      label: key,
      rawValue: derivation,
      normalizedValue: value,
      unit,
      currency: unit === "USD" ? "USD" : null,
      periodType: "POINT_IN_TIME",
      periodStart: null,
      periodEnd,
      definitionUsed: derivation,
      components: [],
      entityScope: "company",
      sampleSize: inputs.map((i) => i.sampleSize).find((s) => s !== null) ?? null,
      cohortDefinition: null,
      state: weakestState(stateFrom),
      sourceId: null,
      claimId: null,
      location: null,
      excerpt: null,
      verification: weakestVerification(inputs),
      calculationMethod: "DERIVED",
      derivation,
      isPrimary: false,
      qualityFlags: [
        ...new Set([
          ...inputs.flatMap((i) =>
            i.qualityFlags.filter((f) => !f.startsWith("EXTRACTION") && !(f.startsWith("STALE") && !stateFrom.some((x) => x.id === i.id && x.state === "STALE"))),
          ),
          ...extraFlags,
        ]),
      ],
      notes: `Derived from ${inputs.map((i) => i.id).join(", ")}`,
    });
    metrics = selectPrimary(metrics);
  };

  const mrr = primary("mrr");
  if (!has("arr") && mrr) add("arr", mrr.normalizedValue! * 12, [mrr], "MRR × 12", "USD", ["RUN_RATE_FROM_MRR"]);

  // ARR growth from a time series ~12 months apart.
  if (!has("arr_growth_yoy")) {
    const series = metrics
      .filter((m) => m.metricKey === "arr" && m.normalizedValue !== null && m.periodEnd && m.state !== "UNKNOWN")
      .map((m) => ({ m, d: parsePeriodDate(m.periodEnd)! }))
      .filter((x) => x.d)
      .sort((a, b) => b.d.getTime() - a.d.getTime());
    const latest = series[0];
    if (latest) {
      const prior = series.find((x) => {
        const months = (latest.d.getTime() - x.d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
        return months >= 10 && months <= 14;
      });
      if (prior && prior.m.normalizedValue! > 0) {
        const g = (latest.m.normalizedValue! / prior.m.normalizedValue! - 1) * 100;
        const priorOk = prior.m.state === "STALE" ? { ...prior.m, state: "OBSERVED" as const } : prior.m;
        add("arr_growth_yoy", g, [latest.m, prior.m], `(ARR ${latest.m.periodEnd} / ARR ${prior.m.periodEnd} − 1) × 100`, "PERCENT", [], [latest.m, priorOk]);
        const burn = primary("monthly_net_burn");
        if (!has("burn_multiple") && burn) {
          const netNew = latest.m.normalizedValue! - prior.m.normalizedValue!;
          const bm = burnMultiple(burn.normalizedValue! * 12, netNew);
          add("burn_multiple", bm, [burn, latest.m, prior.m], "Current monthly net burn × 12 / net new ARR over 12 months", "MULTIPLE", ["BURN_ASSUMED_CONSTANT_OVER_PERIOD"], [burn, latest.m, priorOk]);
        }
      }
    }
  }

  const arr = primary("arr");
  const customers = primary("paying_customers");
  if (!has("acv") && arr && customers && customers.normalizedValue! > 0)
    add("acv", ratio(arr.normalizedValue, customers.normalizedValue), [arr, customers], "ARR / paying customers", "USD", ["MEAN_NOT_MEDIAN"]);

  const cash = primary("cash_balance");
  const burn = primary("monthly_net_burn");
  if (!has("runway_months") && cash && burn) add("runway_months", runwayMonths(cash.normalizedValue!, burn.normalizedValue!), [cash, burn], "Cash / monthly net burn (pre-round)", "MONTHS");

  const cac = primary("cac");
  const acv = primary("acv");
  const gm = primary("gross_margin");
  if (!has("cac_payback_months") && cac && acv && gm)
    add("cac_payback_months", cacPaybackMonths(cac.normalizedValue!, acv.normalizedValue!, gm.normalizedValue!), [cac, acv, gm], "CAC / (ACV/12 × gross margin)", "MONTHS");

  const ltv = primary("ltv");
  if (!has("ltv_to_cac") && ltv && cac) add("ltv_to_cac", ratio(ltv.normalizedValue, cac.normalizedValue), [ltv, cac], "LTV / CAC", "MULTIPLE");

  const dau = primary("dau");
  const mau = primary("mau");
  if (!has("dau_mau") && dau && mau) add("dau_mau", (ratio(dau.normalizedValue, mau.normalizedValue) ?? 0) * 100, [dau, mau], "DAU / MAU × 100", "PERCENT");

  const hc = primary("headcount");
  if (!has("revenue_per_employee") && arr && hc) add("revenue_per_employee", ratio(arr.normalizedValue, hc.normalizedValue), [arr, hc], "ARR / headcount", "USD");

  // Consistency check: reported vs derivable ACV / runway.
  for (const key of ["runway_months", "acv"]) {
    const reported = metrics.find((m) => m.metricKey === key && m.calculationMethod === "REPORTED" && m.isPrimary);
    if (!reported || reported.normalizedValue === null) continue;
    let recomputed: number | null = null;
    if (key === "runway_months" && cash && burn) recomputed = runwayMonths(cash.normalizedValue!, burn.normalizedValue!);
    if (key === "acv" && arr && customers) recomputed = ratio(arr.normalizedValue, customers.normalizedValue);
    if (recomputed !== null && Math.abs(recomputed - reported.normalizedValue) / Math.max(1e-9, Math.abs(recomputed)) > 0.2) {
      reported.qualityFlags.push(`INCONSISTENT_WITH_INPUTS: recomputed ${recomputed.toFixed(1)}`);
    }
  }
  return metrics;
}
