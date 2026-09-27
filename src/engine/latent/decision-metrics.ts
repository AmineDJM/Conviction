/**
 * DECISION metrics expected per peer group (profile × stage band) and the
 * VANITY lexicon. Owned by the latent engine so it does not depend on the
 * integrity engine for compilation. INTERNAL_POLICY: a table of what an
 * institutional investor needs to decide, not a benchmark distribution.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { ProfileId, StageBand } from "../benchmarks/types";
import type { MetricKey } from "../metrics/keys";
import { CURRENT_BASES, FORWARD_BASES_SET, isFuture, lower, obsText, pageFromLocation, pagesOf } from "./util";

export type SlotFamily =
  | "REVENUE"
  | "GROWTH"
  | "RETENTION"
  | "CUSTOMERS"
  | "DEAL_SIZE"
  | "UNIT_ECONOMICS"
  | "MARGIN"
  | "CASH"
  | "SALES_MOTION"
  | "CONCENTRATION"
  | "ENGAGEMENT"
  | "ACQUISITION"
  | "LIQUIDITY"
  | "MONETIZATION"
  | "VOLUME"
  | "CREDIT"
  | "OPERATIONS"
  | "MILESTONE";

export const FAMILY_NOUN: Record<SlotFamily, string> = {
  REVENUE: "Revenue",
  GROWTH: "Growth-rate",
  RETENTION: "Retention",
  CUSTOMERS: "Customer-count",
  DEAL_SIZE: "Deal-size",
  UNIT_ECONOMICS: "Unit-economics",
  MARGIN: "Gross-margin",
  CASH: "Burn / runway",
  SALES_MOTION: "Sales-cycle",
  CONCENTRATION: "Concentration",
  ENGAGEMENT: "Engagement",
  ACQUISITION: "Acquisition-mix",
  LIQUIDITY: "Liquidity",
  MONETIZATION: "Take-rate",
  VOLUME: "Volume",
  CREDIT: "Credit-loss",
  OPERATIONS: "Operational-quality",
  MILESTONE: "Milestone-cost",
};

/** Decision importance of a family when several omissions share a severity (0 = most important). */
export const FAMILY_PRIORITY: Record<SlotFamily, number> = {
  RETENTION: 0,
  REVENUE: 1,
  MONETIZATION: 1,
  CREDIT: 1,
  MILESTONE: 1,
  UNIT_ECONOMICS: 2,
  MARGIN: 2,
  VOLUME: 2,
  ENGAGEMENT: 2,
  GROWTH: 3,
  CUSTOMERS: 3,
  CASH: 3,
  LIQUIDITY: 3,
  DEAL_SIZE: 4,
  SALES_MOTION: 4,
  CONCENTRATION: 4,
  ACQUISITION: 4,
  OPERATIONS: 4,
};

export interface DecisionSlot {
  id: string;
  label: string;
  family: SlotFamily;
  /** Alternatives: any one present satisfies the slot. */
  keys: MetricKey[];
  /** Cohort tables (cohortDefinition or "cohort" in the label) also satisfy the slot. */
  cohortEvidence?: boolean;
  /** Only meaningful once the company has revenue. */
  requiresRevenue?: boolean;
  /** What the metric evidences, used in omission sentences. */
  why: string;
}

const S = (s: DecisionSlot) => s;

export const SLOT_CATALOG = {
  revenue: S({ id: "revenue", label: "ARR / revenue", family: "REVENUE", keys: ["arr", "mrr", "revenue_ttm"], requiresRevenue: true, why: "the current scale of recurring revenue" }),
  net_revenue: S({ id: "net_revenue", label: "Net revenue", family: "REVENUE", keys: ["revenue_ttm", "arr", "mrr"], requiresRevenue: true, why: "what the company keeps after paying the supply side or partners" }),
  growth: S({ id: "growth", label: "Revenue growth rate", family: "GROWTH", keys: ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"], requiresRevenue: true, why: "the speed at which revenue compounds" }),
  customers: S({ id: "customers", label: "Paying customers", family: "CUSTOMERS", keys: ["paying_customers"], why: "how many customers actually pay" }),
  acv: S({ id: "acv", label: "ACV / ARPA", family: "DEAL_SIZE", keys: ["acv", "arpu_monthly"], requiresRevenue: true, why: "what a customer is worth per year" }),
  retention: S({ id: "retention", label: "NRR / GRR", family: "RETENTION", keys: ["nrr", "grr", "logo_retention"], cohortEvidence: true, requiresRevenue: true, why: "whether revenue from existing customers holds or grows over time" }),
  gross_margin: S({ id: "gross_margin", label: "Gross margin", family: "MARGIN", keys: ["gross_margin"], requiresRevenue: true, why: "whether revenue scales without proportional delivery cost" }),
  cac_payback: S({ id: "cac_payback", label: "CAC payback / CAC", family: "UNIT_ECONOMICS", keys: ["cac_payback_months", "cac", "ltv_to_cac", "magic_number"], requiresRevenue: true, why: "whether acquiring a customer pays back" }),
  sales_cycle: S({ id: "sales_cycle", label: "Sales cycle", family: "SALES_MOTION", keys: ["sales_cycle_days", "win_rate"], requiresRevenue: true, why: "how repeatable and fast the sales motion is" }),
  burn: S({ id: "burn", label: "Burn / runway", family: "CASH", keys: ["burn_multiple", "monthly_net_burn", "runway_months", "cash_balance"], why: "how much capital the plan consumes" }),
  concentration: S({ id: "concentration", label: "Customer concentration", family: "CONCENTRATION", keys: ["customer_concentration_top1", "customer_concentration_top5"], requiresRevenue: true, why: "dependence on a few accounts" }),
  consumer_retention: S({ id: "consumer_retention", label: "D30 / D7 retention", family: "RETENTION", keys: ["d30_retention", "d7_retention", "d1_retention"], cohortEvidence: true, why: "whether users come back after trying the product" }),
  active_users: S({ id: "active_users", label: "Active users (MAU / DAU)", family: "ENGAGEMENT", keys: ["mau", "dau"], why: "how many people actually use the product" }),
  stickiness: S({ id: "stickiness", label: "DAU / MAU", family: "ENGAGEMENT", keys: ["dau_mau"], why: "habit strength" }),
  organic: S({ id: "organic", label: "Organic acquisition share", family: "ACQUISITION", keys: ["organic_acquisition_share"], why: "whether growth depends on paid acquisition" }),
  consumer_monetization: S({ id: "consumer_monetization", label: "ARPU / revenue", family: "REVENUE", keys: ["arpu_monthly", "revenue_ttm", "mrr", "arr"], requiresRevenue: true, why: "whether usage converts into revenue" }),
  gmv: S({ id: "gmv", label: "GMV", family: "VOLUME", keys: ["gmv"], why: "transaction volume through the platform" }),
  take_rate: S({ id: "take_rate", label: "Take rate", family: "MONETIZATION", keys: ["take_rate"], why: "how much of the volume the company keeps" }),
  repeat_rate: S({ id: "repeat_rate", label: "Repeat rate", family: "RETENTION", keys: ["repeat_rate"], why: "whether buyers come back" }),
  fill_rate: S({ id: "fill_rate", label: "Fill / match rate", family: "LIQUIDITY", keys: ["fill_rate"], why: "whether the marketplace is liquid" }),
  contribution_margin: S({ id: "contribution_margin", label: "Contribution margin", family: "UNIT_ECONOMICS", keys: ["contribution_margin"], requiresRevenue: true, why: "whether a transaction makes money after variable costs" }),
  cohort_retention: S({ id: "cohort_retention", label: "Cohort retention", family: "RETENTION", keys: ["logo_retention", "nrr", "grr", "d30_retention"], cohortEvidence: true, why: "whether cohorts keep transacting" }),
  tpv: S({ id: "tpv", label: "TPV", family: "VOLUME", keys: ["tpv", "gmv"], why: "payment volume processed" }),
  loss_rate: S({ id: "loss_rate", label: "Loss / default rate", family: "CREDIT", keys: ["loss_rate", "default_rate"], why: "credit and fraud losses" }),
  active_accounts: S({ id: "active_accounts", label: "Active accounts", family: "CUSTOMERS", keys: ["active_accounts", "paying_customers"], why: "how many accounts actually transact" }),
  backlog: S({ id: "backlog", label: "Backlog / contracted orders", family: "VOLUME", keys: ["backlog", "contracted_arr"], why: "committed future demand" }),
  hw_revenue: S({ id: "hw_revenue", label: "Revenue", family: "REVENUE", keys: ["revenue_ttm", "arr", "mrr"], requiresRevenue: true, why: "the current scale of sales" }),
  units: S({ id: "units", label: "Units shipped", family: "OPERATIONS", keys: ["units_shipped"], why: "delivered volume" }),
  asp: S({ id: "asp", label: "ASP", family: "DEAL_SIZE", keys: ["asp"], why: "price realised per unit" }),
  defect_rate: S({ id: "defect_rate", label: "Defect rate", family: "OPERATIONS", keys: ["defect_rate"], why: "field quality at volume" }),
  capital_to_milestone: S({ id: "capital_to_milestone", label: "Capital to next milestone", family: "MILESTONE", keys: ["capital_to_next_milestone"], why: "the capital required to reach the next de-risking event" }),
  months_to_milestone: S({ id: "months_to_milestone", label: "Months to next milestone", family: "MILESTONE", keys: ["months_to_next_milestone"], why: "the time to the next de-risking event" }),
  runway: S({ id: "runway", label: "Runway / burn", family: "CASH", keys: ["runway_months", "cash_balance", "monthly_net_burn"], why: "whether the cash reaches the milestone" }),
} satisfies Record<string, DecisionSlot>;

type SlotId = keyof typeof SLOT_CATALOG;
const T = (entries: [SlotId, StageBand][]) => entries.map(([id, from]) => ({ slot: SLOT_CATALOG[id] as DecisionSlot, from }));

/** Per profile: slot and the first stage band at which an institutional investor expects it. */
export const DECISION_TABLE: Record<ProfileId, { slot: DecisionSlot; from: StageBand }[]> = {
  ENTERPRISE_SAAS: T([["revenue", "EARLY"], ["growth", "EARLY"], ["customers", "EARLY"], ["burn", "EARLY"], ["acv", "GROWTH"], ["retention", "GROWTH"], ["gross_margin", "GROWTH"], ["cac_payback", "GROWTH"], ["sales_cycle", "GROWTH"], ["concentration", "GROWTH"]]),
  SMB_PLG_SAAS: T([["revenue", "EARLY"], ["growth", "EARLY"], ["customers", "EARLY"], ["burn", "EARLY"], ["retention", "GROWTH"], ["gross_margin", "GROWTH"], ["cac_payback", "GROWTH"], ["acv", "GROWTH"]]),
  DEVELOPER_INFRA: T([["revenue", "EARLY"], ["growth", "EARLY"], ["customers", "EARLY"], ["burn", "EARLY"], ["retention", "GROWTH"], ["gross_margin", "GROWTH"], ["cac_payback", "LATE"], ["concentration", "LATE"]]),
  CONSUMER: T([["active_users", "EARLY"], ["consumer_retention", "EARLY"], ["burn", "EARLY"], ["stickiness", "GROWTH"], ["organic", "GROWTH"], ["consumer_monetization", "GROWTH"], ["cac_payback", "GROWTH"]]),
  MARKETPLACE: T([["gmv", "EARLY"], ["take_rate", "EARLY"], ["net_revenue", "EARLY"], ["repeat_rate", "EARLY"], ["burn", "EARLY"], ["fill_rate", "GROWTH"], ["contribution_margin", "GROWTH"], ["cohort_retention", "GROWTH"], ["cac_payback", "GROWTH"]]),
  FINTECH: T([["tpv", "EARLY"], ["take_rate", "EARLY"], ["net_revenue", "EARLY"], ["active_accounts", "EARLY"], ["burn", "EARLY"], ["loss_rate", "GROWTH"], ["cohort_retention", "GROWTH"], ["cac_payback", "GROWTH"]]),
  HARDWARE_ROBOTICS: T([["backlog", "EARLY"], ["burn", "EARLY"], ["hw_revenue", "GROWTH"], ["gross_margin", "GROWTH"], ["units", "GROWTH"], ["asp", "GROWTH"], ["defect_rate", "GROWTH"]]),
  BIOTECH_MEDTECH: T([["capital_to_milestone", "EARLY"], ["months_to_milestone", "EARLY"], ["runway", "EARLY"]]),
  GENERAL: T([["revenue", "EARLY"], ["growth", "EARLY"], ["customers", "EARLY"], ["burn", "EARLY"], ["gross_margin", "GROWTH"], ["retention", "GROWTH"], ["cac_payback", "LATE"]]),
};

export const STAGE_RANK: Record<StageBand, number> = { EARLY: 0, GROWTH: 1, LATE: 2 };

/* ---------------------------------------------------------------- */
/* Presence of a metric key in the deck                               */
/* ---------------------------------------------------------------- */

export type PresenceStatus = "PRESENT" | "STALE" | "WITHHELD" | "NOT_APPLICABLE" | "FORWARD_ONLY" | "ABSENT";
const PRESENCE_RANK: Record<PresenceStatus, number> = { PRESENT: 0, STALE: 1, WITHHELD: 2, NOT_APPLICABLE: 3, FORWARD_ONLY: 4, ABSENT: 5 };

export interface KeyPresence {
  key: string;
  status: PresenceStatus;
  pages: number[];
  shownAs: string | null;
}

/** Presence of every metric key, from normalized metrics and the raw observation audit trail. */
export function keyPresence(deal: CanonicalDeal, asOf: Date): Map<string, KeyPresence> {
  const out = new Map<string, KeyPresence>();
  const put = (key: string, status: PresenceStatus, page: number | null, shownAs: string | null) => {
    const cur = out.get(key);
    if (!cur || PRESENCE_RANK[status] < PRESENCE_RANK[cur.status]) out.set(key, { key, status, pages: pagesOf([...(cur?.pages ?? []), page]), shownAs: shownAs ?? cur?.shownAs ?? null });
    else if (cur && PRESENCE_RANK[status] === PRESENCE_RANK[cur.status]) cur.pages = pagesOf([...cur.pages, page]);
  };
  for (const m of deal.metrics ?? []) {
    const page = pageFromLocation(m.location);
    if (m.state === "WITHHELD") put(m.metricKey, "WITHHELD", page, null);
    else if (m.state === "NOT_APPLICABLE" || m.state === "NOT_YET_MEANINGFUL") put(m.metricKey, "NOT_APPLICABLE", page, null);
    else if (!CURRENT_BASES.has(m.basis) || m.periodType === "CUMULATIVE" || m.qualityFlags.some((f) => f.startsWith("CUMULATIVE_NOT_RUN_RATE"))) continue;
    else if (m.state === "STALE") put(m.metricKey, "STALE", page, m.rawValue);
    else if ((m.state === "OBSERVED" || m.state === "INFERRED") && m.normalizedValue !== null) put(m.metricKey, "PRESENT", page, m.rawValue);
  }
  for (const o of deal.metricObservations ?? []) {
    if (o.metricKey === "OTHER") continue;
    if (o.state === "WITHHELD") put(o.metricKey, "WITHHELD", o.page, null);
    else if (FORWARD_BASES_SET.has(o.basis)) put(o.metricKey, "FORWARD_ONLY", o.page, o.rawText);
    else if (o.periodType === "CUMULATIVE") continue; // a since-inception total is not a current decision metric
    else if (CURRENT_BASES.has(o.basis) && (o.state === "OBSERVED" || o.state === "INFERRED") && (o.value !== null || o.state === "OBSERVED") && !isFuture(o.periodEnd, asOf))
      put(o.metricKey, "PRESENT", o.page, o.rawText);
  }
  // DAU/MAU is derivable when both components are shown.
  if (out.get("dau")?.status === "PRESENT" && out.get("mau")?.status === "PRESENT" && out.get("dau_mau")?.status !== "PRESENT")
    put("dau_mau", "PRESENT", null, "derivable from DAU and MAU");
  return out;
}

/** Observations evidencing a cohort view (cohort definition or "cohort" in the label). */
export function cohortObservations(obs: MetricObservation[]): MetricObservation[] {
  return obs.filter((o) => o.state !== "WITHHELD" && !FORWARD_BASES_SET.has(o.basis) && (!!o.cohortDefinition || /\bcohorts?\b/.test(obsText(o))));
}

/* ---------------------------------------------------------------- */
/* Vanity lexicon                                                     */
/* ---------------------------------------------------------------- */

export interface VanityPattern {
  id: string;
  label: string;
  re: RegExp;
  /** Slot ids of the decision metrics this vanity metric typically stands in for. */
  displaces: string[];
  /** Only match count-type observations (e.g. "12 partners"). */
  countOnly?: boolean;
}

const USERS_SLOTS = ["active_users", "consumer_retention", "customers", "active_accounts", "retention", "cohort_retention", "repeat_rate"];
export const VANITY_LEXICON: VanityPattern[] = [
  { id: "DOWNLOADS", label: "Downloads / installs", re: /\bdownloads?\b|\binstalls?\b/, displaces: USERS_SLOTS },
  { id: "REGISTERED_USERS", label: "Registered users", re: /\bregistered (users?|accounts?|members?)\b|\bregistrations?\b/, displaces: USERS_SLOTS },
  { id: "SIGN_UPS", label: "Sign-ups", re: /\bsign[- ]?ups?\b/, displaces: USERS_SLOTS },
  { id: "WAITLIST", label: "Waitlist", re: /\bwait[- ]?list/, displaces: ["customers", "revenue", "active_users", "net_revenue"] },
  { id: "FOLLOWERS", label: "Followers / audience", re: /\bfollowers?\b|\bsocial (reach|audience)\b|\bcommunity members?\b/, displaces: ["active_users", "organic", "customers"] },
  { id: "IMPRESSIONS", label: "Impressions / page views", re: /\bimpressions?\b|\bpage ?views?\b|\bvideo views?\b|\bviews\b|\breach\b/, displaces: ["active_users", "organic"] },
  { id: "TOTAL_USERS", label: "Total / cumulative users", re: /\btotal users?\b|\busers to date\b|\ball[- ]time users?\b|\blifetime users?\b|\bcumulative users?\b/, displaces: USERS_SLOTS },
  { id: "CUMULATIVE_REVENUE", label: "Cumulative / since-inception revenue or GMV", re: /\bcumulative\b|\bsince (inception|launch|founding|day one)\b|\bto date\b|\ball[- ]time\b|\blifetime (gmv|revenue|sales|volume)\b/, displaces: ["revenue", "net_revenue", "growth", "gmv", "tpv", "hw_revenue"] },
  { id: "LOIS", label: "LOIs / MOUs", re: /\blo[i1]s?\b|\bletters? of intent\b|\bmous?\b/, displaces: ["customers", "revenue", "backlog"] },
  { id: "PIPELINE", label: "Pipeline", re: /\bpipeline\b/, displaces: ["revenue", "customers", "sales_cycle"] },
  { id: "TCV", label: "Total contract value", re: /\btotal contract value\b|\btcv\b|\blifetime contract value\b/, displaces: ["revenue", "acv"] },
  { id: "PARTNERS", label: "Partners count", re: /\bpartners?(hips)?\b/, displaces: ["customers", "revenue"], countOnly: true },
  { id: "LOGOS", label: "Logos count", re: /\blogos?\b|\bbrands (using|trust)\b/, displaces: ["customers", "revenue"], countOnly: true },
];

const MONEY_FLOW_KEYS = new Set(["arr", "mrr", "revenue_ttm", "gmv", "tpv", "units_shipped", "OTHER"]);

/** First vanity pattern matching an observation, or null. Decision metrics are only vanity when cumulative or pipeline. */
export function matchVanity(o: MetricObservation): VanityPattern | null {
  const head = lower(`${o.label} | ${o.rawText}`);
  const cumulative = VANITY_LEXICON.find((v) => v.id === "CUMULATIVE_REVENUE")!;
  const pipeline = VANITY_LEXICON.find((v) => v.id === "PIPELINE")!;
  if (MONEY_FLOW_KEYS.has(o.metricKey) && o.unit === "USD_OR_CURRENCY" && (o.periodType === "CUMULATIVE" || cumulative.re.test(head))) return cumulative;
  if (o.metricKey === "pipeline_value" || o.basis === "PIPELINE") return pipeline;
  for (const v of VANITY_LEXICON) {
    if (v.id === "CUMULATIVE_REVENUE") continue;
    if (v.countOnly && o.unit !== "COUNT") continue;
    if (v.re.test(head)) {
      // A named decision metric (e.g. MAU) whose label merely mentions "users" is not vanity unless it is a total/registered count.
      if (o.metricKey !== "OTHER" && !["TOTAL_USERS", "REGISTERED_USERS", "LOIS", "PIPELINE", "TCV", "DOWNLOADS", "SIGN_UPS"].includes(v.id)) continue;
      return v;
    }
  }
  if (o.periodType === "CUMULATIVE" && o.unit === "COUNT") return VANITY_LEXICON.find((v) => v.id === "TOTAL_USERS")!;
  return null;
}

export function matchVanityText(text: string): VanityPattern | null {
  const t = lower(text);
  return VANITY_LEXICON.find((v) => v.re.test(t)) ?? null;
}

/** Slots whose label or keys are named in a free-text reference (e.g. the model's "decisionMetricItDisplaces"). */
export function slotsMentioned(text: string | null | undefined, slots: DecisionSlot[]): DecisionSlot[] {
  const t = lower(text);
  if (!t) return [];
  return slots.filter((s) => {
    const words = [s.label, ...s.keys.map((k) => k.replace(/_/g, " ")), ...s.keys];
    if (words.some((w) => w.length > 2 && t.includes(lower(w)))) return true;
    if (s.family === "RETENTION" && /retention|churn|cohort|repeat/.test(t)) return true;
    if (s.family === "MONETIZATION" && /take rate|take-rate|net revenue/.test(t)) return true;
    if (s.family === "ENGAGEMENT" && /active users|\bmau\b|\bdau\b|engagement/.test(t)) return true;
    return false;
  });
}
