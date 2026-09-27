/**
 * Controlled vocabularies for the canonical investment object.
 *
 * Every enum here is referenced by AI structured outputs, deterministic
 * engines and the UI. Changing a value is a schema migration: bump
 * CANONICAL_SCHEMA_VERSION in canonical.ts.
 */
import { z } from "zod";

const e = <T extends readonly [string, ...string[]]>(values: T) => z.enum(values);

/* ---------------------------------------------------------------- */
/* §11 Classification — independent axes                             */
/* ---------------------------------------------------------------- */

export const INDUSTRIES = [
  "HEALTHCARE",
  "FINANCIAL_SERVICES",
  "INDUSTRIAL",
  "CONSUMER",
  "ENTERPRISE_SOFTWARE",
  "REAL_ESTATE",
  "DEFENSE",
  "SPACE",
  "EDUCATION",
  "ENERGY_CLIMATE",
  "MOBILITY_LOGISTICS",
  "MEDIA_ENTERTAINMENT",
  "RETAIL_COMMERCE",
  "AGRICULTURE_FOOD",
  "LEGAL",
  "GOVERNMENT",
  "TELECOM",
  "OTHER",
] as const;
export const Industry = e(INDUSTRIES);
export type Industry = z.infer<typeof Industry>;

export const PRODUCT_TYPES = [
  "SAAS",
  "AI_AGENT",
  "SOFTWARE_INFRASTRUCTURE",
  "MARKETPLACE",
  "HARDWARE",
  "ROBOTICS",
  "MEDICAL_DEVICE",
  "THERAPEUTIC",
  "DIAGNOSTIC",
  "CONSUMER_APP",
  "API_PLATFORM",
  "FINTECH_PRODUCT",
  "TECH_ENABLED_SERVICE",
  "OTHER",
] as const;
export const ProductType = e(PRODUCT_TYPES);
export type ProductType = z.infer<typeof ProductType>;

export const TECHNOLOGIES = [
  "AI",
  "COMPUTER_VISION",
  "ROBOTICS",
  "BIOLOGY",
  "GENE_EDITING",
  "BLOCKCHAIN",
  "SEMICONDUCTORS",
  "QUANTUM",
  "MATERIALS",
  "ENERGY_STORAGE",
  "NONE_TRADITIONAL",
] as const;
export const Technology = e(TECHNOLOGIES);
export type Technology = z.infer<typeof Technology>;

export const REVENUE_MODELS = [
  "SUBSCRIPTION",
  "USAGE",
  "TRANSACTION",
  "TAKE_RATE",
  "LICENSING",
  "HARDWARE_MARGIN",
  "ADVERTISING",
  "SERVICES",
  "DRUG_ECONOMICS",
  "HYBRID",
  "PRE_REVENUE",
] as const;
export const RevenueModel = e(REVENUE_MODELS);
export type RevenueModel = z.infer<typeof RevenueModel>;

export const GTM_MOTIONS = [
  "PLG",
  "SELF_SERVE",
  "SMB_SALES",
  "MID_MARKET",
  "ENTERPRISE_SALES",
  "CHANNEL",
  "PARTNERSHIP",
  "MARKETPLACE",
  "CONSUMER_PAID",
  "ORGANIC_VIRAL",
] as const;
export const GtmMotion = e(GTM_MOTIONS);
export type GtmMotion = z.infer<typeof GtmMotion>;

export const OPERATIONAL_MATURITY = [
  "PRE_PRODUCT",
  "PROTOTYPE",
  "PILOT",
  "EARLY_REVENUE",
  "PMF_EMERGING",
  "SCALED_GTM",
  "GROWTH",
] as const;
export const OperationalMaturity = e(OPERATIONAL_MATURITY);
export type OperationalMaturity = z.infer<typeof OperationalMaturity>;

export const FINANCING_STAGES = ["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "SERIES_C_PLUS", "UNKNOWN"] as const;
export const FinancingStage = e(FINANCING_STAGES);
export type FinancingStage = z.infer<typeof FinancingStage>;

/* ---------------------------------------------------------------- */
/* §17 Missing-data states                                            */
/* ---------------------------------------------------------------- */

export const DATA_STATES = [
  "OBSERVED",
  "UNKNOWN",
  "NOT_APPLICABLE",
  "NOT_YET_MEANINGFUL",
  "WITHHELD",
  "CONTRADICTED",
  "STALE",
  "INFERRED",
] as const;
export const DataState = e(DATA_STATES);
export type DataState = z.infer<typeof DataState>;

/* ---------------------------------------------------------------- */
/* §60 Evidence dimensions — stored separately, never collapsed       */
/* ---------------------------------------------------------------- */

export const EVIDENCE_ORIGINS = ["COMPANY", "PRIMARY_EXTERNAL", "INDEPENDENT_SECONDARY", "ANECDOTAL"] as const;
export const EvidenceOrigin = e(EVIDENCE_ORIGINS);
export type EvidenceOrigin = z.infer<typeof EvidenceOrigin>;

export const VERIFICATION_STATUSES = ["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED", "CONTRADICTED"] as const;
export const VerificationStatus = e(VERIFICATION_STATUSES);
export type VerificationStatus = z.infer<typeof VerificationStatus>;

export const FRESHNESS = ["CURRENT", "AGING", "STALE"] as const;
export const Freshness = e(FRESHNESS);
export type Freshness = z.infer<typeof Freshness>;

export const INDEPENDENCE = ["INDEPENDENT", "SHARED_ORIGIN", "COMPANY_DERIVED"] as const;
export const Independence = e(INDEPENDENCE);
export type Independence = z.infer<typeof Independence>;

export const CLAIM_CATEGORIES = [
  "METRIC",
  "FINANCIAL",
  "CUSTOMER",
  "PRODUCT",
  "TECHNOLOGY",
  "MARKET",
  "COMPETITION",
  "TEAM",
  "FUNDING",
  "PARTNERSHIP",
  "REGULATORY",
  "IP",
  "OTHER",
] as const;
export const ClaimCategory = e(CLAIM_CATEGORIES);
export type ClaimCategory = z.infer<typeof ClaimCategory>;

/** UI evidence label (§86). Derived deterministically from the dimensions above. */
export const EVIDENCE_LABELS = ["VERIFIED", "COMPANY_REPORTED", "INFERRED", "ESTIMATED", "UNKNOWN", "CONTRADICTED"] as const;
export type EvidenceLabel = (typeof EVIDENCE_LABELS)[number];

/* ---------------------------------------------------------------- */
/* Anchored scales                                                    */
/* ---------------------------------------------------------------- */

/** Anchored 5-point rubric used for qualitative dimensions. Mapped to points only by the benchmark registry. */
export const RUBRIC_RATINGS = [
  "INSUFFICIENT_EVIDENCE",
  "WEAK",
  "BELOW_BAR",
  "ADEQUATE",
  "STRONG",
  "EXCEPTIONAL",
] as const;
export const RubricRating = e(RUBRIC_RATINGS);
export type RubricRating = z.infer<typeof RubricRating>;

export const LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
export const Level = e(LEVELS);
export type Level = z.infer<typeof Level>;

export const EVIDENCE_QUALITY = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"] as const;
export type EvidenceQuality = (typeof EVIDENCE_QUALITY)[number];

export const OBSERVABILITY = ["OBSERVABLE", "INFERRED", "NOT_OBSERVABLE"] as const;
export const Observability = e(OBSERVABILITY);
export type Observability = z.infer<typeof Observability>;

/* ---------------------------------------------------------------- */
/* §28 Demand types                                                   */
/* ---------------------------------------------------------------- */

export const DEMAND_TYPES = ["HAIR_ON_FIRE", "HARD_FACT", "FUTURE_VISION", "CONSUMER_DESIRE"] as const;
export const DemandType = e(DEMAND_TYPES);

/* ---------------------------------------------------------------- */
/* §56 Risk categories, §23 weakness classes                          */
/* ---------------------------------------------------------------- */

export const RISK_CATEGORIES = [
  "TECHNICAL",
  "PRODUCT",
  "MARKET",
  "GTM",
  "CUSTOMER",
  "COMPETITION",
  "REGULATORY",
  "LEGAL_IP",
  "FINANCING",
  "EXECUTION",
  "KEY_PERSON",
] as const;
export const RiskCategory = e(RISK_CATEGORIES);
export type RiskCategory = z.infer<typeof RiskCategory>;

export const WEAKNESS_CLASSES = ["REPAIRABLE", "STRUCTURAL", "THESIS_KILLING"] as const;
export const WeaknessClass = e(WEAKNESS_CLASSES);

export const RISK_TIMING = ["NOW", "NEXT_12_MONTHS", "NEXT_ROUND", "AT_SCALE", "EXIT"] as const;
export const RiskTiming = e(RISK_TIMING);

/* ---------------------------------------------------------------- */
/* §66 Decision vocabulary — three separate axes                      */
/* ---------------------------------------------------------------- */

export const DECISION_STATUSES = [
  "SCREEN_OUT",
  "NEEDS_FOUNDER_CALL",
  "NEEDS_TARGETED_DILIGENCE",
  "DEEP_DD",
  "IC_READY",
  "ANALYTICAL_RECOMMEND_INVEST",
  "WATCH",
  "ANALYTICAL_RECOMMEND_PASS",
] as const;
export const DecisionStatus = e(DECISION_STATUSES);
export type DecisionStatus = z.infer<typeof DecisionStatus>;

export const IC_DECISIONS = ["PENDING", "APPROVED", "REJECTED"] as const;
export const IcDecision = e(IC_DECISIONS);
export type IcDecision = z.infer<typeof IcDecision>;

export const EXECUTION_STATUSES = ["NOT_STARTED", "TERM_SHEET", "SIGNED", "FUNDED"] as const;
export const ExecutionStatus = e(EXECUTION_STATUSES);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

/* ---------------------------------------------------------------- */
/* §9 Analysis modes                                                  */
/* ---------------------------------------------------------------- */

export const ANALYSIS_MODES = ["FAST_SCREEN", "STANDARD", "DEEP_DD"] as const;
export const AnalysisMode = e(ANALYSIS_MODES);
export type AnalysisMode = z.infer<typeof AnalysisMode>;

export const ANALYSIS_DEPTH = ["FULL", "PARTIAL"] as const;
export type AnalysisDepth = (typeof ANALYSIS_DEPTH)[number];

/* ---------------------------------------------------------------- */
/* Questions                                                          */
/* ---------------------------------------------------------------- */

export const QUESTION_TIERS = ["MUST_ASK", "IMPORTANT", "OPTIONAL"] as const;
export const QuestionTier = e(QUESTION_TIERS);
export type QuestionTier = z.infer<typeof QuestionTier>;

export const QUESTION_EFFECTS = ["RECOMMENDATION", "NEXT_DILIGENCE_STEP", "VALUATION", "RISK", "RETURN"] as const;
export const QuestionEffect = e(QUESTION_EFFECTS);

export const QUESTION_STATUSES = ["OPEN", "ASKED", "RESOLVED", "NOT_FULLY_RESOLVED"] as const;
export const QuestionStatus = e(QUESTION_STATUSES);
export type QuestionStatus = z.infer<typeof QuestionStatus>;

export const COMPETITOR_TYPES = ["DIRECT", "INDIRECT", "INCUMBENT", "INTERNAL_SOLUTION", "DO_NOTHING", "EMERGING"] as const;
export const CompetitorType = e(COMPETITOR_TYPES);

export const MOAT_DIMENSIONS = [
  "TECHNOLOGY_IP",
  "DATA",
  "NETWORK_EFFECTS",
  "SWITCHING_COSTS",
  "DISTRIBUTION",
  "BRAND",
  "REGULATION",
  "WORKFLOW_LOCK_IN",
  "ECONOMIES_OF_SCALE",
  "LEARNING_EFFECTS",
] as const;
export const MoatDimension = e(MOAT_DIMENSIONS);

export const MOAT_STRENGTH = ["NONE", "EMERGING", "MODERATE", "STRONG"] as const;
export const MoatStrength = e(MOAT_STRENGTH);

export const RETURN_SCENARIOS = ["FAILURE", "LOW", "BASE", "BULL", "OUTLIER"] as const;
export const ReturnScenarioName = e(RETURN_SCENARIOS);
export type ReturnScenarioName = z.infer<typeof ReturnScenarioName>;

export const INSTRUMENTS = ["PRICED_EQUITY", "SAFE", "CONVERTIBLE_NOTE", "UNKNOWN"] as const;
export const Instrument = e(INSTRUMENTS);
export type Instrument = z.infer<typeof Instrument>;

export const CONDITION_STATUS = ["SUPPORTED", "PARTIALLY_SUPPORTED", "HYPOTHETICAL", "CONTRADICTED"] as const;
export const ConditionStatus = e(CONDITION_STATUS);

export const FALSIFIER_STATUS = ["NOT_TESTED", "SEARCHED_NOT_FOUND", "PARTIAL_SIGNAL", "FOUND"] as const;
export const FalsifierStatus = e(FALSIFIER_STATUS);

export const CUSTOMER_RELATIONSHIPS = ["PAYING", "PILOT", "LOI", "LOGO_ONLY", "PARTNER", "UNKNOWN"] as const;
export const CustomerRelationship = e(CUSTOMER_RELATIONSHIPS);

export const ADVERSARIAL_TESTS = ["INCUMBENT_COPY", "COST_COMMODITIZATION", "DISTRIBUTION"] as const;
export const AdversarialTest = e(ADVERSARIAL_TESTS);

export const ADVERSARIAL_VERDICTS = ["SURVIVES", "WEAKENED", "FAILS", "UNCLEAR"] as const;
export const AdversarialVerdict = e(ADVERSARIAL_VERDICTS);

export const REFERENCE_TYPES = ["REFERENCE_SELECTED_BY_COMPANY", "INDEPENDENT_REFERENCE"] as const;
