/**
 * §46–49 Return engine. Deal attractiveness comes from economics, never from
 * a quality score. All assumptions are explicit and returned with the result.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { FinancingStage, ReturnScenarioName } from "@/domain/enums";
import { RETURN_SCENARIOS } from "@/domain/enums";
import type { BenchmarkRegistry, FutureRound } from "./benchmarks/types";
import { irr, moic, type CashFlow } from "./calc/finance";
import { runWaterfall, type WaterfallClass } from "./calc/waterfall";
import { toUsd } from "./metrics/normalize";

export interface EntryTerms {
  instrument: "PRICED_EQUITY" | "SAFE" | "CONVERTIBLE_NOTE" | "UNKNOWN";
  /** Post-money valuation (priced) or valuation cap (SAFE/note), USD. */
  postMoneyUsd: number | null;
  raiseUsd: number | null;
  discountPct: number | null;
  liquidationPrefMultiple: number;
  participating: boolean;
  source: "DECK" | "USER" | "MISSING";
}

export interface ReturnInputs {
  checkUsd: number;
  entry: EntryTerms;
  stage: FinancingStage;
  futureRounds: FutureRound[];
  followOn: boolean;
  reserveUsd: number;
  /** Exit equity value per scenario (USD) and years to exit. */
  exits: Record<ReturnScenarioName, { exitEquityUsd: number; years: number; basis: string }>;
  monthsBetweenRounds: number;
}

export interface ScenarioResult {
  scenario: ReturnScenarioName;
  exitEquityUsd: number;
  years: number;
  basis: string;
  roundsRaised: number;
  initialUsd: number;
  followOnUsd: number;
  investedUsd: number;
  entryOwnershipPct: number;
  exitOwnershipPct: number;
  proceedsUsd: number;
  proceedsIfConvertedUsd: number;
  preferenceBinding: boolean;
  grossMoic: number | null;
  grossIrr: number | null;
  fundContributionPctOfFund: number | null;
}

export interface ReturnModel {
  inputs: ReturnInputs;
  scenarios: ScenarioResult[];
  assumptions: string[];
  warnings: string[];
  modelable: boolean;
}

/** Resolve entry terms from the canonical financing extraction. */
export function entryTermsFromDeal(deal: CanonicalDeal, registry: BenchmarkRegistry): EntryTerms {
  const f = deal.financing;
  const usd = (m: { amount: number | null; currency: string } | null | undefined) =>
    m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null;
  const raise = usd(f?.raiseAmount);
  const pre = usd(f?.preMoney);
  const post = usd(f?.postMoney);
  const cap = usd(f?.valuationCap);
  const instrument = f?.instrument ?? "UNKNOWN";
  let postMoneyUsd: number | null = null;
  if (instrument === "SAFE" || instrument === "CONVERTIBLE_NOTE") postMoneyUsd = cap ?? post ?? (pre && raise ? pre + raise : null);
  else postMoneyUsd = post ?? (pre && raise ? pre + raise : null) ?? cap;
  return {
    instrument,
    postMoneyUsd,
    raiseUsd: raise,
    discountPct: f?.discountPct ?? null,
    liquidationPrefMultiple: f?.terms.liquidationPreferenceMultiple ?? registry.returns.defaultLiquidationPrefMultiple,
    participating: f?.terms.participating ?? false,
    source: postMoneyUsd ? "DECK" : "MISSING",
  };
}

export function defaultExits(
  deal: CanonicalDeal,
  registry: BenchmarkRegistry,
  postMoneyUsd: number | null,
): ReturnInputs["exits"] {
  const out = {} as ReturnInputs["exits"];
  for (const s of RETURN_SCENARIOS) {
    const a = deal.exitAssumptions.find((x) => x.scenario === s);
    if (a && a.exitRevenueUsd !== null && a.revenueMultiple !== null) {
      out[s] = {
        exitEquityUsd: Math.max(0, a.exitRevenueUsd * a.revenueMultiple),
        years: a.yearsToExit,
        basis: `$${(a.exitRevenueUsd / 1e6).toFixed(1)}M revenue × ${a.revenueMultiple}x — ${a.rationale}`,
      };
    } else if (s === "FAILURE") {
      out[s] = { exitEquityUsd: 0, years: a?.yearsToExit ?? registry.returns.defaultYearsToExit.FAILURE, basis: a?.rationale ?? "Wind-down; no residual equity value (model assumption)" };
    } else {
      const mult = registry.returns.defaultExitMultipleOfPostMoney[s];
      out[s] = {
        exitEquityUsd: postMoneyUsd ? postMoneyUsd * mult : 0,
        years: registry.returns.defaultYearsToExit[s],
        basis: `Registry default: ${mult}× the deck's reference valuation (MODEL_ASSUMPTION; no company-specific exit assumption)`,
      };
    }
  }
  return out;
}

/**
 * Model one scenario: dilution path, follow-on pro rata, preference stack and waterfall.
 * Preference stack: all preferred rounds 1x non-participating pari passu unless our terms say otherwise
 * (explicit MODEL_ASSUMPTION returned in `assumptions`).
 */
function modelScenario(inp: ReturnInputs, scenario: ReturnScenarioName, roundsBeforeExit: number, fundSizeUsd: number | null): ScenarioResult {
  const post0 = inp.entry.postMoneyUsd!;
  const exit = inp.exits[scenario];
  let ownership = inp.checkUsd / post0; // SAFE: at cap (conservative: the discount may give more)
  const entryOwnership = ownership;
  let followOnUsd = 0;
  let reserveLeft = inp.reserveUsd;
  let post = post0;
  const flows: CashFlow[] = [{ t: 0, amount: -inp.checkUsd }];

  // Preference stack bookkeeping: (invested, ownership fraction at exit) per preferred block.
  const otherPrefBlocks: { invested: number; ownership: number }[] = [];
  // Existing preferred holders in the entry round (other than us): the rest of the round.
  const raise = inp.entry.raiseUsd ?? inp.checkUsd;
  const othersInRound = Math.max(0, raise - inp.checkUsd);
  otherPrefBlocks.push({ invested: othersInRound, ownership: othersInRound / post0 });
  let ourInvestedPref = inp.checkUsd;

  const rounds = inp.futureRounds.slice(0, roundsBeforeExit);
  rounds.forEach((r, i) => {
    const newPost = post * r.stepUp;
    const newMoney = newPost * (r.dilutionPct / 100);
    const dil = 1 - r.dilutionPct / 100;
    for (const blk of otherPrefBlocks) blk.ownership *= dil;
    let ourNewMoney = 0;
    if (inp.followOn && i === 0 && reserveLeft > 0) {
      ourNewMoney = Math.min(reserveLeft, ownership * newMoney);
      reserveLeft -= ourNewMoney;
      followOnUsd += ourNewMoney;
      flows.push({ t: ((i + 1) * inp.monthsBetweenRounds) / 12, amount: -ourNewMoney });
    }
    ownership = ownership * dil + ourNewMoney / newPost;
    ourInvestedPref += ourNewMoney;
    otherPrefBlocks.push({ invested: newMoney - ourNewMoney, ownership: (newMoney - ourNewMoney) / newPost });
    post = newPost;
  });

  const prefOwnershipOthers = otherPrefBlocks.reduce((a, b) => a + b.ownership, 0);
  const commonOwnership = Math.max(0, 1 - ownership - prefOwnershipOthers);
  const classes: WaterfallClass[] = [
    {
      name: "us",
      shares: ownership,
      preference: ourInvestedPref * inp.entry.liquidationPrefMultiple,
      participating: inp.entry.participating,
      seniority: 0,
    },
    ...otherPrefBlocks.map((b, i) => ({
      name: `pref${i}`,
      shares: b.ownership,
      preference: b.invested,
      participating: false,
      seniority: 0,
    })),
    { name: "common", shares: commonOwnership, preference: 0, participating: false, seniority: 0 },
  ];
  const wf = runWaterfall(exit.exitEquityUsd, classes);
  const proceeds = wf.byClass.us ?? 0;
  const proceedsIfConverted = exit.exitEquityUsd * ownership;
  const invested = inp.checkUsd + followOnUsd;
  if (proceeds > 0) flows.push({ t: exit.years, amount: proceeds });
  else flows.push({ t: exit.years, amount: 0 });

  return {
    scenario,
    exitEquityUsd: exit.exitEquityUsd,
    years: exit.years,
    basis: exit.basis,
    roundsRaised: rounds.length,
    initialUsd: inp.checkUsd,
    followOnUsd,
    investedUsd: invested,
    entryOwnershipPct: entryOwnership * 100,
    exitOwnershipPct: ownership * 100,
    proceedsUsd: proceeds,
    proceedsIfConvertedUsd: proceedsIfConverted,
    preferenceBinding: proceeds > proceedsIfConverted + 1,
    grossMoic: moic(proceeds, invested),
    grossIrr: irr(flows),
    fundContributionPctOfFund: fundSizeUsd ? (proceeds / fundSizeUsd) * 100 : null,
  };
}

export function buildReturnInputs(
  deal: CanonicalDeal,
  registry: BenchmarkRegistry,
  fund: FundProfile,
  overrides: Partial<{ checkUsd: number; postMoneyUsd: number; followOn: boolean; exits: Partial<ReturnInputs["exits"]>; futureRounds: FutureRound[] }> = {},
): ReturnInputs {
  const entry = entryTermsFromDeal(deal, registry);
  // Exit values describe the company, not the price we pay: default exits are anchored to the
  // deck's reference valuation and never move with a user price override (§126).
  const referenceValuationUsd = entry.postMoneyUsd ?? overrides.postMoneyUsd ?? null;
  if (overrides.postMoneyUsd) {
    entry.postMoneyUsd = overrides.postMoneyUsd;
    entry.source = "USER";
  }
  const stage = deal.classification.financingStage;
  const checkUsd = overrides.checkUsd ?? Math.min(fund.initialCheckDefaultUsd, entry.raiseUsd ?? fund.initialCheckDefaultUsd);
  const exits = { ...defaultExits(deal, registry, referenceValuationUsd), ...(overrides.exits ?? {}) } as ReturnInputs["exits"];
  return {
    checkUsd,
    entry,
    stage,
    futureRounds: overrides.futureRounds ?? registry.returns.futureRounds[stage],
    followOn: overrides.followOn ?? registry.returns.followOnPolicy === "NEXT_ROUND_PRO_RATA",
    reserveUsd: checkUsd * fund.reserveRatio,
    exits,
    monthsBetweenRounds: registry.returns.monthsBetweenRounds,
  };
}

export function runReturnModel(inputs: ReturnInputs, registry: BenchmarkRegistry, fund: FundProfile | null): ReturnModel {
  const warnings: string[] = [];
  const assumptions = [
    `Future rounds: ${inputs.futureRounds.map((r) => `${r.name} ${r.dilutionPct}% dilution at ${r.stepUp}× step-up`).join("; ")} (MODEL_ASSUMPTION).`,
    `Rounds raised before exit per scenario: ${Object.entries(registry.returns.roundsBeforeExit).map(([k, v]) => `${k} ${v}`).join(", ")}.`,
    inputs.followOn
      ? `Follow-on: pro rata in the next round, capped at reserves of $${(inputs.reserveUsd / 1e6).toFixed(2)}M.`
      : "No follow-on investment.",
    `Preference stack: every preferred round ${inputs.entry.liquidationPrefMultiple}x ${inputs.entry.participating ? "participating" : "non-participating"}, pari passu (MODEL_ASSUMPTION unless terms provided).`,
    "Exit equity value treated as proceeds to equity (net debt assumed zero).",
  ];
  if (inputs.entry.instrument === "SAFE" || inputs.entry.instrument === "CONVERTIBLE_NOTE")
    assumptions.push("SAFE/note ownership computed at the valuation cap; a discount could increase ownership.");
  if (!inputs.entry.postMoneyUsd) {
    warnings.push("Entry valuation unknown — returns cannot be modeled. Set a post-money valuation to run scenarios.");
    return { inputs, scenarios: [], assumptions, warnings, modelable: false };
  }
  if (inputs.entry.raiseUsd && inputs.checkUsd > inputs.entry.raiseUsd) warnings.push("Check size exceeds the round size.");
  const scenarios = RETURN_SCENARIOS.map((s) =>
    modelScenario(inputs, s, registry.returns.roundsBeforeExit[s], fund?.fundSizeUsd ?? null),
  );
  return { inputs, scenarios, assumptions, warnings, modelable: true };
}

/* ---------------------------------------------------------------- */
/* §48 Backwards return analysis                                      */
/* ---------------------------------------------------------------- */

export interface BackwardsResult {
  targetContributionUsd: number;
  exitOwnershipPct: number;
  requiredExitEquityUsd: number;
  byMultiple: { revenueMultiple: number; requiredRevenueUsd: number; requiredCustomers: number | null; samSharePct: number | null }[];
  arpaUsd: number | null;
  arpaSource: string;
  samHighUsd: number | null;
  plausibility: "PLAUSIBLE" | "DEMANDING" | "HEROIC" | "IMPLAUSIBLE" | "UNKNOWN";
  /** Share of SAM needed at the median revenue multiple — feeds the power-law outlier path. */
  medianSamSharePct: number | null;
  explanation: string;
}

export function backwardsReturn(
  targetContributionUsd: number,
  exitOwnershipPct: number,
  registry: BenchmarkRegistry,
  arpa: { usd: number | null; source: string },
  samHighUsd: number | null,
): BackwardsResult {
  const own = exitOwnershipPct / 100;
  const requiredExitEquityUsd = own > 0 ? targetContributionUsd / own : Number.POSITIVE_INFINITY;
  const byMultiple = registry.returns.backwardsRevenueMultiples.map((mult) => {
    const requiredRevenueUsd = requiredExitEquityUsd / mult;
    return {
      revenueMultiple: mult,
      requiredRevenueUsd,
      requiredCustomers: arpa.usd ? Math.ceil(requiredRevenueUsd / arpa.usd) : null,
      samSharePct: samHighUsd ? (requiredRevenueUsd / samHighUsd) * 100 : null,
    };
  });
  const mid = byMultiple[Math.floor(byMultiple.length / 2)]!;
  const share = mid.samSharePct;
  const t = registry.returns.samSharePlausibility;
  const plausibility =
    share === null ? "UNKNOWN" : share <= t.PLAUSIBLE ? "PLAUSIBLE" : share <= t.DEMANDING ? "DEMANDING" : share <= t.HEROIC ? "HEROIC" : "IMPLAUSIBLE";
  const explanation =
    share === null
      ? "Reconstructed market size unavailable — plausibility cannot be assessed."
      : `To return $${(targetContributionUsd / 1e6).toFixed(0)}M at ${exitOwnershipPct.toFixed(1)}% exit ownership the company must be worth $${(requiredExitEquityUsd / 1e9).toFixed(2)}B, i.e. ~$${(mid.requiredRevenueUsd / 1e6).toFixed(0)}M revenue at ${mid.revenueMultiple}× — ${share.toFixed(1)}% of the reconstructed SAM upper bound.`;
  return {
    targetContributionUsd,
    exitOwnershipPct,
    requiredExitEquityUsd,
    byMultiple,
    arpaUsd: arpa.usd,
    arpaSource: arpa.source,
    samHighUsd,
    plausibility,
    medianSamSharePct: share,
    explanation,
  };
}

/* ---------------------------------------------------------------- */
/* §49 Price sensitivity                                              */
/* ---------------------------------------------------------------- */

export interface PriceSensitivityRow {
  scenario: ReturnScenarioName;
  exitEquityUsd: number;
  cumulativeDilutionPct: number;
  maxPostMoneyByTarget: { targetMoic: number; maxPostMoneyUsd: number }[];
  currentImpliedMoic: number | null;
}

/**
 * Maximum entry post-money compatible with each target gross multiple, for
 * the initial check only (no follow-on), ignoring preferences (valid when the
 * exit is large relative to the preference stack).
 *   proceeds = check / post × (1 − D) × E ≥ m × check  ⇒  post ≤ (1 − D) × E / m
 */
export function priceSensitivity(inputs: ReturnInputs, registry: BenchmarkRegistry): PriceSensitivityRow[] {
  const rows: PriceSensitivityRow[] = [];
  for (const s of ["BASE", "BULL", "OUTLIER"] as const) {
    const n = registry.returns.roundsBeforeExit[s];
    const keep = inputs.futureRounds.slice(0, n).reduce((a, r) => a * (1 - r.dilutionPct / 100), 1);
    const E = inputs.exits[s].exitEquityUsd;
    rows.push({
      scenario: s,
      exitEquityUsd: E,
      cumulativeDilutionPct: (1 - keep) * 100,
      maxPostMoneyByTarget: registry.returns.priceSensitivityTargets.map((m) => ({ targetMoic: m, maxPostMoneyUsd: (keep * E) / m })),
      currentImpliedMoic: inputs.entry.postMoneyUsd ? (keep * E) / inputs.entry.postMoneyUsd : null,
    });
  }
  return rows;
}
