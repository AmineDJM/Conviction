/**
 * founder_call_update_v3 — §65: update the canonical object from a founder meeting without restarting the analysis.
 *
 * v3 (meetings workflow): every item cites transcript turns ("T-12"); claim updates gain
 * CLARIFIED (same fact, better defined); targeted re-evaluation of what a meeting can
 * legitimately move — rubric ratings, founder capabilities, thesis conditions, risks —
 * plus the post-meeting brief extraction (discussed, contradictions, metric
 * clarifications, next action). Code decides what founder statements alone may change.
 */
import { z } from "zod";
import { ClaimCategory, Level, RiskCategory, RubricRating, WeaknessClass, ConditionStatus } from "@/domain/enums";
import { MetricObservation, NextBestAction, RecommendationDraft, RUBRIC_CRITERIA, FOUNDER_CAPABILITIES } from "@/domain/sections";
import { ANALYST_STANDARD, today } from "./common";

export const FOUNDER_CALL_UPDATE = { id: "founder_call_update", version: "founder_call_update_v3" } as const;

const Refs = z.array(z.string()).describe("Transcript turn refs, e.g. [\"T-12\"]. Only refs that appear in the transcript.");

export const FounderCallOutput = z.object({
  discussed: z.array(z.object({ topic: z.string().describe("2–5 words"), summary: z.string().describe("One sentence"), transcriptRefs: Refs })).describe("What was discussed, very concise, at most 8 topics"),
  questionUpdates: z.array(
    z.object({
      questionId: z.string(),
      status: z.enum(["RESOLVED", "NOT_FULLY_RESOLVED", "OPEN"]),
      answerSummary: z.string(),
      transcriptExcerpt: z.string(),
      transcriptRefs: Refs,
      implication: z.string(),
    }),
  ),
  claimUpdates: z.array(
    z.object({
      claimId: z.string(),
      change: z.enum(["CONFIRMED", "CLARIFIED", "CHANGED", "CONTRADICTED", "UNRESOLVED"]),
      before: z.string().describe("What the record said before the meeting (deck/research), short"),
      founderSaid: z.string().describe("What the founder said, short, factual"),
      note: z.string().describe("Why this classification; for CLARIFIED, what the definition/scope now is and what it implies"),
      transcriptExcerpt: z.string(),
      transcriptRefs: Refs,
    }),
  ),
  metricClarifications: z
    .array(
      z.object({
        metricId: z.string(),
        deckValue: z.string(),
        clarifiedDefinition: z.string().describe("e.g. 'excludes founder time and sales engineering'"),
        implication: z.string(),
        transcriptExcerpt: z.string(),
        transcriptRefs: Refs,
      }),
    )
    .describe("Existing metrics whose definition, scope or period the founder made more precise, without stating a conflicting value"),
  newClaims: z.array(
    z.object({
      category: ClaimCategory,
      statement: z.string(),
      valueText: z.string().nullable(),
      excerpt: z.string(),
      transcriptRefs: Refs,
      material: z.boolean(),
    }),
  ).describe("Facts NOT already in the deck or research"),
  newMetrics: z.array(MetricObservation).describe("Numbers stated in the meeting (page = null, excerpt verbatim from the transcript)"),
  contradictions: z
    .array(
      z.object({
        statement: z.string().describe("What the founder said"),
        conflictsWith: z.enum(["DECK", "PRIOR_FOUNDER_STATEMENT", "EXTERNAL_EVIDENCE", "EXISTING_METRIC", "WITHIN_MEETING"]),
        targetId: z.string().nullable().describe("Claim, metric or source id it conflicts with, if any"),
        priorStatement: z.string(),
        material: z.boolean(),
        transcriptExcerpt: z.string(),
        transcriptRefs: Refs,
      }),
    )
    .describe("Every contradiction, including those also reported as CONTRADICTED claim updates"),
  gapUpdates: z.array(z.object({ gapId: z.string(), status: z.enum(["RESOLVED", "NEEDS_FOUNDER", "OPEN"]), note: z.string(), transcriptRefs: Refs })),
  rubricUpdates: z
    .array(
      z.object({
        criterion: z.enum(RUBRIC_CRITERIA),
        rating: RubricRating,
        founderSaid: z.string(),
        reason: z.string().describe("Why the meeting evidence moves this rating (or not)"),
        transcriptRefs: Refs,
      }),
    )
    .describe("Only criteria the meeting gives real evidence on; omit the rest"),
  capabilityUpdates: z
    .array(
      z.object({
        founderName: z.string(),
        dimension: z.enum(FOUNDER_CAPABILITIES),
        rating: RubricRating,
        founderSaid: z.string().describe("What was said or observed in the meeting"),
        reason: z.string(),
        transcriptRefs: Refs,
      }),
    )
    .describe("Founder capabilities observable in the meeting (judgment, communication and intellectual honesty, customer understanding, learning velocity, co-founder dynamics…)"),
  conditionUpdates: z
    .array(z.object({ conditionIndex: z.number().int(), status: ConditionStatus, founderSaid: z.string(), reason: z.string(), transcriptRefs: Refs }))
    .describe("Thesis required conditions (by index in the record) the meeting bears on"),
  riskUpdates: z
    .array(
      z.object({
        riskId: z.string().nullable().describe("Existing RSK id, or null for a new risk revealed in the meeting"),
        title: z.string(),
        category: RiskCategory,
        severity: Level,
        likelihood: Level,
        weaknessClass: WeaknessClass,
        description: z.string(),
        founderSaid: z.string(),
        reason: z.string(),
        transcriptRefs: Refs,
      }),
    )
    .describe("Risks the meeting raised, sharpened or reduced"),
  recommendation: RecommendationDraft.describe("Updated suggested status after this meeting; code gates decide admissibility"),
  nextAction: NextBestAction.describe("ONE explicit next action, e.g. 'Call two customers from the 2024 cohort to verify expansion'"),
  summary: z.string().describe("What changed in the investment view, 3–5 sentences"),
});
export type FounderCallOutput = z.infer<typeof FounderCallOutput>;

export function founderCallInstructions() {
  return `${ANALYST_STANDARD}

TASK: A founder meeting transcript is provided (each turn prefixed with its ref, timestamp and speaker label) together with the current deal record: open questions, open gaps, the claim ledger, primary metrics, rubric ratings, founder capability ratings, thesis conditions, risks, the recommendation and the pre-meeting objectives. Today is ${today()}. Update — do not restart — the analysis.

Citations: every item carries transcriptRefs (the "T-n" refs of the turns that support it) and, where asked, a VERBATIM excerpt copied from the transcript. Never cite a turn that does not exist. Speaker labels may be raw diarization labels (A, B…); infer who is the founder only from the content, and do not attribute a statement to a named person unless the transcript makes it explicit.

Classification:
- Questions: RESOLVED (clear, specific answer), NOT_FULLY_RESOLVED (partial, vague or deferred), OPEN (not discussed). Never use psychological labels ("dodged", "evasive"); describe what was and was not answered.
- Existing claims touched by the meeting: CONFIRMED (founder supported it with additional detail), CLARIFIED (same fact, better defined — definition, scope, period, cohort; e.g. deck "CAC = $18k" → founder "$18k excludes founder time and sales engineering"), CHANGED (a different value now), CONTRADICTED (founder statement conflicts with the claim), UNRESOLVED (discussed without resolution). Founder statements remain company-reported claims — confirmation by the founder is NOT verification.
- metricClarifications: the same for existing metrics (by MET id).
- newClaims / newMetrics: only facts not already in the record.
- contradictions: against the deck, earlier founder statements, external evidence, existing metrics, or within the meeting — with the id of what it conflicts with.
- Gaps: RESOLVED only when answered specifically; NEEDS_FOUNDER when documents or data were promised.

Re-evaluate ONLY what the meeting evidence can legitimately change:
- rubricUpdates, capabilityUpdates, conditionUpdates, riskUpdates: include an item only when the meeting provides specific evidence; give the rating you now hold, what the founder said and why. A founder's own description of strength is weak evidence; concrete specifics, numbers and candid admissions are stronger. Observed behaviour in the meeting (precision, candour, command of numbers) is evidence about capabilities.
- Do not raise a rating merely because a question was answered. Lower it when the answer reveals a weakness.
- Suggest the updated status. After a meeting, NEEDS_FOUNDER_CALL is only appropriate if decisive questions were not covered; typical next steps are NEEDS_TARGETED_DILIGENCE (verify what was said: data room, references), DEEP_DD, WATCH (with trigger) or ANALYTICAL_RECOMMEND_PASS.
- nextAction: ONE explicit, specific action.
- Summarize what changed in the investment view.`;
}
