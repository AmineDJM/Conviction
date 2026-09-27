/** §56 Risk map — multidimensional; the composite exists only for filtering. */
import type { CanonicalDeal, Risk } from "@/domain/canonical";
import type { Level, RiskCategory } from "@/domain/enums";
import { RISK_CATEGORIES } from "@/domain/enums";
import type { BenchmarkRegistry } from "./benchmarks/types";

export interface RiskProfile {
  byCategory: Record<RiskCategory, { max: Level | null; count: number }>;
  headline: Level | null;
  thesisKillers: Risk[];
  structural: Risk[];
  repairable: Risk[];
  /** 0–100 filter index: higher = riskier. Not a probability. */
  filterIndex: number;
}

const LEVELS: Level[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

export function riskProfile(deal: CanonicalDeal, registry: BenchmarkRegistry): RiskProfile {
  const byCategory = Object.fromEntries(RISK_CATEGORIES.map((c) => [c, { max: null as Level | null, count: 0 }])) as RiskProfile["byCategory"];
  let headline: Level | null = null;
  let exposure = 0;
  for (const r of deal.risks) {
    const cell = byCategory[r.category];
    cell.count++;
    if (!cell.max || LEVELS.indexOf(r.severity) > LEVELS.indexOf(cell.max)) cell.max = r.severity;
    if (LEVELS.indexOf(r.likelihood) >= 1 && (!headline || LEVELS.indexOf(r.severity) > LEVELS.indexOf(headline))) headline = r.severity;
    exposure += registry.risk.levelPoints[r.severity] * registry.risk.levelPoints[r.likelihood];
  }
  // Normalize: 16 = one critical-likely risk. Five such risks saturate the index.
  const filterIndex = Math.min(100, Math.round((exposure / (16 * 5)) * 100));
  return {
    byCategory,
    headline,
    thesisKillers: deal.risks.filter((r) => r.weaknessClass === "THESIS_KILLING"),
    structural: deal.risks.filter((r) => r.weaknessClass === "STRUCTURAL"),
    repairable: deal.risks.filter((r) => r.weaknessClass === "REPAIRABLE"),
    filterIndex,
  };
}
