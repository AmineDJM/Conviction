/**
 * §12–14 BENCHMARK_REGISTRY types. A registry version is immutable once
 * published; analyses store the version id they were scored under.
 */
import type { FinancingStage, OperationalMaturity, ReturnScenarioName, RubricRating } from "@/domain/enums";
import type { MetricKey } from "../metrics/keys";
import type { RubricCriterion } from "@/domain/sections";

export type BenchmarkType = "OBSERVED_DISTRIBUTION" | "INVESTOR_TARGET" | "INTERNAL_POLICY" | "MODEL_ASSUMPTION" | "UNAVAILABLE";

export const PROFILE_IDS = [
  "ENTERPRISE_SAAS",
  "SMB_PLG_SAAS",
  "DEVELOPER_INFRA",
  "CONSUMER",
  "MARKETPLACE",
  "FINTECH",
  "HARDWARE_ROBOTICS",
  "BIOTECH_MEDTECH",
  "GENERAL",
] as const;
export type ProfileId = (typeof PROFILE_IDS)[number];

export const STAGE_BANDS = ["EARLY", "GROWTH", "LATE"] as const;
export type StageBand = (typeof STAGE_BANDS)[number];

export const DIMENSION_IDS = ["TEAM", "PRODUCT_PAIN", "MARKET", "TRACTION_PMF", "GTM", "ECONOMICS", "MOAT", "WHY_NOW"] as const;
export type DimensionId = (typeof DIMENSION_IDS)[number];

export interface Provenance {
  source: string;
  population?: string;
  sampleSize?: number;
  period?: string;
  geography?: string;
  stage?: string;
  businessModel?: string;
  exclusions?: string;
  selectionBias?: string;
}

/** Piecewise-linear value → score (0–100) curve; points sorted by value ascending. */
export type Curve = { value: number; score: number }[];

export interface MetricBenchmark {
  id: string;
  metricKey: MetricKey | "reconstructed_sam_usd" | "required_sam_share_pct";
  profiles: ProfileId[] | "ALL";
  stageBands: StageBand[] | "ALL";
  type: BenchmarkType;
  curve: Curve | null;
  /** Only for OBSERVED_DISTRIBUTION: quantile → value. Enables percentiles. */
  quantiles?: { p: number; value: number }[];
  provenance: Provenance;
  notes?: string;
}

export type ComponentSpec =
  | {
      id: string;
      kind: "METRIC";
      /** Alternatives in priority order: the first with a primary instance is used. */
      metricKeys: MetricKey[];
      weight: number;
      minMaturity?: OperationalMaturity;
      stageBands?: StageBand[];
    }
  | { id: string; kind: "RUBRIC"; criterion: RubricCriterion; weight: number }
  | { id: string; kind: "FOUNDER_CAPABILITIES"; weight: number }
  | { id: string; kind: "MARKET_SIZE"; weight: number };

export interface DimensionSpec {
  id: DimensionId;
  name: string;
  description: string;
  /** Default components; profile overrides replace them entirely. */
  components: ComponentSpec[];
  profileOverrides?: Partial<Record<ProfileId, ComponentSpec[]>>;
}

export interface PeerGroup {
  id: string;
  profile: ProfileId;
  stageBand: StageBand;
  name: string;
}

export interface DecisionGate {
  id: string;
  description: string;
}

export interface FutureRound {
  name: string;
  dilutionPct: number;
  stepUp: number;
}

export interface BenchmarkRegistry {
  id: string;
  version: string;
  publishedAt: string;
  description: string;
  changelog: string[];
  benchmarks: MetricBenchmark[];
  dimensions: DimensionSpec[];
  /** Operating Quality Index dimension weights. INTERNAL_POLICY. */
  dimensionWeights: Record<StageBand, Record<DimensionId, number>>;
  dimensionWeightOverrides: Partial<Record<ProfileId, Record<DimensionId, number>>>;
  rubricPoints: Record<Exclude<RubricRating, "INSUFFICIENT_EVIDENCE">, number>;
  coverage: {
    scoredMin: number;
    partialMin: number;
    credit: { OBSERVED: number; INFERRED: number; STALE: number; SMALL_SAMPLE_MULTIPLIER: number };
  };
  maturityOrder: OperationalMaturity[];
  evidence: {
    verification: Record<"VERIFIED" | "PARTIALLY_VERIFIED" | "UNVERIFIED" | "CONTRADICTED", number>;
    origin: Record<"COMPANY" | "PRIMARY_EXTERNAL" | "INDEPENDENT_SECONDARY" | "ANECDOTAL", number>;
    freshness: Record<"CURRENT" | "AGING" | "STALE", number>;
    materialWeight: number;
    nonMaterialWeight: number;
    categories: { LOW: number; MODERATE: number; HIGH: number; VERY_HIGH: number };
  };
  powerLaw: {
    weights: { MARKET_CEILING: number; NONLINEAR_MECHANISM: number; EXCEPTIONAL_STRENGTH: number; OUTLIER_PATH: number };
    marketCeilingBenchmarkId: string;
    outlierPathBenchmarkId: string;
  };
  fundFit: {
    weights: Record<"STAGE" | "CHECK" | "OWNERSHIP" | "SECTOR" | "GEOGRAPHY" | "PORTFOLIO" | "RESERVES", number>;
    maxShareOfRoundPct: number;
  };
  risk: {
    levelPoints: Record<"LOW" | "MODERATE" | "HIGH" | "CRITICAL", number>;
  };
  returns: {
    futureRounds: Record<FinancingStage, FutureRound[]>;
    roundsBeforeExit: Record<ReturnScenarioName, number>;
    monthsBetweenRounds: number;
    defaultExitMultipleOfPostMoney: Record<ReturnScenarioName, number>;
    defaultYearsToExit: Record<ReturnScenarioName, number>;
    followOnPolicy: "NEXT_ROUND_PRO_RATA" | "NONE";
    defaultLiquidationPrefMultiple: number;
    backwardsRevenueMultiples: number[];
    priceSensitivityTargets: number[];
    samSharePlausibility: { PLAUSIBLE: number; DEMANDING: number; HEROIC: number };
    fundraisingLeadMonths: number;
    delayScenariosMonths: number[];
  };
  decision: {
    screenOutOqiUpper: number;
    exceptionalOverridePowerLaw: number;
    investMinOqiLower: number;
    investMinEvidence: "MODERATE" | "HIGH" | "VERY_HIGH";
    icReadyMinEvidence: "MODERATE" | "HIGH" | "VERY_HIGH";
    investMinBaseMoic: number;
    gates: DecisionGate[];
  };
  research: {
    maxFindingsPerRound: number;
  };
}
