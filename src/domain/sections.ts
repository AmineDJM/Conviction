/**
 * Section schemas of the canonical investment object.
 *
 * These are written so they can be used directly as OpenAI strict structured
 * output schemas: every field is required, "absent" is expressed as `null`,
 * no optional properties, no unions other than nullability. Ids and
 * deterministic fields are added by code in canonical.ts.
 */
import { z } from "zod";
import {
  AdversarialTest,
  AdversarialVerdict,
  ClaimCategory,
  CompetitorType,
  ConditionStatus,
  CustomerRelationship,
  DecisionStatus,
  DemandType,
  FalsifierStatus,
  FinancingStage,
  GtmMotion,
  Industry,
  Instrument,
  Level,
  MoatDimension,
  MoatStrength,
  Observability,
  OperationalMaturity,
  ProductType,
  QuestionEffect,
  QuestionTier,
  ReturnScenarioName,
  RevenueModel,
  RiskCategory,
  RiskTiming,
  RubricRating,
  Technology,
  WeaknessClass,
  EvidenceOrigin,
} from "./enums";
import { Money } from "./money";
import { METRIC_KEYS } from "../engine/metrics/keys";

/* ---------------------------------------------------------------- */
/* Identity & classification                                          */
/* ---------------------------------------------------------------- */

export const Identity = z.object({
  name: z.string(),
  legalName: z.string().nullable(),
  website: z.string().nullable(),
  hqCountry: z.string().nullable().describe("Country of headquarters, English name"),
  foundedYear: z.number().int().nullable(),
  oneLiner: z
    .string()
    .describe("One plain-language sentence a non-specialist understands. No jargon, no adjectives."),
});
export type Identity = z.infer<typeof Identity>;

export const Classification = z.object({
  industry: z.array(Industry),
  productType: z.array(ProductType),
  technology: z.array(Technology),
  revenueModel: z.array(RevenueModel),
  gtm: z.array(GtmMotion),
  operationalMaturity: OperationalMaturity,
  financingStage: FinancingStage.describe("Stage of the round being raised now"),
  declaredStage: z.string().nullable().describe("Stage label exactly as the company declares it"),
  rationale: z.string(),
});
export type Classification = z.infer<typeof Classification>;

/* ---------------------------------------------------------------- */
/* Metric observations (raw, as extracted)                            */
/* ---------------------------------------------------------------- */

export const METRIC_UNITS = ["USD_OR_CURRENCY", "PERCENT", "RATIO", "COUNT", "MONTHS", "DAYS", "MULTIPLE"] as const;
export const PERIOD_TYPES = [
  "POINT_IN_TIME",
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
  "TTM",
  "CUMULATIVE",
  "UNSPECIFIED",
] as const;

export const METRIC_BASES = ["ACTUAL", "CURRENT", "LTM", "FORECAST", "TARGET", "PIPELINE", "SIGNED", "BOOKED"] as const;
export type MetricBasis = (typeof METRIC_BASES)[number];
export const FORWARD_BASES: readonly MetricBasis[] = ["FORECAST", "TARGET", "PIPELINE"];

export const MetricObservation = z.object({
  metricKey: z.enum([...METRIC_KEYS, "OTHER"]),
  label: z.string().describe("Metric label as used by the company"),
  rawText: z.string().describe("Exact text as it appears, e.g. '$4.2M ARR'"),
  value: z
    .number()
    .nullable()
    .describe("Fully scaled number. Percentages as percent units (120 for 120%). Currency amounts fully scaled."),
  unit: z.enum(METRIC_UNITS),
  currency: z.string().nullable(),
  periodType: z.enum(PERIOD_TYPES),
  periodStart: z.string().nullable().describe("YYYY-MM or YYYY-MM-DD"),
  periodEnd: z.string().nullable().describe("YYYY-MM or YYYY-MM-DD; the 'as of' date for point-in-time metrics"),
  definitionAsStated: z.string().nullable(),
  components: z
    .array(z.string())
    .describe("What the figure explicitly includes/excludes, e.g. 'includes pilots', 'excludes founder salary'"),
  sampleSize: z.number().nullable().describe("Number of customers/users/cohort members underlying a ratio"),
  cohortDefinition: z.string().nullable(),
  state: z.enum(["OBSERVED", "INFERRED", "WITHHELD", "UNKNOWN"]),
  basis: z
    .enum(METRIC_BASES)
    .describe(
      "Chronology: ACTUAL (historical period), CURRENT (as of now: live count, current run-rate), LTM, FORECAST, TARGET (goal/milestone), PIPELINE (unsigned opportunities), SIGNED (contracted, not yet live), BOOKED (bookings). Only ACTUAL/CURRENT/LTM are current metrics.",
    ),
  sourceKind: z.enum(["TEXT", "TABLE", "CHART", "IMAGE", "FOOTNOTE"]).describe("Where on the page the number was read"),
  page: z.number().int().nullable(),
  excerpt: z.string().describe("Verbatim excerpt supporting the value (max ~200 chars)"),
});
export type MetricObservation = z.infer<typeof MetricObservation>;

/* ---------------------------------------------------------------- */
/* Claims                                                             */
/* ---------------------------------------------------------------- */

export const ClaimExtraction = z.object({
  ref: z.string().describe("Local reference like c1, c2 ... unique within this output"),
  category: ClaimCategory,
  statement: z.string().describe("The claim as a precise, neutral sentence"),
  valueText: z.string().nullable(),
  entity: z.string().describe("Which entity the claim is about (company, a founder, a customer...)"),
  period: z.string().nullable(),
  page: z.number().int().nullable(),
  excerpt: z.string().describe("Verbatim excerpt from the document"),
  material: z.boolean().describe("Would this claim change the investment view if false?"),
  unusualness: z.number().int().describe("1 = ordinary (founded in 2024) … 5 = extraordinary (50× cheaper than the incumbent)"),
  proposition: z.string().describe("The claim decomposed into a precise, testable proposition (what exactly would have to be true)"),
  evidenceNeeded: z.string().describe("The evidence that would verify it (document, data, reference)"),
});
export type ClaimExtraction = z.infer<typeof ClaimExtraction>;

/* ---------------------------------------------------------------- */
/* Founders                                                           */
/* ---------------------------------------------------------------- */

export const FounderFromDeck = z.object({
  name: z.string(),
  role: z.string(),
  backgroundFromDeck: z.string(),
  priorOrganizations: z.array(z.string()),
  publicProfileUrls: z.array(z.string()),
});

export const FOUNDER_CAPABILITIES = [
  "LEARNING_VELOCITY",
  "EXECUTION",
  "JUDGMENT",
  "CUSTOMER_UNDERSTANDING",
  "RECRUITING",
  "TECHNICAL_CAPABILITY",
  "COMMERCIAL_CAPABILITY",
  "COMMUNICATION_INTELLECTUAL_HONESTY",
  "COFOUNDER_DYNAMICS",
] as const;

export const FounderCapability = z.object({
  dimension: z.enum(FOUNDER_CAPABILITIES),
  relevant: z.boolean().describe("Is this capability relevant to this founder's role and this company?"),
  rating: RubricRating,
  observability: Observability,
  evidence: z.string().describe("Concrete evidence. Never pedigree alone. Say 'not observable' if so."),
  claimRefs: z.array(z.string()),
});

export const FounderAnalysis = z.object({
  name: z.string(),
  role: z.string(),
  summary: z.string().describe("Investment-relevant summary, not a CV"),
  timeline: z.array(
    z.object({
      period: z.string(),
      organization: z.string(),
      role: z.string(),
      relevance: z.string(),
    }),
  ),
  publicWork: z.array(
    z.object({
      kind: z.enum(["CODE", "PAPER", "PATENT", "TALK", "PRODUCT", "WRITING", "OTHER"]),
      description: z.string(),
      url: z.string().nullable(),
    }),
  ),
  capabilities: z.array(FounderCapability),
  founderMarketFit: z.string(),
  notObservableWithoutInterview: z.array(z.string()),
});
export type FounderAnalysis = z.infer<typeof FounderAnalysis>;

/* ---------------------------------------------------------------- */
/* Product, pain, customers                                           */
/* ---------------------------------------------------------------- */

export const ProductSection = z.object({
  whatItIs: z.string().describe("Software / AI agent / hardware / therapeutic / marketplace ... in one line"),
  plainExplanation: z.string().describe("2-3 sentences an intelligent non-specialist understands"),
  whatItDoes: z.string(),
  before: z.array(z.string()).describe("Workflow steps before the product, short imperative phrases"),
  after: z.array(z.string()).describe("Workflow steps with the product"),
  user: z.string(),
  buyer: z.string(),
  workflowChange: z.string(),
  valueQuantification: z.array(
    z.object({
      kind: z.enum([
        "TIME_SAVED",
        "COST_SAVED",
        "REVENUE_CREATED",
        "ERRORS_REDUCED",
        "LABOR_ELIMINATED",
        "THROUGHPUT",
        "CONVERSION",
        "DEPLOYMENT_TIME",
        "ROI",
        "PAYBACK",
        "UTILIZATION",
        "OTHER",
      ]),
      statement: z.string(),
      baseline: z.string().nullable(),
      measurementPeriod: z.string().nullable(),
      source: z.string().nullable(),
      method: z.string().nullable(),
      evidenceStatus: z.enum(["MEASURED", "COMPANY_CLAIMED", "ESTIMATED", "UNSUPPORTED"]),
    }),
  ),
});
export type ProductSection = z.infer<typeof ProductSection>;

export const PainSection = z.object({
  demandType: DemandType,
  frequency: z.string(),
  severity: z.string(),
  economicCost: z.string(),
  urgency: z.string(),
  existingBudget: z.string(),
  alternativeBehavior: z.string(),
  consumerDrivers: z
    .array(z.enum(["ENTERTAINMENT", "STATUS", "COMMUNITY", "IDENTITY", "CONVENIENCE", "HABIT", "SAVINGS", "OTHER"]))
    .describe("Only for consumer demand; empty otherwise"),
  assessment: z.string(),
});
export type PainSection = z.infer<typeof PainSection>;

export const CUSTOMER_EVIDENCE_LEVELS = ["LOGO_ONLY", "PILOT", "CONTRACT_SIGNED", "DEPLOYED", "PAYING", "RECURRING", "REFERENCEABLE", "UNKNOWN"] as const;

export const NamedCustomer = z.object({
  name: z.string(),
  relationship: CustomerRelationship,
  evidenceLevel: z.enum(CUSTOMER_EVIDENCE_LEVELS).describe("Highest level the materials actually support: a logo on a slide is LOGO_ONLY"),
  note: z.string().nullable(),
});

export const CustomersSection = z.object({
  icp: z.string(),
  segments: z.array(z.string()),
  namedCustomers: z.array(NamedCustomer),
  concentrationNote: z.string().nullable(),
  referencesNote: z
    .string()
    .describe("What references exist and whether company-selected or independent; what references are still needed"),
});
export type CustomersSection = z.infer<typeof CustomersSection>;

export const BusinessModelSection = z.object({
  howItMakesMoney: z.string(),
  pricing: z.string().nullable(),
});

/* ---------------------------------------------------------------- */
/* PMF / traction                                                     */
/* ---------------------------------------------------------------- */

export const PmfSection = z.object({
  signals: z.array(
    z.object({
      signal: z.enum([
        "PILOT_TO_PRODUCTION",
        "TIME_TO_VALUE",
        "POST_ONBOARDING_USAGE",
        "RENEWALS",
        "EXPANSION",
        "COHORT_RETENTION",
        "CHURN",
        "DISCOUNTING",
        "IMPLEMENTATION_DEPENDENCY",
        "REFERENCES",
        "LOST_CUSTOMERS",
        "ORGANIC_DEMAND",
        "CONCENTRATION",
        "OTHER",
      ]),
      direction: z.enum(["SUPPORTS", "UNDERMINES", "NEUTRAL", "UNKNOWN"]),
      evidence: z.string(),
      claimRefs: z.array(z.string()),
    }),
  ),
  olderCohortEvidence: z.string().nullable().describe("Evidence from customers older than 12 months, if any"),
  assessment: z.string(),
});
export type PmfSection = z.infer<typeof PmfSection>;

/* ---------------------------------------------------------------- */
/* Market                                                             */
/* ---------------------------------------------------------------- */

export const MarketSection = z.object({
  currentMarket: z.string(),
  wedge: z.string(),
  topDown: z
    .object({
      lowUsd: z.number(),
      highUsd: z.number(),
      basis: z.string(),
      sourceRefs: z.array(z.string()).describe("Research finding refs (r1...) or claim refs"),
    })
    .nullable(),
  bottomUp: z
    .object({
      customerDefinition: z.string(),
      customerCountLow: z.number(),
      customerCountHigh: z.number(),
      annualSpendLowUsd: z.number(),
      annualSpendHighUsd: z.number(),
      spendBasis: z.string(),
    })
    .nullable(),
  valueCapture: z
    .object({
      economicValueCreatedLowUsd: z.number(),
      economicValueCreatedHighUsd: z.number(),
      captureShareLowPct: z.number(),
      captureShareHighPct: z.number(),
      basis: z.string(),
    })
    .nullable(),
  deckTamAssessment: z.string().describe("Why the deck TAM is or is not credible"),
  expansion: z.array(
    z.object({
      market: z.string(),
      customerAdjacency: z.string(),
      productAdjacency: z.string(),
      distributionAdjacency: z.string(),
      technicalRequirements: z.string(),
      timeline: z.string(),
      capitalRequired: z.string(),
    }),
  ),
  valueCaptureAnalysis: z.object({
    willingnessToPay: z.string(),
    pricingPower: z.string(),
    substitutePricing: z.string(),
    switchingCost: z.string(),
    buyerConcentration: z.string(),
    commoditizationRisk: z.string(),
    conclusion: z.string(),
  }),
  whyNow: z.string(),
});
export type MarketSection = z.infer<typeof MarketSection>;

/* ---------------------------------------------------------------- */
/* Competition & moat                                                 */
/* ---------------------------------------------------------------- */

export const Competitor = z.object({
  name: z.string(),
  type: CompetitorType,
  description: z.string(),
  scale: z.string().nullable().describe("Funding, revenue or size indicators, with source ref"),
  url: z.string().nullable(),
  sourceRefs: z.array(z.string()),
});

export const CompetitionSection = z.object({
  competitors: z.array(Competitor),
  comparison: z.array(
    z.object({
      dimension: z.string().describe("e.g. Price, Deployment, Core capability, Distribution, Customers, Moat"),
      company: z.string(),
      competitorValues: z.array(z.object({ competitor: z.string(), value: z.string() })),
    }),
  ),
  adversarialTests: z.array(
    z.object({
      test: AdversarialTest,
      scenario: z.string(),
      outcome: z.string(),
      verdict: AdversarialVerdict,
    }),
  ),
});
export type CompetitionSection = z.infer<typeof CompetitionSection>;

export const MoatItem = z.object({
  dimension: MoatDimension,
  current: MoatStrength,
  in3Years: MoatStrength,
  whatMustHappen: z.string(),
  evidence: z.string(),
});
export type MoatItem = z.infer<typeof MoatItem>;

/* ---------------------------------------------------------------- */
/* GTM                                                                */
/* ---------------------------------------------------------------- */

export const GtmSection = z.object({
  user: z.string(),
  buyer: z.string(),
  economicBuyer: z.string(),
  icp: z.string(),
  salesMotion: z.string(),
  channels: z.array(z.string()),
  salesCycle: z.string().nullable(),
  founderLedAssessment: z.string().describe("Founder-led sales interpreted relative to stage"),
  assessment: z.string(),
});
export type GtmSection = z.infer<typeof GtmSection>;

/* ---------------------------------------------------------------- */
/* Financing (as extracted) and financing path (as analyzed)          */
/* ---------------------------------------------------------------- */

export const TermsSection = z.object({
  liquidationPreferenceMultiple: z.number().nullable(),
  participating: z.boolean().nullable(),
  antiDilution: z.string().nullable(),
  boardRights: z.string().nullable(),
  informationRights: z.string().nullable(),
  proRata: z.string().nullable(),
  protectiveProvisions: z.string().nullable(),
  dragTag: z.string().nullable(),
  redemption: z.string().nullable(),
});
export type TermsSection = z.infer<typeof TermsSection>;

export const FinancingExtraction = z.object({
  instrument: Instrument,
  raiseAmount: Money.nullable(),
  preMoney: Money.nullable(),
  postMoney: Money.nullable(),
  valuationCap: Money.nullable(),
  discountPct: z.number().nullable(),
  optionPoolIncreasePct: z.number().nullable().describe("Pre-money option pool top-up as % of post-money, if stated"),
  cashBalance: Money.nullable(),
  monthlyBurn: Money.nullable(),
  runwayClaimMonths: z.number().nullable(),
  leadInvestor: z.string().nullable(),
  existingInvestors: z.array(z.string()),
  totalRaisedToDate: Money.nullable(),
  useOfFunds: z.array(z.string()),
  milestonesClaimed: z.array(
    z.object({
      milestone: z.string(),
      monthsFromNow: z.number().nullable(),
    }),
  ),
  terms: TermsSection,
});
export type FinancingExtraction = z.infer<typeof FinancingExtraction>;

export const FinancingPathAnalysis = z.object({
  proofPurchased: z.string().describe("The specific proof this round's capital should buy"),
  milestoneMonths: z.number().nullable().describe("Months to reach that proof"),
  plannedMonthlyBurnUsd: z.number().nullable().describe("Expected monthly burn after the round, if inferable"),
  nextRoundConditions: z.string(),
  capitalIntensity: Level,
  fallbackPlans: z.string(),
  financingRiskAssessment: z.string().describe("Could it die while directionally correct because it cannot finance the journey?"),
});
export type FinancingPathAnalysis = z.infer<typeof FinancingPathAnalysis>;

/* ---------------------------------------------------------------- */
/* Risks & weaknesses                                                 */
/* ---------------------------------------------------------------- */

export const RiskItem = z.object({
  category: RiskCategory,
  title: z.string(),
  description: z.string(),
  severity: Level,
  likelihood: Level,
  timing: RiskTiming,
  mitigation: z.string(),
  evidence: z.string(),
  claimRefs: z.array(z.string()),
  weaknessClass: WeaknessClass,
  repair: z
    .object({
      resources: z.string(),
      time: z.string(),
      difficulty: Level,
    })
    .nullable(),
});
export type RiskItem = z.infer<typeof RiskItem>;

/* ---------------------------------------------------------------- */
/* Rubric ratings — the AI rates, the registry scores                 */
/* ---------------------------------------------------------------- */

export const RUBRIC_CRITERIA = [
  // TEAM
  "FOUNDER_MARKET_FIT",
  "EXECUTION_EVIDENCE",
  "TEAM_COMPLETENESS",
  // PRODUCT & PAIN
  "PAIN_SEVERITY",
  "VALUE_QUANTIFIED",
  "PRODUCT_DIFFERENTIATION",
  // MARKET
  "VALUE_CAPTURE",
  "MARKET_GROWTH",
  "WEDGE_QUALITY",
  // TRACTION / PMF
  "PMF_SIGNAL_QUALITY",
  // GTM
  "ICP_CLARITY",
  "SALES_MOTION_FIT",
  "CHANNEL_SCALABILITY",
  // ECONOMICS
  "PRICING_POWER",
  // MOAT
  "MOAT_CURRENT",
  "MOAT_TRAJECTORY",
  // WHY NOW
  "TIMING_CATALYST",
  "INFLECTION_EVIDENCE",
] as const;
export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

export const RubricAssessment = z.object({
  criterion: z.enum(RUBRIC_CRITERIA),
  rating: RubricRating,
  rationale: z.string().describe("Cite concrete evidence. Use INSUFFICIENT_EVIDENCE rather than guessing."),
  claimRefs: z.array(z.string()),
});
export type RubricAssessment = z.infer<typeof RubricAssessment>;

/* ---------------------------------------------------------------- */
/* Return assumptions (interpretation); the engine computes returns   */
/* ---------------------------------------------------------------- */

export const ExitAssumption = z.object({
  scenario: ReturnScenarioName,
  exitRevenueUsd: z.number().nullable(),
  revenueMultiple: z.number().nullable(),
  yearsToExit: z.number(),
  rationale: z.string(),
});
export type ExitAssumption = z.infer<typeof ExitAssumption>;

/* ---------------------------------------------------------------- */
/* Exceptionality, thesis, red team                                   */
/* ---------------------------------------------------------------- */

export const ExceptionalStrength = z.object({
  claim: z.string().describe("Precise. 'Strong team' or 'large market' are rejected."),
  kind: z.enum([
    "FOUNDER_INSIGHT",
    "TECHNICAL_BREAKTHROUGH",
    "COST_CURVE_CHANGE",
    "PROPRIETARY_DISTRIBUTION",
    "REGULATORY_ACCESS",
    "NETWORK_EFFECT",
    "EXCEPTIONAL_RETENTION",
    "EXECUTION_SPEED",
    "CATEGORY_CREATION",
    "OTHER",
  ]),
  evidence: z.string(),
  whyItMatters: z.string(),
  durability: z.string(),
  invalidation: z.string().describe("What would invalidate it"),
  rating: RubricRating,
  claimRefs: z.array(z.string()),
});
export type ExceptionalStrength = z.infer<typeof ExceptionalStrength>;

export const NonlinearSection = z.object({
  whyDisproportionate: z.string(),
  mechanism: z.string(),
  whyUnderestimated: z.string(),
  compoundingAssumptions: z.array(z.string()),
  outlierPlausible: z.boolean(),
  outlierRationale: z.string(),
});
export type NonlinearSection = z.infer<typeof NonlinearSection>;

export const ThesisSection = z.object({
  bet: z.string().describe("What exactly are we betting on — one or two sentences"),
  requiredConditions: z.array(
    z.object({
      condition: z.string(),
      currentEvidence: z.string(),
      status: ConditionStatus,
    }),
  ),
  thesisPoints: z.array(z.string()).describe("Exactly 3 bullets"),
  whatCouldBreak: z.array(z.string()).describe("Exactly 3 bullets"),
  fatalWeakness: z.string(),
  fatalQuestion: z.string().describe("The single most important unresolved question"),
  returnPath: z.string(),
  nextProof: z.string(),
});
export type ThesisSection = z.infer<typeof ThesisSection>;

export const FalsificationItem = z.object({
  thesis: z.string(),
  falsifiers: z.array(
    z.object({
      falsifier: z.string(),
      status: FalsifierStatus,
      evidence: z.string(),
    }),
  ),
});
export type FalsificationItem = z.infer<typeof FalsificationItem>;

export const RedTeamSection = z.object({
  caseAgainstInvesting: z.array(z.string()),
  caseAgainstPassing: z.array(z.string()),
  passRegretScenario: z.string().describe("If we pass and this becomes a $20B company, what did we fail to understand?"),
});
export type RedTeamSection = z.infer<typeof RedTeamSection>;

export const FounderQuestionDraft = z.object({
  question: z.string(),
  tier: QuestionTier,
  whyItMatters: z.string(),
  knownContext: z.string(),
  ifAnswerA: z.string().describe("Answer A and what it changes"),
  ifAnswerB: z.string().describe("Answer B and what it changes"),
  affects: z.array(QuestionEffect),
});
export type FounderQuestionDraft = z.infer<typeof FounderQuestionDraft>;

export const NextBestAction = z.object({
  action: z.string().describe("Specific, e.g. 'Obtain 12-month retention cohorts'. Never 'do more diligence'."),
  rationale: z.string(),
  type: z.enum(["FOUNDER_REQUEST", "REFERENCE_CALLS", "RESEARCH", "DOCUMENT_REVIEW", "MODEL", "DECISION"]),
});
export type NextBestAction = z.infer<typeof NextBestAction>;

export const WatchTrigger = z.object({
  trigger: z.string(),
  expectedDate: z.string().nullable(),
  informationAwaited: z.string(),
});
export type WatchTrigger = z.infer<typeof WatchTrigger>;

export const RecommendationDraft = z.object({
  suggestedStatus: DecisionStatus,
  rationale: z.string(),
  watch: WatchTrigger.nullable(),
});

/* ---------------------------------------------------------------- */
/* Information gaps                                                   */
/* ---------------------------------------------------------------- */

export const InformationGapDraft = z.object({
  question: z.string(),
  whyItMatters: z.string(),
  target: z.enum(["FOUNDER", "COMPANY", "PRODUCT", "CUSTOMER", "MARKET", "COMPETITOR", "REGULATORY", "FINANCING"]),
  decisionImportance: z.number().int().describe("1 (low) to 5 (decisive)"),
  uncertainty: z.number().int().describe("1 (nearly known) to 5 (unknown)"),
  researchability: z.enum(["PUBLIC_WEB", "FOUNDER_ONLY", "BOTH", "DATA_ROOM"]),
  suggestedQueries: z.array(z.string()).describe("Up to 3 specific web search queries, empty if founder-only"),
});
export type InformationGapDraft = z.infer<typeof InformationGapDraft>;

/* ---------------------------------------------------------------- */
/* Research findings                                                  */
/* ---------------------------------------------------------------- */

export const ResearchFinding = z.object({
  ref: z.string().describe("r1, r2 ..."),
  gapRef: z.string().nullable(),
  topic: z.enum(["FOUNDER", "COMPANY", "PRODUCT", "CUSTOMER", "MARKET", "COMPETITOR", "REGULATORY", "FINANCING"]),
  finding: z.string().describe("Neutral statement of what the source says"),
  sourceUrl: z.string(),
  sourceTitle: z.string(),
  publisher: z.string().nullable(),
  publishedDate: z.string().nullable(),
  origin: EvidenceOrigin,
  derivedFromCompany: z
    .boolean()
    .describe("True if the source merely repeats company statements (press release, founder interview)"),
  relatesToClaimRef: z.string().nullable(),
  effect: z.enum(["CONFIRMS", "PARTIALLY_CONFIRMS", "CONTRADICTS", "NEW_INFORMATION"]),
});
export type ResearchFinding = z.infer<typeof ResearchFinding>;

export { ClaimCategory };

/* ---------------------------------------------------------------- */
/* Deck forensics (visual + narrative) — "what is the deck trying to   */
/* make me believe?"                                                   */
/* ---------------------------------------------------------------- */

export const CHART_ISSUES = [
  "NON_ZERO_AXIS",
  "CHERRY_PICKED_PERIOD",
  "HIDDEN_PERIOD",
  "CUMULATIVE_AS_RUN_RATE",
  "INCONSISTENT_SCALE",
  "MISLEADING_CAGR",
  "MISSING_UNITS",
  "TRUNCATED_OR_UNLABELLED",
  "OTHER",
] as const;

export const PRODUCT_PROOF_LEVELS = ["MARKETING_SCREENSHOT", "PROTOTYPE", "DEMO", "PRODUCTION_USAGE", "REAL_INTEGRATIONS", "UNKNOWN"] as const;

export const DeckForensics = z.object({
  narrativeArchitecture: z.object({
    centralArgument: z.string().describe("The single argument the deck is built to make"),
    beliefTheDeckWantsMeToHold: z.string().describe("What the founder wants the investor to believe, in one sentence"),
    slideOrderRationale: z.string().describe("Why the slides are in this order and what that sequencing achieves"),
    emphasized: z.array(z.object({ what: z.string(), page: z.number().int().nullable() })),
    absentDecisiveInformation: z.array(z.object({ what: z.string(), whyItMatters: z.string() })).describe("Decision-relevant facts a comparable deck would show but this one does not"),
    routedAroundWeaknesses: z.array(z.string()).describe("Weaknesses the narrative appears to steer around (state as hypotheses)"),
  }),
  visualElements: z.array(
    z.object({
      page: z.number().int().nullable(),
      kind: z.enum(["CHART", "TABLE", "LOGO_WALL", "ORG_CHART", "CAP_TABLE", "PRODUCT_SCREENSHOT", "DIAGRAM", "MAP", "OTHER"]),
      readout: z.string().describe("What the visual actually shows, with numbers, axes, periods and units as read"),
    }),
  ),
  chartForensics: z.array(z.object({ page: z.number().int().nullable(), issue: z.enum(CHART_ISSUES), detail: z.string(), severity: Level })),
  crossSlideInconsistencies: z.array(
    z.object({ topic: z.string(), pages: z.array(z.number().int()), values: z.array(z.string()), detail: z.string(), severity: Level }),
  ),
  narrativeInconsistencies: z
    .array(z.object({ presentedAs: z.string(), evidenceSuggests: z.string(), detail: z.string(), severity: Level }))
    .describe("e.g. presented as enterprise SaaS but revenue mix suggests services; self-serve claim vs six-month sales cycle"),
  productProof: z.object({ level: z.enum(PRODUCT_PROOF_LEVELS), evidence: z.string() }),
  founderSlideSkepticism: z.array(
    z.object({ founder: z.string(), statement: z.string(), whatItActuallyShows: z.string(), gap: z.string().describe("e.g. 'worked at Google' vs 'built the relevant product at Google'; advisor vs operator") }),
  ),
  competitiveSlide: z
    .object({ axesChosen: z.string(), whyTheyFavorTheCompany: z.string(), honestComparison: z.string() })
    .nullable(),
  marketSlide: z.object({ coherence: z.string().describe("Are TAM ⊇ SAM ⊇ SOM consistent with each other and with pricing × realistic customers?"), issues: z.array(z.string()) }),
  claimChecks: z.array(
    z.object({
      claim: z.string().describe("Verbatim or near-verbatim marketing claim, e.g. '10× cheaper', 'market leader', 'proprietary AI', 'viral growth'"),
      proposition: z.string(),
      wouldVerify: z.string(),
      wouldFalsify: z.string(),
    }),
  ),
  deckQualitySignals: z
    .object({ precision: z.string(), numberMastery: z.string(), customerUnderstanding: z.string() })
    .describe("Secondary qualitative signals about reasoning quality — never about visual polish"),
  suspectedInstructions: z.array(z.object({ page: z.number().int().nullable(), excerpt: z.string() })),
});
export type DeckForensics = z.infer<typeof DeckForensics>;

/* ---------------------------------------------------------------- */
/* Causal business model, alternative explanations, sensitivity        */
/* ---------------------------------------------------------------- */

export const CAUSAL_STAGES = ["ACQUISITION", "CONVERSION", "ACTIVATION", "USAGE", "RETENTION", "EXPANSION", "REVENUE", "GROSS_PROFIT", "CASH", "REINVESTMENT"] as const;

export const CausalModel = z.object({
  stages: z.array(
    z.object({
      stage: z.enum(CAUSAL_STAGES),
      mechanism: z.string().describe("How this stage works for this company"),
      evidence: z.string().describe("Numbers and facts, with claim/metric refs; say 'no evidence' when absent"),
      health: z.enum(["STRONG", "ADEQUATE", "WEAK", "UNKNOWN"]),
    }),
  ),
  bottleneck: z.object({ stage: z.enum(CAUSAL_STAGES), statement: z.string().describe("e.g. 'Demand is not the problem; conversion pilot→production at 21% is'"), evidence: z.string() }),
});
export type CausalModel = z.infer<typeof CausalModel>;

export const AlternativeExplanation = z.object({
  signal: z.string().describe("A positive signal, e.g. 'Revenue +250%'"),
  bullishReading: z.string(),
  alternativeReading: z.string().describe("A plausible non-bullish explanation, e.g. aggressive paid acquisition or one large customer"),
  discriminatingTest: z.string().describe("The data that would tell the two readings apart"),
});
export type AlternativeExplanation = z.infer<typeof AlternativeExplanation>;

export const SensitivityDriver = z.object({
  variable: z.string().describe("e.g. NRR, fully-loaded CAC, pilot→production conversion, SAM, exit ownership"),
  metricKey: z.string().nullable().describe("Metric dictionary key if quantitative, else null"),
  currentAssumption: z.string(),
  breaksAt: z.string().describe("The value or condition at which the thesis breaks"),
  why: z.string(),
});
export type SensitivityDriver = z.infer<typeof SensitivityDriver>;

export const PerfectSlide = z.object({
  missing: z.string().describe("The missing or weak evidence"),
  slide: z.string().describe("Exactly what the ideal slide would show (rows, columns, periods, cohorts)"),
});
export type PerfectSlide = z.infer<typeof PerfectSlide>;
