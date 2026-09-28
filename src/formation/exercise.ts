/**
 * Exercise construction helpers: deterministic ids, level → difficulty
 * mapping, expert flag, and the whitelist that builds the pre-answer payload.
 */
import type { TrainingCase } from "./case";
import { hash } from "./format";
import { EXPERT_PATTERNS, type AnswerKey, type CasePattern, type DeckFact, type Exercise, type ExerciseFamily, type ExerciseKind, type InputSpec, type PublicExercise, type Skill } from "./types";

/** Item difficulty on the skill-rating scale: level 1 = 1050 … level 5 = 1650 (150 per level). */
export const LEVEL_BASE = 1050;
export const LEVEL_STEP = 150;
export const levelToDifficulty = (level: number) => LEVEL_BASE + LEVEL_STEP * (Math.min(5, Math.max(1, level)) - 1);

const FAMILY: Record<ExerciseKind, ExerciseFamily> = {
  MCQ_CONCERN: "CHOICE",
  MCQ_PMF_SIGNAL: "CHOICE",
  MCQ_MISSING_METRIC: "CHOICE",
  NUMERIC: "NUMERIC",
  FORENSICS_STATEMENTS: "FORENSICS",
  FORENSICS_OMISSIONS: "FORENSICS",
  FOUNDER_QUESTIONS: "QUESTIONS",
  DECISION: "DECISION",
  BULL_BEAR: "OPEN",
  OUTLIER: "DECISION",
  OPEN_THESIS: "OPEN",
  OPEN_NEXT_METRIC: "OPEN",
  OPEN_PASS_TRIGGER: "OPEN",
  OPEN_TWENTY_X: "OPEN",
};

export function emptyKey(): AnswerKey {
  return {
    correctOptionIds: [],
    partialOptionIds: [],
    numeric: null,
    flagged: null,
    optionNotes: {},
    answer: "",
    workedSolution: [],
    aiAnalysis: [],
    alternativeReasoning: [],
    expertFocus: [],
    evidence: [],
    keyPoints: [],
    concepts: [],
    questionBank: null,
    decisionBucket: null,
  };
}

export interface MakeExercise {
  c: TrainingCase;
  kind: ExerciseKind;
  variant: string;
  skills: (Skill | null)[];
  level: number;
  /** Patterns of the case that make THIS item harder (expert when any is an expert pattern). */
  patterns?: CasePattern[];
  title: string;
  prompt: string;
  context: DeckFact[];
  input: InputSpec;
  key: AnswerKey;
}

export function makeExercise(x: MakeExercise): Exercise {
  const patterns = [...new Set(x.patterns ?? [])];
  const expert = patterns.some((p) => (EXPERT_PATTERNS as readonly string[]).includes(p));
  const level = Math.min(5, Math.max(1, Math.round(x.level + (expert ? 1 : 0))));
  const skills = [...new Set(x.skills.filter((s): s is Skill => !!s))];
  return {
    id: `fx_${hash(`${x.c.ref.versionId}|${x.kind}|${x.variant}`)}${hash(`${x.kind}:${x.variant}:${x.c.ref.companyId}`)}`,
    kind: x.kind,
    family: FAMILY[x.kind],
    variant: x.variant,
    skills,
    level,
    difficulty: levelToDifficulty(level),
    expert,
    patterns,
    casePatterns: x.c.patterns.map((p) => p.pattern),
    case: x.c.ref,
    title: x.title,
    prompt: x.prompt,
    context: x.context,
    input: x.input,
    key: x.key,
  };
}

/**
 * The pre-answer payload. Built by WHITELIST (never by deleting fields), so
 * nothing from the answer key or the analysis can reach the client before the
 * answer is stored.
 */
export function publicExercise(ex: Exercise): PublicExercise {
  return {
    id: ex.id,
    kind: ex.kind,
    family: ex.family,
    variant: ex.variant,
    skills: [...ex.skills],
    level: ex.level,
    difficulty: ex.difficulty,
    expert: ex.expert,
    case: { companyId: ex.case.companyId, slug: ex.case.slug, name: ex.case.name, versionId: ex.case.versionId, versionNo: ex.case.versionNo },
    title: ex.title,
    prompt: ex.prompt,
    context: ex.context.map((f) => ({ id: f.id, group: f.group, label: f.label, value: f.value, detail: f.detail, page: f.page, ref: null })),
    input: publicInput(ex.input),
  };
}

function publicInput(i: InputSpec): InputSpec {
  switch (i.type) {
    case "choice":
      return { type: "choice", options: i.options.map((o) => ({ id: o.id, text: o.text })), justification: i.justification };
    case "numeric":
      return { type: "numeric", unit: i.unit, hint: i.hint };
    case "statements":
      return { type: "statements", statements: i.statements.map((o) => ({ id: o.id, text: o.text })), categories: i.categories.map((c) => ({ id: c.id, label: c.label })) };
    case "multi":
      return { type: "multi", options: i.options.map((o) => ({ id: o.id, text: o.text })), minPicks: i.minPicks, maxPicks: i.maxPicks };
    case "questions":
      return { type: "questions", count: i.count };
    case "decision":
      return { type: "decision", options: i.options.map((o) => ({ id: o.id, label: o.label })) };
    case "bullbear":
      return { type: "bullbear" };
    case "outlier":
      return { type: "outlier", signals: i.signals.map((o) => ({ id: o.id, text: o.text })) };
    case "text":
      return { type: "text", minWords: i.minWords, placeholder: i.placeholder };
  }
}

/** Case header used at the top of prompts: "Ledgerline — Series A · automates invoice processing …". */
export function caseLine(c: TrainingCase): string {
  const stage = c.deal.classification.declaredStage ?? c.deal.classification.financingStage.replace(/_/g, " ").toLowerCase();
  return `${c.ref.name} (${stage}): ${c.deal.identity.oneLiner}`;
}
