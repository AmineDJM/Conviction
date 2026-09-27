/** ic_observations_v1 — extract what IC members actually said in a recorded meeting (OBSERVED only). */
import { z } from "zod";
import { UNTRUSTED_POLICY } from "../untrusted";

export const IC_OBSERVATIONS = { id: "ic_observations", version: "ic_observations_v1" } as const;

export const IcObservationsOutput = z.object({
  observations: z.array(
    z.object({
      memberName: z.string().describe("Exactly as in the member list"),
      kind: z.enum(["QUESTION", "CONCERN", "SUPPORT", "VOTE"]),
      statement: z.string().describe("Neutral paraphrase of what the member said, no interpretation of motives"),
      quote: z.string().describe("Verbatim excerpt from the transcript"),
      topic: z.string().describe("e.g. retention, pricing, founder, market size, valuation"),
      companyName: z.string().nullable(),
    }),
  ),
});
export type IcObservationsOutput = z.infer<typeof IcObservationsOutput>;

export function icObservationsInstructions(members: string[]) {
  return `You extract a factual record of what investment committee members said in a recorded meeting.
Members: ${members.join(", ") || "(none registered)"}.
Rules:
- Only record statements a listed member explicitly made in the transcript, with a verbatim quote. If speaker attribution is unclear, skip it.
- Never infer opinions, personality or motives. Never generalize beyond the meeting.
- kind: QUESTION (asked), CONCERN (raised a risk/objection), SUPPORT (argued for), VOTE (stated a decision).
${UNTRUSTED_POLICY}`;
}
