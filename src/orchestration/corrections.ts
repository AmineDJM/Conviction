/**
 * Analyst edits to the canonical object (§63–65). Pure functions: they
 * return a new canonical object and never mutate their input. Persisting the
 * result as a version is the caller's job (server/versioning.ts).
 *
 * Metric corrections are analyst overrides (engine/overrides.ts, server/overrides.ts):
 * the old USER_CORRECTED copy mechanism was removed; stored copies are upgraded to
 * overrides on read (engine/override-carry.ts#upgradeLegacyCorrections).
 */
import type { CanonicalDeal, FounderQuestion } from "@/domain/canonical";
import type { QuestionStatus } from "@/domain/enums";

export class CorrectionError extends Error {}

export interface QuestionUpdate {
  questionId: string;
  status: QuestionStatus;
  answer?: string | null;
  note?: string | null;
}

/** Status is factual (OPEN / ASKED / RESOLVED / NOT_FULLY_RESOLVED) — never a judgement of the founder. */
export function applyQuestionUpdate(c: CanonicalDeal, u: QuestionUpdate, asOf = new Date()): { deal: CanonicalDeal; before: FounderQuestion; after: FounderQuestion } {
  const idx = c.questions.findIndex((q) => q.id === u.questionId);
  if (idx < 0) throw new CorrectionError(`Unknown question ${u.questionId}`);
  const next = structuredClone(c);
  const q = next.questions[idx]!;
  const before = structuredClone(q);
  q.status = u.status;
  if (u.answer !== undefined) {
    const a = u.answer?.trim() || null;
    q.answer = a;
    q.answeredAt = a ? asOf.toISOString() : null;
  }
  if (u.note !== undefined) q.resolutionNote = u.note?.trim() || null;
  return { deal: next, before, after: q };
}
