/**
 * Power-Law Potential — an anchored index, not a probability (§20–22).
 * Kept separate from operating quality so that an exceptional company can
 * advance despite a mediocre composite.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { RubricRating } from "@/domain/enums";
import type { BenchmarkRegistry } from "../benchmarks/types";
import { aggregate, type IndexScore } from "./dimensions";
import { benchmarkById, interpolate } from "./curve";
import type { MarketReconstruction } from "../market";
import type { BackwardsResult } from "../returns";

export interface PowerLawResult extends IndexScore {
  components: { id: string; label: string; score: number | null; basis: string }[];
}

const RATING_ORDER: RubricRating[] = ["INSUFFICIENT_EVIDENCE", "WEAK", "BELOW_BAR", "ADEQUATE", "STRONG", "EXCEPTIONAL"];

export function powerLaw(
  deal: CanonicalDeal,
  registry: BenchmarkRegistry,
  market: MarketReconstruction,
  backwards: BackwardsResult | null,
): PowerLawResult {
  const pts = registry.rubricPoints;
  const w = registry.powerLaw.weights;
  const toPts = (r: string | null | undefined) =>
    r && r !== "INSUFFICIENT_EVIDENCE" && r in pts ? pts[r as keyof typeof pts] : null;

  const ceilingBm = benchmarkById(registry, registry.powerLaw.marketCeilingBenchmarkId);
  const ceiling = market.primary && ceilingBm?.curve ? interpolate(ceilingBm.curve, market.primary.highUsd) : null;

  const mech = toPts(deal.powerLawRatings?.nonlinearMechanism);

  const best = deal.exceptionalStrengths
    .map((s) => s.rating)
    .sort((a, b) => RATING_ORDER.indexOf(b) - RATING_ORDER.indexOf(a))[0];
  const exc = toPts(best ?? deal.powerLawRatings?.exceptionalStrength);

  const pathBm = benchmarkById(registry, registry.powerLaw.outlierPathBenchmarkId);
  const path =
    backwards?.medianSamSharePct !== null && backwards?.medianSamSharePct !== undefined && pathBm?.curve
      ? interpolate(pathBm.curve, backwards.medianSamSharePct)
      : null;

  const components = [
    { id: "MARKET_CEILING", label: "Market ceiling", score: ceiling, basis: market.primary ? `Reconstructed ${market.primary.method} upper bound` : "No reconstructed market" },
    { id: "NONLINEAR_MECHANISM", label: "Nonlinear mechanism", score: mech, basis: deal.nonlinear?.mechanism ?? "Not assessed" },
    { id: "EXCEPTIONAL_STRENGTH", label: "Exceptional strength", score: exc, basis: deal.exceptionalStrengths[0]?.claim ?? "None identified" },
    { id: "OUTLIER_PATH", label: "Outlier path plausibility", score: path, basis: backwards?.explanation ?? "Backwards analysis unavailable" },
  ];
  const agg = aggregate(registry, [
    { weight: w.MARKET_CEILING, credit: ceiling === null ? 0 : 1, score: ceiling },
    { weight: w.NONLINEAR_MECHANISM, credit: mech === null ? 0 : 1, score: mech },
    { weight: w.EXCEPTIONAL_STRENGTH, credit: exc === null ? 0 : 1, score: exc },
    { weight: w.OUTLIER_PATH, credit: path === null ? 0 : 1, score: path },
  ]);
  return { ...agg, components };
}
