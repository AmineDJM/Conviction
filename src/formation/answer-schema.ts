/** Validation of submitted answers against the exercise's input spec (pure). */
import { z } from "zod";
import { DECISION_BUCKETS, FORENSIC_CATEGORIES, type Answer, type Exercise } from "./types";

const text = (max: number) => z.string().max(max);

export const AnswerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("choice"), optionId: z.string().min(1).max(8), justification: text(2000).optional() }),
  z.object({ type: z.literal("numeric"), value: z.string().min(1).max(40) }),
  z.object({ type: z.literal("statements"), flags: z.array(z.object({ statementId: z.string().max(8), category: z.enum(FORENSIC_CATEGORIES) })).max(12) }),
  z.object({ type: z.literal("multi"), optionIds: z.array(z.string().max(8)).max(12) }),
  z.object({ type: z.literal("questions"), questions: z.array(text(600)).min(1).max(3) }),
  z.object({ type: z.literal("decision"), decision: z.enum(DECISION_BUCKETS), justification: text(4000) }),
  z.object({ type: z.literal("bullbear"), bull: text(3000), bear: text(3000) }),
  z.object({ type: z.literal("outlier"), exceptional: z.boolean(), signalIds: z.array(z.string().max(8)).max(8), justification: text(4000) }),
  z.object({ type: z.literal("text"), text: text(4000) }),
]);

export const SubmitSchema = z.object({
  exerciseId: z.string().regex(/^fx_[a-z0-9]+$/),
  companyId: z.string().min(1).max(64),
  versionId: z.string().min(1).max(64),
  answer: AnswerSchema,
  confidence: z.number().min(0).max(1),
});
export type SubmitInput = z.infer<typeof SubmitSchema>;

/** Checks that the answer fits the exercise (right type, known ids, minimum content). Returns an error message or null. */
export function checkAnswer(ex: Exercise, a: Answer): string | null {
  const i = ex.input;
  const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
  switch (i.type) {
    case "choice":
      if (a.type !== "choice") return "Expected a choice.";
      return i.options.some((o) => o.id === a.optionId) ? null : "Unknown option.";
    case "numeric":
      return a.type === "numeric" ? null : "Expected a number.";
    case "statements": {
      if (a.type !== "statements") return "Expected flagged statements.";
      const ids = new Set(i.statements.map((s) => s.id));
      if (a.flags.some((f) => !ids.has(f.statementId))) return "Unknown statement.";
      return new Set(a.flags.map((f) => f.statementId)).size === a.flags.length ? null : "A statement is flagged twice.";
    }
    case "multi": {
      if (a.type !== "multi") return "Expected a selection.";
      const ids = new Set(i.options.map((o) => o.id));
      if (a.optionIds.some((x) => !ids.has(x))) return "Unknown option.";
      return a.optionIds.length >= i.minPicks ? null : `Select at least ${i.minPicks}.`;
    }
    case "questions":
      if (a.type !== "questions") return "Expected questions.";
      return a.questions.filter((q) => q.trim()).length === i.count ? null : `Write ${i.count} questions.`;
    case "decision":
      if (a.type !== "decision") return "Expected a decision.";
      return words(a.justification) >= 8 ? null : "Justify the decision (at least a sentence).";
    case "bullbear":
      if (a.type !== "bullbear") return "Expected a bull and a bear case.";
      return words(a.bull) >= 8 && words(a.bear) >= 8 ? null : "Write both cases (at least a sentence each).";
    case "outlier": {
      if (a.type !== "outlier") return "Expected an outlier answer.";
      const ids = new Set(i.signals.map((o) => o.id));
      if (a.signalIds.some((x) => !ids.has(x))) return "Unknown signal.";
      return words(a.justification) >= 8 ? null : "Explain your call (at least a sentence).";
    }
    case "text":
      if (a.type !== "text") return "Expected text.";
      return words(a.text) >= Math.min(12, i.minWords) ? null : "Write a fuller answer.";
  }
}
