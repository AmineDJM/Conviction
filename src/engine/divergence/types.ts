/**
 * Shared types of the Divergence Factors engine.
 *
 * Every factor states its ordinal level (never a probability, never blended
 * with the other factors), the plain-text rule that produced it, the evidence
 * with pages and refs, which inputs were available or missing, and the
 * numbers code computed. Divergence factors are SECONDARY analysis: they are
 * never folded into the Operating Quality Index.
 */

/**
 * MODEL_OBSERVED = read by the model from the deck (deal.divergence);
 * COMPUTED = derived by code from structured data;
 * MODEL_ASSUMPTION = an engine convention (versioned constant);
 * RESEARCH = external research findings stored as claims.
 */
export type DivergenceBasis = "MODEL_OBSERVED" | "COMPUTED" | "MODEL_ASSUMPTION" | "RESEARCH";

/** Ordinal favourability for a venture outcome. Never a probability. */
export type DivergenceLevel = "STRONG" | "ADEQUATE" | "WEAK" | "INSUFFICIENT_EVIDENCE";

export const LEVEL_RANK: Record<Exclude<DivergenceLevel, "INSUFFICIENT_EVIDENCE">, number> = { WEAK: 0, ADEQUATE: 1, STRONG: 2 };

export const FACTOR_IDS = [
  "AMBITION_CEILING",
  "CAP_TABLE_ALIGNMENT",
  "SYNDICATE_QUALITY",
  "STRATEGIC_SURVIVABILITY",
  "MARKET_STRUCTURE",
  "DEPENDENCY_SURFACE",
  "LAND_EXPAND_PLATFORM",
  "ORGANIZATIONAL_FOCUS",
  "COMPOUNDING_LOOPS",
  "SCALABILITY_ARCHITECTURE",
] as const;
export type FactorId = (typeof FACTOR_IDS)[number];

export interface DivergenceEvidence {
  basis: DivergenceBasis;
  text: string;
  /** Deck pages (sorted, unique). */
  pages: number[];
  /** Claim / metric / source ids (CLM-…, MET-…, SRC-…). */
  refs: string[];
}

export interface DivergenceCoverage {
  available: string[];
  missing: string[];
  /** available / (available + missing), 0–1. */
  ratio: number;
  note: string | null;
}

export type ComputedUnit = "USD" | "PCT" | "MONTHS" | "COUNT" | "RATIO" | "MULTIPLE" | "TEXT";

export interface ComputedValue {
  key: string;
  label: string;
  value: number | string | null;
  unit: ComputedUnit;
  basis: DivergenceBasis;
}

export interface FactorBase {
  id: FactorId;
  /** 1–10, the order in which the factors are presented. */
  n: number;
  name: string;
  /** The question the factor answers. */
  question: string;
  level: DivergenceLevel;
  /** Factor-specific reading (e.g. FRAGMENTED, CRITICAL_SINGLE_POINT). */
  reading: string;
  /** One line: why this level. */
  why: string;
  basis: DivergenceBasis[];
  pages: number[];
  /** The deterministic rule, in plain words. */
  rule: string;
  evidence: DivergenceEvidence[];
  coverage: DivergenceCoverage;
  computed: ComputedValue[];
  /** What this means for the investment (hiring, next round, outcome size …). */
  implications: string[];
}
