import { describe, expect, it } from "vitest";
import { decisionFocus } from "@/engine/focus";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import type { CanonicalDeal } from "@/domain/canonical";
import { makeDeal, metric } from "./fixtures";

const registry = getRegistry();
function focus(d: CanonicalDeal) {
  const derived = derive(d, registry, DEFAULT_FUND_PROFILE, { now: new Date("2026-09-01") });
  return decisionFocus(d, registry, resolvePeerGroup(d.classification), { sensitivity: derived.economics.sensitivity.rows, gates: derived.fundFit.gates });
}
const risk = (title: string, extra: Record<string, unknown> = {}) =>
  ({ category: "GTM", title, description: title, severity: "HIGH", likelihood: "MODERATE", timing: "NEXT_12_MONTHS", mitigation: "", evidence: "", claimRefs: [], weaknessClass: "REPAIRABLE", repair: null, ...extra }) as never;
const gap = (id: string, question: string, importance: number, uncertainty: number) =>
  ({ id, question, whyItMatters: "test", target: "CUSTOMER", decisionImportance: importance, uncertainty, researchability: "FOUNDER_ONLY", suggestedQueries: [], status: "NEEDS_FOUNDER", resolutionNote: null }) as never;

describe("decision focus — what actually decides the investment", () => {
  it("returns at most five determinants from everything considered, with a bounded index", () => {
    const f = focus(makeDeal());
    expect(f.determinants.length).toBeLessThanOrEqual(5);
    expect(f.considered).toBeGreaterThan(f.determinants.length);
    for (const d of f.ranked) {
      expect(d.leverage).toBeGreaterThanOrEqual(0);
      expect(d.leverage).toBeLessThanOrEqual(100);
    }
    expect(f.rule).toContain("not a probability");
    expect(f.headline).toMatch(/^Of \d+ items/);
  });

  it("a thesis-killing risk ranks among the determinants", () => {
    const d = makeDeal();
    d.risks = [risk("Enterprise sales depend entirely on the CEO", { weaknessClass: "THESIS_KILLING", severity: "CRITICAL", likelihood: "HIGH" })];
    expect(focus(d).determinants[0]!.label).toBe("Enterprise sales depend entirely on the CEO");
  });

  it("verification lowers leverage: the same fact matters less once verified", () => {
    const a = makeDeal();
    const b = makeDeal();
    b.metrics = b.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, verification: "VERIFIED" } : m));
    const nrr = (d: CanonicalDeal) => focus(d).ranked.find((x) => x.key === "metric:nrr");
    expect(nrr(b)!.leverage).toBeLessThan(nrr(a)!.leverage);
  });

  it("an important unknown outranks a trivial one", () => {
    const d = makeDeal();
    d.informationGaps = [gap("GAP-01", "What is gross retention of 2024 cohorts?", 5, 5), gap("GAP-02", "Office location?", 1, 2)];
    const f = focus(d);
    const i1 = f.ranked.findIndex((x) => x.key === "gap:GAP-01");
    const i2 = f.ranked.findIndex((x) => x.key === "gap:GAP-02");
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2 === -1 || i1 < i2).toBe(true);
  });

  it("collapses a gap and a risk about the same variable into one item", () => {
    const d = makeDeal();
    d.informationGaps = [gap("GAP-01", "Founder dependence of enterprise sales", 5, 5)];
    d.risks = [risk("Founder dependence of enterprise sales", { weaknessClass: "THESIS_KILLING" })];
    const f = focus(d);
    expect(f.ranked.filter((x) => x.label.includes("Founder dependence")).length).toBe(1);
    expect(f.ranked.find((x) => x.label.includes("Founder dependence"))!.refs).toContain("GAP-01");
  });

  it("a failed fund gate is a determinant regardless of company quality", () => {
    const d = makeDeal();
    d.identity = { ...d.identity, hqCountry: "Antarctica" };
    const derived = derive(d, registry, { ...DEFAULT_FUND_PROFILE, geographies: ["France"] }, { now: new Date("2026-09-01") });
    const f = decisionFocus(d, registry, resolvePeerGroup(d.classification), { sensitivity: derived.economics.sensitivity.rows, gates: derived.fundFit.gates });
    expect(f.determinants.some((x) => x.kind === "GATE")).toBe(true);
  });

  it("outlier candidates are never manufactured: mediocre metrics → none", () => {
    const d = makeDeal();
    d.metrics = [metric("arr", 500_000), metric("nrr", 95, { unit: "PERCENT" }), metric("arr_growth_yoy", 40, { unit: "PERCENT" })];
    d.exceptionalStrengths = [];
    expect(focus(d).outlierCandidates).toEqual([]);
  });

  it("an extreme metric at the top of its curve is a candidate, labelled as a curve position, never a percentile claim", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 175, rawValue: "175%" } : m));
    const o = focus(d).outlierCandidates;
    expect(o.length).toBeGreaterThan(0);
    expect(o.length).toBeLessThanOrEqual(2);
    expect(o[0]!.basis).toContain("not a percentile");
  });

  it("an exceptional strength rated on evidence is an outlier candidate", () => {
    const d = makeDeal();
    d.exceptionalStrengths = [{ id: "EXC-1", claim: "Proprietary distribution through the top-3 ERP marketplace", kind: "PROPRIETARY_DISTRIBUTION", evidence: "Signed exclusive listing", whyItMatters: "", durability: "", invalidation: "", rating: "EXCEPTIONAL", claimRefs: ["CLM-001"] }] as never;
    expect(focus(d).outlierCandidates.some((o) => o.label.includes("Proprietary distribution"))).toBe(true);
  });

  it("links the reversing question to the top determinant", () => {
    const d = makeDeal();
    d.risks = [risk("Enterprise sales depend entirely on the CEO", { weaknessClass: "THESIS_KILLING", severity: "CRITICAL", likelihood: "HIGH" })];
    d.questions = [
      { id: "Q-01", question: "Where is your office?", tier: "OPTIONAL", whyItMatters: "logistics", knownContext: "", ifAnswerA: "irrelevant a", ifAnswerB: "irrelevant b", affects: ["NEXT_DILIGENCE_STEP"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null },
      { id: "Q-02", question: "Which enterprise sales closed last quarter without the CEO in the room?", tier: "MUST_ASK", whyItMatters: "Tests whether sales depend on the CEO", knownContext: "", ifAnswerA: "several — scalable", ifAnswerB: "none — founder-bound", affects: ["RECOMMENDATION"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null },
    ] as never;
    const f = focus(d);
    expect(f.reversingQuestion?.id).toBe("Q-02");
    expect(f.reversingQuestion?.source).toBe("QUESTIONS");
  });

  it("reports agreement and disagreement with the model's five determinants", () => {
    const d = makeDeal();
    d.risks = [risk("Enterprise sales depend entirely on the CEO", { weaknessClass: "THESIS_KILLING", severity: "CRITICAL", likelihood: "HIGH" })];
    d.decisionCore = {
      compression: { bet: "", exceptionalStrength: "", breakingPoint: "", returnPath: "" },
      determinants: [
        { fact: "Enterprise sales depend on the CEO", whyDecisive: "", status: "UNKNOWN", refs: [] },
        { fact: "Brand awareness in Asia", whyDecisive: "", status: "UNKNOWN", refs: [] },
      ],
      outlierSignals: [],
      reversingQuestion: { question: "q", ifFavorable: "", ifUnfavorable: "" },
      asymmetricConviction: { whatTheMarketSees: "", repairableWeaknesses: "", exceptionalAndHardToCopy: "" },
      secondOrder: [],
    };
    const a = focus(d).modelAgreement!;
    expect(a.agreed.some((x) => x.includes("Enterprise sales"))).toBe(true);
    expect(a.modelOnly).toContain("Brand awareness in Asia");
  });

  it("is pure: the deal is not mutated", () => {
    const d = makeDeal();
    const before = JSON.stringify(d);
    focus(d);
    expect(JSON.stringify(d)).toBe(before);
  });

  it("works on an empty record", () => {
    const d = makeDeal({ metrics: [], claims: [], risks: [], informationGaps: [], questions: [] });
    const f = decisionFocus(d, registry, resolvePeerGroup(d.classification));
    expect(f.determinants).toEqual([]);
    expect(f.headline).toContain("Not enough");
  });
});

describe("decision focus — calibration on real-shaped records", () => {
  it("unknowns do not saturate: a gap alone cannot outrank a thesis killer", () => {
    const d = makeDeal();
    d.informationGaps = [gap("GAP-01", "What is the office layout?", 5, 5)];
    d.risks = [risk("Enterprise sales depend entirely on the CEO", { weaknessClass: "THESIS_KILLING", severity: "CRITICAL", likelihood: "HIGH" })];
    const f = focus(d);
    const g = f.ranked.find((x) => x.key === "gap:GAP-01")!;
    expect(g.leverage).toBeLessThanOrEqual(75);
    expect(f.determinants[0]!.kind).toBe("RISK");
  });

  it("a gap about a decisive variable inherits its impact", () => {
    const d = makeDeal();
    d.risks = [risk("Enterprise sales depend entirely on the CEO", { weaknessClass: "THESIS_KILLING", severity: "CRITICAL", likelihood: "HIGH" })];
    d.informationGaps = [gap("GAP-01", "Do enterprise sales depend entirely on the CEO?", 3, 5), gap("GAP-02", "Which conferences does the team attend?", 3, 5)];
    const f = focus(d);
    const g1 = f.ranked.find((x) => x.refs.includes("GAP-01"))!;
    const g2 = f.ranked.find((x) => x.refs.includes("GAP-02"))!;
    expect(g1.leverage).toBeGreaterThan(g2.leverage);
  });

  it("hygiene metrics are never outlier candidates", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "customer_concentration_top1" ? { ...m, normalizedValue: 2, rawValue: "2%" } : m));
    expect(focus(d).outlierCandidates.some((o) => o.refs.includes(d.metrics.find((m) => m.metricKey === "customer_concentration_top1")!.id))).toBe(false);
  });

  it("a flagged metric (inconsistent, signed-not-deployed, small sample) is never an outlier candidate", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 175, rawValue: "175%", qualityFlags: ["SMALL_SAMPLE: n=4 < 10"] } : m));
    expect(focus(d).outlierCandidates.some((o) => o.label.startsWith("NRR"))).toBe(false);
  });
});
