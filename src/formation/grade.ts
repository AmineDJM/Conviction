/**
 * GRADERS. Deterministic for choice, numeric, forensics and founder
 * questions; a rubric (model call or heuristic fallback, see ai-grader.ts)
 * for open text, combined here with deterministic parts by fixed, documented
 * weights. Pure: the rubric is passed in.
 */
import type { TrainingCase } from "./case";
import { categoryConcept } from "./gen-forensics";
import { gradeFounderQuestions } from "./founder-questions";
import { bucketRank } from "./gen-judgment";
import { CONCERN_METRICS } from "./concerns";
import { CORRECT_THRESHOLD, type Answer, type ConceptObservation, type Exercise, type Grade, type RubricResult } from "./types";

/* ---------------------------------------------------------------- */
/* Numbers                                                             */
/* ---------------------------------------------------------------- */

const SCALE: Record<string, number> = { k: 1e3, K: 1e3, thousand: 1e3, m: 1e6, M: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, B: 1e9, bn: 1e9, billion: 1e9 };

/**
 * Parse a typed number: "$2.18B", "2,180M", "2.2 bn", "8.5 months", "3.3%", "1.7x", "42k".
 * Returns null when no number can be read. Suffixes scale; units are ignored.
 */
export function parseNumber(input: string): number | null {
  const s = input.replace(/[\s,$€£]/g, "").replace(/−/g, "-").replace(/×/g, "x");
  const m = /^(-?\d*\.?\d+)(k|K|m|M|mm|mn|b|B|bn|thousand|million|billion)?(%|x|months?|mo|mos|yrs?|years?)?$/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const suffix = m[2];
  const scale = suffix ? (SCALE[suffix] ?? SCALE[suffix.toLowerCase()] ?? 1) : 1;
  return n * scale;
}

/**
 * Numeric score: full credit within tolerance; linear decay to zero at 3× tolerance.
 * relError = |given − expected| / |expected|.
 */
export function numericScore(given: number | null, expected: number, tolerance: number): { score: number; relError: number | null } {
  if (given === null || !Number.isFinite(given)) return { score: 0, relError: null };
  const rel = expected === 0 ? Math.abs(given) : Math.abs(given - expected) / Math.abs(expected);
  if (rel <= tolerance) return { score: 1, relError: rel };
  return { score: Math.max(0, Math.round((1 - (rel - tolerance) / (2 * tolerance)) * 1e9) / 1e9), relError: rel };
}

/* ---------------------------------------------------------------- */
/* Rubric composition                                                  */
/* ---------------------------------------------------------------- */

/**
 * Rubric score (0–1) with explicit weights (never redistributed silently):
 *   0.35 × reasoning quality/4 + 0.20 × evidence use/4
 * + 0.30 × critical-risk recall + 0.15 × outlier-signal recall.
 * When the key has no outlier signal (or no critical risk), that component is
 * scored 1 when the answer does not invent one — stated in the grade details.
 */
export const RUBRIC_WEIGHTS = { reasoning: 0.35, evidence: 0.2, risks: 0.3, outliers: 0.15 } as const;

export function rubricScore(ex: Exercise, r: RubricResult): { score: number; riskRecall: number | null; outlierRecall: number | null } {
  const risks = ex.key.keyPoints.filter((p) => p.kind === "RISK" && p.critical).map((p) => p.id);
  const outs = ex.key.keyPoints.filter((p) => p.kind === "OUTLIER" && p.critical).map((p) => p.id);
  const facts = ex.key.keyPoints.filter((p) => p.kind === "FACT" && p.critical).map((p) => p.id);
  const caught = new Set([...r.caughtRiskIds, ...r.caughtOutlierIds]);
  const riskPool = [...risks, ...facts];
  const riskRecall = riskPool.length ? riskPool.filter((id) => caught.has(id)).length / riskPool.length : null;
  const outlierRecall = outs.length ? outs.filter((id) => caught.has(id)).length / outs.length : null;
  const w = RUBRIC_WEIGHTS;
  const score =
    w.reasoning * clamp01(r.reasoningQuality / 4) + w.evidence * clamp01(r.evidenceUse / 4) + w.risks * (riskRecall ?? 1) + w.outliers * (outlierRecall ?? 1);
  return { score: round(score), riskRecall, outlierRecall };
}

/** Recompute missed ids from the key so the model can only report what it saw ("caught"), never invent misses. */
export function normalizeRubric(ex: Exercise, r: RubricResult): RubricResult {
  const ids = new Set(ex.key.keyPoints.map((p) => p.id));
  const caughtRisk = r.caughtRiskIds.filter((id) => ids.has(id));
  const caughtOut = r.caughtOutlierIds.filter((id) => ids.has(id));
  const caught = new Set([...caughtRisk, ...caughtOut]);
  return {
    ...r,
    reasoningQuality: clampInt(r.reasoningQuality, 0, 4),
    evidenceUse: clampInt(r.evidenceUse, 0, 4),
    caughtRiskIds: caughtRisk,
    caughtOutlierIds: caughtOut,
    missedCriticalRiskIds: ex.key.keyPoints.filter((p) => (p.kind === "RISK" || p.kind === "FACT") && p.critical && !caught.has(p.id)).map((p) => p.id),
    missedOutlierIds: ex.key.keyPoints.filter((p) => p.kind === "OUTLIER" && p.critical && !caught.has(p.id)).map((p) => p.id),
  };
}

/**
 * Concept observations from a rubric. Only MODEL rubrics count as evidence for
 * weakness detection: the heuristic fallback (keyword coverage) is too coarse
 * to say what someone consistently misses, so it contributes none.
 */
function rubricObservations(ex: Exercise, r: RubricResult): ConceptObservation[] {
  if (r.method !== "MODEL") return [];
  const obs: ConceptObservation[] = [];
  const caught = new Set([...r.caughtRiskIds, ...r.caughtOutlierIds]);
  for (const p of ex.key.keyPoints) if (p.critical && p.concept) obs.push({ concept: p.concept, outcome: caught.has(p.id) ? "CAUGHT" : "MISSED" });
  return dedupeObs(obs);
}

/* ---------------------------------------------------------------- */
/* Main                                                                */
/* ---------------------------------------------------------------- */

export interface GradeInput {
  ex: Exercise;
  answer: Answer;
  c: TrainingCase;
  /** Rubric for open text (model or heuristic). Required for DECISION / OUTLIER / OPEN / BULL_BEAR. */
  rubric?: RubricResult | null;
}

export function needsRubric(ex: Exercise): boolean {
  return ex.kind === "DECISION" || ex.kind === "OUTLIER" || ex.kind === "BULL_BEAR" || ex.kind.startsWith("OPEN_");
}

/** The free text a rubric grades, per exercise kind. */
export function rubricText(ex: Exercise, answer: Answer): string {
  switch (answer.type) {
    case "decision":
      return `Decision: ${answer.decision}\nJustification: ${answer.justification}`;
    case "bullbear":
      return `Bull case (for investing): ${answer.bull}\n\nBear case (for passing): ${answer.bear}`;
    case "outlier":
      return `Exceptional enough: ${answer.exceptional ? "yes" : "no"}. Signals chosen: ${answer.signalIds.join(", ") || "none"}.\nExplanation: ${answer.justification}`;
    case "text":
      return answer.text;
    default:
      return "";
  }
}

export function grade({ ex, answer, c, rubric }: GradeInput): Grade {
  const base: Omit<Grade, "score" | "correct" | "method" | "summary"> = { details: [], observations: [], rubric: null, numeric: null, questions: null, decisionDistance: null };
  switch (ex.kind) {
    case "MCQ_CONCERN":
    case "MCQ_PMF_SIGNAL":
    case "MCQ_MISSING_METRIC": {
      if (answer.type !== "choice") throw new GradeError("Expected a choice answer");
      const correct = ex.key.correctOptionIds.includes(answer.optionId);
      const partial = !correct && ex.key.partialOptionIds.includes(answer.optionId);
      const score = correct ? 1 : partial ? 0.5 : 0;
      const concept = ex.key.concepts[0];
      const observations: ConceptObservation[] = concept ? [{ concept, outcome: correct ? "CAUGHT" : "MISSED" }] : [];
      if (ex.kind === "MCQ_PMF_SIGNAL" && !correct) observations.push({ concept: "GROWTH_QUALITY", outcome: "MISSED" });
      if (ex.kind === "MCQ_MISSING_METRIC" && !correct && !partial) observations.push({ concept: "QUESTION_TARGETING", outcome: "MISSED" });
      return { ...base, score, correct: score >= CORRECT_THRESHOLD, method: "EXACT", summary: correct ? "Correct." : partial ? "Defensible, but not the strongest answer." : "Not the strongest answer.", details: [ex.key.optionNotes[answer.optionId] ?? ""].filter(Boolean), observations };
    }
    case "NUMERIC": {
      if (answer.type !== "numeric" || !ex.key.numeric) throw new GradeError("Expected a numeric answer");
      const given = parseNumber(answer.value);
      const { score, relError } = numericScore(given, ex.key.numeric.value, ex.key.numeric.tolerance);
      const concept = ex.key.concepts[0];
      return {
        ...base,
        score: round(score),
        correct: score >= CORRECT_THRESHOLD,
        method: "NUMERIC",
        summary: given === null ? "Could not read a number." : score === 1 ? `Within tolerance (off by ${((relError ?? 0) * 100).toFixed(1)}%).` : `Off by ${((relError ?? 0) * 100).toFixed(0)}% (tolerance ${(ex.key.numeric.tolerance * 100).toFixed(0)}%).`,
        numeric: { given, expected: ex.key.numeric.value, relError },
        observations: concept ? [{ concept, outcome: score >= CORRECT_THRESHOLD ? "CAUGHT" : "MISSED" }] : [],
      };
    }
    case "FORENSICS_STATEMENTS": {
      if (answer.type !== "statements" || !ex.key.flagged) throw new GradeError("Expected flagged statements");
      return { ...base, ...gradeStatements(ex, answer) };
    }
    case "FORENSICS_OMISSIONS": {
      if (answer.type !== "multi") throw new GradeError("Expected a multi-select answer");
      const key = new Set(ex.key.correctOptionIds);
      const picked = new Set(answer.optionIds);
      const tp = [...picked].filter((x) => key.has(x)).length;
      const fp = picked.size - tp;
      const precision = picked.size ? tp / picked.size : 0;
      const recall = key.size ? tp / key.size : 1;
      const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
      return {
        ...base,
        score: round(f1),
        correct: f1 >= CORRECT_THRESHOLD,
        method: "SET",
        summary: `Found ${tp} of ${key.size} omissions${fp ? `, ${fp} item${fp > 1 ? "s" : ""} the deck does show` : ""}.`,
        details: [`Precision ${(precision * 100).toFixed(0)}% · recall ${(recall * 100).toFixed(0)}%`],
        observations: [{ concept: "MISSING_EVIDENCE", outcome: recall >= 0.67 ? "CAUGHT" : "MISSED" }],
      };
    }
    case "FOUNDER_QUESTIONS": {
      if (answer.type !== "questions") throw new GradeError("Expected questions");
      return gradeFounderQuestions(answer.questions, c, ex.key.questionBank ?? []);
    }
    case "DECISION": {
      if (answer.type !== "decision" || !ex.key.decisionBucket) throw new GradeError("Expected a decision");
      if (!rubric) throw new GradeError("A rubric is required");
      const r = normalizeRubric(ex, rubric);
      const dist = Math.abs(bucketRank(answer.decision) - bucketRank(ex.key.decisionBucket));
      const decisionScore = [1, 0.5, 0.15, 0][dist] ?? 0;
      const rs = rubricScore(ex, r);
      // Decision 0.4 + justification 0.6.
      const score = round(0.4 * decisionScore + 0.6 * rs.score);
      return {
        ...base,
        score,
        correct: score >= CORRECT_THRESHOLD,
        method: "COMPOSITE",
        summary: `${dist === 0 ? "Same call as the analysis" : `${dist} step${dist > 1 ? "s" : ""} from the analysis`} · justification ${Math.round(rs.score * 100)}/100.`,
        details: rubricDetails(rs, r),
        rubric: r,
        decisionDistance: dist,
        observations: rubricObservations(ex, r),
      };
    }
    case "OUTLIER": {
      if (answer.type !== "outlier") throw new GradeError("Expected an outlier answer");
      if (!rubric) throw new GradeError("A rubric is required");
      const r = normalizeRubric(ex, rubric);
      const expectYes = ex.key.correctOptionIds.includes("YES");
      const callRight = answer.exceptional === expectYes;
      const signalKey = new Set(ex.key.correctOptionIds.filter((x) => x !== "YES" && x !== "NO"));
      const picked = new Set(answer.signalIds);
      const inter = [...picked].filter((x) => signalKey.has(x)).length;
      const union = new Set([...picked, ...signalKey]).size;
      // Signal overlap is only graded when the analysis ties the outlier to specific deck facts.
      const signalScore = signalKey.size ? inter / Math.max(1, union) : callRight ? 1 : 0;
      const rs = rubricScore(ex, r);
      const score = round(0.5 * (callRight ? 1 : 0) + 0.2 * signalScore + 0.3 * rs.score);
      return {
        ...base,
        score,
        correct: score >= CORRECT_THRESHOLD,
        method: "COMPOSITE",
        summary: `${callRight ? "Same call as the analysis" : "Different call from the analysis"} (${expectYes ? "an evidenced outlier signal exists" : "no evidenced outlier signal yet"}) · reasoning ${Math.round(rs.score * 100)}/100.`,
        details: rubricDetails(rs, r),
        rubric: r,
        observations: [{ concept: "OUTLIER_SIGNAL", outcome: callRight ? "CAUGHT" : "MISSED" }, ...rubricObservations(ex, r).filter((o) => o.concept !== "OUTLIER_SIGNAL")],
      };
    }
    default: {
      if (!rubric) throw new GradeError("A rubric is required");
      const r = normalizeRubric(ex, rubric);
      const rs = rubricScore(ex, r);
      return {
        ...base,
        score: rs.score,
        correct: rs.score >= CORRECT_THRESHOLD,
        method: r.method === "MODEL" ? "MODEL_RUBRIC" : "HEURISTIC_RUBRIC",
        summary: `Reasoning ${r.reasoningQuality}/4 · evidence ${r.evidenceUse}/4 · ${r.missedCriticalRiskIds.length} critical point${r.missedCriticalRiskIds.length === 1 ? "" : "s"} missed.`,
        details: rubricDetails(rs, r),
        rubric: r,
        observations: rubricObservations(ex, r),
      };
    }
  }
}

function gradeStatements(ex: Exercise, answer: Extract<Answer, { type: "statements" }>): Pick<Grade, "score" | "correct" | "method" | "summary" | "details" | "observations"> {
  const key = ex.key.flagged!;
  const keyIds = Object.keys(key);
  const flags = new Map(answer.flags.map((f) => [f.statementId, f.category]));
  let credit = 0;
  const details: string[] = [];
  const observations: ConceptObservation[] = [];
  for (const id of keyIds) {
    const cats = key[id]!;
    const given = flags.get(id);
    if (!given) {
      details.push(`${id}: missed (${cats.join(", ").toLowerCase().replace(/_/g, " ")}).`);
      for (const k of cats) observations.push({ concept: categoryConcept(k), outcome: "MISSED" });
      continue;
    }
    // Right statement, right category: full credit; right statement, other category: half.
    const exact = cats.includes(given);
    credit += exact ? 1 : 0.5;
    details.push(`${id}: ${exact ? "caught" : `flagged, but the issue is ${cats.join(" / ").toLowerCase().replace(/_/g, " ")}`}.`);
    for (const k of cats) observations.push({ concept: categoryConcept(k), outcome: "CAUGHT" });
  }
  const falsePos = [...flags.keys()].filter((id) => !key[id]);
  if (falsePos.length) details.push(`Flagged ${falsePos.length} sound statement${falsePos.length > 1 ? "s" : ""}: ${falsePos.join(", ")}.`);
  const precision = flags.size ? credit / flags.size : 0;
  const recall = keyIds.length ? credit / keyIds.length : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    score: round(f1),
    correct: f1 >= CORRECT_THRESHOLD,
    method: "SET",
    summary: `Caught ${keyIds.filter((id) => flags.has(id)).length} of ${keyIds.length} problems · ${falsePos.length} false alarm${falsePos.length === 1 ? "" : "s"}.`,
    details,
    observations: dedupeObs(observations),
  };
}

function rubricDetails(rs: { riskRecall: number | null; outlierRecall: number | null }, r: RubricResult): string[] {
  return [
    `Reasoning quality ${r.reasoningQuality}/4 · use of evidence ${r.evidenceUse}/4.`,
    rs.riskRecall === null ? "No critical risk in the key (scored as full)." : `Critical points covered: ${Math.round(rs.riskRecall * 100)}%.`,
    rs.outlierRecall === null ? "No evidenced outlier signal in the key (scored as full)." : `Outlier signals covered: ${Math.round(rs.outlierRecall * 100)}%.`,
    ...(r.pedigreeReliance ? ["Leans on pedigree (schools, employers, investors) rather than observed capability."] : []),
    ...(r.strongestPoint ? [`Strongest point: ${r.strongestPoint}`] : []),
    ...(r.biggestGap ? [`Biggest gap: ${r.biggestGap}`] : []),
    ...(r.method === "HEURISTIC" ? ["Graded heuristically (keyword coverage): the model grader was unavailable."] : []),
  ];
}

function dedupeObs(obs: ConceptObservation[]): ConceptObservation[] {
  const m = new Map<string, ConceptObservation>();
  for (const o of obs) {
    const cur = m.get(o.concept);
    // One observation per concept per attempt; a single miss makes it MISSED.
    if (!cur || o.outcome === "MISSED") m.set(o.concept, o);
  }
  return [...m.values()];
}

export class GradeError extends Error {}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(x) ? x : 0)));
const round = (x: number) => Math.round(x * 1000) / 1000;

/** Concepts of the concern metrics (exported for the mistake classifier). */
export const concernConcept = (metricKey: string) => CONCERN_METRICS[metricKey]?.concept ?? null;
