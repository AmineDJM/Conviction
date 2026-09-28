/**
 * decision_thesis_v1 (C1) and decision_actions_v1 (C2) — the partner layer,
 * run in parallel with the analysis parts A/B on the same record plus the
 * deterministic results already available (integrity report, scores, returns).
 */
import { z } from "zod";
import {
  AlternativeExplanation,
  CausalModel,
  ExceptionalStrength,
  FalsificationItem,
  FounderQuestionDraft,
  NextBestAction,
  NonlinearSection,
  PerfectSlide,
  RecommendationDraft,
  RedTeamSection,
  RevealedInsight,
  DecisionCore,
  SensitivityDriver,
  ThesisSection,
} from "@/domain/sections";
import { RubricRating } from "@/domain/enums";
import { ANALYST_STANDARD, today } from "./common";

export const DECISION_THESIS = { id: "decision_thesis", version: "decision_thesis_v5" } as const;
export const DECISION_CORE = { id: "decision_core", version: "decision_core_v1" } as const;
export const DECISION_CHALLENGE = { id: "decision_challenge", version: "decision_challenge_v2" } as const;
export const DECISION_ACTIONS = { id: "decision_actions", version: "decision_actions_v2" } as const;

/** The decision core: the compression of the bet, its exceptional strength and power-law ratings (one mind, so they stay consistent). */
export const DecisionCoreOutput = z.object({
  realityCheck: z.string().describe("Ignoring the founder's narrative, what company is actually in front of us? One sentence."),
  executiveSummary: z.string().describe("4–6 sentences: what it is, the bet, the evidence, the main risk. Do NOT state a recommendation."),
  decisionCore: DecisionCore,
  exceptionalStrengths: z.array(ExceptionalStrength),
  powerLawRatings: z.object({ nonlinearMechanism: RubricRating, exceptionalStrength: RubricRating }),
});
export type DecisionCoreOutput = z.infer<typeof DecisionCoreOutput>;

/** The thesis body and its falsification — written in parallel from the same record and the same code-ranked focus. */
export const ThesisBodyOutput = z.object({
  nonlinear: NonlinearSection,
  thesis: ThesisSection,
  falsification: z.array(FalsificationItem),
  whatILike: z.array(z.string()).describe("Max 3, one line each, with a number or fact"),
  whatWorriesMe: z.array(z.string()).describe("Max 3, one line each, with a number or fact"),
});
export type ThesisBodyOutput = z.infer<typeof ThesisBodyOutput>;

/** The merged bet (what assembly consumes). */
export const ThesisCoreOutput = DecisionCoreOutput.extend(ThesisBodyOutput.shape);
export type ThesisCoreOutput = z.infer<typeof ThesisCoreOutput>;

/** The independent challenge — run by a different "analyst" in parallel, deliberately without seeing the bet. */
export const ChallengeOutput = z.object({
  revealedBeyondPitch: z
    .array(RevealedInsight)
    .describe("WHAT THE DECK REVEALS BEYOND THE PITCH — 3–5 insights drawn from metric choices, omissions, definitions, inconsistencies and latent signals"),
  redTeam: RedTeamSection,
  alternativeExplanations: z.array(AlternativeExplanation).describe("For each major positive signal, a plausible non-bullish explanation and the test that separates them"),
});
export type ChallengeOutput = z.infer<typeof ChallengeOutput>;

export const ThesisOutput = ThesisCoreOutput.extend(ChallengeOutput.shape);
export type ThesisOutput = z.infer<typeof ThesisOutput>;

/** The machine and its fragility. */
export const MachineOutput = z.object({
  causalModel: CausalModel,
  sensitivityDrivers: z.array(SensitivityDriver).describe("The 3–5 variables the thesis is genuinely sensitive to"),
  perfectSlides: z.array(PerfectSlide).describe("For the 3–6 most decision-relevant missing or weak pieces of evidence"),
});
/** The next proof: questions, next action, suggested status. */
export const NextProofOutput = z.object({
  questions: z.array(FounderQuestionDraft).describe("5–8 questions that pass the decision test"),
  nextBestAction: NextBestAction,
  recommendation: RecommendationDraft,
});
export const ActionsOutput = MachineOutput.extend(NextProofOutput.shape);
export type ActionsOutput = z.infer<typeof ActionsOutput>;

const COMMON = (mode: string) => `${ANALYST_STANDARD}

You are the investment partner. Today is ${today()}. Analysis mode: ${mode}. The record includes extraction, research findings, deck forensics and DETERMINISTIC results computed by code (integrity findings, implied-metric contradictions, expected-evidence gaps, evidence debt, scores with coverage and bounds, returns, backwards analysis, financing map). Treat deterministic results as facts about the numbers; do not recompute them. Where integrity findings contradict the narrative, the findings win.`;

export function decisionCoreInstructions(mode: string) {
  return `${COMMON(mode)}

TASK — the decision core (a parallel analyst writes the thesis body and falsification from the same record and code-ranked focus; another runs the red team — do not produce them):
- REALITY CHECK: one sentence answering "Ignoring the founder's narrative, what company is actually in front of us?" (e.g. "An early enterprise AI company with impressive topline growth whose software economics still depend on founder-led sales and human operations.")
- DECISION CORE (the most important output). The deterministic block contains decisionFocus: the determinants ranked by code (Decision Leverage Index from distance to computed breakpoints, gates, materiality × unusualness and uncertainty), outlier candidates and a linked question. Start from that ranking; depart from it only with a stated reason — disagreements between your five and the code's are shown to the partner. compress everything to the bet, the exceptional strength, the breaking point and the return path (in numbers). Out of everything in the record, name exactly the 5 facts or unknowns that actually determine this investment (with status and refs), at most 2 signals that could reveal an outlier (rare variable: exceptional founder, unique distribution, technology far ahead, 20× cost reduction, new behaviour, exploding market — empty if none; never manufactured), the ONE question whose answer could reverse the decision, the asymmetric-conviction statement (what the market sees, which weaknesses are repairable, what is exceptional and hard to copy), and second-order answers (incumbent response if it works; AI 10× cheaper; does the moat grow or vanish with scale; does the company get stronger as it grows).
- EXCEPTIONAL STRENGTH: precise ("strong team"/"large market" rejected); evidence, why it matters, durability, what invalidates it, honest rating (INSUFFICIENT_EVIDENCE if only asserted). If nothing is exceptional, say so with a single WEAK item. It must be the same strength named in the decision core.
- POWER-LAW RATINGS on the anchored scale.
- DIVERGENCE FACTORS (deterministic.divergence: ten ordinal levels with the reason and the numbers): when you name the 5 determinants, the breaking point and the outlier signals, use the factors that make THIS company diverge from lookalikes (ambition ceiling, cap-table alignment, syndicate behaviour, survivability, market structure, dependencies, land→expand ceiling, focus, compounding loops, scalability); cite the factor and its level, and treat INSUFFICIENT_EVIDENCE factors as unknowns, never as strengths.`;
}

export function thesisInstructions(mode: string) {
  return `${COMMON(mode)}

TASK — the thesis and its falsification (a parallel analyst writes the reality check, decision core and exceptional strength; another runs the red team — do not produce them). Anchor on the code-ranked determinants in decisionFocus and the computed trajectory: your fatal weakness and return path must be about those variables unless you state why not.
- NONLINEAR: mechanism of disproportionate outcome, why the market may underestimate it, compounding assumptions, whether an outlier is economically plausible (use the backwards analysis).
- THESIS: the bet; required conditions with evidence and status; exactly 3 thesis points; exactly 3 failure modes; fatal weakness; the single fatal question; return path; next proof.
- FALSIFICATION: for each thesis point, what would prove it wrong and whether that evidence was searched/found.
- WHAT I LIKE / WHAT WORRIES ME: max 3 each, concrete.
- DIVERGENCE FACTORS (deterministic.divergence): use the factors that make THIS company diverge from lookalikes in the failure modes and required conditions; treat INSUFFICIENT_EVIDENCE factors as unknowns.`;
}

export function challengeInstructions(mode: string) {
  return `${COMMON(mode)}

TASK — the independent challenge. You are NOT the deal lead; another analyst writes the thesis in parallel. Your job is to see what the deck makes easy to miss.
- WHAT THE DECK REVEALS BEYOND THE PITCH: 3–5 insights a very good investor would draw from the presentation choices themselves — what the metrics chosen, the omissions, the definitions, the inconsistencies and the latent signals (provided) unintentionally reveal. E.g. "Sales scalability is probably the real bottleneck: every case study mentions founder involvement and no sales-productivity metric is provided." or positive: "Management appears unusually metrics-disciplined: every metric has period, cohort and definition; forecasts are separated from actuals." Each with the observable evidence and pages. Never judge honesty or personality.
- SYMMETRIC RED TEAM: the strongest case against investing AND the strongest case against passing; the pass-regret scenario.
- ALTERNATIVE EXPLANATIONS: for every major positive signal (growth, margin jump, logos, retention), the bullish reading, a plausible alternative (paid acquisition, one large customer, definition change, pilots…), and the discriminating test.
- DIVERGENCE FACTORS (deterministic.divergence): in the red team, name the factor(s) on which this company could fall behind apparently similar companies (e.g. a critical single dependency, fragmented focus, a services-heavy delivery model, a founder already over-diluted) and the one on which it could pull away — cite the factor, its level and the number behind it.`;
}

/** Two parallel parts: the machine (causal model, sensitivity, perfect slides) and the next proof (questions, action, status). */
export function actionsInstructions(mode: string, part: "MACHINE" | "NEXT_PROOF") {
  const items = part === "MACHINE" ? MACHINE_ITEMS : NEXT_PROOF_ITEMS;
  return `${COMMON(mode)}

TASK — ${part === "MACHINE" ? "the machine and its fragility (a parallel pass writes the founder questions, next action and suggested status)" : "the next proof (a parallel pass reconstructs the causal model, sensitivity drivers and perfect slides; the code's computed sensitivity breakpoints are in the deterministic block — prioritize by them)"}:
${items}`;
}

const MACHINE_ITEMS = `- CAUSAL BUSINESS MODEL: reconstruct Acquisition → Conversion → Activation → Usage → Retention → Expansion → Revenue → Gross profit → Cash → Reinvestment for THIS company with evidence per stage (health STRONG/ADEQUATE/WEAK/UNKNOWN), then name the single binding bottleneck with evidence (e.g. "Demand is not the problem: pipeline is sufficient. The bottleneck is pilot→production conversion at 21%").
- SENSITIVITY DRIVERS: the 3–5 variables the thesis is genuinely sensitive to, each with the current assumption and the value/condition at which the thesis breaks (use metric keys when quantitative; code computes exact breakpoints where it can).
- PERFECT SLIDES: for the most decision-relevant missing or weak evidence, describe exactly the slide you would want (rows, columns, periods, cohorts) — a diligence request, not a complaint.`;
const NEXT_PROOF_ITEMS = `- QUESTIONS: 5–8, each passing the decision test (answer A → what changes, answer B → what changes, what it affects). Prioritize by the sensitivity drivers and the integrity findings. MUST_ASK / IMPORTANT / OPTIONAL.
- NEXT BEST ACTION: specific, never "do more diligence".
- RECOMMENDATION: suggest a status (code gates decide admissibility). WATCH requires a concrete trigger, date and awaited information.\`;`;
