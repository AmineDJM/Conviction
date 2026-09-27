/** §121 Calculation tests — calculations must be exact. */
import { describe, expect, it } from "vitest";
import { burnMultiple, cacPaybackMonths, cagr, cmgr, grr, irr, ltv, moic, nrr, runwayMonths } from "@/engine/calc/finance";
import { parseScaledNumber } from "@/engine/metrics/normalize";

describe("finance", () => {
  it("MOIC", () => {
    expect(moic(30_000_000, 2_000_000)).toBe(15);
    expect(moic(0, 2_000_000)).toBe(0);
    expect(moic(1, 0)).toBeNull();
  });

  it("IRR matches closed form for a single exit", () => {
    // (1+r)^5 = 10 → r = 10^(1/5) − 1
    const r = irr([{ t: 0, amount: -1 }, { t: 5, amount: 10 }])!;
    expect(r).toBeCloseTo(Math.pow(10, 1 / 5) - 1, 9);
  });

  it("IRR with a follow-on", () => {
    const flows = [{ t: 0, amount: -100 }, { t: 1, amount: -50 }, { t: 4, amount: 400 }];
    const r = irr(flows)!;
    const npv = flows.reduce((a, f) => a + f.amount / Math.pow(1 + r, f.t), 0);
    expect(Math.abs(npv)).toBeLessThan(1e-6);
  });

  it("IRR total loss is -100%", () => {
    expect(irr([{ t: 0, amount: -1 }, { t: 3, amount: 0 }])).toBe(-1);
  });

  it("CAGR / CMGR", () => {
    expect(cagr(1, 8, 3)!).toBeCloseTo(1, 12);
    expect(cmgr(100, 121, 2)!).toBeCloseTo(0.1, 12);
    expect(cagr(0, 5, 1)).toBeNull();
  });

  it("CAC payback is gross-margin adjusted", () => {
    // ACV 24k → 2k/month × 75% = 1.5k; CAC 18k → 12 months
    expect(cacPaybackMonths(18_000, 24_000, 75)).toBe(12);
  });

  it("burn multiple", () => {
    expect(burnMultiple(6_000_000, 4_000_000)).toBe(1.5);
    expect(burnMultiple(1, 0)).toBeNull();
  });

  it("NRR / GRR", () => {
    expect(nrr(1000, 300, 50, 70)).toBe(118);
    expect(grr(1000, 50, 70)).toBe(88);
    expect(grr(1000, -100, 0)).toBe(100);
  });

  it("runway and LTV", () => {
    expect(runwayMonths(3_000_000, 250_000)).toBe(12);
    expect(runwayMonths(1, 0)).toBeNull();
    expect(ltv(20_000, 80, 10)).toBe(160_000);
  });
});

describe("parseScaledNumber", () => {
  it.each([
    ["$4.2M ARR", 4_200_000],
    ["€850k", 850_000],
    ["1,250 customers", 1250],
    ["$1.2 billion", 1_200_000_000],
    ["ARR 2025: $3.84M", 3_840_000],
    ["120%", 120],
  ])("%s → %d", (raw, expected) => {
    expect(parseScaledNumber(raw)).toBeCloseTo(expected, 6);
  });
  it("returns null when ambiguous", () => {
    expect(parseScaledNumber("$2M to $3M")).toBeNull();
  });
});
