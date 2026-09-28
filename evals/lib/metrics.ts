/**
 * Pure evaluation statistics (no I/O). Tested in tests/evals.metrics.test.ts.
 */

/** |relevant ∩ top-k| / k (standard precision@k; ranked lists shorter than k count the missing slots as misses). */
export function precisionAtK(ranked: string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) return 0;
  return ranked.slice(0, k).filter((id) => relevant.has(id)).length / k;
}

/** |relevant ∩ top-k| / |relevant|; null when nothing is relevant (the query is unanswerable, not a miss). */
export function recallAtK(ranked: string[], relevant: ReadonlySet<string>, k: number): number | null {
  if (!relevant.size) return null;
  return ranked.slice(0, k).filter((id) => relevant.has(id)).length / relevant.size;
}

/** Precision normalised by the best achievable: |relevant ∩ top-k| / min(k, |relevant|). */
export function normalizedPrecisionAtK(ranked: string[], relevant: ReadonlySet<string>, k: number): number | null {
  if (!relevant.size || k <= 0) return null;
  return ranked.slice(0, k).filter((id) => relevant.has(id)).length / Math.min(k, relevant.size);
}

/** 1 when at least one relevant item is in the top k. */
export function hitAtK(ranked: string[], relevant: ReadonlySet<string>, k: number): number {
  return ranked.slice(0, k).some((id) => relevant.has(id)) ? 1 : 0;
}

/** 1 / rank of the first relevant item (0 when none). */
export function reciprocalRank(ranked: string[], relevant: ReadonlySet<string>): number {
  const i = ranked.findIndex((id) => relevant.has(id));
  return i < 0 ? 0 : 1 / (i + 1);
}

export const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Wilson score interval for a proportion (95% by default). Honest error bars for small n. */
export function wilson(successes: number, n: number, z = 1.96): { low: number; high: number } | null {
  if (n <= 0) return null;
  const p = successes / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half) };
}

/** Relative closeness used for numeric extraction checks: |a − b| / max(1, |b|) ≤ tol. */
export function withinRel(actual: number | null | undefined, expected: number, tol = 0.01): boolean {
  if (actual === null || actual === undefined || !Number.isFinite(actual)) return false;
  return Math.abs(actual - expected) / Math.max(1, Math.abs(expected)) <= tol;
}

/** Deterministic sample of `n` items (seeded shuffle) — the same corpus gives the same sample across runs. */
export function seededSample<T>(items: T[], n: number, seed = 42): T[] {
  let s = seed >>> 0 || 1;
  const rnd = () => {
    // xorshift32
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, Math.max(0, n));
}
