/**
 * pre_meeting_brief_v1 — the only model step of the PRE_MEETING_BRIEF.
 *
 * Everything else in the brief is rendered by code from the canonical object and
 * the derived analysis. This small call (effort "low") only phrases (1) explicit
 * meeting objectives and (2) a one-line "what we already know" per question, from
 * facts the record already holds. It adds no facts; code validates ids and falls
 * back to deterministic text for anything missing.
 */
import { z } from "zod";
import { ANALYST_STANDARD } from "./common";

export const PRE_MEETING_BRIEF_PROMPT = { id: "pre_meeting_brief", version: "pre_meeting_brief_v1" } as const;

export const PreMeetingBriefOutput = z.object({
  objectives: z
    .array(
      z.object({
        objective: z.string().describe("Starts with a verb: 'Determine whether enterprise sales can scale without the CEO'. ≤ 18 words."),
        why: z.string().describe("Which thesis condition, risk or determinant it tests. ≤ 25 words."),
        refs: z.array(z.string()).describe("Ids from the record (Q-, GAP-, RSK-, CLM-, MET-) it rests on"),
      }),
    )
    .describe("3–4 meeting objectives, most decisive first"),
  questions: z.array(
    z.object({
      questionId: z.string(),
      alreadyKnow: z.string().describe("What we already know, one or two short sentences, with the evidence status (company-reported, verified, unknown). Only facts present in the record."),
    }),
  ),
});
export type PreMeetingBriefOutput = z.infer<typeof PreMeetingBriefOutput>;

export function preMeetingBriefInstructions() {
  return `${ANALYST_STANDARD}

TASK: Prepare the partner for a founder meeting. The deal record (thesis, decisive unknowns, thesis-killing risks, sensitivity drivers, the highest-value questions and what the record says about each) is provided as data.
1. objectives: 3–4 explicit meeting objectives — what the meeting must establish for the investment decision. Each is a determination, not a topic ("Determine whether enterprise sales can scale without the CEO", not "Discuss sales"). Tie each to the record by ids.
2. questions: for EVERY question id provided, rewrite "what we already know" as a crisp one- or two-sentence statement using only facts in the record, naming the evidence status (company-reported / verified / contradicted / unknown). Do not add facts, numbers or opinions that are not in the record.`;
}
