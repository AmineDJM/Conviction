/**
 * Integrity engine — 4. expected evidence, 5. evidence debt, 6. verification
 * priority, 7. confidence by field.
 */
import { describe, expect, it } from "vitest";
import { PROFILE_IDS, STAGE_BANDS } from "@/engine/benchmarks/types";
import { EVIDENCE_ITEMS, EVIDENCE_ITEM_IDS, EXPECTED_EVIDENCE, EXPECTED_EVIDENCE_VERSION, expectationLevel } from "@/engine/integrity/expected-evidence";
import { debtLevel, debtWeight } from "@/engine/integrity/evidence-debt";
import { claim, cleanDeal, findingsOf, link, m, removeMetric, run, setMetric, webSource, withStage } from "./fixtures/integrity/builders";
import { makeDeal } from "./fixtures";

describe("expected evidence configuration", () => {
  it("is versioned", () => {
    expect(EXPECTED_EVIDENCE_VERSION).toMatch(/^\d+\.\d+$/);
    expect(run(cleanDeal()).expectedEvidence.version).toBe(EXPECTED_EVIDENCE_VERSION);
  });
  it.each(PROFILE_IDS.flatMap((p) => STAGE_BANDS.map((s) => [p, s] as const)))("%s × %s: items are known, disjoint, and later stages expect at least as much", (p, s) => {
    const spec = EXPECTED_EVIDENCE[p][s];
    for (const id of [...spec.E, ...spec.N]) expect(EVIDENCE_ITEM_IDS).toContain(id);
    expect(spec.E.filter((x) => spec.N.includes(x))).toEqual([]);
    if (s !== "EARLY") {
      const prev = EXPECTED_EVIDENCE[p][s === "LATE" ? "GROWTH" : "EARLY"];
      for (const id of prev.E) expect(spec.E).toContain(id);
    }
  });
  it("every item has a perfect-slide template", () => {
    for (const id of EVIDENCE_ITEM_IDS) expect(EVIDENCE_ITEMS[id].perfectSlide.length).toBeGreaterThan(40);
  });
  it.each([
    ["ENTERPRISE_SAAS", "EARLY", "retention", "NOT_YET_EXPECTED"], // seed doesn't expect NRR
    ["ENTERPRISE_SAAS", "GROWTH", "retention", "EXPECTED"],
    ["ENTERPRISE_SAAS", "GROWTH", "cohort_retention", "NICE_TO_HAVE"],
    ["ENTERPRISE_SAAS", "LATE", "cohort_retention", "EXPECTED"], // Series B+ without cohorts is serious
    ["ENTERPRISE_SAAS", "GROWTH", "sales_cycle", "EXPECTED"],
    ["ENTERPRISE_SAAS", "GROWTH", "cac_payback", "EXPECTED"],
    ["ENTERPRISE_SAAS", "GROWTH", "acv", "EXPECTED"],
    ["ENTERPRISE_SAAS", "GROWTH", "arr_history", "EXPECTED"],
    ["MARKETPLACE", "GROWTH", "take_rate", "EXPECTED"],
    ["CONSUMER", "GROWTH", "consumer_retention", "EXPECTED"],
    ["BIOTECH_MEDTECH", "EARLY", "regulatory_path", "EXPECTED"],
    ["BIOTECH_MEDTECH", "GROWTH", "arr_history", "NOT_YET_EXPECTED"],
    ["HARDWARE_ROBOTICS", "GROWTH", "units_shipped", "EXPECTED"],
    ["FINTECH", "GROWTH", "credit_losses", "NICE_TO_HAVE"],
  ] as const)("%s × %s: %s is %s", (p, s, item, level) => {
    expect(expectationLevel(p, s, item)).toBe(level);
  });
});

describe("expected evidence on deals (seed vs Series B)", () => {
  const thin = (stage: "SEED" | "SERIES_A" | "SERIES_B") => {
    const d = withStage(cleanDeal(), stage);
    d.metrics = d.metrics.filter((x) => ["arr", "paying_customers"].includes(x.metricKey) && x.isPrimary);
    d.customers!.concentrationNote = null;
    return d;
  };
  it.each([
    ["SEED", "LOW", 0], // seed expects team, terms, use of funds, product proof: all present
    ["SERIES_A", "MODERATE", 6], // arr history, gross margin, retention, ACV, CAC/payback, concentration
    ["SERIES_B", "HIGH", 12], // + cohorts, burn multiple, pipeline, headcount, cap table, services mix
  ] as const)("thin %s deck: missing EXPECTED items are %s (%d of them)", (stage, sev, n) => {
    const r = run(thin(stage));
    const f = findingsOf(r, "EXPECTED_EVIDENCE_MISSING");
    expect(f.length).toBe(n);
    for (const x of f) expect(x.severity).toBe(sev);
    expect(r.summary.missingExpectedCount).toBe(n);
  });

  it("seed: NRR missing is not a finding and gets no perfect slide", () => {
    const r = run(thin("SEED"));
    expect(r.expectedEvidence.items.find((i) => i.itemId === "retention")).toBeUndefined();
    expect(r.expectedEvidence.perfectSlides.map((p) => p.itemId)).not.toContain("retention");
  });

  it("Series B without a cohort table: HIGH finding with the cohort perfect slide", () => {
    const d = withStage(cleanDeal(), "SERIES_B");
    setMetric(d, "nrr", 120, { unit: "PERCENT", sampleSize: 45, cohortDefinition: null });
    const r = run(d);
    const f = findingsOf(r, "EXPECTED_EVIDENCE_MISSING").find((x) => x.title.includes("Cohort"))!;
    expect(f.severity).toBe("HIGH");
    expect(f.detail).toContain("Quarterly cohort table: for each customer cohort since launch, starting ARR, expansion, contraction, churn, current ARR, gross and net retention; with customer counts");
  });

  it("withheld is distinguished from missing", () => {
    const d = cleanDeal();
    setMetric(d, "nrr", null, { unit: "PERCENT", state: "WITHHELD" });
    removeMetric(d, "grr");
    const r = run(d);
    const item = r.expectedEvidence.items.find((i) => i.itemId === "retention")!;
    expect(item.presence).toBe("WITHHELD");
    expect(findingsOf(r, "EXPECTED_EVIDENCE_WITHHELD").length).toBe(1);
    expect(r.expectedEvidence.withheldExpected).toEqual(["retention"]);
  });

  it("missing NICE_TO_HAVE items get perfect slides but no findings", () => {
    const r = run(cleanDeal());
    expect(r.expectedEvidence.missingNiceToHave).toEqual(expect.arrayContaining(["cap_table", "pipeline_funnel"]));
    expect(r.expectedEvidence.perfectSlides.map((p) => p.itemId)).toEqual(expect.arrayContaining(["cap_table", "pipeline_funnel"]));
    expect(r.findings).toEqual([]);
  });

  it.each([
    ["pipeline_funnel", "Pipeline & funnel"],
    ["pricing", "Pricing:"],
    ["round_terms", "Round terms:"],
    ["customer_concentration", "Concentration:"],
    ["cap_table", "Cap table:"],
    ["use_of_funds", "Use of funds:"],
  ] as const)("perfect slide for %s is deterministic text", (id, prefix) => {
    expect(EVIDENCE_ITEMS[id].perfectSlide.startsWith(prefix)).toBe(true);
  });

  it("a cap table is detected from the forensics visual readout", () => {
    const d = withStage(cleanDeal(), "SERIES_B");
    d.forensics = { visualElements: [{ page: 14, kind: "CAP_TABLE", readout: "" }] } as unknown as typeof d.forensics;
    expect(run(d).expectedEvidence.items.find((i) => i.itemId === "cap_table")!.presence).toBe("PRESENT");
  });
});

describe("evidence debt", () => {
  it.each([
    [0, false, "LOW"],
    [0.24, false, "LOW"],
    [0.25, false, "MODERATE"],
    [0.5, false, "HIGH"],
    [0.75, false, "VERY_HIGH"],
    [0.1, true, "MODERATE"],
    [0.9, true, "VERY_HIGH"],
    [null, false, null],
  ])("share %s, contradicted material %s → %s", (share, c, level) => {
    expect(debtLevel(share, c)).toBe(level);
  });
  it.each([
    [1, 1],
    [2, 1.5],
    [5, 3],
    [9, 3],
    [0, 1],
  ])("weight for unusualness %d = %d", (u, w) => expect(debtWeight(u)).toBe(w));

  const evidenceDeal = () => {
    const d = cleanDeal();
    d.metrics = [];
    d.sources.push(webSource("SRC-020", "https://www.ft.com/a"), webSource("SRC-021", "https://www.bloomberg.com/b"), webSource("SRC-022", "https://www.sec.gov/c", { origin: "PRIMARY_EXTERNAL" }));
    d.claims = [
      claim("CLM-P1", { category: "PRODUCT", statement: "Product runs in production at 40 customers", unusualness: 2, verification: "VERIFIED", evidence: [link("SRC-001", "ORIGIN", { location: "p. 2" }), link("SRC-022", "CONFIRMS")] }),
      claim("CLM-P2", { category: "TECHNOLOGY", statement: "10× faster than incumbents", unusualness: 5 }),
      claim("CLM-T1", { category: "METRIC", statement: "ARR $3.8M", unusualness: 2, verification: "PARTIALLY_VERIFIED", evidence: [link("SRC-001", "ORIGIN"), link("SRC-020", "PARTIALLY_CONFIRMS")] }),
      claim("CLM-T2", { category: "CUSTOMER", statement: "Globex is a customer", unusualness: 2 }),
      claim("CLM-M1", { category: "MARKET", statement: "Market grows 40% a year", unusualness: 3 }),
      claim("CLM-G1", { category: "PARTNERSHIP", statement: "Reseller agreement with a big-4 firm", unusualness: 4, verification: "CONTRADICTED", evidence: [link("SRC-021", "CONTRADICTS")] }),
      claim("CLM-TM", { category: "TEAM", statement: "CTO built the extraction engine at a previous company", unusualness: 2, verification: "VERIFIED", evidence: [link("SRC-020", "CONFIRMS")] }),
      claim("CLM-F1", { category: "FUNDING", statement: "Raised $4M to date", unusualness: 1 }),
      claim("CLM-NM", { category: "COMPETITION", material: false, statement: "No direct competitor", unusualness: 5 }),
    ];
    return d;
  };

  it("maps claims to areas and counts statuses", () => {
    const debt = run(evidenceDeal()).evidenceDebt;
    const area = (a: string) => debt.areas.find((x) => x.area === a)!;
    expect([area("PRODUCT_PROOF").verified, area("PRODUCT_PROOF").companyOnly]).toEqual([1, 1]);
    expect([area("TRACTION").independentlySupported, area("TRACTION").companyOnly]).toEqual([1, 1]);
    expect(area("GTM").contradicted).toBe(1);
    expect(area("TEAM").verified).toBe(1);
    expect(area("MOAT").items).toBe(0); // non-material claims are not debt items
    expect(area("MOAT").level).toBeNull();
  });

  it.each([
    ["PRODUCT_PROOF", 3 / 4.5, "HIGH"], // verified (w 1.5) + company-only 10× claim (w 3)
    ["TRACTION", 1.5 / 3, "HIGH"], // independently supported (1.5) + company-only (1.5)
    ["MARKET", 1, "VERY_HIGH"],
    ["TEAM", 0, "LOW"],
    ["FINANCING", 1, "VERY_HIGH"],
  ] as const)("area %s: weighted company-only share %d → %s", (a, share, level) => {
    const area = run(evidenceDeal()).evidenceDebt.areas.find((x) => x.area === a)!;
    expect(area.companyOnlyWeightedShare).toBeCloseTo(share, 3);
    expect(area.level).toBe(level);
  });

  it("a contradicted material claim raises its area by one level", () => {
    const debt = run(evidenceDeal()).evidenceDebt;
    const gtm = debt.areas.find((x) => x.area === "GTM")!;
    expect(gtm.companyOnlyWeightedShare).toBe(1);
    expect(gtm.level).toBe("VERY_HIGH");
  });

  it("overall debt pools every item; top debt lists the most unusual unsupported claims first", () => {
    const debt = run(evidenceDeal()).evidenceDebt;
    expect(debt.topDebt[0]!.ref).toBe("CLM-G1"); // contradicted, unusualness 4 → 2.5 × 1.5
    expect(debt.topDebt[1]!.ref).toBe("CLM-P2"); // company-only, unusualness 5 → 3
    expect(debt.overall).not.toBeNull();
    expect(debt.rule).toContain("0.25");
  });

  it("all-verified claims give LOW debt", () => {
    const d = evidenceDeal();
    d.claims = d.claims.filter((c) => c.verification === "VERIFIED");
    expect(run(d).evidenceDebt.overall).toBe("LOW");
  });

  it("company-only metrics count as traction debt when not linked to a claim", () => {
    const d = cleanDeal();
    d.claims = [];
    const debt = run(d).evidenceDebt;
    expect(debt.areas.find((x) => x.area === "TRACTION")!.companyOnly).toBeGreaterThan(5);
    expect(debt.areas.find((x) => x.area === "GTM")!.items).toBeGreaterThan(0); // CAC payback, sales cycle
    expect(debt.areas.find((x) => x.area === "FINANCING")!.items).toBe(1); // runway
  });

  it("a VERIFIED claim whose only support is the company is not counted as verified", () => {
    const d = cleanDeal();
    d.metrics = [];
    d.claims = [claim("CLM-V", { verification: "VERIFIED" })];
    expect(run(d).evidenceDebt.areas.find((x) => x.area === "TRACTION")!.companyOnly).toBe(1);
  });
});

describe("verification priority", () => {
  const prioDeal = () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-020", "https://www.ft.com/a"));
    d.claims = [
      claim("CLM-A", { category: "METRIC", unusualness: 5, statement: "NRR of 180%" }),
      claim("CLM-B", { category: "METRIC", unusualness: 5, statement: "Revenue verified", verification: "VERIFIED", independence: "INDEPENDENT", evidence: [link("SRC-020", "CONFIRMS")] }),
      claim("CLM-C", { category: "COMPETITION", unusualness: 5, statement: "No competitor" }),
      claim("CLM-D", { category: "METRIC", unusualness: 5, material: false, statement: "Lots of users" }),
      claim("CLM-E", { category: "METRIC", unusualness: 1, statement: "Founded 2022" }),
      claim("CLM-F", { category: "CUSTOMER", unusualness: 4, statement: "Contract with Globex", contradictions: ["Founder call: not signed"] }),
      claim("CLM-G", { category: "METRIC", unusualness: 5, statement: "Old number", freshness: "STALE", verification: "PARTIALLY_VERIFIED" }),
    ];
    return d;
  };
  it("is labelled as an index, not a probability", () => {
    expect(run(prioDeal()).verificationPriority.label).toBe("Verification Priority Index — not a probability");
  });
  it("ranks unusual, material, unverified claims first", () => {
    const ids = run(prioDeal()).verificationPriority.items.map((i) => i.claimId);
    expect(ids[0]).toBe("CLM-A");
    expect(ids.indexOf("CLM-A")).toBeLessThan(ids.indexOf("CLM-C")); // category weight
    expect(ids.indexOf("CLM-A")).toBeLessThan(ids.indexOf("CLM-D")); // materiality
    expect(ids.indexOf("CLM-A")).toBeLessThan(ids.indexOf("CLM-B")); // uncertainty
    expect(ids[ids.length - 1]).toBe("CLM-B"); // verified by an independent source
    expect(ids.indexOf("CLM-E")).toBeGreaterThan(ids.indexOf("CLM-D"));
  });
  it.each([
    ["CLM-A", 85], // 1 × 1 × 0.85
    ["CLM-B", 7], // 1 × 1 × 0.1 × 0.7
    ["CLM-C", 51], // 0.6 × 1 × 0.85
    ["CLM-D", 30], // 0.35 × 1 × 0.85
    ["CLM-E", 17], // 1 × 0.2 × 0.85
    ["CLM-F", 80], // contradicted → uncertainty 1 × 0.8
    ["CLM-G", 56], // 0.45 × 1.25
  ])("index for %s = %d", (id, idx) => {
    expect(run(prioDeal()).verificationPriority.items.find((i) => i.claimId === id)!.index).toBe(idx);
  });
  it("indices stay within 0–100", () => {
    for (const i of run(prioDeal()).verificationPriority.items) {
      expect(i.index).toBeGreaterThanOrEqual(0);
      expect(i.index).toBeLessThanOrEqual(100);
    }
  });
});

describe("confidence by field", () => {
  const conf = (d: ReturnType<typeof cleanDeal>, key: string) => run(d).confidence.metrics.find((x) => x.field === `metric:${key}`)!;
  it.each([
    [{}, "MEDIUM"],
    [{ verification: "VERIFIED" as const }, "HIGH"],
    [{ verification: "PARTIALLY_VERIFIED" as const }, "MEDIUM"],
    [{ qualityFlags: ["SMALL_SAMPLE: n=4 < 20"] }, "LOW"],
    [{ qualityFlags: ["NO_DENOMINATOR: rate"] }, "LOW"],
    [{ qualityFlags: ["DEFINITION_NOT_STATED"] }, "LOW"],
    [{ qualityFlags: ["EXTRACTION_MISMATCH: model=1 parsed=2"] }, "LOW"],
    [{ state: "STALE" as const }, "LOW"],
    [{ verification: "VERIFIED" as const, state: "STALE" as const }, "MEDIUM"],
    [{ state: "WITHHELD" as const, normalizedValue: null }, "NONE"],
    [{ state: "CONTRADICTED" as const }, "NONE"],
    [{ calculationMethod: "USER_CORRECTED" as const }, "MEDIUM"],
    [{ calculationMethod: "USER_CORRECTED" as const, verification: "PARTIALLY_VERIFIED" as const }, "HIGH"],
  ])("NRR with %j → %s", (extra, level) => {
    const d = cleanDeal();
    setMetric(d, "nrr", 118, { unit: "PERCENT", sampleSize: 45, cohortDefinition: "ttm", ...extra });
    const c = conf(d, "nrr");
    expect(c.confidence).toBe(level);
    expect(c.reasons.length).toBeGreaterThan(0);
  });

  it("a metric in conflict with an implied value loses a level", () => {
    const d = cleanDeal();
    setMetric(d, "acv", 120_000);
    expect(conf(d, "acv").confidence).toBe("LOW");
    expect(conf(d, "acv").reasons.join(" ")).toContain("implied acv");
  });

  it("a metric with different values on different slides loses a level", () => {
    const d = cleanDeal();
    d.metricObservations = [
      { ...d.metricObservations[0]!, value: 3_840_000, page: 3 },
      { ...d.metricObservations[0]!, value: 3_000_000, page: 12 },
    ];
    expect(conf(d, "arr").confidence).toBe("LOW");
  });

  it.each([
    ["stated pre + post consistent", {}, "MEDIUM"],
    ["pre inconsistent with post − raise", { preMoney: { amount: 80e6, currency: "USD", rawText: "$80M" } }, "LOW"],
    ["uncapped SAFE", { instrument: "SAFE" as const, preMoney: null, postMoney: null, valuationCap: null }, "NONE"],
  ])("valuation confidence: %s → %s", (_n, patch, level) => {
    const d = cleanDeal();
    d.financing = { ...d.financing!, ...patch };
    expect(run(d).confidence.fields.find((f) => f.field === "round.valuation")!.confidence).toBe(level);
  });

  it.each([
    ["bottom-up", (d: ReturnType<typeof cleanDeal>) => d, "MEDIUM"],
    ["top-down only", (d: ReturnType<typeof cleanDeal>) => ((d.market!.bottomUp = null), (d.market!.topDown = { lowUsd: 1e9, highUsd: 3e9, basis: "", sourceRefs: [] }), d), "LOW"],
    ["deck TAM only", (d: ReturnType<typeof cleanDeal>) => ((d.market = null), d), "LOW"],
    ["nothing", (d: ReturnType<typeof cleanDeal>) => ((d.market = null), (d.deckMarket = { tam: null, sam: null, som: null, description: null }), d), "NONE"],
  ])("market size confidence (%s) → %s", (_n, patch, level) => {
    expect(run(patch(cleanDeal())).confidence.fields.find((f) => f.field === "market.size")!.confidence).toBe(level);
  });

  it("founders: deck-only is LOW, research-backed MEDIUM, verified HIGH, contradicted LOW", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-030", "https://github.com/bo"));
    d.founders = [{ ...(makeDeal().founders[0] ?? {}), name: "Bo Builder", role: "CTO", summary: "", timeline: [], publicWork: [], capabilities: [], founderMarketFit: "", notObservableWithoutInterview: [], id: "F-1", backgroundFromDeck: "", priorOrganizations: [], publicProfileUrls: [], researchFindingSourceIds: ["SRC-030"] }];
    const r = run(d);
    const f = (n: string) => r.confidence.fields.find((x) => x.field === `founder:${n}`)!.confidence;
    expect(f("Ada Founder")).toBe("LOW");
    expect(f("Bo Builder")).toBe("MEDIUM");
    d.claims.push(claim("CLM-TB", { category: "TEAM", entity: "Bo Builder", statement: "Bo Builder built X", verification: "VERIFIED", evidence: [link("SRC-030", "CONFIRMS")] }));
    expect(run(d).confidence.fields.find((x) => x.field === "founder:Bo Builder")!.confidence).toBe("HIGH");
    d.claims.push(claim("CLM-TA", { category: "TEAM", entity: "Ada Founder", statement: "Ada Founder scaled a company to $50M", contradictions: ["Founder call: it was $5M"] }));
    expect(run(d).confidence.fields.find((x) => x.field === "founder:Ada Founder")!.reasons).toContain("a claim about this founder is contradicted");
  });

  it("metric confidence rows exist for every metric key and never throw on nulls", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-NULL", "ltv", null));
    const keys = new Set(d.metrics.map((x) => x.metricKey));
    expect(run(d).confidence.metrics.length).toBe(keys.size);
  });
});
