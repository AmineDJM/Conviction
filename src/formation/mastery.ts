/**
 * MASTERY METRICS — measurement, not gamification. What is measured:
 *
 *  accuracy              mean score and share correct (score ≥ 0.7) over all graded attempts
 *  calibration           Brier score, reliability curve, over/under-confidence (calibration.ts)
 *  reasoning quality     mean rubric reasoning (0–4 → %) on open answers
 *  missed critical risks share of critical risk / fact key points not addressed
 *  missed outlier signals share of evidenced outlier signals not addressed
 *  question efficiency   share of founder questions that are non-redundant with score ≥ 0.5
 *  numerical accuracy    share of numeric answers within tolerance; median relative error
 *  decision consistency  Kendall τ-b between the user's decision ranks and the analysis ranks
 *                        (latest attempt per case), and agreement on repeated cases
 *  improvement           rolling mean score (window 5) and first-half vs second-half delta
 */
import { calibration, type CalibrationReport } from "./calibration";
import { bucketRank } from "./gen-judgment";
import { chronological, graded, type AttemptRecord } from "./records";
import { CORRECT_THRESHOLD } from "./types";

export interface Mastery {
  attempts: number;
  graded: number;
  accuracy: { meanScore: number | null; shareCorrect: number | null };
  calibration: CalibrationReport;
  reasoningQuality: { mean: number | null; n: number; heuristicShare: number | null };
  missedCriticalRisks: { rate: number | null; missed: number; total: number };
  missedOutlierSignals: { rate: number | null; missed: number; total: number };
  questionEfficiency: { rate: number | null; questions: number; redundant: number };
  numericalAccuracy: { withinTolerance: number | null; medianRelError: number | null; n: number };
  decisionConsistency: { kendallTau: number | null; cases: number; repeatAgreement: number | null; repeatPairs: number; meanSignedGap: number | null };
  improvement: { series: { i: number; at: string; score: number; rolling: number }[]; firstHalf: number | null; secondHalf: number | null; delta: number | null };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Kendall's τ-b (handles ties). Null with fewer than 3 pairs of distinct values. */
export function kendallTauB(x: number[], y: number[]): number | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let conc = 0;
  let disc = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i]! - x[j]!);
      const dy = Math.sign(y[i]! - y[j]!);
      if (dx === 0 && dy === 0) continue;
      if (dx === 0) tx++;
      else if (dy === 0) ty++;
      else if (dx === dy) conc++;
      else disc++;
    }
  const denom = Math.sqrt((conc + disc + tx) * (conc + disc + ty));
  return denom ? (conc - disc) / denom : null;
}

export function mastery(all: AttemptRecord[]): Mastery {
  const g = chronological(graded(all));
  const scores = g.map((a) => a.grade.score);
  const meanScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const cal = calibration(g.map((a) => ({ confidence: a.confidence, correct: a.grade.score >= CORRECT_THRESHOLD })));

  const rub = g.filter((a) => a.grade.rubric);
  const reasoning = rub.map((a) => a.grade.rubric!.reasoningQuality / 4);
  let missed = 0;
  let total = 0;
  let oMissed = 0;
  let oTotal = 0;
  for (const a of rub) {
    const kp = a.exercise.key.keyPoints;
    const crit = kp.filter((p) => p.critical && p.kind !== "OUTLIER").length;
    const outs = kp.filter((p) => p.critical && p.kind === "OUTLIER").length;
    total += crit;
    missed += Math.min(crit, a.grade.rubric!.missedCriticalRiskIds.length);
    oTotal += outs;
    oMissed += Math.min(outs, a.grade.rubric!.missedOutlierIds.length);
  }

  const qs = g.flatMap((a) => a.grade.questions ?? []);
  const numeric = g.filter((a) => a.grade.numeric);
  const rel = numeric.map((a) => a.grade.numeric!.relError).filter((x): x is number => x !== null);
  const within = numeric.filter((a) => a.grade.numeric!.relError !== null && a.exercise.key.numeric && a.grade.numeric!.relError! <= a.exercise.key.numeric.tolerance).length;

  // Decision consistency.
  const decisions = g.filter((a) => a.answer.type === "decision" && a.exercise.key.decisionBucket);
  const latestPerCase = new Map<string, (typeof decisions)[number]>();
  for (const a of decisions) latestPerCase.set(a.exercise.case.versionId, a);
  const userRanks: number[] = [];
  const keyRanks: number[] = [];
  let gap = 0;
  for (const a of latestPerCase.values()) {
    if (a.answer.type !== "decision") continue;
    userRanks.push(bucketRank(a.answer.decision));
    keyRanks.push(bucketRank(a.exercise.key.decisionBucket!));
    gap += bucketRank(a.answer.decision) - bucketRank(a.exercise.key.decisionBucket!);
  }
  const byCase = new Map<string, string[]>();
  for (const a of decisions) if (a.answer.type === "decision") byCase.set(a.exercise.case.versionId, [...(byCase.get(a.exercise.case.versionId) ?? []), a.answer.decision]);
  let pairs = 0;
  let agree = 0;
  for (const ds of byCase.values())
    for (let i = 1; i < ds.length; i++) {
      pairs++;
      if (ds[i] === ds[i - 1]) agree++;
    }

  const series = scores.map((s, i) => {
    const w = scores.slice(Math.max(0, i - 4), i + 1);
    return { i: i + 1, at: g[i]!.answeredAt, score: s, rolling: w.reduce((a, b) => a + b, 0) / w.length };
  });
  const half = Math.floor(scores.length / 2);
  const firstHalf = half >= 3 ? scores.slice(0, half).reduce((a, b) => a + b, 0) / half : null;
  const secondHalf = half >= 3 ? scores.slice(half).reduce((a, b) => a + b, 0) / (scores.length - half) : null;

  return {
    attempts: all.length,
    graded: g.length,
    accuracy: { meanScore, shareCorrect: scores.length ? scores.filter((s) => s >= CORRECT_THRESHOLD).length / scores.length : null },
    calibration: cal,
    reasoningQuality: { mean: reasoning.length ? reasoning.reduce((a, b) => a + b, 0) / reasoning.length : null, n: reasoning.length, heuristicShare: rub.length ? rub.filter((a) => a.grade.rubric!.method === "HEURISTIC").length / rub.length : null },
    missedCriticalRisks: { rate: total ? missed / total : null, missed, total },
    missedOutlierSignals: { rate: oTotal ? oMissed / oTotal : null, missed: oMissed, total: oTotal },
    questionEfficiency: { rate: qs.length ? qs.filter((q) => !q.redundant && q.score >= 0.5).length / qs.length : null, questions: qs.length, redundant: qs.filter((q) => q.redundant).length },
    numericalAccuracy: { withinTolerance: numeric.length ? within / numeric.length : null, medianRelError: median(rel), n: numeric.length },
    decisionConsistency: { kendallTau: kendallTauB(userRanks, keyRanks), cases: userRanks.length, repeatAgreement: pairs ? agree / pairs : null, repeatPairs: pairs, meanSignedGap: userRanks.length ? gap / userRanks.length : null },
    improvement: { series, firstHalf, secondHalf, delta: firstHalf !== null && secondHalf !== null ? secondHalf - firstHalf : null },
  };
}
