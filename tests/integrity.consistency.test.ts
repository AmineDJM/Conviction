/**
 * Integrity engine — 3. cross-slide consistency, 9. chronology, 10. contradictions.
 */
import { describe, expect, it } from "vitest";
import { isScaleSlip, isTransposition, valueConflictSeverity } from "@/engine/integrity/cross-slide";
import { CLASS_RANK } from "@/engine/integrity/contradictions";
import { claim, cleanDeal, findingsOf, kinds, link, obs, one, run, setMetric, transcriptSource, webSource, withStage } from "./fixtures/integrity/builders";

describe("cross-slide numeric consistency", () => {
  it.each([
    [3_840_000, 3_860_000, null], // 0.5% rounding
    [3_840_000, 3_700_000, "LOW"], // 3.6%
    [3_840_000, 3_400_000, "MODERATE"], // 11.5%
    [3_840_000, 3_000_000, "HIGH"], // 21.9%
    [3_840_000, 1_900_000, "CRITICAL"], // 50.5%
  ])("ARR %d on p.3 vs %d on p.12 → %s", (a, b, sev) => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", a, { page: 3 }), obs("arr", b, { page: 12 })];
    const r = run(d);
    const f = r.findings.filter((x) => x.module === "CROSS_SLIDE");
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
    if (sev) expect(f[0]!.pages).toEqual([3, 12]);
  });

  it("digit transposition is classified as a typo (LOW)", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 4_250_000, { page: 3 }), obs("arr", 4_520_000, { page: 12 })];
    const f = one(run(d), "CROSS_SLIDE_TYPO");
    expect(f.severity).toBe("LOW");
  });

  it("scale slip ($4.2k vs $4.2M) is a typo (MODERATE)", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 4_200, { page: 3 }), obs("arr", 4_200_000, { page: 12 })];
    expect(one(run(d), "CROSS_SLIDE_TYPO").severity).toBe("MODERATE");
  });

  it("different definitions lower the severity by one level (DEFINITION class)", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("paying_customers", 92, { unit: "COUNT", page: 4, definitionAsStated: "paying" }), obs("paying_customers", 140, { unit: "COUNT", page: 9, definitionAsStated: "incl. pilots" })];
    const f = one(run(d), "CROSS_SLIDE_DEFINITION");
    expect(f.severity).toBe("MODERATE"); // 34% → HIGH, minus one level
  });

  it.each([
    ["2026-08", "2025-08", false],
    ["2026-08", "2026-08", true],
    [null, null, true],
  ])("periods %s vs %s → compared: %s", (p1, p2, compared) => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 3_840_000, { page: 3, periodEnd: p1 }), obs("arr", 1_240_000, { page: 12, periodEnd: p2 })];
    expect(run(d).crossSlide.length > 0).toBe(compared);
  });

  it("same page twice is not cross-slide", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 3_840_000, { page: 3 }), obs("arr", 3_000_000, { page: 3 })];
    expect(run(d).crossSlide).toEqual([]);
  });

  it("forecasts and signed figures never create cross-slide conflicts with actuals", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 3_840_000, { page: 3 }), obs("arr", 9_000_000, { page: 12, basis: "FORECAST" }), obs("arr", 6_000_000, { page: 13, basis: "SIGNED" })];
    expect(run(d).crossSlide).toEqual([]);
  });

  it("currencies are converted before comparing", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 3_840_000, { page: 3 }), obs("arr", 3_840_000, { page: 12, currency: "EUR" })];
    expect(run(d).crossSlide.length).toBe(1);
  });

  it.each([
    ["TAM", "Our TAM is $50B", "$50B", null],
    ["TAM", "Total addressable market of $80B", "$80B", "HIGH"], // 37.5%
    ["TAM", "Total addressable market of $200B", "$200B", "CRITICAL"],
    ["SAM", "SAM $1.6B", "$1.6B", "MODERATE"],
  ])("%s claim %j vs deckMarket → %s", (_t, statement, valueText, sev) => {
    const d = cleanDeal();
    d.deckMarket = { ...d.deckMarket, tam: { amount: 50e9, currency: "USD", rawText: "$50B" } };
    d.claims.push(claim("CLM-M", { category: "MARKET", statement, valueText, page: 7 }));
    const items = run(d).crossSlide.filter((x) => x.claimIds.includes("CLM-M"));
    expect(items.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("funding raised to date in a claim vs the financing field", () => {
    const d = cleanDeal();
    d.financing!.totalRaisedToDate = { amount: 4_000_000, currency: "USD", rawText: "$4M" };
    d.claims.push(claim("CLM-F", { category: "FUNDING", statement: "We have raised $6M to date", valueText: "$6M", page: 12 }));
    expect(run(d).crossSlide.find((x) => x.topic === "Total raised to date")?.severity).toBe("HIGH");
  });

  it("founder count in a claim vs the team slide", () => {
    const d = cleanDeal();
    d.claims.push(claim("CLM-T", { category: "TEAM", statement: "Three co-founders with 30 years of combined experience", page: 10 }));
    expect(run(d).crossSlide.find((x) => x.topic === "Founders")?.severity).toBe("MODERATE");
  });

  it("headcount in a claim vs the headcount metric (10% tolerance)", () => {
    const d = cleanDeal();
    d.claims.push(claim("CLM-H", { category: "TEAM", statement: "A team of 60 employees across two offices", page: 10 }));
    d.claims.push(claim("CLM-H2", { category: "TEAM", statement: "A team of 31 employees", page: 2 }));
    const items = run(d).crossSlide.filter((x) => x.topic === "Headcount");
    expect(items.map((x) => x.claimIds[0])).toEqual(["CLM-H"]);
  });

  it("model-reported inconsistencies are kept, marked MODEL, and capped at HIGH", () => {
    const d = cleanDeal();
    d.forensics = {
      narrativeArchitecture: { centralArgument: "", beliefTheDeckWantsMeToHold: "", slideOrderRationale: "", emphasized: [], absentDecisiveInformation: [], routedAroundWeaknesses: [] },
      visualElements: [],
      chartForensics: [],
      crossSlideInconsistencies: [{ topic: "Customers", pages: [4, 11], values: ["92", "120"], detail: "different customer counts", severity: "CRITICAL" }],
      narrativeInconsistencies: [],
      productProof: { level: "PRODUCTION_USAGE", evidence: "" },
      founderSlideSkepticism: [],
      competitiveSlide: null,
      marketSlide: { coherence: "", issues: [] },
      claimChecks: [],
      deckQualitySignals: { precision: "", numberMastery: "", customerUnderstanding: "" },
      suspectedInstructions: [],
    };
    d.metricObservations = [obs("paying_customers", 92, { unit: "COUNT", page: 4 }), obs("paying_customers", 120, { unit: "COUNT", page: 11 })];
    const r = run(d);
    const origins = r.crossSlide.map((x) => x.origin).sort();
    expect(origins).toEqual(["COMPUTED", "MODEL"]);
    const model = one(r, "CROSS_SLIDE_MODEL");
    expect([model.origin, model.severity]).toEqual(["MODEL", "HIGH"]);
  });

  it.each([
    [0.5, null],
    [3, "LOW"],
    [10, "MODERATE"],
    [30, "HIGH"],
    [60, "CRITICAL"],
  ])("value conflict severity at %d%% → %s", (rel, sev) => {
    expect(valueConflictSeverity(rel)).toBe(sev);
  });
  it.each([
    [4.25, 4.52, true],
    [123, 321, true],
    [4.2, 4.2, false],
    [4.25, 4.35, false],
  ])("isTransposition(%d, %d) = %s", (a, b, v) => expect(isTransposition(a, b)).toBe(v));
  it.each([
    [4_200, 4_200_000, true],
    [42, 420, true],
    [42, 430, false],
  ])("isScaleSlip(%d, %d) = %s", (a, b, v) => expect(isScaleSlip(a, b)).toBe(v));
});

describe("chronology: forecast vs actual", () => {
  it("separates current, contracted and forward values and sorts by date", () => {
    const d = cleanDeal();
    d.metricObservations = [
      obs("arr", 9_000_000, { basis: "FORECAST", periodEnd: "2027-12", page: 11 }),
      obs("arr", 3_840_000, { basis: "CURRENT", periodEnd: "2026-08", page: 3 }),
      obs("arr", 1_240_000, { basis: "ACTUAL", periodEnd: "2025-08", page: 3 }),
      obs("arr", 2_000_000, { basis: "SIGNED", periodEnd: "2026-08", page: 5 }),
      obs("pipeline_value", 20_000_000, { basis: "PIPELINE", periodEnd: null, page: 8 }),
      obs("arr", 5_000_000, { basis: "TARGET", periodEnd: "2027-03", page: 11 }),
    ];
    const t = run(d).chronology;
    expect(t.current.map((x) => x.periodEnd)).toEqual(["2025-08", "2026-08"]);
    expect(t.contracted.map((x) => x.basis)).toEqual(["SIGNED"]);
    expect(t.forward.map((x) => x.basis)).toEqual(["TARGET", "FORECAST", "PIPELINE"]);
    expect(t.forward.find((x) => x.basis === "PIPELINE")!.flags).toContain("UNDATED_FORECAST");
  });

  it.each(["FORECAST", "TARGET", "PIPELINE"] as const)("%s observations are never counted as current metrics", (basis) => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "arr" && x.metricKey !== "arr_growth_yoy");
    d.metricObservations = [obs("arr", 50_000_000, { basis, periodEnd: "2028-12", page: 11 })];
    const r = run(d);
    expect(r.expectedEvidence.items.find((i) => i.itemId === "revenue")!.presence).toBe("MISSING");
    expect(r.crossSlide).toEqual([]);
    expect(r.impliedMetrics.find((x) => x.name === "ACV")!.impliedValue).toBeNull();
  });

  it.each([
    ["SERIES_A", "MODERATE"],
    ["SEED", "LOW"],
  ] as const)("revenue forecast without a disclosed base at %s → %s", (stage, sev) => {
    const d = withStage(cleanDeal(), stage);
    d.metrics = d.metrics.filter((x) => !["arr", "arr_growth_yoy", "acv"].includes(x.metricKey));
    d.metricObservations = [obs("arr", 10_000_000, { basis: "FORECAST", periodEnd: "2027-12", page: 11 })];
    expect(one(run(d), "FORECAST_BASE_NOT_DISCLOSED").severity).toBe(sev);
  });

  it.each([
    // [forecast ARR at 2027-08, trailing growth via prior ARR, expected]
    [9_000_000, 1_240_000, null], // 134% vs 210% trailing
    [60_000_000, 1_240_000, "HIGH"], // 1462% ≫ 3 × 210%
    [20_000_000, 3_000_000, "HIGH"], // 421% vs 28% trailing
  ])("forecast %d vs trailing from %d → %s", (fc, prior, sev) => {
    const d = cleanDeal();
    d.metrics = d.metrics.map((x) => (x.id === "MET-002" ? { ...x, normalizedValue: prior } : x));
    d.metricObservations = [obs("arr", fc, { basis: "FORECAST", periodEnd: "2027-08", page: 11 })];
    const f = findingsOf(run(d), "HOCKEY_STICK_FORECAST");
    if (sev === null) expect(f).toEqual([]);
    else expect(f.length).toBe(1);
  });

  it("hockey stick severity: ratio > 6× trailing → HIGH, 3–6× → MODERATE", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.map((x) => (x.id === "MET-002" ? { ...x, normalizedValue: 1_920_000 } : x)); // trailing 100%
    d.metricObservations = [obs("arr", 3_840_000 * 4.5, { basis: "FORECAST", periodEnd: "2027-08", page: 11 })]; // 350%
    const r = run(d);
    expect(one(r, "HOCKEY_STICK_FORECAST").severity).toBe("MODERATE");
    expect(r.chronology.hockeySticks[0]!.ratio).toBeCloseTo(3.5, 1);
  });

  it("forecast growth on a flat history (> 50%) is a hockey stick even without a ratio", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.map((x) => (x.id === "MET-002" ? { ...x, normalizedValue: 3_900_000 } : x));
    d.metricObservations = [obs("arr", 10_000_000, { basis: "FORECAST", periodEnd: "2027-08" })];
    expect(one(run(d), "HOCKEY_STICK_FORECAST").severity).toBe("HIGH");
  });

  it("an 'actual' dated after the analysis date is flagged as a disguised forecast", () => {
    const d = cleanDeal();
    d.metricObservations = [obs("arr", 6_000_000, { basis: "ACTUAL", periodEnd: "2027-06", page: 3 })];
    expect(one(run(d), "ACTUAL_DATED_IN_FUTURE").severity).toBe("MODERATE");
  });
});

describe("contradictions: one ranked list", () => {
  const withContradictions = () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-010", "https://www.reuters.com/tech/acme"), transcriptSource("SRC-900"));
    d.claims.push(
      claim("CLM-IND", { category: "CUSTOMER", statement: "Globex is a paying customer", verification: "CONTRADICTED", evidence: [link("SRC-001", "ORIGIN", { location: "p. 4" }), link("SRC-010", "CONTRADICTS", { excerpt: "Globex ended the pilot" })] }),
      claim("CLM-SELF", { category: "METRIC", statement: "Churn is below 2%", evidence: [link("SRC-001", "ORIGIN", { location: "p. 5" }), link("SRC-900", "CONTRADICTS", { location: "founder call", excerpt: "we lost 6 of 40 customers" })], contradictions: ["Founder call: churn was 15%"] }),
      claim("CLM-NM", { category: "OTHER", material: false, statement: "Office in Paris", verification: "CONTRADICTED", evidence: [link("SRC-010", "CONTRADICTS")] }),
    );
    d.metricObservations = [obs("arr", 4_250_000, { page: 3 }), obs("arr", 4_520_000, { page: 12 })];
    setMetric(d, "acv", 120_000);
    return d;
  };

  it("contradicted by an independent source outranks self-contradiction, value conflicts and typos", () => {
    const r = run(withContradictions());
    const classes = r.contradictions.map((c) => [c.class, c.severity]);
    expect(classes[0]).toEqual(["INDEPENDENT_SOURCE", "CRITICAL"]);
    expect(classes).toContainEqual(["SELF_CONTRADICTION", "HIGH"]);
    expect(classes).toContainEqual(["MATERIAL_VALUE", "CRITICAL"]);
    expect(classes[classes.length - 1]).toEqual(["TYPO", "LOW"]);
  });

  it("at equal severity the class order decides (independent source before value conflict)", () => {
    const r = run(withContradictions());
    const critical = r.contradictions.filter((c) => c.severity === "CRITICAL").map((c) => c.class);
    expect(critical).toEqual(["INDEPENDENT_SOURCE", "MATERIAL_VALUE"]);
  });

  it("class ranking is typo < definition < material value < self-contradiction < independent source", () => {
    expect(CLASS_RANK.TYPO).toBeLessThan(CLASS_RANK.DEFINITION);
    expect(CLASS_RANK.DEFINITION).toBeLessThan(CLASS_RANK.MATERIAL_VALUE);
    expect(CLASS_RANK.MATERIAL_VALUE).toBeLessThan(CLASS_RANK.SELF_CONTRADICTION);
    expect(CLASS_RANK.SELF_CONTRADICTION).toBeLessThan(CLASS_RANK.INDEPENDENT_SOURCE);
  });

  it("contradictory founder statements (transcript evidence) are a self-contradiction finding", () => {
    const r = run(withContradictions());
    const f = one(r, "CLAIM_SELF_CONTRADICTED");
    expect(f.claimIds).toEqual(["CLM-SELF"]);
    expect(f.sourceIds).toEqual(["SRC-900"]);
    expect(f.pages).toEqual([5]);
  });

  it("non-material contradicted claims are MODERATE", () => {
    const r = run(withContradictions());
    expect(r.contradictions.find((c) => c.claimIds.includes("CLM-NM"))!.severity).toBe("MODERATE");
  });

  it("every implied inconsistency and cross-slide conflict appears in the unified list", () => {
    const r = run(withContradictions());
    const nImplied = r.impliedMetrics.filter((x) => x.verdict === "INCONSISTENT").length;
    const nCross = r.crossSlide.length;
    expect(r.contradictions.length).toBe(3 + nImplied + nCross);
    expect(r.summary.contradictionCount).toBe(r.contradictions.length);
  });

  it("a claim contradicted only by founder-call text (no link) is still a self-contradiction", () => {
    const d = cleanDeal();
    d.claims.push(claim("CLM-X", { contradictions: ["Founder call: the $2M contract is not signed yet"] }));
    expect(kinds(run(d))).toContain("CLAIM_SELF_CONTRADICTED");
  });
});
