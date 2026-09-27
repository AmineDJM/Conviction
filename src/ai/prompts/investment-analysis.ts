/** investment_analysis_v1 — steps 9–16 interpretation: founders, product, pain, PMF, market, competition, moat, GTM, economics, financing, risks. */
import { z } from "zod";
import {
  CompetitionSection,
  CustomersSection,
  ExitAssumption,
  FinancingPathAnalysis,
  FounderAnalysis,
  GtmSection,
  MarketSection,
  MoatItem,
  PainSection,
  PmfSection,
  ProductSection,
  RiskItem,
  RubricAssessment,
  RUBRIC_CRITERIA,
} from "@/domain/sections";
import { ANALYST_STANDARD, today } from "./common";

export const INVESTMENT_ANALYSIS = { id: "investment_analysis", version: "investment_analysis_v2" } as const;

export const InvestmentAnalysisOutput = z.object({
  founders: z.array(FounderAnalysis),
  product: ProductSection,
  pain: PainSection,
  customers: CustomersSection,
  pmf: PmfSection,
  market: MarketSection,
  competition: CompetitionSection,
  moat: z.array(MoatItem),
  gtm: GtmSection,
  economicsNotes: z.string(),
  financingPath: FinancingPathAnalysis,
  risks: z.array(RiskItem),
  rubric: z.array(RubricAssessment),
  exitAssumptions: z.array(ExitAssumption).describe("Exactly one per scenario: FAILURE, LOW, BASE, BULL, OUTLIER"),
  arpaAssumptionUsd: z.number().nullable().describe("Annual revenue per customer assumption for backwards analysis if no ACV is disclosed"),
});
export type InvestmentAnalysisOutput = z.infer<typeof InvestmentAnalysisOutput>;

export function investmentAnalysisInstructions() {
  return `${ANALYST_STANDARD}

TASK: Produce the core investment analysis for the company described in the canonical record (structured facts, claims with ids, research findings with ids). Today is ${today()}. Cite claim ids (CLM-…) and source ids (SRC-…) in claimRefs/sourceRefs.

FOUNDERS — capability-based, not pedigree. For each founder rate the relevant capabilities (learning velocity, execution, judgment, customer understanding, recruiting, technical, commercial, communication/intellectual honesty, cofounder dynamics). Mark relevant=false where a capability does not matter for the role. observability: OBSERVABLE (direct evidence), INFERRED (indirect), NOT_OBSERVABLE (needs interview/reference) → then rating INSUFFICIENT_EVIDENCE. Never infer personality from thin evidence.

PRODUCT — explain to an intelligent non-specialist. Before/after workflow as short steps. Quantified value only with baseline, period, source, method; otherwise evidenceStatus=UNSUPPORTED.

PAIN — choose the demand type honestly (HAIR_ON_FIRE, HARD_FACT, FUTURE_VISION, CONSUMER_DESIRE). Do not force enterprise pain frameworks onto consumer products.

PMF — never infer PMF from revenue growth alone. Look at pilot→production, time to value, usage after onboarding, renewals, expansion, cohorts (prefer customers >12 months old), churn, discounting, implementation dependency, references (company-selected vs independent), lost customers, organic demand, concentration.

MARKET — do NOT accept the deck TAM. Always provide a bottomUp reconstruction when a customer count and a spend level can be reasoned about (it is the primary method); then valueCapture and topDown. All market figures are TOTAL annual amounts across the whole customer set, never per customer (economicValueCreated = total value created per year across all target customers). Reconstruct: bottomUp (realistic customer count range × realistic annual spend range, with definitions), valueCapture (economic value created × realistic capture share) and topDown (independent estimates from research, with scope) when available. Ranges, not point estimates. Keep current market separate from expansion markets (with adjacency analysis). Answer: even if enormous value is created, how much can this company capture?

COMPETITION — direct, indirect, incumbents, internal build, do-nothing, emerging entrants. Comparison rows only where analytically useful. Run the adversarial tests: INCUMBENT_COPY (largest competitor bundles the key feature free), COST_COMMODITIZATION (e.g. inference 10× cheaper), DISTRIBUTION (weaker tech, 20× distribution).

MOAT — time-dependent: current strength, expected in 3 years, what must happen. Proprietary software alone is not a moat.

GTM — user, buyer, economic buyer, ICP, motion, channels, cycle. Interpret founder-led sales relative to stage.

FINANCING PATH — what specific proof this round's capital buys, months to reach it, planned burn if inferable, next-round conditions, fallback plans; could it die while directionally right?

RISKS — each with category, severity, likelihood (LOW/MODERATE/HIGH/CRITICAL), timing, mitigation, evidence, and weaknessClass: REPAIRABLE (give resources, time, difficulty), STRUCTURAL, or THESIS_KILLING (the exact condition that destroys the thesis).

RUBRIC — rate every criterion: ${RUBRIC_CRITERIA.join(", ")}. Scale WEAK / BELOW_BAR / ADEQUATE / STRONG / EXCEPTIONAL; use INSUFFICIENT_EVIDENCE rather than guessing. Ratings must be justified by cited evidence. Deck assertions alone rarely justify STRONG.

EXIT ASSUMPTIONS — one per scenario (FAILURE, LOW, BASE, BULL, OUTLIER): exit revenue and revenue multiple grounded in the business model and comparable outcomes, years to exit, rationale. FAILURE may use nulls. These are assumptions; code computes returns.`;
}

/**
 * v2: the analysis runs as two parallel parts to halve wall-clock latency.
 * Part A — people, product, customers, traction, GTM. Part B — market, competition,
 * moat, financing, risks, exits. Rubric criteria are split accordingly.
 */
export const RUBRIC_PART_A = [
  "FOUNDER_MARKET_FIT",
  "EXECUTION_EVIDENCE",
  "TEAM_COMPLETENESS",
  "PAIN_SEVERITY",
  "VALUE_QUANTIFIED",
  "PRODUCT_DIFFERENTIATION",
  "PMF_SIGNAL_QUALITY",
  "ICP_CLARITY",
  "SALES_MOTION_FIT",
  "CHANNEL_SCALABILITY",
  "PRICING_POWER",
] as const;
export const RUBRIC_PART_B = RUBRIC_CRITERIA.filter((c) => !(RUBRIC_PART_A as readonly string[]).includes(c));

export const AnalysisPartA = InvestmentAnalysisOutput.pick({ founders: true, product: true, pain: true, customers: true, pmf: true, gtm: true, economicsNotes: true, rubric: true });
export const AnalysisPartB = InvestmentAnalysisOutput.pick({ market: true, competition: true, moat: true, financingPath: true, risks: true, rubric: true, exitAssumptions: true, arpaAssumptionUsd: true });

export function analysisPartInstructions(part: "A" | "B") {
  const scope =
    part === "A"
      ? `THIS CALL — PART A ONLY: founders, product, pain, customers, PMF, GTM, economics notes, and the rubric for exactly these criteria: ${RUBRIC_PART_A.join(", ")}. Another analyst covers market, competition, moat, financing, risks and exits in parallel.`
      : `THIS CALL — PART B ONLY: market reconstruction, competition, moat, financing path, risks (covering ALL risk categories including team, product and GTM risks visible in the record), exit assumptions, ARPA assumption, and the rubric for exactly these criteria: ${RUBRIC_PART_B.join(", ")}. Another analyst covers founders, product, customers, PMF and GTM in parallel.`;
  return `${investmentAnalysisInstructions()}\n\n${scope}`;
}
