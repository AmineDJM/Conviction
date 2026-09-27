/**
 * Decision sensitivity map: exact breakpoints (bisection over the
 * deterministic model), margins, ordering, model-driver merge, solvers.
 */
import { describe, expect, it } from "vitest";
import { cacPaybackMonths } from "@/engine/calc/finance";
import { financingMap } from "@/engine/financing";
import { emptyCanonical } from "@/domain/canonical";
import { stateFromContext } from "@/engine/economics/inputs";
import { marginPct, scenarioOutcome, sensitivityMap, type SensitivityRow } from "@/engine/economics/sensitivity";
import { trajectoryFromState } from "@/engine/economics/trajectory";
import { bisect, solveIncreasing, solveMonotone } from "@/engine/economics/solve";
import { ctxFor, fund, seedSafe, seriesA, withExits } from "./economics.helpers";
import type { CanonicalDeal } from "@/domain/canonical";

const within = (a: number, b: number, rel: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThanOrEqual(rel);
function mapFor(deal: CanonicalDeal, f = fund) {
  const s = stateFromContext(ctxFor(deal, { fund: f }));
  const t = trajectoryFromState(s, { targetContributionUsd: f.targetDealReturnUsd });
  return { s, t, m: sensitivityMap(s, t) };
}
const rowOf = (rows: SensitivityRow[], id: string) => rows.find((r) => r.id === id)!;

describe("entry valuation breakpoints", () => {
  const fund25 = { ...fund, targetFundMultiple: 2.5 };
  const { s, m } = mapFor(seriesA(), fund25);

  it("computes one breakpoint per target (fund target, 3×, 10×)", () => {
    expect(m.rows.filter((r) => r.id.startsWith("ENTRY_VALUATION_")).map((r) => r.id).sort()).toEqual(["ENTRY_VALUATION_10X", "ENTRY_VALUATION_2.5X", "ENTRY_VALUATION_3X"]);
  });

  it.each([2.5, 3, 10])("at the %d× breakpoint the BASE MOIC equals the target within 0.5%%", (target) => {
    const r = rowOf(m.rows, `ENTRY_VALUATION_${target}X`);
    const moic = scenarioOutcome({ ...s.inputs, postMoneyUsd: r.breaksAt as number }, "BASE")!.moic;
    within(moic, target, 0.005);
  });

  it.each([2.5, 3, 10])("the %d× breakpoint separates passing and failing prices", (target) => {
    const p = rowOf(m.rows, `ENTRY_VALUATION_${target}X`).breaksAt as number;
    expect(scenarioOutcome({ ...s.inputs, postMoneyUsd: p * 0.99 }, "BASE")!.moic).toBeGreaterThan(target);
    expect(scenarioOutcome({ ...s.inputs, postMoneyUsd: p * 1.01 }, "BASE")!.moic).toBeLessThan(target);
  });

  it("a target already missed at today's price shows a negative margin and is flagged broken", () => {
    const r = rowOf(m.rows, "ENTRY_VALUATION_10X");
    expect(r.margin!).toBeLessThan(0);
    expect(r.broken).toBe(true);
  });

  it("a SAFE is labelled by its valuation cap", () => {
    expect(mapFor(seedSafe()).m.rows.some((r) => r.variable.startsWith("Entry valuation cap"))).toBe(true);
  });
});

describe("other computed breakpoints", () => {
  const { s, t, m } = mapFor(seriesA());

  it("dilution per round: at the breakpoint the BASE MOIC equals the fund target within 0.5%", () => {
    const r = rowOf(m.rows, "DILUTION_PER_ROUND");
    const d = r.breaksAt as number;
    const moic = scenarioOutcome({ ...s.inputs, futureRounds: s.inputs.futureRounds.map((x) => ({ ...x, dilutionPct: d })) }, "BASE")!.moic;
    within(moic, fund.targetFundMultiple, 0.005);
    expect(r.current).toBe((15 + 12) / 2);
  });

  it("base exit value: MOIC ≥ 1× just above the breakpoint and < 1× just below", () => {
    const r = rowOf(m.rows, "BASE_EXIT");
    expect(r.unit).toBe("USD");
    const E = r.breaksAt as number;
    const at = (e: number) => scenarioOutcome({ ...s.inputs, exits: { ...s.inputs.exits, BASE: { ...s.inputs.exits.BASE, exitEquityUsd: e } } }, "BASE")!.moic;
    expect(at(E * 1.005)).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(at(E * 0.995)).toBeLessThan(1);
  });

  it("base exit is expressed as a revenue multiple when the deal gives one", () => {
    const d = withExits(seriesA(), [
      { scenario: "BASE", rev: 30_000_000, mult: 8, years: 7 },
      { scenario: "BULL", rev: 100_000_000, mult: 10, years: 8 },
      { scenario: "OUTLIER", rev: 300_000_000, mult: 12, years: 9 },
    ]);
    const r = rowOf(mapFor(d).m.rows, "BASE_EXIT");
    expect(r.unit).toBe("MULTIPLE");
    expect(r.current).toBe(8);
    expect(r.breaksAt as number).toBeLessThan(8);
  });

  it("outlier exit ownership: breakpoint = target contribution ÷ outlier exit", () => {
    const r = rowOf(m.rows, "OUTLIER_EXIT_OWNERSHIP");
    within(r.breaksAt as number, (fund.targetDealReturnUsd / s.inputs.exits.OUTLIER.exitEquityUsd) * 100, 1e-12);
    within(r.current as number, scenarioOutcome(s.inputs, "OUTLIER")!.exitOwnership * 100, 1e-12);
  });

  it.each([
    ["SAM_HEROIC", 30],
    ["SAM_IMPLAUSIBLE", 60],
  ])("%s: at the breakpoint the required revenue is exactly %d%% of SAM", (id, share) => {
    const r = rowOf(m.rows, id);
    const R = t.requiredExitEquityUsd! / t.referenceMultiple;
    within((R / (r.breaksAt as number)) * 100, share, 1e-12);
    expect(r.direction).toBe("BREAKS_BELOW");
  });

  it("monthly burn: at the breakpoint the financing buffer is zero", () => {
    const r = rowOf(m.rows, "MONTHLY_BURN");
    const d = seriesA();
    d.financingPath = { ...d.financingPath!, plannedMonthlyBurnUsd: r.breaksAt as number };
    expect(Math.abs(financingMap(d, s.registry).bufferMonths!)).toBeLessThan(1e-9);
  });

  it("milestone timing: at the breakpoint the financing buffer is zero", () => {
    const r = rowOf(m.rows, "MILESTONE_TIMING");
    const d = seriesA();
    d.financingPath = { ...d.financingPath!, milestoneMonths: r.breaksAt as number };
    expect(Math.abs(financingMap(d, s.registry).bufferMonths!)).toBeLessThan(1e-9);
  });

  it("CAC: at the breakpoint the gross-margin-adjusted payback is exactly 36 months", () => {
    const r = rowOf(m.rows, "CAC");
    within(cacPaybackMonths(r.breaksAt as number, s.op.arpaUsd!, s.op.grossMarginPct!)!, 36, 1e-12);
  });

  it("CAC falls back to the payback row when CAC cannot be derived", () => {
    const d = seriesA();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "paying_customers");
    const r = rowOf(mapFor(d).m.rows, "CAC");
    expect(r.unit).toBe("MONTHS");
    expect(r.current).toBe(14);
    expect(r.breaksAt).toBe(36);
  });

  it("NRR: current vs the 100% threshold", () => {
    const r = rowOf(m.rows, "NRR");
    expect([r.current, r.breaksAt]).toEqual([118, 100]);
    within(r.margin!, ((118 - 100) / 118) * 100, 1e-12);
  });
});

describe("ordering, margins and model drivers", () => {
  it("rows are sorted by margin — the most fragile first, uncomputable last", () => {
    const { m } = mapFor(seriesA());
    const margins = m.rows.map((r) => r.margin);
    const firstNull = margins.indexOf(null);
    const numeric = (firstNull === -1 ? margins : margins.slice(0, firstNull)) as number[];
    for (let i = 1; i < numeric.length; i++) expect(numeric[i]!).toBeGreaterThanOrEqual(numeric[i - 1]!);
    if (firstNull !== -1) expect(margins.slice(firstNull).every((x) => x === null)).toBe(true);
    expect(m.verifyFirst.length).toBe(3);
    expect(m.verifyFirst[0]).toContain(m.rows[0]!.variable);
  });

  it.each([
    [100, 110, "BREAKS_ABOVE", 10],
    [100, 90, "BREAKS_BELOW", 10],
    [100, 90, "BREAKS_ABOVE", -10],
    [100, 125, "BREAKS_BELOW", -25],
  ] as const)("marginPct(%d → %d, %s) = %d%%", (cur, br, dir, exp) => {
    expect(marginPct(cur, br, dir)).toBeCloseTo(exp, 12);
  });

  it("model-proposed drivers keep their text and attach to the computed row with the same metric", () => {
    const d = seriesA();
    d.sensitivityDrivers = [
      { variable: "Net revenue retention", metricKey: "nrr", currentAssumption: "118% on 45 accounts", breaksAt: "< 100%", why: "expansion story" },
      { variable: "Entry price", metricKey: "post_money", currentAssumption: "$60M", breaksAt: "> $80M", why: "price discipline" },
      { variable: "Pilot → production conversion", metricKey: null, currentAssumption: "3 of 5 pilots", breaksAt: "< 50%", why: "PMF signal" },
    ];
    const { m } = mapFor(d);
    expect(rowOf(m.rows, "NRR").modelViews).toEqual([{ variable: "Net revenue retention", currentAssumption: "118% on 45 accounts", breaksAt: "< 100%", why: "expansion story" }]);
    expect(m.rows.find((r) => r.id.startsWith("ENTRY_VALUATION_") && r.modelViews.length)?.modelViews[0]!.why).toBe("price discipline");
    const model = m.rows.find((r) => r.method === "MODEL")!;
    expect(model).toMatchObject({ variable: "Pilot → production conversion", current: "3 of 5 pilots", breaksAt: "< 50%", margin: null, unit: "TEXT" });
    expect(m.rows[m.rows.length - 1]!.method).toBe("MODEL");
  });

  it("missing data: an empty deal yields no computed rows, a note, and no throw", () => {
    const s = stateFromContext(ctxFor(emptyCanonical("FAST_SCREEN")));
    const m = sensitivityMap(s, null);
    expect(m.rows.filter((r) => r.method === "COMPUTED")).toEqual([]);
    expect(m.notes.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(mapFor(seriesA()).m)).toBe(JSON.stringify(mapFor(seriesA()).m));
  });
});

describe("solvers", () => {
  it.each([
    [(x: number) => x * x - 2, 0, 2, Math.SQRT2],
    [(x: number) => Math.exp(x) - 10, 0, 5, Math.log(10)],
    [(x: number) => x * x * x - x - 1, 1, 2, 1.324717957244746],
    [(x: number) => 1 / x - 0.25, 0.1, 100, 4],
  ])("bisect finds the bracketed root #%#", (f, lo, hi, root) => {
    expect(bisect(f, lo, hi)!).toBeCloseTo(root, 8);
  });

  it("bisect returns null when the root is not bracketed", () => {
    expect(bisect((x) => x * x + 1, -1, 1)).toBeNull();
  });

  it("bisect in log space solves scale-free problems", () => {
    expect(bisect((x) => 1e9 / x - 3, 1e3, 1e12, { log: true })!).toBeCloseTo(1e9 / 3, 0);
  });

  it.each([
    [true, 1, "ABOVE_HI"],
    [false, 1, "BELOW_LO"],
  ] as const)("solveMonotone reports out-of-range roots (increasing=%s)", (increasing, _g, flag) => {
    const f = increasing ? (x: number) => x - 1000 : (x: number) => 1000 - x - 2000;
    expect(solveMonotone(f, 5, 1, 100, { increasing }).outOfRange).toBe(flag);
  });

  it("solveMonotone expands from a far guess", () => {
    expect(solveMonotone((x) => 50 - x, 1, 0.5, 1e6, { increasing: false, log: true }).root!).toBeCloseTo(50, 6);
  });

  it("solveIncreasing finds the smallest x reaching the target on a ramp", () => {
    expect(solveIncreasing((x) => Math.min(x, 10) * 2, 8, 0, 1)!).toBeCloseTo(4, 8);
  });
});
