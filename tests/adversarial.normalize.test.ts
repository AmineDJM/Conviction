/**
 * Adversarial suite — the extraction → normalization → integrity path.
 *
 * Passing tests pin the behaviour the integrity engine relies on. Bugs found
 * in files owned elsewhere (src/engine/metrics/normalize.ts, derive.ts) are
 * recorded as `it.skip` with a precise description instead of being fixed here.
 */
import { describe, expect, it } from "vitest";
import { normalizeObservation, parsePeriodDate, parseScaledNumber, propagateCumulative, timeFactor } from "@/engine/metrics/normalize";
import { deriveMetrics } from "@/engine/metrics/derive";
import type { MetricObservation } from "@/domain/sections";
import type { CanonicalDeal } from "@/domain/canonical";
import { cleanDeal, findingsOf, kinds, obs, one, run } from "./fixtures/integrity/builders";
import { metric } from "./fixtures";

const ctx = { asOf: new Date("2026-09-27T00:00:00Z"), nextId: (() => { let i = 0; return () => `MET-N${++i}`; })(), sourceIdForPage: () => "SRC-001" };
const N = (key: string, value: number | null, extra: Partial<MetricObservation> = {}) => normalizeObservation(obs(key as MetricObservation["metricKey"], value, extra), ctx);

/** Build a deal the way the pipeline does: normalize every observation, then derive. */
function pipelineDeal(observations: MetricObservation[], patch: (d: CanonicalDeal) => void = () => {}): CanonicalDeal {
  const d = cleanDeal();
  let i = 0;
  const next = () => `MET-P${String(++i).padStart(3, "0")}`;
  const inst = propagateCumulative(observations).map((o) => normalizeObservation(o, { asOf: ctx.asOf, nextId: next, sourceIdForPage: () => "SRC-001" })).filter((x): x is NonNullable<typeof x> => x !== null);
  d.metricObservations = observations;
  d.metrics = deriveMetrics(inst, next);
  patch(d);
  return d;
}

describe("normalization behaviour the integrity engine relies on", () => {
  it.each(["FORECAST", "TARGET", "PIPELINE"] as const)("%s observations never become metric instances", (basis) => {
    expect(N("arr", 9_000_000, { basis, rawText: "$9M ARR" })).toBeNull();
  });
  it.each(["SIGNED", "BOOKED"] as const)("ARR with basis %s is reclassified as contracted ARR with a flag", (basis) => {
    const r = N("arr", 2_000_000, { basis, rawText: "$2M ARR" })!;
    expect(r.metricKey).toBe("contracted_arr");
    expect(r.qualityFlags.some((f) => f.startsWith("SIGNED_NOT_DEPLOYED"))).toBe(true);
  });
  it("a cumulative total is never a current run-rate metric (kept in the raw trail; integrity reports it)", () => {
    expect(N("arr", 12_000_000, { periodType: "CUMULATIVE", rawText: "$12M" })).toBeNull();
    expect(N("revenue_ttm", 1_100_000, { label: "Revenue since launch", periodType: "CUMULATIVE", rawText: "$1.1M" })).toBeNull();
  });
  it.each([
    ["excluding inference and hosting", true],
    ["before human review costs", true],
    ["includes hosting, inference and support", false],
  ])("gross margin definition %j → GROSS_MARGIN_EXCLUDES_COGS %s", (def, flagged) => {
    const r = N("gross_margin", 80, { unit: "PERCENT", currency: null, rawText: "80%", definitionAsStated: def })!;
    expect(r.qualityFlags.some((f) => f.startsWith("GROSS_MARGIN_EXCLUDES_COGS"))).toBe(flagged);
  });
  it("model value disagreeing with the raw text is overridden and flagged", () => {
    const r = N("arr", 42_000_000, { rawText: "$4.2M ARR" })!;
    expect(r.normalizedValue).toBe(4_200_000);
    expect(r.qualityFlags[0]).toMatch(/^EXTRACTION_MISMATCH/);
  });
  it.each([
    ["$4.2M", 4_200_000],
    ["€850k", 850_000],
    ["1,250 customers", 1250],
    ["ARR 2025: $4.2M", 4_200_000],
    ["$4.2M vs $3.1M", null],
  ])("parseScaledNumber(%j) = %s", (raw, v) => {
    expect(parseScaledNumber(raw)).toBe(v);
  });
});

describe("pipeline end-to-end: observations → normalize → derive → integrity", () => {
  it("signed revenue labelled ARR surfaces as BOOKINGS_AS_ARR and never as ARR", () => {
    const d = pipelineDeal([obs("arr", 1_000_000, { rawText: "$1M ARR", page: 3 }), obs("arr", 4_000_000, { basis: "SIGNED", rawText: "$4M ARR", page: 5 }), obs("paying_customers", 20, { unit: "COUNT", currency: null, rawText: "20 customers", page: 4 })]);
    const r = run(d);
    expect(one(r, "BOOKINGS_AS_ARR").severity).toBe("HIGH");
    expect(r.impliedMetrics.find((x) => x.name === "ACV")!.impliedValue).toBe(50_000);
  });
  it("forecast ARR on its own leaves revenue missing and the forecast base undisclosed", () => {
    const d = pipelineDeal([obs("arr", 20_000_000, { basis: "FORECAST", periodEnd: "2028-12", rawText: "$20M ARR by 2028", page: 11 })]);
    const r = run(d);
    expect(r.expectedEvidence.items.find((i) => i.itemId === "revenue")!.presence).toBe("MISSING");
    expect(kinds(r)).toContain("FORECAST_BASE_NOT_DISCLOSED");
  });
  it("an ARR series one year apart yields derived growth, an ARR history and a consistent table", () => {
    const d = pipelineDeal([obs("arr", 3_000_000, { rawText: "$3M ARR", periodEnd: "2026-08", page: 3 }), obs("arr", 1_000_000, { rawText: "$1M ARR", periodEnd: "2025-08", page: 3 })]);
    const r = run(d);
    expect(r.expectedEvidence.items.find((i) => i.itemId === "arr_history")!.presence).toBe("PRESENT");
    expect(d.metrics.find((x) => x.metricKey === "arr_growth_yoy")!.normalizedValue).toBeCloseTo(200, 5);
  });
  it("a reported ACV inconsistent with ARR / customers is reported once (implied table), not twice", () => {
    const d = pipelineDeal([
      obs("arr", 3_000_000, { rawText: "$3M ARR", page: 3 }),
      obs("paying_customers", 30, { unit: "COUNT", currency: null, rawText: "30 customers", page: 4 }),
      obs("acv", 250_000, { rawText: "$250k ACV", page: 6 }),
    ]);
    const r = run(d);
    expect(r.findings.filter((f) => f.kind === "IMPLIED_ACV" || f.kind === "DERIVED_VS_REPORTED").map((f) => f.kind)).toEqual(["IMPLIED_ACV"]);
  });
});

describe("previously-known normalization bugs (fixed; regression tests)", () => {
  it("normalize.timeFactor: 'days' should win over a parenthetical 'months' — '90 days (about 3 months)' becomes 2,739.6 days", () => {
    expect(N("sales_cycle_days", 90, { unit: "DAYS", currency: null, rawText: "90 days (about 3 months)" })!.normalizedValue).toBe(90);
    expect(timeFactor("90 days (3 months)", "DAYS")).toBe(1);
  });
  it("normalize.timeFactor: abbreviations 'mo', 'mos', 'wk', 'wks' are not recognised — '3 mo' sales cycle is read as 3 days", () => {
    expect(N("sales_cycle_days", 3, { unit: "DAYS", currency: null, rawText: "3 mo" })!.normalizedValue).toBeCloseTo(91.3, 0);
    expect(N("sales_cycle_days", 6, { unit: "DAYS", currency: null, rawText: "6 wks" })!.normalizedValue).toBe(42);
  });
  it("normalize gross-margin exclusion regex has no word boundary: 'complex human review' matches 'ex human review' → false GROSS_MARGIN_EXCLUDES_COGS", () => {
    const r = N("gross_margin", 70, { unit: "PERCENT", currency: null, rawText: "70%", definitionAsStated: "includes inference for complex human review workloads" })!;
    expect(r.qualityFlags.some((f) => f.startsWith("GROSS_MARGIN_EXCLUDES_COGS"))).toBe(false);
  });
  it("normalize customer-count regex has no word boundaries: 'industrial' contains 'trial' → false CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING (likewise 'carefree' ⊃ 'free', 'apocalypse' ⊃ 'poc')", () => {
    const r = N("paying_customers", 40, { unit: "COUNT", currency: null, rawText: "40 customers", definitionAsStated: "paying industrial customers" })!;
    expect(r.qualityFlags.some((f) => f.startsWith("CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING"))).toBe(false);
  });
  it("normalize ARR regex has no word boundaries: 'financial services customers' and 'redesigned' (⊃ 'signed') → false ARR_MAY_INCLUDE_NON_RECURRING", () => {
    expect(N("arr", 2e6, { rawText: "$2M ARR", definitionAsStated: "ARR from financial services customers" })!.qualityFlags).toEqual([]);
    expect(N("arr", 2e6, { rawText: "$2M ARR", definitionAsStated: "recurring revenue from our redesigned product" })!.qualityFlags).toEqual([]);
  });
  it("normalize drops current-year observations with a year-only or quarter period: '2026' and '2026-Q2' parse to Dec 28 2026 (> asOf + 31 days) and the metric silently disappears", () => {
    expect(N("arr", 2e6, { rawText: "$2M ARR", periodEnd: "2026" })).not.toBeNull();
    expect(N("arr", 2e6, { rawText: "$2M ARR", periodEnd: "2026-Q2" })).not.toBeNull();
  });
  it("normalize: SIGNED/BOOKED basis is only handled for arr/mrr/revenue_ttm — '25 signed customers' becomes 25 paying_customers with no flag", () => {
    const r = N("paying_customers", 25, { unit: "COUNT", currency: null, rawText: "25 signed customers", basis: "SIGNED" })!;
    expect(r.qualityFlags.some((f) => /SIGNED|NON_PAYING/.test(f))).toBe(true);
  });
  it("normalize NO_DENOMINATOR: a population written as '45 enterprise customers' (adjective between number and noun) is not recognised", () => {
    const r = N("nrr", 118, { unit: "PERCENT", currency: null, rawText: "118% NRR", definitionAsStated: "measured across 45 enterprise customers", cohortDefinition: "ttm" })!;
    expect(r.qualityFlags.some((f) => f.startsWith("NO_DENOMINATOR"))).toBe(false);
  });
  it("normalize percent-fraction heuristic misfires on genuinely small percentages without a % sign: 'default rate 0.9' becomes 90%", () => {
    expect(N("default_rate", 0.9, { unit: "PERCENT", currency: null, rawText: "default rate 0.9" })!.normalizedValue).toBe(0.9);
  });
  it("derive.deriveMetrics mutates the caller's metric objects (qualityFlags arrays are shared by selectPrimary's shallow copies) and re-deriving accumulates duplicate INCONSISTENT_WITH_INPUTS flags", () => {
    const input = [metric("arr", 1_000_000, { id: "A" }), metric("paying_customers", 10, { id: "C", unit: "COUNT" }), metric("acv", 500_000, { id: "V" })];
    deriveMetrics(input, () => "D1");
    expect(input.find((x) => x.id === "V")!.qualityFlags).toEqual([]);
    deriveMetrics(input, () => "D2");
    expect(input.find((x) => x.id === "V")!.qualityFlags.filter((f) => f.startsWith("INCONSISTENT")).length).toBeLessThanOrEqual(1);
  });
  it("normalize.monthsBetween uses local-time getters on UTC dates: staleness depends on the server time zone (e.g. TZ=America/Los_Angeles turns '2026-03-01' into February → ARR flagged STALE at 7 months)", () => {
    const prev = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const r = normalizeObservation(obs("arr", 2e6, { rawText: "$2M ARR", periodEnd: "2026-03-01" }), { ...ctx, asOf: new Date("2026-09-15T12:00:00Z") })!;
      expect(r.state).toBe("OBSERVED");
    } finally {
      process.env.TZ = prev;
    }
  });
});

describe("sub-team counts are never company headcount", () => {
  it.each([
    ["7 AEs", "Mid-market sales team of 7 AEs"],
    ["12 engineers", "Engineering: 12 engineers"],
    ["sales team of 5", "Our sales team of 5 reps"],
  ])("%s is dropped from headcount", (raw, excerpt) => {
    expect(N("headcount", 7, { unit: "COUNT", currency: null, rawText: raw, excerpt })).toBeNull();
  });
  it.each([
    ["38", "Team of 38."],
    ["38 employees including 7 AEs", "38 employees including 7 AEs"],
    ["42 FTEs", "42 FTEs across Paris and NYC"],
  ])("%s stays headcount", (raw, excerpt) => {
    expect(N("headcount", 38, { unit: "COUNT", currency: null, rawText: raw, excerpt })).not.toBeNull();
  });
});

describe("ARR tagged MONTHLY is annualized only when the materials state a monthly figure", () => {
  it("does not multiply 'ARR (Aug 2026) $5.6M' by 12 because extraction tagged it MONTHLY", () => {
    const r = N("arr", 5_600_000, { label: "ARR (Aug 2026)", rawText: "$5.6M", periodType: "MONTHLY", excerpt: "ARR (Aug 2026) $5.6M · Net burn $480k / month" })!;
    expect(r.normalizedValue).toBe(5_600_000);
    expect(r.qualityFlags.join(" ")).toContain("PERIOD_TYPE_NOT_STATED_MONTHLY");
  });
  it.each([
    ["ARR", "$400k/month"],
    ["ARR", "$400k per month"],
    ["MRR", "$400k"],
    ["ARR", "400 k€ par mois"],
  ])("annualizes %s %s", (label, rawText) => {
    const r = N("arr", 400_000, { label, rawText, periodType: "MONTHLY" })!;
    expect(r.normalizedValue).toBe(4_800_000);
    expect(r.qualityFlags.join(" ")).toContain("MONTHLY_FIGURE_LABELLED_ARR");
  });
});

describe("key corrections from the figure's own label (label_key_rules_v1)", () => {
  it("files 'Gross logo retention' under logo retention, not GRR", () => {
    const r = N("grr", 94, { label: "Gross logo retention", rawText: "94%", unit: "PERCENT", currency: null })!;
    expect(r.metricKey).toBe("logo_retention");
    expect(r.qualityFlags.join(" ")).toContain("KEY_FROM_LABEL");
  });
  it("keeps gross revenue retention as GRR", () => {
    expect(N("grr", 91, { label: "Gross revenue retention", rawText: "91%", unit: "PERCENT", currency: null })!.metricKey).toBe("grr");
  });
  it("files '27 paid pilots' under pilots, not paying customers", () => {
    expect(N("paying_customers", 27, { label: "Paid pilots", rawText: "27 paid pilots", unit: "COUNT", currency: null })!.metricKey).toBe("pilots");
  });
  it("keeps 'Customers (incl. pilots)' as paying customers (flagged elsewhere)", () => {
    expect(N("paying_customers", 41, { label: "Customers (incl. pilots)", rawText: "41", unit: "COUNT", currency: null })!.metricKey).toBe("paying_customers");
  });
  it("never files completed pilots as active pilots", () => {
    expect(N("pilots", 11, { label: "Completed pilots", rawText: "11", unit: "COUNT", currency: null })).toBeNull();
  });
  it("never files a partner-channel share as founder-led revenue", () => {
    expect(N("founder_led_revenue_share", 34, { label: "Share of new ARR from NetSuite partners", rawText: "34%", unit: "PERCENT", currency: null })).toBeNull();
  });
  it("reads 'Listings that sell within 30 days' as a fill rate", () => {
    const r = N("OTHER", 58, { label: "Listings sold within 30 days", rawText: "58%", unit: "PERCENT", currency: null })!;
    expect(r.metricKey).toBe("fill_rate");
    expect(r.normalizedValue).toBe(58);
  });
  it("leaves unrelated OTHER figures out of the metrics", () => {
    expect(N("OTHER", 210, { label: "Active sellers", rawText: "210", unit: "COUNT", currency: null })).toBeNull();
  });
});

describe("gross volume reported as revenue (take-rate business)", () => {
  const crateroute = () => [
    obs("revenue_ttm", 8_200_000, { label: "Revenue", rawText: "$8.2M revenue in 2025", periodType: "ANNUAL", periodEnd: "2025-12", basis: "ACTUAL" }),
    obs("gmv", 8_200_000, { label: "Revenue 2025 / gross order value", rawText: "$8.2M", periodType: "ANNUAL", periodEnd: "2025-12", basis: "ACTUAL" }),
    obs("take_rate", 11, { label: "Take rate", rawText: "11%", unit: "PERCENT", currency: null, periodEnd: "2026-06" }),
  ];

  it("never scores the gross figure as revenue; net revenue is estimated as GMV × take rate", () => {
    const d = pipelineDeal(crateroute());
    const primary = d.metrics.find((x) => x.metricKey === "revenue_ttm" && x.isPrimary)!;
    expect(primary.normalizedValue).toBeCloseTo(902_000, -2);
    expect(primary.calculationMethod).toBe("DERIVED");
    expect(primary.qualityFlags).toContain("NET_REVENUE_ESTIMATED_FROM_GMV");
    const gross = d.metrics.find((x) => x.metricKey === "revenue_ttm" && x.calculationMethod === "REPORTED")!;
    expect(gross.state).toBe("CONTRADICTED");
    expect(kinds(run(d))).toContain("GMV_AS_REVENUE");
  });

  it("leaves real net revenue alone", () => {
    const o = crateroute();
    o[0] = obs("revenue_ttm", 900_000, { label: "Net revenue", rawText: "$0.9M", periodType: "ANNUAL", periodEnd: "2025-12", basis: "ACTUAL" });
    const d = pipelineDeal(o);
    const primary = d.metrics.find((x) => x.metricKey === "revenue_ttm" && x.isPrimary)!;
    expect(primary.calculationMethod).toBe("REPORTED");
    expect(primary.state).not.toBe("CONTRADICTED");
  });

  it("without a take rate nothing is demoted (the integrity finding still asks)", () => {
    const d = pipelineDeal(crateroute().slice(0, 2));
    expect(d.metrics.find((x) => x.metricKey === "revenue_ttm" && x.isPrimary)!.state).not.toBe("CONTRADICTED");
  });
});

describe("scale words, decimal commas and currency symbols", () => {
  it.each([
    ["ARR de 15 millions d'euros", 15e6, "EUR"],
    ["ARR 4.2 MEUR", 4.2e6, "EUR"],
    ["850 KEUR", 850e3, "EUR"],
    ["$4.2 millions", 4.2e6, "USD"],
    ["1,5 Md€", 1.5e9, "EUR"],
  ])("'%s' keeps its scale", (rawText, v, currency) => {
    const r = N("arr", v, { rawText, currency })!;
    const usd = currency === "EUR" ? r.normalizedValue! / v : r.normalizedValue! / v;
    expect(usd).toBeGreaterThan(0.9);
    expect(usd).toBeLessThan(1.3);
  });
  it("'1,250 M€' (decimal comma or thousands?) keeps the model's value, flagged", () => {
    const r = N("revenue_ttm", 1.25e6, { rawText: "CA 1,250 M€", currency: "EUR" })!;
    expect(r.qualityFlags.join(" ")).toContain("SCALE_AMBIGUOUS");
    expect(r.normalizedValue! / 1.25e6).toBeLessThan(1.3);
  });
  it("a model scale mistake with an unambiguous scale word is still corrected", () => {
    expect(N("arr", 4200, { rawText: "$4.2M" })!.normalizedValue).toBe(4_200_000);
  });
  it.each(["€", "£", "US$"])("currency symbol %s converts instead of dropping the value", (currency) => {
    const r = N("arr", 4_200_000, { rawText: "4.2M", currency })!;
    expect(r.normalizedValue).not.toBeNull();
    expect(r.state).not.toBe("UNKNOWN");
  });
});

describe("durations are converted once", () => {
  it.each([
    ["Sales cycle: 2 to 3 months", 75, 75],
    ["6-8 weeks sales cycle", 49, 49],
    ["6 weeks", 42, 42],
    ["6 weeks", 6, 42],
    ["2 to 3 months", 2.5, 76.1],
  ])("sales cycle '%s' with model value %d → %d days", (rawText, v, days) => {
    expect(N("sales_cycle_days", v, { rawText, unit: "DAYS", currency: null })!.normalizedValue).toBeCloseTo(days, 0);
  });
  it("CAC payback '1-2 years' given as 18 months stays 18", () => {
    expect(N("cac_payback_months", 18, { rawText: "CAC payback 1-2 years", unit: "MONTHS", currency: null })!.normalizedValue).toBeCloseTo(18, 1);
  });
});

it("ARR described as 'MRR × 12' is not annualized again", () => {
  expect(N("arr", 5_600_000, { label: "ARR (MRR × 12)", rawText: "$5.6M", periodType: "MONTHLY" })!.normalizedValue).toBe(5_600_000);
});

describe("period-over-period derivations are annualized", () => {
  it("ARR growth over 14 months is compounded to 12 months; burn multiple scales net new ARR", () => {
    const d = pipelineDeal([
      obs("arr", 1_000_000, { label: "ARR", rawText: "$1M", periodEnd: "2025-06" }),
      obs("arr", 3_000_000, { label: "ARR", rawText: "$3M", periodEnd: "2026-08" }),
      obs("monthly_net_burn", 400_000, { label: "Net burn", rawText: "$400k", periodEnd: "2026-08" }),
    ]);
    const g = d.metrics.find((x) => x.metricKey === "arr_growth_yoy" && x.isPrimary)!;
    expect(g.normalizedValue).toBeCloseTo((Math.pow(3, 12 / 14) - 1) * 100, 1);
    expect(g.qualityFlags).toContain("ANNUALIZED_FROM_14_MONTHS");
    const bm = d.metrics.find((x) => x.metricKey === "burn_multiple" && x.isPrimary)!;
    expect(bm.normalizedValue).toBeCloseTo((400_000 * 12) / ((2_000_000 * 12) / 14), 2);
  });
  it("exactly 12 months is unchanged", () => {
    const d = pipelineDeal([obs("arr", 1_000_000, { rawText: "$1M", periodEnd: "2025-08" }), obs("arr", 3_000_000, { rawText: "$3M", periodEnd: "2026-08" })]);
    expect(d.metrics.find((x) => x.metricKey === "arr_growth_yoy" && x.isPrimary)!.normalizedValue).toBeCloseTo(200, 5);
  });
  it("DAU/MAU is not invented when MAU is zero", () => {
    const d = pipelineDeal([obs("dau", 100, { unit: "COUNT", currency: null, rawText: "100" }), obs("mau", 0, { unit: "COUNT", currency: null, rawText: "0" })]);
    expect(d.metrics.some((x) => x.metricKey === "dau_mau")).toBe(false);
  });
});

describe("period parsing", () => {
  it.each([
    ["Jun 2025", "2025-06-28"],
    ["June 2025", "2025-06-28"],
    ["juin 2025", "2025-06-28"],
    ["Aug-26", "2026-08-28"],
    ["août 2026", "2026-08-28"],
    ["FY24", "2024-12-28"],
    ["2026-02-28", "2026-02-28"],
  ])("%s → %s", (s, iso) => expect(parsePeriodDate(s)!.toISOString().slice(0, 10)).toBe(iso));
  it.each(["2026-02-30", "2026-13", "Foo 2025"])("%s is rejected", (s) => expect(parsePeriodDate(s)).toBeNull());
});

it("a percent given as a fraction while the raw text says '92%' is read as 92", () => {
  expect(N("nrr", 0.92, { rawText: "92%", unit: "PERCENT", currency: null })!.normalizedValue).toBe(92);
  expect(N("default_rate", 0.8, { rawText: "0.8%", unit: "PERCENT", currency: null })!.normalizedValue).toBe(0.8);
});

describe("corpus regressions (second full eval run)", () => {
  it("Drypoint: ARR including signed-not-deployed contracts loses to the live ARR of the same period", () => {
    const d = pipelineDeal([
      obs("arr", 2_400_000, { label: "ARR", rawText: "$2.4M", periodType: "ANNUAL", periodEnd: "2026-05", definitionAsStated: "ARR includes signed utility contracts not yet deployed." }),
      obs("arr", 310_000, { label: "Live subscription ARR", rawText: "$0.31M", periodType: "ANNUAL", periodEnd: "2026-05", definitionAsStated: "Live subscription ARR, excluding signed utility contracts not yet deployed." }),
    ]);
    const p = d.metrics.find((x) => x.metricKey === "arr" && x.isPrimary)!;
    expect(p.normalizedValue).toBe(310_000);
    expect(p.qualityFlags.join(" ")).not.toContain("ARR_MAY_INCLUDE_NON_RECURRING");
    const broad = d.metrics.find((x) => x.metricKey === "arr" && x.normalizedValue === 2_400_000)!;
    expect(broad.state).toBe("CONTRADICTED");
    expect(broad.qualityFlags.join(" ")).toContain("BROADER_THAN_NARROW_FIGURE");
  });

  it("Clausewren: 41 'customers' including pilots lose to 8 in production", () => {
    const d = pipelineDeal([
      obs("paying_customers", 41, { label: "Enterprise customers", rawText: "41", unit: "COUNT", currency: null, periodEnd: "2026-07", definitionAsStated: "Enterprise customers including 27 paid pilots and 6 design partners" }),
      obs("paying_customers", 8, { label: "Customers in production on annual contracts", rawText: "8 customers", unit: "COUNT", currency: null, periodEnd: "2026-07" }),
    ]);
    expect(d.metrics.find((x) => x.metricKey === "paying_customers" && x.isPrimary)!.normalizedValue).toBe(8);
  });

  it("a broad figure alone is kept (flagged), never dropped", () => {
    const d = pipelineDeal([obs("arr", 2_400_000, { rawText: "$2.4M", periodEnd: "2026-05", definitionAsStated: "includes signed contracts" })]);
    const p = d.metrics.find((x) => x.metricKey === "arr" && x.isPrimary)!;
    expect(p.state).toBe("OBSERVED");
    expect(p.qualityFlags.join(" ")).toContain("ARR_MAY_INCLUDE_NON_RECURRING");
  });

  it("Carbonmoss: 'Company headcount' filed as OTHER is the headcount; employee ranges of customers are not", () => {
    expect(N("OTHER", 8, { label: "Company headcount", rawText: "8", unit: "COUNT", currency: null })!.metricKey).toBe("headcount");
    expect(N("OTHER", 200, { label: "Target manufacturer employee range — lower bound", rawText: "200", unit: "COUNT", currency: null })).toBeNull();
  });

  it("Crateroute: GMV labelled as revenue is reported even when no revenue figure was extracted", () => {
    const d = pipelineDeal([
      obs("gmv", 8_200_000, { label: "Revenue 2025 (gross order value through the platform)", rawText: "$8.2M", periodType: "ANNUAL", periodEnd: "2025-12", basis: "ACTUAL" }),
      obs("take_rate", 11, { label: "Take rate", rawText: "11%", unit: "PERCENT", currency: null }),
    ]);
    expect(findingsOf(run(d), "GMV_AS_REVENUE").map((f) => f.severity)).toContain("CRITICAL");
  });
});

describe("corpus regressions (third full eval run)", () => {
  it("Drypoint: the headline ARR and its footnote are one figure carrying the footnote's inclusion", () => {
    const d = pipelineDeal([
      obs("arr", 2_400_000, { label: "ARR", rawText: "$2.4M", periodType: "ANNUAL", periodEnd: null }),
      obs("arr", 2_400_000, { label: "ARR including signed utility contracts not yet deployed", rawText: "$2.4M", periodType: "ANNUAL", periodEnd: null, definitionAsStated: "ARR includes $2.09M of signed utility contracts not yet deployed" }),
      obs("arr", 310_000, { label: "Live subscription ARR", rawText: "$0.31M", periodType: "ANNUAL", periodEnd: null, definitionAsStated: "ARR from live subscriptions." }),
    ]);
    expect(d.metrics.find((x) => x.metricKey === "arr" && x.isPrimary)!.normalizedValue).toBe(310_000);
  });

  it("Clausewren: pilots stated as included in the customer count are reported without any customer metric", () => {
    const d = pipelineDeal([obs("pilots", 27, { label: "Paid pilots", rawText: "27 paid pilots", unit: "COUNT", currency: null, periodEnd: "2026-07", definitionAsStated: "Enterprise customers that are paid pilots", components: ["included in enterprise customer count"] })]);
    expect(findingsOf(run(d), "PILOTS_AS_CUSTOMERS").map((f) => f.severity)).toContain("HIGH");
  });

  it("pilots mentioned without being counted as customers are not reported", () => {
    const d = pipelineDeal([obs("pilots", 12, { label: "Active paid pilots", rawText: "12", unit: "COUNT", currency: null, periodEnd: "2026-07" })]);
    expect(kinds(run(d))).not.toContain("PILOTS_AS_CUSTOMERS");
  });
});

describe("corpus regressions (fifth full eval run)", () => {
  it("Drypoint: a headline ARR equal to live ARR + contracted ARR includes the contracted part; the live ARR is the metric", () => {
    const d = pipelineDeal([
      obs("arr", 2_400_000, { label: "ARR", rawText: "$2.4M", periodType: "ANNUAL", periodEnd: "2026-05" }),
      obs("contracted_arr", 2_090_000, { label: "Signed utility contracts ARR not yet deployed", rawText: "$2.09M", periodType: "ANNUAL", periodEnd: "2026-05", basis: "SIGNED" }),
      obs("arr", 310_000, { label: "Live subscription ARR", rawText: "$0.31M", periodType: "ANNUAL", periodEnd: "2026-05", definitionAsStated: "Live subscription ARR, excluding signed utility contracts not yet deployed.", components: ["live subscription ARR", "excludes $2.09M signed utility contracts not yet deployed"] }),
    ]);
    expect(d.metrics.find((x) => x.metricKey === "arr" && x.isPrimary)!.normalizedValue).toBe(310_000);
    const live = d.metrics.find((x) => x.metricKey === "arr" && x.normalizedValue === 310_000)!;
    expect(live.qualityFlags.join(" ")).not.toContain("ARR_MAY_INCLUDE_NON_RECURRING");
  });

  it("an exclusion clause runs to the end of its sentence even through a decimal amount", () => {
    const r = N("arr", 310_000, { rawText: "$0.31M", definitionAsStated: "Live ARR, excluding $2.09M of signed contracts not yet deployed." })!;
    expect(r.qualityFlags.join(" ")).not.toContain("ARR_MAY_INCLUDE_NON_RECURRING");
    const r2 = N("arr", 2_400_000, { rawText: "$2.4M", definitionAsStated: "Excluding services. Includes $2.09M signed contracts." })!;
    expect(r2.qualityFlags.join(" ")).toContain("ARR_MAY_INCLUDE_NON_RECURRING");
  });

  it("Carbonmoss: 'Team headcount' is the headcount", () => {
    expect(N("OTHER", 8, { label: "Team headcount", rawText: "8", unit: "COUNT", currency: null })!.metricKey).toBe("headcount");
  });
});

describe("corpus regressions (ninth full eval run)", () => {
  it("Clausewren: a customer total with a stated breakdown yields paying customers = total − stated non-paying parts", () => {
    const d = pipelineDeal([
      obs("paying_customers", 41, { label: "Enterprise customers", rawText: "Enterprise customers 41", unit: "COUNT", currency: null, periodEnd: "2026-07-31", definitionAsStated: "Enterprise customers; the deck separately states that this total includes paid pilots and design partners.", components: ["includes 27 paid pilots", "includes 6 design partners", "8 customers are in production on annual contracts"] }),
    ]);
    const p = d.metrics.find((x) => x.metricKey === "paying_customers" && x.isPrimary)!;
    expect(p.normalizedValue).toBe(8);
    expect(p.qualityFlags).toContain("NARROWED_FROM_STATED_BREAKDOWN");
    expect(p.qualityFlags.join(" ")).not.toContain("CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING");
    expect(kinds(run(d))).toContain("PILOTS_AS_CUSTOMERS");
    expect(d.metrics.find((x) => x.metricKey === "paying_customers" && x.normalizedValue === 41)!.state).toBe("CONTRADICTED");
  });
  it("without a stated breakdown the total is kept (flagged), never guessed", () => {
    const d = pipelineDeal([obs("paying_customers", 41, { label: "Customers", rawText: "41", unit: "COUNT", currency: null, periodEnd: "2026-07", definitionAsStated: "customers including pilots" })]);
    const p = d.metrics.find((x) => x.metricKey === "paying_customers" && x.isPrimary)!;
    expect(p.normalizedValue).toBe(41);
    expect(p.state).toBe("OBSERVED");
  });
});

describe("corpus regressions (tenth full eval run)", () => {
  it("Carbonmoss: the title slide's undated '$1.1M revenue' is the same cumulative figure, not current revenue", () => {
    const d = pipelineDeal([
      obs("revenue_ttm", 1_100_000, { label: "Revenue", rawText: "$1.1M revenue", periodType: "UNSPECIFIED", periodEnd: null, basis: "ACTUAL" }),
      obs("revenue_ttm", 1_100_000, { label: "Revenue since launch (2024 → Jul 2026)", rawText: "$1.1M", periodType: "CUMULATIVE", periodStart: "2024-01-01", periodEnd: "2026-07-31", basis: "ACTUAL" }),
    ]);
    expect(d.metrics.some((x) => x.metricKey === "revenue_ttm")).toBe(false);
    expect(kinds(run(d))).toContain("CUMULATIVE_AS_RUN_RATE");
  });
  it("a dated figure of the same value is left alone", () => {
    const o = propagateCumulative([
      obs("revenue_ttm", 1_100_000, { rawText: "$1.1M", periodType: "ANNUAL", periodEnd: "2025-12" }),
      obs("revenue_ttm", 1_100_000, { rawText: "$1.1M", periodType: "CUMULATIVE", periodEnd: "2026-07" }),
    ]);
    expect(o[0]!.periodType).toBe("ANNUAL");
  });
});
