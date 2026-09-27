/**
 * Resolves the deterministic inputs of the economics engine from the
 * canonical deal, the registry, the fund profile and the simplified return
 * model's inputs (which already carry user overrides such as a price).
 *
 * Everything downstream (cap-table returns, trajectory, sensitivity,
 * counterfactuals) runs off an `EconomicsState`, so a counterfactual is just a
 * transformed state.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { FinancingStage, Instrument, ReturnScenarioName } from "@/domain/enums";
import type { BenchmarkRegistry, FutureRound } from "../benchmarks/types";
import type { BackwardsResult, ReturnModel } from "../returns";
import type { MarketReconstruction } from "../market";
import type { CapTable } from "../calc/captable";
import { cacPaybackMonths } from "../calc/finance";
import { toUsd } from "../metrics/normalize";
import { DEFAULT_ECONOMICS_ASSUMPTIONS, type EconomicsAssumptions } from "./assumptions";

export interface EconomicsContext {
  deal: CanonicalDeal;
  registry: BenchmarkRegistry;
  fund: FundProfile;
  returns: ReturnModel;
  backwards: BackwardsResult | null;
  market: MarketReconstruction;
  /** Actual pre-round cap table, when known. Otherwise one is synthesized (explicit assumptions). */
  capTable?: CapTable | null;
  /** Overrides of the engine's documented constants. */
  assumptions?: Partial<EconomicsAssumptions>;
}

export type Scenario = ReturnScenarioName;

export interface ExitSpec {
  exitEquityUsd: number;
  years: number;
  basis: string;
  /** Revenue multiple behind the exit value, when the exit is revenue-based. */
  revenueMultiple: number | null;
}

export interface BridgeSpec {
  amountUsd: number;
  /** Post-money cap of the bridge SAFE. */
  capUsd: number;
}

export interface EconomicsInputs {
  instrument: Instrument;
  stage: FinancingStage;
  /** Priced: post-money. SAFE: post-money cap. Note: (pre-money) cap. */
  postMoneyUsd: number | null;
  raiseUsd: number;
  checkUsd: number;
  discountPct: number | null;
  ourPrefMultiple: number;
  ourParticipating: boolean;
  priorRaisedUsd: number | null;
  priorStepUp: number;
  entryPoolIncreasePct: number | null;
  futureRounds: FutureRound[];
  roundsBeforeExit: Record<Scenario, number>;
  monthsBetweenRounds: number;
  /** Extra months before the first future round (delay counterfactual). */
  nextRoundDelayMonths: number;
  bridge: BridgeSpec | null;
  followOn: boolean;
  reserveUsd: number;
  exits: Record<Scenario, ExitSpec>;
  fundSizeUsd: number | null;
  preRoundCapTable: CapTable | null;
  a: EconomicsAssumptions;
}

export interface OperatingSnapshot {
  revenueUsd: number | null;
  revenueSource: string;
  arpaUsd: number | null;
  arpaSource: string;
  customers: number | null;
  nrrPct: number | null;
  growthPct: number | null;
  growthSource: string;
  grossMarginPct: number | null;
  cacUsd: number | null;
  cacSource: string;
  cacPaybackMonths: number | null;
  paybackSource: string;
  burnMultiple: number | null;
  winRatePct: number | null;
}

export interface EconomicsState {
  inputs: EconomicsInputs;
  op: OperatingSnapshot;
  /** Deal used for the financing map (a shocked copy under counterfactuals). */
  deal: CanonicalDeal;
  samHighUsd: number | null;
  registry: BenchmarkRegistry;
  fund: FundProfile;
  modelable: boolean;
  reasons: string[];
  notes: string[];
}

const STAGE_ORDER: FinancingStage[] = ["PRE_SEED", "SEED", "SERIES_A", "SERIES_B", "SERIES_C_PLUS"];

export function entryRoundName(stage: FinancingStage): string {
  return { PRE_SEED: "Pre-seed", SEED: "Seed", SERIES_A: "Series A", SERIES_B: "Series B", SERIES_C_PLUS: "Series C+", UNKNOWN: "Current round" }[stage];
}

/** Step-up of the round that led into `stage` (e.g. Seed → Series A), from the registry path of the previous stage. */
export function priorStepUp(stage: FinancingStage, registry: BenchmarkRegistry, a: EconomicsAssumptions): number {
  const i = STAGE_ORDER.indexOf(stage);
  if (i <= 0) return a.defaultPriorStepUp;
  const prev = STAGE_ORDER[i - 1]!;
  return registry.returns.futureRounds[prev][0]?.stepUp ?? a.defaultPriorStepUp;
}

const primary = (deal: CanonicalDeal, key: string): number | null => {
  const m = deal.metrics.find((x) => x.metricKey === key && x.isPrimary && x.normalizedValue !== null && Number.isFinite(x.normalizedValue));
  return m ? m.normalizedValue : null;
};

export function operatingSnapshot(deal: CanonicalDeal): OperatingSnapshot {
  const arr = primary(deal, "arr");
  const ttm = primary(deal, "revenue_ttm");
  const mrr = primary(deal, "mrr");
  const gmv = primary(deal, "gmv");
  const take = primary(deal, "take_rate");
  let revenueUsd: number | null = null;
  let revenueSource = "Unavailable";
  if (arr !== null && arr > 0) [revenueUsd, revenueSource] = [arr, "ARR"];
  else if (ttm !== null && ttm > 0) [revenueUsd, revenueSource] = [ttm, "Revenue (TTM)"];
  else if (mrr !== null && mrr > 0) [revenueUsd, revenueSource] = [mrr * 12, "MRR × 12"];
  else if (gmv !== null && take !== null && gmv > 0 && take > 0) [revenueUsd, revenueSource] = [(gmv * take) / 100, "GMV × take rate"];

  const customers = primary(deal, "paying_customers");
  const acv = primary(deal, "acv");
  const arpu = primary(deal, "arpu_monthly");
  let arpaUsd: number | null = null;
  let arpaSource = "Unavailable";
  if (acv !== null && acv > 0) [arpaUsd, arpaSource] = [acv, "ACV"];
  else if (arpu !== null && arpu > 0) [arpaUsd, arpaSource] = [arpu * 12, "ARPU × 12"];
  else if (deal.arpaAssumptionUsd && deal.arpaAssumptionUsd > 0) [arpaUsd, arpaSource] = [deal.arpaAssumptionUsd, "Model assumption (analysis)"];
  else if (revenueUsd !== null && customers !== null && customers > 0) [arpaUsd, arpaSource] = [revenueUsd / customers, "Revenue ÷ paying customers"];

  let growthPct: number | null = null;
  let growthSource = "Unavailable";
  const g1 = primary(deal, "arr_growth_yoy");
  const g2 = primary(deal, "revenue_growth_yoy");
  const mom = primary(deal, "mom_growth");
  if (g1 !== null) [growthPct, growthSource] = [g1, "ARR growth YoY"];
  else if (g2 !== null) [growthPct, growthSource] = [g2, "Revenue growth YoY"];
  else if (mom !== null) [growthPct, growthSource] = [(Math.pow(1 + mom / 100, 12) - 1) * 100, "MoM growth annualized"];

  const gm = primary(deal, "gross_margin");
  const cacM = primary(deal, "cac");
  const paybackM = primary(deal, "cac_payback_months");
  let cacUsd: number | null = cacM;
  let cacSource = cacM !== null ? "CAC (reported)" : "Unavailable";
  let payback: number | null = paybackM;
  let paybackSource = paybackM !== null ? "CAC payback (reported)" : "Unavailable";
  if (cacUsd === null && paybackM !== null && arpaUsd && gm) {
    cacUsd = paybackM * (arpaUsd / 12) * (gm / 100);
    cacSource = "Implied: payback × (ARPA/12) × gross margin";
  }
  if (payback === null && cacUsd !== null && arpaUsd && gm) {
    payback = cacPaybackMonths(cacUsd, arpaUsd, gm);
    paybackSource = "Computed: CAC ÷ (ARPA/12 × gross margin)";
  }
  return {
    revenueUsd,
    revenueSource,
    arpaUsd,
    arpaSource,
    customers,
    nrrPct: primary(deal, "nrr"),
    growthPct,
    growthSource,
    grossMarginPct: gm,
    cacUsd,
    cacSource,
    cacPaybackMonths: payback,
    paybackSource,
    burnMultiple: primary(deal, "burn_multiple"),
    winRatePct: primary(deal, "win_rate"),
  };
}

export function resolveAssumptions(over?: Partial<EconomicsAssumptions>): EconomicsAssumptions {
  return { ...DEFAULT_ECONOMICS_ASSUMPTIONS, ...(over ?? {}) };
}

export function stateFromContext(ctx: EconomicsContext): EconomicsState {
  const a = resolveAssumptions(ctx.assumptions);
  const ri = ctx.returns.inputs;
  const reasons: string[] = [];
  const notes: string[] = [];
  const f = ctx.deal.financing;
  const usd = (m: { amount: number | null; currency: string } | null | undefined) =>
    m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null;

  const checkUsd = ri.checkUsd;
  let raiseUsd = ri.entry.raiseUsd ?? null;
  if (raiseUsd === null) {
    raiseUsd = checkUsd;
    notes.push("Round size unknown — modeled as if our check were the whole round.");
  }
  if (checkUsd > raiseUsd) {
    notes.push("Check exceeds the stated round size — the round is modeled as our check.");
    raiseUsd = checkUsd;
  }
  const post = ri.entry.postMoneyUsd;

  const exits = {} as Record<Scenario, ExitSpec>;
  for (const [s, e] of Object.entries(ri.exits) as [Scenario, (typeof ri.exits)[Scenario]][]) {
    const assumption = ctx.deal.exitAssumptions.find((x) => x.scenario === s);
    exits[s] = {
      exitEquityUsd: e.exitEquityUsd,
      years: e.years,
      basis: e.basis,
      revenueMultiple: assumption?.revenueMultiple ?? null,
    };
  }

  const inputs: EconomicsInputs = {
    instrument: ri.entry.instrument,
    stage: ri.stage,
    postMoneyUsd: post,
    raiseUsd,
    checkUsd,
    discountPct: ri.entry.discountPct,
    ourPrefMultiple: ri.entry.liquidationPrefMultiple,
    ourParticipating: ri.entry.participating,
    priorRaisedUsd: usd(f?.totalRaisedToDate),
    priorStepUp: priorStepUp(ri.stage, ctx.registry, a),
    entryPoolIncreasePct: f?.optionPoolIncreasePct ?? null,
    futureRounds: ri.futureRounds,
    roundsBeforeExit: ctx.registry.returns.roundsBeforeExit,
    monthsBetweenRounds: ri.monthsBetweenRounds,
    nextRoundDelayMonths: 0,
    bridge: null,
    followOn: ri.followOn,
    reserveUsd: ri.reserveUsd,
    exits,
    fundSizeUsd: ctx.fund.fundSizeUsd,
    preRoundCapTable: ctx.capTable ?? null,
    a,
  };
  reasons.push(...validateInputs(inputs));
  return {
    inputs,
    op: operatingSnapshot(ctx.deal),
    deal: ctx.deal,
    samHighUsd: ctx.market.primary?.highUsd ?? null,
    registry: ctx.registry,
    fund: ctx.fund,
    modelable: reasons.length === 0,
    reasons,
    notes,
  };
}

/** Same state, different inputs (used by solvers and counterfactuals). */
export function withInputs(s: EconomicsState, patch: Partial<EconomicsInputs>): EconomicsState {
  const inputs = { ...s.inputs, ...patch };
  const reasons = validateInputs(inputs);
  return { ...s, inputs, reasons, modelable: reasons.length === 0 };
}

export function validateInputs(inp: EconomicsInputs): string[] {
  const reasons: string[] = [];
  const post = inp.postMoneyUsd;
  const convertible = inp.instrument === "SAFE" || inp.instrument === "CONVERTIBLE_NOTE";
  if (!post || !(post > 0) || !Number.isFinite(post))
    reasons.push("Entry valuation unknown — the cap-table model cannot run. Provide a post-money valuation or valuation cap.");
  else if (!convertible && post <= inp.raiseUsd) reasons.push("Post-money valuation is not above the round size — inconsistent financing terms.");
  else if (inp.instrument === "SAFE" && post <= inp.raiseUsd) reasons.push("Valuation cap is not above the SAFE round size — inconsistent terms.");
  if (!(inp.checkUsd > 0)) reasons.push("Check size is zero.");
  return reasons;
}
