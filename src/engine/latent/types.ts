/**
 * Shared types of the Latent Signal Engine.
 *
 * Every signal says what it is based on (`basis`), which pages it rests on,
 * and how much of the input it needed was actually available (`coverage`).
 * Latent signals are SECONDARY signals: they are never folded into the
 * Operating Quality Index.
 */

/** MODEL_OBSERVED = read by the model from the deck (deal.latentSignals, forensics); COMPUTED = derived by code from structured data. */
export type LatentBasis = "MODEL_OBSERVED" | "COMPUTED";

export interface LatentEvidence {
  basis: LatentBasis;
  text: string;
  page: number | null;
}

export interface LatentCoverage {
  /** Inputs that were available for this signal. */
  available: string[];
  /** Inputs that were missing — the signal is weaker for it. */
  missing: string[];
  /** available / (available + missing), 0–1. */
  ratio: number;
  note: string | null;
}

/** WEAK → EXCEPTIONAL scale for qualities; INSUFFICIENT_EVIDENCE when the deck does not allow a reading. */
export type QualityLevel = "WEAK" | "MODERATE" | "STRONG" | "EXCEPTIONAL" | "INSUFFICIENT_EVIDENCE";
/** LOW → HIGH scale for risks / dependences. */
export type RiskLevel = "LOW" | "MODERATE" | "HIGH" | "INSUFFICIENT_EVIDENCE";

export interface LatentModule {
  /** Distinct bases the module rests on. */
  basis: LatentBasis[];
  /** Deck pages the module rests on (sorted, unique). */
  pages: number[];
  coverage: LatentCoverage;
  /** The deterministic rule used, in plain words. */
  rule: string;
}

export const QUALITY_ORDER: Record<Exclude<QualityLevel, "INSUFFICIENT_EVIDENCE">, number> = {
  WEAK: 0,
  MODERATE: 1,
  STRONG: 2,
  EXCEPTIONAL: 3,
};
