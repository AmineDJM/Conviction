/**
 * Deterministic topic lexicon for questions and free text. A question maps to
 * the topics whose patterns it matches; a topic knows which deck facts answer
 * it. Used to score founder questions (already answered? decision impact?)
 * and for the heuristic fallback grader.
 */

export interface Topic {
  id: string;
  pattern: RegExp;
  /** Metric keys whose presence on the deck answers a value question on this topic. */
  metricKeys: string[];
  /** Deck fact ids (financing, market) that answer it. */
  factIds: string[];
}

export const TOPICS: Topic[] = [
  { id: "retention", pattern: /retention|churn|\bnrr\b|\bgrr\b|renew|cohort|logo retention|expansion revenue|net revenue retention|\bd30\b|repeat (rate|buyers|purchase)/i, metricKeys: ["nrr", "grr", "logo_retention", "d30_retention", "d1_retention", "repeat_rate"], factIds: [] },
  { id: "cac", pattern: /\bcac\b|acquisition cost|payback|cost to acquire|\bltv\b|lifetime value|magic number/i, metricKeys: ["cac", "cac_payback_months", "ltv_to_cac", "ltv"], factIds: [] },
  { id: "burn", pattern: /burn|runway|cash (balance|position)|how much cash|monthly (spend|net)|months of cash/i, metricKeys: ["monthly_net_burn", "runway_months", "cash_balance", "burn_multiple"], factIds: ["F-CASH", "F-BURN", "F-RUNWAY-CLAIM"] },
  { id: "revenue", pattern: /\barr\b|revenue|\bmrr\b|bookings|recurring|arr bridge|top[- ]line/i, metricKeys: ["arr", "mrr", "revenue_ttm", "contracted_arr"], factIds: [] },
  { id: "growth", pattern: /growth|growing|\byoy\b|year[- ]over[- ]year|month[- ]over[- ]month|\bmom\b|trajectory/i, metricKeys: ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"], factIds: [] },
  { id: "pricing", pattern: /pric|\bacv\b|contract value|\barpa\b|\barpu\b|discount|willingness to pay/i, metricKeys: ["acv", "arpu_monthly"], factIds: ["F-PRICING"] },
  { id: "margin", pattern: /margin|\bcogs\b|gross profit|inference cost|hosting cost|cost to serve/i, metricKeys: ["gross_margin", "contribution_margin"], factIds: [] },
  { id: "customers", pattern: /how many (paying )?customers|customer count|number of customers|paying customers|logos/i, metricKeys: ["paying_customers", "active_accounts"], factIds: [] },
  { id: "concentration", pattern: /concentration|largest customer|top (customer|client|5|five|10|ten)|single customer/i, metricKeys: ["customer_concentration_top1", "customer_concentration_top5"], factIds: [] },
  { id: "pilots", pattern: /pilot|\bpoc\b|proof of concept|trial|convert(ed|s)? to (paid|production|contract)|conversion rate/i, metricKeys: ["pilots", "pilot_to_production_rate"], factIds: [] },
  { id: "pipeline", pattern: /pipeline|win rate|sales cycle|close rate|quota|ramp|lost deals|win\/loss/i, metricKeys: ["win_rate", "sales_cycle_days", "pipeline_value"], factIds: [] },
  { id: "founder_sales", pattern: /founder[- ]led|founder involvement|without (the )?founders?|sales (team|hire|leader)|vp (of )?sales|account executives?|\baes?\b/i, metricKeys: ["founder_led_revenue_share"], factIds: [] },
  { id: "team", pattern: /\bhire|hiring|team|\bcto\b|key person|co-?founder|leadership|attrition/i, metricKeys: ["headcount"], factIds: [] },
  { id: "competition", pattern: /compet|incumbent|alternative|differentiat|switch(ing)?|why (you|not)|lose to|displace/i, metricKeys: [], factIds: [] },
  { id: "market", pattern: /\btam\b|market size|addressable|\bsam\b|\bsom\b|how big|number of (companies|buyers)/i, metricKeys: [], factIds: ["F-TAM", "F-SAM", "F-SOM"] },
  { id: "valuation", pattern: /valuation|pre-money|post-money|cap table|terms|liquidation|dilution|option pool|\bsafe\b|\bcap\b/i, metricKeys: [], factIds: ["F-PRE", "F-POST", "F-CAP", "F-RAISE"] },
  { id: "use_of_funds", pattern: /use of (funds|proceeds)|milestone|next round|what (will|does) (this|the) (round|money)|spend the/i, metricKeys: ["capital_to_next_milestone", "months_to_next_milestone"], factIds: ["F-USE", "F-MILESTONE-1"] },
  { id: "product", pattern: /product|roadmap|integration|technolog|accuracy|automation rate|touchless|model|architecture|patent|\bip\b/i, metricKeys: [], factIds: [] },
  { id: "references", pattern: /reference|speak (to|with) (a |your )?customers?|intro(duction)?s? to customers|customer calls?/i, metricKeys: [], factIds: [] },
  { id: "regulatory", pattern: /regulat|compliance|\bfda\b|approval|licen[cs]e|certification|clinical/i, metricKeys: [], factIds: [] },
  { id: "unit_economics", pattern: /unit economics|contribution margin|per[- ]unit|burn multiple/i, metricKeys: ["contribution_margin", "burn_multiple"], factIds: [] },
  { id: "marketplace", pattern: /\bgmv\b|take rate|liquidity|fill rate|supply side|demand side|sellers?|buyers?/i, metricKeys: ["gmv", "take_rate", "fill_rate"], factIds: [] },
];

export function topicsOf(text: string): string[] {
  return TOPICS.filter((t) => t.pattern.test(text)).map((t) => t.id);
}

/** Questions that only ask for a value ("What is your NRR?") rather than probing it. */
const VALUE_Q = /^\s*(what('?s| is| are| was| were)|how (much|many|long|big)|can you (share|tell|give)|do you have|what's)\b/i;
const DEPTH = /\bwhy\b|how (do|did|does|would|will|are) you|definition|define[ds]?|calculat|breakdown|broken down|by cohort|cohorts?|split|bridge|reconcil|composition|driver|trend|over time|evidence|verify|compare|versus|\bvs\.?\b|exclud|includ|underlying|behind|assumption|what happens if|what would|if .* (then|would)|walk (me|us) through|lost|reason/i;

export function isShallowValueQuestion(q: string): boolean {
  return VALUE_Q.test(q) && !DEPTH.test(q);
}

const STOP = new Set(
  "the a an and or of to in on for with by from at as is are was were be been it its this that these those your you we our their they them what which who how why when where do does did can could would should will has have had about into over than then there here not no yes any all more most less such per vs versus".split(" "),
);

export function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9%$]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
