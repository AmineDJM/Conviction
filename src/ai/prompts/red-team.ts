/** red_team_v1 — steps 17–22 + 134: exceptional strength, nonlinear outcome, thesis, falsification, symmetric red team, questions, next best action. */
import { z } from "zod";
import {
  ExceptionalStrength,
  FalsificationItem,
  FounderQuestionDraft,
  NextBestAction,
  NonlinearSection,
  RecommendationDraft,
  RedTeamSection,
  ThesisSection,
} from "@/domain/sections";
import { RubricRating } from "@/domain/enums";
import { ANALYST_STANDARD, today } from "./common";

export const RED_TEAM = { id: "red_team", version: "red_team_v1" } as const;

export const RedTeamOutput = z.object({
  executiveSummary: z.string().describe("4–6 sentences: what it is, the bet, the evidence, the main risk, the view"),
  exceptionalStrengths: z.array(ExceptionalStrength),
  nonlinear: NonlinearSection,
  thesis: ThesisSection,
  falsification: z.array(FalsificationItem),
  redTeam: RedTeamSection,
  whatILike: z.array(z.string()).describe("Max 3, each one line with a number or fact"),
  whatWorriesMe: z.array(z.string()).describe("Max 3, each one line with a number or fact"),
  questions: z.array(FounderQuestionDraft).describe("5–8 questions that pass the decision test"),
  nextBestAction: NextBestAction,
  recommendation: RecommendationDraft,
  powerLawRatings: z.object({ nonlinearMechanism: RubricRating, exceptionalStrength: RubricRating }),
});
export type RedTeamOutput = z.infer<typeof RedTeamOutput>;

export function redTeamInstructions(mode: "FAST_SCREEN" | "STANDARD" | "DEEP_DD") {
  return `${ANALYST_STANDARD}

TASK: Act as the investment partner. Using the canonical record and the deterministic scores/returns computed by code, answer: What exactly are we betting on? What has to be true for an exceptional outcome? What evidence supports it, what is hypothetical, what could destroy it? Today is ${today()}. Analysis mode: ${mode}.

EXCEPTIONAL STRENGTH — "What is exceptional here?" must be precise. "Strong team" or "large market" are rejected. Candidates: founder insight, technical breakthrough, cost-curve change, proprietary distribution, regulatory access, network effect, unusually high retention, execution speed, category creation. For each: evidence, why it matters, durability, what would invalidate it, and an honest rating (INSUFFICIENT_EVIDENCE if only asserted). If nothing is exceptional, say so with a single WEAK item.

NONLINEAR — why could it become disproportionately large; the mechanism of nonlinear growth; why the market may underestimate it; which assumptions must compound; is an outlier economically plausible (use the backwards return analysis provided).

THESIS — the bet; required conditions each with current evidence and status (SUPPORTED / PARTIALLY_SUPPORTED / HYPOTHETICAL / CONTRADICTED); exactly 3 thesis points; exactly 3 things that could break it; fatal weakness; the single fatal question; return path; next proof.

FALSIFICATION — for each major thesis point: what would prove it wrong, and whether evidence of that was searched/found.

SYMMETRIC RED TEAM — case against investing AND case against passing ("If we pass and this becomes a $20B company, what did we fail to understand?"). Do not over-penalize unconventional outliers.

WHAT I LIKE / WHAT WORRIES ME — max 3 each, one line, concrete.

QUESTIONS — 5–8 founder questions. Each must pass the decision test: state answer A and what changes, answer B and what changes, and which of RECOMMENDATION / NEXT_DILIGENCE_STEP / VALUATION / RISK / RETURN it affects. Drop anything that changes nothing. Asking to verify a known metric is allowed when the definition matters (e.g. "Does the $19k CAC include founder selling time, sales engineering and channel commission?"). Tier: MUST_ASK / IMPORTANT / OPTIONAL.

NEXT BEST ACTION — specific ("Obtain 12-month logo and revenue retention cohorts for customers signed before Q3 2025"), never "do more diligence".

RECOMMENDATION — suggest one status: SCREEN_OUT, NEEDS_FOUNDER_CALL, NEEDS_TARGETED_DILIGENCE, DEEP_DD, IC_READY, ANALYTICAL_RECOMMEND_INVEST, WATCH, ANALYTICAL_RECOMMEND_PASS. Code gates will reject statuses the evidence cannot support. WATCH requires a concrete trigger, expected date and the information awaited.

POWER-LAW RATINGS — rate the nonlinear mechanism and the best exceptional strength on the anchored scale.`;
}
