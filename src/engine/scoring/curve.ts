import type { Curve, MetricBenchmark, ProfileId, StageBand, BenchmarkRegistry } from "../benchmarks/types";

/** Piecewise-linear interpolation; clamps outside the curve. Works for ascending or descending score curves. */
export function interpolate(curve: Curve, value: number): number {
  if (curve.length === 0) throw new Error("Empty curve");
  const pts = [...curve].sort((a, b) => a.value - b.value);
  if (value <= pts[0]!.value) return pts[0]!.score;
  if (value >= pts[pts.length - 1]!.value) return pts[pts.length - 1]!.score;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (value <= b.value) {
      const t = (value - a.value) / (b.value - a.value);
      return a.score + t * (b.score - a.score);
    }
  }
  return pts[pts.length - 1]!.score;
}

/** Percentile only from a real observed distribution. Returns null otherwise (§4 Level 2). */
export function percentile(b: MetricBenchmark, value: number): number | null {
  if (b.type !== "OBSERVED_DISTRIBUTION" || !b.quantiles || b.quantiles.length < 2) return null;
  const q = [...b.quantiles].sort((x, y) => x.value - y.value);
  if (value <= q[0]!.value) return q[0]!.p;
  if (value >= q[q.length - 1]!.value) return q[q.length - 1]!.p;
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1]!;
    const c = q[i]!;
    if (value <= c.value) return a.p + ((value - a.value) / (c.value - a.value)) * (c.p - a.p);
  }
  return null;
}

export function findBenchmark(
  registry: BenchmarkRegistry,
  metricKey: string,
  profile: ProfileId,
  stageBand: StageBand,
): MetricBenchmark | null {
  const candidates = registry.benchmarks.filter(
    (b) =>
      b.metricKey === metricKey &&
      (b.profiles === "ALL" || b.profiles.includes(profile)) &&
      (b.stageBands === "ALL" || b.stageBands.includes(stageBand)),
  );
  if (candidates.length === 0) return null;
  // Prefer the most specific benchmark (explicit profile and stage lists).
  const specificity = (b: MetricBenchmark) => (b.profiles === "ALL" ? 0 : 2) + (b.stageBands === "ALL" ? 0 : 1);
  return [...candidates].sort((a, b) => specificity(b) - specificity(a))[0]!;
}

export function benchmarkById(registry: BenchmarkRegistry, id: string): MetricBenchmark | null {
  return registry.benchmarks.find((b) => b.id === id) ?? null;
}
