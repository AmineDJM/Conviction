/** §8 Cost controller: the hard cap is enforced in code. */
import { describe, expect, it } from "vitest";
import { BudgetExceededError, CostController } from "@/ai/cost";
import { costOf, worstCaseCost } from "@/ai/pricing";

const M = "gpt-5.6-luna";
const zero = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 };

describe("pricing", () => {
  it("prices tokens and searches", () => {
    expect(costOf(M, { ...zero, inputTokens: 1_000_000, outputTokens: 1_000_000, webSearches: 2 })).toBeCloseTo(0.2 + 1.2 + 0.02, 10);
    expect(costOf(M, { ...zero, inputTokens: 1_000_000, cachedTokens: 1_000_000 })).toBeCloseTo(0.02, 10);
  });
});

describe("CostController", () => {
  it("refuses a call whose worst case exceeds the cap", () => {
    const c = new CostController(0.01, 0.01);
    expect(() => c.authorize("big", M, 10_000, 50_000)).toThrow(BudgetExceededError);
  });

  it("parallel in-flight calls cannot jointly exceed the cap", () => {
    const c = new CostController(0.05, 0.05);
    const est = worstCaseCost(M, 1000, 30_000); // ≈ $0.036
    c.authorize("a", M, 1000, 30_000);
    expect(() => c.authorize("b", M, 1000, 30_000)).toThrow(BudgetExceededError);
    return c.record({ step: "a", model: M, promptVersion: null, usage: { ...zero, outputTokens: 1000 }, estimatedUsd: est, latencyMs: 1, toolCalls: 0 }).then(() => {
      expect(() => c.authorize("b", M, 1000, 30_000)).not.toThrow();
    });
  });

  it("reservations protect mandatory steps and are consumed once", () => {
    const c = new CostController(0.1, 0.1);
    const r = c.reserve(0.07);
    expect(() => c.authorize("optional", M, 1000, 30_000)).toThrow(BudgetExceededError);
    expect(() => c.authorize("mandatory", M, 1000, 30_000, 0, r)).not.toThrow();
    expect(r.open).toBe(false);
    c.release(r); // idempotent: must not free other reservations
    const r2 = c.reserve(0.01);
    c.release(r);
    expect(c.canAfford(0.1 - 0.01 - worstCaseCost(M, 1000, 30_000) + 1e-6)).toBe(false);
    c.release(r2);
  });

  it("limits searches to the allowance", () => {
    const c = new CostController(0.5, 0.25);
    const n = c.maxSearchesWithin(M, 0.05, 20_000, 10_000, 20);
    expect(worstCaseCost(M, 20_000, 10_000, n)).toBeLessThanOrEqual(0.05);
    expect(worstCaseCost(M, 20_000, 10_000, n + 1)).toBeGreaterThan(0.05);
  });
});
