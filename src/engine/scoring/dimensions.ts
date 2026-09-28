/**
 * §18–20 Dimension scoring with explicit coverage and bounds.
 *
 * - value: score over evidence actually observed (weighted by coverage credit)
 * - lower: missing evidence scored at 0   (conservative bound)
 * - upper: missing evidence scored at 100 (optimistic bound)
 *
 * Missing data is never converted to zero in `value`, and weights are never
 * silently redistributed: coverage and bounds make the gap explicit. Decision
 * gates use the bounds, so removing weak evidence can never improve a gate
 * outcome (the lower bound can only fall when evidence disappears).
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { DataState, OperationalMaturity, RubricRating } from "@/domain/enums";
import type { BenchmarkRegistry, ComponentSpec, DimensionId, ProfileId, StageBand } from "../benchmarks/types";
import { findBenchmark, interpolate, percentile, benchmarkById } from "./curve";
import { metricDef } from "../metrics/dictionary";
import type { MarketReconstruction } from "../market";
import { measuredPmf } from "./measured-pmf";

export type ScoreStatus = "SCORED" | "PARTIAL" | "NOT_SCORABLE";

export interface ComponentResult {
  id: string;
  kind: ComponentSpec["kind"];
  label: string;
  weight: number;
  /** Coverage credit 0..1 — how much of this component's weight is actually evidenced. */
  credit: number;
  score: number | null;
  state: DataState | "RATED" | "INSUFFICIENT_EVIDENCE" | "EXCLUDED";
  excludedReason: string | null;
  metricKey: string | null;
  metricId: string | null;
  rawValue: string | null;
  normalizedValue: number | null;
  unit: string | null;
  benchmarkId: string | null;
  benchmarkType: string | null;
  percentile: number | null;
  rating: RubricRating | null;
  rationale: string | null;
  flags: string[];
}

export interface IndexScore {
  value: number | null;
  lower: number;
  upper: number;
  coverage: number;
  status: ScoreStatus;
}

export interface DimensionScore extends IndexScore {
  id: DimensionId;
  name: string;
  components: ComponentResult[];
}

export function maturityAtLeast(registry: BenchmarkRegistry, actual: OperationalMaturity, min: OperationalMaturity) {
  return registry.maturityOrder.indexOf(actual) >= registry.maturityOrder.indexOf(min);
}

function statusFor(registry: BenchmarkRegistry, coverage: number, hasValue: boolean): ScoreStatus {
  if (!hasValue || coverage < registry.coverage.partialMin) return "NOT_SCORABLE";
  if (coverage < registry.coverage.scoredMin) return "PARTIAL";
  return "SCORED";
}

/** Aggregate weighted components into an index with coverage and bounds. */
export function aggregate(
  registry: BenchmarkRegistry,
  parts: { weight: number; credit: number; score: number | null }[],
): IndexScore {
  const active = parts.filter((p) => p.weight > 0);
  const totalW = active.reduce((a, p) => a + p.weight, 0);
  if (totalW === 0) return { value: null, lower: 0, upper: 100, coverage: 0, status: "NOT_SCORABLE" };
  let observedW = 0;
  let observedSum = 0;
  for (const p of active) {
    if (p.score === null || p.credit <= 0) continue;
    observedW += p.weight * p.credit;
    observedSum += p.weight * p.credit * p.score;
  }
  const missingW = totalW - observedW;
  const coverage = observedW / totalW;
  const value = observedW > 0 ? observedSum / observedW : null;
  const lower = observedSum / totalW;
  const upper = (observedSum + missingW * 100) / totalW;
  return {
    value: value === null ? null : round1(value),
    lower: round1(lower),
    upper: round1(upper),
    coverage: Math.round(coverage * 1000) / 1000,
    status: statusFor(registry, coverage, value !== null),
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function primaryMetric(metrics: MetricInstance[], key: string): MetricInstance | undefined {
  return metrics.find((m) => m.metricKey === key && m.isPrimary);
}

function creditFor(registry: BenchmarkRegistry, m: MetricInstance): number {
  const c = registry.coverage.credit;
  let credit = m.state === "OBSERVED" ? c.OBSERVED : m.state === "INFERRED" ? c.INFERRED : m.state === "STALE" ? c.STALE : 0;
  // Withholding must never pay: an undated figure earns no more than a dated-but-stale one, and an undisclosed
  // sample size is charged like a disclosed small sample ("SAMPLE_SIZE_UNKNOWN (min N)").
  if (m.qualityFlags.some((f) => f.startsWith("NO_AS_OF_DATE"))) credit = Math.min(credit, c.STALE);
  if (m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN"))) credit *= c.SMALL_SAMPLE_MULTIPLIER;
  return credit;
}

const RUBRIC_LABEL: Record<string, string> = {
  FOUNDER_MARKET_FIT: "Founder–market fit",
  EXECUTION_EVIDENCE: "Execution evidence",
  TEAM_COMPLETENESS: "Team completeness",
  PAIN_SEVERITY: "Pain severity",
  VALUE_QUANTIFIED: "Quantified value",
  PRODUCT_DIFFERENTIATION: "Differentiation",
  VALUE_CAPTURE: "Value capture",
  MARKET_GROWTH: "Market growth",
  WEDGE_QUALITY: "Wedge quality",
  PMF_SIGNAL_QUALITY: "PMF signal quality",
  ICP_CLARITY: "ICP clarity",
  SALES_MOTION_FIT: "Sales motion fit",
  CHANNEL_SCALABILITY: "Channel scalability",
  PRICING_POWER: "Pricing power",
  MOAT_CURRENT: "Moat today",
  MOAT_TRAJECTORY: "Moat trajectory",
  TIMING_CATALYST: "Timing catalyst",
  INFLECTION_EVIDENCE: "Inflection evidence",
};

export function rubricLabel(criterion: string) {
  return RUBRIC_LABEL[criterion] ?? criterion;
}

function blank(spec: ComponentSpec, label: string): ComponentResult {
  return {
    id: spec.id,
    kind: spec.kind,
    label,
    weight: spec.weight,
    credit: 0,
    score: null,
    state: "UNKNOWN",
    excludedReason: null,
    metricKey: null,
    metricId: null,
    rawValue: null,
    normalizedValue: null,
    unit: null,
    benchmarkId: null,
    benchmarkType: null,
    percentile: null,
    rating: null,
    rationale: null,
    flags: [],
  };
}

export interface ScoringContext {
  deal: CanonicalDeal;
  registry: BenchmarkRegistry;
  profile: ProfileId;
  stageBand: StageBand;
  market: MarketReconstruction;
}

function scoreComponent(spec: ComponentSpec, ctx: ScoringContext): ComponentResult {
  const { deal, registry, profile, stageBand } = ctx;

  if (spec.kind === "RUBRIC") {
    const r = blank(spec, rubricLabel(spec.criterion));
    const a = deal.rubric.find((x) => x.criterion === spec.criterion);
    // PMF quality is anchored on measured signals when the record has them (model rating kept in the rationale).
    if (spec.criterion === "PMF_SIGNAL_QUALITY") {
      const pmf = measuredPmf(deal, registry, profile, stageBand, a?.rating ?? null);
      if (pmf.effectiveRating) {
        const r = blank(spec, rubricLabel(spec.criterion));
        r.state = pmf.effectiveRating === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "RATED";
        r.rating = pmf.effectiveRating;
        r.rationale = `${pmf.explanation}${a?.rationale ? ` Model rationale: ${a.rationale}` : ""}`;
        if (pmf.effectiveRating !== "INSUFFICIENT_EVIDENCE") {
          r.score = registry.rubricPoints[pmf.effectiveRating];
          r.credit = 1;
        }
        r.benchmarkType = pmf.mode === "CLAMPED" ? "MODEL_ASSUMPTION" : "COMPUTED_FROM_MEASURED_SIGNALS";
        return r;
      }
    }
    if (!a || a.rating === "INSUFFICIENT_EVIDENCE") {
      r.state = "INSUFFICIENT_EVIDENCE";
      r.rationale = a?.rationale ?? "Not assessed";
      r.rating = a?.rating ?? null;
      return r;
    }
    r.state = "RATED";
    r.rating = a.rating;
    r.rationale = a.rationale;
    r.score = registry.rubricPoints[a.rating];
    r.credit = 1;
    r.benchmarkType = "MODEL_ASSUMPTION";
    return r;
  }

  if (spec.kind === "FOUNDER_CAPABILITIES") {
    const r = blank(spec, "Founder capabilities");
    const caps = deal.founders.flatMap((f) => f.capabilities.filter((c) => c.relevant));
    if (caps.length === 0) {
      r.state = "INSUFFICIENT_EVIDENCE";
      r.rationale = "No founder capability analysis available";
      return r;
    }
    const rated = caps.filter((c) => c.rating !== "INSUFFICIENT_EVIDENCE" && c.observability !== "NOT_OBSERVABLE");
    if (rated.length === 0) {
      r.state = "INSUFFICIENT_EVIDENCE";
      r.rationale = `${caps.length} relevant capabilities, none observable without interview/reference`;
      return r;
    }
    const pts = rated.map((c) => {
      const p = registry.rubricPoints[c.rating as Exclude<RubricRating, "INSUFFICIENT_EVIDENCE">];
      // Inferred capabilities earn half credit.
      return { p, w: c.observability === "INFERRED" ? 0.5 : 1 };
    });
    const w = pts.reduce((a, x) => a + x.w, 0);
    r.score = pts.reduce((a, x) => a + x.p * x.w, 0) / w;
    r.credit = w / caps.length;
    r.state = "RATED";
    r.rationale = `${rated.length}/${caps.length} relevant capabilities evidenced (${rated.filter((c) => c.observability === "INFERRED").length} inferred)`;
    r.benchmarkType = "MODEL_ASSUMPTION";
    return r;
  }

  if (spec.kind === "MARKET_SIZE") {
    const r = blank(spec, "Reconstructed market size");
    const b = benchmarkById(registry, registry.powerLaw.marketCeilingBenchmarkId);
    r.metricKey = "reconstructed_sam_usd";
    r.unit = "USD";
    if (!ctx.market.midpointUsd || !b?.curve) {
      r.state = "UNKNOWN";
      r.rationale = "No reconstructed market range (deck TAM is not accepted)";
      return r;
    }
    r.normalizedValue = ctx.market.midpointUsd;
    r.score = interpolate(b.curve, ctx.market.midpointUsd);
    r.credit = ctx.market.primary?.method === "TOP_DOWN" ? 0.5 : 1;
    r.state = r.credit < 1 ? "INFERRED" : "OBSERVED";
    r.benchmarkId = b.id;
    r.benchmarkType = b.type;
    r.rationale = `${ctx.market.primary?.method} range; geometric midpoint scored`;
    if (r.credit < 1) r.flags.push("TOP_DOWN_ONLY: half coverage credit");
    return r;
  }

  // METRIC
  const firstDef = metricDef(spec.metricKeys[0]!);
  const r = blank(spec, firstDef?.shortName ?? spec.id);
  if (spec.stageBands && !spec.stageBands.includes(stageBand)) {
    r.state = "EXCLUDED";
    r.excludedReason = `Not scored at ${stageBand} stage (registry)`;
    r.weight = 0;
    return r;
  }
  if (spec.minMaturity && !maturityAtLeast(registry, deal.classification.operationalMaturity, spec.minMaturity)) {
    r.state = "NOT_YET_MEANINGFUL";
    r.excludedReason = `Not meaningful before ${spec.minMaturity} (current: ${deal.classification.operationalMaturity})`;
    r.weight = 0;
    return r;
  }
  // Only keys with an applicable, scorable benchmark can satisfy the component.
  const scorableKeys = spec.metricKeys.filter((k) => {
    const bm = findBenchmark(registry, k, profile, stageBand);
    return bm && bm.type !== "UNAVAILABLE" && bm.curve;
  });
  if (scorableKeys.length === 0) {
    r.state = "NOT_APPLICABLE";
    r.excludedReason = "No applicable benchmark for this peer group (registry)";
    r.weight = 0;
    return r;
  }
  const chosenKey = scorableKeys.find((k) => {
    const m = primaryMetric(deal.metrics, k);
    return m && m.normalizedValue !== null && creditFor(registry, m) > 0;
  });
  if (!chosenKey) {
    // Report the most informative missing state (WITHHELD / CONTRADICTED / UNKNOWN).
    const anyInstance = scorableKeys.map((k) => primaryMetric(deal.metrics, k)).find(Boolean);
    r.state = anyInstance?.state ?? "UNKNOWN";
    r.metricKey = scorableKeys[0]!;
    r.label = metricDef(scorableKeys[0]!)?.shortName ?? r.label;
    r.rationale = anyInstance ? `Metric present but ${anyInstance.state.toLowerCase()}` : "Not disclosed";
    return r;
  }
  const m = primaryMetric(deal.metrics, chosenKey)!;
  const bm = findBenchmark(registry, chosenKey, profile, stageBand)!;
  r.label = metricDef(chosenKey)?.shortName ?? chosenKey;
  r.metricKey = chosenKey;
  r.metricId = m.id;
  r.rawValue = m.rawValue;
  r.normalizedValue = m.normalizedValue;
  r.unit = m.unit;
  r.state = m.state;
  r.credit = creditFor(registry, m);
  r.score = interpolate(bm.curve!, m.normalizedValue!);
  r.benchmarkId = bm.id;
  r.benchmarkType = bm.type;
  r.percentile = percentile(bm, m.normalizedValue!);
  r.flags = m.qualityFlags;
  return r;
}

export function scoreDimensions(ctx: ScoringContext): DimensionScore[] {
  return ctx.registry.dimensions.map((d) => {
    const specs = d.profileOverrides?.[ctx.profile] ?? d.components;
    const components = specs.map((s) => scoreComponent(s, ctx));
    const agg = aggregate(ctx.registry, components);
    return { id: d.id, name: d.name, components, ...agg };
  });
}

export interface OperatingQuality extends IndexScore {
  weights: Record<DimensionId, number>;
}

/** Operating Quality Index — a conventional index, never a probability. */
export function operatingQuality(registry: BenchmarkRegistry, profile: ProfileId, stageBand: StageBand, dims: DimensionScore[]): OperatingQuality {
  const weights = registry.dimensionWeightOverrides[profile] ?? registry.dimensionWeights[stageBand];
  // Propagate each dimension's bounds: its observed part contributes with its coverage.
  const totalW = dims.reduce((a, d) => a + (weights[d.id] ?? 0), 0);
  let lower = 0;
  let upper = 0;
  let obsW = 0;
  let obsSum = 0;
  for (const d of dims) {
    const w = weights[d.id] ?? 0;
    lower += w * d.lower;
    upper += w * d.upper;
    if (d.value !== null) {
      obsW += w * d.coverage;
      obsSum += w * d.coverage * d.value;
    }
  }
  const coverage = totalW > 0 ? obsW / totalW : 0;
  const value = obsW > 0 ? obsSum / obsW : null;
  return {
    value: value === null ? null : round1(value),
    lower: round1(lower / (totalW || 1)),
    upper: round1(upper / (totalW || 1)),
    coverage: Math.round(coverage * 1000) / 1000,
    status: statusFor(registry, coverage, value !== null),
    weights,
  };
}
