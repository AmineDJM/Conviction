/**
 * DIVERGENCE FACTORS ENGINE (deterministic aggregation).
 *
 * "Why could two apparently similar startups diverge completely?" Ten factors:
 * ambition ceiling, cap-table alignment, syndicate quality, strategic
 * survivability, market structure, dependency surface, land → expand →
 * platform, organizational focus, compounding loops, scalability architecture.
 *
 * Combines the model's observable deck signals (deal.divergence) with numbers
 * code computes (economics cap table and trajectory, financing map, metrics).
 * Every factor carries an ordinal level (never a probability), its rule, its
 * evidence with pages and refs, and its coverage. There is deliberately NO
 * blended divergence score, and nothing here feeds the Operating Quality
 * Index. Pure, deterministic for a given `asOf`, never throws.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { PeerGroupRef } from "../scoring/peer";
import { reconstructMarket, type MarketReconstruction } from "../market";
import { financingMap, type FinancingMap } from "../financing";
import type { EconomicsContext, EconomicsReport } from "../economics";
import type { LatentReport } from "../latent";
import { ambition as latentAmbition, type Ambition } from "../latent/ambition";
import { resolveAsOf } from "../latent/util";
import { describeDivergenceAssumptions, DIVERGENCE_ASSUMPTIONS_VERSION, type DivergenceAssumptionEntry } from "./assumptions";
import type { DivergenceInputs } from "./context";
import { ambitionCeiling, type AmbitionFactor } from "./ambition";
import { capTableAlignment, type CapTableFactor } from "./captable";
import { syndicateQuality, type SyndicateFactor } from "./syndicate";
import { strategicSurvivability, type SurvivabilityFactor } from "./survivability";
import { marketStructure, type MarketStructureFactor } from "./market-structure";
import { dependencySurface, type DependencyFactor } from "./dependency";
import { landExpandPlatform, type ExpansionFactor } from "./expansion";
import { organizationalFocus, type FocusFactor } from "./focus";
import { compoundingLoops, type LoopsFactor } from "./loops";
import { scalabilityArchitecture, type ScalabilityFactor } from "./scalability";
import { FACTOR_IDS, type DivergenceLevel, type FactorBase, type FactorId } from "./types";
import { coverage } from "./util";

export const DIVERGENCE_ENGINE_VERSION = "divergence-1.0";
export const DIVERGENCE_QUESTION = "Why could this company diverge from lookalikes?";

export type DivergenceFactor = AmbitionFactor | CapTableFactor | SyndicateFactor | SurvivabilityFactor | MarketStructureFactor | DependencyFactor | ExpansionFactor | FocusFactor | LoopsFactor | ScalabilityFactor;

export interface DivergenceSummaryFactor {
  n: number;
  id: FactorId;
  name: string;
  level: DivergenceLevel;
  reading: string;
  why: string;
  numbers: string[];
  missing: string[];
}

/** Compact digest for prompts and the Fund Brain. */
export interface DivergenceSummary {
  version: string;
  question: string;
  basisNote: string;
  headline: string;
  upward: string[];
  downward: string[];
  unread: string[];
  factors: DivergenceSummaryFactor[];
}

export interface DivergenceReport {
  version: string;
  assumptionsVersion: string;
  asOf: string;
  registryId: string | null;
  peerGroup: string;
  /** Secondary analysis — never folded into the Operating Quality Index; no blended score. */
  secondary: true;
  draftAvailable: boolean;
  factors: DivergenceFactor[];
  headline: { question: string; sentence: string; upward: FactorId[]; downward: FactorId[]; unread: FactorId[] };
  assumptions: DivergenceAssumptionEntry[];
  coverage: { assessed: number; total: number; notes: string[] };
  /** Modules that failed and fell back to INSUFFICIENT_EVIDENCE (never silently). */
  diagnostics: string[];
  summary: DivergenceSummary;
}

export interface DivergenceContext {
  /** Evaluation date. Defaults to the analysis start time, else now. */
  asOf?: Date;
  market?: MarketReconstruction | null;
  financing?: FinancingMap | null;
  economics?: EconomicsReport | null;
  latent?: LatentReport | null;
  /** Full economics context: enables the +24-month counterfactual in survivability. */
  economicsContext?: EconomicsContext | null;
}

const FACTOR_META: Record<FactorId, { n: number; name: string; question: string }> = {
  AMBITION_CEILING: { n: 1, name: "Founder ambition ceiling", question: "What company is this founder really trying to build?" },
  CAP_TABLE_ALIGNMENT: { n: 2, name: "Cap table health & incentive alignment", question: "Will the people who build this company still own enough of it to care in ten years?" },
  SYNDICATE_QUALITY: { n: 3, name: "Syndicate quality (not prestige)", question: "Can the existing investors help the next round, the hard months, customers, hiring — and stay out of the way?" },
  STRATEGIC_SURVIVABILITY: { n: 4, name: "Strategic survivability", question: "If the market takes 24 months longer, can the company slow down without dying?" },
  MARKET_STRUCTURE: { n: 5, name: "Market structure (not size)", question: "Does the structure of this market let a winner capture value?" },
  DEPENDENCY_SURFACE: { n: 6, name: "Dependency surface", question: "How many critical elements does the company not control — and which one could kill it?" },
  LAND_EXPAND_PLATFORM: { n: 7, name: "Land → expand → platform", question: "If it wins a customer today, how much can it sell that customer in five years?" },
  ORGANIZATIONAL_FOCUS: { n: 8, name: "Organizational focus", question: "How many things is the team trying to win at once, relative to its people and money?" },
  COMPOUNDING_LOOPS: { n: 9, name: "Compounding loop strength", question: "Does each new customer make the company better?" },
  SCALABILITY_ARCHITECTURE: { n: 10, name: "Scalability architecture", question: "Does growth make the company better — or more fragile?" },
};

const MODULES: Record<FactorId, (i: DivergenceInputs) => DivergenceFactor> = {
  AMBITION_CEILING: ambitionCeiling,
  CAP_TABLE_ALIGNMENT: capTableAlignment,
  SYNDICATE_QUALITY: syndicateQuality,
  STRATEGIC_SURVIVABILITY: strategicSurvivability,
  MARKET_STRUCTURE: marketStructure,
  DEPENDENCY_SURFACE: dependencySurface,
  LAND_EXPAND_PLATFORM: landExpandPlatform,
  ORGANIZATIONAL_FOCUS: organizationalFocus,
  COMPOUNDING_LOOPS: compoundingLoops,
  SCALABILITY_ARCHITECTURE: scalabilityArchitecture,
};

/** A module that throws degrades to an explicit INSUFFICIENT_EVIDENCE factor with a diagnostic — never a silent gap. */
function failedFactor(id: FactorId, err: unknown): DivergenceFactor {
  const m = FACTOR_META[id];
  const base: FactorBase = {
    id,
    n: m.n,
    name: m.name,
    question: m.question,
    level: "INSUFFICIENT_EVIDENCE",
    reading: "MODULE_ERROR",
    why: "This factor could not be computed on the available data.",
    basis: [],
    pages: [],
    rule: "Module failed; no level is asserted.",
    evidence: [],
    coverage: coverage([], ["module computation"], `Error: ${(err as Error)?.message?.slice(0, 160) ?? String(err)}`),
    computed: [],
    implications: [],
  };
  return base as DivergenceFactor;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function fmtComputed(v: FactorBase["computed"][number]): string | null {
  if (v.value === null || v.value === undefined || v.value === "") return null;
  if (typeof v.value === "string") return `${v.label}: ${v.value}`;
  const n = v.value;
  const s =
    v.unit === "USD"
      ? Math.abs(n) >= 1e9
        ? `$${+(n / 1e9).toFixed(2)}B`
        : Math.abs(n) >= 1e6
          ? `$${+(n / 1e6).toFixed(2)}M`
          : Math.abs(n) >= 1e3
            ? `$${+(n / 1e3).toFixed(1)}k`
            : `$${Math.round(n)}`
      : v.unit === "PCT"
        ? `${+n.toFixed(1)}%`
        : v.unit === "MONTHS"
          ? `${+n.toFixed(1)} mo`
          : v.unit === "MULTIPLE"
            ? `${+n.toFixed(1)}×`
            : `${+n.toFixed(2)}`;
  return `${v.label}: ${s}`;
}

function headlineOf(factors: DivergenceFactor[]) {
  const upward = factors.filter((f) => f.level === "STRONG").map((f) => f.id);
  const downward = factors.filter((f) => f.level === "WEAK").map((f) => f.id);
  const unread = factors.filter((f) => f.level === "INSUFFICIENT_EVIDENCE").map((f) => f.id);
  const name = (id: FactorId) => FACTOR_META[id].name.toLowerCase().replace(/ \(.*\)$/, "");
  const parts: string[] = [];
  if (upward.length) parts.push(`it could pull away from lookalikes on ${upward.map(name).join(", ")}`);
  if (downward.length) parts.push(`it could fall behind them on ${downward.map(name).join(", ")}`);
  let sentence = parts.length ? `${parts.join("; ")}.` : "No factor separates it from lookalikes on the evidence available.";
  sentence = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  if (unread.length) sentence += ` ${unread.length} factor${unread.length > 1 ? "s" : ""} cannot be read yet (${unread.map(name).join(", ")}).`;
  return { question: DIVERGENCE_QUESTION, sentence, upward, downward, unread };
}

export function divergenceReport(deal: CanonicalDeal, registry: BenchmarkRegistry | null, peer: PeerGroupRef, ctx: DivergenceContext = {}): DivergenceReport {
  const asOf = safe(() => resolveAsOf(deal, ctx.asOf), new Date(0));
  const market = ctx.market !== undefined ? ctx.market : safe(() => reconstructMarket(deal), null);
  const financing = ctx.financing !== undefined ? ctx.financing : registry ? safe(() => financingMap(deal, registry), null) : null;
  const lat: Ambition | null = ctx.latent?.ambition ?? safe(() => latentAmbition(deal, market ?? null), null);
  const inputs: DivergenceInputs = {
    deal,
    draft: deal.divergence ?? null,
    registry,
    peer,
    asOf,
    market: market ?? null,
    financing: financing ?? null,
    economics: ctx.economics ?? null,
    latentAmbition: lat,
    economicsContext: ctx.economicsContext ?? null,
  };
  const diagnostics: string[] = [];
  const factors = FACTOR_IDS.map((id) => {
    try {
      return MODULES[id](inputs);
    } catch (e) {
      diagnostics.push(`${id}: ${(e as Error)?.message?.slice(0, 200) ?? String(e)}`);
      return failedFactor(id, e);
    }
  });
  const headline = headlineOf(factors);
  const notes: string[] = [];
  if (!inputs.draft) notes.push("Model divergence pass not available (FAST / partial analysis or older version): factors rest on computed data only.");
  if (!ctx.economics) notes.push("Economics report not supplied: the required outcome size is not linked to ambition.");
  notes.push("Ten separate ordinal levels — no blended divergence score; never part of the Operating Quality Index.");
  const assessed = factors.filter((f) => f.level !== "INSUFFICIENT_EVIDENCE").length;
  const summary: DivergenceSummary = {
    version: DIVERGENCE_ENGINE_VERSION,
    question: DIVERGENCE_QUESTION,
    basisNote: "Ordinal levels per factor (STRONG / ADEQUATE / WEAK / INSUFFICIENT_EVIDENCE), from observable deck signals (MODEL_OBSERVED) and code (COMPUTED). Not probabilities; no blended score; not part of the OQI.",
    headline: headline.sentence,
    upward: headline.upward.map((id) => FACTOR_META[id].name),
    downward: headline.downward.map((id) => FACTOR_META[id].name),
    unread: headline.unread.map((id) => FACTOR_META[id].name),
    factors: factors.map((f) => ({
      n: f.n,
      id: f.id,
      name: f.name,
      level: f.level,
      reading: f.reading,
      why: f.why,
      numbers: f.computed.map(fmtComputed).filter((x): x is string => !!x).slice(0, 3),
      missing: f.coverage.missing.slice(0, 3),
    })),
  };
  return {
    version: DIVERGENCE_ENGINE_VERSION,
    assumptionsVersion: DIVERGENCE_ASSUMPTIONS_VERSION,
    asOf: asOf.toISOString(),
    registryId: registry?.id ?? null,
    peerGroup: peer.name,
    secondary: true,
    draftAvailable: !!inputs.draft,
    factors,
    headline,
    assumptions: describeDivergenceAssumptions(),
    coverage: { assessed, total: factors.length, notes },
    diagnostics,
    summary,
  };
}

/** Look up a factor by id with its concrete type. */
export function factorOf<T extends DivergenceFactor["id"]>(r: DivergenceReport, id: T): Extract<DivergenceFactor, { id: T }> {
  return r.factors.find((f) => f.id === id) as Extract<DivergenceFactor, { id: T }>;
}

export { FACTOR_IDS, LEVEL_RANK } from "./types";
export type { DivergenceLevel, DivergenceBasis, DivergenceEvidence, DivergenceCoverage, FactorId, FactorBase, ComputedValue } from "./types";
export { DIVERGENCE_ASSUMPTIONS, FOUNDER_OWNERSHIP_BENCHMARKS, DIVERGENCE_ASSUMPTIONS_VERSION } from "./assumptions";
export type { AmbitionFactor, CapTableFactor, SyndicateFactor, SurvivabilityFactor, MarketStructureFactor, DependencyFactor, ExpansionFactor, FocusFactor, LoopsFactor, ScalabilityFactor };
