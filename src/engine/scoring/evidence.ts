/**
 * Evidence quality from the claim ledger (§20, §59–60).
 * Independence groups prevent five articles repeating one press release from
 * counting as five confirmations.
 */
import type { CanonicalDeal, Claim } from "@/domain/canonical";
import type { EvidenceLabel, EvidenceQuality } from "@/domain/enums";
import type { BenchmarkRegistry } from "../benchmarks/types";

export interface EvidenceQualityResult {
  index: number; // 0–100 conventional index, NOT a probability
  category: EvidenceQuality;
  materialClaims: number;
  verifiedMaterial: number;
  contradictedMaterial: number;
  independentConfirmations: number;
  companyOnlyMaterial: number;
  breakdown: { verification: Record<string, number>; origin: Record<string, number> };
}

/** Count distinct independence groups that confirm a claim (excluding the company origin). */
export function independentConfirmations(claim: Claim, deal: CanonicalDeal): number {
  const groups = new Set<string>();
  for (const e of claim.evidence) {
    if (e.effect !== "CONFIRMS" && e.effect !== "PARTIALLY_CONFIRMS") continue;
    const src = deal.sources.find((s) => s.id === e.sourceId);
    if (!src || src.origin === "COMPANY" || !src.citationVerified) continue;
    groups.add(src.independenceGroup);
  }
  return groups.size;
}

export function evidenceQuality(deal: CanonicalDeal, registry: BenchmarkRegistry): EvidenceQualityResult {
  const cfg = registry.evidence;
  let wSum = 0;
  let sSum = 0;
  let materialClaims = 0;
  let verifiedMaterial = 0;
  let contradictedMaterial = 0;
  let companyOnlyMaterial = 0;
  let independent = 0;
  const verification: Record<string, number> = {};
  const origin: Record<string, number> = {};
  for (const c of deal.claims) {
    const w = c.material ? cfg.materialWeight : cfg.nonMaterialWeight;
    const s = cfg.verification[c.verification] * cfg.origin[c.origin] * cfg.freshness[c.freshness];
    wSum += w;
    sSum += w * s;
    verification[c.verification] = (verification[c.verification] ?? 0) + 1;
    origin[c.origin] = (origin[c.origin] ?? 0) + 1;
    if (c.material) {
      materialClaims++;
      if (c.verification === "VERIFIED") verifiedMaterial++;
      if (c.verification === "CONTRADICTED") contradictedMaterial++;
      const ic = independentConfirmations(c, deal);
      independent += ic;
      if (ic === 0 && c.origin === "COMPANY") companyOnlyMaterial++;
    }
  }
  const index = wSum > 0 ? Math.round((sSum / wSum) * 1000) / 10 : 0;
  const cats = cfg.categories;
  const category: EvidenceQuality =
    index >= cats.VERY_HIGH ? "VERY_HIGH" : index >= cats.HIGH ? "HIGH" : index >= cats.MODERATE ? "MODERATE" : "LOW";
  return {
    index,
    category,
    materialClaims,
    verifiedMaterial,
    contradictedMaterial,
    independentConfirmations: independent,
    companyOnlyMaterial,
    breakdown: { verification, origin },
  };
}

/** §86 quiet UI label derived from the separate evidence dimensions. */
export function evidenceLabel(c: Pick<Claim, "verification" | "origin">): EvidenceLabel {
  if (c.verification === "CONTRADICTED") return "CONTRADICTED";
  if (c.verification === "VERIFIED") return "VERIFIED";
  if (c.verification === "PARTIALLY_VERIFIED") return c.origin === "COMPANY" ? "COMPANY_REPORTED" : "VERIFIED";
  if (c.origin === "COMPANY") return "COMPANY_REPORTED";
  if (c.origin === "ANECDOTAL") return "ESTIMATED";
  return "INFERRED";
}

const ORDER: EvidenceQuality[] = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"];
export function evidenceAtLeast(actual: EvidenceQuality, min: EvidenceQuality) {
  return ORDER.indexOf(actual) >= ORDER.indexOf(min);
}
