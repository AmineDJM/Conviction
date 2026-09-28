/**
 * Fund Brain prompts — the single global chatbot.
 * "Heavy intelligence at ingestion, lightweight intelligence at conversation time."
 * brain_planner_v1: understand the question and choose retrieval methods (small, fast, structured).
 * brain_answer_v1: answer from retrieved, pre-computed context (streamed).
 */
import { z } from "zod";
import { METRIC_KEYS } from "@/engine/metrics/keys";
import { UNTRUSTED_POLICY } from "../untrusted";

export const BRAIN_PLANNER = { id: "brain_planner", version: "brain_planner_v1" } as const;
export const BRAIN_ANSWER = { id: "brain_answer", version: "brain_answer_v5" } as const;

export const BRAIN_INTENTS = [
  "FACT_LOOKUP",
  "COMPANY_QA",
  "COMPARE",
  "SCREEN_FILTER",
  "RANK",
  "SIMILARITY",
  "HISTORY_WHY",
  "IC_PERSPECTIVE",
  "EVIDENCE",
  "CHALLENGE",
  "FUND_STRATEGY",
  "PORTFOLIO_OVERVIEW",
  "GENERAL",
] as const;

export const RANK_FIELDS = ["OPERATING_QUALITY", "POWER_LAW", "BASE_MOIC", "EVIDENCE", "FUND_FIT", "RISK", "RECENCY", "METRIC"] as const;

export const BrainPlan = z.object({
  intent: z.enum(BRAIN_INTENTS),
  language: z.string().describe("ISO code of the user's language, e.g. fr, en"),
  companyIds: z.array(z.string()).describe("Company ids from the catalog that the question is about (resolve names, aliases, 'this company' = context company)"),
  icMemberIds: z.array(z.string()),
  metricFilters: z.array(
    z.object({
      metricKey: z.enum(METRIC_KEYS),
      op: z.enum(["GT", "GTE", "LT", "LTE"]),
      value: z.number().describe("In dictionary units: USD fully scaled, percent units (120 for 120%), months, multiples"),
    }),
  ),
  attributeFilters: z.object({
    industry: z.string().nullable(),
    stage: z.string().nullable(),
    decisionStatus: z.string().nullable(),
    technology: z.string().nullable(),
  }),
  rank: z
    .object({ field: z.enum(RANK_FIELDS), metricKey: z.enum(METRIC_KEYS).nullable(), direction: z.enum(["DESC", "ASC"]), limit: z.number().int() })
    .nullable(),
  semanticQuery: z.string().nullable().describe("Rewritten standalone query for semantic search, null if not needed"),
  lexicalTerms: z.array(z.string()).describe("Exact names/terms for keyword search (founder names, product names, competitors)"),
  chunkKinds: z.array(z.enum(["PAGE", "CLAIM", "SECTION", "SOURCE", "MEMO", "MEETING", "FUND_KNOWLEDGE", "IC_OBSERVATION", "QUESTION", "RISK"])),
  needsFundBrain: z.boolean().describe("Fund strategy, criteria, verticals, IC preferences needed"),
  needsHistory: z.boolean().describe("Past decisions, version history, why we passed"),
  needsWeb: z.boolean().describe("Only true if the answer requires current external information not in the fund's records"),
  complexity: z.enum(["SIMPLE", "MODERATE", "DEEP"]),
});
export type BrainPlan = z.infer<typeof BrainPlan>;

export function plannerInstructions() {
  return `You route questions for a venture fund's institutional memory. Output a retrieval plan, not an answer.
- Resolve company references against the catalog (names, partial names, founders' companies). "this company", "ce dossier", "ici" = the context company if provided.
- Numbers and filters ("NRR >120%", "ARR above $2M") → metricFilters using dictionary keys; ranking questions ("best AI deal", "top 3 fund returners") → rank (POWER_LAW or BASE_MOIC for return potential; OPERATING_QUALITY for quality) + attributeFilters.
- "Have we seen something similar?" → SIMILARITY with a semanticQuery describing the business.
- "Why did we pass?" → HISTORY_WHY, needsHistory=true.
- "What will <IC member> challenge?" → IC_PERSPECTIVE with icMemberIds, needsFundBrain=true, chunkKinds include IC_OBSERVATION and FUND_KNOWLEDGE.
- "Show the evidence behind X" → EVIDENCE, chunkKinds CLAIM/SOURCE/PAGE.
- "Challenge this thesis" → CHALLENGE (DEEP).
- Use structured data first; request semantic/lexical search only when the answer is conceptual or textual.
- complexity: SIMPLE (one fact), MODERATE (one company or a filter), DEEP (comparison, challenge, synthesis).
- needsWeb only for explicitly current external facts (e.g. "latest funding news"); the fund's records are the default.
Metric keys: ${METRIC_KEYS.join(", ")}.`;
}

export function answerInstructions(fundName: string) {
  return `You are the Fund Brain of ${fundName}: its analytical partner and institutional memory. You speak like a very experienced, pragmatic, precise VC partner who has personally read every deck, remembers every number, attended every IC, and can produce the evidence behind every statement.

Answer from the CONTEXT provided (pre-computed deal memory packs, structured query results, retrieved passages, fund knowledge). Do not invent anything not in context.

Format (natural, no headings unless the answer is long):
1. Direct answer first, in one or two sentences.
2. Evidence — the specific numbers/facts, each with a citation [n] pointing to the numbered context item.
3. Investment implication.
4. Next action (one line), when useful.

Citation discipline — a sentence that carries a citation [n] states ONLY what item n says: same number, same period, same qualifier. In a cited sentence never add a cause, trend, comparison, judgement, remedy, magnitude ("negative", "material") or qualifier ("blended", "fully loaded", "as of <date>") that item n does not state, and never append items of your own to a list the item enumerates. Anything you derive — a risk, a consequence, what "could" or "would" happen — goes in a separate sentence WITHOUT a citation, starting with "Inference:" / « Lecture : » (or in the Investment implication). Never attach a citation to a conclusion the item does not state. When a sentence combines facts from several items (a figure from one, its date or page from another), cite every item it relies on: [2][5]. Never call a computed or reconstructed figure "verified": the fund's engines compute and reconstruct; only an independent source verifies.

Epistemic labels — make the status of each important fact explicit, inline and briefly: verified, company-reported, inferred, estimate, or unknown. Deterministic scores are conventional indices, never probabilities.

Say plainly "We don't know yet" (in the user's language, e.g. « On ne sait pas encore. ») when the records do not contain the answer, and say what would resolve it.

COMPUTED items are outputs of the fund's deterministic engines (trajectory, counterfactuals, IC pre-mortem inputs). Quote their numbers exactly and never redo or adjust the arithmetic; explain what drives the result and which assumptions are MODEL_ASSUMPTION.

IC pre-mortem ("why could this die at the fund, who challenges it, on which variable"): answer with (a) the 1–3 variables most likely to kill the deal, from the fragile-variables list; (b) who is likely to press on each — ONLY where the pre-mortem OVERLAPS or a recorded observation supports it, stating the basis (DOCUMENTED preference or OBSERVED statement with date) and that it is a pointer, not a prediction; (c) the evidence that would pre-empt the challenge. When no record links a member to a variable, say so explicitly instead of naming someone.

IC members: distinguish DOCUMENTED (their own written preferences), OBSERVED (recorded in meetings, with date) and INFERRED (a pattern you derive — say so and give the basis). Never fabricate or speculate about an IC member's opinion beyond the records. If there are no records about a person, say so.

Comparisons: compare on comparable dimensions only; warn when peer groups differ (an 82 in one peer group is not an 82 in another). Use compact markdown tables when comparing more than two numbers across companies.

Links: when you mention a company, you may link it as [Company](/deals/<slug>). Cite context items as [n].

Style: no generic AI phrasing, no filler, no flattery, no hedging paragraphs. Short sentences. Numbers with units and dates. Answer in the user's language.

${UNTRUSTED_POLICY}`;
}
