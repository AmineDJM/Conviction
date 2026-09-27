/**
 * Adversarial suite — the extraction → normalization → integrity path.
 *
 * Passing tests pin the behaviour the integrity engine relies on. Bugs found
 * in files owned elsewhere (src/engine/metrics/normalize.ts, derive.ts) are
 * recorded as `it.skip` with a precise description instead of being fixed here.
 */
import { describe, expect, it } from "vitest";
import { normalizeObservation, parseScaledNumber, timeFactor } from "@/engine/metrics/normalize";
import { deriveMetrics } from "@/engine/metrics/derive";
import type { MetricObservation } from "@/domain/sections";
import type { CanonicalDeal } from "@/domain/canonical";
import { cleanDeal, kinds, obs, one, run } from "./fixtures/integrity/builders";
import { metric } from "./fixtures";

const ctx = { asOf: new Date("2026-09-27T00:00:00Z"), nextId: (() => { let i = 0; return () => `MET-N${++i}`; })(), sourceIdForPage: () => "SRC-001" };
const N = (key: string, value: number | null, extra: Partial<MetricObservation> = {}) => normalizeObservation(obs(key as MetricObservation["metricKey"], value, extra), ctx);

/** Build a deal the way the pipeline does: normalize every observation, then derive. */
function pipelineDeal(observations: MetricObservation[], patch: (d: CanonicalDeal) => void = () => {}): CanonicalDeal {
  const d = cleanDeal();
  let i = 0;
  const next = () => `MET-P${String(++i).padStart(3, "0")}`;
  const inst = observations.map((o) => normalizeObservation(o, { asOf: ctx.asOf, nextId: next, sourceIdForPage: () => "SRC-001" })).filter((x): x is NonNullable<typeof x> => x !== null);
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
  it("cumulative ARR is flagged", () => {
    expect(N("arr", 12_000_000, { periodType: "CUMULATIVE", rawText: "$12M" })!.qualityFlags.some((f) => f.startsWith("CUMULATIVE_NOT_RUN_RATE"))).toBe(true);
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
