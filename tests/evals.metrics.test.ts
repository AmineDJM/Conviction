import { describe, expect, it } from "vitest";
import { hitAtK, mean, normalizedPrecisionAtK, precisionAtK, recallAtK, reciprocalRank, seededSample, wilson, withinRel } from "../evals/lib/metrics";
import { relevantChunkIds, summarizeRetrieval } from "../evals/lib/retrieval";

const rel = new Set(["a", "c", "x"]);

describe("ranking metrics", () => {
  it("precision@k counts missing slots as misses", () => {
    expect(precisionAtK(["a", "b", "c"], rel, 5)).toBeCloseTo(2 / 5);
    expect(precisionAtK(["a", "b", "c", "d", "e"], rel, 2)).toBeCloseTo(1 / 2);
    expect(precisionAtK(["a"], rel, 0)).toBe(0);
  });
  it("recall@k is null when nothing is relevant (unanswerable, not a miss)", () => {
    expect(recallAtK(["a", "c"], rel, 10)).toBeCloseTo(2 / 3);
    expect(recallAtK(["a"], new Set(), 10)).toBeNull();
  });
  it("normalised precision divides by the best achievable", () => {
    expect(normalizedPrecisionAtK(["a", "b", "c", "d", "e"], new Set(["a", "c"]), 5)).toBe(1);
    expect(normalizedPrecisionAtK(["b", "a"], new Set(["a", "c"]), 5)).toBe(0.5);
  });
  it("hit@k and reciprocal rank", () => {
    expect(hitAtK(["b", "d", "c"], rel, 2)).toBe(0);
    expect(hitAtK(["b", "d", "c"], rel, 3)).toBe(1);
    expect(reciprocalRank(["b", "d", "c"], rel)).toBeCloseTo(1 / 3);
    expect(reciprocalRank(["b"], rel)).toBe(0);
  });
  it("mean ignores nulls", () => {
    expect(mean([1, null, 0])).toBe(0.5);
    expect(mean([null])).toBeNull();
  });
});

describe("wilson interval", () => {
  it("is honest at small n and tight at large n", () => {
    const small = wilson(10, 10)!;
    expect(small.high).toBe(1);
    expect(small.low).toBeLessThan(0.75);
    const large = wilson(995, 1000)!;
    expect(large.low).toBeGreaterThan(0.98);
    expect(wilson(0, 0)).toBeNull();
  });
});

describe("withinRel and seededSample", () => {
  it("uses a 1% relative tolerance with an absolute floor of 1 unit", () => {
    expect(withinRel(3_840_000, 3_840_000)).toBe(true);
    expect(withinRel(3_870_000, 3_840_000)).toBe(true);
    expect(withinRel(3_900_000, 3_840_000)).toBe(false);
    expect(withinRel(null, 5)).toBe(false);
    expect(withinRel(0.005, 0)).toBe(true);
    expect(withinRel(0.5, 0)).toBe(false);
  });
  it("is deterministic and without replacement", () => {
    const xs = Array.from({ length: 50 }, (_, i) => i);
    const a = seededSample(xs, 10, 3);
    expect(seededSample(xs, 10, 3)).toEqual(a);
    expect(new Set(a).size).toBe(10);
    expect(seededSample(xs, 100, 3)).toHaveLength(50);
  });
});

describe("retrieval labels", () => {
  const chunks = [
    { id: "1", companyId: "co1", text: "Sales cycle 54 days" },
    { id: "2", companyId: "co2", text: "Sales cycle 54 days" },
    { id: "3", companyId: "co1", text: "ACV $42k" },
    { id: "4", companyId: null, text: "54 days" },
  ];
  it("relevance is content + company based (survives re-indexing)", () => {
    expect([...relevantChunkIds(chunks, new Set(["co1"]), "54[- ]?days?")]).toEqual(["1"]);
    expect([...relevantChunkIds(chunks, new Set(["co1", "co2"]), "54 DAYS")].sort()).toEqual(["1", "2"]);
  });
  it("summaries exclude unanswerable queries from the means and list them", () => {
    const s = summarizeRetrieval([
      { id: "Q1", ranked: ["1", "3"], relevant: new Set(["1"]) },
      { id: "Q2", ranked: ["3", "9", "8", "7", "6", "1"], relevant: new Set(["1"]) },
      { id: "Q3", ranked: ["3"], relevant: new Set() },
    ]);
    expect(s.unanswerable).toEqual(["Q3"]);
    expect(s.hit5).toBe(0.5);
    expect(s.hit10).toBe(1);
    expect(s.misses5).toEqual(["Q2"]);
    expect(s.mrr).toBeCloseTo((1 + 1 / 6) / 2);
  });
});
