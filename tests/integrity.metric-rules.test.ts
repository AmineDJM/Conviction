/**
 * Integrity engine — 1. metric integrity rules. Each case starts from a clean
 * Series A deck (zero findings) and injects one manipulation.
 */
import { describe, expect, it } from "vitest";
import { cleanDeal, claim, findingsOf, kinds, m, obs, one, run, setMetric, withStage } from "./fixtures/integrity/builders";

describe("baseline", () => {
  it("clean Series A deck produces zero findings", () => {
    const r = run(cleanDeal());
    expect(r.findings).toEqual([]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe("growth on a tiny base", () => {
  it.each([
    // [current ARR, growth %, expected severity or null]
    [60_000, 400, "HIGH"], // base 12k
    [150_000, 200, "MODERATE"], // base 50k
    [290_000, 200, "MODERATE"], // base ~96.7k
    [310_000, 200, null], // base ~103k
    [3_840_000, 210, null],
    [80_000, 700, "HIGH"], // growth ≥ 500%
    [120_000, 40, null], // growth < 50% is not flagged
  ])("ARR %d growing %d%% → %s", (arrV, g, sev) => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.id !== "MET-002" && x.id !== "MET-012");
    setMetric(d, "arr", arrV);
    setMetric(d, "arr_growth_yoy", g, { unit: "PERCENT" });
    const f = findingsOf(run(d), "GROWTH_ON_TINY_BASE");
    if (sev === null) expect(f).toEqual([]);
    else expect(f.map((x) => x.severity)).toEqual([sev]);
  });

  it("uses the actual prior ARR point when growth was derived from a series", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => !["MET-002", "MET-003"].includes(x.id));
    d.metrics.push(m("MET-P", "arr", 20_000, { periodEnd: "2025-08", isPrimary: false }));
    d.metrics.push(m("MET-G", "arr_growth_yoy", 19_100, { unit: "PERCENT", calculationMethod: "DERIVED", inputs: ["MET-001", "MET-P"] }));
    const f = one(run(d), "GROWTH_ON_TINY_BASE");
    expect(f.metricIds).toEqual(expect.arrayContaining(["MET-G", "MET-P"]));
    expect(f.title).toContain("$20.0k");
  });

  it("is one level lower at seed (tiny bases are normal, the % is still misleading)", () => {
    const d = withStage(cleanDeal(), "SEED");
    setMetric(d, "arr", 60_000);
    setMetric(d, "arr_growth_yoy", 400, { unit: "PERCENT" });
    expect(one(run(d), "GROWTH_ON_TINY_BASE").severity).toBe("MODERATE");
  });

  it.each([
    ["2026-07", "2026-08", 40, "HIGH"], // 1 month window, ≥ 30%
    ["2026-07", "2026-08", 15, "MODERATE"],
    ["2026-02", "2026-08", 15, null], // 6-month window
  ])("MoM growth measured %s → %s at %d%% → %s", (start, end, v, sev) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-MOM", "mom_growth", v, { unit: "PERCENT", periodStart: start, periodEnd: end }));
    const f = findingsOf(run(d), "GROWTH_ON_TINY_BASE");
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("MoM growth without a stated window is LOW", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-MOM", "mom_growth", 25, { unit: "PERCENT", periodStart: null }));
    expect(one(run(d), "GROWTH_ON_TINY_BASE").severity).toBe("LOW");
  });

  it("MoM growth on an MRR base below $10k is at least MODERATE", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "arr");
    d.metrics.push(m("MET-MRR", "mrr", 6_000));
    d.metrics.push(m("MET-MOM", "mom_growth", 20, { unit: "PERCENT", periodStart: "2026-01", periodEnd: "2026-08" }));
    expect(one(run(d), "GROWTH_ON_TINY_BASE").severity).toBe("MODERATE");
  });
});

describe("GMV presented as revenue", () => {
  const marketplace = () => {
    const d = cleanDeal();
    d.classification = { ...d.classification, productType: ["MARKETPLACE"], revenueModel: ["TAKE_RATE"], gtm: ["MARKETPLACE"] };
    return d;
  };
  it.each([
    [10_000_000, 10_000_000, 12, "CRITICAL"],
    [10_000_000, 9_500_000, 12, "CRITICAL"],
    [10_000_000, 9_500_000, null, "HIGH"],
    [10_000_000, 1_200_000, 12, null],
  ])("GMV %d, revenue %d, take rate %s → %s", (gmv, rev, take, sev) => {
    const d = marketplace();
    setMetric(d, "arr", rev);
    d.metrics.push(m("MET-GMV", "gmv", gmv));
    if (take !== null) d.metrics.push(m("MET-TAKE", "take_rate", take, { unit: "PERCENT" }));
    const f = findingsOf(run(d), "GMV_AS_REVENUE").filter((x) => !x.title.includes("defined as gross"));
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("a revenue figure already demoted as gross volume is still reported", () => {
    const d = marketplace();
    setMetric(d, "revenue_ttm", 8_200_000, { state: "CONTRADICTED", qualityFlags: ["GROSS_VOLUME_AS_REVENUE: equals GMV"] });
    d.metrics.push(m("MET-GMV", "gmv", 8_200_000));
    d.metrics.push(m("MET-TAKE", "take_rate", 11, { unit: "PERCENT" }));
    d.metrics.push(m("MET-NET", "revenue_ttm", 902_000, { calculationMethod: "DERIVED", isPrimary: true }));
    expect(findingsOf(run(d), "GMV_AS_REVENUE").some((f) => f.severity === "CRITICAL")).toBe(true);
  });

  it.each(["GMV", "gross merchandise value", "gross bookings", "total payment volume"])("revenue defined as %s is HIGH", (word) => {
    const d = marketplace();
    setMetric(d, "revenue_ttm", 5_000_000, { definitionUsed: `Revenue (${word})` });
    expect(findingsOf(run(d), "GMV_AS_REVENUE").some((f) => f.severity === "HIGH")).toBe(true);
  });

  it("marketplace revenue without GMV or take rate is a LOW disclosure gap", () => {
    expect(one(run(marketplace()), "REVENUE_BASIS_UNDISCLOSED").severity).toBe("LOW");
  });
});

describe("bookings / signed revenue presented as ARR", () => {
  it.each(["SIGNED", "BOOKED"] as const)("observation with basis %s labelled ARR → HIGH", (basis) => {
    const d = cleanDeal();
    d.metricObservations.push(obs("arr", 6_000_000, { basis, page: 5, rawText: "$6M ARR (signed)" }));
    const f = one(run(d), "BOOKINGS_AS_ARR");
    expect(f.severity).toBe("HIGH");
    expect(f.pages).toContain(5);
  });

  it("normalize SIGNED_NOT_DEPLOYED flag produces the finding (deduplicated with the observation on the same page)", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-C", "contracted_arr", 2_000_000, { qualityFlags: ["SIGNED_NOT_DEPLOYED: reported as ARR but basis is signed"], location: "p. 5", basis: "SIGNED" }));
    d.metricObservations.push(obs("arr", 2_000_000, { basis: "SIGNED", page: 5 }));
    const f = one(run(d), "BOOKINGS_AS_ARR");
    expect(f.metricIds).toEqual(["MET-C"]);
  });

  it("small contracted amount next to large live ARR is only MODERATE", () => {
    const d = cleanDeal();
    d.metricObservations.push(obs("arr", 300_000, { basis: "BOOKED", page: 5 }));
    expect(one(run(d), "BOOKINGS_AS_ARR").severity).toBe("MODERATE");
  });

  it("contracted ARR with no live ARR is flagged", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "arr");
    d.metrics.push(m("MET-C", "contracted_arr", 2_000_000));
    expect(kinds(run(d))).toContain("CONTRACTED_ONLY_REVENUE");
  });

  it.each([
    ["ARR incl. one-time implementation fees", true],
    ["ARR including paid pilots", true],
    ["ARR from financial services customers", false], // normalize.ts substring false positive ("services")
    ["ARR from our redesigned product line", false], // "designed" ⊃ "signed"
  ])("ARR_MAY_INCLUDE_NON_RECURRING re-checked on text %j → finding %s", (def, expected) => {
    const d = cleanDeal();
    setMetric(d, "arr", 3_840_000, { definitionUsed: def, qualityFlags: ["ARR_MAY_INCLUDE_NON_RECURRING: definition mentions …"] });
    expect(kinds(run(d)).includes("ARR_INCLUDES_NON_RECURRING")).toBe(expected);
  });
});

describe("pilots counted as customers; logo-only customers", () => {
  it.each([
    ["includes 12 paid pilots", true],
    ["includes design partners", true],
    ["includes LOIs", true],
    ["includes free trials", true],
    ["paying industrial customers", false], // normalize flags "industrial" (contains "trial")
    ["paying customers in production", false],
  ])("customer definition %j → PILOTS_AS_CUSTOMERS %s", (def, expected) => {
    const d = cleanDeal();
    setMetric(d, "paying_customers", 92, { unit: "COUNT", definitionUsed: def, qualityFlags: ["CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING: definition mentions pilots"] });
    expect(kinds(run(d)).includes("PILOTS_AS_CUSTOMERS")).toBe(expected);
  });

  it("pilots ≥ half the customer count escalates to HIGH", () => {
    const d = cleanDeal();
    setMetric(d, "paying_customers", 92, { unit: "COUNT", definitionUsed: "includes pilots" });
    d.metrics.push(m("MET-PIL", "pilots", 60, { unit: "COUNT" }));
    expect(one(run(d), "PILOTS_AS_CUSTOMERS").severity).toBe("HIGH");
  });

  it.each([
    // [logo-only count, paying count, claims mention customers, presented as paying, severity]
    [3, 1, true, false, "HIGH"], // share ≥ 50%
    [1, 3, true, false, "MODERATE"],
    [1, 3, false, false, "LOW"],
    [1, 3, false, true, "HIGH"], // a logo presented as paying
  ])("%d logo-only vs %d paying (claims=%s, presented paying=%s) → %s", (logos, paying, withClaim, presentedPaying, sev) => {
    const d = cleanDeal();
    d.claims = d.claims.filter((c) => c.category !== "CUSTOMER");
    d.customers!.namedCustomers = [
      ...Array.from({ length: logos }, (_, i) => ({ name: `LogoCo${i}`, relationship: (presentedPaying && i === 0 ? "PAYING" : "LOGO_ONLY") as "PAYING" | "LOGO_ONLY", evidenceLevel: "LOGO_ONLY" as const, note: null })),
      ...Array.from({ length: paying }, (_, i) => ({ name: `PayCo${i}`, relationship: "PAYING" as const, evidenceLevel: "PAYING" as const, note: null })),
    ];
    if (withClaim) d.claims.push(claim("CLM-C", { category: "CUSTOMER", statement: "Trusted by LogoCo0 and leading enterprises", page: 4 }));
    const f = one(run(d), "LOGO_ONLY_CUSTOMERS");
    expect(f.severity).toBe(sev);
    if (withClaim) expect(f.claimIds).toContain("CLM-C");
  });

  it("named customers presented as paying but only at pilot stage", () => {
    const d = cleanDeal();
    d.customers!.namedCustomers.push({ name: "Hooli", relationship: "PAYING", evidenceLevel: "PILOT", note: null });
    expect(findingsOf(run(d), "PILOTS_AS_CUSTOMERS").map((f) => f.severity)).toEqual(["MODERATE"]);
  });

  it("more logos presented as paying than the stated customer count", () => {
    const d = cleanDeal();
    setMetric(d, "paying_customers", 1, { unit: "COUNT" });
    expect(kinds(run(d))).toContain("LOGO_WALL_EXCEEDS_CUSTOMER_COUNT");
  });
});

describe("gross margin excluding inference / human ops", () => {
  it.each([
    ["excluding inference costs", "HIGH"],
    ["before human review and annotation", "HIGH"],
    ["excl. cloud hosting", "HIGH"],
    ["not including GPU compute", "HIGH"],
    ["net of support costs? no: excluding customer support", "HIGH"],
  ])("AI product, GM %j → %s", (def, sev) => {
    const d = cleanDeal();
    setMetric(d, "gross_margin", 88, { unit: "PERCENT", definitionUsed: def });
    expect(one(run(d), "GROSS_MARGIN_EXCLUDES_COGS").severity).toBe(sev);
  });

  it("non-AI product excluding hosting is MODERATE", () => {
    const d = cleanDeal();
    d.classification = { ...d.classification, technology: ["NONE_TRADITIONAL"], productType: ["SAAS"] };
    setMetric(d, "gross_margin", 88, { unit: "PERCENT", definitionUsed: "excluding hosting" });
    expect(one(run(d), "GROSS_MARGIN_EXCLUDES_COGS").severity).toBe("MODERATE");
  });

  it("normalize false positive 'complex' (…ex inference) is not reported when the text includes inference", () => {
    const d = cleanDeal();
    setMetric(d, "gross_margin", 70, { unit: "PERCENT", definitionUsed: "includes inference for complex human review workloads", qualityFlags: ["GROSS_MARGIN_EXCLUDES_COGS: human review workloads"] });
    expect(kinds(run(d))).not.toContain("GROSS_MARGIN_EXCLUDES_COGS");
  });

  it("flag without any text is trusted", () => {
    const d = cleanDeal();
    setMetric(d, "gross_margin", 85, { unit: "PERCENT", qualityFlags: ["GROSS_MARGIN_EXCLUDES_COGS: inference"] });
    expect(kinds(run(d))).toContain("GROSS_MARGIN_EXCLUDES_COGS");
  });

  it("AI margin > 75% with undisclosed COGS composition is LOW", () => {
    const d = cleanDeal();
    setMetric(d, "gross_margin", 82, { unit: "PERCENT", definitionUsed: null });
    expect(one(run(d), "GROSS_MARGIN_COMPOSITION_UNKNOWN").severity).toBe("LOW");
  });
});

describe("CAC incomplete", () => {
  it.each([
    ["paid media only", "MODERATE"],
    ["excluding sales salaries", "MODERATE"],
    ["blended CAC", "MODERATE"],
    ["fully loaded incl. salaries and commissions", null],
  ])("CAC defined %j → %s (no payback shown)", (def, sev) => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "cac_payback_months");
    d.metrics.push(m("MET-CAC", "cac", 9_000, { definitionUsed: def }));
    const f = findingsOf(run(d), "CAC_INCOMPLETE");
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("partial CAC with a payback metric built on it → HIGH", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-CAC", "cac", 9_000, { definitionUsed: "ad spend only" }));
    expect(one(run(d), "CAC_INCOMPLETE").severity).toBe("HIGH");
  });

  it("unverified loading is LOW after seed and silent at seed", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-CAC", "cac", 9_000, { definitionUsed: "CAC", qualityFlags: ["CAC_LOADING_UNVERIFIED"] }));
    expect(one(run(d), "CAC_INCOMPLETE").severity).toBe("LOW");
    expect(kinds(run(withStage(d, "SEED")))).not.toContain("CAC_INCOMPLETE");
  });
});

describe("rates without denominators and small samples", () => {
  it.each([
    ["nrr", null, "RATE_WITHOUT_DENOMINATOR", "MODERATE"],
    ["grr", null, "RATE_WITHOUT_DENOMINATOR", "MODERATE"],
    ["win_rate", null, "RATE_WITHOUT_DENOMINATOR", "MODERATE"],
    ["d30_retention", null, "RATE_WITHOUT_DENOMINATOR", "LOW"],
    ["nrr", 12, "SMALL_SAMPLE_RATE", "MODERATE"],
    ["nrr", 5, "SMALL_SAMPLE_RATE", "HIGH"],
    ["pilot_to_production_rate", 3, "SMALL_SAMPLE_RATE", "MODERATE"],
    ["d30_retention", 100, "SMALL_SAMPLE_RATE", "MODERATE"],
    ["nrr", 45, null, null],
  ] as const)("%s with n=%s → %s %s", (key, n, kind, sev) => {
    const d = cleanDeal();
    setMetric(d, key, 90, { unit: "PERCENT", sampleSize: n, cohortDefinition: "trailing 12-month cohorts" });
    const r = run(d);
    const hits = r.findings.filter((f) => f.kind === "RATE_WITHOUT_DENOMINATOR" || f.kind === "SMALL_SAMPLE_RATE");
    if (!kind) expect(hits).toEqual([]);
    else expect(hits.map((f) => [f.kind, f.severity])).toEqual([[kind, sev]]);
  });

  it("a denominator written in the definition counts", () => {
    const d = cleanDeal();
    setMetric(d, "nrr", 118, { unit: "PERCENT", sampleSize: null, cohortDefinition: "trailing 12 months", definitionUsed: "measured on 45 customers" });
    expect(kinds(run(d))).not.toContain("RATE_WITHOUT_DENOMINATOR");
  });
});

describe("aggregate retention without cohorts", () => {
  it.each([
    ["SEED", "LOW"],
    ["SERIES_A", "MODERATE"],
    ["SERIES_B", "HIGH"],
    ["SERIES_C_PLUS", "HIGH"],
  ] as const)("%s → %s", (stage, sev) => {
    const d = withStage(cleanDeal(), stage);
    setMetric(d, "nrr", 125, { unit: "PERCENT", sampleSize: 45, cohortDefinition: null });
    expect(one(run(d), "RETENTION_WITHOUT_COHORTS").severity).toBe(sev);
  });

  it("NO_COHORT_DEFINITION flag is honoured even if text mentions a window", () => {
    const d = cleanDeal();
    setMetric(d, "grr", 92, { unit: "PERCENT", sampleSize: 45, cohortDefinition: null, qualityFlags: ["NO_COHORT_DEFINITION: aggregate retention"] });
    expect(kinds(run(d))).toContain("RETENTION_WITHOUT_COHORTS");
  });
});

describe("cumulative used as run-rate", () => {
  it.each([
    ["arr", "HIGH"],
    ["mrr", "HIGH"],
    ["gmv", "MODERATE"],
    ["revenue_ttm", "MODERATE"],
  ] as const)("cumulative %s observation → %s", (key, sev) => {
    const d = cleanDeal();
    d.metricObservations.push(obs(key, 12_000_000, { periodType: "CUMULATIVE", page: 6, rawText: "$12M revenue to date" }));
    expect(one(run(d), "CUMULATIVE_AS_RUN_RATE").severity).toBe(sev);
  });

  it("forecast cumulative figures are chronology, not this rule", () => {
    const d = cleanDeal();
    d.metricObservations.push(obs("gmv", 50_000_000, { periodType: "CUMULATIVE", basis: "FORECAST", periodEnd: "2028-12" }));
    expect(kinds(run(d))).not.toContain("CUMULATIVE_AS_RUN_RATE");
  });

  it.each([
    ["Revenue since launch", 1_100_000],
    ["Loan volume originated since March 2023", 48_000_000],
  ])("free-labelled cumulative money flow '%s' is detected", (label, v) => {
    const d = cleanDeal();
    d.metricObservations.push(obs("OTHER" as never, v, { label, periodType: "CUMULATIVE", page: 5, rawText: String(v) }));
    expect(one(run(d), "CUMULATIVE_AS_RUN_RATE").detail).toContain(label);
  });

  it("a free-labelled cumulative count that is not a money flow is not this rule", () => {
    const d = cleanDeal();
    d.metricObservations.push(obs("OTHER" as never, 1_400_000, { label: "Downloads since launch", unit: "COUNT", currency: null, periodType: "CUMULATIVE", page: 5 }));
    expect(kinds(run(d))).not.toContain("CUMULATIVE_AS_RUN_RATE");
  });

  it("CUMULATIVE_NOT_RUN_RATE flag on primary ARR", () => {
    const d = cleanDeal();
    setMetric(d, "arr", 3_840_000, { qualityFlags: ["CUMULATIVE_NOT_RUN_RATE: figure is cumulative"] });
    expect(one(run(d), "CUMULATIVE_AS_RUN_RATE").severity).toBe("HIGH");
  });
});

describe("services disguised as SaaS", () => {
  it.each([
    [10, null],
    [25, null],
    [26, "MODERATE"],
    [40, "MODERATE"],
    [41, "HIGH"],
    [60, "HIGH"],
    [61, "CRITICAL"],
    [85, "CRITICAL"],
  ])("services share %d%% → %s", (share, sev) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-SVC", "services_revenue_share", share, { unit: "PERCENT" }));
    const f = findingsOf(run(d), "SERVICES_AS_SAAS");
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("a services company that does not claim SaaS is not flagged", () => {
    const d = cleanDeal();
    d.classification = { ...d.classification, productType: ["TECH_ENABLED_SERVICE"], revenueModel: ["SERVICES"] };
    d.metrics.push(m("MET-SVC", "services_revenue_share", 70, { unit: "PERCENT" }));
    expect(kinds(run(d))).not.toContain("SERVICES_AS_SAAS");
  });
});

describe("self-serve / PLG claimed with enterprise signals", () => {
  const plg = () => {
    const d = cleanDeal();
    d.classification = { ...d.classification, gtm: ["PLG"] };
    return d;
  };
  it.each([
    [30, 5_000, null],
    [75, 5_000, "MODERATE"],
    [200, 5_000, "HIGH"],
    [30, 60_000, "MODERATE"],
    [30, 150_000, "HIGH"],
  ])("cycle %d days, ACV %d → %s", (cycle, acv, sev) => {
    const d = plg();
    setMetric(d, "sales_cycle_days", cycle, { unit: "DAYS", sampleSize: 20 });
    setMetric(d, "acv", acv);
    d.metrics = d.metrics.filter((x) => x.metricKey !== "paying_customers" || x.isPrimary === false);
    const f = findingsOf(run(d), "SELF_SERVE_WITH_ENTERPRISE_SIGNALS");
    expect(f.map((x) => x.severity)).toEqual(sev ? [sev] : []);
  });

  it("detects the claim from text and the cycle from the GTM section", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "sales_cycle_days");
    d.claims.push(claim("CLM-PLG", { category: "OTHER", statement: "Fully self-serve: teams sign up with a credit card", page: 8 }));
    d.gtm!.salesCycle = "6-9 months";
    const f = one(run(d), "SELF_SERVE_WITH_ENTERPRISE_SIGNALS");
    expect(f.severity).toBe("HIGH");
    expect(f.claimIds).toEqual(["CLM-PLG"]);
  });
});

describe("stale metrics used as current", () => {
  it.each([
    ["cash_balance", "HIGH"],
    ["runway_months", "HIGH"],
    ["arr", "MODERATE"],
    ["nrr", "MODERATE"],
    ["headcount", "LOW"],
  ])("stale primary %s → %s", (key, sev) => {
    const d = cleanDeal();
    const existing = d.metrics.find((x) => x.metricKey === key && x.isPrimary);
    setMetric(d, key, existing?.normalizedValue ?? 1_000_000, { unit: existing?.unit ?? "USD", sampleSize: 45, cohortDefinition: "trailing 12-month cohorts", state: "STALE", periodEnd: "2025-01", qualityFlags: ["STALE: 20 months old (max 6)"] });
    expect(findingsOf(run(d), "STALE_METRIC_AS_CURRENT").map((f) => f.severity)).toEqual([sev]);
  });
});

describe("derived vs reported disagreement", () => {
  it("INCONSISTENT_WITH_INPUTS without an implied row is reported by the rule", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-LTV", "ltv", 100_000, { qualityFlags: ["INCONSISTENT_WITH_INPUTS: recomputed 50000"] }));
    expect(one(run(d), "DERIVED_VS_REPORTED").severity).toBe("MODERATE");
  });

  it("is deduplicated when the implied-metric table already reports the same metric", () => {
    const d = cleanDeal();
    setMetric(d, "acv", 90_000, { qualityFlags: ["INCONSISTENT_WITH_INPUTS: recomputed 41739.1"] });
    const r = run(d);
    expect(kinds(r)).toContain("IMPLIED_ACV");
    expect(kinds(r)).not.toContain("DERIVED_VS_REPORTED");
  });

  it("monthly figure labelled ARR", () => {
    const d = cleanDeal();
    setMetric(d, "arr", 3_840_000, { qualityFlags: ["MONTHLY_FIGURE_LABELLED_ARR: annualized ×12"] });
    expect(kinds(run(d))).toContain("MONTHLY_FIGURE_AS_ARR");
  });
});
