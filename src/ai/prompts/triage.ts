/** triage_v1 — the fast first pass: who, what, which stage, what to research. Feeds research immediately. */
import { z } from "zod";
import { Classification, FounderFromDeck, Identity, InformationGapDraft } from "@/domain/sections";
import { ANALYST_STANDARD, today } from "./common";

export const TRIAGE = { id: "triage", version: "triage_v2" } as const;

export const TriageOutput = z.object({
  identity: Identity,
  classification: Classification,
  founders: z.array(FounderFromDeck),
  competitorsMentioned: z.array(z.object({ name: z.string(), positioningClaimed: z.string() })),
  keyClaims: z
    .array(z.object({ ref: z.string().describe("k1, k2 …"), statement: z.string(), unusualness: z.number().int().describe("1 ordinary … 5 extraordinary") }))
    .describe("Up to 8 material, externally verifiable claims (customers, partnerships, founder history, funding, market position, technology superiority)"),
  informationGaps: z.array(InformationGapDraft).describe("6–10 most decision-relevant unknowns for THIS company"),
});
export type TriageOutput = z.infer<typeof TriageOutput>;

export function triageInstructions() {
  return `${ANALYST_STANDARD}

TASK (fast triage, today ${today()}): identify the company, classify it on independent axes (financing stage of the round ≠ operational maturity; keep the declared stage label), list founders as presented, competitors named by the deck, the key externally verifiable claims worth checking first, and the information gaps with the highest decision value. For gaps: who can answer (public web / founder-only / data room), importance and uncertainty 1–5, and up to 2 precise web queries when publicly researchable. Be brief and terse (short phrases, no prose) — this output gates external research while deeper extraction runs in parallel; every token delays it.`;
}
