/**
 * PRO-FORMA CAP TABLE RETURNS.
 *
 * Builds the deal's pro-forma cap table (actual one if provided, else a
 * synthesized one with explicit assumptions), applies the entry round (priced
 * with the pool top-up in the pre-money, or post-money SAFE / note), then the
 * registry's future-round path (priced from step-ups, pool refresh, our
 * pro-rata follow-on from reserves in the next round), and distributes each
 * scenario's exit equity through the full liquidation waterfall.
 *
 * Reuses calc/captable (applyPricedRound fixed point, conversions) and
 * calc/waterfall (waterfallFromCapTable). Conversions are re-split into
 * shadow series so each converting holder's preference equals the amount it
 * actually converted (actual invested amounts per series).
 */
import { RETURN_SCENARIOS } from "@/domain/enums";
import { applyPricedRound, sharesOf, totalFdShares, type CapTable, type Convertible, type Holding, type ShareClass } from "../calc/captable";
import { waterfallFromCapTable } from "../calc/waterfall";
import { irr, moic, type CashFlow } from "../calc/finance";
import type { ReturnModel } from "../returns";
import { entryRoundName, type EconomicsInputs, type EconomicsState, type Scenario } from "./inputs";

export const OUR_HOLDER = "Our fund";
export const FOUNDERS_HOLDER = "Founders & employees";
export const POOL_HOLDER = "Option Pool";
export const PRIOR_HOLDER = "Prior investors";
export const COINVESTOR_HOLDER = "Round co-investors";
export const BRIDGE_HOLDER = "Bridge investors";
const BASE_FD_SHARES = 10_000_000;

export interface RoundRow {
  label: string;
  kind: "ENTRY" | "BRIDGE" | "PRICED";
  month: number;
  preMoneyUsd: number | null;
  postMoneyUsd: number | null;
  newMoneyUsd: number;
  pricePerShare: number | null;
  poolTopUpPctOfPost: number;
  /** Convertible amounts (SAFE/notes) that converted in this round. */
  convertedUsd: number;
  ourInvestmentUsd: number;
  /** Our fully diluted ownership after the step (as-converted at the cap while SAFEs are outstanding). */
  ourOwnershipPct: number;
  preferenceStackUsd: number;
  note: string;
}

export interface PathStep {
  row: RoundRow;
  ct: CapTable;
  ourCashUsd: number;
  /** Index of the priced future round this step belongs to (a bridge belongs to round 0). */
  roundIndex: number;
}

export interface ProFormaPath {
  entry: { row: RoundRow; ct: CapTable; ownershipPct: number };
  steps: PathStep[];
  notes: string[];
}

/* ---------------------------------------------------------------- */
/* Cap table helpers                                                  */
/* ---------------------------------------------------------------- */

function convertibleAmount(c: Convertible): number {
  if (c.kind === "CONVERTIBLE_NOTE") return c.principal * (1 + ((c.interestRatePct ?? 0) / 100) * (c.yearsOutstanding ?? 0));
  return c.principal;
}

/** Total liquidation preference of all preferred holdings (actual invested × multiple). */
export function preferenceStack(ct: CapTable): number {
  const byName = new Map(ct.classes.map((c) => [c.name, c]));
  let total = 0;
  for (const h of ct.holdings) {
    const c = byName.get(h.className);
    if (c?.type === "PREFERRED") total += h.shares * c.originalIssuePrice * c.liquidationPrefMultiple;
  }
  return total;
}

/**
 * Shares each outstanding convertible would receive if converted at its cap now.
 * Pre-money instruments: amount × S / cap. Post-money SAFEs: amount / cap of the
 * post-conversion capitalization (solved in closed form).
 */
export function capConversionShares(ct: CapTable): number[] {
  const S = totalFdShares(ct);
  const out = ct.convertibles.map(() => 0);
  let cPre = 0;
  let k = 0;
  ct.convertibles.forEach((c, i) => {
    if (!c.valuationCap || !(c.valuationCap > 0)) return;
    if (c.kind === "SAFE_POST_MONEY") k += convertibleAmount(c) / c.valuationCap;
    else {
      out[i] = (convertibleAmount(c) * S) / c.valuationCap;
      cPre += out[i]!;
    }
  });
  k = Math.min(k, 0.999);
  const cPost = (k * (S + cPre)) / (1 - k);
  const base = S + cPre + cPost;
  ct.convertibles.forEach((c, i) => {
    if (c.kind === "SAFE_POST_MONEY" && c.valuationCap && c.valuationCap > 0) out[i] = (convertibleAmount(c) / c.valuationCap) * base;
  });
  return out;
}

/** Fully diluted ownership, counting outstanding convertibles as converted at their caps. */
export function asConvertedOwnership(ct: CapTable, holder: string): number {
  const conv = capConversionShares(ct);
  const total = totalFdShares(ct) + conv.reduce((a, b) => a + b, 0);
  const mine = sharesOf(ct, holder) + ct.convertibles.reduce((a, c, i) => a + (c.holder === holder ? conv[i]! : 0), 0);
  return total > 0 ? mine / total : 0;
}

/**
 * Liquidity event before conversion: each SAFE/note receives the greater of its
 * amount (1x, pari passu with preferred) or its as-converted value at the cap —
 * modelled as a non-participating preferred line whose preference is the amount.
 */
export function exitCapTable(ct: CapTable): CapTable {
  if (ct.convertibles.length === 0) return ct;
  const conv = capConversionShares(ct);
  const classes: ShareClass[] = [...ct.classes];
  const holdings: Holding[] = ct.holdings.map((h) => ({ ...h }));
  ct.convertibles.forEach((c, i) => {
    const shares = conv[i]!;
    const amount = convertibleAmount(c);
    if (!(shares > 0)) return;
    const name = `${c.kind === "CONVERTIBLE_NOTE" ? "Note" : "SAFE"} ${i + 1} (${c.holder}, unconverted)`;
    classes.push({ name, type: "PREFERRED", originalIssuePrice: amount / shares, liquidationPrefMultiple: 1, participating: false, seniority: 0 });
    holdings.push({ holder: c.holder, className: name, shares });
  });
  return { classes, holdings, convertibles: [], debt: ct.debt };
}

/** Move converted shares into per-holder shadow series whose preference is the converted amount. */
function splitShadowSeries(ct: CapTable, className: string, conversions: { holder: string; shares: number; conversionPrice: number }[]): CapTable {
  if (conversions.length === 0) return ct;
  const series = ct.classes.find((c) => c.name === className);
  if (!series) return ct;
  const classes = [...ct.classes];
  const holdings = ct.holdings.map((h) => ({ ...h }));
  conversions.forEach((cv, i) => {
    const h = holdings.find((x) => x.holder === cv.holder && x.className === className);
    if (!h) return;
    const moved = Math.min(h.shares, cv.shares);
    h.shares -= moved;
    const name = `${className} shadow ${i + 1} (${cv.holder})`;
    classes.push({ ...series, name, originalIssuePrice: cv.conversionPrice });
    holdings.push({ holder: cv.holder, className: name, shares: moved });
  });
  return { ...ct, classes, holdings: holdings.filter((h) => h.shares > 1e-9) };
}

function uniqueClassName(ct: CapTable, name: string): string {
  if (!ct.classes.some((c) => c.name === name)) return name;
  for (let i = 2; ; i++) if (!ct.classes.some((c) => c.name === `${name} (${i})`)) return `${name} (${i})`;
}

/**
 * A pool target inside the pre-money is only feasible when pre/post exceeds it
 * (applyPricedRound's fixed point diverges otherwise). Cap it at half of pre/post.
 */
export function feasiblePoolTarget(targetPct: number, preMoney: number, postMoney: number): number {
  if (!(postMoney > 0) || !(preMoney > 0)) return 0;
  return Math.max(0, Math.min(targetPct, (preMoney / postMoney) * 50));
}

function poolShares(ct: CapTable): number {
  const pool = new Set(ct.classes.filter((c) => c.type === "OPTION_POOL").map((c) => c.name));
  return ct.holdings.filter((h) => pool.has(h.className)).reduce((a, h) => a + h.shares, 0);
}

/* ---------------------------------------------------------------- */
/* Pro-forma path                                                     */
/* ---------------------------------------------------------------- */

/** Reference pre-money used to infer the prior round (priced: pre; post-money SAFE: cap − round; note: cap). */
function preMoneyReference(inp: EconomicsInputs): number {
  const post = inp.postMoneyUsd!;
  if (inp.instrument === "CONVERTIBLE_NOTE") return post;
  return Math.max(post - inp.raiseUsd, post * 0.01);
}

export function synthesizePreRoundCapTable(inp: EconomicsInputs): { ct: CapTable; notes: string[] } {
  const notes: string[] = [];
  const S = BASE_FD_SHARES;
  const poolPct = inp.a.existingPoolPrePct / 100;
  let priorPct = 0;
  if (inp.priorRaisedUsd && inp.priorRaisedUsd > 0) {
    const priorPost = preMoneyReference(inp) / inp.priorStepUp;
    priorPct = Math.min(inp.priorRaisedUsd / priorPost, inp.a.priorPrefMaxPct / 100);
    notes.push(
      `Prior preferred: $${(inp.priorRaisedUsd / 1e6).toFixed(2)}M raised to date at an inferred previous post-money of $${(priorPost / 1e6).toFixed(1)}M (current pre ÷ ${inp.priorStepUp}× step-up) → ${(priorPct * 100).toFixed(1)}% of pre-round FD (MODEL_ASSUMPTION).`,
    );
  } else notes.push("No prior preferred modeled (total raised to date unknown) — the preference stack may be understated.");
  const commonPct = Math.max(0.05, 1 - poolPct - priorPct);
  const classes: ShareClass[] = [
    { name: "Common", type: "COMMON", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
    { name: "Option Pool", type: "OPTION_POOL", originalIssuePrice: 0, liquidationPrefMultiple: 0, participating: false, seniority: 0 },
  ];
  const holdings: Holding[] = [
    { holder: FOUNDERS_HOLDER, className: "Common", shares: S * commonPct },
    { holder: POOL_HOLDER, className: "Option Pool", shares: S * poolPct },
  ];
  if (priorPct > 0) {
    const priorShares = S * priorPct;
    classes.push({ name: "Prior preferred", type: "PREFERRED", originalIssuePrice: inp.priorRaisedUsd! / priorShares, liquidationPrefMultiple: 1, participating: false, seniority: 0 });
    holdings.push({ holder: PRIOR_HOLDER, className: "Prior preferred", shares: priorShares });
  }
  notes.push(`Synthesized pre-round cap table: common ${(commonPct * 100).toFixed(1)}%, option pool ${(poolPct * 100).toFixed(1)}%, prior preferred ${(priorPct * 100).toFixed(1)}% (MODEL_ASSUMPTION — no cap table provided).`);
  return { ct: { classes, holdings, convertibles: [], debt: [] }, notes };
}

function cloneCt(ct: CapTable): CapTable {
  return {
    classes: ct.classes.map((c) => ({ ...c })),
    holdings: ct.holdings.map((h) => ({ ...h })),
    convertibles: ct.convertibles.map((c) => ({ ...c })),
    debt: ct.debt.map((d) => ({ ...d })),
  };
}

function pricedEntry(inp: EconomicsInputs, ct0: CapTable, notes: string[]) {
  const post = inp.postMoneyUsd!;
  const pre = post - inp.raiseUsd;
  const className = uniqueClassName(ct0, entryRoundName(inp.stage));
  const investments = [{ holder: OUR_HOLDER, amount: inp.checkUsd }];
  if (inp.raiseUsd - inp.checkUsd > 1e-6) investments.push({ holder: COINVESTOR_HOLDER, amount: inp.raiseUsd - inp.checkUsd });
  const run = (target: number) =>
    applyPricedRound(ct0, {
      className,
      preMoney: pre,
      investments,
      targetPoolPostPct: feasiblePoolTarget(target, pre, post),
      liquidationPrefMultiple: inp.ourPrefMultiple,
      participating: inp.ourParticipating,
      seniority: 0,
    });
  let res;
  const inc = inp.entryPoolIncreasePct;
  if (inc === null) {
    res = run(inp.a.entryPoolTargetPostPct);
    notes.push(`Entry pool topped up to ${inp.a.entryPoolTargetPostPct}% of post-money FD in the pre-money (MODEL_ASSUMPTION — no top-up stated).`);
  } else if (inc <= 0) {
    res = run(0);
  } else {
    // Stated top-up is a % of post-money: solve the equivalent post-round target by iteration.
    const S0 = totalFdShares(ct0);
    let target = inc + (poolShares(ct0) / (S0 * (post / pre))) * 100;
    res = run(target);
    for (let k = 0; k < 30; k++) {
      const actual = (res.poolTopUpShares / totalFdShares(res.capTable)) * 100;
      if (Math.abs(actual - inc) < 1e-9) break;
      target += inc - actual;
      res = run(target);
    }
    notes.push(`Entry pool top-up of ${inc}% of post-money as stated in the terms, carved out of the pre-money.`);
  }
  const ct = splitShadowSeries(res.capTable, className, res.conversionShares);
  const total = totalFdShares(ct);
  return {
    ct,
    postMoney: res.postMoney,
    row: {
      label: `Entry: ${className} (priced)`,
      kind: "ENTRY" as const,
      month: 0,
      preMoneyUsd: pre,
      postMoneyUsd: res.postMoney,
      newMoneyUsd: inp.raiseUsd,
      pricePerShare: res.pricePerShare,
      poolTopUpPctOfPost: (res.poolTopUpShares / total) * 100,
      convertedUsd: res.conversionShares.reduce((a, c) => a + c.shares * c.conversionPrice, 0),
      ourInvestmentUsd: inp.checkUsd,
      ourOwnershipPct: (sharesOf(ct, OUR_HOLDER) / total) * 100,
      preferenceStackUsd: preferenceStack(ct),
      note: `${inp.ourPrefMultiple}x ${inp.ourParticipating ? "participating" : "non-participating"}`,
    },
  };
}

function convertibleEntry(inp: EconomicsInputs, ct0: CapTable) {
  const cap = inp.postMoneyUsd!;
  const isNote = inp.instrument === "CONVERTIBLE_NOTE";
  const mk = (holder: string, principal: number): Convertible => ({
    holder,
    kind: isNote ? "CONVERTIBLE_NOTE" : "SAFE_POST_MONEY",
    principal,
    valuationCap: cap,
    discountPct: inp.discountPct,
    ...(isNote ? { interestRatePct: inp.a.noteInterestPct, yearsOutstanding: 0 } : {}),
  });
  const convertibles = [...ct0.convertibles, mk(OUR_HOLDER, inp.checkUsd)];
  if (inp.raiseUsd - inp.checkUsd > 1e-6) convertibles.push(mk(COINVESTOR_HOLDER, inp.raiseUsd - inp.checkUsd));
  const ct: CapTable = { ...ct0, convertibles };
  const own = asConvertedOwnership(ct, OUR_HOLDER);
  const post = isNote ? cap + inp.raiseUsd : cap;
  return {
    ct,
    postMoney: post,
    row: {
      label: `Entry: ${isNote ? "convertible note" : "post-money SAFE"} at $${(cap / 1e6).toFixed(1)}M cap${inp.discountPct ? `, ${inp.discountPct}% discount` : ""}`,
      kind: "ENTRY" as const,
      month: 0,
      preMoneyUsd: isNote ? cap : cap - inp.raiseUsd,
      postMoneyUsd: post,
      newMoneyUsd: inp.raiseUsd,
      pricePerShare: null,
      poolTopUpPctOfPost: 0,
      convertedUsd: 0,
      ourInvestmentUsd: inp.checkUsd,
      ourOwnershipPct: own * 100,
      preferenceStackUsd: preferenceStack(ct),
      note: "Unconverted — ownership shown as-converted at the cap; converts at the next priced round.",
    },
  };
}

/** Build the entry and up to `maxRounds` future rounds. Returns null when the inputs are not modelable. */
export function buildProFormaPath(inp: EconomicsInputs, maxRounds: number): ProFormaPath | null {
  if (!inp.postMoneyUsd || !(inp.postMoneyUsd > 0) || !(inp.checkUsd > 0)) return null;
  const convertible = inp.instrument === "SAFE" || inp.instrument === "CONVERTIBLE_NOTE";
  if (!convertible && inp.postMoneyUsd <= inp.raiseUsd) return null;
  if (inp.instrument === "SAFE" && inp.postMoneyUsd <= inp.raiseUsd) return null;

  const notes: string[] = [];
  let ct0: CapTable;
  if (inp.preRoundCapTable) {
    ct0 = cloneCt(inp.preRoundCapTable);
    notes.push("Pre-round cap table provided — used as is.");
  } else {
    const s = synthesizePreRoundCapTable(inp);
    ct0 = s.ct;
    notes.push(...s.notes);
  }
  const entry = convertible ? convertibleEntry(inp, ct0) : pricedEntry(inp, ct0, notes);

  const steps: PathStep[] = [];
  let ct = entry.ct;
  let refPost = entry.postMoney;
  let reserveLeft = inp.followOn ? inp.reserveUsd : 0;
  const stacked = inp.a.futureSeniority === "STACKED";
  const rounds = inp.futureRounds.slice(0, Math.max(0, maxRounds));
  rounds.forEach((r, i) => {
    const month = (i + 1) * inp.monthsBetweenRounds + inp.nextRoundDelayMonths;
    if (i === 0 && inp.bridge && inp.bridge.amountUsd > 0) {
      ct = {
        ...ct,
        convertibles: [
          ...ct.convertibles,
          { holder: BRIDGE_HOLDER, kind: "SAFE_POST_MONEY", principal: inp.bridge.amountUsd, valuationCap: inp.bridge.capUsd, discountPct: null },
        ],
      };
      steps.push({
        roundIndex: 0,
        ourCashUsd: 0,
        ct,
        row: {
          label: `Bridge SAFE $${(inp.bridge.amountUsd / 1e6).toFixed(2)}M at $${(inp.bridge.capUsd / 1e6).toFixed(1)}M post-money cap`,
          kind: "BRIDGE",
          month: inp.monthsBetweenRounds,
          preMoneyUsd: inp.bridge.capUsd - inp.bridge.amountUsd,
          postMoneyUsd: inp.bridge.capUsd,
          newMoneyUsd: inp.bridge.amountUsd,
          pricePerShare: null,
          poolTopUpPctOfPost: 0,
          convertedUsd: 0,
          ourInvestmentUsd: 0,
          ourOwnershipPct: asConvertedOwnership(ct, OUR_HOLDER) * 100,
          preferenceStackUsd: preferenceStack(ct),
          note: "Next round delayed — bridge from other investors (MODEL_ASSUMPTION).",
        },
      });
    }
    const newPost = refPost * r.stepUp;
    const newMoney = newPost * (r.dilutionPct / 100);
    const pre = newPost - newMoney;
    const ownBefore = asConvertedOwnership(ct, OUR_HOLDER);
    const ours = inp.followOn && i === 0 ? Math.max(0, Math.min(reserveLeft, ownBefore * newMoney)) : 0;
    reserveLeft -= ours;
    const className = uniqueClassName(ct, r.name);
    const investments = [];
    if (ours > 0) investments.push({ holder: OUR_HOLDER, amount: ours });
    investments.push({ holder: `${className} investors`, amount: newMoney - ours });
    const withInterest: CapTable = {
      ...ct,
      convertibles: ct.convertibles.map((c) => (c.kind === "CONVERTIBLE_NOTE" ? { ...c, yearsOutstanding: month / 12 } : c)),
    };
    const res = applyPricedRound(withInterest, {
      className,
      preMoney: pre,
      investments,
      targetPoolPostPct: feasiblePoolTarget(inp.a.futurePoolTargetPostPct, pre, newPost),
      liquidationPrefMultiple: 1,
      participating: false,
      seniority: stacked ? i + 1 : 0,
    });
    ct = splitShadowSeries(res.capTable, className, res.conversionShares);
    refPost = res.postMoney;
    const total = totalFdShares(ct);
    const converted = res.conversionShares.reduce((a, c) => a + c.shares * c.conversionPrice, 0);
    steps.push({
      roundIndex: i,
      ourCashUsd: ours,
      ct,
      row: {
        label: className,
        kind: "PRICED",
        month,
        preMoneyUsd: pre,
        postMoneyUsd: res.postMoney,
        newMoneyUsd: newMoney,
        pricePerShare: res.pricePerShare,
        poolTopUpPctOfPost: (res.poolTopUpShares / total) * 100,
        convertedUsd: converted,
        ourInvestmentUsd: ours,
        ourOwnershipPct: (sharesOf(ct, OUR_HOLDER) / total) * 100,
        preferenceStackUsd: preferenceStack(ct),
        note: `${r.dilutionPct}% new money at ${r.stepUp}× step-up; pool refreshed to ${inp.a.futurePoolTargetPostPct}%${converted > 0 ? `; $${(converted / 1e6).toFixed(2)}M of SAFE/notes converted` : ""}${ours > 0 ? "; our pro-rata follow-on" : ""}`,
      },
    });
  });
  const finite = (ct: CapTable) => ct.holdings.every((h) => Number.isFinite(h.shares)) && ct.classes.every((c) => Number.isFinite(c.originalIssuePrice));
  if (!finite(entry.ct) || steps.some((st) => !finite(st.ct))) return null;
  return { entry: { row: entry.row, ct: entry.ct, ownershipPct: entry.row.ourOwnershipPct }, steps, notes };
}

/* ---------------------------------------------------------------- */
/* Scenario evaluation                                                */
/* ---------------------------------------------------------------- */

export interface ScenarioEvaluator {
  steps: PathStep[];
  exitCt: CapTable;
  investedUsd: number;
  followOnUsd: number;
  exitOwnership: number;
  flowsBeforeExit: CashFlow[];
  proceedsAt: (exitEquityUsd: number) => number;
}

export function roundsForScenario(inp: EconomicsInputs, s: Scenario): number {
  return Math.min(inp.roundsBeforeExit[s], inp.futureRounds.length);
}

export function scenarioEvaluator(path: ProFormaPath, inp: EconomicsInputs, rounds: number, years: number): ScenarioEvaluator {
  const exitMonths = years * 12;
  const steps = path.steps.filter((st) => st.roundIndex < rounds && st.row.month < exitMonths);
  const last = steps.length ? steps[steps.length - 1]!.ct : path.entry.ct;
  const exitCt = exitCapTable(last);
  const followOnUsd = steps.reduce((a, st) => a + st.ourCashUsd, 0);
  const flowsBeforeExit: CashFlow[] = [{ t: 0, amount: -inp.checkUsd }];
  for (const st of steps) if (st.ourCashUsd > 0) flowsBeforeExit.push({ t: st.row.month / 12, amount: -st.ourCashUsd });
  const exitOwnership = sharesOf(exitCt, OUR_HOLDER) / totalFdShares(exitCt);
  return {
    steps,
    exitCt,
    investedUsd: inp.checkUsd + followOnUsd,
    followOnUsd,
    exitOwnership,
    flowsBeforeExit,
    proceedsAt: (e: number) => (e > 0 ? (waterfallFromCapTable(exitCt, e)[OUR_HOLDER] ?? 0) : 0),
  };
}

export interface CapTableScenario {
  scenario: Scenario;
  exitEquityUsd: number;
  years: number;
  basis: string;
  roundsRaised: number;
  initialUsd: number;
  followOnUsd: number;
  investedUsd: number;
  entryOwnershipPct: number;
  ownershipPath: { label: string; month: number; pct: number }[];
  exitOwnershipPct: number;
  proceedsUsd: number;
  proceedsIfConvertedUsd: number;
  /** True when our preference pays more than converting (low exits). */
  preferenceBinding: boolean;
  preferenceStackUsd: number;
  grossMoic: number | null;
  grossIrr: number | null;
  fundContributionPctOfFund: number | null;
  cashFlows: CashFlow[];
  rounds: RoundRow[];
}

export function evaluateScenario(path: ProFormaPath, inp: EconomicsInputs, s: Scenario): CapTableScenario {
  const exit = inp.exits[s];
  const ev = scenarioEvaluator(path, inp, roundsForScenario(inp, s), exit.years);
  const proceeds = ev.proceedsAt(exit.exitEquityUsd);
  const asConverted = exit.exitEquityUsd * ev.exitOwnership;
  const flows = [...ev.flowsBeforeExit, { t: exit.years, amount: proceeds }];
  return {
    scenario: s,
    exitEquityUsd: exit.exitEquityUsd,
    years: exit.years,
    basis: exit.basis,
    roundsRaised: ev.steps.filter((st) => st.row.kind === "PRICED").length,
    initialUsd: inp.checkUsd,
    followOnUsd: ev.followOnUsd,
    investedUsd: ev.investedUsd,
    entryOwnershipPct: path.entry.ownershipPct,
    ownershipPath: [
      { label: path.entry.row.label, month: 0, pct: path.entry.ownershipPct },
      ...ev.steps.map((st) => ({ label: st.row.label, month: st.row.month, pct: st.row.ourOwnershipPct })),
    ],
    exitOwnershipPct: ev.exitOwnership * 100,
    proceedsUsd: proceeds,
    proceedsIfConvertedUsd: asConverted,
    preferenceBinding: proceeds > asConverted + 1,
    preferenceStackUsd: preferenceStack(ev.exitCt),
    grossMoic: moic(proceeds, ev.investedUsd),
    grossIrr: irr(flows),
    fundContributionPctOfFund: inp.fundSizeUsd ? (proceeds / inp.fundSizeUsd) * 100 : null,
    cashFlows: flows,
    rounds: [path.entry.row, ...ev.steps.map((st) => st.row)],
  };
}

export function maxRoundsNeeded(inp: EconomicsInputs): number {
  return Math.min(inp.futureRounds.length, Math.max(0, ...Object.values(inp.roundsBeforeExit)));
}

export interface ModelComparisonRow {
  scenario: Scenario;
  simplifiedMoic: number | null;
  capTableMoic: number | null;
  moicDeltaPct: number | null;
  simplifiedExitOwnershipPct: number | null;
  capTableExitOwnershipPct: number;
  simplifiedProceedsUsd: number | null;
  capTableProceedsUsd: number;
  simplifiedFollowOnUsd: number | null;
  capTableFollowOnUsd: number;
}

export interface CapTableReturns {
  modelable: boolean;
  reasons: string[];
  instrument: EconomicsInputs["instrument"];
  entryOwnershipPct: number | null;
  scenarios: CapTableScenario[];
  comparison: ModelComparisonRow[];
  /** Deterministic sentences explaining why the two models differ. */
  differences: string[];
  notes: string[];
}

export function capTableReturns(state: EconomicsState, simplified: ReturnModel | null): CapTableReturns {
  const inp = state.inputs;
  const path = state.modelable ? buildProFormaPath(inp, maxRoundsNeeded(inp)) : null;
  if (!path) {
    return {
      modelable: false,
      reasons: state.reasons.length ? state.reasons : ["Financing terms are inconsistent — the cap-table model cannot run."],
      instrument: inp.instrument,
      entryOwnershipPct: null,
      scenarios: [],
      comparison: [],
      differences: [],
      notes: [...state.notes],
    };
  }
  const scenarios = RETURN_SCENARIOS.map((s) => evaluateScenario(path, inp, s));
  const comparison: ModelComparisonRow[] = scenarios.map((c) => {
    const simp = simplified?.scenarios.find((x) => x.scenario === c.scenario) ?? null;
    return {
      scenario: c.scenario,
      simplifiedMoic: simp?.grossMoic ?? null,
      capTableMoic: c.grossMoic,
      moicDeltaPct:
        simp?.grossMoic && c.grossMoic !== null ? ((c.grossMoic - simp.grossMoic) / simp.grossMoic) * 100 : null,
      simplifiedExitOwnershipPct: simp?.exitOwnershipPct ?? null,
      capTableExitOwnershipPct: c.exitOwnershipPct,
      simplifiedProceedsUsd: simp?.proceedsUsd ?? null,
      capTableProceedsUsd: c.proceedsUsd,
      simplifiedFollowOnUsd: simp?.followOnUsd ?? null,
      capTableFollowOnUsd: c.followOnUsd,
    };
  });
  return {
    modelable: true,
    reasons: [],
    instrument: inp.instrument,
    entryOwnershipPct: path.entry.ownershipPct,
    scenarios,
    comparison,
    differences: explainDifferences(path, inp, scenarios, comparison, simplified),
    notes: [...state.notes, ...path.notes],
  };
}

function explainDifferences(
  path: ProFormaPath,
  inp: EconomicsInputs,
  scenarios: CapTableScenario[],
  comparison: ModelComparisonRow[],
  simplified: ReturnModel | null,
): string[] {
  const out: string[] = [];
  if (!simplified || !simplified.modelable) {
    out.push("The simplified model could not run — no comparison available.");
    return out;
  }
  const pct = (n: number) => `${n.toFixed(1)}%`;
  const priced = path.steps.filter((s) => s.row.kind === "PRICED");
  const avgRefresh = priced.length ? priced.reduce((a, s) => a + s.row.poolTopUpPctOfPost, 0) / priced.length : 0;
  if (avgRefresh > 0.01)
    out.push(
      `Pool refreshes add on average ${pct(avgRefresh)} of post-money per future round on top of the registry's new-money dilution; the simplified model has no option pool, so it overstates exit ownership.`,
    );
  if (path.entry.row.poolTopUpPctOfPost > 0.01)
    out.push(
      `The entry pool top-up (${pct(path.entry.row.poolTopUpPctOfPost)} of post) sits in the pre-money: it dilutes founders and prior holders, not the new money — our entry ownership is unchanged by it.`,
    );
  if (inp.instrument === "SAFE" || inp.instrument === "CONVERTIBLE_NOTE") {
    const conv = priced[0];
    if (conv)
      out.push(
        `The simplified model holds the ${inp.instrument === "SAFE" ? "SAFE" : "note"} at check ÷ cap (${pct((inp.checkUsd / inp.postMoneyUsd!) * 100)}); the cap-table model converts it in ${conv.row.label} at the lower of the cap price and the discounted round price${inp.instrument === "CONVERTIBLE_NOTE" ? " with accrued interest" : ""} and gives it a shadow series whose preference equals the converted amount.`,
      );
  }
  if (inp.priorRaisedUsd || inp.preRoundCapTable)
    out.push("The cap-table preference stack includes prior preferred; the simplified model counts only this round and future rounds.");
  const base = comparison.find((c) => c.scenario === "BASE");
  if (base && base.simplifiedExitOwnershipPct !== null)
    out.push(
      `BASE exit ownership: ${pct(base.capTableExitOwnershipPct)} in the cap-table model vs ${pct(base.simplifiedExitOwnershipPct)} in the simplified model; gross MOIC ${base.capTableMoic?.toFixed(2) ?? "n/a"}× vs ${base.simplifiedMoic?.toFixed(2) ?? "n/a"}×.`,
    );
  const binding = scenarios.filter((s) => s.preferenceBinding).map((s) => s.scenario);
  if (binding.length) out.push(`Our liquidation preference is binding (worth more than converting) in: ${binding.join(", ")}.`);
  const fo = comparison.find((c) => c.scenario === "BASE");
  if (fo && fo.simplifiedFollowOnUsd !== null && Math.abs(fo.simplifiedFollowOnUsd - fo.capTableFollowOnUsd) > 1)
    out.push(
      `Pro-rata follow-on differs ($${(fo.capTableFollowOnUsd / 1e6).toFixed(2)}M vs $${(fo.simplifiedFollowOnUsd / 1e6).toFixed(2)}M) because the cap-table model measures pro rata on post-refresh / as-converted ownership.`,
    );
  return out;
}
