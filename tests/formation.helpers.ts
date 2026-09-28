/** Shared builders for the Formation suites (no DB, no network). */
import type { CanonicalDeal } from "@/domain/canonical";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { derive } from "@/engine/derive";
import { buildCase, type TrainingCase } from "@/formation/case";
import { generateExercises } from "@/formation/generate";
import type { Answer, Exercise, ExerciseKind, Grade, RubricResult } from "@/formation/types";
import type { AttemptRecord } from "@/formation/records";
import { makeDeal } from "./fixtures";
import { AS_OF, cleanDeal, docSource, m, REG } from "./fixtures/integrity/builders";

export { makeDeal, cleanDeal, m, AS_OF };

let seq = 0;
export function caseFrom(deal: CanonicalDeal, ref: Partial<TrainingCase["ref"]> = {}): TrainingCase {
  if (!deal.sources.some((s) => s.id === "SRC-001")) deal.sources = [docSource(), ...deal.sources];
  const derived = derive(deal, REG, DEFAULT_FUND_PROFILE, { now: new Date(AS_OF) });
  seq++;
  return buildCase({ ref: { companyId: `co_${seq}`, slug: `case-${seq}`, name: deal.identity.name, versionId: `ver_${seq}`, versionNo: 1, ...ref }, deal, derived });
}

export function exercisesOf(c: TrainingCase): Exercise[] {
  return generateExercises(c);
}

export function kindOf(c: TrainingCase, kind: ExerciseKind, variant?: string): Exercise {
  const e = generateExercises(c).find((x) => x.kind === kind && (!variant || x.variant === variant));
  if (!e) throw new Error(`no ${kind}${variant ? `/${variant}` : ""} exercise; have ${generateExercises(c).map((x) => `${x.kind}/${x.variant}`).join(", ")}`);
  return e;
}

/** The spec's example: ARR grew 180%, NRR 84%, CAC payback 6 months. */
export function leakyGrowthDeal(): CanonicalDeal {
  const d = cleanDeal();
  d.identity.name = "Leaky Growth";
  d.metrics = d.metrics.map((x) =>
    x.metricKey === "nrr" && x.isPrimary ? { ...x, normalizedValue: 84, rawValue: "84%" } : x.metricKey === "arr_growth_yoy" ? { ...x, normalizedValue: 180, rawValue: "180%" } : x.metricKey === "cac_payback_months" ? { ...x, normalizedValue: 6, rawValue: "6 months" } : x,
  );
  return d;
}

export function rubric(over: Partial<RubricResult> = {}): RubricResult {
  return { reasoningQuality: 3, evidenceUse: 3, caughtRiskIds: [], missedCriticalRiskIds: [], caughtOutlierIds: [], missedOutlierIds: [], pedigreeReliance: false, strongestPoint: "", biggestGap: "", feedback: "", method: "MODEL", costUsd: 0, cached: false, ...over };
}

let aseq = 0;
export function attempt(ex: Exercise, answer: Answer, grade: Grade | null, opts: { confidence?: number; at?: string } = {}): AttemptRecord {
  aseq++;
  return { id: `fat_${aseq}`, exercise: ex, answer, confidence: opts.confidence ?? 0.6, answeredAt: opts.at ?? new Date(Date.UTC(2026, 8, 1) + aseq * 3600e3).toISOString(), grade, gradedAt: grade ? new Date().toISOString() : null };
}

export function simpleGrade(score: number, over: Partial<Grade> = {}): Grade {
  return { score, correct: score >= 0.7, method: "EXACT", summary: "", details: [], observations: [], rubric: null, numeric: null, questions: null, decisionDistance: null, ...over };
}

export function withAnalysis(d: CanonicalDeal): CanonicalDeal {
  d.aiRecommendation = { suggestedStatus: "NEEDS_TARGETED_DILIGENCE", rationale: "SECRET-RATIONALE: the analysis conclusion", watch: null };
  d.thesis = {
    bet: "SECRET-BET: automation replaces manual AP work at scale",
    requiredConditions: [{ condition: "Retention holds above 110%", currentEvidence: "NRR 118%", status: "PARTIALLY_SUPPORTED" }],
    thesisPoints: ["a", "b", "c"],
    whatCouldBreak: ["SECRET-BREAK: incumbents bundle it", "y", "z"],
    fatalWeakness: "SECRET-FATAL: founder-led sales",
    fatalQuestion: "Can sales scale without the founders?",
    returnPath: "SECRET-RETURN-PATH",
    nextProof: "x",
  };
  d.risks = [
    { id: "RSK-01", category: "CUSTOMER", title: "SECRET-RISK retention may not hold", description: "Cohort churn unknown", severity: "HIGH", likelihood: "MODERATE", timing: "NEXT_12_MONTHS", mitigation: "", evidence: "", claimRefs: ["CLM-002"], weaknessClass: "REPAIRABLE", repair: null },
    { id: "RSK-02", category: "FINANCING", title: "SECRET-RISK runway", description: "Short runway before the round", severity: "CRITICAL", likelihood: "HIGH", timing: "NOW", mitigation: "", evidence: "", claimRefs: [], weaknessClass: "REPAIRABLE", repair: null },
    { id: "RSK-03", category: "COMPETITION", title: "SECRET-RISK incumbents", description: "Bundling risk", severity: "MODERATE", likelihood: "MODERATE", timing: "AT_SCALE", mitigation: "", evidence: "", claimRefs: [], weaknessClass: "STRUCTURAL", repair: null },
  ];
  d.redTeam = { caseAgainstInvesting: ["SECRET-AGAINST-INVESTING"], caseAgainstPassing: ["SECRET-AGAINST-PASSING"], passRegretScenario: "SECRET-REGRET" };
  d.whatILike = ["SECRET-LIKE: fast growth"];
  d.whatWorriesMe = ["SECRET-WORRY"];
  d.executiveSummary = "SECRET-SUMMARY";
  d.exceptionalStrengths = [
    { id: "EXS-1", claim: "SECRET-STRENGTH: 10x cheaper extraction", kind: "TECHNICAL_BREAKTHROUGH", evidence: "benchmarks", whyItMatters: "cost", durability: "patents", invalidation: "LLMs catch up", rating: "STRONG", claimRefs: ["CLM-003"] },
  ];
  d.questions = [
    { id: "Q-01", question: "Can you share 12-month logo and revenue retention by quarterly cohort?", tier: "MUST_ASK", whyItMatters: "retention decides the thesis", knownContext: "", ifAnswerA: "above 110% supports the bet", ifAnswerB: "below 100% breaks it", affects: ["RECOMMENDATION"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null },
    { id: "Q-02", question: "How much of closed revenue still depends on the founders selling?", tier: "IMPORTANT", whyItMatters: "sales scalability", knownContext: "", ifAnswerA: "", ifAnswerB: "", affects: ["RISK"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null },
    { id: "Q-03", question: "What is the fully loaded CAC including salaries and founder time?", tier: "IMPORTANT", whyItMatters: "payback", knownContext: "", ifAnswerA: "", ifAnswerB: "", affects: ["VALUATION"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null },
  ];
  return d;
}
