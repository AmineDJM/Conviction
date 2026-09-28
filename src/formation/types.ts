/**
 * FORMATION — deliberate practice on the real deals of the workspace.
 *
 * Every analysed deal becomes a training case. An exercise has two halves:
 *   - the PUBLIC half (prompt, selected deck facts, answer input) shown before
 *     the user answers — built only from what the deck showed, never from the
 *     AI's conclusions;
 *   - the KEY (correct answer, worked solution, AI analysis, evidence links,
 *     alternative reasoning, what an experienced investor would focus on),
 *     revealed only after the answer is stored immutably.
 *
 * "AI interprets, code calculates": generators and deterministic graders are
 * pure functions of the canonical object + derived analysis. Only open answers
 * are graded by a single budget-capped model call (ai-grader.ts).
 */

export const SKILLS = [
  "SAAS_METRICS",
  "MARKETPLACE_ECONOMICS",
  "CONSUMER_METRICS",
  "BIOTECH",
  "DEEPTECH",
  "FOUNDER_ASSESSMENT",
  "GTM",
  "MARKET_SIZING",
  "CAP_TABLES",
  "RETURN_MODELING",
  "PMF",
  "COMPETITION",
  "MOAT",
  "DECK_FORENSICS",
  "FOUNDER_QUESTIONING",
  "OUTLIER_DETECTION",
  "RISK_DETECTION",
  "INVESTMENT_JUDGMENT",
] as const;
export type Skill = (typeof SKILLS)[number];

export const EXERCISE_KINDS = [
  "MCQ_CONCERN",
  "MCQ_PMF_SIGNAL",
  "MCQ_MISSING_METRIC",
  "NUMERIC",
  "FORENSICS_STATEMENTS",
  "FORENSICS_OMISSIONS",
  "FOUNDER_QUESTIONS",
  "DECISION",
  "BULL_BEAR",
  "OUTLIER",
  "OPEN_THESIS",
  "OPEN_NEXT_METRIC",
  "OPEN_PASS_TRIGGER",
  "OPEN_TWENTY_X",
] as const;
export type ExerciseKind = (typeof EXERCISE_KINDS)[number];

export type ExerciseFamily = "CHOICE" | "NUMERIC" | "FORENSICS" | "QUESTIONS" | "DECISION" | "OPEN";

export const NUMERIC_TASKS = [
  "RUNWAY",
  "IMPLIED_ACV",
  "ENTRY_OWNERSHIP",
  "ROUND_DILUTION",
  "CAC_PAYBACK",
  "BURN_MULTIPLE",
  "EXIT_FOR_20X",
  "FUND_RETURN_EXIT",
  "REQUIRED_CAGR",
  "NET_REVENUE_FROM_GMV",
] as const;
export type NumericTask = (typeof NUMERIC_TASKS)[number];

/** Case patterns. The first seven are EXPERT patterns (the obvious reading is misleading). */
export const EXPERT_PATTERNS = [
  "OBVIOUS_ANSWER_WRONG",
  "CONFLICTING_METRICS",
  "EXTRAORDINARY_FOUNDER_WEAK_TRACTION",
  "GREAT_COMPANY_BAD_PRICE",
  "POOR_LOOKING_WITH_OUTLIER",
  "GROWTH_HIDING_RETENTION",
  "WEAK_MARKET_CAN_EXPAND",
] as const;
export const CASE_PATTERNS = [
  ...EXPERT_PATTERNS,
  "INFLATED_TAM",
  "PILOTS_AS_CUSTOMERS",
  "FORECAST_AS_ACTUAL",
  "CAPITAL_INTENSIVE",
  "FOUNDER_DEPENDENT_SALES",
  "SHORT_RUNWAY",
  "CUSTOMER_CONCENTRATION",
  "UNIT_ECONOMICS_STRAIN",
] as const;
export type CasePattern = (typeof CASE_PATTERNS)[number];
export type ExpertPattern = (typeof EXPERT_PATTERNS)[number];

/**
 * Concepts an exercise tests. Graded attempts emit CAUGHT / MISSED
 * observations per concept; recurring weaknesses are detected from them.
 */
export const CONCEPTS = [
  "RETENTION_RISK",
  "UNIT_ECONOMICS",
  "CAPITAL_EFFICIENCY",
  "RUNWAY_FINANCING",
  "CAPITAL_INTENSITY",
  "CUSTOMER_CONCENTRATION",
  "FOUNDER_DEPENDENCE",
  "GROWTH_QUALITY",
  "MARKET_SIZE_INFLATION",
  "CUSTOMER_QUALITY",
  "FORECAST_VS_ACTUAL",
  "METRIC_DEFINITION",
  "INTERNAL_CONSISTENCY",
  "MISSING_EVIDENCE",
  "ENTRY_PRICE",
  "DILUTION",
  "RETURN_PATH",
  "OUTLIER_SIGNAL",
  "TECHNICAL_ADVANTAGE",
  "FOUNDER_CAPABILITY",
  "COMPETITION",
  "PMF_EVIDENCE",
  "QUESTION_TARGETING",
] as const;
export type Concept = (typeof CONCEPTS)[number];

/* ---------------------------------------------------------------- */
/* Deck facts — the only case information shown before an answer      */
/* ---------------------------------------------------------------- */

export type FactGroup = "Company" | "Traction" | "Economics" | "Financing" | "Market" | "Team" | "Customers" | "Claims";

export interface DeckFact {
  id: string;
  group: FactGroup;
  label: string;
  value: string;
  /** Qualifiers exactly as the deck stated them (period, basis, definition, sample). */
  detail: string | null;
  page: number | null;
  /** Link target into the deal for the reveal (claim / metric). */
  ref: { kind: "claim" | "metric"; id: string } | null;
}

/* ---------------------------------------------------------------- */
/* Answer input specs                                                  */
/* ---------------------------------------------------------------- */

export interface ChoiceOption {
  id: string;
  text: string;
}

export type InputSpec =
  | { type: "choice"; options: ChoiceOption[]; justification: boolean }
  | { type: "numeric"; unit: "USD" | "PERCENT" | "MONTHS" | "MULTIPLE"; hint: string }
  | { type: "statements"; statements: ChoiceOption[]; categories: { id: ForensicCategory; label: string }[] }
  | { type: "multi"; options: ChoiceOption[]; minPicks: number; maxPicks: number }
  | { type: "questions"; count: number }
  | { type: "decision"; options: { id: DecisionBucket; label: string }[] }
  | { type: "bullbear" }
  | { type: "outlier"; signals: ChoiceOption[] }
  | { type: "text"; minWords: number; placeholder: string };

export const DECISION_BUCKETS = ["PASS", "WATCH", "CONTINUE_DD", "IC"] as const;
export type DecisionBucket = (typeof DECISION_BUCKETS)[number];

export const FORENSIC_CATEGORIES = [
  "MISLEADING_METRIC",
  "OMISSION",
  "CONTRADICTION",
  "INFLATED_TAM",
  "PILOTS_AS_CUSTOMERS",
  "FORECAST_AS_ACTUAL",
] as const;
export type ForensicCategory = (typeof FORENSIC_CATEGORIES)[number];

/* ---------------------------------------------------------------- */
/* Answers                                                             */
/* ---------------------------------------------------------------- */

export type Answer =
  | { type: "choice"; optionId: string; justification?: string }
  | { type: "numeric"; value: string }
  | { type: "statements"; flags: { statementId: string; category: ForensicCategory }[] }
  | { type: "multi"; optionIds: string[] }
  | { type: "questions"; questions: string[] }
  | { type: "decision"; decision: DecisionBucket; justification: string }
  | { type: "bullbear"; bull: string; bear: string }
  | { type: "outlier"; exceptional: boolean; signalIds: string[]; justification: string }
  | { type: "text"; text: string };

/* ---------------------------------------------------------------- */
/* Exercise                                                            */
/* ---------------------------------------------------------------- */

export interface CaseRef {
  companyId: string;
  slug: string;
  name: string;
  versionId: string;
  versionNo: number;
}

/** Key point used for rubric grading of open answers. */
export interface KeyPoint {
  id: string;
  kind: "RISK" | "OUTLIER" | "FACT";
  text: string;
  critical: boolean;
  concept: Concept | null;
  href: string | null;
}

export interface EvidenceLinkRef {
  label: string;
  href: string;
}

/** Everything revealed after the answer. Never sent before the answer is stored. */
export interface AnswerKey {
  /** Choice / decision / outlier: the id(s) considered correct. */
  correctOptionIds: string[];
  /** Defensible alternatives that earn half credit. */
  partialOptionIds: string[];
  /** Numeric: the engine value and tolerance (relative). */
  numeric: { value: number; tolerance: number; unit: string; display: string } | null;
  /** Forensics statements: statementId → categories accepted. */
  flagged: Record<string, ForensicCategory[]> | null;
  /** Per-option explanation (choice exercises). */
  optionNotes: Record<string, string>;
  /** Short statement of the answer. */
  answer: string;
  /** Worked solution / reasoning, step by step. */
  workedSolution: string[];
  /** What the AI analysis concluded on this point (quoted from the canonical object / derived analysis). */
  aiAnalysis: string[];
  alternativeReasoning: string[];
  expertFocus: string[];
  evidence: EvidenceLinkRef[];
  keyPoints: KeyPoint[];
  /** Concepts at stake and which ones the correct answer requires. */
  concepts: Concept[];
  /** Founder-question exercise: the scoring material (see founder-questions.ts). */
  questionBank: QuestionBankItem[] | null;
  /** Decision exercise: the analysis bucket. */
  decisionBucket: DecisionBucket | null;
}

export interface QuestionBankItem {
  id: string;
  question: string;
  /** 0–1: how much the answer would move the decision (tier, if-A/if-B, reversing question, sensitivity). */
  impact: number;
  /** 0–1: how uncertain the underlying fact is today. */
  uncertainty: number;
  topics: string[];
  source: "FOUNDER_QUESTION" | "REVERSING_QUESTION" | "SENSITIVITY" | "GAP";
  ifA: string | null;
  ifB: string | null;
}

export interface Exercise {
  /** Deterministic: same case version + kind + variant → same id. */
  id: string;
  kind: ExerciseKind;
  family: ExerciseFamily;
  variant: string;
  skills: Skill[];
  /** 1 (foundational) … 5 (expert). */
  level: number;
  /** Item difficulty on the skill-rating scale (see skill-model.ts). */
  difficulty: number;
  expert: boolean;
  /** Patterns that make this item instructive (revealed after the answer — they would hint at it). */
  patterns: CasePattern[];
  /** Every pattern the case exhibits (revealed after the answer). */
  casePatterns: CasePattern[];
  case: CaseRef;
  title: string;
  prompt: string;
  context: DeckFact[];
  input: InputSpec;
  key: AnswerKey;
}

/** What the client receives before answering. Built by whitelist in publicExercise(): no key, no pattern tags. */
export type PublicExercise = Omit<Exercise, "key" | "patterns" | "casePatterns">;

/* ---------------------------------------------------------------- */
/* Grades                                                              */
/* ---------------------------------------------------------------- */

export type GradeMethod = "EXACT" | "NUMERIC" | "SET" | "QUESTION_SCORING" | "MODEL_RUBRIC" | "HEURISTIC_RUBRIC" | "COMPOSITE";

export interface ConceptObservation {
  concept: Concept;
  outcome: "CAUGHT" | "MISSED";
}

export interface RubricResult {
  reasoningQuality: number; // 0–4
  evidenceUse: number; // 0–4
  caughtRiskIds: string[];
  missedCriticalRiskIds: string[];
  caughtOutlierIds: string[];
  missedOutlierIds: string[];
  pedigreeReliance: boolean;
  strongestPoint: string;
  biggestGap: string;
  feedback: string;
  method: "MODEL" | "HEURISTIC";
  costUsd: number;
  cached: boolean;
}

export interface Grade {
  /** 0–1. Partial credit allowed. */
  score: number;
  /** Binary outcome used for calibration (score ≥ CORRECT_THRESHOLD). */
  correct: boolean;
  method: GradeMethod;
  summary: string;
  details: string[];
  observations: ConceptObservation[];
  rubric: RubricResult | null;
  numeric: { given: number | null; expected: number; relError: number | null } | null;
  questions: { question: string; impact: number; redundant: boolean; redundantWith: string | null; infoGain: number; matched: string | null; score: number }[] | null;
  /** Decision exercise: ordinal distance to the analysis bucket. */
  decisionDistance: number | null;
}

export const CORRECT_THRESHOLD = 0.7;
