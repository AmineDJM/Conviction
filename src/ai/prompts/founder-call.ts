/** founder_call_update_v1 — §65: update the canonical object from a call transcript without restarting analysis. */
import { z } from "zod";
import { ClaimCategory } from "@/domain/enums";
import { MetricObservation } from "@/domain/sections";
import { ANALYST_STANDARD, today } from "./common";

export const FOUNDER_CALL_UPDATE = { id: "founder_call_update", version: "founder_call_update_v1" } as const;

export const FounderCallOutput = z.object({
  questionUpdates: z.array(
    z.object({
      questionId: z.string(),
      status: z.enum(["RESOLVED", "NOT_FULLY_RESOLVED", "OPEN"]),
      answerSummary: z.string(),
      transcriptExcerpt: z.string(),
      implication: z.string(),
    }),
  ),
  claimUpdates: z.array(
    z.object({
      claimId: z.string(),
      change: z.enum(["CONFIRMED", "CHANGED", "CONTRADICTED", "UNRESOLVED"]),
      note: z.string(),
      transcriptExcerpt: z.string(),
    }),
  ),
  newClaims: z.array(
    z.object({
      category: ClaimCategory,
      statement: z.string(),
      valueText: z.string().nullable(),
      excerpt: z.string(),
      material: z.boolean(),
    }),
  ),
  newMetrics: z.array(MetricObservation),
  summary: z.string().describe("What changed in the investment view, 3–5 sentences"),
});
export type FounderCallOutput = z.infer<typeof FounderCallOutput>;

export function founderCallInstructions() {
  return `${ANALYST_STANDARD}

TASK: A founder call transcript is provided with the current open questions and claim ledger. Today is ${today()}. Update — do not restart — the analysis:
- For each question: RESOLVED (clear, specific answer), NOT_FULLY_RESOLVED (partial, vague or deferred), OPEN (not discussed). Never use psychological labels ("dodged", "evasive"); describe what was and was not answered.
- For each existing claim touched by the call: CONFIRMED, CHANGED (new value), CONTRADICTED, or UNRESOLVED. Founder statements on a call are still company-origin claims.
- New material claims and new metrics stated on the call (page = null, excerpt verbatim from the transcript).
- Summarize what changed in the investment view.`;
}
