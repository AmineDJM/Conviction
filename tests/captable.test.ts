/** §45 Cap table engine and liquidation waterfall. */
import { describe, expect, it } from "vitest";
import {
  addConvertible,
  addDebt,
  addWarrant,
  applyPricedRound,
  applySecondary,
  emptyCapTable,
  ownershipByHolder,
  totalFdShares,
  type CapTable,
} from "@/engine/calc/captable";
import { runWaterfall, waterfallFromCapTable } from "@/engine/calc/waterfall";

function founders(): CapTable {
  const ct = emptyCapTable();
  ct.holdings.push({ holder: "Founder A", className: "Common", shares: 4_500_000 });
  ct.holdings.push({ holder: "Founder B", className: "Common", shares: 4_500_000 });
  ct.holdings.push({ holder: "Option Pool", className: "Option Pool", shares: 1_000_000 });
  return ct;
}

describe("priced round", () => {
  it("simple round without pool top-up", () => {
    const r = applyPricedRound(founders(), { className: "Series Seed", preMoney: 8_000_000, investments: [{ holder: "Fund", amount: 2_000_000 }] });
    expect(r.pricePerShare).toBeCloseTo(0.8, 10);
    expect(r.postMoney).toBeCloseTo(10_000_000, 4);
    expect(ownershipByHolder(r.capTable).Fund).toBeCloseTo(0.2, 10);
  });

  it("pool top-up comes out of the pre-money", () => {
    const r = applyPricedRound(founders(), {
      className: "Series A",
      preMoney: 8_000_000,
      investments: [{ holder: "Fund", amount: 2_000_000 }],
      targetPoolPostPct: 15,
    });
    const own = ownershipByHolder(r.capTable);
    expect(own.Fund).toBeCloseTo(0.2, 9); // investor unaffected by pre-money pool
    expect(own["Option Pool"]).toBeCloseTo(0.15, 9);
    expect(r.postMoney).toBeCloseTo(10_000_000, 3);
  });

  it("post-money SAFE converts at the cap and is fixed pre-new-money", () => {
    let ct = founders();
    ct = addConvertible(ct, { holder: "SAFE Investor", kind: "SAFE_POST_MONEY", principal: 1_000_000, valuationCap: 10_000_000, discountPct: null });
    const r = applyPricedRound(ct, { className: "Series A", preMoney: 30_000_000, investments: [{ holder: "Lead", amount: 10_000_000 }] });
    const own = ownershipByHolder(r.capTable);
    // Post-money SAFE: 10% of the pre-round capitalization, then diluted by new money (25%).
    expect(own["SAFE Investor"]).toBeCloseTo(0.1 * 0.75, 6);
    expect(own.Lead).toBeCloseTo(0.25, 6);
  });

  it("SAFE takes the better of cap and discount", () => {
    let ct = founders();
    ct = addConvertible(ct, { holder: "S", kind: "SAFE_PRE_MONEY", principal: 500_000, valuationCap: 100_000_000, discountPct: 20 });
    const r = applyPricedRound(ct, { className: "A", preMoney: 20_000_000, investments: [{ holder: "L", amount: 5_000_000 }] });
    const conv = r.conversionShares[0]!;
    expect(conv.conversionPrice).toBeCloseTo(r.pricePerShare * 0.8, 10);
  });

  it("convertible note accrues interest", () => {
    let ct = founders();
    ct = addConvertible(ct, { holder: "N", kind: "CONVERTIBLE_NOTE", principal: 1_000_000, valuationCap: null, discountPct: null, interestRatePct: 6, yearsOutstanding: 2 });
    const r = applyPricedRound(ct, { className: "A", preMoney: 20_000_000, investments: [{ holder: "L", amount: 5_000_000 }] });
    expect(r.conversionShares[0]!.shares * r.pricePerShare).toBeCloseTo(1_120_000, 4);
  });

  it("secondary does not change fully diluted shares; warrants add to FD", () => {
    const ct = founders();
    const before = totalFdShares(ct);
    const after = applySecondary(ct, "Founder A", "Secondary Buyer", "Common", 500_000);
    expect(totalFdShares(after)).toBe(before);
    expect(ownershipByHolder(after)["Secondary Buyer"]).toBeCloseTo(0.05, 10);
    expect(totalFdShares(addWarrant(ct, "Lender", 100_000))).toBe(before + 100_000);
  });
});

describe("waterfall", () => {
  it("non-participating preferred takes preference in a low exit", () => {
    const res = runWaterfall(5_000_000, [
      { name: "pref", shares: 0.2, preference: 2_000_000, participating: false, seniority: 0 },
      { name: "common", shares: 0.8, preference: 0, participating: false, seniority: 0 },
    ]);
    expect(res.byClass.pref).toBeCloseTo(2_000_000, 6);
    expect(res.converted.pref).toBe(false);
  });

  it("non-participating preferred converts in a high exit", () => {
    const res = runWaterfall(100_000_000, [
      { name: "pref", shares: 0.2, preference: 2_000_000, participating: false, seniority: 0 },
      { name: "common", shares: 0.8, preference: 0, participating: false, seniority: 0 },
    ]);
    expect(res.byClass.pref).toBeCloseTo(20_000_000, 6);
    expect(res.converted.pref).toBe(true);
  });

  it("participating preferred double-dips", () => {
    const res = runWaterfall(12_000_000, [
      { name: "pref", shares: 0.2, preference: 2_000_000, participating: true, seniority: 0 },
      { name: "common", shares: 0.8, preference: 0, participating: false, seniority: 0 },
    ]);
    expect(res.byClass.pref).toBeCloseTo(2_000_000 + 0.2 * 10_000_000, 6);
  });

  it("seniority is respected when exit is below the stack", () => {
    const res = runWaterfall(3_000_000, [
      { name: "B", shares: 0.2, preference: 2_500_000, participating: false, seniority: 2 },
      { name: "A", shares: 0.2, preference: 2_000_000, participating: false, seniority: 1 },
      { name: "common", shares: 0.6, preference: 0, participating: false, seniority: 0 },
    ]);
    expect(res.byClass.B).toBeCloseTo(2_500_000, 6);
    expect(res.byClass.A).toBeCloseTo(500_000, 6);
    expect(res.byClass.common).toBeCloseTo(0, 6);
  });

  it("debt is repaid before equity", () => {
    let ct = founders();
    ct = addDebt(ct, { holder: "Bank", principal: 1_000_000 });
    const out = waterfallFromCapTable(ct, 11_000_000);
    expect(out.Bank).toBeCloseTo(1_000_000, 6);
    expect(out["Founder A"]).toBeCloseTo(4_500_000, 4);
  });
});
