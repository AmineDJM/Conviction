/**
 * Counterfactual engine: monotonicity of the built-in shocks, custom shocks,
 * breakpoint crossings, purity, speed and robustness.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalDeal } from "@/domain/canonical";
import {
  BUILT_IN_SCENARIO_IDS,
  runCounterfactual,
  summarizeCounterfactual,
  type CounterfactualResult,
} from "@/engine/economics/counterfactuals";
import { metric } from "./fixtures";
import { ctxFor, money, seedSafe, seriesA, seriesA42 } from "./economics.helpers";

const H = ["BASE", "BULL", "OUTLIER"] as const;

function noBurnData(): CanonicalDeal {
  const d = seriesA();
  d.financing = { ...d.financing!, monthlyBurn: null, cashBalance: null };
  d.financingPath = { ...d.financingPath!, plannedMonthlyBurnUsd: null };
  return d;
}
function cacOnly(): CanonicalDeal {
  const d = seriesA();
  d.metrics = [...d.metrics.filter((m) => m.metricKey !== "cac_payback_months"), metric("cac", 30_000)];
  return d;
}
function noUnitEconomics(): CanonicalDeal {
  const d = seriesA();
  d.metrics = d.metrics.filter((m) => !["cac_payback_months", "burn_multiple", "gross_margin"].includes(m.metricKey));
  return d;
}
function nonAi(): CanonicalDeal {
  const d = seriesA();
  d.classification = { ...d.classification, technology: ["NONE_TRADITIONAL"], productType: ["SAAS"] };
  return d;
}
function withPrior(): CanonicalDeal {
  const d = seriesA42();
  d.financing = { ...d.financing!, totalRaisedToDate: money(4_000_000) };
  return d;
}

const FIXTURES: [string, () => CanonicalDeal][] = [
  ["Series A $60M", seriesA],
  ["Series A $42M", seriesA42],
  ["Seed SAFE", () => seedSafe()],
  ["no burn data", noBurnData],
  ["CAC only", cacOnly],
  ["no unit economics", noUnitEconomics],
  ["non-AI", nonAi],
  ["prior preferred", withPrior],
];

const cf = (d: CanonicalDeal, s: Parameters<typeof runCounterfactual>[1]) => runCounterfactual(ctxFor(d), s);

describe("monotonicity of the built-in shocks", () => {
  it.each(FIXTURES)("CAC ×2 never improves CAC payback (%s)", (_n, f) => {
    const r = cf(f(), "CAC_X2");
    if (r.base.cacPaybackMonths === null) expect(r.scenario.cacPaybackMonths).toBeNull();
    else expect(r.scenario.cacPaybackMonths!).toBeGreaterThanOrEqual(r.base.cacPaybackMonths);
  });

  it.each(FIXTURES.flatMap(([n, f]) => H.map((h) => [n, h, f] as const)))("a 12-month delay never improves IRR (%s, %s)", (_n, h, f) => {
    const r = cf(f(), "NEXT_ROUND_DELAY_12M");
    expect(r.scenario.irr[h]!).toBeLessThanOrEqual(r.base.irr[h]! + 1e-12);
  });

  it.each(FIXTURES.flatMap(([n, f]) => H.map((h) => [n, h, f] as const)))("commoditization never raises the exit value (%s, %s)", (_n, h, f) => {
    const r = cf(f(), "COMMODITIZATION");
    expect(r.scenario.exitEquityUsd[h]!).toBeLessThanOrEqual(r.base.exitEquityUsd[h]!);
  });

  it.each(FIXTURES.flatMap(([n, f]) => H.map((h) => [n, h, f] as const)))("doubling the entry price lowers MOIC (%s, %s)", (_n, h, f) => {
    const r = cf(f(), "ENTRY_VALUATION_X2");
    expect(r.scenario.moic[h]!).toBeLessThan(r.base.moic[h]!);
  });

  it.each(FIXTURES)("the incumbent-bundling shock never improves MOIC or growth (%s)", (_n, f) => {
    const r = cf(f(), "INCUMBENT_BUNDLES_FREE");
    for (const h of H) expect(r.scenario.moic[h]!).toBeLessThanOrEqual(r.base.moic[h]!);
    expect(r.scenario.currentGrowthPct!).toBeLessThan(r.base.currentGrowthPct!);
  });
});

describe("shock mechanics", () => {
  it("CAC ×2 raises burn multiple and burn by ΔCAC ÷ ARPA per $ of net new ARR, shortening runway", () => {
    const r = cf(seriesA(), "CAC_X2");
    expect(r.scenario.cacPaybackMonths).toBeCloseTo(r.base.cacPaybackMonths! * 2, 9);
    expect(r.scenario.burnMultiple!).toBeGreaterThan(r.base.burnMultiple!);
    expect(r.scenario.monthlyBurnUsd!).toBeGreaterThan(r.base.monthlyBurnUsd!);
    expect(r.scenario.runwayMonths!).toBeLessThan(r.base.runwayMonths!);
    expect(r.applied.join(" ")).toMatch(/Monthly burn \+/);
  });

  it("CAC ×2 leaves returns untouched (it acts on operations, not on the cap table)", () => {
    const r = cf(seriesA(), "CAC_X2");
    for (const h of H) expect(r.scenario.moic[h]).toBe(r.base.moic[h]);
  });

  it("a delay with a short runway raises a bridge that dilutes a priced investor", () => {
    const r = cf(seriesA(), "NEXT_ROUND_DELAY_12M");
    expect(r.applied.join(" ")).toMatch(/Bridge SAFE/);
    expect(r.scenario.exitOwnershipPct.BASE!).toBeLessThan(r.base.exitOwnershipPct.BASE!);
    expect(r.scenario.financingRisk).toBe("CRITICAL");
  });

  it("without runway data the bridge is sized as a documented share of the round", () => {
    const r = cf(noBurnData(), "NEXT_ROUND_DELAY_12M");
    expect(r.applied.join(" ")).toMatch(/25% of the round/);
  });

  it("commoditization cuts gross margin only on AI COGS-heavy profiles", () => {
    const ai = cf(seriesA(), "COMMODITIZATION");
    const plain = cf(nonAi(), "COMMODITIZATION");
    expect(ai.scenario.cacPaybackMonths!).toBeGreaterThan(ai.base.cacPaybackMonths!);
    expect(plain.scenario.cacPaybackMonths).toBe(plain.base.cacPaybackMonths);
    expect(plain.applied.join(" ")).toMatch(/not an AI COGS-heavy profile/);
  });

  it("a price cut lengthens payback", () => {
    const r = cf(seriesA(), "INCUMBENT_BUNDLES_FREE");
    expect(r.scenario.cacPaybackMonths!).toBeGreaterThan(r.base.cacPaybackMonths!);
  });
});

describe("custom shocks and breakpoint crossings", () => {
  it("an empty custom shock changes nothing", () => {
    const r = cf(seriesA(), { id: "custom", shock: {} });
    expect(r.changes.every((c) => c.direction === "UNCHANGED" || c.direction === "N/A")).toBe(true);
    expect(r.crossedBreakpoints).toEqual([]);
  });

  it("a cheaper entry is BETTER on every headline MOIC", () => {
    const r = cf(seriesA(), { id: "custom", shock: { valuationFactor: 0.5, label: "Half price" } });
    expect(r.label).toBe("Half price");
    for (const h of H) expect(r.changes.find((c) => c.output === `${h} MOIC`)!.direction).toBe("BETTER");
  });

  it("a metric override that drops NRR below 100% crosses the NRR breakpoint", () => {
    const r = cf(seriesA(), { id: "custom", shock: { metricOverrides: { nrr: 92 } } });
    expect(r.crossedBreakpoints.map((c) => c.rowId)).toContain("NRR");
  });

  it("doubling the price crosses the 3× entry-valuation breakpoint of the $60M Series A", () => {
    const r = cf(seriesA(), "ENTRY_VALUATION_X2");
    expect(r.crossedBreakpoints.map((c) => c.rowId)).toContain("ENTRY_VALUATION_3X");
  });

  it("an unknown metric override is reported as ignored", () => {
    const r = cf(seriesA(), { id: "custom", shock: { metricOverrides: { dau: 5 } } });
    expect(r.applied.join(" ")).toMatch(/dau: no deterministic effect/);
  });

  it("burn and milestone overrides flow into the financing map", () => {
    const r = cf(seriesA(), { id: "custom", shock: { metricOverrides: { monthly_net_burn: 300_000, months_to_next_milestone: 12 } } });
    expect(r.scenario.financingRisk).toBe("LOW");
    expect(r.changes.find((c) => c.output === "Financing risk")!.direction).toBe("BETTER");
  });
});

describe("purity, speed, robustness", () => {
  it("does not mutate its inputs and is deterministic", () => {
    const d = seriesA();
    const ctx = ctxFor(d);
    const before = JSON.stringify(ctx.deal);
    const a = runCounterfactual(ctx, "COMMODITIZATION");
    const b = runCounterfactual(ctxFor(seriesA()), "COMMODITIZATION");
    expect(JSON.stringify(ctx.deal)).toBe(before);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is interactive: under 10 ms per call once the base case is known", () => {
    const ctx = ctxFor(seriesA());
    runCounterfactual(ctx, "CAC_X2"); // warm-up (computes and caches the base case)
    const times: number[] = [];
    for (let i = 0; i < 15; i++) {
      const id = BUILT_IN_SCENARIO_IDS[i % BUILT_IN_SCENARIO_IDS.length]!;
      const t0 = performance.now();
      runCounterfactual(ctx, id);
      times.push(performance.now() - t0);
    }
    times.sort((x, y) => x - y);
    expect(times[Math.floor(times.length / 2)]!).toBeLessThan(10);
  });

  it("no valuation: every scenario runs, flagged unmodelable, without throwing", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: null };
    for (const id of BUILT_IN_SCENARIO_IDS) {
      const r: CounterfactualResult = cf(d, id);
      expect(r.base.modelable).toBe(false);
      expect(r.scenario.moic.BASE).toBeNull();
    }
  });

  it("summaries carry a deterministic headline and the worse/better outputs", () => {
    const s = summarizeCounterfactual(cf(seriesA(), "ENTRY_VALUATION_X2"));
    expect(s.headline).toMatch(/^Entry price doubles: BASE MOIC \d+\.\d{2}× → \d+\.\d{2}×/);
    expect(s.worse).toContain("BASE MOIC");
    expect(s.better).not.toContain("BASE MOIC");
  });
});
