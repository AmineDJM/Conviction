/**
 * PMF signal quality anchored on MEASURED signals.
 *
 * The model's PMF_SIGNAL_QUALITY rating varied by one rubric step between two
 * decks with identical metrics (marketing rewrite). When the record contains
 * measured PMF signals, code decides the rating from them on the same
 * benchmark curves used everywhere else; the model's judgment is kept, shown,
 * and used only where measurement is thin:
 *
 *   ≥ 2 measured signals → rating = conservative median of the signal ratings
 *   1 measured signal    → model rating clamped to ±1 step of that signal
 *   0 measured signals   → INSUFFICIENT_EVIDENCE (the model's qualitative view is kept
 *                          in the rationale). Otherwise hiding a weak retention metric
 *                          would hand the rating back to unanchored judgment — the
 *                          missing-data invariant forbids that.
 *
 * A signal on a small or unknown sample never rates above ADEQUATE; EXCEPTIONAL
 * is never reached from metrics alone.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { RubricRating } from "@/domain/enums";
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

export function measuredPmf(deal: CanonicalDeal, registry: BenchmarkRegistry, profile: ProfileId, stageBand: StageBand, modelRating: RubricRating | null): MeasuredPmf {
  const signals: MeasuredPmf["signals"] = [];
  for (const key of PMF_SIGNAL_KEYS) {
    const m = deal.metrics.find((x) => x.metricKey === key && x.isPrimary && x.state === "OBSERVED" && x.normalizedValue !== null);
    if (!m) continue;
    const b = findBenchmark(registry, key, profile, stageBand);
    if (!b?.curve) continue;
    const score = interpolate(b.curve, m.normalizedValue!);
    let rating = fromScore(score);
    const min = metricDef(key)?.quality.minSampleSize;
    const small = m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN")) || (min !== undefined && (m.sampleSize === null || m.sampleSize < min));
    const capped = small && SCALE.indexOf(rating) > SCALE.indexOf("ADEQUATE");
    if (capped) rating = "ADEQUATE";
    signals.push({ metricId: m.id, key, label: `${metricDef(key)?.shortName ?? key} ${m.rawValue}`, score: +score.toFixed(1), rating, capped });
  }
  const idx = signals.map((s) => SCALE.indexOf(s.rating as (typeof SCALE)[number])).sort((a, b) => a - b);
  // Conservative median: the lower middle for an even count.
  const measuredRating = idx.length ? SCALE[idx[Math.floor((idx.length - 1) / 2)]!]! : null;
  const list = signals.map((s) => `${s.label} → ${s.rating}${s.capped ? " (small sample, capped)" : ""}`).join("; ");

  if (signals.length >= 2) {
    return { signals, measuredRating, effectiveRating: measuredRating, mode: "MEASURED", explanation: `Rated from ${signals.length} measured signals (${list}); model judged ${modelRating ?? "not assessed"}.` };
  }
  if (signals.length === 1 && modelRating && modelRating !== "INSUFFICIENT_EVIDENCE") {
    const center = SCALE.indexOf(measuredRating as (typeof SCALE)[number]);
    const m = SCALE.indexOf(modelRating as (typeof SCALE)[number]);
    const clamped = SCALE[Math.max(center - 1, Math.min(center + 1, m))]!;
    return {
      signals,
      measuredRating,
      effectiveRating: clamped,
      mode: "CLAMPED",
      explanation: clamped === modelRating ? `Model rating ${modelRating} is consistent with the measured signal (${list}).` : `Model rating ${modelRating} clamped to ${clamped}: within one step of the measured signal (${list}).`,
    };
  }
  if (signals.length === 1) return { signals, measuredRating, effectiveRating: measuredRating, mode: "MEASURED", explanation: `One measured signal (${list}) and no model rating.` };
  return {
    signals,
    measuredRating: null,
    effectiveRating: "INSUFFICIENT_EVIDENCE",
    mode: "UNMEASURED",
    explanation: `No measured PMF signal (retention, cohorts, pilot conversion). PMF quality is not scored without measurement${modelRating && modelRating !== "INSUFFICIENT_EVIDENCE" ? `; the model's qualitative view was ${modelRating}` : ""}.`,
  };
}
