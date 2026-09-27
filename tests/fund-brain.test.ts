import { describe, expect, it } from "vitest";
import { computePatterns, dealTraits, topicFamily, MIN_MEMBER_OBSERVATIONS, type PatternObservation, type PatternDeal } from "@/brain/patterns";
import { quoteFound } from "@/server/fund-brain";

const members = [
  { id: "m1", name: "James Zhang" },
  { id: "m2", name: "Ada Quiet" },
];
let n = 0;
const obs = (memberId: string, topic: string, kind = "CONCERN", extra: Partial<PatternObservation> = {}): PatternObservation => ({
  memberId,
  kind,
  topic,
  statement: `${topic} statement ${++n}`,
  provenance: "OBSERVED",
  observedAt: `2026-0${(n % 9) + 1}-10T00:00:00Z`,
  companyId: null,
  ...extra,
});

describe("topic families", () => {
  it.each([
    ["churn", "retention"],
    ["NRR", "retention"],
    ["CAC payback", "unit economics"],
    ["valuation", "valuation & price"],
    ["founder-led sales", "team & founders"],
    ["TAM", "market size"],
    ["incumbent", "competition & moat"],
  ])("%s → %s", (t, f) => expect(topicFamily(t)).toBe(f));
});

describe("INFERRED member patterns", () => {
  it("reports a recurring topic with counts, share and examples", () => {
    const record = [obs("m1", "churn"), obs("m1", "NRR"), obs("m1", "cohort retention"), obs("m1", "valuation")];
    const p = computePatterns(members, record, []);
    const r = p.find((x) => x.memberId === "m1" && x.title.includes("retention"))!;
    expect(r.k).toBe(3);
    expect(r.n).toBe(4);
    expect(r.body).toContain("3 of 4");
    expect(r.body).toContain("INFERRED");
    expect(r.body).toContain("not a stated preference");
  });

  it("stays silent below the minimum sample", () => {
    const record = Array.from({ length: MIN_MEMBER_OBSERVATIONS - 1 }, () => obs("m1", "churn"));
    expect(computePatterns(members, record, [])).toEqual([]);
  });

  it("never uses INFERRED observations as evidence for a pattern", () => {
    const record = Array.from({ length: 6 }, () => obs("m1", "churn", "CONCERN", { provenance: "INFERRED" }));
    expect(computePatterns(members, record, [])).toEqual([]);
  });

  it("never produces a pattern for a member with nothing recorded", () => {
    const record = [obs("m1", "churn"), obs("m1", "churn"), obs("m1", "churn")];
    expect(computePatterns(members, record, []).some((p) => p.memberId === "m2")).toBe(false);
  });

  it("does not report a topic below the share threshold", () => {
    const record = [obs("m1", "churn"), obs("m1", "valuation"), obs("m1", "TAM"), obs("m1", "incumbent"), obs("m1", "founder")];
    expect(computePatterns(members, record, []).filter((p) => p.title.includes("recurring topic"))).toEqual([]);
  });

  it("reports an intervention style only with enough interventions", () => {
    const five = [obs("m1", "churn"), obs("m1", "valuation"), obs("m1", "TAM"), obs("m1", "incumbent"), obs("m1", "founder", "QUESTION")];
    const p = computePatterns(members, five, []);
    expect(p.some((x) => x.title.includes("mostly concerns"))).toBe(true);
    expect(computePatterns(members, five.slice(0, 4), []).some((x) => x.title.includes("mostly concerns"))).toBe(false);
  });
});

describe("INFERRED decision associations", () => {
  const deal = (id: string, d: string, traits: string[]): PatternDeal => ({ companyId: id, name: `Co ${id}`, icDecision: d, traits });
  const decided = [
    deal("a1", "APPROVED", ["stage series a"]),
    deal("a2", "APPROVED", ["stage series a", "high financing risk"]),
    deal("a3", "APPROVED", ["stage seed"]),
    deal("r1", "REJECTED", ["high financing risk"]),
    deal("r2", "REJECTED", ["high financing risk", "stage seed"]),
    deal("r3", "REJECTED", ["high financing risk"]),
  ];

  it("reports a trait over-represented among rejected deals, with both shares", () => {
    const p = computePatterns(members, [], decided).find((x) => x.title.includes("high financing risk"))!;
    expect(p.k).toBe(3);
    expect(p.n).toBe(3);
    expect(p.body).toContain("3 of 3");
    expect(p.body).toContain("1 of 3 approved");
    expect(p.body).toContain("not a rule");
  });

  it("requires enough decided deals on both sides", () => {
    expect(computePatterns(members, [], decided.filter((d) => d.companyId !== "a3" && d.companyId !== "a2"))).toEqual([]);
  });

  it("ignores pending deals", () => {
    const withPending = [...decided, deal("p1", "PENDING", ["high financing risk"])];
    const p = computePatterns(members, [], withPending).find((x) => x.title.includes("high financing risk"))!;
    expect(p.n).toBe(3);
  });

  it("finds the most frequent recorded concern on rejected deals", () => {
    const record = [
      obs("m1", "churn", "CONCERN", { companyId: "r1" }),
      obs("m2", "NRR", "CONCERN", { companyId: "r2" }),
      obs("m1", "valuation", "CONCERN", { companyId: "r3" }),
    ];
    const p = computePatterns(members, record, decided).find((x) => x.title.startsWith("Most frequent recorded concern"))!;
    expect(p.title).toContain("retention");
    expect(p.k).toBe(2);
  });

  it("builds readable traits", () => {
    expect(dealTraits({ stage: "SERIES_A", sectors: ["FINTECH"], highRiskCategories: ["GTM"], failedGates: ["Check size"], weakDimensions: ["TRACTION_PMF"], evidenceCategory: "LOW" })).toEqual([
      "stage series a",
      "sector fintech",
      "high gtm risk",
      "fund gate not passed: Check size",
      "weak traction pmf",
      "evidence low",
    ]);
  });
});

describe("DOCUMENTED knowledge requires a verbatim quote", () => {
  const doc = "Investment criteria (2026)\nWe only invest when NRR is above 110% at Series A.\nWe don’t lead seed rounds above a $20M post-money.";
  it("accepts an exact quote, tolerant to whitespace, case and typographic quotes", () => {
    expect(quoteFound("We only invest when NRR is above 110% at Series A.", doc)).toBe(true);
    expect(quoteFound("we  only invest when nrr is above 110%   at series a", doc)).toBe(true);
    expect(quoteFound("We don't lead seed rounds above a $20M post-money", doc)).toBe(true);
  });
  it("rejects paraphrases and invented statements", () => {
    expect(quoteFound("We only invest when NRR exceeds 110% at Series A.", doc)).toBe(false);
    expect(quoteFound("We never invest in hardware.", doc)).toBe(false);
  });
  it("rejects trivially short quotes", () => {
    expect(quoteFound("NRR", doc)).toBe(false);
  });
});
