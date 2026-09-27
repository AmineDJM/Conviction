import { emptyCanonical, type CanonicalDeal, type MetricInstance } from "@/domain/canonical";
import type { RubricCriterion } from "@/domain/sections";
import type { RubricRating } from "@/domain/enums";

let n = 0;
export function metric(key: string, value: number | null, extra: Partial<MetricInstance> = {}): MetricInstance {
  n++;
  return {
    id: `MET-T${n}`,
    metricKey: key,
    label: key,
    rawValue: String(value),
    normalizedValue: value,
    unit: "USD",
    currency: null,
    periodType: "POINT_IN_TIME",
    periodStart: null,
    periodEnd: "2026-08",
    definitionUsed: null,
    components: [],
    entityScope: "company",
    sampleSize: 40,
    cohortDefinition: null,
    state: value === null ? "UNKNOWN" : "OBSERVED",
    sourceId: "SRC-001",
    claimId: null,
    location: "p. 5",
    excerpt: null,
    verification: "UNVERIFIED",
    calculationMethod: "REPORTED",
    derivation: null,
    isPrimary: true,
    qualityFlags: [],
    notes: null,
    basis: "CURRENT",
    lineage: [],
    inputs: [],
    ...extra,
  };
}

export function rubric(criterion: RubricCriterion, rating: RubricRating) {
  return { criterion, rating, rationale: "test", claimRefs: [] };
}

/** A Series A enterprise SaaS company with solid metrics. */
export function makeDeal(overrides: Partial<CanonicalDeal> = {}): CanonicalDeal {
  const d = emptyCanonical("STANDARD");
  d.identity = { name: "Acme AI", legalName: null, website: "https://acme.example", hqCountry: "United States", foundedYear: 2022, oneLiner: "Software that reads invoices and posts them to the accounting system." };
  d.classification = {
    industry: ["ENTERPRISE_SOFTWARE", "FINANCIAL_SERVICES"],
    productType: ["SAAS", "AI_AGENT"],
    technology: ["AI"],
    revenueModel: ["SUBSCRIPTION"],
    gtm: ["MID_MARKET"],
    operationalMaturity: "PMF_EMERGING",
    financingStage: "SERIES_A",
    declaredStage: "Series A",
    rationale: "test",
  };
  d.metrics = [
    metric("arr", 3_840_000),
    metric("arr_growth_yoy", 210, { unit: "PERCENT" }),
    metric("nrr", 118, { unit: "PERCENT", sampleSize: 45 }),
    metric("gross_margin", 76, { unit: "PERCENT" }),
    metric("cac_payback_months", 14, { unit: "MONTHS" }),
    metric("burn_multiple", 1.4, { unit: "MULTIPLE" }),
    metric("runway_months", 14, { unit: "MONTHS" }),
    metric("customer_concentration_top1", 12, { unit: "PERCENT" }),
    metric("paying_customers", 92, { unit: "COUNT" }),
  ];
  d.rubric = [
    rubric("FOUNDER_MARKET_FIT", "STRONG"),
    rubric("EXECUTION_EVIDENCE", "STRONG"),
    rubric("TEAM_COMPLETENESS", "ADEQUATE"),
    rubric("PAIN_SEVERITY", "STRONG"),
    rubric("VALUE_QUANTIFIED", "ADEQUATE"),
    rubric("PRODUCT_DIFFERENTIATION", "ADEQUATE"),
    rubric("VALUE_CAPTURE", "ADEQUATE"),
    rubric("MARKET_GROWTH", "STRONG"),
    rubric("WEDGE_QUALITY", "STRONG"),
    rubric("PMF_SIGNAL_QUALITY", "STRONG"),
    rubric("ICP_CLARITY", "STRONG"),
    rubric("SALES_MOTION_FIT", "ADEQUATE"),
    rubric("CHANNEL_SCALABILITY", "ADEQUATE"),
    rubric("PRICING_POWER", "ADEQUATE"),
    rubric("MOAT_CURRENT", "BELOW_BAR"),
    rubric("MOAT_TRAJECTORY", "ADEQUATE"),
    rubric("TIMING_CATALYST", "STRONG"),
    rubric("INFLECTION_EVIDENCE", "ADEQUATE"),
  ];
  d.market = {
    currentMarket: "AP automation for mid-market",
    wedge: "Invoice capture",
    topDown: null,
    bottomUp: { customerDefinition: "mid-market companies", customerCountLow: 150_000, customerCountHigh: 200_000, annualSpendLowUsd: 15_000, annualSpendHighUsd: 25_000, spendBasis: "test" },
    valueCapture: null,
    deckTamAssessment: "",
    expansion: [],
    valueCaptureAnalysis: { willingnessToPay: "", pricingPower: "", substitutePricing: "", switchingCost: "", buyerConcentration: "", commoditizationRisk: "", conclusion: "" },
    whyNow: "",
  };
  d.financing = {
    instrument: "PRICED_EQUITY",
    raiseAmount: { amount: 12_000_000, currency: "USD", rawText: "$12M" },
    preMoney: { amount: 48_000_000, currency: "USD", rawText: "$48M pre" },
    postMoney: null,
    valuationCap: null,
    discountPct: null,
    optionPoolIncreasePct: null,
    cashBalance: { amount: 3_000_000, currency: "USD", rawText: "$3M" },
    monthlyBurn: { amount: 350_000, currency: "USD", rawText: "$350k" },
    runwayClaimMonths: null,
    leadInvestor: null,
    existingInvestors: [],
    totalRaisedToDate: null,
    useOfFunds: [],
    milestonesClaimed: [],
    terms: { liquidationPreferenceMultiple: null, participating: null, antiDilution: null, boardRights: null, informationRights: null, proRata: null, protectiveProvisions: null, dragTag: null, redemption: null },
  };
  d.financingPath = { proofPurchased: "$10M ARR", milestoneMonths: 20, plannedMonthlyBurnUsd: 550_000, nextRoundConditions: "", capitalIntensity: "MODERATE", fallbackPlans: "", financingRiskAssessment: "" };
  d.analysis.depth = "FULL";
  return { ...d, ...overrides };
}
