/**
 * Pro-forma cap-table returns: conversion math, pool shuffles, pro rata,
 * preferences, seniority, timing/IRR, comparison with the simplified model,
 * robustness and determinism.
 */
import { describe, expect, it } from "vitest";
import { addConvertible, applyPricedRound, emptyCapTable, sharesOf, totalFdShares, type CapTable } from "@/engine/calc/captable";
import { emptyCanonical } from "@/domain/canonical";
import { irr, type CashFlow } from "@/engine/calc/finance";
import {
  asConvertedOwnership,
  buildProFormaPath,
  capConversionShares,
  capTableReturns,
  exitCapTable,
  OUR_HOLDER,
  preferenceStack,
  scenarioEvaluator,
} from "@/engine/economics/captable-returns";
import { stateFromContext, withInputs, type EconomicsState } from "@/engine/economics/inputs";
import { economicsReport } from "@/engine/economics";
import { trajectoryFromState } from "@/engine/economics/trajectory";
import { scenarioOutcome } from "@/engine/economics/sensitivity";
import { ctxFor, fund, money, seedSafe, seriesA, seriesA42, type CtxOptions } from "./economics.helpers";
import type { CanonicalDeal } from "@/domain/canonical";

const baseCt = (): CapTable => {
  const ct = emptyCapTable();
  ct.holdings.push({ holder: "Founders", className: "Common", shares: 9_000_000 }, { holder: "Option Pool", className: "Option Pool", shares: 1_000_000 });
  return ct;
};
const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));
const stateOf = (deal: CanonicalDeal, o: CtxOptions = {}) => stateFromContext(ctxFor(deal, o));
const pathOf = (s: EconomicsState, n = 3) => buildProFormaPath(s.inputs, n)!;

describe("SAFE conversion math (reusing applyPricedRound)", () => {
  it.each([
    [1_000_000, 10_000_000],
    [2_000_000, 20_000_000],
    [500_000, 8_000_000],
    [3_000_000, 15_000_000],
  ])("post-money SAFE $%d at a $%d cap owns exactly amount ÷ cap of the post-conversion capitalization", (amount, cap) => {
    const ct = addConvertible(baseCt(), { holder: "S", kind: "SAFE_POST_MONEY", principal: amount, valuationCap: cap, discountPct: null });
    const r = applyPricedRound(ct, { className: "A", preMoney: cap * 10, investments: [{ holder: "N", amount: 1_000_000 }] });
    const s = r.conversionShares[0]!.shares;
    close(s / (10_000_000 + s), amount / cap, 1e-9);
  });

  it.each([
    [1_000_000, 10_000_000],
    [2_000_000, 20_000_000],
    [500_000, 8_000_000],
    [3_000_000, 15_000_000],
  ])("pre-money SAFE $%d at a $%d cap owns amount ÷ (cap + amount)", (amount, cap) => {
    const ct = addConvertible(baseCt(), { holder: "S", kind: "SAFE_PRE_MONEY", principal: amount, valuationCap: cap, discountPct: null });
    const r = applyPricedRound(ct, { className: "A", preMoney: cap * 10, investments: [{ holder: "N", amount: 1_000_000 }] });
    const s = r.conversionShares[0]!.shares;
    close(s / (10_000_000 + s), amount / (cap + amount), 1e-9);
  });

  it.each([
    ["SAFE_POST_MONEY", 1_000_000, 10_000_000],
    ["SAFE_POST_MONEY", 4_000_000, 25_000_000],
    ["SAFE_PRE_MONEY", 1_000_000, 10_000_000],
    ["CONVERTIBLE_NOTE", 2_000_000, 12_000_000],
  ] as const)("capConversionShares (%s) matches applyPricedRound when the cap binds", (kind, amount, cap) => {
    const ct = addConvertible(baseCt(), { holder: "S", kind, principal: amount, valuationCap: cap, discountPct: null });
    const r = applyPricedRound(ct, { className: "A", preMoney: cap * 10, investments: [{ holder: "N", amount: 1_000_000 }] });
    close(capConversionShares(ct)[0]!, r.conversionShares[0]!.shares, 1e-9);
  });

  it("a discount binds when the discounted round price is below the cap price", () => {
    const ct = addConvertible(baseCt(), { holder: "S", kind: "SAFE_POST_MONEY", principal: 1_000_000, valuationCap: 1e12, discountPct: 20 });
    const r = applyPricedRound(ct, { className: "A", preMoney: 20_000_000, investments: [{ holder: "N", amount: 5_000_000 }] });
    close(r.conversionShares[0]!.conversionPrice, r.pricePerShare * 0.8, 1e-9);
  });

  it("two post-money SAFEs do not dilute each other", () => {
    let ct = addConvertible(baseCt(), { holder: "S1", kind: "SAFE_POST_MONEY", principal: 1_000_000, valuationCap: 10_000_000, discountPct: null });
    ct = addConvertible(ct, { holder: "S2", kind: "SAFE_POST_MONEY", principal: 1_000_000, valuationCap: 10_000_000, discountPct: null });
    close(asConvertedOwnership(ct, "S1"), 0.1);
    close(asConvertedOwnership(ct, "S2"), 0.1);
  });
});

describe("SAFE entry through the pro-forma path", () => {
  const s = stateOf(seedSafe());
  const path = pathOf(s);

  it("entry ownership of a post-money SAFE is check ÷ cap", () => {
    close(path.entry.ownershipPct, (2_000_000 / 15_000_000) * 100);
  });

  it("after conversion (no follow-on) our ownership is check/cap × (1 − new money % − pool top-up %)", () => {
    const a = pathOf(stateOf(seedSafe(), { returnOverrides: { followOn: false } })).steps[0]!.row;
    close(a.ourOwnershipPct, (2 / 15) * (1 - 0.2 - a.poolTopUpPctOfPost / 100) * 100, 1e-9);
  });

  it("the converted SAFE sits in a shadow series whose preference equals the amount invested", () => {
    const ct = path.steps[0]!.ct;
    const ours = ct.holdings.filter((h) => h.holder === OUR_HOLDER);
    const pref = ours.reduce((a, h) => {
      const c = ct.classes.find((x) => x.name === h.className)!;
      return a + h.shares * c.originalIssuePrice * c.liquidationPrefMultiple;
    }, 0);
    close(pref, 2_000_000 + path.steps[0]!.ourCashUsd, 1e-9);
  });

  it("a note accrues simple interest until it converts", () => {
    const d = seedSafe();
    d.financing = { ...d.financing!, instrument: "CONVERTIBLE_NOTE" };
    const p = pathOf(stateOf(d));
    close(p.steps[0]!.row.convertedUsd, 3_000_000 * (1 + 0.06 * (20 / 12)), 1e-9);
  });

  it("an unconverted SAFE at exit takes the greater of 1x and its as-converted value", () => {
    const st = withInputs(s, { roundsBeforeExit: { FAILURE: 0, LOW: 0, BASE: 0, BULL: 0, OUTLIER: 0 } });
    const ev = scenarioEvaluator(pathOf(st), st.inputs, 0, 5);
    close(ev.proceedsAt(5_000_000), 2_000_000, 1e-9);
    close(ev.proceedsAt(1_500_000_000), (2 / 15) * 1_500_000_000, 1e-9);
  });

  it("exitCapTable leaves a table without convertibles unchanged", () => {
    const ct = baseCt();
    expect(exitCapTable(ct)).toBe(ct);
  });
});

describe("option pool shuffle at entry", () => {
  it.each([10, 15, 20])("a %d%% post-money pool target is carved from the pre-money; our ownership stays check ÷ post", (t) => {
    const p = pathOf(stateOf(seriesA(), { assumptions: { entryPoolTargetPostPct: t } }));
    close(p.entry.ownershipPct, (2 / 60) * 100);
    const ct = p.entry.ct;
    const pool = ct.holdings.filter((h) => h.className === "Option Pool").reduce((a, h) => a + h.shares, 0);
    close((pool / totalFdShares(ct)) * 100, t, 1e-9);
  });

  it("a target below the diluted existing pool triggers no top-up", () => {
    const p = pathOf(stateOf(seriesA(), { assumptions: { entryPoolTargetPostPct: 5 } }));
    expect(p.entry.row.poolTopUpPctOfPost).toBe(0);
  });

  it("a larger pool target dilutes founders more (shuffle)", () => {
    const founders = (t: number) => {
      const ct = pathOf(stateOf(seriesA(), { assumptions: { entryPoolTargetPostPct: t } })).entry.ct;
      return sharesOf(ct, "Founders & employees") / totalFdShares(ct);
    };
    expect(founders(15)).toBeLessThan(founders(10));
    expect(founders(20)).toBeLessThan(founders(15));
  });

  it.each([2, 5, 8])("a stated top-up of %d%% of post-money is reproduced exactly", (inc) => {
    const d = seriesA();
    d.financing = { ...d.financing!, optionPoolIncreasePct: inc };
    const p = pathOf(stateOf(d));
    close(p.entry.row.poolTopUpPctOfPost, inc, 1e-6);
    close(p.entry.ownershipPct, (2 / 60) * 100);
  });
});

describe("pro-rata follow-on", () => {
  it("with no pool refresh, pro rata in the next round keeps our ownership exactly", () => {
    const p = pathOf(stateOf(seriesA(), { assumptions: { futurePoolTargetPostPct: 0 } }));
    close(p.steps[0]!.row.ourOwnershipPct, p.entry.ownershipPct, 1e-9);
    close(p.steps[0]!.ourCashUsd, (2 / 60) * 22_500_000, 1e-9);
  });

  it("without follow-on we are diluted by the round's new money", () => {
    const p = pathOf(stateOf(seriesA(), { assumptions: { futurePoolTargetPostPct: 0 }, returnOverrides: { followOn: false } }));
    close(p.steps[0]!.row.ourOwnershipPct, (2 / 60) * 0.85 * 100, 1e-9);
  });

  it("follow-on is capped by reserves", () => {
    const small = { ...fund, reserveRatio: 0.1 };
    const p = pathOf(stateOf(seriesA(), { fund: small, assumptions: { futurePoolTargetPostPct: 0 } }));
    close(p.steps[0]!.ourCashUsd, 200_000, 1e-9);
    close(p.steps[0]!.row.ourOwnershipPct, ((2 / 60) * 0.85 + 200_000 / 150_000_000) * 100, 1e-9);
  });

  it("pool refreshes still dilute a pro-rata investor", () => {
    const p = pathOf(stateOf(seriesA()));
    expect(p.steps[0]!.row.ourOwnershipPct).toBeLessThan(p.entry.ownershipPct);
  });
});

describe("preference stack and waterfall", () => {
  const s = stateOf(seriesA());
  const p = pathOf(s);

  it("the preference stack is built from actual invested amounts per series", () => {
    close(preferenceStack(p.entry.ct), 12_000_000);
    close(preferenceStack(p.steps[0]!.ct), 12_000_000 + 22_500_000);
  });

  it("prior preferred (total raised to date) joins the stack at its invested amount", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, totalRaisedToDate: money(5_000_000) };
    close(preferenceStack(pathOf(stateOf(d)).entry.ct), 17_000_000);
  });

  it("the LOW case (exit = 1× post) is protected by our preference: MOIC exactly 1× and binding", () => {
    const low = capTableReturns(s, null).scenarios.find((x) => x.scenario === "LOW")!;
    expect(low.preferenceBinding).toBe(true);
    close(low.grossMoic!, 1, 1e-9);
  });

  it.each([5e6, 10e6, 20e6, 34.5e6])("below the stack, a $%d exit is shared pari passu by preference", (E) => {
    const ev = scenarioEvaluator(p, s.inputs, 1, 5);
    close(ev.proceedsAt(E), (E * 2_750_000) / 34_500_000, 1e-9);
  });

  it.each([30e6, 100e6, 300e6, 3e9])("participating preferred never receives less than non-participating ($%d exit)", (E) => {
    const d = seriesA();
    d.financing = { ...d.financing!, terms: { ...d.financing!.terms, participating: true } };
    const sp = stateOf(d);
    const evP = scenarioEvaluator(pathOf(sp), sp.inputs, 2, 7);
    const evN = scenarioEvaluator(p, s.inputs, 2, 7);
    expect(evP.proceedsAt(E)).toBeGreaterThanOrEqual(evN.proceedsAt(E) - 1e-6);
  });

  it("participating preferred double-dips at a mid-size exit", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, terms: { ...d.financing!.terms, participating: true } };
    const sp = stateOf(d);
    expect(scenarioEvaluator(pathOf(sp), sp.inputs, 2, 7).proceedsAt(300e6)).toBeGreaterThan(scenarioEvaluator(p, s.inputs, 2, 7).proceedsAt(300e6) + 1);
  });

  it.each([10e6, 50e6, 80e6, 1e9])("junior (stacked seniority) proceeds never exceed pari passu ($%d exit)", (E) => {
    const st = stateOf(seriesA(), { assumptions: { futureSeniority: "STACKED" } });
    const evS = scenarioEvaluator(pathOf(st), st.inputs, 2, 7);
    const evP = scenarioEvaluator(p, s.inputs, 2, 7);
    expect(evS.proceedsAt(E)).toBeLessThanOrEqual(evP.proceedsAt(E) + 1e-6);
  });

  it("with stacked seniority a $30M exit is absorbed by the senior Series C", () => {
    const st = stateOf(seriesA(), { assumptions: { futureSeniority: "STACKED" } });
    expect(scenarioEvaluator(pathOf(st), st.inputs, 2, 7).proceedsAt(30e6)).toBe(0);
  });
});

describe("timing and IRR", () => {
  it.each(["BASE", "BULL", "OUTLIER"] as const)("without follow-on, IRR = MOIC^(1/years) − 1 (%s)", (sc) => {
    const r = capTableReturns(stateOf(seriesA(), { returnOverrides: { followOn: false } }), null).scenarios.find((x) => x.scenario === sc)!;
    close(r.grossIrr!, Math.pow(r.grossMoic!, 1 / r.years) - 1, 1e-6);
  });

  it("follow-on is dated at the next round and the IRR zeroes the NPV of all flows", () => {
    const r = capTableReturns(stateOf(seriesA()), null).scenarios.find((x) => x.scenario === "BULL")!;
    const fo = r.cashFlows.find((f) => f.amount < 0 && f.t > 0)!;
    close(fo.t, 20 / 12);
    const npv = r.cashFlows.reduce((a, f: CashFlow) => a + f.amount / Math.pow(1 + r.grossIrr!, f.t), 0);
    expect(Math.abs(npv)).toBeLessThan(1);
    close(irr(r.cashFlows)!, r.grossIrr!);
  });

  it("a later exit at the same proceeds has a lower IRR", () => {
    const s = stateOf(seriesA());
    const later = withInputs(s, { exits: { ...s.inputs.exits, BASE: { ...s.inputs.exits.BASE, years: s.inputs.exits.BASE.years + 2 } } });
    const a = capTableReturns(s, null).scenarios.find((x) => x.scenario === "BASE")!;
    const b = capTableReturns(later, null).scenarios.find((x) => x.scenario === "BASE")!;
    expect(b.grossIrr!).toBeLessThan(a.grossIrr!);
  });
});

describe("comparison with the simplified model", () => {
  it.each(["LOW", "BASE", "BULL", "OUTLIER"] as const)("with no pool refresh and no prior preferred, both models agree (%s)", (sc) => {
    const ctx = ctxFor(seriesA(), { assumptions: { futurePoolTargetPostPct: 0 } });
    const r = capTableReturns(stateFromContext(ctx), ctx.returns);
    const row = r.comparison.find((c) => c.scenario === sc)!;
    close(row.capTableMoic!, row.simplifiedMoic!, 1e-9);
    close(row.capTableExitOwnershipPct, row.simplifiedExitOwnershipPct!, 1e-9);
  });

  it("pool refreshes make the cap-table model more conservative and the difference is explained", () => {
    const ctx = ctxFor(seriesA());
    const r = capTableReturns(stateFromContext(ctx), ctx.returns);
    const base = r.comparison.find((c) => c.scenario === "BASE")!;
    expect(base.capTableMoic!).toBeLessThan(base.simplifiedMoic!);
    expect(r.differences.some((d) => d.includes("Pool refreshes"))).toBe(true);
  });

  it("a SAFE comparison explains the conversion treatment", () => {
    const ctx = ctxFor(seedSafe());
    const r = capTableReturns(stateFromContext(ctx), ctx.returns);
    expect(r.differences.some((d) => d.includes("SAFE"))).toBe(true);
  });
});

describe("entry price monotonicity", () => {
  const cases = [
    ["Series A $60M", seriesA],
    ["Series A $42M", seriesA42],
    ["Seed SAFE", () => seedSafe()],
  ] as const;
  it.each(cases.flatMap(([n, f]) => (["BASE", "BULL", "OUTLIER"] as const).map((sc) => [n, sc, f] as const)))(
    "doubling the entry valuation always lowers MOIC (%s, %s)",
    (_n, sc, f) => {
      const s = stateOf(f());
      const a = scenarioOutcome(s.inputs, sc)!;
      const b = scenarioOutcome({ ...s.inputs, postMoneyUsd: s.inputs.postMoneyUsd! * 2 }, sc)!;
      expect(b.moic).toBeLessThan(a.moic);
    },
  );
  it.each(cases.map(([n, f]) => [n, f] as const))("doubling the entry valuation never raises LOW-case MOIC (%s)", (_n, f) => {
    const s = stateOf(f());
    const a = scenarioOutcome(s.inputs, "LOW")!;
    const b = scenarioOutcome({ ...s.inputs, postMoneyUsd: s.inputs.postMoneyUsd! * 2 }, "LOW")!;
    expect(b.moic).toBeLessThanOrEqual(a.moic + 1e-12);
  });
  it.each(cases.flatMap(([n, f]) => [
    [n, "20× capital", f, { targetMultiple: 20 }] as const,
    [n, "fund target", f, { targetContributionUsd: fund.targetDealReturnUsd }] as const,
  ]))("doubling the entry valuation never lowers the required trajectory (%s, %s)", (_n, _t, f, opts) => {
    const s = stateOf(f());
    const a = trajectoryFromState(s, opts);
    const b = trajectoryFromState(s, { ...opts, entryPostMoneyUsd: s.inputs.postMoneyUsd! * 2 });
    expect(b.requiredExitEquityUsd!).toBeGreaterThanOrEqual(a.requiredExitEquityUsd! * (1 - 1e-9));
  });
});

describe("provided cap table, robustness and determinism", () => {
  it("uses a provided pre-round cap table as is", () => {
    const ct = baseCt();
    ct.classes.push({ name: "Seed", type: "PREFERRED", originalIssuePrice: 1, liquidationPrefMultiple: 1, participating: false, seniority: 0 });
    ct.holdings.push({ holder: "Seed fund", className: "Seed", shares: 2_000_000 });
    const r = capTableReturns(stateOf(seriesA(), { capTable: ct }), null);
    expect(r.notes).toContain("Pre-round cap table provided — used as is.");
    close(r.scenarios[0]!.rounds[0]!.preferenceStackUsd, 12_000_000 + 2_000_000);
  });

  it("no valuation → not modelable, with a reason, and no throw", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: null };
    const r = capTableReturns(stateOf(d), null);
    expect(r.modelable).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/valuation unknown/i);
  });

  it("an empty canonical deal yields a full report without throwing", () => {
    const rep = economicsReport(ctxFor(emptyCanonical("FAST_SCREEN")));
    expect(rep.modelable).toBe(false);
    expect(rep.capTableReturns.modelable).toBe(false);
    expect(rep.trajectory.fundTarget.modelable).toBe(false);
    expect(Array.isArray(rep.sensitivity.rows)).toBe(true);
    expect(rep.counterfactuals).toHaveLength(5);
  });

  it("inconsistent terms (post-money below the round) are unmodelable, not NaN", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: money(10_000_000) };
    const r = capTableReturns(stateOf(d), null);
    expect(r.modelable).toBe(false);
  });

  it("the report is deterministic and JSON-safe", () => {
    const a = JSON.stringify(economicsReport(ctxFor(seriesA())));
    const b = JSON.stringify(economicsReport(ctxFor(seriesA())));
    expect(a).toBe(b);
    expect(a).not.toMatch(/NaN|Infinity/);
  });

  it("every scenario reports invested, ownership path, proceeds, MOIC, IRR and a round table", () => {
    const r = capTableReturns(stateOf(seriesA()), null);
    for (const sc of r.scenarios) {
      expect(sc.investedUsd).toBe(sc.initialUsd + sc.followOnUsd);
      expect(sc.ownershipPath.length).toBe(sc.rounds.length);
      expect(sc.rounds[0]!.kind).toBe("ENTRY");
      expect(sc.grossMoic).not.toBeNull();
    }
  });
});
