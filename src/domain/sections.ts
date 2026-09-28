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
      annualSpendLowUsd: z.number().describe("Annual spend PER CUSTOMER on this category, USD (e.g. 15000) — never a total; code multiplies by the customer count"),
      annualSpendHighUsd: z.number().describe("Annual spend PER CUSTOMER, USD — never a total"),
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

/* ---------------------------------------------------------------- */
/* Latent signals — what the deck reveals beyond what it claims.       */
/* Observable signals only: no psychology, no personality inference.   */
/* ---------------------------------------------------------------- */

export const OPERATING_MATURITY_SIGNALS = [
  "ICP_PRECISION",
  "USER_BUYER_DISTINCTION",
  "MODEL_APPROPRIATE_METRICS",
  "COHORTS_OVER_VANITY",
  "CHURN_REASONS_KNOWN",
  "WIN_LOSS_UNDERSTANDING",
  "UNIT_ECONOMICS_UNDERSTANDING",
  "ACTUAL_FORECAST_SEPARATION",
] as const;

export const LatentSignalsDraft = z.object({
  operatingMaturity: z.array(
    z.object({
      signal: z.enum(OPERATING_MATURITY_SIGNALS),
      status: z.enum(["DEMONSTRATED", "PARTIAL", "NOT_SHOWN", "CONTRADICTED"]).describe("Judge only what the deck shows"),
      evidence: z.string().describe("Quote or describe the observable evidence, with page"),
      page: z.number().int().nullable(),
    }),
  ),
  reasoningChains: z
    .array(
      z.object({
        conclusion: z.string().describe("A conclusion the deck asks the reader to accept (e.g. 'the market is $50B')"),
        support: z.enum(["EVIDENCE_AND_CAUSAL_REASONING", "EVIDENCE_ONLY", "ASSERTION_ONLY"]),
        chain: z.string().describe("claim → evidence → reasoning → conclusion as presented, or what is missing"),
        page: z.number().int().nullable(),
      }),
    )
    .describe("The 5–12 most important conclusions of the deck"),
  vanityMetricsShown: z.array(z.object({ metric: z.string(), page: z.number().int().nullable(), decisionMetricItDisplaces: z.string().nullable() })),
  presentationTechniques: z
    .array(
      z.object({
        technique: z.enum([
          "CUMULATIVE_INSTEAD_OF_PERIOD",
          "GMV_INSTEAD_OF_NET_REVENUE",
          "PIPELINE_AS_BOOKED",
          "PILOTS_MIXED_WITH_CUSTOMERS",
          "LOIS_MIXED_WITH_CONTRACTS",
          "FORECAST_DRAWN_AS_ACTUAL",
          "FREE_USERS_AS_CUSTOMERS",
          "CAGR_FROM_TINY_BASE",
          "LOGOS_WITHOUT_STATUS",
          "ADJACENT_TAM_AS_ADDRESSABLE",
          "OTHER",
        ]),
        detail: z.string(),
        page: z.number().int().nullable(),
      }),
    )
    .describe("Presentation choices that raise the impression of performance — not accusations of lying"),
  disclosures: z
    .array(
      z.object({
        kind: z.enum(["LIMITATION", "RISK", "UNFLATTERING_METRIC", "PRECISE_DEFINITION", "OBJECTION_ADDRESSED", "FAILED_EXPERIMENT"]),
        detail: z.string(),
        page: z.number().int().nullable(),
      }),
    )
    .describe("What the founder voluntarily discloses that a purely promotional deck would hide"),
  ambition: z.object({
    headline: z.string().describe("The ambition the deck claims (e.g. $30B TAM, category leader)"),
    operationalRoadmap: z.string().describe("What the round actually funds: geography, product scope, team, milestones"),
    bridge: z.string().describe("How the deck explains going from the wedge to the headline — or that it does not"),
    consistency: z.enum(["CONSISTENT", "STRETCHED", "DISCONNECTED", "UNCLEAR"]),
  }),
  causalExplanations: z
    .array(z.object({ metric: z.string(), explanationGiven: z.string().nullable(), page: z.number().int().nullable() }))
    .describe("For key metric movements (growth, churn, margin), does the deck explain WHY? null when no explanation is given"),
});
export type LatentSignalsDraft = z.infer<typeof LatentSignalsDraft>;

export const RevealedInsight = z.object({
  insight: z.string().describe("e.g. 'Sales scalability is probably the real bottleneck.'"),
  evidence: z.string().describe("The observable signals behind it (metrics chosen, omissions, definitions, inconsistencies), with pages"),
  basis: z.enum(["OBSERVED_IN_DECK", "COMPUTED", "INFERRED"]),
  direction: z.enum(["POSITIVE", "NEGATIVE", "NEUTRAL"]),
});
export type RevealedInsight = z.infer<typeof RevealedInsight>;

/* ---------------------------------------------------------------- */
/* Decision core — out of 100 facts, the few that decide.             */
/* ---------------------------------------------------------------- */

export const DecisionCore = z.object({
  compression: z.object({
    bet: z.string(),
    exceptionalStrength: z.string(),
    breakingPoint: z.string().describe("The single condition under which the investment fails"),
    returnPath: z.string().describe("How this returns the fund, in numbers"),
  }),
  determinants: z
    .array(
      z.object({
        fact: z.string().describe("A fact or unknown that actually determines the investment outcome"),
        whyDecisive: z.string(),
        status: z.enum(["VERIFIED", "COMPANY_REPORTED", "INFERRED", "UNKNOWN", "CONTRADICTED"]),
        refs: z.array(z.string()).describe("Claim/metric/source ids"),
      }),
    )
    .describe("Exactly 5: the facts that determine the investment — out of everything in the deck"),
  outlierSignals: z
    .array(
      z.object({
        signal: z.string().describe("A rare variable: exceptional founder, unique distribution, technology far ahead, 20× cost reduction, new behaviour, exploding market"),
        rarity: z.string().describe("Why it is rare and hard to reproduce"),
        whatWouldConfirm: z.string(),
      }),
    )
    .describe("Up to 2 signals that could reveal an outlier; empty if none"),
  reversingQuestion: z.object({
    question: z.string().describe("The single question whose answer could reverse the decision"),
    ifFavorable: z.string(),
    ifUnfavorable: z.string(),
  }),
  asymmetricConviction: z.object({
    whatTheMarketSees: z.string().describe("Why most investors would find this company average"),
    repairableWeaknesses: z.string(),
    exceptionalAndHardToCopy: z.string().describe("Or 'nothing identified' — never manufactured"),
  }),
  secondOrder: z
    .array(z.object({ question: z.string(), answer: z.string() }))
    .describe("What do incumbents do if it works? If AI gets 10× cheaper? Does the moat grow or vanish with scale? Does the company get stronger as it grows?"),
});
export type DecisionCore = z.infer<typeof DecisionCore>;

/* ---------------------------------------------------------------- */
/* Divergence signals — why two apparently similar startups diverge.  */
/* Observable, deck-only facts the engine cannot compute. No           */
/* psychology, no honesty judgements, no pedigree. Aggregated by       */
/* engine/divergence into ten factors (never a blended score).         */
/* ---------------------------------------------------------------- */

const DivPage = z.number().int().nullable().describe("Deck page number; null when not tied to a page");
const DivEvidence = z.string().describe("What the deck shows, verbatim or near-verbatim — never an inference about the person");

export const AMBITION_SIGNAL_KINDS = ["PRODUCT_SCOPE", "GEOGRAPHY", "HIRING_PLAN", "ROADMAP", "MARKET_LANGUAGE", "ROUND_SIZE_VS_PLAN", "OTHER"] as const;
export const PRODUCT_SCOPES = ["SINGLE_WORKFLOW", "PRODUCT_SUITE", "PLATFORM", "INFRASTRUCTURE", "UNCLEAR"] as const;
export const GEO_SCOPES = ["LOCAL", "REGIONAL", "MULTI_REGION", "GLOBAL", "UNSTATED"] as const;
export const MARKET_FRAMINGS = ["TOOL_IN_EXISTING_CATEGORY", "CATEGORY_LEADER", "NEW_CATEGORY", "INFRASTRUCTURE_LAYER", "UNCLEAR"] as const;
export const FOUNDER_STATUSES = ["ACTIVE_FULL_TIME", "PART_TIME", "DEPARTED", "UNKNOWN"] as const;
export const CONVERTIBLE_KINDS = ["SAFE_POST_MONEY", "SAFE_PRE_MONEY", "CONVERTIBLE_NOTE", "UNKNOWN"] as const;
export const CAP_TABLE_TERMS = ["PARTICIPATING_PREFERRED", "PREFERENCE_ABOVE_1X", "FULL_RATCHET", "REDEMPTION_RIGHT", "INVESTOR_OPERATING_VETO", "SUPER_VOTING", "OTHER"] as const;
export const INVESTOR_KINDS = ["VC_FUND", "ANGEL", "OPERATOR_ANGEL", "STRATEGIC_CORPORATE", "ACCELERATOR", "FAMILY_OFFICE", "PUBLIC_OR_GRANT", "UNKNOWN"] as const;
export const INVESTOR_ROUND_ROLES = ["LEADS_CURRENT_ROUND", "PARTICIPATES_CURRENT_ROUND", "EXISTING_PARTICIPATION_UNSTATED", "EXISTING_NOT_PARTICIPATING"] as const;
export const SYNDICATE_BEHAVIOURS = [
  "FOLLOWS_ON_THIS_ROUND",
  "PRO_RATA_OR_RESERVES_COMMITTED",
  "INVESTS_AT_NEXT_STAGE",
  "BRIDGED_OR_SUPPORTED_IN_DOWNTURN",
  "INTRODUCED_CUSTOMERS",
  "HELPED_RECRUIT",
  "ACTIVE_BOARD_OR_OPERATING_SUPPORT",
  "SECTOR_SPECIALIST",
  "NOT_FOLLOWING_ON",
  "CONFLICT_OF_INTEREST",
] as const;
export const SURVIVAL_OPTIONS = [
  "CUT_BURN",
  "CHANGE_GTM",
  "ALTERNATIVE_MONETIZATION",
  "LICENSE_TECHNOLOGY",
  "SERVICES_REVENUE",
  "ADJACENT_SEGMENT",
  "NON_DILUTIVE_FUNDING",
  "STRATEGIC_PARTNERSHIP",
  "SLOW_DOWN_PROFITABLY",
  "OTHER",
] as const;
export const OPTION_STATUSES = ["DEMONSTRATED", "PLAUSIBLE", "ASSERTED"] as const;
export const RIGIDITY_KINDS = ["FIXED_COMMITMENTS", "HARDWARE_OR_INVENTORY", "REGULATORY_TIMELINE", "LONG_SALES_CYCLE", "SINGLE_REVENUE_LINE", "OTHER"] as const;
export const MARKET_DIMENSIONS = [
  "FRAGMENTATION",
  "BUYER_CONCENTRATION",
  "SUPPLIER_CONCENTRATION",
  "PRICING_POWER",
  "NETWORK_STRUCTURE",
  "PURCHASE_FREQUENCY",
  "SWITCHING_COSTS",
  "PROCUREMENT_POWER",
  "WINNER_TAKE_DYNAMICS",
  "INCUMBENT_BUNDLING",
] as const;
export const STRUCTURE_READINGS = ["FAVORABLE", "NEUTRAL", "UNFAVORABLE", "UNKNOWN"] as const;
export const DEPENDENCY_KINDS = [
  "MODEL_PROVIDER",
  "CLOUD_INFRASTRUCTURE",
  "APP_STORE",
  "PLATFORM_API",
  "BANKING_OR_PAYMENT_PARTNER",
  "DATA_SOURCE",
  "CHANNEL_PARTNER",
  "REGULATORY_LICENCE",
  "KEY_SUPPLIER_OR_MANUFACTURER",
  "KEY_CUSTOMER",
  "OTHER",
] as const;
export const DEPENDENCY_CRITICALITY = ["CORE", "IMPORTANT", "PERIPHERAL"] as const;
export const SUBSTITUTABILITY = ["EASY", "MODERATE", "HARD", "UNKNOWN"] as const;
export const OWNED_ASSETS = ["DISTRIBUTION", "PROPRIETARY_DATA", "TECHNOLOGY_IP", "CUSTOMER_RELATIONSHIP", "BRAND_COMMUNITY", "OWN_LICENCE", "OTHER"] as const;
export const PRICING_MODELS = ["PER_SEAT", "USAGE", "PLATFORM_FEE", "TRANSACTION", "TIERED", "OUTCOME_BASED", "ONE_OFF", "UNKNOWN"] as const;
export const MODULE_STATUSES = ["LIVE", "BETA", "ROADMAP", "VISION"] as const;
export const EXPANSION_KINDS = ["SEAT_EXPANSION", "USAGE_GROWTH", "CROSS_SELL", "UPSELL_TIER", "PRICE_INCREASE", "NEW_DEPARTMENT", "NEW_SITE_OR_COUNTRY", "OTHER"] as const;
export const LOOP_KINDS = ["DATA", "SUPPLY_DEMAND_LIQUIDITY", "INTEGRATION_ECOSYSTEM", "COMMUNITY_CONTENT", "REFERRAL_VIRAL", "SCALE_COST", "OTHER"] as const;
export const LINK_STATUSES = ["DEMONSTRATED", "PLAUSIBLE", "ASSERTED", "ABSENT"] as const;
export const SCALABILITY_SIGNALS = [
  "CUSTOM_WORK_PER_CUSTOMER",
  "IMPLEMENTATION_EFFORT",
  "SERVICES_REVENUE",
  "HUMAN_IN_THE_LOOP",
  "LOCAL_TEAM_PER_COUNTRY",
  "HUMAN_SUPPORT_PER_CONTRACT",
  "SELF_SERVE_ONBOARDING",
  "STANDARD_PRODUCT",
  "MARGIN_TREND",
  "OTHER",
] as const;
export const TEAM_FUNCTIONS = ["ENGINEERING_PRODUCT", "SALES_MARKETING", "CUSTOMER_SUCCESS_SUPPORT", "SERVICES_IMPLEMENTATION", "OPERATIONS", "G_AND_A", "OTHER"] as const;

export const DivergenceDraft = z.object({
  ambition: z.object({
    productScope: z.enum(PRODUCT_SCOPES).describe("What product the deck says the company is building long-term"),
    geography: z.enum(GEO_SCOPES).describe("Where the deck says the company intends to operate (not where it is today)"),
    marketFraming: z.enum(MARKET_FRAMINGS).describe("How the deck frames the market it is attacking"),
    statedEndState: z.string().nullable().describe("The long-term company the deck says it is building, verbatim if possible; null if not stated"),
    signals: z
      .array(z.object({ kind: z.enum(AMBITION_SIGNAL_KINDS), direction: z.enum(["EXPANSIVE", "CONTAINED"]), evidence: DivEvidence, page: DivPage }))
      .describe("Up to 8 observable signals of the size of company being built: product scope, geography, hiring plan/roles, roadmap, market language, round size vs plan"),
  }),
  capTable: z.object({
    founderOwnershipPct: z.number().nullable().describe("Combined fully diluted ownership of ACTIVE founders before this round, only if stated (percent units)"),
    founders: z
      .array(
        z.object({
          name: z.string(),
          role: z.string(),
          status: z.enum(FOUNDER_STATUSES).describe("DEPARTED only when the deck states the person left"),
          ownershipPct: z.number().nullable().describe("Fully diluted %, only if stated"),
          evidence: DivEvidence,
          page: DivPage,
        }),
      )
      .describe("Founders and co-founders named anywhere in the materials, including any who left"),
    optionPoolPct: z.number().nullable().describe("Total option pool, % fully diluted, only if stated"),
    optionPoolAvailablePct: z.number().nullable().describe("Unallocated pool, % fully diluted, only if stated"),
    convertibles: z
      .array(
        z.object({
          instrument: z.enum(CONVERTIBLE_KINDS),
          amount: Money.nullable(),
          valuationCap: Money.nullable(),
          discountPct: z.number().nullable(),
          evidence: DivEvidence,
          page: DivPage,
        }),
      )
      .describe("OUTSTANDING (not yet converted) SAFEs / notes raised BEFORE the current round. Do not include the round being raised now."),
    terms: z.array(z.object({ term: z.enum(CAP_TABLE_TERMS), evidence: DivEvidence, page: DivPage })).describe("Non-standard or investor-favourable terms stated anywhere"),
    investorConflicts: z
      .array(z.object({ evidence: DivEvidence, page: DivPage }))
      .describe("Stated facts that put investors at odds: a strategic investor competing with customers or acquirers, conflicting control rights, investors on both sides of a deal"),
  }),
  syndicate: z
    .array(
      z.object({
        name: z.string(),
        kind: z.enum(INVESTOR_KINDS),
        roundRole: z.enum(INVESTOR_ROUND_ROLES),
        behaviours: z
          .array(z.enum(SYNDICATE_BEHAVIOURS))
          .describe("Only behaviours the materials state for THIS investor in THIS company. Never infer from reputation or fame."),
        evidence: DivEvidence,
        page: DivPage,
      }),
    )
    .describe("Every investor, lead or angel named in the materials"),
  survivability: z.object({
    options: z
      .array(z.object({ option: z.enum(SURVIVAL_OPTIONS), status: z.enum(OPTION_STATUSES).describe("DEMONSTRATED = already done/revenue exists; PLAUSIBLE = concrete facts make it feasible; ASSERTED = only stated"), evidence: DivEvidence, page: DivPage }))
      .describe("Real options the company has if its market takes 24 months longer than planned"),
    rigidities: z
      .array(z.object({ kind: z.enum(RIGIDITY_KINDS), evidence: DivEvidence, page: DivPage }))
      .describe("Facts that make slowing down hard (fixed commitments, inventory, regulatory timelines, long sales cycles, one revenue line)"),
  }),
  marketStructure: z.object({
    dimensions: z
      .array(z.object({ dimension: z.enum(MARKET_DIMENSIONS), reading: z.enum(STRUCTURE_READINGS).describe("For a new entrant capturing value"), evidence: DivEvidence, page: DivPage }))
      .describe("Structure of the market, NOT its size. One entry per dimension the materials inform; UNKNOWN when nothing is shown"),
    topBuyersSharePct: z.number().nullable().describe("Share of market spend controlled by the largest buyers, if stated"),
    topBuyersCount: z.number().int().nullable().describe("How many largest buyers the previous share refers to (e.g. 5)"),
    addressableBuyerCount: z.number().nullable().describe("Number of potential buying organizations/users, if stated"),
    largestCompetitorSharePct: z.number().nullable().describe("Market share of the largest incumbent, if stated"),
  }),
  dependencies: z
    .array(
      z.object({
        kind: z.enum(DEPENDENCY_KINDS),
        provider: z.string().describe("Named provider/partner, or a description if unnamed"),
        whatItProvides: z.string(),
        criticality: z.enum(DEPENDENCY_CRITICALITY).describe("CORE = the product or revenue stops without it"),
        substitutability: z.enum(SUBSTITUTABILITY),
        switchingTimeMonths: z.number().nullable().describe("Only if stated or directly implied"),
        mitigationStated: z.string().nullable(),
        evidence: DivEvidence,
        page: DivPage,
      }),
    )
    .describe("Critical elements the company does NOT control: model provider, cloud, app store, platform API, bank/payment partner, data source, channel partner, licence, supplier, key customer"),
  ownedAssets: z.array(z.object({ asset: z.enum(OWNED_ASSETS), evidence: DivEvidence, page: DivPage })).describe("What the company demonstrably owns and controls"),
  expansion: z.object({
    pricingModel: z.enum(PRICING_MODELS),
    entryPrice: Money.nullable().describe("Annual price of the entry product per customer, as stated"),
    largestCustomerAnnualValue: Money.nullable().describe("Annual contract value of the largest customer, as stated"),
    modules: z
      .array(z.object({ name: z.string(), status: z.enum(MODULE_STATUSES), annualPricePerCustomer: Money.nullable(), evidence: DivEvidence, page: DivPage }))
      .describe("Products/modules that can be sold to the same customer beyond the entry product (live, beta, roadmap, vision)"),
    expansionEvidence: z.array(z.object({ kind: z.enum(EXPANSION_KINDS), evidence: DivEvidence, page: DivPage })).describe("Observed expansion inside existing customers"),
  }),
  focus: z.object({
    products: z.array(z.object({ name: z.string(), status: z.enum(["LIVE", "BETA", "ROADMAP"]), page: DivPage })).describe("Distinct products sold or built today (not features)"),
    customerSegments: z.array(z.object({ name: z.string(), page: DivPage })).describe("Distinct ICPs/segments the company sells to today"),
    markets: z.array(z.object({ name: z.string(), status: z.enum(["ACTIVE", "LAUNCHING", "PLANNED"]), page: DivPage })).describe("Countries/regions"),
    channels: z.array(z.object({ name: z.string(), page: DivPage })).describe("Distinct acquisition channels actively run (direct sales, partners, self-serve, marketplace…)"),
  }),
  loops: z
    .array(
      z.object({
        kind: z.enum(LOOP_KINDS),
        description: z.string(),
        links: z
          .array(z.object({ from: z.string(), to: z.string(), status: z.enum(LINK_STATUSES).describe("DEMONSTRATED only with a measured number"), evidence: DivEvidence, page: DivPage }))
          .describe("Each causal link of the loop in order, e.g. customers → data, data → model accuracy, accuracy → win rate, win rate → customers"),
      }),
    )
    .describe("Compounding loops where each new customer makes the company better. Empty if the deck shows none"),
  scalability: z.object({
    signals: z.array(z.object({ kind: z.enum(SCALABILITY_SIGNALS), direction: z.enum(["SCALES", "NEUTRAL", "FRAGILE"]), evidence: DivEvidence, page: DivPage })),
    implementationWeeks: z.number().nullable().describe("Typical time from signature to live, in weeks, if stated"),
    headcountByFunction: z.array(z.object({ function: z.enum(TEAM_FUNCTIONS), count: z.number(), page: DivPage })).describe("Only when the deck states it"),
  }),
});
export type DivergenceDraft = z.infer<typeof DivergenceDraft>;
