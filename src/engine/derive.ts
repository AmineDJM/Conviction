/**
 * Computes the full deterministic layer (Layer A) from a canonical object,
 * a benchmark registry version and a fund profile. Pure function: the same
 * inputs always produce the same output (score-stability guarantee).
 */
import type { CanonicalDeal, InformationGap } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { BenchmarkRegistry } from "./benchmarks/types";
import { resolvePeerGroup, type PeerGroupRef } from "./scoring/peer";
import { operatingQuality, scoreDimensions, type DimensionScore, type OperatingQuality } from "./scoring/dimensions";
import { evidenceQuality, type EvidenceQualityResult } from "./scoring/evidence";
import { powerLaw, type PowerLawResult } from "./scoring/powerlaw";
import { reconstructMarket, type MarketReconstruction } from "./market";
import {
  backwardsReturn,
  buildReturnInputs,
  priceSensitivity,
  runReturnModel,
  type BackwardsResult,
  type PriceSensitivityRow,
  type ReturnInputs,
  type ReturnModel,
} from "./returns";
import { financingMap, type FinancingMap } from "./financing";
import { fundFit, type FundFitResult } from "./fund";
import { riskProfile, type RiskProfile } from "./risk";
import { decide, type Recommendation } from "./decision";
import { metricDef } from "./metrics/dictionary";
import { integrityReport, type IntegrityReport } from "./integrity";
import { economicsReport, type EconomicsReport } from "./economics";
import { latentReport, type LatentReport } from "./latent";

export interface ResearchPriority {
  gapId: string;
  question: string;
  index: number; // RESEARCH PRIORITY INDEX — conventional, not a probability
  channel: "WEB" | "FOUNDER" | "DATA_ROOM";
}

export interface SmallSampleWarning {
  metricId: string;
  metricKey: string;
  label: string;
  detail: string;
}

export interface DerivedAnalysis {
  registryId: string;
  computedAt: string;
  fundProfileId: string;
  peerGroup: PeerGroupRef;
  market: MarketReconstruction;
  dimensions: DimensionScore[];
  operatingQuality: OperatingQuality;
  evidence: EvidenceQualityResult;
  powerLaw: PowerLawResult;
  fundFit: FundFitResult;
  risk: RiskProfile;
  returns: ReturnModel;
  backwards: BackwardsResult | null;
  priceSensitivity: PriceSensitivityRow[];
  financing: FinancingMap;
  recommendation: Recommendation;
  researchPriority: ResearchPriority[];
  smallSampleWarnings: SmallSampleWarning[];
  /** Deck integrity: manipulative metrics, implied metrics, contradictions, expected evidence, evidence debt. */
  integrity: IntegrityReport;
  /** Institutional economics: cap-table returns, trajectory, sensitivity map, counterfactuals. */
  economics: EconomicsReport;
  /** Latent signals: what the deck reveals beyond what it claims. */
  latent: LatentReport;
}

export function researchPriorityIndex(g: Pick<InformationGap, "decisionImportance" | "uncertainty" | "researchability">): number {
  const factor = { PUBLIC_WEB: 1, BOTH: 0.8, DATA_ROOM: 0.4, FOUNDER_ONLY: 0.2 }[g.researchability];
  const imp = Math.min(5, Math.max(1, g.decisionImportance));
  const unc = Math.min(5, Math.max(1, g.uncertainty));
  return Math.round((imp / 5) * (unc / 5) * factor * 100);
}

export function arpaFor(deal: CanonicalDeal): { usd: number | null; source: string } {
  const acv = deal.metrics.find((m) => m.metricKey === "acv" && m.isPrimary && m.normalizedValue);
  if (acv) return { usd: acv.normalizedValue, source: `ACV (${acv.calculationMethod.toLowerCase()})` };
  const arpu = deal.metrics.find((m) => m.metricKey === "arpu_monthly" && m.isPrimary && m.normalizedValue);
  if (arpu) return { usd: arpu.normalizedValue! * 12, source: "ARPU × 12" };
  if (deal.arpaAssumptionUsd) return { usd: deal.arpaAssumptionUsd, source: "Model assumption (analysis)" };
  return { usd: null, source: "Unavailable" };
}

export interface DeriveOptions {
  returnOverrides?: Parameters<typeof buildReturnInputs>[3];
  targetContributionUsd?: number;
  now?: Date;
}

export function derive(deal: CanonicalDeal, registry: BenchmarkRegistry, fund: FundProfile, opts: DeriveOptions = {}): DerivedAnalysis {
  const peerGroup = resolvePeerGroup(deal.classification);
  const market = reconstructMarket(deal);
  const dimensions = scoreDimensions({ deal, registry, profile: peerGroup.profile, stageBand: peerGroup.stageBand, market });
  const oqi = operatingQuality(registry, peerGroup.profile, peerGroup.stageBand, dimensions);
  const evidence = evidenceQuality(deal, registry);

  const returnInputs: ReturnInputs = buildReturnInputs(deal, registry, fund, opts.returnOverrides);
  const returns = runReturnModel(returnInputs, registry, fund);
  const base = returns.scenarios.find((s) => s.scenario === "BASE");
  const backwards = base
    ? backwardsReturn(opts.targetContributionUsd ?? fund.targetDealReturnUsd, base.exitOwnershipPct, registry, arpaFor(deal), market.primary?.highUsd ?? null)
    : null;
  const pl = powerLaw(deal, registry, market, backwards);
  const ff = fundFit(deal, fund, registry, returnInputs.entry);
  const risk = riskProfile(deal, registry);
  const financing = financingMap(deal, registry);
  const recommendation = decide({ deal, registry, oqi, evidence, powerLaw: pl, fund: ff, risk, returns });

  const researchPriority: ResearchPriority[] = deal.informationGaps
    .filter((g) => g.status === "OPEN" || g.status === "NEEDS_FOUNDER")
    .map((g) => ({
      gapId: g.id,
      question: g.question,
      index: researchPriorityIndex(g),
      channel: (g.researchability === "FOUNDER_ONLY" ? "FOUNDER" : g.researchability === "DATA_ROOM" ? "DATA_ROOM" : "WEB") as ResearchPriority["channel"],
    }))
    .sort((a, b) => b.index - a.index);

  const smallSampleWarnings: SmallSampleWarning[] = deal.metrics
    .filter((m) => m.isPrimary && m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN")))
    .map((m) => ({
      metricId: m.id,
      metricKey: m.metricKey,
      label: metricDef(m.metricKey)?.shortName ?? m.metricKey,
      detail: m.qualityFlags.find((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN"))!,
    }));

  return {
    registryId: registry.id,
    computedAt: (opts.now ?? new Date()).toISOString(),
    fundProfileId: fund.id,
    peerGroup,
    market,
    dimensions,
    operatingQuality: oqi,
    evidence,
    powerLaw: pl,
    fundFit: ff,
    risk,
    returns,
    backwards,
    priceSensitivity: priceSensitivity(returnInputs, registry),
    financing,
    recommendation,
    researchPriority,
    smallSampleWarnings,
    integrity: integrityReport(deal, registry, peerGroup),
    economics: economicsReport({ deal, registry, fund, returns, backwards, market }),
    latent: latentReport(deal, registry, peerGroup),
  };
}
