/**
 * Human feedback on founder questions and on whole analyses (§129 human utility).
 *
 * Measured, never asserted:
 *   - question usefulness is what a person said after (or outside) a founder
 *     meeting: USEFUL / NOT_USEFUL / ALREADY_KNOWN, stored per question per
 *     analysis version (question ids are per version, so the text is kept);
 *   - the meetings workflow gives an automatic, read-only signal: whether the
 *     meeting actually answered the question (post-meeting version vs the
 *     pre-meeting version it was asked against). "Answered" is NOT counted as
 *     "useful" — it is reported separately;
 *   - per-analysis utility: surfaced better questions / important risks /
 *     missing evidence / market insight, plus preparation time saved.
 *
 * The summaries are pure functions over rows (tested in tests/evals.feedback.test.ts).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import type { FounderQuestion } from "@/domain/canonical";
import { newId, nowIso } from "./ids";

const s = schema;

export const QUESTION_VERDICTS = ["USEFUL", "NOT_USEFUL", "ALREADY_KNOWN"] as const;
export type QuestionVerdict = (typeof QUESTION_VERDICTS)[number];
export type QuestionFeedbackRow = typeof schema.questionFeedback.$inferSelect;
export type AnalysisFeedbackRow = typeof schema.analysisFeedback.$inferSelect;

/* ------------------------------ Writes ------------------------------ */

export function recordQuestionFeedback(
  v: {
    workspaceId: string;
    companyId: string;
    versionId: string;
    userId: string;
    question: Pick<FounderQuestion, "id" | "question" | "tier">;
    verdict: QuestionVerdict;
    note?: string | null;
    source: "MANUAL" | "AFTER_MEETING";
    meetingId?: string | null;
  },
  db: DB = getDb(),
): QuestionFeedbackRow {
  const at = nowIso();
  const existing = db
    .select()
    .from(s.questionFeedback)
    .where(and(eq(s.questionFeedback.versionId, v.versionId), eq(s.questionFeedback.questionId, v.question.id), eq(s.questionFeedback.userId, v.userId)))
    .get();
  const values = {
    workspaceId: v.workspaceId,
    companyId: v.companyId,
    versionId: v.versionId,
    questionId: v.question.id,
    questionText: v.question.question,
    tier: v.question.tier,
    verdict: v.verdict,
    note: v.note?.trim() || null,
    source: v.source,
    meetingId: v.meetingId ?? null,
    userId: v.userId,
    updatedAt: at,
  };
  if (existing) {
    db.update(s.questionFeedback).set(values).where(eq(s.questionFeedback.id, existing.id)).run();
    return { ...existing, ...values };
  }
  const row = { id: newId("qfb"), createdAt: at, ...values };
  db.insert(s.questionFeedback).values(row).run();
  return row;
}

export function recordAnalysisFeedback(
  v: {
    workspaceId: string;
    companyId: string;
    versionId: string;
    userId: string;
    betterQuestions: boolean;
    importantRisks: boolean;
    missingEvidence: boolean;
    marketInsight: boolean;
    minutesSaved: number | null;
    note?: string | null;
  },
  db: DB = getDb(),
): AnalysisFeedbackRow {
  const at = nowIso();
  const existing = db
    .select()
    .from(s.analysisFeedback)
    .where(and(eq(s.analysisFeedback.versionId, v.versionId), eq(s.analysisFeedback.userId, v.userId)))
    .get();
  const values = {
    workspaceId: v.workspaceId,
    companyId: v.companyId,
    versionId: v.versionId,
    betterQuestions: v.betterQuestions,
    importantRisks: v.importantRisks,
    missingEvidence: v.missingEvidence,
    marketInsight: v.marketInsight,
    minutesSaved: v.minutesSaved,
    note: v.note?.trim() || null,
    userId: v.userId,
    updatedAt: at,
  };
  if (existing) {
    db.update(s.analysisFeedback).set(values).where(eq(s.analysisFeedback.id, existing.id)).run();
    return { ...existing, ...values };
  }
  const row = { id: newId("afb"), createdAt: at, ...values };
  db.insert(s.analysisFeedback).values(row).run();
  return row;
}

/* ------------------------------ Reads for the UI ------------------------------ */

const normText = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The user's latest verdict for each question of the version on screen. Question
 * updates create new versions with the same questions, so feedback given on an
 * earlier version of the same company still applies when the id AND text match.
 */
export function questionFeedbackForUser(companyId: string, userId: string, questions: Pick<FounderQuestion, "id" | "question">[], db: DB = getDb()) {
  const rows = db
    .select()
    .from(s.questionFeedback)
    .where(and(eq(s.questionFeedback.companyId, companyId), eq(s.questionFeedback.userId, userId)))
    .orderBy(desc(s.questionFeedback.updatedAt))
    .all();
  const out: Record<string, { verdict: QuestionVerdict; note: string | null; versionId: string; updatedAt: string }> = {};
  for (const q of questions) {
    const r = rows.find((x) => x.questionId === q.id && normText(x.questionText) === normText(q.question));
    if (r) out[q.id] = { verdict: r.verdict, note: r.note, versionId: r.versionId, updatedAt: r.updatedAt };
  }
  return out;
}

export function analysisFeedbackForUser(companyId: string, versionId: string, userId: string, db: DB = getDb()): AnalysisFeedbackRow | null {
  return (
    db
      .select()
      .from(s.analysisFeedback)
      .where(and(eq(s.analysisFeedback.companyId, companyId), eq(s.analysisFeedback.versionId, versionId), eq(s.analysisFeedback.userId, userId)))
      .get() ?? null
  );
}

/* ------------------------------ Pure summaries ------------------------------ */

export interface QuestionFeedbackSummary {
  /** Distinct (company, question text, user) judgements — the latest one counts. */
  n: number;
  useful: number;
  notUseful: number;
  alreadyKnown: number;
  /** useful ÷ n; ALREADY_KNOWN counts against (the fund already had the answer). */
  usefulRate: number | null;
  byTier: Record<string, { n: number; useful: number }>;
}

export function summarizeQuestionFeedback(rows: Pick<QuestionFeedbackRow, "companyId" | "questionText" | "userId" | "verdict" | "tier" | "updatedAt">[]): QuestionFeedbackSummary {
  // The same question judged on several versions (question updates create versions) counts once per user.
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const k = `${r.companyId}|${normText(r.questionText)}|${r.userId}`;
    const prev = latest.get(k);
    if (!prev || r.updatedAt > prev.updatedAt) latest.set(k, r);
  }
  const xs = [...latest.values()];
  const useful = xs.filter((r) => r.verdict === "USEFUL").length;
  const byTier: QuestionFeedbackSummary["byTier"] = {};
  for (const r of xs) {
    const t = (byTier[r.tier] ??= { n: 0, useful: 0 });
    t.n++;
    if (r.verdict === "USEFUL") t.useful++;
  }
  return {
    n: xs.length,
    useful,
    notUseful: xs.filter((r) => r.verdict === "NOT_USEFUL").length,
    alreadyKnown: xs.filter((r) => r.verdict === "ALREADY_KNOWN").length,
    usefulRate: xs.length ? useful / xs.length : null,
    byTier,
  };
}

export interface MeetingAnswerSignal {
  meetings: number;
  /** Questions of the pre-meeting versions. */
  asked: number;
  /** … that the post-meeting version records as answered (RESOLVED, NOT_FULLY_RESOLVED, or a new answer). */
  answered: number;
  resolved: number;
  answeredRate: number | null;
  resolvedRate: number | null;
}

/** Automatic signal: did the founder meeting answer the questions the analysis prepared? */
export function meetingAnswerSignal(pairs: { pre: Pick<FounderQuestion, "id" | "question" | "status" | "answer">[]; post: Pick<FounderQuestion, "id" | "question" | "status" | "answer">[] }[]): MeetingAnswerSignal {
  let asked = 0;
  let answered = 0;
  let resolved = 0;
  for (const { pre, post } of pairs) {
    for (const q of pre) {
      // Only questions still open before the meeting can be answered by it.
      if (q.status === "RESOLVED") continue;
      asked++;
      const after = post.find((x) => x.id === q.id && normText(x.question) === normText(q.question)) ?? post.find((x) => normText(x.question) === normText(q.question));
      if (!after) continue;
      const newAnswer = !!after.answer && after.answer !== q.answer;
      if (after.status === "RESOLVED" || after.status === "NOT_FULLY_RESOLVED" || newAnswer) answered++;
      if (after.status === "RESOLVED") resolved++;
    }
  }
  return { meetings: pairs.length, asked, answered, resolved, answeredRate: asked ? answered / asked : null, resolvedRate: asked ? resolved / asked : null };
}

export interface AnalysisFeedbackSummary {
  n: number;
  betterQuestions: number | null;
  importantRisks: number | null;
  missingEvidence: number | null;
  marketInsight: number | null;
  /** Share of analyses where at least one of the four was surfaced. */
  anyValue: number | null;
  minutesSavedMedian: number | null;
  minutesSavedMean: number | null;
  minutesSavedN: number;
}

export function summarizeAnalysisFeedback(rows: Pick<AnalysisFeedbackRow, "betterQuestions" | "importantRisks" | "missingEvidence" | "marketInsight" | "minutesSaved">[]): AnalysisFeedbackSummary {
  const n = rows.length;
  const share = (f: (r: (typeof rows)[number]) => boolean) => (n ? rows.filter(f).length / n : null);
  const mins = rows.map((r) => r.minutesSaved).filter((x): x is number => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  const median = mins.length ? (mins.length % 2 ? mins[(mins.length - 1) / 2]! : (mins[mins.length / 2 - 1]! + mins[mins.length / 2]!) / 2) : null;
  return {
    n,
    betterQuestions: share((r) => r.betterQuestions),
    importantRisks: share((r) => r.importantRisks),
    missingEvidence: share((r) => r.missingEvidence),
    marketInsight: share((r) => r.marketInsight),
    anyValue: share((r) => r.betterQuestions || r.importantRisks || r.missingEvidence || r.marketInsight),
    minutesSavedMedian: median,
    minutesSavedMean: mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : null,
    minutesSavedN: mins.length,
  };
}

/* ------------------------------ Workspace report (read-only) ------------------------------ */

export function feedbackReport(workspaceId: string, db: DB = getDb()) {
  const qRows = db.select().from(s.questionFeedback).where(eq(s.questionFeedback.workspaceId, workspaceId)).all();
  const aRows = db.select().from(s.analysisFeedback).where(eq(s.analysisFeedback.workspaceId, workspaceId)).all();

  // Meetings workflow: pre-meeting version (frozen at ingestion) vs the post-meeting version it produced.
  const meetings = db
    .select({ pre: s.founderMeetings.preAnalysisVersionId, post: s.founderMeetings.postAnalysisVersionId })
    .from(s.founderMeetings)
    .where(and(eq(s.founderMeetings.workspaceId, workspaceId), eq(s.founderMeetings.status, "READY")))
    .all()
    .filter((m): m is { pre: string; post: string } => !!m.post);
  const ids = [...new Set(meetings.flatMap((m) => [m.pre, m.post]))];
  const versions = ids.length ? db.select({ id: s.companyVersions.id, canonical: s.companyVersions.canonical }).from(s.companyVersions).where(inArray(s.companyVersions.id, ids)).all() : [];
  const qs = new Map<string, FounderQuestion[]>();
  for (const v of versions) {
    const c = v.canonical as { questions?: FounderQuestion[] } | null;
    qs.set(v.id, Array.isArray(c?.questions) ? c!.questions : []);
  }
  const pairs = meetings.filter((m) => qs.has(m.pre) && qs.has(m.post)).map((m) => ({ pre: qs.get(m.pre)!, post: qs.get(m.post)! }));

  return {
    questions: summarizeQuestionFeedback(qRows),
    questionsAfterMeeting: summarizeQuestionFeedback(qRows.filter((r) => r.source === "AFTER_MEETING")),
    meetingSignal: meetingAnswerSignal(pairs),
    analyses: summarizeAnalysisFeedback(aRows),
  };
}
