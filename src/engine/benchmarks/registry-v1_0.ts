/**
 * VC_BENCHMARK_V1_0 — the authoritative scoring configuration.
 *
 * HONESTY NOTE: this version ships NO observed distributions. Every metric
 * curve is an INVESTOR_TARGET (rule of thumb) or INTERNAL_POLICY. The UI
 * therefore never displays percentiles for V1_0. To enable percentiles, load
 * a dataset as OBSERVED_DISTRIBUTION with full provenance in a new version.
 *
 * Never edit a published version in place. Copy to a new file, bump the id,
 * add a changelog entry, and run "Recalculate portfolio".
 */
import type { BenchmarkRegistry, ComponentSpec, MetricBenchmark, Provenance, StageBand } from "./types";
import type { MetricKey } from "../metrics/keys";
import type { RubricCriterion } from "@/domain/sections";
import type { OperationalMaturity } from "@/domain/enums";

const HEURISTIC: Provenance = {
  source:
    "Widely cited venture investor heuristics for the metric (public investor commentary and operating benchmarks). Encoded as targets, not as a measured population.",
  selectionBias: "Heuristics skew toward US venture-backed software companies that raised follow-on rounds (survivorship).",
};
const POLICY: Provenance = { source: "Internal policy of this registry version. Adjustable per fund in a new registry version." };

const b = (x: Omit<MetricBenchmark, "provenance" | "type"> & Partial<Pick<MetricBenchmark, "provenance" | "type">>): MetricBenchmark => ({
  type: "INVESTOR_TARGET",
  provenance: HEURISTIC,
  ...x,
});

const SAAS = ["ENTERPRISE_SAAS", "SMB_PLG_SAAS", "DEVELOPER_INFRA"] as const;
const SOFTWARE_LIKE = ["ENTERPRISE_SAAS", "SMB_PLG_SAAS", "DEVELOPER_INFRA", "GENERAL"] as const;

const benchmarks: MetricBenchmark[] = [
  /* ---------------- Revenue scale (stage-dependent) ---------------- */
  b({ id: "arr.early", metricKey: "arr", profiles: [...SOFTWARE_LIKE, "FINTECH"], stageBands: ["EARLY"],
    curve: [{ value: 0, score: 10 }, { value: 100_000, score: 40 }, { value: 500_000, score: 65 }, { value: 1_000_000, score: 80 }, { value: 2_000_000, score: 95 }] }),
  b({ id: "arr.growth", metricKey: "arr", profiles: [...SOFTWARE_LIKE, "FINTECH"], stageBands: ["GROWTH"],
    curve: [{ value: 0, score: 5 }, { value: 500_000, score: 25 }, { value: 1_000_000, score: 45 }, { value: 2_000_000, score: 65 }, { value: 4_000_000, score: 85 }, { value: 8_000_000, score: 98 }] }),
  b({ id: "arr.late", metricKey: "arr", profiles: [...SOFTWARE_LIKE, "FINTECH"], stageBands: ["LATE"],
    curve: [{ value: 2_000_000, score: 10 }, { value: 5_000_000, score: 35 }, { value: 10_000_000, score: 60 }, { value: 20_000_000, score: 85 }, { value: 40_000_000, score: 98 }] }),

  /* ---------------- Growth ---------------- */
  b({ id: "growth.early", metricKey: "arr_growth_yoy", profiles: "ALL", stageBands: ["EARLY"],
    curve: [{ value: 0, score: 10 }, { value: 100, score: 40 }, { value: 200, score: 65 }, { value: 300, score: 85 }, { value: 500, score: 98 }] }),
  b({ id: "growth.growth", metricKey: "arr_growth_yoy", profiles: "ALL", stageBands: ["GROWTH"],
    curve: [{ value: 0, score: 5 }, { value: 50, score: 25 }, { value: 100, score: 50 }, { value: 200, score: 75 }, { value: 300, score: 92 }, { value: 400, score: 98 }],
    notes: "Encodes the 'triple, triple, double' growth heuristic for Series A software." }),
  b({ id: "growth.late", metricKey: "arr_growth_yoy", profiles: "ALL", stageBands: ["LATE"],
    curve: [{ value: 0, score: 5 }, { value: 30, score: 25 }, { value: 60, score: 50 }, { value: 100, score: 75 }, { value: 150, score: 92 }] }),
  b({ id: "revgrowth.early", metricKey: "revenue_growth_yoy", profiles: "ALL", stageBands: ["EARLY"],
    curve: [{ value: 0, score: 10 }, { value: 100, score: 40 }, { value: 200, score: 65 }, { value: 300, score: 85 }, { value: 500, score: 98 }] }),
  b({ id: "revgrowth.growth", metricKey: "revenue_growth_yoy", profiles: "ALL", stageBands: ["GROWTH"],
    curve: [{ value: 0, score: 5 }, { value: 50, score: 25 }, { value: 100, score: 50 }, { value: 200, score: 75 }, { value: 300, score: 92 }] }),
  b({ id: "revgrowth.late", metricKey: "revenue_growth_yoy", profiles: "ALL", stageBands: ["LATE"],
    curve: [{ value: 0, score: 5 }, { value: 30, score: 25 }, { value: 60, score: 50 }, { value: 100, score: 75 }, { value: 150, score: 92 }] }),
  b({ id: "mom.all", metricKey: "mom_growth", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 0, score: 10 }, { value: 5, score: 35 }, { value: 10, score: 60 }, { value: 15, score: 80 }, { value: 20, score: 95 }] }),

  /* ---------------- Retention ---------------- */
  b({ id: "nrr.enterprise", metricKey: "nrr", profiles: ["ENTERPRISE_SAAS", "DEVELOPER_INFRA", "GENERAL", "FINTECH"], stageBands: "ALL",
    curve: [{ value: 70, score: 5 }, { value: 90, score: 30 }, { value: 100, score: 50 }, { value: 110, score: 70 }, { value: 120, score: 85 }, { value: 140, score: 98 }] }),
  b({ id: "nrr.smb", metricKey: "nrr", profiles: ["SMB_PLG_SAAS"], stageBands: "ALL",
    curve: [{ value: 60, score: 5 }, { value: 80, score: 30 }, { value: 90, score: 50 }, { value: 100, score: 70 }, { value: 110, score: 85 }, { value: 125, score: 98 }] }),
  b({ id: "grr.all", metricKey: "grr", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 70, score: 10 }, { value: 80, score: 35 }, { value: 90, score: 65 }, { value: 95, score: 85 }, { value: 98, score: 95 }] }),
  b({ id: "logo.all", metricKey: "logo_retention", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 60, score: 10 }, { value: 75, score: 35 }, { value: 85, score: 60 }, { value: 90, score: 80 }, { value: 95, score: 95 }] }),
  b({ id: "pilotconv.all", metricKey: "pilot_to_production_rate", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 20, score: 15 }, { value: 40, score: 40 }, { value: 60, score: 65 }, { value: 80, score: 90 }] }),
  b({ id: "conc.top1", metricKey: "customer_concentration_top1", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 10, score: 95 }, { value: 20, score: 75 }, { value: 35, score: 45 }, { value: 50, score: 20 }, { value: 70, score: 5 }] }),
  b({ id: "conc.top5", metricKey: "customer_concentration_top5", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 25, score: 95 }, { value: 40, score: 75 }, { value: 60, score: 45 }, { value: 80, score: 20 }, { value: 95, score: 5 }] }),

  /* ---------------- Margins ---------------- */
  b({ id: "gm.saas", metricKey: "gross_margin", profiles: ["ENTERPRISE_SAAS", "SMB_PLG_SAAS", "GENERAL"], stageBands: "ALL",
    curve: [{ value: 40, score: 10 }, { value: 60, score: 35 }, { value: 70, score: 55 }, { value: 75, score: 70 }, { value: 80, score: 85 }, { value: 85, score: 95 }] }),
  b({ id: "gm.infra", metricKey: "gross_margin", profiles: ["DEVELOPER_INFRA"], stageBands: "ALL",
    curve: [{ value: 30, score: 10 }, { value: 50, score: 40 }, { value: 60, score: 60 }, { value: 70, score: 80 }, { value: 80, score: 95 }],
    notes: "Usage/inference-heavy products carry structurally higher COGS." }),
  b({ id: "gm.marketplace", metricKey: "gross_margin", profiles: ["MARKETPLACE"], stageBands: "ALL",
    curve: [{ value: 30, score: 20 }, { value: 50, score: 50 }, { value: 70, score: 80 }, { value: 85, score: 95 }], notes: "On net revenue." }),
  b({ id: "gm.hardware", metricKey: "gross_margin", profiles: ["HARDWARE_ROBOTICS"], stageBands: "ALL",
    curve: [{ value: 10, score: 10 }, { value: 25, score: 40 }, { value: 40, score: 70 }, { value: 50, score: 90 }] }),
  b({ id: "gm.fintech", metricKey: "gross_margin", profiles: ["FINTECH", "CONSUMER"], stageBands: "ALL",
    curve: [{ value: 20, score: 20 }, { value: 40, score: 50 }, { value: 60, score: 80 }, { value: 75, score: 95 }] }),
  b({ id: "cm.all", metricKey: "contribution_margin", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: -20, score: 5 }, { value: 0, score: 25 }, { value: 15, score: 50 }, { value: 30, score: 75 }, { value: 50, score: 95 }] }),

  /* ---------------- Efficiency ---------------- */
  b({ id: "payback.enterprise", metricKey: "cac_payback_months", profiles: ["ENTERPRISE_SAAS", "DEVELOPER_INFRA", "GENERAL", "FINTECH"], stageBands: "ALL",
    curve: [{ value: 6, score: 98 }, { value: 12, score: 85 }, { value: 18, score: 65 }, { value: 24, score: 45 }, { value: 36, score: 20 }, { value: 48, score: 5 }] }),
  b({ id: "payback.smb", metricKey: "cac_payback_months", profiles: ["SMB_PLG_SAAS", "CONSUMER", "MARKETPLACE"], stageBands: "ALL",
    curve: [{ value: 3, score: 98 }, { value: 6, score: 85 }, { value: 12, score: 60 }, { value: 18, score: 35 }, { value: 24, score: 15 }] }),
  b({ id: "ltvcac.all", metricKey: "ltv_to_cac", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 1, score: 10 }, { value: 2, score: 35 }, { value: 3, score: 65 }, { value: 5, score: 90 }] }),
  b({ id: "burnmult.all", metricKey: "burn_multiple", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 0.5, score: 98 }, { value: 1, score: 85 }, { value: 1.5, score: 70 }, { value: 2, score: 50 }, { value: 3, score: 25 }, { value: 4, score: 10 }] }),
  b({ id: "magic.all", metricKey: "magic_number", profiles: [...SAAS, "GENERAL"], stageBands: "ALL",
    curve: [{ value: 0.3, score: 15 }, { value: 0.5, score: 40 }, { value: 0.75, score: 65 }, { value: 1, score: 85 }, { value: 1.5, score: 98 }] }),
  b({ id: "runway.all", metricKey: "runway_months", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 3, score: 5 }, { value: 6, score: 15 }, { value: 12, score: 40 }, { value: 18, score: 70 }, { value: 24, score: 90 }, { value: 36, score: 98 }] }),
  b({ id: "rpe.all", metricKey: "revenue_per_employee", profiles: [...SOFTWARE_LIKE], stageBands: ["GROWTH", "LATE"],
    curve: [{ value: 50_000, score: 20 }, { value: 100_000, score: 45 }, { value: 200_000, score: 75 }, { value: 300_000, score: 90 }] }),

  /* ---------------- GTM ---------------- */
  b({ id: "cycle.enterprise", metricKey: "sales_cycle_days", profiles: ["ENTERPRISE_SAAS", "DEVELOPER_INFRA", "GENERAL", "HARDWARE_ROBOTICS"], stageBands: "ALL",
    curve: [{ value: 30, score: 95 }, { value: 90, score: 75 }, { value: 180, score: 45 }, { value: 270, score: 25 }, { value: 365, score: 10 }] }),
  b({ id: "winrate.all", metricKey: "win_rate", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 10, score: 15 }, { value: 20, score: 40 }, { value: 30, score: 65 }, { value: 40, score: 85 }] }),
  b({ id: "founderled.growth", metricKey: "founder_led_revenue_share", profiles: "ALL", stageBands: ["GROWTH"],
    curve: [{ value: 30, score: 85 }, { value: 60, score: 60 }, { value: 90, score: 35 }], type: "INTERNAL_POLICY", provenance: POLICY,
    notes: "Founder-led sales is normal pre-seed/seed and not scored there." }),
  b({ id: "founderled.late", metricKey: "founder_led_revenue_share", profiles: "ALL", stageBands: ["LATE"],
    curve: [{ value: 20, score: 85 }, { value: 50, score: 40 }, { value: 80, score: 10 }], type: "INTERNAL_POLICY", provenance: POLICY }),

  /* ---------------- Consumer ---------------- */
  b({ id: "d1.consumer", metricKey: "d1_retention", profiles: ["CONSUMER"], stageBands: "ALL",
    curve: [{ value: 20, score: 15 }, { value: 30, score: 40 }, { value: 40, score: 65 }, { value: 50, score: 85 }] }),
  b({ id: "d30.consumer", metricKey: "d30_retention", profiles: ["CONSUMER"], stageBands: "ALL",
    curve: [{ value: 5, score: 10 }, { value: 10, score: 35 }, { value: 20, score: 65 }, { value: 30, score: 85 }, { value: 40, score: 95 }] }),
  b({ id: "daumau.consumer", metricKey: "dau_mau", profiles: ["CONSUMER"], stageBands: "ALL",
    curve: [{ value: 10, score: 15 }, { value: 20, score: 45 }, { value: 30, score: 70 }, { value: 50, score: 95 }] }),
  b({ id: "organic.consumer", metricKey: "organic_acquisition_share", profiles: ["CONSUMER", "MARKETPLACE", "SMB_PLG_SAAS"], stageBands: "ALL",
    curve: [{ value: 20, score: 20 }, { value: 50, score: 55 }, { value: 70, score: 80 }, { value: 85, score: 95 }] }),

  /* ---------------- Marketplace ---------------- */
  b({ id: "repeat.marketplace", metricKey: "repeat_rate", profiles: ["MARKETPLACE"], stageBands: "ALL",
    curve: [{ value: 20, score: 20 }, { value: 40, score: 50 }, { value: 60, score: 80 }, { value: 75, score: 95 }] }),
  b({ id: "fill.marketplace", metricKey: "fill_rate", profiles: ["MARKETPLACE"], stageBands: "ALL",
    curve: [{ value: 20, score: 20 }, { value: 50, score: 55 }, { value: 80, score: 90 }] }),

  /* ---------------- Fintech / hardware ---------------- */
  b({ id: "loss.fintech", metricKey: "loss_rate", profiles: ["FINTECH"], stageBands: "ALL",
    curve: [{ value: 0.5, score: 95 }, { value: 1, score: 80 }, { value: 2, score: 55 }, { value: 4, score: 25 }, { value: 8, score: 5 }] }),
  b({ id: "defect.hardware", metricKey: "defect_rate", profiles: ["HARDWARE_ROBOTICS"], stageBands: "ALL",
    curve: [{ value: 0.5, score: 95 }, { value: 1, score: 80 }, { value: 3, score: 45 }, { value: 5, score: 20 }] }),

  /* ---------------- Market ceiling & outlier path ---------------- */
  b({ id: "market.sam", metricKey: "reconstructed_sam_usd", profiles: "ALL", stageBands: "ALL",
    curve: [{ value: 1e8, score: 15 }, { value: 3e8, score: 35 }, { value: 1e9, score: 55 }, { value: 3e9, score: 75 }, { value: 1e10, score: 90 }, { value: 3e10, score: 98 }],
    notes: "Applied to the reconstructed (never deck) serviceable market: geometric midpoint for the Market dimension, upper bound for the power-law ceiling. Log-spaced venture-scale heuristic." }),
  b({ id: "outlier.samshare", metricKey: "required_sam_share_pct", profiles: "ALL", stageBands: "ALL", type: "MODEL_ASSUMPTION",
    provenance: { source: "Model assumption: share of the reconstructed SAM that must be captured as revenue for the deal to return the target contribution." },
    curve: [{ value: 2, score: 98 }, { value: 5, score: 90 }, { value: 10, score: 75 }, { value: 20, score: 55 }, { value: 40, score: 30 }, { value: 80, score: 8 }] }),

  /* ---------------- Explicitly unavailable ---------------- */
  {
    id: "biotech.traction.unavailable",
    metricKey: "capital_to_next_milestone",
    profiles: ["BIOTECH_MEDTECH"],
    stageBands: "ALL",
    type: "UNAVAILABLE",
    curve: null,
    provenance: { source: "No credible cross-program benchmark for capital-to-milestone exists in this registry. Not scored." },
  },
];

const T = (criterion: RubricCriterion, weight: number, id?: string): ComponentSpec => ({
  id: id ?? criterion.toLowerCase(),
  kind: "RUBRIC",
  criterion,
  weight,
});
const M = (
  id: string,
  metricKeys: MetricKey[],
  weight: number,
  extra: { minMaturity?: OperationalMaturity; stageBands?: StageBand[] } = {},
): ComponentSpec => ({ id, kind: "METRIC", metricKeys, weight, ...extra });

export const VC_BENCHMARK_V1_0: BenchmarkRegistry = {
  id: "VC_BENCHMARK_V1_0",
  version: "1.0",
  publishedAt: "2026-09-27",
  description:
    "Initial registry. Investor-target curves and internal-policy weights; no observed distributions (no percentiles). Weights are declared policy, not objective truth.",
  changelog: ["1.0 — initial publication."],
  benchmarks,
  dimensions: [
    {
      id: "TEAM",
      name: "Team",
      description: "Founder capabilities evidenced by behavior and outcomes — never pedigree alone.",
      components: [
        T("FOUNDER_MARKET_FIT", 0.3),
        T("EXECUTION_EVIDENCE", 0.3),
        T("TEAM_COMPLETENESS", 0.15),
        { id: "founder_capabilities", kind: "FOUNDER_CAPABILITIES", weight: 0.25 },
      ],
    },
    {
      id: "PRODUCT_PAIN",
      name: "Product & Pain",
      description: "Severity of the problem, quantified value, differentiation.",
      components: [T("PAIN_SEVERITY", 0.35), T("VALUE_QUANTIFIED", 0.3), T("PRODUCT_DIFFERENTIATION", 0.35)],
    },
    {
      id: "MARKET",
      name: "Market",
      description: "Reconstructed (not deck) market size, value capture, growth and wedge.",
      components: [
        { id: "market_size", kind: "MARKET_SIZE", weight: 0.4 },
        T("VALUE_CAPTURE", 0.25),
        T("MARKET_GROWTH", 0.2),
        T("WEDGE_QUALITY", 0.15),
      ],
    },
    {
      id: "TRACTION_PMF",
      name: "Traction / PMF",
      description: "Business-model-specific traction and product-market-fit evidence.",
      components: [
        M("scale", ["arr", "revenue_ttm"], 0.15),
        M("growth", ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"], 0.25, { minMaturity: "EARLY_REVENUE" }),
        M("retention", ["nrr", "grr", "logo_retention"], 0.2, { minMaturity: "PMF_EMERGING" }),
        M("pilot_conversion", ["pilot_to_production_rate"], 0.1, { stageBands: ["EARLY"] }),
        M("concentration", ["customer_concentration_top1", "customer_concentration_top5"], 0.1, { minMaturity: "EARLY_REVENUE" }),
        T("PMF_SIGNAL_QUALITY", 0.2),
      ],
      profileOverrides: {
        CONSUMER: [
          M("growth", ["mom_growth", "revenue_growth_yoy", "arr_growth_yoy"], 0.2),
          M("d30", ["d30_retention", "d1_retention"], 0.25),
          M("engagement", ["dau_mau"], 0.2),
          M("organic", ["organic_acquisition_share"], 0.15),
          T("PMF_SIGNAL_QUALITY", 0.2),
        ],
        MARKETPLACE: [
          M("growth", ["revenue_growth_yoy", "mom_growth", "arr_growth_yoy"], 0.3, { minMaturity: "EARLY_REVENUE" }),
          M("repeat", ["repeat_rate"], 0.2),
          M("liquidity", ["fill_rate"], 0.15),
          M("organic", ["organic_acquisition_share"], 0.1),
          T("PMF_SIGNAL_QUALITY", 0.25),
        ],
        FINTECH: [
          M("scale", ["arr", "revenue_ttm"], 0.15),
          M("growth", ["revenue_growth_yoy", "arr_growth_yoy", "mom_growth"], 0.25, { minMaturity: "EARLY_REVENUE" }),
          M("retention", ["nrr", "logo_retention"], 0.15, { minMaturity: "PMF_EMERGING" }),
          M("losses", ["loss_rate"], 0.15, { minMaturity: "EARLY_REVENUE" }),
          T("PMF_SIGNAL_QUALITY", 0.3),
        ],
        HARDWARE_ROBOTICS: [
          M("growth", ["revenue_growth_yoy", "arr_growth_yoy"], 0.2, { minMaturity: "EARLY_REVENUE" }),
          M("pilot_conversion", ["pilot_to_production_rate"], 0.2),
          M("quality", ["defect_rate"], 0.15, { minMaturity: "EARLY_REVENUE" }),
          T("PMF_SIGNAL_QUALITY", 0.45),
        ],
        BIOTECH_MEDTECH: [T("PMF_SIGNAL_QUALITY", 1, "validation_evidence")],
      },
    },
    {
      id: "GTM",
      name: "Go-to-market",
      description: "ICP clarity, motion fit and scalability of acquisition.",
      components: [
        T("ICP_CLARITY", 0.3),
        T("SALES_MOTION_FIT", 0.3),
        T("CHANNEL_SCALABILITY", 0.2),
        M("cycle", ["sales_cycle_days"], 0.07),
        M("win_rate", ["win_rate"], 0.06),
        M("founder_led", ["founder_led_revenue_share"], 0.07, { stageBands: ["GROWTH", "LATE"] }),
      ],
    },
    {
      id: "ECONOMICS",
      name: "Economics",
      description: "Margins, acquisition efficiency and capital efficiency.",
      components: [
        M("gross_margin", ["gross_margin", "contribution_margin"], 0.3, { minMaturity: "EARLY_REVENUE" }),
        M("acquisition", ["cac_payback_months", "ltv_to_cac"], 0.25, { minMaturity: "EARLY_REVENUE" }),
        M("capital_efficiency", ["burn_multiple", "magic_number"], 0.25, { minMaturity: "EARLY_REVENUE" }),
        M("runway", ["runway_months"], 0.1),
        T("PRICING_POWER", 0.1),
      ],
      profileOverrides: {
        BIOTECH_MEDTECH: [M("runway", ["runway_months"], 0.5), T("PRICING_POWER", 0.5, "reimbursement_pricing")],
      },
    },
    {
      id: "MOAT",
      name: "Moat",
      description: "Defensibility now and its trajectory; proprietary software alone is not a moat.",
      components: [T("MOAT_CURRENT", 0.5), T("MOAT_TRAJECTORY", 0.5)],
    },
    {
      id: "WHY_NOW",
      name: "Why now",
      description: "The catalyst that makes this possible or necessary now.",
      components: [T("TIMING_CATALYST", 0.6), T("INFLECTION_EVIDENCE", 0.4)],
    },
  ],
  dimensionWeights: {
    EARLY: { TEAM: 0.25, PRODUCT_PAIN: 0.15, MARKET: 0.15, TRACTION_PMF: 0.15, GTM: 0.07, ECONOMICS: 0.05, MOAT: 0.08, WHY_NOW: 0.1 },
    GROWTH: { TEAM: 0.15, PRODUCT_PAIN: 0.1, MARKET: 0.15, TRACTION_PMF: 0.25, GTM: 0.12, ECONOMICS: 0.1, MOAT: 0.08, WHY_NOW: 0.05 },
    LATE: { TEAM: 0.1, PRODUCT_PAIN: 0.08, MARKET: 0.12, TRACTION_PMF: 0.25, GTM: 0.15, ECONOMICS: 0.18, MOAT: 0.09, WHY_NOW: 0.03 },
  },
  dimensionWeightOverrides: {
    BIOTECH_MEDTECH: { TEAM: 0.25, PRODUCT_PAIN: 0.15, MARKET: 0.15, TRACTION_PMF: 0.15, GTM: 0.03, ECONOMICS: 0.07, MOAT: 0.15, WHY_NOW: 0.05 },
  },
  rubricPoints: { WEAK: 10, BELOW_BAR: 30, ADEQUATE: 55, STRONG: 78, EXCEPTIONAL: 95 },
  coverage: {
    scoredMin: 0.7,
    partialMin: 0.35,
    credit: { OBSERVED: 1, INFERRED: 0.5, STALE: 0.5, SMALL_SAMPLE_MULTIPLIER: 0.5 },
  },
  maturityOrder: ["PRE_PRODUCT", "PROTOTYPE", "PILOT", "EARLY_REVENUE", "PMF_EMERGING", "SCALED_GTM", "GROWTH"],
  evidence: {
    verification: { VERIFIED: 1, PARTIALLY_VERIFIED: 0.6, UNVERIFIED: 0.2, CONTRADICTED: 0 },
    origin: { PRIMARY_EXTERNAL: 1, INDEPENDENT_SECONDARY: 0.9, COMPANY: 0.7, ANECDOTAL: 0.4 },
    freshness: { CURRENT: 1, AGING: 0.8, STALE: 0.5 },
    materialWeight: 1,
    nonMaterialWeight: 0.3,
    categories: { LOW: 0, MODERATE: 30, HIGH: 55, VERY_HIGH: 75 },
  },
  powerLaw: {
    weights: { MARKET_CEILING: 0.25, NONLINEAR_MECHANISM: 0.25, EXCEPTIONAL_STRENGTH: 0.25, OUTLIER_PATH: 0.25 },
    marketCeilingBenchmarkId: "market.sam",
    outlierPathBenchmarkId: "outlier.samshare",
  },
  fundFit: {
    weights: { STAGE: 0.2, CHECK: 0.15, OWNERSHIP: 0.2, SECTOR: 0.15, GEOGRAPHY: 0.1, PORTFOLIO: 0.1, RESERVES: 0.1 },
    maxShareOfRoundPct: 70,
  },
  risk: { levelPoints: { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 } },
  returns: {
    futureRounds: {
      PRE_SEED: [
        { name: "Seed", dilutionPct: 20, stepUp: 3 },
        { name: "Series A", dilutionPct: 20, stepUp: 3 },
        { name: "Series B", dilutionPct: 15, stepUp: 2.5 },
        { name: "Series C", dilutionPct: 12, stepUp: 2 },
      ],
      SEED: [
        { name: "Series A", dilutionPct: 20, stepUp: 3 },
        { name: "Series B", dilutionPct: 15, stepUp: 2.5 },
        { name: "Series C", dilutionPct: 12, stepUp: 2 },
      ],
      SERIES_A: [
        { name: "Series B", dilutionPct: 15, stepUp: 2.5 },
        { name: "Series C", dilutionPct: 12, stepUp: 2 },
        { name: "Series D", dilutionPct: 10, stepUp: 1.8 },
      ],
      SERIES_B: [
        { name: "Series C", dilutionPct: 12, stepUp: 2 },
        { name: "Series D", dilutionPct: 10, stepUp: 1.8 },
      ],
      SERIES_C_PLUS: [{ name: "Next round", dilutionPct: 10, stepUp: 1.6 }],
      UNKNOWN: [
        { name: "Next round", dilutionPct: 18, stepUp: 2.5 },
        { name: "Following round", dilutionPct: 14, stepUp: 2 },
      ],
    },
    roundsBeforeExit: { FAILURE: 1, LOW: 1, BASE: 2, BULL: 3, OUTLIER: 3 },
    monthsBetweenRounds: 20,
    defaultExitMultipleOfPostMoney: { FAILURE: 0, LOW: 1, BASE: 5, BULL: 20, OUTLIER: 60 },
    defaultYearsToExit: { FAILURE: 3, LOW: 5, BASE: 7, BULL: 8, OUTLIER: 9 },
    followOnPolicy: "NEXT_ROUND_PRO_RATA",
    defaultLiquidationPrefMultiple: 1,
    backwardsRevenueMultiples: [4, 8, 12, 20],
    priceSensitivityTargets: [10, 20, 50],
    samSharePlausibility: { PLAUSIBLE: 10, DEMANDING: 30, HEROIC: 60 },
    fundraisingLeadMonths: 6,
    delayScenariosMonths: [6, 12],
  },
  decision: {
    screenOutOqiUpper: 35,
    exceptionalOverridePowerLaw: 70,
    investMinOqiLower: 55,
    investMinEvidence: "HIGH",
    icReadyMinEvidence: "HIGH",
    investMinBaseMoic: 3,
    gates: [
      { id: "MANDATE", description: "Any mandate gate FAIL → SCREEN_OUT (binary; never averaged into Fund Fit)." },
      { id: "SCREEN_OUT_QUALITY", description: "Operating-quality upper bound below threshold AND power-law below override AND no rated exceptional strength → SCREEN_OUT." },
      { id: "EXCEPTIONAL_OVERRIDE", description: "Power-Law Index ≥ override threshold prevents screen-out on composite quality alone; routes to founder call with explicit rationale." },
      { id: "THESIS_KILLER", description: "A thesis-killing weakness with HIGH/CRITICAL likelihood → ANALYTICAL_RECOMMEND_PASS unless the exceptional override applies." },
      { id: "DEPTH_LIMIT", description: "FAST_SCREEN may only produce SCREEN_OUT, NEEDS_FOUNDER_CALL or WATCH. PARTIAL analyses cannot be IC_READY or recommend invest." },
      { id: "MUST_ASK_OPEN", description: "Open MUST_ASK questions with evidence below HIGH → NEEDS_FOUNDER_CALL at most." },
      { id: "IC_READY", description: "Requires FULL analysis, evidence ≥ threshold, no open MUST_ASK questions, mandate pass." },
      { id: "INVEST", description: "IC_READY conditions + OQI lower bound ≥ threshold + base-case gross MOIC ≥ threshold." },
      { id: "WATCH", description: "WATCH requires a trigger, expected date and awaited information." },
    ],
  },
  research: { maxFindingsPerRound: 25 },
};
