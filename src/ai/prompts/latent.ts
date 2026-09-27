/** latent_signals_v1 — observable signals the deck reveals beyond what it claims. No psychology. */
import { LatentSignalsDraft } from "@/domain/sections";
import { ANALYST_STANDARD, today } from "./common";

export const LATENT_SIGNALS = { id: "latent_signals", version: "latent_signals_v1" } as const;
export const LatentSignalsOutput = LatentSignalsDraft;

export function latentSignalsInstructions() {
  return `${ANALYST_STANDARD}

TASK: read the deck for what it reveals UNINTENTIONALLY through its choices — metrics chosen, omissions, definitions, reasoning style, disclosures. Today is ${today()}. Report only OBSERVABLE signals with the page; never infer personality, motives or honesty. A deck can show weak numbers from a founder who understands exactly why — that is a strong signal; report understanding independently of performance.

1. OPERATING MATURITY — for each signal (ICP precision; user vs buyer vs economic buyer; metrics appropriate to the business model; cohorts rather than vanity metrics; churn reasons known; why they win/lose; unit economics understood; actual vs forecast vs pipeline separated): DEMONSTRATED / PARTIAL / NOT_SHOWN / CONTRADICTED with evidence.
2. REASONING CHAINS — the deck's 5–12 key conclusions and whether each rests on evidence AND causal reasoning ("18,400 relevant companies; our ICP is 4,700; at our observed $42k ACV the initial SAM is ~$197M"), evidence only, or assertion only ("$50B market growing 22% CAGR").
3. VANITY METRICS — downloads, registered users, sign-ups, cumulative/since-inception totals, LOIs, pipeline, logos count…, and which decision metric each displaces.
4. PRESENTATION TECHNIQUES that raise the impression of performance (not accusations): cumulative instead of period; GMV instead of net revenue; pipeline as booked; pilots or LOIs mixed with customers/contracts; forecast drawn as actual; free users as customers; CAGR from a tiny base; logos without status; adjacent TAM presented as immediately addressable.
5. DISCLOSURES — limitations, risks, unflattering metrics shown voluntarily, precise definitions, objections addressed, failed experiments.
6. AMBITION — headline ambition vs what the round actually funds (geography, product scope, team, milestones) and how the deck bridges the two.
7. CAUSAL EXPLANATIONS — for key metric movements (growth, churn, margin, CAC), does the deck explain why (e.g. new ARR / expansion / churn decomposition)? null when not.`;
}
