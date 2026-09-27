/**
 * COUNTERFACTUAL ENGINE.
 *
 * `runCounterfactual(ctx, scenario)` is a pure function: it transforms the
 * economics state with explicit, documented shocks (MODEL_ASSUMPTION
 * constants below) and recomputes returns, trajectory, financing and unit
 * economics, then lists what changed and which sensitivity breakpoints were
 * crossed. It never produces probabilities, and it is fast enough (single-digit
 * milliseconds) to be called interactively from the UI and the chat.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FinancingPathAnalysis } from "@/domain/sections";
import { financingMap, type FinancingMap } from "../financing";
import { buildProFormaPath, evaluateScenario, maxRoundsNeeded } from "./captable-returns";
import { stateFromContext, withInputs, type EconomicsContext, type EconomicsState, type ExitSpec, type Scenario } from "./inputs";
import { sensitivityMap, type SensitivityRow } from "./sensitivity";
import { trajectoryFromState, type Plausibility } from "./trajectory";

export type BuiltInScenarioId = "CAC_X2" | "NEXT_ROUND_DELAY_12M" | "ENTRY_VALUATION_X2" | "COMMODITIZATION" | "INCUMBENT_BUNDLES_FREE";

export interface CustomShock {
  label?: string;
  /** Replace operating metrics by metric key (arr, acv, nrr, gross_margin, cac, cac_payback_months, arr_growth_yoy, burn_multiple, win_rate, paying_customers, monthly_net_burn, months_to_next_milestone). */
  metricOverrides?: Partial<Record<string, number>>;
  /** Multiplies every non-failure exit equity value (revenue-multiple haircut). */
  exitMultipleFactor?: number;
  /** Multiplies current growth (applied to |growth| so a cut always lowers it). */
  growthFactor?: number;
  /** Delays the next round (months); a bridge is raised if cash runs out. */
  delayMonths?: number;
  /** Multiplies the entry post-money / cap. */
  valuationFactor?: number;
  cacFactor?: number;
  /** Multiplies price (ACV/ARPA) on new business. */
  priceFactor?: number;
  grossMarginDeltaPts?: number;
  /** Apply the gross-margin delta only to AI COGS-heavy profiles. */
  grossMarginDeltaAiOnly?: boolean;
  winRateFactor?: number;
  burnFactor?: number;
}

export type CounterfactualScenario = BuiltInScenarioId | { id: "custom"; shock: CustomShock };

export interface BuiltInScenario {
  id: BuiltInScenarioId;
  label: string;
  description: string;
  shock: CustomShock;
}

/** Built-in shocks. Every constant is a MODEL_ASSUMPTION stated in the description. */
export const BUILT_IN_SCENARIOS: Record<BuiltInScenarioId, BuiltInScenario> = {
  CAC_X2: {
    id: "CAC_X2",
    label: "CAC doubles",
    description: "CAC ×2 (MODEL_ASSUMPTION). Payback scales with CAC; extra acquisition spend = ΔCAC ÷ ARPA per $ of net new ARR, added to burn and burn multiple.",
    shock: { cacFactor: 2 },
  },
  NEXT_ROUND_DELAY_12M: {
    id: "NEXT_ROUND_DELAY_12M",
    label: "Next round slips 12 months",
    description: "Next round and exit delayed 12 months; milestone +12 months; if cash runs out a bridge SAFE is raised from others at a flat cap (MODEL_ASSUMPTION).",
    shock: { delayMonths: 12 },
  },
  ENTRY_VALUATION_X2: {
    id: "ENTRY_VALUATION_X2",
    label: "Entry price doubles",
    description: "Entry post-money (or cap) ×2; exit values unchanged — they describe the company, not the price we pay.",
    shock: { valuationFactor: 2 },
  },
  COMMODITIZATION: {
    id: "COMMODITIZATION",
    label: "Model provider commoditises the feature",
    description: "E.g. OpenAI ships the core feature: exit revenue multiple −40%, gross margin −10 pts on AI COGS-heavy profiles, growth −30% (all MODEL_ASSUMPTION).",
    shock: { exitMultipleFactor: 0.6, grossMarginDeltaPts: -10, grossMarginDeltaAiOnly: true, growthFactor: 0.7 },
  },
  INCUMBENT_BUNDLES_FREE: {
    id: "INCUMBENT_BUNDLES_FREE",
    label: "Incumbent bundles it for free",
    description: "Win rate and growth −40%, price −30%, exit multiple −30% (all MODEL_ASSUMPTION).",
    shock: { winRateFactor: 0.6, growthFactor: 0.6, priceFactor: 0.7, exitMultipleFactor: 0.7 },
  },
};

export const BUILT_IN_SCENARIO_IDS = Object.keys(BUILT_IN_SCENARIOS) as BuiltInScenarioId[];

type Headline = "BASE" | "BULL" | "OUTLIER";
const HEADLINE: Headline[] = ["BASE", "BULL", "OUTLIER"];

export interface CounterfactualOutputs {
  modelable: boolean;
  moic: Record<Headline, number | null>;
  irr: Record<Headline, number | null>;
  exitOwnershipPct: Record<Headline, number | null>;
  exitEquityUsd: Record<Headline, number | null>;
  requiredCagrPct: number | null;
  requiredStartingGrowthPct: number | null;
  currentGrowthPct: number | null;
  trajectoryPlausibility: Plausibility;
  financingRisk: FinancingMap["risk"];
  runwayMonths: number | null;
  bufferMonths: number | null;
  cacPaybackMonths: number | null;
  burnMultiple: number | null;
  monthlyBurnUsd: number | null;
}

export interface OutputChange {
  output: string;
  base: number | string | null;
  scenario: number | string | null;
  delta: number | null;
  direction: "WORSE" | "BETTER" | "UNCHANGED" | "N/A";
}

export interface CrossedBreakpoint {
  rowId: string;
  variable: string;
  baseMargin: number;
  scenarioMargin: number;
}

export interface CounterfactualResult {
  id: BuiltInScenarioId | "custom";
  label: string;
  description: string;
  shock: CustomShock;
  applied: string[];
  base: CounterfactualOutputs;
  scenario: CounterfactualOutputs;
  changes: OutputChange[];
  crossedBreakpoints: CrossedBreakpoint[];
  sensitivity: SensitivityRow[];
}

export interface EvaluatedState {
  outputs: CounterfactualOutputs;
  sensitivity: SensitivityRow[];
}

/* ---------------------------------------------------------------- */
/* Evaluation                                                          */
/* ---------------------------------------------------------------- */

export function evaluateState(state: EconomicsState): EvaluatedState {
  const empty = () => ({ BASE: null, BULL: null, OUTLIER: null }) as Record<Headline, number | null>;
  const moic = empty();
  const irr = empty();
  const own = empty();
  const exitEq = empty();
  const path = state.modelable ? buildProFormaPath(state.inputs, maxRoundsNeeded(state.inputs)) : null;
  if (path)
    for (const s of HEADLINE) {
      const r = evaluateScenario(path, state.inputs, s);
      moic[s] = r.grossMoic;
      irr[s] = r.grossIrr;
      own[s] = r.exitOwnershipPct;
      exitEq[s] = r.exitEquityUsd;
    }
  const traj = trajectoryFromState(state, { targetContributionUsd: state.fund.targetDealReturnUsd });
  const ref = traj.byMultiple.find((b) => b.revenueMultiple === traj.referenceMultiple);
  const fm = financingMap(state.deal, state.registry);
  const sens = sensitivityMap(state, traj);
  return {
    outputs: {
      modelable: !!path,
      moic,
      irr,
      exitOwnershipPct: own,
      exitEquityUsd: exitEq,
      requiredCagrPct: ref?.requiredCagrPct ?? null,
      requiredStartingGrowthPct: traj.growthPersistence.requiredStartingGrowthPct,
      currentGrowthPct: state.op.growthPct,
      trajectoryPlausibility: traj.plausibility,
      financingRisk: fm.risk,
      runwayMonths: fm.runwayAfterRoundMonths,
      bufferMonths: fm.bufferMonths,
      cacPaybackMonths: state.op.cacPaybackMonths,
      burnMultiple: state.op.burnMultiple,
      monthlyBurnUsd: fm.monthlyBurnUsd,
    },
    sensitivity: sens.rows,
  };
}

/* ---------------------------------------------------------------- */
/* Shocks                                                              */
/* ---------------------------------------------------------------- */

function isAiCogsHeavy(deal: CanonicalDeal): boolean {
  return deal.classification.technology.includes("AI") || deal.classification.productType.includes("AI_AGENT");
}

function withPath(deal: CanonicalDeal, patch: Partial<FinancingPathAnalysis>): CanonicalDeal {
  const fp: FinancingPathAnalysis = deal.financingPath ?? {
    proofPurchased: "",
    milestoneMonths: null,
    plannedMonthlyBurnUsd: null,
    nextRoundConditions: "",
    capitalIntensity: "MODERATE",
    fallbackPlans: "",
    financingRiskAssessment: "",
  };
  return { ...deal, financingPath: { ...fp, ...patch } };
}

/** Cut (factor < 1) or boost a growth rate so a cut always lowers it, even when growth is negative. */
const scaleGrowth = (g: number, f: number) => g + Math.abs(g) * (f - 1);

export function applyShock(state: EconomicsState, shock: CustomShock): { state: EconomicsState; applied: string[] } {
  const applied: string[] = [];
  const op = { ...state.op };
  let deal = state.deal;
  const baseFm = financingMap(state.deal, state.registry);
  let burn = baseFm.monthlyBurnUsd;
  let milestone = state.deal.financingPath?.milestoneMonths ?? null;

  // 1. Metric overrides.
  for (const [key, v] of Object.entries(shock.metricOverrides ?? {})) {
    if (v === undefined || !Number.isFinite(v)) continue;
    applied.push(`${key} set to ${v}`);
    switch (key) {
      case "arr":
      case "revenue_ttm":
        op.revenueUsd = v;
        break;
      case "acv":
        if (op.cacPaybackMonths !== null && op.arpaUsd) op.cacPaybackMonths *= op.arpaUsd / v;
        op.arpaUsd = v;
        break;
      case "paying_customers":
        op.customers = v;
        break;
      case "nrr":
        op.nrrPct = v;
        break;
      case "arr_growth_yoy":
      case "revenue_growth_yoy":
        op.growthPct = v;
        break;
      case "gross_margin":
        if (op.cacPaybackMonths !== null && op.grossMarginPct) op.cacPaybackMonths *= op.grossMarginPct / v;
        op.grossMarginPct = v;
        break;
      case "cac":
        if (op.cacPaybackMonths !== null && op.cacUsd) op.cacPaybackMonths *= v / op.cacUsd;
        else if (op.arpaUsd && op.grossMarginPct) op.cacPaybackMonths = v / ((op.arpaUsd / 12) * (op.grossMarginPct / 100));
        op.cacUsd = v;
        break;
      case "cac_payback_months":
        op.cacPaybackMonths = v;
        break;
      case "burn_multiple":
        op.burnMultiple = v;
        break;
      case "win_rate":
        op.winRatePct = v;
        break;
      case "monthly_net_burn":
        burn = v;
        break;
      case "months_to_next_milestone":
        milestone = v;
        break;
      default:
        applied.pop();
        applied.push(`${key}: no deterministic effect in the economics engine (ignored)`);
    }
  }

  // 2. Unit economics.
  const cacF = shock.cacFactor ?? 1;
  const priceF = shock.priceFactor ?? 1;
  let gmDelta = shock.grossMarginDeltaPts ?? 0;
  if (gmDelta !== 0 && shock.grossMarginDeltaAiOnly && !isAiCogsHeavy(state.deal)) {
    applied.push("Gross-margin shock not applied: not an AI COGS-heavy profile.");
    gmDelta = 0;
  }
  const cac0 = op.cacUsd;
  const arpa0 = op.arpaUsd;
  const gm0 = op.grossMarginPct;
  if (cacF !== 1 || priceF !== 1 || gmDelta !== 0) {
    const gm1 = gm0 !== null ? Math.max(1, gm0 + gmDelta) : null;
    if (op.cacPaybackMonths !== null) op.cacPaybackMonths = op.cacPaybackMonths * cacF / priceF * (gm0 && gm1 ? gm0 / gm1 : 1);
    if (cac0 !== null) op.cacUsd = cac0 * cacF;
    if (arpa0 !== null) op.arpaUsd = arpa0 * priceF;
    op.grossMarginPct = gm1;
    if (cacF !== 1) applied.push(`CAC ×${cacF}`);
    if (priceF !== 1) applied.push(`Price (ACV/ARPA) ×${priceF}`);
    if (gmDelta !== 0) applied.push(`Gross margin ${gmDelta > 0 ? "+" : ""}${gmDelta} pts`);
    // Acquisition spend per $ of new ARR = CAC ÷ ARPA.
    if (cac0 !== null && arpa0) {
      const dSpendPerArr = (cac0 * cacF) / (arpa0 * priceF) - cac0 / arpa0;
      if (op.burnMultiple !== null) op.burnMultiple = Math.max(0, op.burnMultiple + dSpendPerArr);
      const g = state.op.growthPct;
      if (burn !== null && state.op.revenueUsd && g !== null && g > 0) {
        const netNewArr = state.op.revenueUsd * (g / 100 / (1 + g / 100));
        burn = Math.max(0, burn + (dSpendPerArr * netNewArr) / 12);
        applied.push(`Monthly burn +$${((dSpendPerArr * netNewArr) / 12 / 1e3).toFixed(0)}k from acquisition spend (net new ARR ${(netNewArr / 1e6).toFixed(2)}M/yr × ΔCAC/ARPA).`);
      } else if (cacF !== 1) applied.push("Burn impact not derivable (needs revenue, growth, burn, CAC and ARPA).");
    }
  }
  if (shock.growthFactor !== undefined && shock.growthFactor !== 1 && op.growthPct !== null) {
    op.growthPct = scaleGrowth(op.growthPct, shock.growthFactor);
    applied.push(`Growth ×${shock.growthFactor}`);
  }
  if (shock.winRateFactor !== undefined && op.winRatePct !== null) {
    op.winRatePct *= shock.winRateFactor;
    applied.push(`Win rate ×${shock.winRateFactor}`);
  }
  if (shock.burnFactor !== undefined && burn !== null) {
    burn *= shock.burnFactor;
    applied.push(`Burn ×${shock.burnFactor}`);
  }

  // 3. Financing timing and deal-level financing map inputs.
  const delay = Math.max(0, shock.delayMonths ?? 0);
  if (delay > 0 && milestone !== null) milestone += delay;
  if (burn !== baseFm.monthlyBurnUsd || milestone !== (state.deal.financingPath?.milestoneMonths ?? null))
    deal = withPath(deal, { plannedMonthlyBurnUsd: burn, milestoneMonths: milestone });

  // 4. Economics inputs.
  let inputs = state.inputs;
  const patch: Partial<typeof inputs> = {};
  if (shock.valuationFactor !== undefined && shock.valuationFactor !== 1 && inputs.postMoneyUsd) {
    patch.postMoneyUsd = inputs.postMoneyUsd * shock.valuationFactor;
    applied.push(`Entry valuation ×${shock.valuationFactor}`);
  }
  const exitF = shock.exitMultipleFactor ?? 1;
  if (exitF !== 1 || delay > 0) {
    const exits = {} as Record<Scenario, ExitSpec>;
    for (const [s, e] of Object.entries(inputs.exits) as [Scenario, ExitSpec][])
      exits[s] = {
        ...e,
        exitEquityUsd: s === "FAILURE" ? e.exitEquityUsd : e.exitEquityUsd * exitF,
        revenueMultiple: e.revenueMultiple !== null ? e.revenueMultiple * exitF : null,
        years: e.years + delay / 12,
      };
    patch.exits = exits;
    if (exitF !== 1) applied.push(`Exit revenue multiple ×${exitF}`);
  }
  if (delay > 0) {
    patch.nextRoundDelayMonths = inputs.nextRoundDelayMonths + delay;
    const fm2 = financingMap(deal, state.registry);
    let bridge: number | null = null;
    if (fm2.runwayAfterRoundMonths !== null && fm2.requiredMonths !== null && fm2.monthlyBurnUsd) {
      bridge = Math.max(0, fm2.requiredMonths - fm2.runwayAfterRoundMonths) * fm2.monthlyBurnUsd;
    } else if (inputs.raiseUsd > 0) {
      bridge = (inputs.raiseUsd * inputs.a.bridgeFallbackPctOfRaise) / 100;
      applied.push(`Bridge sized at ${inputs.a.bridgeFallbackPctOfRaise}% of the round (runway data unavailable).`);
    }
    if (bridge && bridge > 0 && inputs.postMoneyUsd) {
      const cap = (patch.postMoneyUsd ?? inputs.postMoneyUsd) * inputs.a.bridgeValuationFactor;
      patch.bridge = { amountUsd: bridge, capUsd: Math.max(cap, bridge * 1.01) };
      applied.push(`Bridge SAFE of $${(bridge / 1e6).toFixed(2)}M from other investors at a ${inputs.a.bridgeValuationFactor === 1 ? "flat" : `${inputs.a.bridgeValuationFactor}×`} cap.`);
    }
    applied.push(`Next round and exits delayed ${delay} months.`);
  }
  inputs = { ...inputs, ...patch };
  const next = withInputs({ ...state, op, deal }, inputs);
  return { state: next, applied };
}

/* ---------------------------------------------------------------- */
/* Comparison                                                          */
/* ---------------------------------------------------------------- */

const RISK_RANK: Record<FinancingMap["risk"], number> = { UNKNOWN: -1, LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };
const PL_RANK: Record<Plausibility, number> = { UNKNOWN: -1, PLAUSIBLE: 0, DEMANDING: 1, HEROIC: 2, IMPLAUSIBLE: 3 };

function compare(base: CounterfactualOutputs, sc: CounterfactualOutputs): OutputChange[] {
  const out: OutputChange[] = [];
  const num = (output: string, b: number | null, s: number | null, higherIsBetter: boolean) => {
    if (b === null || s === null) {
      out.push({ output, base: b, scenario: s, delta: null, direction: b === s ? "UNCHANGED" : "N/A" });
      return;
    }
    const delta = s - b;
    const tol = 1e-9 * Math.max(1, Math.abs(b));
    out.push({ output, base: b, scenario: s, delta, direction: Math.abs(delta) <= tol ? "UNCHANGED" : (delta > 0) === higherIsBetter ? "BETTER" : "WORSE" });
  };
  for (const h of HEADLINE) {
    num(`${h} MOIC`, base.moic[h], sc.moic[h], true);
    num(`${h} IRR`, base.irr[h], sc.irr[h], true);
    num(`${h} exit ownership %`, base.exitOwnershipPct[h], sc.exitOwnershipPct[h], true);
    num(`${h} exit equity value`, base.exitEquityUsd[h], sc.exitEquityUsd[h], true);
  }
  num("Required revenue CAGR % (fund target)", base.requiredCagrPct, sc.requiredCagrPct, false);
  num("Current growth %", base.currentGrowthPct, sc.currentGrowthPct, true);
  num("Runway after the round (months)", base.runwayMonths, sc.runwayMonths, true);
  num("Buffer before the next raise (months)", base.bufferMonths, sc.bufferMonths, true);
  num("CAC payback (months)", base.cacPaybackMonths, sc.cacPaybackMonths, false);
  num("Burn multiple", base.burnMultiple, sc.burnMultiple, false);
  const cat = <T extends string>(output: string, b: T, s: T, rank: Record<T, number>) => {
    const d = rank[s] - rank[b];
    out.push({ output, base: b, scenario: s, delta: null, direction: b === s ? "UNCHANGED" : rank[b] < 0 || rank[s] < 0 ? "N/A" : d > 0 ? "WORSE" : "BETTER" });
  };
  cat("Financing risk", base.financingRisk, sc.financingRisk, RISK_RANK);
  cat("Trajectory plausibility", base.trajectoryPlausibility, sc.trajectoryPlausibility, PL_RANK);
  return out;
}

function crossed(base: SensitivityRow[], sc: SensitivityRow[]): CrossedBreakpoint[] {
  const out: CrossedBreakpoint[] = [];
  for (const r of sc) {
    const b = base.find((x) => x.id === r.id);
    if (!b || b.margin === null || r.margin === null) continue;
    if (b.margin >= 0 && r.margin < 0) out.push({ rowId: r.id, variable: r.variable, baseMargin: b.margin, scenarioMargin: r.margin });
  }
  return out;
}

export function resolveScenario(sc: CounterfactualScenario): { id: BuiltInScenarioId | "custom"; label: string; description: string; shock: CustomShock } {
  if (typeof sc === "string") {
    const b = BUILT_IN_SCENARIOS[sc];
    return { id: b.id, label: b.label, description: b.description, shock: b.shock };
  }
  return { id: "custom", label: sc.shock.label ?? "Custom scenario", description: "User-defined shock (MODEL_ASSUMPTION).", shock: sc.shock };
}

export function runCounterfactualOnState(state: EconomicsState, scenario: CounterfactualScenario, base?: EvaluatedState): CounterfactualResult {
  const r = resolveScenario(scenario);
  const b = base ?? evaluateState(state);
  const shocked = applyShock(state, r.shock);
  const s = evaluateState(shocked.state);
  return {
    id: r.id,
    label: r.label,
    description: r.description,
    shock: r.shock,
    applied: shocked.applied,
    base: b.outputs,
    scenario: s.outputs,
    changes: compare(b.outputs, s.outputs),
    crossedBreakpoints: crossed(b.sensitivity, s.sensitivity),
    sensitivity: s.sensitivity,
  };
}

/**
 * Base evaluations memoized by context identity (the context is treated as
 * immutable input: same objects → same result), so interactive callers pay for
 * the base case once and each what-if costs a single re-evaluation.
 */
const BASE_CACHE = new WeakMap<EconomicsContext, { key: unknown[]; value: EvaluatedState }>();

function cachedBase(ctx: EconomicsContext, state: EconomicsState): EvaluatedState {
  const key = [ctx.deal, ctx.returns, ctx.market, ctx.fund, ctx.registry, ctx.capTable, ctx.assumptions];
  const hit = BASE_CACHE.get(ctx);
  if (hit && hit.key.every((k, i) => k === key[i])) return hit.value;
  const value = evaluateState(state);
  BASE_CACHE.set(ctx, { key, value });
  return value;
}

/** Pure, deterministic counterfactual on an economics context. */
export function runCounterfactual(ctx: EconomicsContext, scenario: CounterfactualScenario, base?: EvaluatedState): CounterfactualResult {
  const state = stateFromContext(ctx);
  return runCounterfactualOnState(state, scenario, base ?? cachedBase(ctx, state));
}

export interface CounterfactualSummary {
  id: BuiltInScenarioId | "custom";
  label: string;
  description: string;
  base: CounterfactualOutputs;
  scenario: CounterfactualOutputs;
  worse: string[];
  better: string[];
  crossedBreakpoints: CrossedBreakpoint[];
  headline: string;
}

export function summarizeCounterfactual(r: CounterfactualResult): CounterfactualSummary {
  const worse = r.changes.filter((c) => c.direction === "WORSE").map((c) => c.output);
  const better = r.changes.filter((c) => c.direction === "BETTER").map((c) => c.output);
  const bm = r.base.moic.BASE;
  const sm = r.scenario.moic.BASE;
  const moicTxt = bm !== null && sm !== null ? `BASE MOIC ${bm.toFixed(2)}× → ${sm.toFixed(2)}×` : "BASE MOIC not modelable";
  const cross = r.crossedBreakpoints.length ? `; crosses ${r.crossedBreakpoints.map((c) => c.variable).join(", ")}` : "";
  return {
    id: r.id,
    label: r.label,
    description: r.description,
    base: r.base,
    scenario: r.scenario,
    worse,
    better,
    crossedBreakpoints: r.crossedBreakpoints,
    headline: `${r.label}: ${moicTxt}; financing risk ${r.base.financingRisk} → ${r.scenario.financingRisk}${cross}.`,
  };
}
