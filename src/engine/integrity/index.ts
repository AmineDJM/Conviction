/**
 * Deck integrity engine (deterministic). Placeholder contract — implemented in
 * this folder: metric integrity rules, implied metrics, cross-slide numeric
 * consistency, expected evidence by stage, evidence debt, verification
 * priority, confidence by field, information density, market-slide coherence,
 * use-of-funds / financing consistency, chronology.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { PeerGroupRef } from "../scoring/peer";

export interface IntegrityReport {
  version: string;
  findings: IntegrityFinding[];
}

export interface IntegrityFinding {
  id: string;
  kind: string;
  severity: "LOW" | "MODERATE" | "HIGH" | "CRITICAL";
  title: string;
  detail: string;
  metricIds: string[];
  claimIds: string[];
  pages: number[];
}

export function integrityReport(_deal: CanonicalDeal, _registry: BenchmarkRegistry, _peer: PeerGroupRef): IntegrityReport {
  return { version: "0", findings: [] };
}
