/**
 * Versioned constants of the Divergence Factors engine.
 *
 * Every number here is a MODEL_ASSUMPTION — a convention of this engine, not
 * an observation about the company and not an observed distribution. They are
 * returned with every report so a reader can see exactly what was assumed.
 */
import type { FinancingStage } from "@/domain/enums";

export const DIVERGENCE_ASSUMPTIONS_VERSION = "divergence-assumptions-1.0";

/**
 * Combined ACTIVE-founder ownership (fully diluted) after each round.
 * `typicalPct` = a common outcome; `floorPct` = below this the founders are
 * over-diluted for the stage. Informed by commonly published cap-table
 * medians; MODEL_ASSUMPTION, not a benchmark distribution.
 */
export const FOUNDER_OWNERSHIP_BENCHMARKS = {
  version: "founder-ownership-1.0",
  kind: "MODEL_ASSUMPTION" as const,
  rows: [
    { round: "Pre-seed", typicalPct: 80, floorPct: 65 },
    { round: "Seed", typicalPct: 62, floorPct: 45 },
    { round: "Series A", typicalPct: 45, floorPct: 30 },
    { round: "Series B", typicalPct: 32, floorPct: 20 },
    { round: "Series C", typicalPct: 23, floorPct: 14 },
    { round: "Series D", typicalPct: 17, floorPct: 10 },
  ],
};

export function founderBenchmarkFor(roundLabel: string): { round: string; typicalPct: number; floorPct: number } | null {
  const l = roundLabel.toLowerCase();
  // Longest names first so "Pre-seed" is not read as "Seed".
  const rows = [...FOUNDER_OWNERSHIP_BENCHMARKS.rows].sort((a, b) => b.round.length - a.round.length);
  return rows.find((r) => l.includes(r.round.toLowerCase())) ?? null;
}

export const STAGE_ROUND_LABEL: Record<FinancingStage, string> = {
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A: "Series A",
  SERIES_B: "Series B",
  SERIES_C_PLUS: "Series C",
  UNKNOWN: "Current round",
};

export const DIVERGENCE_ASSUMPTIONS = {
  /** Minimum UNALLOCATED option pool a company of this stage needs to keep hiring (% FD). */
  poolMinAvailablePct: { PRE_SEED: 8, SEED: 10, SERIES_A: 10, SERIES_B: 8, SERIES_C_PLUS: 6, UNKNOWN: 8 } as Record<FinancingStage, number>,
  /** Option pool assumed when the deck states none (% FD) — the economics engine convention. */
  defaultPoolPct: 10,
  /** Active-founder stake after the registry round path below which long-term motivation is at risk (% FD). */
  motivationFloorPct: 10,
  motivationWatchPct: 15,
  /** Departed co-founder stake thresholds (% FD). */
  departedStakeHighPct: 10,
  departedStakeWatchPct: 5,
  /** As-converted share of outstanding pre-round convertibles (% of pre-round FD + conversions). */
  convertibleOverhangHighPct: 15,
  convertibleOverhangWatchPct: 8,
  /** Number of separately-capped outstanding convertibles that counts as "stacked". */
  stackedInstruments: 3,
  /** Exit-equity bands of the company each ambition class builds (USD). */
  outcomeBandsUsd: { NICHE_BUSINESS: [0, 300e6], CATEGORY_COMPANY: [300e6, 3e9], GLOBAL_PLATFORM: [3e9, Infinity] } as Record<string, [number, number]>,
  /** Market slowdown tested by strategic survivability (months). */
  slowdownMonths: 24,
  /** Share of operating expense assumed cuttable without killing the company. */
  cuttableOpexPct: 40,
  /** A sales cycle below this (days, from the metrics) is not a rigidity. */
  longSalesCycleDays: 120,
  /** Market structure: buyer concentration thresholds (share of spend held by the top buyers). */
  buyerConcentrationHighPct: 60,
  buyerConcentrationLowPct: 25,
  /** Market structure: number of addressable buyers below which a market is concentrated / above which it is fragmented. */
  concentratedBuyersBelow: 200,
  fragmentedBuyersAbove: 5_000,
  /** Largest incumbent share above which the winner-take position is already taken / below which it is open. */
  incumbentShareTakenPct: 40,
  incumbentShareOpenPct: 15,
  /** Customer concentration (top-1 revenue share) that makes a customer a CORE / IMPORTANT dependency. */
  keyCustomerCorePct: 30,
  keyCustomerImportantPct: 15,
  /** Land → expand horizon (years) and multiples. */
  expansionHorizonYears: 5,
  platformMultiple: 10,
  meaningfulMultiple: 2,
  /** NRR used for compounding is capped (percent) so a small-sample outlier cannot produce absurd ceilings. */
  nrrCapPct: 200,
  /** Reference ARR for the growth-structure implication. */
  referenceArrUsd: 100e6,
  /** Organizational focus: excess priorities per 10 FTE. */
  focusStrongMax: 1.5,
  focusAdequateMax: 4,
  focusRunwayStressMonths: 12,
  /** Scalability thresholds. */
  servicesShareHighPct: 30,
  servicesShareWatchPct: 15,
  marginTrendPts: 3,
  implementationHighWeeks: 12,
  implementationWatchWeeks: 6,
  supportFtePer10CustomersHigh: 1,
  supportFtePer10CustomersWatch: 0.4,
};

export interface DivergenceAssumptionEntry {
  id: string;
  label: string;
  value: string;
  kind: "MODEL_ASSUMPTION" | "REGISTRY";
}

export function describeDivergenceAssumptions(): DivergenceAssumptionEntry[] {
  const a = DIVERGENCE_ASSUMPTIONS;
  return [
    {
      id: "FOUNDER_OWNERSHIP",
      label: `Active-founder ownership by round (${FOUNDER_OWNERSHIP_BENCHMARKS.version})`,
      value: FOUNDER_OWNERSHIP_BENCHMARKS.rows.map((r) => `${r.round} typical ${r.typicalPct}% / floor ${r.floorPct}%`).join("; "),
      kind: "MODEL_ASSUMPTION",
    },
    { id: "POOL_MIN", label: "Minimum unallocated option pool", value: Object.entries(a.poolMinAvailablePct).map(([k, v]) => `${k} ${v}%`).join(", "), kind: "MODEL_ASSUMPTION" },
    { id: "MOTIVATION", label: "Active-founder stake after the round path", value: `< ${a.motivationFloorPct}% at risk, < ${a.motivationWatchPct}% watch`, kind: "MODEL_ASSUMPTION" },
    { id: "ROUND_PATH", label: "Future rounds (step-up, dilution, pool refresh)", value: "benchmark registry path for the entry stage, via the economics engine's pro-forma cap table", kind: "REGISTRY" },
    { id: "OUTCOME_BANDS", label: "Exit equity by ambition class", value: "niche business < $300M; category company $300M–$3B; global platform ≥ $3B", kind: "MODEL_ASSUMPTION" },
    { id: "SLOWDOWN", label: "Strategic survivability shock", value: `market ${a.slowdownMonths} months slower; up to ${a.cuttableOpexPct}% of operating expense cuttable; a sales cycle under ${a.longSalesCycleDays} days is not a rigidity`, kind: "MODEL_ASSUMPTION" },
    { id: "MARKET_STRUCTURE", label: "Market structure thresholds", value: `top buyers ≥ ${a.buyerConcentrationHighPct}% concentrated, ≤ ${a.buyerConcentrationLowPct}% dispersed; < ${a.concentratedBuyersBelow} buyers concentrated, > ${a.fragmentedBuyersAbove.toLocaleString("en-US")} fragmented; incumbent ≥ ${a.incumbentShareTakenPct}% taken`, kind: "MODEL_ASSUMPTION" },
    { id: "KEY_CUSTOMER", label: "Customer concentration as a dependency", value: `top-1 ≥ ${a.keyCustomerCorePct}% core, ≥ ${a.keyCustomerImportantPct}% important`, kind: "MODEL_ASSUMPTION" },
    { id: "EXPANSION", label: "Land → expand horizon", value: `${a.expansionHorizonYears} years; platform ≥ ${a.platformMultiple}× wedge, meaningful ≥ ${a.meaningfulMultiple}×; NRR capped at ${a.nrrCapPct}%`, kind: "MODEL_ASSUMPTION" },
    { id: "FOCUS", label: "Excess priorities per 10 FTE", value: `≤ ${a.focusStrongMax} focused, ≤ ${a.focusAdequateMax} stretched, above fragmented; runway < ${a.focusRunwayStressMonths} months tightens`, kind: "MODEL_ASSUMPTION" },
    { id: "SCALABILITY", label: "Scalability thresholds", value: `services ≥ ${a.servicesShareHighPct}% (≥ ${a.servicesShareWatchPct}%); implementation ≥ ${a.implementationHighWeeks} wks (≥ ${a.implementationWatchWeeks}); support+services FTE per 10 customers ≥ ${a.supportFtePer10CustomersHigh} (≥ ${a.supportFtePer10CustomersWatch}); margin trend ±${a.marginTrendPts} pts`, kind: "MODEL_ASSUMPTION" },
  ];
}
