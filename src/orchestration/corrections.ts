/**
 * Analyst edits to the canonical object (§16, §63–65). Pure functions: they
 * return a new canonical object and never mutate their input. Persisting the
 * result as a version is the caller's job (server/versioning.ts).
 */
import type { CanonicalDeal, FounderQuestion, MetricInstance } from "@/domain/canonical";
import type { QuestionStatus } from "@/domain/enums";
import { deriveMetrics } from "@/engine/metrics/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { seqIdFactory } from "@/server/ids";

export class CorrectionError extends Error {}

export interface MetricCorrection {
  metricId: string;
  /** New value in the dictionary unit (USD, percent units, months…). */
  value: number;
  note: string;
  actor: string;
}

/**
 * Adds a USER_CORRECTED copy of the metric. The original instance stays in
 * place as the audit trail; `selectPrimary` makes the correction the primary
 * instance. Derived metrics are dropped and re-derived so formulas see the
 * corrected input. An earlier correction of the same metric and period is
 * superseded (replaced) by the new one.
 */
export function applyMetricCorrection(c: CanonicalDeal, corr: MetricCorrection, asOf = new Date()): { deal: CanonicalDeal; corrected: MetricInstance; previous: MetricInstance } {
  if (!Number.isFinite(corr.value)) throw new CorrectionError("Value must be a finite number");
  const original = c.metrics.find((m) => m.id === corr.metricId);
  if (!original) throw new CorrectionError(`Unknown metric ${corr.metricId}`);
  const next = structuredClone(c);
  const metId = seqIdFactory("MET", next.metrics.map((m) => m.id));
  const unit = metricDef(original.metricKey)?.unit ?? original.unit;
  const when = asOf.toISOString();

  const corrected: MetricInstance = {
    ...structuredClone(original),
    id: metId(),
    rawValue: `${corr.value} ${unit} (analyst correction)`,
    normalizedValue: corr.value,
    unit,
    currency: unit === "USD" ? "USD" : original.currency,
    state: "OBSERVED",
    calculationMethod: "USER_CORRECTED",
    derivation: null,
    isPrimary: false,
    qualityFlags: [...original.qualityFlags.filter((f) => !f.startsWith("EXTRACTION") && !f.startsWith("VALUE_FROM_RAW") && !f.startsWith("FRACTION_CONVERTED")), `USER_CORRECTED: was ${original.rawValue}`],
    notes: `Corrected by ${corr.actor} on ${when.slice(0, 10)} (replaces ${original.id}, was ${original.rawValue}). ${corr.note}`.trim(),
  };

  const kept = next.metrics.filter(
    (m) =>
      m.calculationMethod !== "DERIVED" &&
      // A newer correction of the same metric and period supersedes an older one.
      !(m.calculationMethod === "USER_CORRECTED" && m.metricKey === original.metricKey && m.periodEnd === original.periodEnd && m.id !== original.id),
  );
  // If the analyst corrects an existing correction, the corrected one is replaced outright.
  const base = original.calculationMethod === "USER_CORRECTED" ? kept.filter((m) => m.id !== original.id) : kept;
  next.metrics = deriveMetrics([...base, corrected], metId);

  const claim = original.claimId ? next.claims.find((x) => x.id === original.claimId) : undefined;
  if (claim) claim.history.push({ at: when, change: "CORRECTED", note: `${original.id} ${original.rawValue} → ${corr.value} ${unit} by ${corr.actor}${corr.note ? `: ${corr.note}` : ""}` });

  return { deal: next, corrected: next.metrics.find((m) => m.id === corrected.id)!, previous: original };
}

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
