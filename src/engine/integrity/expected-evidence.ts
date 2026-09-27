/**
 * 4. EXPECTED EVIDENCE BY STAGE.
 *
 * A versioned configuration table: for each peer profile × stage band, which
 * evidence items a competent deck is EXPECTED to show, which are
 * NICE_TO_HAVE, and (implicitly, everything else) NOT_YET_EXPECTED.
 *
 * Severity of a missing / withheld EXPECTED item: LATE = HIGH,
 * GROWTH = MODERATE, EARLY = LOW. NICE_TO_HAVE and NOT_YET_EXPECTED items
 * never produce findings; every missing EXPECTED or NICE_TO_HAVE item gets a
 * deterministic "perfect slide" describing exactly what would close the gap.
 */
import type { MetricInstance } from "@/domain/canonical";
import type { ProfileId, StageBand } from "../benchmarks/types";
import { hasFlag, metricText, type IntegrityContext } from "./context";
import type { EvidencePresence, ExpectationLevel, ExpectedEvidenceItemResult, ExpectedEvidenceResult, IntegrityFinding, IntegritySeverity } from "./types";
import { arr, finding, isNum, parseDurationDays, str } from "./util";

/** Bump on any change to the table or the item detectors. Stored in every report. */
export const EXPECTED_EVIDENCE_VERSION = "1.0";

export const EVIDENCE_ITEM_IDS = [
  "team",
  "round_terms",
  "use_of_funds",
  "cap_table",
  "product_proof",
  "market_sizing",
  "pricing",
  "revenue",
  "arr_history",
  "usage_growth",
  "paying_customers",
  "named_customers",
  "references",
  "pilot_conversion",
  "gross_margin",
  "retention",
  "cohort_retention",
  "acv",
  "arpu",
  "sales_cycle",
  "pipeline_funnel",
  "cac_payback",
  "burn_multiple",
  "cash_and_burn",
  "customer_concentration",
  "services_mix",
  "founder_led_share",
  "headcount",
  "engagement",
  "consumer_retention",
  "organic_share",
  "gmv",
  "take_rate",
  "repeat_rate",
  "fill_rate",
  "tpv",
  "active_accounts",
  "credit_losses",
  "units_shipped",
  "asp",
  "backlog",
  "defect_rate",
  "milestone_capital",
  "regulatory_path",
  "ip",
] as const;
export type EvidenceItemId = (typeof EVIDENCE_ITEM_IDS)[number];

interface ItemSpec {
  label: string;
  /** Metric keys whose usable instance satisfies the item (any of). */
  metricKeys?: string[];
  /** Additional non-metric detector; returns the refs that satisfy it. */
  detect?: (ctx: IntegrityContext) => string[];
  perfectSlide: string;
}

const COHORT_TEXT = /\b(cohorts?|vintage|trailing|ttm|12[- ]month)\b/;

export const EVIDENCE_ITEMS: Record<EvidenceItemId, ItemSpec> = {
  team: {
    label: "Founders & team",
    detect: (c) => (arr(c.deal.foundersFromDeck).length || arr(c.deal.founders).length ? ["foundersFromDeck"] : []),
    perfectSlide: "Team slide: each founder's role, the specific thing they built or sold before (product, scale, outcome), years working together, and the open key hires with timing.",
  },
  round_terms: {
    label: "Round terms",
    detect: (c) => {
      const f = c.deal.financing;
      return f && isNum(f.raiseAmount?.amount) && (isNum(f.preMoney?.amount) || isNum(f.postMoney?.amount) || isNum(f.valuationCap?.amount)) ? ["financing.raiseAmount", "financing.valuation"] : [];
    },
    perfectSlide: "Round terms: instrument, amount raised, pre- and post-money (or cap and discount for a SAFE, stating pre- or post-money SAFE), option-pool top-up, lead investor and committed amount.",
  },
  use_of_funds: {
    label: "Use of funds",
    detect: (c) => (arr(c.deal.financing?.useOfFunds).length ? ["financing.useOfFunds"] : []),
    perfectSlide: "Use of funds: allocation by category in $ and % (summing to 100%), monthly burn by quarter, hires by function and quarter, and the milestone the round buys with its month.",
  },
  cap_table: {
    label: "Cap table",
    detect: (c) => {
      const vis = arr(c.deal.forensics?.visualElements).some((v) => v?.kind === "CAP_TABLE");
      const claims = c.claims.filter((x) => /\b(cap table|fully[- ]diluted|founders own|ownership)\b/i.test(x.statement));
      return vis ? ["forensics.visualElements.CAP_TABLE"] : claims.map((x) => x.id);
    },
    perfectSlide: "Cap table: fully-diluted ownership by founder, employee pool (granted / unallocated), each investor and each SAFE/note with its cap and discount, before and after this round.",
  },
  product_proof: {
    label: "Product proof",
    detect: (c) => {
      const lvl = c.deal.forensics?.productProof?.level;
      const measured = arr(c.deal.product?.valueQuantification).some((v) => v?.evidenceStatus === "MEASURED");
      const verified = c.claims.some((x) => (x.category === "PRODUCT" || x.category === "TECHNOLOGY") && x.verification === "VERIFIED");
      // Live recurring revenue or paying customers in production is product proof by itself.
      const live = ["arr", "mrr", "revenue_ttm", "paying_customers", "units_shipped"].map((k) => c.primary(k)).find((m) => m && m.basis !== "SIGNED" && m.basis !== "BOOKED");
      if (live) return [live.id];
      return lvl === "DEMO" || lvl === "PRODUCTION_USAGE" || lvl === "REAL_INTEGRATIONS" || measured || verified ? ["product"] : [];
    },
    perfectSlide: "Product proof: screenshots of the live product in a customer's workflow, the integrations in production, usage per active customer, and one measured before/after outcome with its baseline and measurement period.",
  },
  market_sizing: {
    label: "Market sizing",
    detect: (c) => (isNum(c.deal.deckMarket?.tam?.amount) || c.deal.market?.bottomUp ? ["deckMarket.tam"] : []),
    perfectSlide: "Market sizing, bottom-up: number of target customers (with source) × realistic annual spend (from current pricing), SAM as the segment reachable with today's product and channel, SOM as the share reachable in 5 years.",
  },
  pricing: {
    label: "Pricing",
    detect: (c) => (str(c.deal.businessModel?.pricing).trim() ? ["businessModel.pricing"] : []),
    perfectSlide: "Pricing: price list by tier/unit, realized average price after discounts, contract length and billing terms, and how price has changed across the last 10 deals.",
  },
  revenue: {
    label: "Revenue / ARR",
    metricKeys: ["arr", "mrr", "revenue_ttm"],
    perfectSlide: "Revenue: current ARR (active, live, recurring only) with as-of date, split from one-time/services revenue and from signed-not-live contracts.",
  },
  arr_history: {
    label: "Revenue history",
    detect: (c) => {
      for (const k of ["arr", "mrr", "revenue_ttm"]) {
        const s = c.series(k);
        if (s.length >= 2) return s.map((p) => p.ref);
      }
      return [];
    },
    perfectSlide: "Revenue history: monthly (or quarterly) ARR/MRR for the last 12–24 months as a table, with new, expansion, contraction and churned ARR per period.",
  },
  usage_growth: {
    label: "Growth rate",
    metricKeys: ["mom_growth", "arr_growth_yoy", "revenue_growth_yoy"],
    perfectSlide: "Growth: month-over-month revenue and active usage for the last 12 months with the measurement window stated, not a single best month.",
  },
  paying_customers: {
    label: "Paying customers",
    metricKeys: ["paying_customers", "active_accounts"],
    perfectSlide: "Customers: count of paying customers in production by quarter, separated from pilots, LOIs and free users, with the definition of 'customer'.",
  },
  named_customers: {
    label: "Named paying customers",
    detect: (c) =>
      arr(c.deal.customers?.namedCustomers)
        .filter((n) => ["PAYING", "RECURRING", "DEPLOYED", "REFERENCEABLE"].includes(n.evidenceLevel))
        .map((n) => `customer:${n.name}`),
    perfectSlide: "Customer list: each named customer with status (pilot / signed / deployed / paying / renewed), start date, ARR and use case — logos only for customers that pay.",
  },
  references: {
    label: "Customer references",
    detect: (c) => {
      const note = str(c.deal.customers?.referencesNote).trim();
      const refable = arr(c.deal.customers?.namedCustomers).some((n) => n.evidenceLevel === "REFERENCEABLE");
      return refable || (note && !/\b(none|no references|not provided|unknown)\b/i.test(note)) ? ["customers.referencesNote"] : [];
    },
    perfectSlide: "References: 3–5 customers willing to take a call, including at least one not selected by the company and one that churned or downsized, with the contact's role.",
  },
  pilot_conversion: {
    label: "Pilot → production conversion",
    metricKeys: ["pilot_to_production_rate", "pilots"],
    perfectSlide: "Pilot funnel: every pilot started, its length, whether it converted to a paid production contract, conversion rate with denominator, and time from pilot start to paid.",
  },
  gross_margin: {
    label: "Gross margin",
    metricKeys: ["gross_margin", "contribution_margin"],
    perfectSlide: "Gross margin bridge: revenue minus hosting, inference/compute, third-party APIs, customer support, implementation and human-in-the-loop operations, by quarter.",
  },
  retention: {
    label: "Net / gross revenue retention",
    metricKeys: ["nrr", "grr", "logo_retention"],
    perfectSlide: "Retention: NRR and GRR over a trailing 12-month window with the number of customers in the base, plus logo churn, stated separately.",
  },
  cohort_retention: {
    label: "Cohort retention table",
    detect: (c) =>
      ["nrr", "grr", "logo_retention", "d30_retention"]
        .map((k) => c.primary(k))
        .filter((m): m is MetricInstance => !!m && !hasFlag(m, "NO_COHORT_DEFINITION") && (!!m.cohortDefinition || COHORT_TEXT.test(metricText(m))))
        .map((m) => m.id),
    perfectSlide: "Quarterly cohort table: for each customer cohort since launch, starting ARR, expansion, contraction, churn, current ARR, gross and net retention; with customer counts.",
  },
  acv: {
    label: "ACV / contract size",
    metricKeys: ["acv"],
    perfectSlide: "Contract size: ACV distribution (median and range) by segment for the last 20 deals, list vs realized price, and contract length.",
  },
  arpu: {
    label: "ARPU",
    metricKeys: ["arpu_monthly", "acv"],
    perfectSlide: "Monetization: monthly ARPU for paying users by cohort and plan, with the share of users paying.",
  },
  sales_cycle: {
    label: "Sales cycle",
    detect: (c) => (c.primary("sales_cycle_days") ? [c.primary("sales_cycle_days")!.id] : parseDurationDays(c.deal.gtm?.salesCycle) !== null ? ["gtm.salesCycle"] : []),
    perfectSlide: "Sales cycle: median days from first meeting to signed contract and from signature to go-live for the last 10–20 deals, by segment.",
  },
  pipeline_funnel: {
    label: "Pipeline / GTM funnel",
    metricKeys: ["pipeline_value", "win_rate"],
    perfectSlide: "Pipeline & funnel: qualified pipeline by stage with value and age, stage-to-stage conversion rates with counts, win rate, and quota-carrying reps with attainment.",
  },
  cac_payback: {
    label: "CAC / payback",
    metricKeys: ["cac", "cac_payback_months", "ltv_to_cac", "magic_number"],
    perfectSlide: "Unit economics: fully-loaded CAC (sales and marketing salaries, commissions, tools, paid media) by channel, gross-margin-adjusted payback in months, by quarter.",
  },
  burn_multiple: {
    label: "Burn multiple / capital efficiency",
    metricKeys: ["burn_multiple"],
    perfectSlide: "Capital efficiency: net burn and net new ARR by quarter for the last 4–6 quarters, with the resulting burn multiple.",
  },
  cash_and_burn: {
    label: "Cash & burn",
    detect: (c) => {
      const cash = isNum(c.deal.financing?.cashBalance?.amount) ? "financing.cashBalance" : c.primary("cash_balance")?.id;
      const burn = isNum(c.deal.financing?.monthlyBurn?.amount) ? "financing.monthlyBurn" : c.primary("monthly_net_burn")?.id;
      const runway = isNum(c.deal.financing?.runwayClaimMonths) ? "financing.runwayClaimMonths" : c.primary("runway_months")?.id;
      return (cash && burn) || runway ? [cash, burn, runway].filter((x): x is string => !!x) : [];
    },
    perfectSlide: "Cash position: cash in bank with date, monthly net burn for the last 6 months, pre-round runway, and planned burn after the round by quarter.",
  },
  customer_concentration: {
    label: "Customer concentration",
    detect: (c) => {
      const m = c.primary("customer_concentration_top1") ?? c.primary("customer_concentration_top5");
      return m ? [m.id] : str(c.deal.customers?.concentrationNote).trim() ? ["customers.concentrationNote"] : [];
    },
    perfectSlide: "Concentration: revenue share of the top 1, top 5 and top 10 customers, with contract end dates for the top 5.",
  },
  services_mix: {
    label: "Services vs software mix",
    metricKeys: ["services_revenue_share"],
    perfectSlide: "Revenue mix: recurring software, usage, implementation and services revenue by quarter, with gross margin for each line.",
  },
  founder_led_share: {
    label: "Founder-led sales share",
    metricKeys: ["founder_led_revenue_share"],
    perfectSlide: "Sales team: share of new ARR closed by founders vs hired reps in the last 4 quarters, rep ramp time and attainment.",
  },
  headcount: {
    label: "Headcount",
    metricKeys: ["headcount"],
    perfectSlide: "Org: headcount by function today and planned per quarter after the round, with fully-loaded cost.",
  },
  engagement: {
    label: "Engagement (DAU / MAU)",
    metricKeys: ["dau", "mau", "dau_mau"],
    perfectSlide: "Engagement: DAU, WAU, MAU and DAU/MAU by month for 12 months, with the definition of 'active'.",
  },
  consumer_retention: {
    label: "User retention curves",
    metricKeys: ["d1_retention", "d7_retention", "d30_retention"],
    perfectSlide: "Retention curves: D1/D7/D30/D90 retention by monthly signup cohort with cohort sizes, split organic vs paid.",
  },
  organic_share: {
    label: "Organic acquisition share",
    metricKeys: ["organic_acquisition_share"],
    perfectSlide: "Acquisition mix: new users by channel per month (organic, referral, paid) with blended and paid CAC.",
  },
  gmv: {
    label: "GMV",
    metricKeys: ["gmv"],
    perfectSlide: "Marketplace volume: monthly GMV, net revenue and take rate for 12–24 months, split by new vs repeat buyers.",
  },
  take_rate: {
    label: "Take rate",
    metricKeys: ["take_rate"],
    perfectSlide: "Take rate: net revenue / GMV by month and segment, including incentives, refunds and payment costs.",
  },
  repeat_rate: {
    label: "Repeat rate",
    metricKeys: ["repeat_rate"],
    perfectSlide: "Repeat behavior: share of GMV and of buyers from repeat customers, by monthly cohort with cohort sizes.",
  },
  fill_rate: {
    label: "Fill / match rate",
    metricKeys: ["fill_rate"],
    perfectSlide: "Liquidity: fill (match) rate and time-to-match by market/segment and month.",
  },
  tpv: {
    label: "TPV",
    metricKeys: ["tpv"],
    perfectSlide: "Payment volume: monthly TPV, net revenue and net take rate for 12–24 months, with top-merchant concentration.",
  },
  active_accounts: {
    label: "Active accounts",
    metricKeys: ["active_accounts"],
    perfectSlide: "Accounts: funded / active accounts by month with the activity definition and cohort retention.",
  },
  credit_losses: {
    label: "Credit losses",
    metricKeys: ["default_rate", "loss_rate"],
    perfectSlide: "Credit performance: vintage loss curves by origination month, 30/60/90-day delinquency and net charge-offs.",
  },
  units_shipped: {
    label: "Units shipped",
    metricKeys: ["units_shipped"],
    perfectSlide: "Deployments: units shipped and in operation by quarter, per customer, with uptime.",
  },
  asp: {
    label: "ASP & hardware margin",
    metricKeys: ["asp"],
    perfectSlide: "Unit economics: ASP, bill of materials and unit gross margin today and at planned volumes, with recurring software/service revenue per unit.",
  },
  backlog: {
    label: "Backlog / orders",
    metricKeys: ["backlog"],
    perfectSlide: "Order book: backlog by customer with status (LOI / PO / paid deposit), cancellation terms and delivery dates.",
  },
  defect_rate: {
    label: "Quality / defect rate",
    metricKeys: ["defect_rate"],
    perfectSlide: "Reliability: field failure / defect rate and mean time between failures by product version.",
  },
  milestone_capital: {
    label: "Capital & time to milestone",
    detect: (c) => {
      const m = c.primary("capital_to_next_milestone") ?? c.primary("months_to_next_milestone");
      return m ? [m.id] : isNum(c.deal.financingPath?.milestoneMonths) ? ["financingPath.milestoneMonths"] : [];
    },
    perfectSlide: "Milestone plan: the next value-inflection milestone, its date, capital required with contingency, and what happens if it slips 6 months.",
  },
  regulatory_path: {
    label: "Regulatory pathway",
    detect: (c) => c.claims.filter((x) => x.category === "REGULATORY").map((x) => x.id),
    perfectSlide: "Regulatory path: required approvals/licences, pathway chosen, status of each submission, expected dates and precedent products.",
  },
  ip: {
    label: "IP position",
    detect: (c) => {
      const claims = c.claims.filter((x) => x.category === "IP").map((x) => x.id);
      return claims.length ? claims : arr(c.deal.moat).some((m) => m?.dimension === "TECHNOLOGY_IP") ? ["moat.TECHNOLOGY_IP"] : [];
    },
    perfectSlide: "IP: patents filed/granted with numbers and jurisdictions, ownership (company vs university licence), freedom-to-operate status.",
  },
};

type StageSpec = { E: EvidenceItemId[]; N: EvidenceItemId[] };
type ProfileSpec = Record<StageBand, StageSpec>;

const BASE_EARLY: EvidenceItemId[] = ["team", "round_terms", "use_of_funds"];
/** From Series A on, every profile is expected to show the product works (live revenue counts). */
const BASE_GROWTH: EvidenceItemId[] = [...BASE_EARLY, "product_proof"];

function late(growth: StageSpec, addE: EvidenceItemId[], n: EvidenceItemId[]): StageSpec {
  const E = [...new Set([...growth.E, ...addE])];
  return { E, N: n.filter((x) => !E.includes(x)) };
}

const ENTERPRISE_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "revenue", "arr_history", "paying_customers", "gross_margin", "retention", "acv", "sales_cycle", "cac_payback", "cash_and_burn", "customer_concentration"],
  N: ["cohort_retention", "pipeline_funnel", "burn_multiple", "pricing", "headcount", "references", "cap_table", "named_customers", "pilot_conversion", "services_mix"],
};
const PLG_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "revenue", "arr_history", "paying_customers", "gross_margin", "retention", "arpu", "usage_growth", "cac_payback", "cash_and_burn"],
  N: ["cohort_retention", "organic_share", "burn_multiple", "pricing", "engagement", "headcount", "cap_table"],
};
const INFRA_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "revenue", "arr_history", "paying_customers", "gross_margin", "retention", "usage_growth", "cash_and_burn"],
  N: ["cohort_retention", "acv", "pricing", "burn_multiple", "customer_concentration", "engagement", "headcount"],
};
const CONSUMER_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "engagement", "consumer_retention", "organic_share", "usage_growth", "cash_and_burn"],
  N: ["revenue", "arpu", "cac_payback", "cohort_retention", "gross_margin", "headcount"],
};
const MARKETPLACE_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "gmv", "take_rate", "revenue", "repeat_rate", "usage_growth", "arr_history", "cash_and_burn"],
  N: ["fill_rate", "cac_payback", "cohort_retention", "gross_margin", "headcount", "customer_concentration"],
};
const FINTECH_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "tpv", "active_accounts", "revenue", "take_rate", "gross_margin", "arr_history", "cash_and_burn", "regulatory_path"],
  N: ["credit_losses", "cohort_retention", "cac_payback", "headcount", "customer_concentration"],
};
const HARDWARE_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "milestone_capital", "units_shipped", "asp", "backlog", "gross_margin", "revenue", "cash_and_burn", "pilot_conversion"],
  N: ["defect_rate", "named_customers", "ip", "customer_concentration", "headcount"],
};
const BIO_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "milestone_capital", "regulatory_path", "ip", "cash_and_burn"],
  N: ["cap_table", "headcount", "named_customers"],
};
const GENERAL_GROWTH: StageSpec = {
  E: [...BASE_GROWTH, "revenue", "arr_history", "paying_customers", "gross_margin", "cash_and_burn"],
  N: ["retention", "acv", "customer_concentration", "headcount", "cap_table", "cac_payback"],
};

export const EXPECTED_EVIDENCE: Record<ProfileId, ProfileSpec> = {
  ENTERPRISE_SAAS: {
    EARLY: { E: [...BASE_EARLY, "product_proof"], N: ["revenue", "paying_customers", "pilot_conversion", "pricing", "named_customers", "market_sizing", "cash_and_burn", "acv"] },
    GROWTH: ENTERPRISE_GROWTH,
    LATE: late(ENTERPRISE_GROWTH, ["cohort_retention", "burn_multiple", "pipeline_funnel", "headcount", "references", "cap_table", "services_mix"], ["pricing", "named_customers", "founder_led_share", "pilot_conversion"]),
  },
  SMB_PLG_SAAS: {
    EARLY: { E: [...BASE_EARLY, "product_proof"], N: ["revenue", "paying_customers", "usage_growth", "pricing", "engagement", "cash_and_burn"] },
    GROWTH: PLG_GROWTH,
    LATE: late(PLG_GROWTH, ["cohort_retention", "burn_multiple", "organic_share", "headcount", "cap_table"], ["pricing", "engagement", "references"]),
  },
  DEVELOPER_INFRA: {
    EARLY: { E: [...BASE_EARLY, "product_proof"], N: ["usage_growth", "revenue", "paying_customers", "pricing", "engagement"] },
    GROWTH: INFRA_GROWTH,
    LATE: late(INFRA_GROWTH, ["cohort_retention", "acv", "burn_multiple", "customer_concentration", "headcount", "cap_table", "cac_payback"], ["pricing", "engagement", "pipeline_funnel"]),
  },
  CONSUMER: {
    EARLY: { E: [...BASE_EARLY, "product_proof"], N: ["engagement", "consumer_retention", "organic_share", "usage_growth"] },
    GROWTH: CONSUMER_GROWTH,
    LATE: late(CONSUMER_GROWTH, ["revenue", "arpu", "cac_payback", "cohort_retention", "gross_margin", "arr_history", "headcount", "cap_table", "burn_multiple"], ["pricing"]),
  },
  MARKETPLACE: {
    EARLY: { E: [...BASE_EARLY, "product_proof"], N: ["gmv", "take_rate", "repeat_rate", "usage_growth", "fill_rate"] },
    GROWTH: MARKETPLACE_GROWTH,
    LATE: late(MARKETPLACE_GROWTH, ["fill_rate", "cac_payback", "cohort_retention", "gross_margin", "headcount", "cap_table", "customer_concentration", "burn_multiple"], ["pricing"]),
  },
  FINTECH: {
    EARLY: { E: [...BASE_EARLY, "product_proof", "regulatory_path"], N: ["tpv", "active_accounts", "revenue", "take_rate"] },
    GROWTH: FINTECH_GROWTH,
    LATE: late(FINTECH_GROWTH, ["cohort_retention", "cac_payback", "headcount", "cap_table", "burn_multiple", "customer_concentration"], ["credit_losses", "pricing"]),
  },
  HARDWARE_ROBOTICS: {
    EARLY: { E: [...BASE_EARLY, "product_proof", "milestone_capital"], N: ["pilot_conversion", "named_customers", "backlog", "ip", "asp"] },
    GROWTH: HARDWARE_GROWTH,
    LATE: late(HARDWARE_GROWTH, ["defect_rate", "customer_concentration", "headcount", "cap_table", "arr_history"], ["ip", "references"]),
  },
  BIOTECH_MEDTECH: {
    EARLY: { E: [...BASE_EARLY, "milestone_capital", "regulatory_path", "ip"], N: ["product_proof", "cash_and_burn"] },
    GROWTH: BIO_GROWTH,
    LATE: late(BIO_GROWTH, ["cap_table", "headcount"], ["revenue", "named_customers"]),
  },
  GENERAL: {
    EARLY: { E: BASE_EARLY, N: ["revenue", "paying_customers", "product_proof", "pricing", "cash_and_burn"] },
    GROWTH: GENERAL_GROWTH, // product_proof is NICE at EARLY for GENERAL, EXPECTED from GROWTH
    LATE: late(GENERAL_GROWTH, ["retention", "customer_concentration", "headcount", "cap_table", "cohort_retention", "burn_multiple"], ["acv", "cac_payback"]),
  },
};

export function expectationLevel(profile: ProfileId, band: StageBand, item: EvidenceItemId): ExpectationLevel {
  const spec = EXPECTED_EVIDENCE[profile]?.[band];
  if (!spec) return "NOT_YET_EXPECTED";
  if (spec.E.includes(item)) return "EXPECTED";
  if (spec.N.includes(item)) return "NICE_TO_HAVE";
  return "NOT_YET_EXPECTED";
}

const MISSING_SEVERITY: Record<StageBand, IntegritySeverity> = { EARLY: "LOW", GROWTH: "MODERATE", LATE: "HIGH" };

function presenceOf(ctx: IntegrityContext, spec: ItemSpec): { presence: EvidencePresence; refs: string[] } {
  const refs: string[] = [];
  for (const k of spec.metricKeys ?? []) {
    const m = ctx.primary(k);
    if (m) refs.push(m.id);
  }
  if (spec.detect) refs.push(...spec.detect(ctx));
  if (refs.length) return { presence: "PRESENT", refs: [...new Set(refs)] };
  const keys = spec.metricKeys ?? [];
  const withheld =
    ctx.metrics.some((m) => keys.includes(m.metricKey) && m.state === "WITHHELD") ||
    ctx.observations.some((o) => keys.includes(o.metricKey) && o.state === "WITHHELD");
  return { presence: withheld ? "WITHHELD" : "MISSING", refs: [] };
}

const STAGE_TEXT: Record<StageBand, string> = { EARLY: "pre-seed/seed", GROWTH: "Series A", LATE: "Series B+" };

export function expectedEvidence(ctx: IntegrityContext): { result: ExpectedEvidenceResult; findings: IntegrityFinding[] } {
  const items: ExpectedEvidenceItemResult[] = [];
  const findings: IntegrityFinding[] = [];
  for (const id of EVIDENCE_ITEM_IDS) {
    const level = expectationLevel(ctx.profile, ctx.stageBand, id);
    const spec = EVIDENCE_ITEMS[id];
    const { presence, refs } = presenceOf(ctx, spec);
    const gap = presence !== "PRESENT";
    const severity = gap && level === "EXPECTED" ? MISSING_SEVERITY[ctx.stageBand] : null;
    const perfectSlide = gap && level !== "NOT_YET_EXPECTED" ? spec.perfectSlide : null;
    if (level === "NOT_YET_EXPECTED" && presence !== "PRESENT") continue;
    items.push({ itemId: id, label: spec.label, level, presence, refs, severity, perfectSlide });
    if (severity)
      findings.push(
        finding({
          kind: presence === "WITHHELD" ? "EXPECTED_EVIDENCE_WITHHELD" : "EXPECTED_EVIDENCE_MISSING",
          module: "EXPECTED_EVIDENCE",
          severity,
          title: `${presence === "WITHHELD" ? "Withheld" : "Missing"} for a ${STAGE_TEXT[ctx.stageBand]} deck: ${spec.label}`,
          detail: `${spec.label} is expected at this stage for this business model${presence === "WITHHELD" ? " and the company explicitly withheld it" : ""}. Perfect slide: ${spec.perfectSlide}`,
          key: id,
        }),
      );
  }
  const result: ExpectedEvidenceResult = {
    version: EXPECTED_EVIDENCE_VERSION,
    profile: ctx.profile,
    stageBand: ctx.stageBand,
    items,
    missingExpected: items.filter((i) => i.level === "EXPECTED" && i.presence === "MISSING").map((i) => i.itemId),
    withheldExpected: items.filter((i) => i.level === "EXPECTED" && i.presence === "WITHHELD").map((i) => i.itemId),
    missingNiceToHave: items.filter((i) => i.level === "NICE_TO_HAVE" && i.presence !== "PRESENT").map((i) => i.itemId),
    perfectSlides: items.filter((i) => i.perfectSlide).map((i) => ({ itemId: i.itemId, label: i.label, slide: i.perfectSlide! })),
  };
  return { result, findings };
}
