/**
 * Backward operating trajectory: "what minimal operating trajectory must exist
 * for this deal to return N× our capital (or $Y to the fund)?"
 */
import { describe, expect, it } from "vitest";
import { buildProFormaPath, scenarioEvaluator } from "@/engine/economics/captable-returns";
import { stateFromContext } from "@/engine/economics/inputs";
import {
  decayedGrowthFactor,
  requiredStartingGrowth,
  requiredTrajectory,
  samPlausibility,
  trajectoryFromState,
  worstPlausibility,
} from "@/engine/economics/trajectory";
import { metric } from "./fixtures";
import { ctxFor, fund, reg, seriesA, seriesA42 } from "./economics.helpers";

const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe("« À $42M post, quelle trajectoire opérationnelle minimale doit exister pour que ce deal retourne 20x notre capital ? »", () => {
  // Series A SaaS: $3.84M ARR growing 210%, 118% NRR, 92 customers; $8M raised at $42M post; our $2M check + pro-rata reserves.
  const ctx = ctxFor(seriesA42());
  const t = requiredTrajectory(ctx, { entryPostMoneyUsd: 42_000_000, targetMultiple: 20 });

  it("frames the question at $42M post and 20× our capital", () => {
    expect(t.modelable).toBe(true);
    expect(t.question).toContain("$42.0M post");
    expect(t.question).toContain("20× our capital");
    expect(t.entryPostMoneyUsd).toBe(42_000_000);
  });

  it("targets 20× our total invested capital (initial + pro-rata follow-on)", () => {
    expect(t.checkUsd).toBe(2_000_000);
    expect(t.followOnUsd).toBeGreaterThan(0);
    close(t.target.requiredProceedsUsd!, 20 * (t.checkUsd + t.followOnUsd));
  });

  it("solves the exit equity on the cap-table model so that OUR waterfall proceeds equal the target", () => {
    const s = stateFromContext(ctx);
    const path = buildProFormaPath(s.inputs, 3)!;
    const ev = scenarioEvaluator(path, s.inputs, 3, t.yearsToExit);
    close(ev.proceedsAt(t.requiredExitEquityUsd!), t.target.requiredProceedsUsd!, 1e-6);
    expect(ev.proceedsAt(t.requiredExitEquityUsd! * 0.995)).toBeLessThan(t.target.requiredProceedsUsd!);
  });

  it("accounts for the full dilution path (3 rounds + pool refreshes) before the exit", () => {
    expect(t.roundsBeforeExit).toBe(3);
    const entry = (2 / 42) * 100;
    expect(t.exitOwnershipPct!).toBeLessThan(entry);
    close(t.requiredExitEquityUsd!, t.naiveExitEquityUsd!, 1e-6); // at 20× everyone converts: preferences do not bind
  });

  it("derives the required revenue at every exit multiple and the CAGR from today's ARR", () => {
    expect(t.byMultiple.map((b) => b.revenueMultiple)).toEqual(reg.returns.backwardsRevenueMultiples);
    for (const b of t.byMultiple) {
      close(b.requiredRevenueUsd, t.requiredExitEquityUsd! / b.revenueMultiple);
      close(b.requiredCagrPct!, (Math.pow(b.requiredRevenueUsd / 3_840_000, 1 / t.yearsToExit) - 1) * 100);
    }
    expect(t.current.revenueSource).toBe("ARR");
  });

  it("builds a year-by-year minimum ARR path from today's ARR to the requirement", () => {
    const ref = t.byMultiple.find((b) => b.revenueMultiple === t.referenceMultiple)!;
    expect(t.path[0]!.year).toBe(0);
    close(t.path[0]!.minRevenueUsd, 3_840_000);
    close(t.path[t.path.length - 1]!.minRevenueUsd, ref.requiredRevenueUsd, 1e-9);
    for (let i = 1; i < t.path.length; i++) expect(t.path[i]!.minRevenueUsd).toBeGreaterThan(t.path[i - 1]!.minRevenueUsd);
  });

  it("translates the path into customers at ARPA and new logos per year net of 118% NRR", () => {
    expect(t.path[0]!.customers).toBeGreaterThanOrEqual(92);
    expect(t.path[0]!.customers).toBeLessThanOrEqual(93);
    const y1 = t.path[1]!;
    const arpa = t.current.arpaUsd!;
    expect(y1.newLogos).toBe(Math.max(0, Math.ceil((y1.minRevenueUsd - 3_840_000 * 1.18) / arpa)));
    expect(y1.netNewCustomers).toBe(y1.customers! - t.path[0]!.customers!);
  });

  it("compares with the growth-persistence heuristic (MODEL_ASSUMPTION) and the reconstructed SAM", () => {
    const g = t.growthPersistence;
    expect(g.label).toBe("MODEL_ASSUMPTION");
    const ref = t.byMultiple.find((b) => b.revenueMultiple === t.referenceMultiple)!;
    close(decayedGrowthFactor(g.requiredStartingGrowthPct! / 100, 0.25, t.yearsToExit), ref.requiredRevenueUsd / 3_840_000, 1e-9);
    expect(g.requiredStartingGrowthRangePct[0]!).toBeLessThan(g.requiredStartingGrowthRangePct[1]!);
    close(t.samShare.sharePct!, (ref.requiredRevenueUsd / 5_000_000_000) * 100);
    expect(t.plausibility).toBe(worstPlausibility(t.samShare.plausibility, g.plausibility));
  });

  it("answers in deterministic sentences with a conventional label", () => {
    expect(t.summary.length).toBeGreaterThanOrEqual(4);
    expect(t.summary.join(" ")).toMatch(/Overall trajectory: (PLAUSIBLE|DEMANDING|HEROIC|IMPLAUSIBLE)/);
    expect(JSON.stringify(t)).toBe(JSON.stringify(requiredTrajectory(ctx, { entryPostMoneyUsd: 42_000_000, targetMultiple: 20 })));
  });

  it("is harder at $60M than at $42M", () => {
    const t60 = requiredTrajectory(ctx, { entryPostMoneyUsd: 60_000_000, targetMultiple: 20 });
    expect(t60.requiredExitEquityUsd!).toBeGreaterThan(t.requiredExitEquityUsd!);
    expect(t60.byMultiple[0]!.requiredCagrPct!).toBeGreaterThan(t.byMultiple[0]!.requiredCagrPct!);
  });
});

describe("trajectory targets and inputs", () => {
  const ctx = ctxFor(seriesA());

  it("defaults to the fund's target deal contribution", () => {
    const t = requiredTrajectory(ctx);
    expect(t.target.kind).toBe("CONTRIBUTION");
    expect(t.target.requiredProceedsUsd).toBe(fund.targetDealReturnUsd);
  });

  it.each([5, 10, 20, 50])("required revenue rises with the target multiple (%d×)", (m) => {
    const a = requiredTrajectory(ctx, { targetMultiple: m });
    const b = requiredTrajectory(ctx, { targetMultiple: m * 2 });
    expect(b.byMultiple[0]!.requiredRevenueUsd).toBeGreaterThan(a.byMultiple[0]!.requiredRevenueUsd);
  });

  it.each([5, 7, 10])("more years to exit lowers the required CAGR (%d years)", (y) => {
    const a = requiredTrajectory(ctx, { targetMultiple: 20, yearsToExit: y });
    const b = requiredTrajectory(ctx, { targetMultiple: 20, yearsToExit: y + 2 });
    expect(b.byMultiple[1]!.requiredCagrPct!).toBeLessThan(a.byMultiple[1]!.requiredCagrPct!);
  });

  it("a larger check without follow-on still needs the same exit value for the same multiple", () => {
    const a = requiredTrajectory(ctx, { targetMultiple: 10, followOn: false });
    const b = requiredTrajectory(ctx, { targetMultiple: 10, followOn: false, checkUsd: 4_000_000 });
    close(a.requiredExitEquityUsd!, b.requiredExitEquityUsd!, 1e-6);
  });

  it("uses user-supplied revenue multiples", () => {
    const t = requiredTrajectory(ctx, { targetMultiple: 20, revenueMultiples: [6, 15] });
    expect(t.byMultiple.map((b) => [b.revenueMultiple, b.source])).toEqual([
      [6, "USER"],
      [15, "USER"],
    ]);
    // Lower middle on an even count: the conservative reference, as in the backwards analysis.
    expect(t.referenceMultiple).toBe(6);
  });

  it("adds the deal's own exit multiples next to the registry's", () => {
    const d = seriesA();
    d.exitAssumptions = [{ scenario: "BULL", exitRevenueUsd: 100_000_000, revenueMultiple: 10, yearsToExit: 8, rationale: "comps" }];
    const t = requiredTrajectory(ctxFor(d), { targetMultiple: 20 });
    expect(t.byMultiple.find((b) => b.revenueMultiple === 10)?.source).toBe("DEAL");
  });

  it.each([
    ["revenue_ttm", [metric("revenue_ttm", 2_000_000)], 2_000_000, "Revenue (TTM)"],
    ["mrr", [metric("mrr", 100_000)], 1_200_000, "MRR × 12"],
    ["gmv × take rate", [metric("gmv", 50_000_000), metric("take_rate", 10, { unit: "PERCENT" })], 5_000_000, "GMV × take rate"],
  ] as const)("reads current revenue from %s when ARR is absent", (_n, metrics, rev, src) => {
    const d = seriesA();
    d.metrics = [...d.metrics.filter((m) => m.metricKey !== "arr"), ...metrics];
    const t = requiredTrajectory(ctxFor(d), { targetMultiple: 20 });
    close(t.current.revenueUsd!, rev);
    expect(t.current.revenueSource).toBe(src);
  });

  it("uses ACV as ARPA when reported", () => {
    const d = seriesA();
    d.metrics = [...d.metrics, metric("acv", 60_000)];
    const t = requiredTrajectory(ctxFor(d), { targetMultiple: 20 });
    expect(t.current.arpaUsd).toBe(60_000);
    expect(t.byMultiple[0]!.requiredCustomers).toBe(Math.ceil(t.byMultiple[0]!.requiredRevenueUsd / 60_000));
  });

  it("pre-revenue: no CAGR, no path, no throw; plausibility falls back to the SAM test", () => {
    const d = seriesA();
    d.metrics = d.metrics.filter((m) => m.metricKey !== "arr");
    const t = requiredTrajectory(ctxFor(d), { targetMultiple: 20 });
    expect(t.modelable).toBe(true);
    expect(t.byMultiple[0]!.requiredCagrPct).toBeNull();
    expect(t.path).toEqual([]);
    expect(t.growthPersistence.plausibility).toBe("UNKNOWN");
    expect(t.plausibility).toBe(t.samShare.plausibility);
  });

  it("no valuation: not modelable, explained, no throw", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: null };
    const t = requiredTrajectory(ctxFor(d), { targetMultiple: 20 });
    expect(t.modelable).toBe(false);
    expect(t.summary.join(" ")).toMatch(/valuation unknown/i);
  });

  it("a user price override makes a deal without valuation modelable", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: null };
    expect(requiredTrajectory(ctxFor(d), { targetMultiple: 20, entryPostMoneyUsd: 42_000_000 }).modelable).toBe(true);
  });
});

describe("trajectory arithmetic", () => {
  it.each([
    [0.5, 0.25, 5],
    [1.2, 0.2, 7],
    [2, 0.3, 6.5],
    [0.1, 0.25, 3],
  ])("requiredStartingGrowth inverts decayedGrowthFactor (g0=%d, d=%d, %d years)", (g0, d, y) => {
    close(requiredStartingGrowth(decayedGrowthFactor(g0, d, y), d, y)!, g0, 1e-7);
  });

  it("with no decay the growth factor is plain compounding", () => {
    close(decayedGrowthFactor(0.5, 0, 4), Math.pow(1.5, 4));
  });

  it.each([
    [5, "PLAUSIBLE"],
    [10, "PLAUSIBLE"],
    [20, "DEMANDING"],
    [45, "HEROIC"],
    [80, "IMPLAUSIBLE"],
    [null, "UNKNOWN"],
  ] as const)("SAM share %s%% is %s with the registry thresholds", (share, label) => {
    expect(samPlausibility(share, reg.returns.samSharePlausibility)).toBe(label);
  });

  it("worstPlausibility ignores UNKNOWN and keeps the worst label", () => {
    expect(worstPlausibility("PLAUSIBLE", "UNKNOWN")).toBe("PLAUSIBLE");
    expect(worstPlausibility("DEMANDING", "HEROIC")).toBe("HEROIC");
    expect(worstPlausibility("UNKNOWN", "UNKNOWN")).toBe("UNKNOWN");
  });

  it("the growth test labels a requirement above current growth as harder", () => {
    const s = stateFromContext(ctxFor(seriesA()));
    const easy = trajectoryFromState({ ...s, op: { ...s.op, growthPct: 400 } }, { targetMultiple: 20 });
    const hard = trajectoryFromState({ ...s, op: { ...s.op, growthPct: 40 } }, { targetMultiple: 20 });
    expect(["PLAUSIBLE", "DEMANDING"]).toContain(easy.growthPersistence.plausibility);
    expect(["HEROIC", "IMPLAUSIBLE"]).toContain(hard.growthPersistence.plausibility);
  });
});
