/**
 * Types of the deterministic deck integrity report. Everything here is data
 * computed by code from the canonical object ("AI extracts, code judges").
 */
import type { ProfileId, StageBand } from "../benchmarks/types";

export type IntegritySeverity = "LOW" | "MODERATE" | "HIGH" | "CRITICAL";

export type IntegrityModule =
  | "METRIC_RULES"
  | "IMPLIED_METRICS"
  | "CROSS_SLIDE"
  | "EXPECTED_EVIDENCE"
  | "CHRONOLOGY"
  | "CONTRADICTIONS"
  | "SOURCES"
  | "SECURITY"
  | "MODEL_FORENSICS";

/** COMPUTED = deterministic rule in this folder; MODEL = reported by the model (deck forensics), kept for comparison. */
export type FindingOrigin = "COMPUTED" | "MODEL";

export interface IntegrityFinding {
  /** Stable id: same input → same id. */
  id: string;
  /** Rule identifier, e.g. GROWTH_ON_TINY_BASE, IMPLIED_ACV, CROSS_SLIDE_VALUE_CONFLICT. */
  kind: string;
  module: IntegrityModule;
  origin: FindingOrigin;
  severity: IntegritySeverity;
  title: string;
  detail: string;
  metricIds: string[];
  claimIds: string[];
  sourceIds: string[];
  pages: number[];
}

/* ---------------------------------------------------------------- */
/* Implied metrics                                                    */
/* ---------------------------------------------------------------- */

export type ImpliedVerdict = "CONSISTENT" | "INCONSISTENT" | "UNVERIFIABLE";

export interface ImpliedMetric {
  id: string;
  name: string;
  formula: string;
  /** Metric ids (MET-…) and canonical field paths (financing.cashBalance …) used. */
  inputs: string[];
  /** Inputs that were needed but not available. */
  missingInputs: string[];
  unit: "USD" | "PERCENT" | "MONTHS" | "MULTIPLE" | "COUNT" | "RATIO";
  impliedValue: number | null;
  statedValue: number | null;
  /** |stated − implied| / |implied| × 100 (or the relation-specific measure named in `note`). */
  deltaPct: number | null;
  verdict: ImpliedVerdict;
  severity: IntegritySeverity | null;
  note: string;
}

/* ---------------------------------------------------------------- */
/* Cross-slide consistency                                            */
/* ---------------------------------------------------------------- */

export type ContradictionClass = "ROUNDING" | "TYPO" | "DEFINITION" | "MATERIAL_VALUE" | "SELF_CONTRADICTION" | "INDEPENDENT_SOURCE";

export interface CrossSlideInconsistency {
  id: string;
  origin: FindingOrigin;
  topic: string;
  metricKey: string | null;
  periodEnd: string | null;
  pages: number[];
  claimIds: string[];
  values: string[];
  relativeDifferencePct: number | null;
  class: ContradictionClass;
  severity: IntegritySeverity | null;
  detail: string;
}

/* ---------------------------------------------------------------- */
/* Expected evidence                                                  */
/* ---------------------------------------------------------------- */

export type ExpectationLevel = "EXPECTED" | "NICE_TO_HAVE" | "NOT_YET_EXPECTED";
export type EvidencePresence = "PRESENT" | "MISSING" | "WITHHELD";

export interface ExpectedEvidenceItemResult {
  itemId: string;
  label: string;
  level: ExpectationLevel;
  presence: EvidencePresence;
  /** Refs (metric ids, field paths) that satisfied the item. */
  refs: string[];
  severity: IntegritySeverity | null;
  perfectSlide: string | null;
}

export interface ExpectedEvidenceResult {
  version: string;
  profile: ProfileId;
  stageBand: StageBand;
  items: ExpectedEvidenceItemResult[];
  missingExpected: string[];
  withheldExpected: string[];
  missingNiceToHave: string[];
  perfectSlides: { itemId: string; label: string; slide: string }[];
}

/* ---------------------------------------------------------------- */
/* Evidence debt                                                      */
/* ---------------------------------------------------------------- */

export type EvidenceArea = "PRODUCT_PROOF" | "TRACTION" | "MARKET" | "GTM" | "MOAT" | "TEAM" | "FINANCING";
export type DebtLevel = "LOW" | "MODERATE" | "HIGH" | "VERY_HIGH";
export type SupportStatus = "VERIFIED" | "INDEPENDENTLY_SUPPORTED" | "COMPANY_ONLY" | "CONTRADICTED";

export interface DebtItem {
  ref: string;
  kind: "CLAIM" | "METRIC";
  area: EvidenceArea;
  status: SupportStatus;
  unusualness: number;
  weight: number;
  debtContribution: number;
  label: string;
}

export interface AreaDebt {
  area: EvidenceArea;
  items: number;
  verified: number;
  independentlySupported: number;
  companyOnly: number;
  contradicted: number;
  /** Weighted share of items resting only on company assertions (0–1). */
  companyOnlyWeightedShare: number | null;
  /** null when the area has no material claims or metrics. */
  level: DebtLevel | null;
  rule: string;
}

export interface EvidenceDebtResult {
  rule: string;
  overall: DebtLevel | null;
  overallCompanyOnlyWeightedShare: number | null;
  areas: AreaDebt[];
  topDebt: DebtItem[];
}

/* ---------------------------------------------------------------- */
/* Verification priority                                              */
/* ---------------------------------------------------------------- */

export interface VerificationPriorityItem {
  claimId: string;
  statement: string;
  category: string;
  index: number;
  materiality: number;
  unusualness: number;
  uncertainty: number;
  pages: number[];
}

export interface VerificationPriorityResult {
  label: string;
  formula: string;
  items: VerificationPriorityItem[];
}

/* ---------------------------------------------------------------- */
/* Confidence                                                         */
/* ---------------------------------------------------------------- */

export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW" | "NONE";

export interface FieldConfidence {
  field: string;
  label: string;
  ref: string | null;
  confidence: ConfidenceLevel;
  score: number;
  reasons: string[];
}

export interface ConfidenceResult {
  metrics: FieldConfidence[];
  fields: FieldConfidence[];
}

/* ---------------------------------------------------------------- */
/* Information density                                                */
/* ---------------------------------------------------------------- */

export interface InformationDensity {
  label: string;
  pages: number | null;
  materialClaims: number;
  materialClaimsPerPage: number | null;
  quantitativeObservations: number;
  quantitativeObservationsPerPage: number | null;
  unsupportedClaimRatio: number | null;
  redundantClaimPairs: { a: string; b: string; similarity: number }[];
  redundancyRatio: number | null;
  pagesWithoutDecisionFacts: number[];
  shareOfPagesWithoutDecisionFacts: number | null;
}

/* ---------------------------------------------------------------- */
/* Chronology                                                         */
/* ---------------------------------------------------------------- */

export type ChronologyGroup = "CURRENT" | "CONTRACTED" | "FORWARD";

export interface ChronologyRow {
  metricKey: string;
  label: string;
  basis: string;
  group: ChronologyGroup;
  periodType: string;
  periodStart: string | null;
  periodEnd: string | null;
  value: number | null;
  unit: string;
  currency: string | null;
  page: number | null;
  rawText: string;
  flags: string[];
}

export interface ChronologyTable {
  current: ChronologyRow[];
  contracted: ChronologyRow[];
  forward: ChronologyRow[];
  hockeySticks: { metricKey: string; forecastCagrPct: number; trailingGrowthPct: number | null; ratio: number | null; pages: number[] }[];
}

/* ---------------------------------------------------------------- */
/* Contradictions                                                     */
/* ---------------------------------------------------------------- */

export interface RankedContradiction {
  id: string;
  class: ContradictionClass;
  origin: FindingOrigin;
  severity: IntegritySeverity;
  title: string;
  detail: string;
  claimIds: string[];
  metricIds: string[];
  sourceIds: string[];
  pages: number[];
}

/* ---------------------------------------------------------------- */
/* Source reliability                                                 */
/* ---------------------------------------------------------------- */

export type SourceTier =
  | "PRIMARY_RECORD"
  | "SECONDARY"
  | "SELF_AUTHORED_PROFILE"
  | "COMPANY_DERIVED"
  | "COMMERCIAL_ESTIMATE"
  | "LOW_QUALITY"
  | "UNKNOWN";

export interface SourceReliability {
  sourceId: string;
  url: string | null;
  domain: string | null;
  tier: SourceTier;
  flags: string[];
  cluster: string | null;
  ageMonths: number | null;
}

/* ---------------------------------------------------------------- */
/* Report                                                             */
/* ---------------------------------------------------------------- */

export interface IntegritySummary {
  critical: number;
  high: number;
  moderate: number;
  low: number;
  top: { id: string; kind: string; severity: IntegritySeverity; title: string }[];
  evidenceDebtOverall: DebtLevel | null;
  missingExpectedCount: number;
  contradictionCount: number;
  inconsistentImpliedCount: number;
  headline: string;
}

export interface IntegrityReport {
  version: string;
  expectedEvidenceVersion: string;
  /** Reference date used for staleness, taken from the deal itself (never the wall clock). */
  asOf: string | null;
  peerGroup: { profile: ProfileId; stageBand: StageBand };
  findings: IntegrityFinding[];
  impliedMetrics: ImpliedMetric[];
  crossSlide: CrossSlideInconsistency[];
  expectedEvidence: ExpectedEvidenceResult;
  evidenceDebt: EvidenceDebtResult;
  verificationPriority: VerificationPriorityResult;
  confidence: ConfidenceResult;
  density: InformationDensity;
  chronology: ChronologyTable;
  contradictions: RankedContradiction[];
  sourceReliability: SourceReliability[];
  summary: IntegritySummary;
  /** Modules that could not run on this (partial) input; the report is still valid. */
  diagnostics: string[];
}
