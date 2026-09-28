/**
 * Formation service: turns the workspace's analysed deals into training cases,
 * selects the next exercise, stores answers before the reveal, grades them,
 * and assembles the profile, journal and mistake library. Server-only.
 */
import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import * as repo from "@/server/repo";
import type { SessionContext } from "@/server/auth";
import { getRegistry } from "@/engine/benchmarks";
import { derive, type DerivedAnalysis } from "@/engine/derive";
import type { CanonicalDeal } from "@/domain/canonical";
import { buildCase, type TrainingCase } from "./case";
import { generateExercises } from "./generate";
import { publicExercise } from "./exercise";
import { checkAnswer, type SubmitInput } from "./answer-schema";
import { grade as gradeAnswer, needsRubric, rubricText } from "./grade";
import { gradeOpenAnswer } from "./ai-grader";
import { classifyMistakes, mistakeLibrary, type MistakeEntry, type MistakeKind, type MistakeRecord } from "./mistakes";
import { currentRd, isExpert, replayProfile, type SkillEvent, type SkillProfile } from "./skill-model";
import { detectWeaknesses, conceptStats, type ConceptStat, type Weakness } from "./weaknesses";
import { mastery, type Mastery } from "./mastery";
import { tendencies, type Tendency } from "./development";
import { selectNext } from "./selection";
import { buildJournal, PROGRESS_KEYS, type CompanyTimeline, type JournalEntry } from "./journal";
import * as store from "./store";
import type { AttemptRecord, RevealPayload } from "./records";
import type { CasePattern, Exercise, ExerciseKind, Grade, PublicExercise, Skill } from "./types";

/* ---------------------------------------------------------------- */
/* Cases                                                               */
/* ---------------------------------------------------------------- */

interface CaseEntry {
  c: TrainingCase;
  exercises: Exercise[];
}

const CACHE = new Map<string, CaseEntry>();
const CACHE_MAX = 64;

/** Stored snapshots from before the integrity / economics / latent engines lack those reports: recompute (pure, deterministic). */
function completeDerived(workspaceId: string, deal: CanonicalDeal, stored: DerivedAnalysis, registryId: string, createdAt: string, db: DB): DerivedAnalysis {
  if (stored?.integrity && stored?.economics && stored?.latent && stored?.recommendation) return stored;
  const fund = repo.getDefaultFund(workspaceId, db);
  return derive(deal, getRegistry(registryId), fund, { now: new Date(createdAt) });
}

export function caseForVersion(workspaceId: string, company: repo.CompanyRow, versionId: string, db: DB = getDb()): CaseEntry | null {
  const cacheKey = `${workspaceId}:${versionId}`;
  const hit = CACHE.get(cacheKey);
  if (hit) return hit;
  const v = repo.getVersion(company.id, versionId, db);
  if (!v) return null;
  const derived = completeDerived(workspaceId, v.canonical, v.derived, v.row.registryId, v.row.createdAt, db);
  const c = buildCase({ ref: { companyId: company.id, slug: company.slug, name: v.canonical.identity.name || company.name, versionId: v.row.id, versionNo: v.row.versionNo }, deal: v.canonical, derived });
  const entry = { c, exercises: generateExercises(c) };
  if (CACHE.size >= CACHE_MAX) CACHE.delete(CACHE.keys().next().value!);
  CACHE.set(cacheKey, entry);
  return entry;
}

/** Every analysed deal of the workspace becomes a training case (current version). */
export function loadCases(workspaceId: string, db: DB = getDb()): CaseEntry[] {
  const out: CaseEntry[] = [];
  for (const co of repo.listCompanies(workspaceId, db)) {
    if (co.status !== "READY" || !co.currentVersionId) continue;
    try {
      const e = caseForVersion(workspaceId, co, co.currentVersionId, db);
      if (e && e.exercises.length) out.push(e);
    } catch {
      /* a malformed legacy version must not break training on the others */
    }
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Profile                                                             */
/* ---------------------------------------------------------------- */

export function profileOf(attempts: AttemptRecord[], now = new Date()): { profile: SkillProfile; events: SkillEvent[] } {
  const { profile, events } = replayProfile(attempts.filter((a) => a.grade).map((a) => ({ at: a.answeredAt, skills: a.exercise.skills, difficulty: a.exercise.difficulty, score: a.grade!.score })));
  for (const k of Object.keys(profile) as Skill[]) profile[k] = { ...profile[k], rd: currentRd(profile[k], now) };
  return { profile, events };
}

function mistakeRecords(workspaceId: string, userId: string, attempts: AttemptRecord[], db: DB): MistakeRecord[] {
  const byId = new Map(attempts.map((a) => [a.id, a]));
  return store.listMistakeRows(workspaceId, userId, db).map((r) => {
    const a = byId.get(r.attemptId);
    return { kind: r.kind as MistakeKind, attemptId: r.attemptId, companyId: r.companyId, caseName: a?.exercise.case.name ?? "—", exerciseTitle: a?.exercise.title ?? "—", at: r.createdAt, evidence: r.evidence };
  });
}

export interface CaseSummary {
  companyId: string;
  slug: string;
  name: string;
  stage: string;
  domain: Skill | null;
  exercises: number;
  answered: number;
  expertExercises: number;
  /** Pattern tags are shown once the case has been practised (they would otherwise hint at answers). */
  patterns: { pattern: CasePattern; expert: boolean; evidence: string }[] | null;
  patternCount: number;
}

export interface FormationOverview {
  attempts: AttemptRecord[];
  profile: SkillProfile;
  events: SkillEvent[];
  mastery: Mastery;
  weaknesses: Weakness[];
  concepts: ConceptStat[];
  mistakes: MistakeEntry[];
  tendencies: Tendency[];
  cases: CaseSummary[];
  expertMode: boolean;
}

export function overview(session: SessionContext, db: DB = getDb()): FormationOverview {
  const attempts = store.listAttempts(session.workspaceId, session.userId, db);
  const { profile, events } = profileOf(attempts);
  const cases = loadCases(session.workspaceId, db);
  const answeredByCompany = new Map<string, number>();
  for (const a of attempts) answeredByCompany.set(a.exercise.case.companyId, (answeredByCompany.get(a.exercise.case.companyId) ?? 0) + 1);
  return {
    attempts,
    profile,
    events,
    mastery: mastery(attempts),
    weaknesses: detectWeaknesses(attempts),
    concepts: conceptStats(attempts),
    mistakes: mistakeLibrary(mistakeRecords(session.workspaceId, session.userId, attempts, db)),
    tendencies: tendencies(attempts, profile),
    expertMode: isExpert(profile),
    cases: cases.map(({ c, exercises }) => {
      const answered = answeredByCompany.get(c.ref.companyId) ?? 0;
      return {
        companyId: c.ref.companyId,
        slug: c.ref.slug,
        name: c.ref.name,
        stage: c.deal.classification.declaredStage ?? c.deal.classification.financingStage,
        domain: c.domainSkill,
        exercises: exercises.length,
        answered,
        expertExercises: exercises.filter((e) => e.expert).length,
        patterns: answered >= 3 ? c.patterns.map((p) => ({ pattern: p.pattern, expert: p.expert, evidence: p.evidence })) : null,
        patternCount: c.patterns.length,
      };
    }),
  };
}

/* ---------------------------------------------------------------- */
/* Next exercise                                                       */
/* ---------------------------------------------------------------- */

export interface NextResult {
  exercise: PublicExercise;
  reason: string;
  drill: MistakeKind | null;
  expertMode: boolean;
  progress: { answered: number; available: number };
}

export function nextExercise(session: SessionContext, opts: { caseId?: string | null; kind?: ExerciseKind | null; drill?: MistakeKind | null; expert?: boolean | null } = {}, db: DB = getDb()): NextResult | null {
  const attempts = store.listAttempts(session.workspaceId, session.userId, db);
  const { profile } = profileOf(attempts);
  const cases = loadCases(session.workspaceId, db);
  const candidates = cases.flatMap((x) => x.exercises);
  const sel = selectNext(candidates, attempts, profile, detectWeaknesses(attempts), mistakeLibrary(mistakeRecords(session.workspaceId, session.userId, attempts, db)), {
    caseId: opts.caseId ?? null,
    kind: opts.kind ?? null,
    drill: opts.drill ?? null,
    expertMode: opts.expert ?? undefined,
    seed: `${session.userId}:${attempts.length}`,
  });
  if (!sel) return null;
  const answered = new Set(attempts.map((a) => a.exercise.id));
  return { exercise: publicExercise(sel.exercise), reason: sel.reason, drill: sel.drill, expertMode: sel.expertMode, progress: { answered: candidates.filter((e) => answered.has(e.id)).length, available: candidates.length } };
}

/* ---------------------------------------------------------------- */
/* Submit → store (immutable) → grade → reveal                         */
/* ---------------------------------------------------------------- */

export type Reveal = RevealPayload;

export class FormationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function submitAnswer(session: SessionContext, input: SubmitInput, db: DB = getDb()): Promise<Reveal> {
  const company = repo.getCompany(session.workspaceId, input.companyId, db);
  if (!company) throw new FormationError("Case not found", 404);
  const entry = caseForVersion(session.workspaceId, company, input.versionId, db);
  const ex = entry?.exercises.find((e) => e.id === input.exerciseId);
  if (!entry || !ex) throw new FormationError("This exercise is no longer available — load a new one.", 409);
  const invalid = checkAnswer(ex, input.answer);
  if (invalid) throw new FormationError(invalid, 400);

  const before = store.listAttempts(session.workspaceId, session.userId, db);
  const { profile: p0 } = profileOf(before);

  // 1. The answer is stored first, immutably — the journal records what was believed before the reveal.
  const row = store.insertAttempt({ workspaceId: session.workspaceId, userId: session.userId, exercise: ex, answer: input.answer, confidence: input.confidence }, db);

  // 2. Grade.
  let g: Grade | null = null;
  let gradeError: string | null = null;
  let cost = 0;
  try {
    let rubric = null;
    let fallback: string | null = null;
    if (needsRubric(ex)) {
      const outcome = await gradeOpenAnswer(ex, rubricText(ex, input.answer), { workspaceId: session.workspaceId, db });
      rubric = outcome.rubric;
      cost = outcome.costUsd;
      fallback = outcome.fallbackReason;
    }
    g = gradeAnswer({ ex, answer: input.answer, c: entry.c, rubric });
    if (fallback && g.rubric?.method === "HEURISTIC") g.details.push(`Model grader unavailable: ${fallback}`);
    store.setGrade(row.id, g, cost, db);
  } catch (e) {
    gradeError = (e as Error).message;
    store.markGradeFailed(row.id, db);
  }

  // 3. Mistakes and skill changes.
  const record = store.toRecord(store.getAttemptRow(session.workspaceId, session.userId, row.id, db)!);
  const mistakes = g ? classifyMistakes(record) : [];
  store.insertMistakes(session.workspaceId, session.userId, mistakes, db);
  const { profile: p1 } = profileOf([...before, record]);
  return {
    attemptId: row.id,
    exercise: ex,
    answer: record.answer,
    confidence: record.confidence,
    answeredAt: record.answeredAt,
    grade: g,
    gradeError,
    skillChanges: ex.skills.map((s) => ({ skill: s, before: p0[s].rating, after: p1[s].rating, rdBefore: p0[s].rd, rdAfter: p1[s].rd })),
    mistakes,
  };
}

export function getReveal(session: SessionContext, attemptId: string, db: DB = getDb()): Reveal | null {
  const row = store.getAttemptRow(session.workspaceId, session.userId, attemptId, db);
  if (!row) return null;
  const rec = store.toRecord(row);
  const mistakes = store.listMistakeRows(session.workspaceId, session.userId, db).filter((m) => m.attemptId === attemptId);
  return {
    attemptId,
    exercise: rec.exercise,
    answer: rec.answer,
    confidence: rec.confidence,
    answeredAt: rec.answeredAt,
    grade: rec.grade,
    gradeError: row.status === "GRADE_FAILED" ? "Grading failed for this attempt." : null,
    skillChanges: [],
    mistakes: mistakes.map((m) => ({ kind: m.kind as MistakeKind, attemptId, companyId: m.companyId, caseName: rec.exercise.case.name, exerciseTitle: rec.exercise.title, at: m.createdAt, evidence: m.evidence })),
  };
}

/* ---------------------------------------------------------------- */
/* Journal                                                             */
/* ---------------------------------------------------------------- */

function timelineFor(workspaceId: string, companyId: string, db: DB): CompanyTimeline | null {
  const company = repo.getCompany(workspaceId, companyId, db);
  if (!company) return null;
  const versions = repo
    .listVersions(company.id, db)
    .slice()
    .reverse()
    .map((v) => {
      const lv = repo.getVersion(company.id, v.id, db);
      const metrics: Record<string, number> = {};
      for (const p of PROGRESS_KEYS) {
        const m = lv?.canonical.metrics.find((x) => x.metricKey === p.key && x.isPrimary && x.normalizedValue !== null);
        if (m?.normalizedValue !== undefined && m.normalizedValue !== null) metrics[p.key] = m.normalizedValue;
      }
      return { id: v.id, versionNo: v.versionNo, createdAt: v.createdAt, reason: v.reason, recommendation: lv?.derived?.recommendation?.status ?? null, metrics };
    });
  const ic = db
    .select()
    .from(schema.historyEvents)
    .where(and(eq(schema.historyEvents.companyId, company.id), eq(schema.historyEvents.type, "IC_DECISION")))
    .orderBy(desc(schema.historyEvents.createdAt))
    .get();
  const current = repo.getCurrentVersion(company, db);
  return {
    companyId: company.id,
    name: company.name,
    slug: company.slug,
    icDecision: (company.icDecision as CompanyTimeline["icDecision"]) ?? "PENDING",
    icDecidedAt: ic?.createdAt ?? null,
    executionStatus: company.executionStatus,
    versions,
    answeredQuestions: (current?.canonical.questions ?? []).filter((q) => q.answer).map((q) => ({ id: q.id, question: q.question, answer: q.answer, status: q.status, answeredAt: q.answeredAt })),
  };
}

export function journal(session: SessionContext, db: DB = getDb()): JournalEntry[] {
  const attempts = store.listAttempts(session.workspaceId, session.userId, db);
  const companyIds = [...new Set(attempts.map((a) => a.exercise.case.companyId))];
  const timelines = companyIds.map((id) => timelineFor(session.workspaceId, id, db)).filter((t): t is CompanyTimeline => !!t);
  return buildJournal(attempts, timelines);
}
