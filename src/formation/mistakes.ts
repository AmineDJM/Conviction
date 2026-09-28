/**
 * INVESTMENT MISTAKE LIBRARY — private, automatic.
 *
 * Each graded attempt is classified against a fixed taxonomy by deterministic
 * rules over the exercise key, the answer and the grade. Every mistake carries
 * its evidence (what was answered versus what the key says). A mistake is
 * RECURRING at ≥ 2 occurrences; recurring mistakes drive targeted drills.
 */
import { answerSummary, chronological, graded, type AttemptRecord } from "./records";
import { bucketRank } from "./gen-judgment";
import { CORRECT_THRESHOLD, type Concept, type ExerciseKind } from "./types";

export { MISTAKE_KINDS, MISTAKE_LABEL, type MistakeKind } from "./labels";
import { MISTAKE_LABEL, type MistakeKind } from "./labels";

/** What a drill on this mistake practises: concepts at stake and exercise kinds that exercise them. */
export const MISTAKE_DRILL: Record<MistakeKind, { concepts: Concept[]; kinds: ExerciseKind[] }> = {
  OVERVALUED_TAM: { concepts: ["MARKET_SIZE_INFLATION"], kinds: ["FORENSICS_STATEMENTS", "OPEN_TWENTY_X", "NUMERIC"] },
  IGNORED_CHURN: { concepts: ["RETENTION_RISK"], kinds: ["MCQ_CONCERN", "MCQ_PMF_SIGNAL", "BULL_BEAR", "DECISION"] },
  OVERWEIGHTED_PEDIGREE: { concepts: ["FOUNDER_CAPABILITY"], kinds: ["OUTLIER", "BULL_BEAR", "DECISION"] },
  UNDERESTIMATED_FOUNDER: { concepts: ["FOUNDER_CAPABILITY", "OUTLIER_SIGNAL"], kinds: ["OUTLIER", "BULL_BEAR"] },
  MISSED_CAPITAL_INTENSITY: { concepts: ["CAPITAL_INTENSITY", "RUNWAY_FINANCING"], kinds: ["NUMERIC", "MCQ_CONCERN", "OPEN_PASS_TRIGGER"] },
  CONFUSED_GROWTH_WITH_PMF: { concepts: ["PMF_EVIDENCE", "GROWTH_QUALITY"], kinds: ["MCQ_PMF_SIGNAL", "MCQ_CONCERN"] },
  PASSED_ON_TECH_ADVANTAGE: { concepts: ["TECHNICAL_ADVANTAGE", "OUTLIER_SIGNAL"], kinds: ["OUTLIER", "BULL_BEAR"] },
  OVERLOOKED_ENTRY_PRICE: { concepts: ["ENTRY_PRICE", "RETURN_PATH", "DILUTION"], kinds: ["NUMERIC", "OPEN_TWENTY_X"] },
  TOOK_METRICS_AT_FACE_VALUE: { concepts: ["METRIC_DEFINITION", "CUSTOMER_QUALITY", "FORECAST_VS_ACTUAL", "INTERNAL_CONSISTENCY"], kinds: ["FORENSICS_STATEMENTS", "FORENSICS_OMISSIONS"] },
  ASKED_WHAT_DECK_ANSWERED: { concepts: ["QUESTION_TARGETING", "MISSING_EVIDENCE"], kinds: ["FOUNDER_QUESTIONS", "MCQ_MISSING_METRIC", "OPEN_NEXT_METRIC"] },
  MATH_ERROR: { concepts: [], kinds: ["NUMERIC"] },
  OVERCONFIDENT_ERROR: { concepts: [], kinds: ["MCQ_CONCERN", "NUMERIC", "DECISION"] },
  TOO_CONSERVATIVE: { concepts: ["OUTLIER_SIGNAL"], kinds: ["DECISION", "OUTLIER", "BULL_BEAR"] },
  TOO_AGGRESSIVE: { concepts: ["RETURN_PATH"], kinds: ["DECISION", "OPEN_PASS_TRIGGER", "BULL_BEAR"] },
};

export interface MistakeRecord {
  kind: MistakeKind;
  attemptId: string;
  companyId: string;
  caseName: string;
  exerciseTitle: string;
  at: string;
  evidence: string;
}

export function classifyMistakes(a: AttemptRecord): MistakeRecord[] {
  if (!a.grade) return [];
  const ex = a.exercise;
  const g = a.grade;
  const out: MistakeRecord[] = [];
  const add = (kind: MistakeKind, evidence: string) => {
    if (!out.some((m) => m.kind === kind)) out.push({ kind, attemptId: a.id, companyId: ex.case.companyId, caseName: ex.case.name, exerciseTitle: ex.title, at: a.answeredAt, evidence: evidence.slice(0, 600) });
  };
  const missed = new Set(g.observations.filter((o) => o.outcome === "MISSED").map((o) => o.concept));
  const said = answerSummary(a).slice(0, 220);
  const keyLine = ex.key.answer.slice(0, 220);
  const patterns = new Set([...ex.patterns, ...(ex.casePatterns ?? [])]);

  if (missed.has("MARKET_SIZE_INFLATION")) add("OVERVALUED_TAM", `${said} — the deck's market size does not survive reconstruction: ${keyLine}`);
  if (missed.has("RETENTION_RISK")) add("IGNORED_CHURN", `${said} — retention was the point at stake: ${keyLine}`);
  if (g.rubric?.pedigreeReliance) add("OVERWEIGHTED_PEDIGREE", `Justification leans on pedigree: “${said}”`);
  if (missed.has("FOUNDER_CAPABILITY") || (ex.kind === "OUTLIER" && a.answer.type === "outlier" && !a.answer.exceptional && ex.key.correctOptionIds.includes("YES") && ex.key.keyPoints.some((p) => p.kind === "OUTLIER" && p.concept === "FOUNDER_CAPABILITY")))
    add("UNDERESTIMATED_FOUNDER", `${said} — the analysis rates founder capability as an outlier signal: ${keyLine}`);
  if (missed.has("CAPITAL_INTENSITY") || (missed.has("RUNWAY_FINANCING") && (patterns.has("CAPITAL_INTENSIVE") || patterns.has("SHORT_RUNWAY"))))
    add("MISSED_CAPITAL_INTENSITY", `${said} — capital needs were decisive: ${keyLine}`);
  if (ex.kind === "MCQ_PMF_SIGNAL" && g.score < CORRECT_THRESHOLD) add("CONFUSED_GROWTH_WITH_PMF", `${said} — the strongest PMF evidence was: ${keyLine}`);
  if (missed.has("PMF_EVIDENCE") && missed.has("GROWTH_QUALITY")) add("CONFUSED_GROWTH_WITH_PMF", `${said} — ${keyLine}`);
  if (missed.has("TECHNICAL_ADVANTAGE") || (a.answer.type === "decision" && bucketRank(a.answer.decision) <= 1 && ex.key.keyPoints.some((p) => p.kind === "OUTLIER" && p.critical && p.concept === "TECHNICAL_ADVANTAGE")))
    add("PASSED_ON_TECH_ADVANTAGE", `${said} — the analysis identifies a technical advantage as an outlier signal.`);
  if (missed.has("ENTRY_PRICE") || missed.has("DILUTION") || (a.answer.type === "decision" && patterns.has("GREAT_COMPANY_BAD_PRICE") && ex.key.decisionBucket && bucketRank(a.answer.decision) > bucketRank(ex.key.decisionBucket)))
    add("OVERLOOKED_ENTRY_PRICE", `${said} — ${keyLine}`);
  if (["METRIC_DEFINITION", "CUSTOMER_QUALITY", "FORECAST_VS_ACTUAL", "INTERNAL_CONSISTENCY"].some((c) => missed.has(c as Concept)))
    add("TOOK_METRICS_AT_FACE_VALUE", `${said} — ${keyLine}`);
  const redundant = (g.questions ?? []).filter((q) => q.redundant);
  if (redundant.length) add("ASKED_WHAT_DECK_ANSWERED", `${redundant.length} of ${g.questions!.length} questions asked for numbers the deck states: ${redundant.map((q) => `“${q.question.slice(0, 120)}”`).join(" ")}`);
  if (ex.kind === "MCQ_MISSING_METRIC" && g.score === 0) add("ASKED_WHAT_DECK_ANSWERED", `${said} — that evidence is already on the deck.`);
  if (g.numeric && ex.key.numeric && (g.numeric.relError === null || g.numeric.relError > ex.key.numeric.tolerance))
    add("MATH_ERROR", `Answered ${g.numeric.given ?? "an unreadable value"}; the engine gives ${ex.key.numeric.display}${g.numeric.relError !== null ? ` (off by ${(g.numeric.relError * 100).toFixed(0)}%)` : ""}.`);
  if (a.confidence >= 0.8 && g.score < 0.5) add("OVERCONFIDENT_ERROR", `Stated ${(a.confidence * 100).toFixed(0)}% confidence; scored ${(g.score * 100).toFixed(0)}/100.`);
  if (a.answer.type === "decision" && ex.key.decisionBucket) {
    const d = bucketRank(a.answer.decision) - bucketRank(ex.key.decisionBucket);
    if (d <= -1) add("TOO_CONSERVATIVE", `Decided ${a.answer.decision.replace(/_/g, " ").toLowerCase()}; the analysis says ${ex.key.decisionBucket.replace(/_/g, " ").toLowerCase()}.`);
    if (d >= 2) add("TOO_AGGRESSIVE", `Decided ${a.answer.decision.replace(/_/g, " ").toLowerCase()}; the analysis says ${ex.key.decisionBucket.replace(/_/g, " ").toLowerCase()}.`);
  }
  if (a.answer.type === "outlier" && ex.key.correctOptionIds.includes("NO") && a.answer.exceptional) add("TOO_AGGRESSIVE", `Called an outlier where the analysis finds no evidenced outlier signal yet.`);
  return out;
}

export interface MistakeEntry {
  kind: MistakeKind;
  label: string;
  count: number;
  cases: string[];
  recurring: boolean;
  lastAt: string;
  occurrences: MistakeRecord[];
}

export const RECURRING_AT = 2;

export function mistakeLibrary(records: MistakeRecord[]): MistakeEntry[] {
  const m = new Map<MistakeKind, MistakeRecord[]>();
  for (const r of records) m.set(r.kind, [...(m.get(r.kind) ?? []), r]);
  return [...m.entries()]
    .map(([kind, occ]) => {
      const sorted = [...occ].sort((a, b) => (a.at < b.at ? 1 : -1));
      return { kind, label: MISTAKE_LABEL[kind], count: occ.length, cases: [...new Set(occ.map((o) => o.caseName))], recurring: occ.length >= RECURRING_AT, lastAt: sorted[0]!.at, occurrences: sorted };
    })
    .sort((a, b) => b.count - a.count || (a.lastAt < b.lastAt ? 1 : -1));
}

/** Classify every graded attempt (used when mistakes are recomputed from history). */
export function classifyAll(all: AttemptRecord[]): MistakeRecord[] {
  return chronological(graded(all)).flatMap(classifyMistakes);
}
