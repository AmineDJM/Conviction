/**
 * LATENT SIGNAL ENGINE (deterministic aggregation).
 *
 * "Do not only analyze what the founder wants to show. Also analyze what their
 * presentation choices, metrics, omissions, definitions and inconsistencies
 * unintentionally reveal about the company."
 *
 * Combines model-extracted observable signals (deal.latentSignals, forensics)
 * with signals computed from the canonical object. Observable signals only —
 * no psychology. Every output states its basis (MODEL_OBSERVED | COMPUTED),
 * the pages it rests on and its coverage. These are SECONDARY signals: they
 * are never folded into the Operating Quality Index. Pure, deterministic for
 * a given `asOf`, never throws on missing data.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { PeerGroupRef } from "../scoring/peer";
import { reconstructMarket, type MarketReconstruction } from "../market";
import { metricSelection, type MetricSelection } from "./metric-selection";
import { missingAsSignal, type MissingAsSignal } from "./missing";
import { precisionDiscipline, type PrecisionDiscipline } from "./precision";
import { narrativeInflation, type NarrativeInflation } from "./inflation";
import { operatingMaturity, type OperatingMaturity } from "./maturity";
import { qualityOfThinking, type QualityOfThinking } from "./thinking";
import { causalUnderstanding, type CausalUnderstanding } from "./causal";
import { ambition, type Ambition } from "./ambition";
import { resourceEfficiency, type ResourceEfficiency } from "./efficiency";
import { disclosureQuality, type DisclosureQuality } from "./disclosure";
import type { LatentBasis } from "./types";
import { bases, pagesOf, resolveAsOf } from "./util";

export const LATENT_ENGINE_VERSION = "latent-1.0";

export interface SynthesisSignal {
  id: string;
  module: string;
  signal: string;
  direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL";
  basis: LatentBasis[];
  evidence: string;
  pages: number[];
  /** Informativeness weight used for ordering (1–5). */
  weight: number;
}

export interface LatentCoverageSummary {
  latentSignalsAvailable: boolean;
  forensicsAvailable: boolean;
  metricObservations: number;
  normalizedMetrics: number;
  modulesAssessed: number;
  modulesTotal: number;
  notes: string[];
}

export interface LatentReport {
  version: string;
  asOf: string;
  registryId: string | null;
  peerGroup: string;
  /** Secondary signals — never folded into the Operating Quality Index. */
  secondary: true;
  operatingMaturity: OperatingMaturity;
  qualityOfThinking: QualityOfThinking;
  metricSelection: MetricSelection;
  narrativeInflation: NarrativeInflation;
  missingAsSignal: MissingAsSignal;
  precisionDiscipline: PrecisionDiscipline;
  causalUnderstanding: CausalUnderstanding;
  ambition: Ambition;
  resourceEfficiency: ResourceEfficiency;
  disclosureQuality: DisclosureQuality;
  coverage: LatentCoverageSummary;
  /** The most informative latent signals, for "What the deck reveals beyond the pitch" and the Fund Brain. */
  signalsForSynthesis: SynthesisSignal[];
  /** Compact digest of the report for prompts. */
  summary: LatentSummary;
}

/** Compact digest for prompts (the pipeline's compactReport uses `summary` when the full report is too large). */
export interface LatentSummary {
  version: string;
  peerGroup: string;
  basisNote: string;
  operatingMaturity: { level: string; assessed: number; understandsWeakNumbers: boolean };
  qualityOfThinking: { level: string; supportedPct: number | null; marketSizing: string; unsupported: string[] };
  metricSelection: { decisionCoveragePct: number | null; absent: string[]; vanityDependence: string; vanity: string[] };
  narrativeInflation: { level: string; score: number; why: string[] };
  materialOmissions: string[];
  withheld: string[];
  precisionDiscipline: { level: string; score: number | null };
  causalUnderstanding: { level: string; bridge: string };
  ambition: { consistency: string; question: string };
  resourceEfficiency: string[];
  disclosureQuality: { level: string; score: number };
  coverageNotes: string[];
  signalsForSynthesis: SynthesisSignal[];
}

function summarize(r: Omit<LatentReport, "signalsForSynthesis" | "coverage" | "summary">, coverage: LatentCoverageSummary, signalsForSynthesis: SynthesisSignal[]): LatentSummary {
  return {
    version: r.version,
    peerGroup: r.peerGroup,
    basisNote: "Secondary, observable signals (MODEL_OBSERVED | COMPUTED); never an honesty judgement; never part of the OQI.",
    operatingMaturity: { level: r.operatingMaturity.level, assessed: r.operatingMaturity.assessed, understandsWeakNumbers: r.operatingMaturity.understandsWeakNumbers },
    qualityOfThinking: { level: r.qualityOfThinking.level, supportedPct: r.qualityOfThinking.supportedPct, marketSizing: r.qualityOfThinking.marketSizing.style, unsupported: r.qualityOfThinking.unsupportedConclusions.slice(0, 4).map((c) => c.conclusion) },
    metricSelection: { decisionCoveragePct: r.metricSelection.decisionCoveragePct, absent: r.metricSelection.absentDecisionMetrics, vanityDependence: r.metricSelection.vanityDependence, vanity: r.metricSelection.vanityMetrics.slice(0, 6).map((v) => v.metric) },
    narrativeInflation: { level: r.narrativeInflation.level, score: r.narrativeInflation.score, why: r.narrativeInflation.why.slice(0, 6) },
    materialOmissions: r.missingAsSignal.material.slice(0, 4).map((o) => o.sentence),
    withheld: r.missingAsSignal.withheld.map((o) => o.metric),
    precisionDiscipline: { level: r.precisionDiscipline.level, score: r.precisionDiscipline.score },
    causalUnderstanding: { level: r.causalUnderstanding.level, bridge: `${r.causalUnderstanding.bridge.status}: ${r.causalUnderstanding.bridge.detail}` },
    ambition: { consistency: r.ambition.consistency, question: r.ambition.question },
    resourceEfficiency: r.resourceEfficiency.readings,
    disclosureQuality: { level: r.disclosureQuality.level, score: r.disclosureQuality.score },
    coverageNotes: coverage.notes,
    signalsForSynthesis,
  };
}

export interface LatentOptions {
  /** Evaluation date (months since founding, future-dated values). Defaults to the analysis start time, else now. */
  asOf?: Date;
  /** Pre-computed market reconstruction (derive.ts already has one). */
  market?: MarketReconstruction;
}

function safeMarket(deal: CanonicalDeal): MarketReconstruction | null {
  try {
    return reconstructMarket(deal);
  } catch {
    return null;
  }
}

function synthesis(r: Omit<LatentReport, "signalsForSynthesis" | "coverage" | "summary">): SynthesisSignal[] {
  const out: Omit<SynthesisSignal, "id">[] = [];
  const push = (s: Omit<SynthesisSignal, "id">) => out.push(s);
  const om = r.operatingMaturity;
  if (om.level === "EXCEPTIONAL" || om.level === "STRONG")
    push({ module: "operatingMaturity", signal: `Founder operating maturity is ${om.level.toLowerCase()} (${om.assessed}/8 signals assessed).`, direction: "POSITIVE", basis: om.basis, evidence: om.signals.filter((s) => s.status === "DEMONSTRATED").map((s) => s.label).join("; "), pages: om.pages, weight: om.level === "EXCEPTIONAL" ? 4 : 3 });
  if (om.level === "WEAK")
    push({ module: "operatingMaturity", signal: `Founder operating maturity reads weak from the deck (${om.assessed}/8 signals assessed).`, direction: "NEGATIVE", basis: om.basis, evidence: om.signals.filter((s) => s.status === "NOT_SHOWN" || s.status === "CONTRADICTED").map((s) => s.label).join("; "), pages: om.pages, weight: 3 });
  if (om.understandsWeakNumbers)
    push({ module: "operatingMaturity", signal: "The deck shows weak or declining numbers together with why — understanding independent of performance.", direction: "POSITIVE", basis: ["MODEL_OBSERVED"], evidence: "Unflattering metric disclosed with a causal explanation", pages: om.pages, weight: 3 });

  const ms = r.metricSelection;
  if (ms.vanityDependence === "HIGH" || ms.vanityDependence === "MODERATE")
    push({
      module: "metricSelection",
      signal: `Vanity metric dependence is ${ms.vanityDependence.toLowerCase()}${ms.vanitySharePct !== null ? ` (${ms.vanitySharePct}% of quantitative observations)` : ""}.`,
      direction: "NEGATIVE",
      basis: ms.basis,
      evidence: ms.vanityInPlaceOfDecision.length ? ms.vanityInPlaceOfDecision.slice(0, 3).map((v) => `${v.vanity} shown where ${v.absentDecisionMetric} is absent`).join("; ") : ms.vanityMetrics.map((v) => v.metric).slice(0, 4).join("; "),
      pages: pagesOf(ms.vanityMetrics.map((v) => v.page)),
      weight: ms.vanityDependence === "HIGH" ? 4 : 2,
    });
  if (ms.decisionCoveragePct !== null && ms.decisionCoveragePct < 50)
    push({ module: "metricSelection", signal: `Only ${ms.decisionCoveragePct}% of the decision metrics expected for ${ms.peerGroup} are shown.`, direction: "NEGATIVE", basis: ms.basis, evidence: `Absent: ${ms.absentDecisionMetrics.join(", ")}`, pages: ms.pages, weight: 3 });
  else if (ms.decisionCoveragePct !== null && ms.decisionCoveragePct >= 80)
    push({ module: "metricSelection", signal: `The deck shows ${ms.decisionCoveragePct}% of the decision metrics expected for ${ms.peerGroup}.`, direction: "POSITIVE", basis: ms.basis, evidence: `Shown: ${ms.presentDecisionMetrics.join(", ")}`, pages: ms.pages, weight: 2 });

  const ni = r.narrativeInflation;
  if (ni.level === "HIGH" || ni.level === "MODERATE")
    push({ module: "narrativeInflation", signal: `Narrative inflation risk is ${ni.level.toLowerCase()} (score ${ni.score}).`, direction: "NEGATIVE", basis: ni.basis, evidence: ni.why.slice(0, 4).join("; "), pages: ni.pages, weight: ni.level === "HIGH" ? 4 : 3 });

  const mi = r.missingAsSignal;
  for (const o of mi.omissions.filter((x) => x.kind !== "NOT_YET_EXPECTED" && x.severity === "HIGH").slice(0, 2))
    push({ module: "missingAsSignal", signal: o.sentence, direction: "NEGATIVE", basis: mi.basis, evidence: o.context.join("; "), pages: [], weight: o.flatteringSubstitute ? 4 : 3 });
  for (const o of mi.withheld.slice(0, 1))
    push({ module: "missingAsSignal", signal: `${o.metric} is explicitly withheld.`, direction: "NEUTRAL", basis: mi.basis, evidence: o.sentence, pages: [], weight: 2 });

  const pd = r.precisionDiscipline;
  if (pd.level === "EXCEPTIONAL" || pd.level === "STRONG")
    push({ module: "precisionDiscipline", signal: `Numbers are stated with ${pd.level.toLowerCase()} precision (${pd.score}/100).`, direction: "POSITIVE", basis: pd.basis, evidence: pd.precisePrecedents.slice(0, 2).join("; ") || `definitions ${pd.definitionQuality.pct}%, dated ${pd.temporalPrecision.pct}%`, pages: pd.pages, weight: 2 });
  if (pd.level === "WEAK")
    push({ module: "precisionDiscipline", signal: `Numbers are stated imprecisely (${pd.score}/100): approximations, missing dates or definitions.`, direction: "NEGATIVE", basis: pd.basis, evidence: pd.impreciseExamples.slice(0, 3).join("; ") || `approximate ${pd.approximationRate.pct}%, undated ${pd.temporalPrecision.none}/${pd.observations}`, pages: pd.pages, weight: 2 });

  const cu = r.causalUnderstanding;
  if (cu.bridge.status === "RECONCILES")
    push({ module: "causalUnderstanding", signal: "The deck decomposes ARR into new, expansion and churn — and the bridge reconciles.", direction: "POSITIVE", basis: ["COMPUTED"], evidence: cu.bridge.detail, pages: cu.bridge.pages, weight: 3 });
  if (cu.bridge.status === "DOES_NOT_RECONCILE")
    push({ module: "causalUnderstanding", signal: "The ARR bridge shown does not reconcile.", direction: "NEGATIVE", basis: ["COMPUTED"], evidence: cu.bridge.detail, pages: cu.bridge.pages, weight: 4 });
  if (cu.level === "EXCEPTIONAL" || cu.level === "STRONG")
    push({ module: "causalUnderstanding", signal: `Causal business understanding is ${cu.level.toLowerCase()} (based on the data available in the deck).`, direction: "POSITIVE", basis: cu.basis, evidence: cu.evidence.slice(0, 3).map((e) => e.text).join("; "), pages: cu.pages, weight: 2 });

  const am = r.ambition;
  if (am.consistency === "DISCONNECTED" || am.consistency === "STRETCHED")
    push({ module: "ambition", signal: `Ambition is ${am.consistency.toLowerCase()} relative to what the round funds. ${am.question}`, direction: "NEGATIVE", basis: am.basis, evidence: am.evidence.map((e) => e.text).slice(0, 3).join("; "), pages: am.pages, weight: am.consistency === "DISCONNECTED" ? 3 : 2 });

  const dq = r.disclosureQuality;
  if (dq.level === "EXCEPTIONAL" || dq.level === "STRONG")
    push({ module: "disclosureQuality", signal: `Disclosure quality is ${dq.level.toLowerCase()}: the deck volunteers limitations and unflattering facts.`, direction: "POSITIVE", basis: dq.basis, evidence: dq.evidence.slice(0, 3).map((e) => e.text).join("; "), pages: dq.pages, weight: 3 });
  if (dq.level === "WEAK")
    push({ module: "disclosureQuality", signal: "Disclosure quality is weak: little is volunteered beyond the promotional narrative.", direction: "NEGATIVE", basis: dq.basis, evidence: dq.evidence.slice(0, 3).map((e) => e.text).join("; ") || "No disclosures, limitations or unflattering metrics identified", pages: dq.pages, weight: 2 });
  for (const t of dq.unflatteringTrends.filter((x) => x.explained).slice(0, 1))
    push({ module: "disclosureQuality", signal: `The deck shows ${t.metricKey} declining (${t.from.value} → ${t.to.value}) and explains why.`, direction: "POSITIVE", basis: ["COMPUTED", "MODEL_OBSERVED"], evidence: t.explained!, pages: pagesOf([t.from.page, t.to.page]), weight: 3 });

  const qt = r.qualityOfThinking;
  if (qt.assertionOnlyPct !== null && qt.assertionOnlyPct >= 50)
    push({ module: "qualityOfThinking", signal: `${qt.assertionOnlyPct}% of the deck's key conclusions are asserted without evidence.`, direction: "NEGATIVE", basis: qt.basis, evidence: qt.unsupportedConclusions.slice(0, 3).map((c) => c.conclusion).join("; "), pages: qt.pages, weight: 3 });
  if (qt.level === "EXCEPTIONAL" || qt.level === "STRONG")
    push({ module: "qualityOfThinking", signal: `${qt.supportedPct}% of key conclusions rest on evidence and causal reasoning.`, direction: "POSITIVE", basis: qt.basis, evidence: `Market sizing: ${qt.marketSizing.style.toLowerCase().replace("_", "-")}`, pages: qt.pages, weight: 2 });
  if (qt.marketSizing.style === "TOP_DOWN")
    push({ module: "qualityOfThinking", signal: "Market is sized top-down only (market size × CAGR), not from customers × price.", direction: "NEGATIVE", basis: bases(...qt.marketSizing.evidence.map((e) => e.basis)), evidence: qt.marketSizing.evidence[0]?.text ?? "", pages: pagesOf(qt.marketSizing.evidence.map((e) => e.page)), weight: 1 });

  const re = r.resourceEfficiency;
  if (re.ratios.arrPerDollarRaised !== null || re.ratios.arrPerFte !== null)
    push({ module: "resourceEfficiency", signal: `${re.label}: ${re.readings.slice(0, 2).join("; ")}.`, direction: "NEUTRAL", basis: re.basis, evidence: re.evidence.map((e) => e.text).join("; "), pages: re.pages, weight: 1 });

  return out
    .map((s, i) => ({ s, i }))
    .sort((a, b) => b.s.weight - a.s.weight || a.i - b.i)
    .slice(0, 10)
    .map(({ s }, i) => ({ id: `LAT-${String(i + 1).padStart(2, "0")}`, ...s }));
}

export function latentReport(deal: CanonicalDeal, registry: BenchmarkRegistry | null, peer: PeerGroupRef, opts: LatentOptions = {}): LatentReport {
  const asOf = resolveAsOf(deal, opts.asOf);
  const market = opts.market ?? safeMarket(deal);
  const sel = metricSelection(deal, peer, asOf);
  const missing = missingAsSignal(deal, peer, sel);
  const prec = precisionDiscipline(deal, asOf);
  const infl = narrativeInflation(deal, peer, market, asOf);
  const maturity = operatingMaturity(deal, sel, prec, infl);
  const thinking = qualityOfThinking(deal);
  const causal = causalUnderstanding(deal);
  const amb = ambition(deal, market);
  const eff = resourceEfficiency(deal, asOf);
  const disc = disclosureQuality(deal, prec, missing, infl);

  const body = {
    version: LATENT_ENGINE_VERSION,
    asOf: asOf.toISOString(),
    registryId: registry?.id ?? null,
    peerGroup: peer.name,
    secondary: true as const,
    operatingMaturity: maturity,
    qualityOfThinking: thinking,
    metricSelection: sel,
    narrativeInflation: infl,
    missingAsSignal: missing,
    precisionDiscipline: prec,
    causalUnderstanding: causal,
    ambition: amb,
    resourceEfficiency: eff,
    disclosureQuality: disc,
  };
  const assessed = [
    maturity.level !== "INSUFFICIENT_EVIDENCE",
    thinking.level !== "INSUFFICIENT_EVIDENCE",
    sel.expectedCount > 0 || sel.vanityDependence !== "INSUFFICIENT_EVIDENCE",
    infl.level !== "INSUFFICIENT_EVIDENCE",
    sel.expectedCount > 0,
    prec.level !== "INSUFFICIENT_EVIDENCE",
    causal.level !== "INSUFFICIENT_EVIDENCE",
    amb.consistency !== "UNCLEAR",
    Object.values(eff.ratios).some((v) => v !== null),
    disc.level !== "INSUFFICIENT_EVIDENCE",
  ];
  const notes: string[] = [];
  if (!deal.latentSignals) notes.push("Model latent-signal pass not available (FAST / PARTIAL analysis or older version): computed signals only.");
  if (!deal.forensics) notes.push("Deck forensics not available: chart and market-slide checks rely on computed data only.");
  if (!deal.metricObservations?.length) notes.push("No raw metric observations: precision, vanity and bridge checks cannot be computed.");
  if (eff.coverage.missing.length) notes.push(`Resource efficiency missing: ${eff.coverage.missing.join(", ")}.`);
  notes.push("Secondary signals — never folded into the Operating Quality Index.");
  const coverage: LatentCoverageSummary = {
    latentSignalsAvailable: !!deal.latentSignals,
    forensicsAvailable: !!deal.forensics,
    metricObservations: deal.metricObservations?.length ?? 0,
    normalizedMetrics: deal.metrics?.length ?? 0,
    modulesAssessed: assessed.filter(Boolean).length,
    modulesTotal: assessed.length,
    notes,
  };
  const signalsForSynthesis = synthesis(body);
  return { ...body, coverage, signalsForSynthesis, summary: summarize(body, coverage, signalsForSynthesis) };
}

export { deckDiff, type DeckDiff } from "./deck-diff";
export { efficiencyRatios, compareEfficiency, EFFICIENCY_LABEL } from "./efficiency";
export { arrBridge } from "./causal";
export { DECISION_TABLE, VANITY_LEXICON } from "./decision-metrics";
export type { LatentBasis, LatentEvidence, LatentCoverage, QualityLevel, RiskLevel } from "./types";
