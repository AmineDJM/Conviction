/**
 * CALIBRATION — does stated confidence match results?
 *
 * Before every answer the user states a confidence c ∈ [0, 1]: the
 * probability that the answer is right (score ≥ CORRECT_THRESHOLD).
 *
 *  - Brier score        BS  = mean (c − o)²            (0 = perfect; 0.25 = always 50%)
 *  - Reference          BSref = ō(1 − ō)              (always answering the base rate)
 *  - Brier skill score  BSS = 1 − BS / BSref           (> 0 = better than base rate)
 *  - Murphy decomposition BS = reliability − resolution + uncertainty, over bins
 *  - Over/under-confidence = mean(c) − mean(o)
 *  - Reliability curve: per confidence bin, mean stated confidence vs observed hit rate
 */

export interface CalibrationPoint {
  confidence: number;
  correct: boolean;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  n: number;
  meanConfidence: number | null;
  hitRate: number | null;
}

export interface CalibrationReport {
  n: number;
  brier: number | null;
  brierReference: number | null;
  brierSkill: number | null;
  reliability: number | null;
  resolution: number | null;
  uncertainty: number | null;
  overconfidence: number | null;
  meanConfidence: number | null;
  hitRate: number | null;
  bins: ReliabilityBin[];
}

export const BIN_EDGES = [0, 0.2, 0.4, 0.6, 0.8, 1.0000001];

export function brierScore(points: CalibrationPoint[]): number | null {
  if (!points.length) return null;
  return points.reduce((a, p) => a + (clamp(p.confidence) - (p.correct ? 1 : 0)) ** 2, 0) / points.length;
}

export function calibration(points: CalibrationPoint[]): CalibrationReport {
  const n = points.length;
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < BIN_EDGES.length - 1; i++) {
    const lo = BIN_EDGES[i]!;
    const hi = BIN_EDGES[i + 1]!;
    const inBin = points.filter((p) => clamp(p.confidence) >= lo && clamp(p.confidence) < hi);
    bins.push({
      lo,
      hi: Math.min(1, hi),
      n: inBin.length,
      meanConfidence: inBin.length ? inBin.reduce((a, p) => a + clamp(p.confidence), 0) / inBin.length : null,
      hitRate: inBin.length ? inBin.filter((p) => p.correct).length / inBin.length : null,
    });
  }
  if (!n) return { n, brier: null, brierReference: null, brierSkill: null, reliability: null, resolution: null, uncertainty: null, overconfidence: null, meanConfidence: null, hitRate: null, bins };
  const hit = points.filter((p) => p.correct).length / n;
  const meanC = points.reduce((a, p) => a + clamp(p.confidence), 0) / n;
  const brier = brierScore(points)!;
  const ref = hit * (1 - hit);
  let rel = 0;
  let res = 0;
  for (const b of bins) {
    if (!b.n) continue;
    rel += (b.n / n) * (b.meanConfidence! - b.hitRate!) ** 2;
    res += (b.n / n) * (b.hitRate! - hit) ** 2;
  }
  return {
    n,
    brier,
    brierReference: ref,
    brierSkill: ref > 0 ? 1 - brier / ref : null,
    reliability: rel,
    resolution: res,
    uncertainty: ref,
    overconfidence: meanC - hit,
    meanConfidence: meanC,
    hitRate: hit,
    bins,
  };
}

const clamp = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0.5));
