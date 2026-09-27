/**
 * Canonical metric keys. The full definitions live in dictionary.ts; this file
 * only holds the key list so domain schemas can reference it without a cycle.
 */
export const METRIC_KEYS = [
  // Revenue & growth
  "arr",
  "mrr",
  "revenue_ttm",
  "revenue_growth_yoy",
  "arr_growth_yoy",
  "mom_growth",
  // Retention
  "nrr",
  "grr",
  "logo_retention",
  // Customers
  "paying_customers",
  "pilots",
  "acv",
  "customer_concentration_top1",
  "customer_concentration_top5",
  "pilot_to_production_rate",
  "time_to_value_days",
  // Unit economics
  "gross_margin",
  "contribution_margin",
  "cac",
  "cac_payback_months",
  "ltv",
  "ltv_to_cac",
  "burn_multiple",
  "magic_number",
  "revenue_per_employee",
  // Cash
  "cash_balance",
  "monthly_net_burn",
  "runway_months",
  "headcount",
  // GTM
  "sales_cycle_days",
  "win_rate",
  "pipeline_value",
  "founder_led_revenue_share",
  // Consumer
  "mau",
  "dau",
  "dau_mau",
  "d1_retention",
  "d7_retention",
  "d30_retention",
  "arpu_monthly",
  "organic_acquisition_share",
  // Marketplace
  "gmv",
  "take_rate",
  "repeat_rate",
  "fill_rate",
  // Fintech
  "tpv",
  "default_rate",
  "loss_rate",
  "active_accounts",
  // Hardware
  "units_shipped",
  "asp",
  "backlog",
  "defect_rate",
  // Biotech / deep tech
  "capital_to_next_milestone",
  "months_to_next_milestone",
] as const;

export type MetricKey = (typeof METRIC_KEYS)[number];
