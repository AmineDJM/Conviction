/**
 * PMF signal quality anchored on MEASURED signals.
 *
 * The model's PMF_SIGNAL_QUALITY rating varied by one rubric step between two
 * decks with identical metrics (marketing rewrite). When the record contains
 * measured PMF signals, code decides the rating from them on the same
 * benchmark curves used everywhere else; the model's judgment is kept and shown.
 *
 * MONOTONE BY CONSTRUCTION — withholding a signal can never raise the rating.
 * The expected signals are the PMF keys with a benchmark curve for the peer
 * group (E of them). The rating is the conservative (lower) median of those E
 * slots, an undisclosed / stale / undated / unmeasured slot counted at the
 * bottom (below WEAK = INSUFFICIENT_EVIDENCE). Equivalently: the k-th best
 * measured signal, k = E − ⌊(E−1)/2⌋, fixed per peer group. Removing a signal
 * lowers one slot to the bottom, so every order statistic can only fall.
 *
 *   ≥ k measured signals → rating = k-th best signal (MEASURED)
 *   fewer than k         → INSUFFICIENT_EVIDENCE (UNMEASURED): the median slot is
 *                          an undisclosed signal. A thin set cannot be rated above
 *                          WEAK without breaking monotonicity ({s} ⊂ {s, WEAK}).
 *   k = 1 (single-signal peer group) → model rating clamped to [signal − 1, signal]
 *                          (CLAMPED): never above what was measured.
 *
 * A signal on a small or unknown sample never rates above ADEQUATE; EXCEPTIONAL
 * is never reached from metrics alone.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { OperationalMaturity, RubricRating } from "@/domain/enums";
import type { BenchmarkRegistry, ProfileId, StageBand } from "../benchmarks/types";
import { findBenchmark, interpolate } from "./curve";
import { metricDef } from "../metrics/dictionary";

export const PMF_SIGNAL_KEYS = ["nrr", "grr", "logo_retention", "pilot_to_production_rate", "d30_retention", "repeat_rate"] as const;
const SCALE: Exclude<RubricRating, "INSUFFICIENT_EVIDENCE">[] = ["WEAK", "BELOW_BAR", "ADEQUATE", "STRONG", "EXCEPTIONAL"];

export interface MeasuredPmf {
  signals: { metricId: string; key: string; label: string; score: number; rating: RubricRating; capped: boolean }[];
  measuredRating: RubricRating | null;
  effectiveRating: RubricRating | null;
  mode: "MEASURED" | "CLAMPED" | "UNMEASURED";
  explanation: string;
}

function fromScore(score: number): Exclude<RubricRating, "INSUFFICIENT_EVIDENCE"> {
  return score >= 85 ? "STRONG" : score >= 60 ? "ADEQUATE" : score >= 35 ? "BELOW_BAR" : "WEAK";
}

const BOTTOM = -1; // an expected signal that is not measured: below WEAK
/** Order used for monotonicity checks: INSUFFICIENT_EVIDENCE (unmeasured) below WEAK. */
export const pmfRank = (r: RubricRating | null) => (r === null || r === "INSUFFICIENT_EVIDENCE" ? BOTTOM : SCALE.indexOf(r));

/**
 * The PMF signal keys a complete record would carry for this peer group and operating maturity: a benchmark curve
 * exists, and the registry's Traction/PMF component for that key applies at this stage band and maturity (retention is
 * not meaningful before PMF_EMERGING; pilot conversion is an EARLY-band signal). Applicability comes from the registry
 * and the company's classified maturity — never from which figures the deck chose to show.
 */
export function expectedPmfSignals(registry: BenchmarkRegistry, profile: ProfileId, stageBand: StageBand, maturity?: OperationalMaturity | null): string[] {
  const dim = registry.dimensions.find((d) => d.id === "TRACTION_PMF");
  const specs = dim ? (dim.profileOverrides?.[profile] ?? dim.components) : [];
  return PMF_SIGNAL_KEYS.filter((k) => {
    if (!findBenchmark(registry, k, profile, stageBand)?.curve) return false;
    const spec = specs.find((c): c is Extract<typeof c, { kind: "METRIC" }> => c.kind === "METRIC" && c.metricKeys.includes(k as never));
    if (!spec) return true;
    if (spec.stageBands && !spec.stageBands.includes(stageBand)) return false;
    if (spec.minMaturity && maturity && registry.maturityOrder.indexOf(maturity) < registry.maturityOrder.indexOf(spec.minMaturity)) return false;
    return true;
  });
}

export function measuredPmf(deal: CanonicalDeal, registry: BenchmarkRegistry, profile: ProfileId, stageBand: StageBand, modelRating: RubricRating | null): MeasuredPmf {
  const expected = expectedPmfSignals(registry, profile, stageBand, deal.classification?.operationalMaturity ?? null);
  const signals: MeasuredPmf["signals"] = [];
  for (const key of expected) {
    // An undated figure is treated like a stale one (not current evidence): withholding the as-of date must not pay.
    const m = deal.metrics.find((x) => x.metricKey === key && x.isPrimary && x.state === "OBSERVED" && x.normalizedValue !== null && !x.qualityFlags.some((f) => f.startsWith("NO_AS_OF_DATE")));
    if (!m) continue;
    const b = findBenchmark(registry, key, profile, stageBand)!;
    const score = interpolate(b.curve!, m.normalizedValue!);
    let rating = fromScore(score);
    const min = metricDef(key)?.quality.minSampleSize;
    const small = m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN")) || (min !== undefined && (m.sampleSize === null || m.sampleSize < min));
    const capped = small && SCALE.indexOf(rating) > SCALE.indexOf("ADEQUATE");
    if (capped) rating = "ADEQUATE";
    signals.push({ metricId: m.id, key, label: `${metricDef(key)?.shortName ?? key} ${m.rawValue}`, score: +score.toFixed(1), rating, capped });
  }
  const E = expected.length;
  // Conservative median of the E expected slots (lower middle), counted from the top.
  const k = E - Math.floor((E - 1) / 2);
  const desc = signals.map((s) => SCALE.indexOf(s.rating as (typeof SCALE)[number])).sort((a, b) => b - a);
  const kth = desc.length >= k && k > 0 ? SCALE[desc[k - 1]!]! : null;
  const measuredRating = kth;
  const list = signals.map((s) => `${s.label} → ${s.rating}${s.capped ? " (small sample, capped)" : ""}`).join("; ");
  const missing = expected.filter((key) => !signals.some((s) => s.key === key)).map((key) => metricDef(key)?.shortName ?? key);
  const model = modelRating && modelRating !== "INSUFFICIENT_EVIDENCE" ? modelRating : null;

  if (kth && k === 1 && model) {
    const center = SCALE.indexOf(kth);
    const clamped = SCALE[Math.max(center - 1, Math.min(center, SCALE.indexOf(model)))]!;
    return {
      signals,
      measuredRating,
      effectiveRating: clamped,
      mode: "CLAMPED",
      explanation: clamped === modelRating ? `Model rating ${modelRating} is consistent with the measured signal (${list}).` : `Model rating ${modelRating} clamped to ${clamped}: never above the measured signal and at most one step below (${list}).`,
    };
  }
  if (kth) {
    return {
      signals,
      measuredRating,
      effectiveRating: kth,
      mode: "MEASURED",
      explanation: `Rated from ${signals.length} of ${E} expected measured signals (${list})${missing.length ? `; not measured: ${missing.join(", ")} (counted at the bottom)` : ""}; model judged ${modelRating ?? "not assessed"}.`,
    };
  }
  return {
    signals,
    measuredRating: null,
    effectiveRating: "INSUFFICIENT_EVIDENCE",
    mode: "UNMEASURED",
    explanation: signals.length
      ? `Only ${signals.length} of ${E} expected PMF signals measured (${list}); ${k} are needed to rate PMF quality — not measured: ${missing.join(", ")}. PMF quality is not scored on a partial set (withholding a weak signal must not help)${model ? `; the model's qualitative view was ${model}` : ""}.`
      : `No measured PMF signal (retention, cohorts, pilot conversion). PMF quality is not scored without measurement${model ? `; the model's qualitative view was ${model}` : ""}.`,
  };
}
