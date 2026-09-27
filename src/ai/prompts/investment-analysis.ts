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

export const INVESTMENT_ANALYSIS = { id: "investment_analysis", version: "investment_analysis_v3" } as const;

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
 * v3: the analysis runs as five parallel parts so no single call is the latency
 * bottleneck (output tokens are the wall-clock driver). Each part owns its
 * sections and exactly its rubric criteria; code merges them.
 */
export const ANALYSIS_PARTS = {
  A1: {
    sections: ["founders", "pain", "pmf"],
    rubric: ["FOUNDER_MARKET_FIT", "EXECUTION_EVIDENCE", "TEAM_COMPLETENESS", "PAIN_SEVERITY", "PMF_SIGNAL_QUALITY"],
    others: "product, customers, GTM, market, competition, moat, financing, risks and exits",
  },
  A2: {
    sections: ["product", "customers", "gtm", "economicsNotes"],
    rubric: ["VALUE_QUANTIFIED", "PRODUCT_DIFFERENTIATION", "ICP_CLARITY", "SALES_MOTION_FIT", "CHANNEL_SCALABILITY", "PRICING_POWER"],
    others: "founders, pain, PMF, market, competition, moat, financing, risks and exits",
  },
  B1: {
    sections: ["market"],
    rubric: ["VALUE_CAPTURE", "MARKET_GROWTH"],
    others: "founders, product, customers, PMF, GTM, competition, moat, financing, risks and exits",
  },
  B3: {
    sections: ["competition", "moat"],
    rubric: ["WEDGE_QUALITY", "MOAT_CURRENT", "MOAT_TRAJECTORY"],
    others: "founders, product, customers, PMF, GTM, market, financing, risks and exits",
  },
  B2: {
    sections: ["financingPath", "risks", "exitAssumptions", "arpaAssumptionUsd"],
    rubric: ["TIMING_CATALYST", "INFLECTION_EVIDENCE"],
    others: "founders, product, customers, PMF, GTM, market, competition and moat",
  },
} as const satisfies Record<string, { sections: readonly (keyof InvestmentAnalysisOutput)[]; rubric: readonly (typeof RUBRIC_CRITERIA)[number][]; others: string }>;
export type AnalysisPartId = keyof typeof ANALYSIS_PARTS;

export const AnalysisPartSchemas = {
  A1: InvestmentAnalysisOutput.pick({ founders: true, pain: true, pmf: true, rubric: true }),
  A2: InvestmentAnalysisOutput.pick({ product: true, customers: true, gtm: true, economicsNotes: true, rubric: true }),
  B1: InvestmentAnalysisOutput.pick({ market: true, rubric: true }),
  B3: InvestmentAnalysisOutput.pick({ competition: true, moat: true, rubric: true }),
  B2: InvestmentAnalysisOutput.pick({ financingPath: true, risks: true, exitAssumptions: true, arpaAssumptionUsd: true, rubric: true }),
};

export function analysisPartInstructions(part: AnalysisPartId) {
  const p = ANALYSIS_PARTS[part];
  const extra = part === "B2" ? " Risks must cover ALL risk categories visible in the record (team, product, GTM, market, competition, financing, regulatory), not only this part's sections." : "";
  return `${investmentAnalysisInstructions()}

THIS CALL — PART ${part} ONLY: ${p.sections.join(", ")}, and the rubric for exactly these criteria: ${p.rubric.join(", ")}.${extra} Other analysts cover ${p.others} in parallel — do not produce them.`;
}
