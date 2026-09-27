/**
 * Latent Signal Engine — what the deck reveals beyond what it claims.
 * Deterministic, observable signals only; secondary to the OQI.
 */
import { describe, expect, it } from "vitest";
import { emptyCanonical, type CanonicalDeal, type Claim } from "@/domain/canonical";
import type { LatentSignalsDraft, MetricObservation } from "@/domain/sections";
import { getRegistry } from "@/engine/benchmarks";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { latentReport, efficiencyRatios, compareEfficiency, EFFICIENCY_LABEL, arrBridge, DECISION_TABLE } from "@/engine/latent";
import { matchVanity } from "@/engine/latent/decision-metrics";
import { isApproximate } from "@/engine/latent/precision";
import { geoScope } from "@/engine/latent/ambition";
import { marketSizingStyle } from "@/engine/latent/thinking";
import { derive } from "@/engine/derive";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { PROFILE_IDS, STAGE_BANDS } from "@/engine/benchmarks/types";
import { makeDeal, metric } from "./fixtures";

const reg = getRegistry();
const asOf = new Date("2026-09-27T00:00:00Z");

function obs(metricKey: MetricObservation["metricKey"], value: number | null, extra: Partial<MetricObservation> = {}): MetricObservation {
  return {
    metricKey,
    label: metricKey,
    rawText: value === null ? "n/a" : String(value),
    value,
    unit: "USD_OR_CURRENCY",
    currency: "USD",
    periodType: "POINT_IN_TIME",
    periodStart: null,
    periodEnd: "2026-08",
    definitionAsStated: null,
    components: [],
    sampleSize: null,
    cohortDefinition: null,
    state: "OBSERVED",
    basis: "CURRENT",
    sourceKind: "TEXT",
    page: 3,
    excerpt: "",
    ...extra,
  };
}

function signals(extra: Partial<LatentSignalsDraft> = {}): LatentSignalsDraft {
  return {
    operatingMaturity: [],
    reasoningChains: [],
    vanityMetricsShown: [],
    presentationTechniques: [],
    disclosures: [],
    ambition: { headline: "", operationalRoadmap: "", bridge: "", consistency: "UNCLEAR" },
    causalExplanations: [],
    ...extra,
  };
}

function claim(id: string, statement: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    category: "OTHER",
    statement,
    valueText: null,
    entity: "company",
    period: null,
    material: true,
    unusualness: 2,
    proposition: null,
    evidenceNeeded: null,
    origin: "COMPANY",
    verification: "UNVERIFIED",
    freshness: "CURRENT",
    independence: "COMPANY_DERIVED",
    verificationMethod: "Stated in company materials",
    limitations: null,
    contradictions: [],
    evidence: [{ sourceId: "SRC-001", effect: "ORIGIN", excerpt: statement, location: "p. 4", note: null }],
    history: [],
    ...extra,
  };
}

function run(d: CanonicalDeal, when: Date = asOf) {
  return latentReport(d, reg, resolvePeerGroup(d.classification), { asOf: when });
}

/** Enterprise SaaS deal with metrics only in the raw observation trail. */
function saas(stage: CanonicalDeal["classification"]["financingStage"], obsList: MetricObservation[], extra: Partial<CanonicalDeal> = {}): CanonicalDeal {
  const d = makeDeal();
  d.classification = { ...d.classification, financingStage: stage };
  d.metrics = [];
  d.metricObservations = obsList;
  return { ...d, ...extra };
}

function marketplace(obsList: MetricObservation[], stage: CanonicalDeal["classification"]["financingStage"] = "SEED"): CanonicalDeal {
  const d = makeDeal();
  d.classification = { ...d.classification, industry: ["RETAIL_COMMERCE"], productType: ["MARKETPLACE"], revenueModel: ["TAKE_RATE"], gtm: ["MARKETPLACE"], financingStage: stage };
  d.metrics = [];
  d.metricObservations = obsList;
  return d;
}

const vanityMarketplace = () =>
  marketplace([
    obs("OTHER", 250_000, { label: "App downloads", rawText: "250k downloads", unit: "COUNT", currency: null, page: 5 }),
    obs("OTHER", 80_000, { label: "Registered users", rawText: "80,000 registered users", unit: "COUNT", currency: null, page: 5 }),
    obs("gmv", 12_000_000, { label: "GMV since launch", rawText: "$12M GMV since launch", periodType: "CUMULATIVE", page: 6 }),
  ]);

/* ================================================================== */
/* §3 Metric selection intelligence                                    */
/* ================================================================== */

describe("§3 metric selection — decision coverage and vanity dependence", () => {
  it("marketplace with downloads / registered users / cumulative GMV and no repeat or take rate → HIGH vanity dependence, low coverage", () => {
    const r = run(vanityMarketplace()).metricSelection;
    expect(r.vanityDependence).toBe("HIGH");
    expect(r.decisionCoveragePct).toBeLessThan(30);
    expect(r.absentDecisionMetrics).toEqual(expect.arrayContaining(["Take rate", "Repeat rate"]));
    expect(r.vanitySharePct).toBe(100);
  });

  it("lists each vanity metric with its page and flags the decision metrics it stands in for", () => {
    const r = run(vanityMarketplace()).metricSelection;
    expect(r.vanityMetrics.map((v) => v.pattern).sort()).toEqual(["Cumulative / since-inception revenue or GMV", "Downloads / installs", "Registered users"]);
    expect(r.vanityMetrics.every((v) => v.page !== null)).toBe(true);
    expect(r.vanityInPlaceOfDecision.map((v) => v.absentDecisionMetric)).toContain("Repeat rate");
  });

  it("marketplace showing GMV, take rate, net revenue, repeat rate and burn → full coverage, LOW vanity", () => {
    const d = marketplace([
      obs("gmv", 20_000_000, { rawText: "$20M GMV (LTM)" }),
      obs("take_rate", 12, { unit: "PERCENT", currency: null }),
      obs("revenue_ttm", 2_400_000),
      obs("repeat_rate", 48, { unit: "PERCENT", currency: null }),
      obs("monthly_net_burn", 180_000),
    ]);
    const r = run(d).metricSelection;
    expect(r.decisionCoveragePct).toBe(100);
    expect(r.vanityDependence).toBe("LOW");
  });

  it("the Series A SaaS fixture covers 8 of 10 expected decision metrics (ACV and sales cycle absent)", () => {
    const r = run(makeDeal()).metricSelection;
    expect(r.expectedCount).toBe(10);
    expect(r.presentCount).toBe(8);
    expect(r.decisionCoveragePct).toBe(80);
    expect(r.absentDecisionMetrics.sort()).toEqual(["ACV / ARPA", "Sales cycle"]);
  });

  it("pre-revenue companies are not expected to show revenue metrics", () => {
    const d = makeDeal();
    d.classification = { ...d.classification, revenueModel: ["PRE_REVENUE"], operationalMaturity: "PROTOTYPE", financingStage: "SEED" };
    d.metrics = [];
    const r = run(d).metricSelection;
    expect(r.slots.filter((s) => s.expected).map((s) => s.slotId)).toEqual(["customers", "burn"]);
    expect(r.slots.find((s) => s.slotId === "revenue")!.status).toBe("NOT_APPLICABLE");
  });

  it("a cumulative GMV does not satisfy the GMV decision slot", () => {
    const r = run(vanityMarketplace()).metricSelection;
    expect(r.slots.find((s) => s.slotId === "gmv")!.status).toBe("ABSENT");
  });

  it("merges the model's vanity list with computed detections (both sources recorded)", () => {
    const d = vanityMarketplace();
    d.latentSignals = signals({ vanityMetricsShown: [{ metric: "downloads", page: 5, decisionMetricItDisplaces: "D30 retention" }] });
    const v = run(d).metricSelection.vanityMetrics.find((x) => x.pattern === "Downloads / installs")!;
    expect(v.sources).toEqual(["COMPUTED", "MODEL_OBSERVED"]);
  });

  it("a model-only vanity metric maps its displaced decision metric onto the peer-group table", () => {
    const d = marketplace([obs("take_rate", 12, { unit: "PERCENT", currency: null })]);
    d.latentSignals = signals({ vanityMetricsShown: [{ metric: "Community of 40k founders", page: 2, decisionMetricItDisplaces: "repeat rate" }] });
    const r = run(d).metricSelection;
    expect(r.vanityMetrics).toHaveLength(1);
    expect(r.vanityMetrics[0]!.sources).toEqual(["MODEL_OBSERVED"]);
    expect(r.vanityInPlaceOfDecision.map((v) => v.absentDecisionMetric)).toContain("Repeat rate");
  });

  it.each([
    ["App downloads", "1.2M downloads", "COUNT", "OTHER", "DOWNLOADS"],
    ["Registered users", "80k registered users", "COUNT", "OTHER", "REGISTERED_USERS"],
    ["Sign-ups", "12,000 sign-ups", "COUNT", "OTHER", "SIGN_UPS"],
    ["Waitlist", "5,000 on the waitlist", "COUNT", "OTHER", "WAITLIST"],
    ["Followers", "40k followers", "COUNT", "OTHER", "FOLLOWERS"],
    ["Impressions", "3M impressions", "COUNT", "OTHER", "IMPRESSIONS"],
    ["Page views", "900k page views", "COUNT", "OTHER", "IMPRESSIONS"],
    ["Total users", "150k total users", "COUNT", "OTHER", "TOTAL_USERS"],
    ["LOIs", "14 LOIs", "COUNT", "OTHER", "LOIS"],
    ["Pipeline", "$8M pipeline", "USD_OR_CURRENCY", "OTHER", "PIPELINE"],
    ["Total contract value", "$6M TCV", "USD_OR_CURRENCY", "OTHER", "TCV"],
    ["Partners", "35 partners", "COUNT", "OTHER", "PARTNERS"],
    ["Logos", "60 logos", "COUNT", "OTHER", "LOGOS"],
    ["Revenue since inception", "$3.1M revenue since inception", "USD_OR_CURRENCY", "revenue_ttm", "CUMULATIVE_REVENUE"],
  ] as const)("vanity lexicon: %s (%s) → %s", (label, rawText, unit, key, expected) => {
    expect(matchVanity(obs(key, 1, { label, rawText, unit, currency: unit === "COUNT" ? null : "USD" }))?.id).toBe(expected);
  });

  it.each([
    ["mau", "Monthly active users", "42k MAU", "COUNT"],
    ["arr", "ARR", "$4.2M ARR", "USD_OR_CURRENCY"],
    ["nrr", "Net revenue retention", "118% NRR", "PERCENT"],
    ["paying_customers", "Paying customers", "92 paying customers", "COUNT"],
  ] as const)("decision metric %s is not vanity", (key, label, rawText, unit) => {
    expect(matchVanity(obs(key, 1, { label, rawText, unit }))).toBeNull();
  });

  it.each(PROFILE_IDS.map((p) => [p]))("decision table: %s expects at least one decision metric at the earliest stage and more later", (profile) => {
    const rows = DECISION_TABLE[profile];
    expect(rows.some((r) => r.from === "EARLY")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(STAGE_BANDS).toContain(r.from);
  });
});

/* ================================================================== */
/* §5 Missing information as signal                                    */
/* ================================================================== */

const growthSaasObs = (customers = 140) => [
  obs("arr", 14_000_000, { rawText: "$14M ARR", page: 4 }),
  obs("arr_growth_yoy", 95, { unit: "PERCENT", currency: null, page: 4 }),
  obs("paying_customers", customers, { unit: "COUNT", currency: null, page: 5 }),
];

describe("§5 missing information as signal", () => {
  it("Series B SaaS with ARR / growth / customers but no NRR → retention omission HIGH", () => {
    const m = run(saas("SERIES_B", growthSaasObs())).missingAsSignal;
    const o = m.omissions.find((x) => x.slotId === "retention")!;
    expect(o.severity).toBe("HIGH");
    expect(o.kind).toBe("ABSENT");
    expect(o.sentence).toContain("Retention omission is material because a company at this maturity");
    expect(o.sentence).toContain("would normally be expected to track NRR / GRR");
    expect(o.sentence).toContain("The deck shows ARR / revenue");
    expect(m.material.map((x) => x.slotId)).toContain("retention");
  });

  it("seed company with 7 customers and no NRR → LOW, not yet expected", () => {
    const m = run(saas("SEED", [obs("arr", 300_000), obs("paying_customers", 7, { unit: "COUNT", currency: null })])).missingAsSignal;
    const o = m.omissions.find((x) => x.slotId === "retention")!;
    expect(o.severity).toBe("LOW");
    expect(o.kind).toBe("NOT_YET_EXPECTED");
    expect(o.sentence).toContain("not yet expected");
    expect(o.sentence).toContain("only 7 paying customers");
    expect(m.material.map((x) => x.slotId)).not.toContain("retention");
  });

  it.each([
    ["SEED", "LOW"],
    ["SERIES_A", "MODERATE"],
    ["SERIES_B", "HIGH"],
    ["SERIES_C_PLUS", "HIGH"],
  ] as const)("retention omission severity at %s is %s", (stage, sev) => {
    expect(run(saas(stage, growthSaasObs())).missingAsSignal.omissions.find((x) => x.slotId === "retention")!.severity).toBe(sev);
  });

  it("an explicitly WITHHELD NRR is reported separately from simple absence", () => {
    const m = run(saas("SERIES_B", [...growthSaasObs(), obs("nrr", null, { state: "WITHHELD", unit: "PERCENT", currency: null, label: "NRR", rawText: "NRR: available on request" })])).missingAsSignal;
    expect(m.withheld.map((x) => x.slotId)).toEqual(["retention"]);
    expect(m.withheld[0]!.sentence).toContain("explicitly withheld");
    expect(m.omissions.find((x) => x.slotId === "retention")!.kind).toBe("WITHHELD");
  });

  it("a flattering substitute shown instead raises the severity and is named", () => {
    const d = makeDeal();
    d.classification = { ...d.classification, industry: ["CONSUMER"], productType: ["CONSUMER_APP"], revenueModel: ["ADVERTISING"], gtm: ["ORGANIC_VIRAL"], financingStage: "SEED" };
    d.metrics = [];
    d.metricObservations = [obs("mau", 40_000, { unit: "COUNT", currency: null }), obs("OTHER", 900_000, { label: "Downloads", rawText: "900k downloads", unit: "COUNT", currency: null })];
    const o = run(d).missingAsSignal.omissions.find((x) => x.slotId === "consumer_retention")!;
    expect(o.flatteringSubstitute).toContain("downloads");
    expect(o.severity).toBe("HIGH");
    expect(o.sentence).toContain("flattering substitute");
  });

  it("with only 7 paying customers a Series B retention omission is lowered one level", () => {
    const o = run(saas("SERIES_B", growthSaasObs(7))).missingAsSignal.omissions.find((x) => x.slotId === "retention")!;
    expect(o.severity).toBe("MODERATE");
    expect(o.context).toContain("only 7 paying customers");
  });

  it("a metric not yet expected at this stage stays LOW even when only a target is shown", () => {
    const o = run(saas("SEED", [obs("arr", 300_000), obs("nrr", 120, { basis: "TARGET", unit: "PERCENT", currency: null, periodEnd: "2027-12" })])).missingAsSignal.omissions.find((x) => x.slotId === "retention")!;
    expect(o.kind).toBe("NOT_YET_EXPECTED");
    expect(o.severity).toBe("LOW");
  });

  it("a stale-only value is a lesser omission than an absent one", () => {
    const d = saas("SERIES_B", growthSaasObs());
    d.metrics = [metric("nrr", 110, { unit: "PERCENT", state: "STALE", periodEnd: "2024-12" })];
    const o = run(d).missingAsSignal.omissions.find((x) => x.slotId === "retention")!;
    expect(o.kind).toBe("STALE");
    expect(o.severity).toBe("MODERATE");
  });
});

/* ================================================================== */
/* §6 Precision discipline                                             */
/* ================================================================== */

describe("§6 precision discipline", () => {
  const vague = () => saas("SERIES_A", [obs("arr", 5_000_000, { rawText: "~$5M ARR", periodEnd: null })]);
  const precise = () =>
    saas("SERIES_A", [
      obs("arr", 4_830_000, {
        rawText: "$4.83M ARR as of Aug. 31, 2026",
        periodEnd: "2026-08-31",
        definitionAsStated: "Annualized value of live recurring contracts",
        components: ["excludes signed but not live contracts"],
      }),
    ]);

  it('"~$5M ARR" reads as weak precision', () => {
    const p = run(vague()).precisionDiscipline;
    expect(p.level).toBe("WEAK");
    expect(p.approximationRate.pct).toBe(100);
    expect(p.temporalPrecision.none).toBe(1);
    expect(p.impreciseExamples).toEqual(["~$5M ARR"]);
  });

  it('"$4.83M ARR as of Aug. 31, 2026; excludes signed but not live contracts" reads as strong precision', () => {
    const p = run(precise()).precisionDiscipline;
    expect(["STRONG", "EXCEPTIONAL"]).toContain(p.level);
    expect(p.definitionQuality.pct).toBe(100);
    expect(p.scopePrecision.pct).toBe(100);
    expect(p.temporalPrecision.day).toBe(1);
    expect(p.score!).toBeGreaterThan(run(vague()).precisionDiscipline.score!);
    expect(p.precisePrecedents[0]).toContain("excludes signed but not live contracts");
  });

  it.each([
    ["~$5M", true],
    ["approx. 40%", true],
    ["$5M+", true],
    ["over 100 customers", true],
    ["$3-5M", true],
    ["about 20 pilots", true],
    ["$4.83M", false],
    ["118%", false],
    ["2026-08-31: $4.8M", false],
    ["+120% YoY", false],
  ] as const)("approximation: %s → %s", (text, expected) => {
    expect(isApproximate(text)).toBe(expected);
  });

  it("temporal precision distinguishes day, month and undated values", () => {
    const d = saas("SERIES_A", [obs("arr", 1, { periodEnd: "2026-08-31" }), obs("paying_customers", 2, { periodEnd: "2026-08", unit: "COUNT", currency: null }), obs("gross_margin", 70, { periodEnd: null, unit: "PERCENT", currency: null })]);
    const t = run(d).precisionDiscipline.temporalPrecision;
    expect([t.day, t.month, t.year, t.none]).toEqual([1, 1, 0, 1]);
    expect(t.pct).toBe(60);
  });

  it("clearly labelled forecasts score full forecast separation", () => {
    const d = saas("SERIES_A", [obs("arr", 4_000_000), obs("arr", 9_000_000, { basis: "FORECAST", label: "2027E ARR", rawText: "$9M ARR (2027E)", periodEnd: "2027-12" })]);
    expect(run(d).precisionDiscipline.forecastSeparation.pct).toBe(100);
  });

  it("a future-dated value presented as actual fails forecast separation", () => {
    const d = saas("SERIES_A", [obs("arr", 9_000_000, { basis: "ACTUAL", rawText: "$9M ARR", periodEnd: "2027-06" })]);
    const fs = run(d).precisionDiscipline.forecastSeparation;
    expect(fs.pct).toBe(0);
    expect(fs.issues[0]!.text).toContain("after the analysis date");
  });

  it("no observations → INSUFFICIENT_EVIDENCE with the absence visible in coverage", () => {
    const p = run(saas("SERIES_A", [])).precisionDiscipline;
    expect(p.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(p.coverage.missing).toContain("metric observations");
  });
});

/* ================================================================== */
/* §4 Narrative inflation risk                                         */
/* ================================================================== */

describe("§4 narrative inflation — computed detections for each technique", () => {
  const detect = (d: CanonicalDeal) => run(d).narrativeInflation.items.filter((i) => i.source === "COMPUTED").map((i) => i.technique);

  it.each<[string, () => CanonicalDeal]>([
    ["CUMULATIVE_INSTEAD_OF_PERIOD", () => saas("SERIES_A", [obs("revenue_ttm", 3_100_000, { label: "Revenue since inception", rawText: "$3.1M revenue since inception", periodType: "CUMULATIVE" })])],
    ["GMV_INSTEAD_OF_NET_REVENUE", () => marketplace([obs("revenue_ttm", 10_000_000, { label: "Revenue", rawText: "$10M revenue" }), obs("gmv", 10_200_000, { rawText: "$10.2M GMV" })])],
    ["PIPELINE_AS_BOOKED", () => saas("SERIES_A", [obs("arr", 6_000_000, { basis: "SIGNED", label: "ARR", rawText: "$6M ARR (signed)" })])],
    ["PILOTS_MIXED_WITH_CUSTOMERS", () => saas("SERIES_A", [obs("paying_customers", 40, { label: "Customers", rawText: "40 customers incl. pilots", unit: "COUNT", currency: null })])],
    ["LOIS_MIXED_WITH_CONTRACTS", () => saas("SERIES_A", [obs("paying_customers", 25, { label: "Customers", rawText: "25 customers incl. LOIs", unit: "COUNT", currency: null })])],
    ["FREE_USERS_AS_CUSTOMERS", () => saas("SERIES_A", [obs("OTHER", 50_000, { label: "Customers", rawText: "50,000 customers (free and paid users)", unit: "COUNT", currency: null })])],
    ["CAGR_FROM_TINY_BASE", () => saas("SEED", [obs("arr", 150_000), obs("arr_growth_yoy", 900, { unit: "PERCENT", currency: null, rawText: "+900% YoY" })])],
    [
      "FORECAST_DRAWN_AS_ACTUAL",
      () => {
        const d = saas("SERIES_A", [obs("arr", 4_000_000, { sourceKind: "CHART", page: 7 }), obs("arr", 9_000_000, { basis: "FORECAST", sourceKind: "CHART", page: 7, label: "ARR", rawText: "$9M", periodEnd: "2027-12" })]);
        d.forensics = forensics({ chartForensics: [{ page: 7, issue: "HIDDEN_PERIOD", detail: "2027 bar drawn like actuals", severity: "HIGH" }] });
        return d;
      },
    ],
    [
      "LOGOS_WITHOUT_STATUS",
      () => {
        const d = saas("SERIES_A", [obs("arr", 4_000_000)]);
        d.customers = { icp: "", segments: [], concentrationNote: null, referencesNote: "", namedCustomers: ["Alpha", "Beta", "Gamma", "Delta"].map((name) => ({ name, relationship: "UNKNOWN" as const, evidenceLevel: "LOGO_ONLY" as const, note: null })) };
        return d;
      },
    ],
    [
      "ADJACENT_TAM_AS_ADDRESSABLE",
      () => {
        const d = makeDeal();
        d.deckMarket = { tam: { amount: 30e9, currency: "USD", rawText: "$30B" }, sam: null, som: null, description: null };
        return d;
      },
    ],
  ])("%s is detected from the data", (technique, build) => {
    expect(detect(build())).toContain(technique);
  });

  it("a lifetime-value metric is not mistaken for a cumulative total", () => {
    const d = saas("SERIES_A", [obs("OTHER", 90_000, { label: "Customer lifetime value", rawText: "$90k LTV" })]);
    expect(detect(d)).not.toContain("CUMULATIVE_INSTEAD_OF_PERIOD");
  });

  it("a clean ARR stated with its exclusions is not flagged as pipeline", () => {
    const d = saas("SERIES_A", [obs("arr", 4_830_000, { label: "ARR", rawText: "$4.83M ARR", components: ["excludes signed but not live contracts"] })]);
    expect(detect(d)).toEqual([]);
  });

  it("customers presented with pilot relationships among 'customers' claims are flagged", () => {
    const d = saas("SERIES_A", [obs("arr", 4_000_000)]);
    d.claims = [claim("CLM-001", "Trusted by 12 enterprise customers", { category: "CUSTOMER" })];
    d.customers = { icp: "", segments: [], concentrationNote: null, referencesNote: "", namedCustomers: [{ name: "Globex", relationship: "PILOT", evidenceLevel: "PILOT", note: null }] };
    const item = run(d).narrativeInflation.items.find((i) => i.technique === "PILOTS_MIXED_WITH_CUSTOMERS")!;
    expect(item.evidence).toContain("Globex");
  });

  it("each item carries technique, evidence, page, source and weight; model and computed corroborate into one technique", () => {
    const d = saas("SERIES_A", [obs("arr", 6_000_000, { basis: "PIPELINE", label: "ARR", rawText: "$6M ARR incl. pipeline", page: 9 })]);
    d.latentSignals = signals({ presentationTechniques: [{ technique: "PIPELINE_AS_BOOKED", detail: "Pipeline shown on the ARR chart", page: 9 }] });
    const n = run(d).narrativeInflation;
    const t = n.techniques.find((x) => x.technique === "PIPELINE_AS_BOOKED")!;
    expect(t.sources).toEqual(["COMPUTED", "MODEL"]);
    expect(t.pages).toEqual([9]);
    for (const i of n.items) expect(i).toMatchObject({ technique: expect.any(String), evidence: expect.any(String), source: expect.stringMatching(/MODEL|COMPUTED/), weight: expect.any(Number) });
    expect(n.basis).toEqual(["COMPUTED", "MODEL_OBSERVED"]);
  });

  it("several techniques → HIGH with the reasons listed; a clean deck → LOW", () => {
    const d = marketplace([
      obs("revenue_ttm", 10_000_000, { label: "Revenue", rawText: "$10M revenue" }),
      obs("gmv", 10_000_000, { rawText: "$10M GMV" }),
      obs("gmv", 30_000_000, { label: "GMV since launch", rawText: "$30M GMV since launch", periodType: "CUMULATIVE" }),
      obs("arr", 2_000_000, { basis: "PIPELINE", label: "ARR", rawText: "$2M ARR" }),
    ]);
    const n = run(d).narrativeInflation;
    expect(n.level).toBe("HIGH");
    expect(n.score).toBeGreaterThanOrEqual(6);
    expect(n.why.length).toBe(n.techniques.length);
    expect(run(makeDeal()).narrativeInflation.level).toBe("LOW");
  });

  it("a model-only technique is counted with its documented weight", () => {
    const d = saas("SERIES_A", [obs("arr", 4_000_000, { rawText: "$4M ARR" })]);
    d.latentSignals = signals({ presentationTechniques: [{ technique: "FREE_USERS_AS_CUSTOMERS", detail: "'customers' include free tier", page: 4 }] });
    const n = run(d).narrativeInflation;
    expect(n.score).toBe(2);
    expect(n.items[0]!.source).toBe("MODEL");
  });
});

function forensics(extra: Partial<NonNullable<CanonicalDeal["forensics"]>> = {}): NonNullable<CanonicalDeal["forensics"]> {
  return {
    narrativeArchitecture: { centralArgument: "", beliefTheDeckWantsMeToHold: "", slideOrderRationale: "", emphasized: [], absentDecisiveInformation: [], routedAroundWeaknesses: [] },
    visualElements: [],
    chartForensics: [],
    crossSlideInconsistencies: [],
    narrativeInconsistencies: [],
    productProof: { level: "UNKNOWN", evidence: "" },
    founderSlideSkepticism: [],
    competitiveSlide: null,
    marketSlide: { coherence: "", issues: [] },
    claimChecks: [],
    deckQualitySignals: { precision: "", numberMastery: "", customerUnderstanding: "" },
    suspectedInstructions: [],
    ...extra,
  };
}

/* ================================================================== */
/* §1 Founder operating maturity                                       */
/* ================================================================== */

const ALL_SIGNALS = ["ICP_PRECISION", "USER_BUYER_DISTINCTION", "MODEL_APPROPRIATE_METRICS", "COHORTS_OVER_VANITY", "CHURN_REASONS_KNOWN", "WIN_LOSS_UNDERSTANDING", "UNIT_ECONOMICS_UNDERSTANDING", "ACTUAL_FORECAST_SEPARATION"] as const;
const allDemonstrated = () =>
  signals({ operatingMaturity: ALL_SIGNALS.map((signal) => ({ signal, status: "DEMONSTRATED" as const, evidence: `${signal} shown`, page: 4 })) });

describe("§1 founder operating maturity", () => {
  it("demonstrated signals with consistent computed evidence → STRONG or EXCEPTIONAL", () => {
    const d = makeDeal();
    d.latentSignals = allDemonstrated();
    const m = run(d).operatingMaturity;
    expect(["STRONG", "EXCEPTIONAL"]).toContain(m.level);
    expect(m.assessed).toBe(8);
  });

  it("computed evidence wins when the model claims model-appropriate metrics but coverage is 0%", () => {
    const d = vanityMarketplace();
    d.latentSignals = allDemonstrated();
    const m = run(d).operatingMaturity;
    const s = m.signals.find((x) => x.signal === "MODEL_APPROPRIATE_METRICS")!;
    expect(s.modelStatus).toBe("DEMONSTRATED");
    expect(s.computedStatus).toBe("NOT_SHOWN");
    expect(s.status).toBe("NOT_SHOWN");
    expect(s.conflictNote).toContain("computed evidence wins");
    expect(m.signals.find((x) => x.signal === "COHORTS_OVER_VANITY")!.status).toBe("CONTRADICTED");
    expect(m.conflicts.length).toBeGreaterThanOrEqual(2);
  });

  it("forecast drawn as actual contradicts actual / forecast separation", () => {
    const d = saas("SERIES_A", [obs("arr", 9_000_000, { basis: "ACTUAL", periodEnd: "2027-06" })]);
    d.latentSignals = allDemonstrated();
    const s = run(d).operatingMaturity.signals.find((x) => x.signal === "ACTUAL_FORECAST_SEPARATION")!;
    expect(s.status).toBe("CONTRADICTED");
    expect(s.basis).toBe("COMPUTED");
  });

  it("without the model pass, only computed signals are assessed and the rest is visible as NOT_ASSESSED", () => {
    const m = run(makeDeal()).operatingMaturity;
    expect(m.signals.find((x) => x.signal === "ICP_PRECISION")!.status).toBe("NOT_ASSESSED");
    expect(m.signals.find((x) => x.signal === "MODEL_APPROPRIATE_METRICS")!.basis).toBe("COMPUTED");
    expect(m.coverage.missing).toContain("model operating-maturity read (latentSignals)");
    expect(m.basis).toEqual(["COMPUTED"]);
  });

  it("maturity is reported independently from performance: bad numbers do not lower it", () => {
    const good = makeDeal();
    good.latentSignals = allDemonstrated();
    const bad = makeDeal();
    bad.latentSignals = allDemonstrated();
    bad.metrics = bad.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 72 } : m.metricKey === "gross_margin" ? { ...m, normalizedValue: 31 } : m.metricKey === "arr_growth_yoy" ? { ...m, normalizedValue: 8 } : m));
    expect(run(bad).operatingMaturity.level).toBe(run(good).operatingMaturity.level);
    expect(run(bad).operatingMaturity.score).toBe(run(good).operatingMaturity.score);
    expect(run(bad).operatingMaturity.performanceIndependence).toContain("bad numbers plus a founder who understands exactly why is a strong signal");
  });

  it("weak numbers disclosed together with their cause are recognised as understanding", () => {
    const d = makeDeal();
    d.latentSignals = signals({
      disclosures: [{ kind: "UNFLATTERING_METRIC", detail: "NRR declined from 121% to 108%", page: 8 }],
      causalExplanations: [{ metric: "NRR", explanationGiven: "Decline driven by two SMB accounts downgrading after a price change", page: 8 }],
    });
    expect(run(d).operatingMaturity.understandsWeakNumbers).toBe(true);
    expect(run(makeDeal()).operatingMaturity.understandsWeakNumbers).toBe(false);
  });

  it("fewer than 3 assessable signals → INSUFFICIENT_EVIDENCE", () => {
    expect(run(emptyCanonical("FAST_SCREEN")).operatingMaturity.level).toBe("INSUFFICIENT_EVIDENCE");
  });
});

/* ================================================================== */
/* §2 Quality of thinking                                              */
/* ================================================================== */

describe("§2 quality of thinking", () => {
  it("reports % supported and lists unsupported headline conclusions", () => {
    const d = makeDeal();
    d.latentSignals = signals({
      reasoningChains: [
        { conclusion: "Initial SAM is ~$197M", support: "EVIDENCE_AND_CAUSAL_REASONING", chain: "18,400 companies; ICP 4,700; $42k ACV", page: 6 },
        { conclusion: "Customers stay", support: "EVIDENCE_AND_CAUSAL_REASONING", chain: "NRR 118% on 45 customers, driven by seat expansion", page: 9 },
        { conclusion: "Sales motion is repeatable", support: "EVIDENCE_AND_CAUSAL_REASONING", chain: "Win rate 31% across 60 deals", page: 10 },
        { conclusion: "We will be the category leader", support: "ASSERTION_ONLY", chain: "No support", page: 2 },
      ],
    });
    const q = run(d).qualityOfThinking;
    expect(q.supportedPct).toBe(75);
    expect(q.assertionOnlyPct).toBe(25);
    expect(q.unsupportedConclusions).toEqual([{ conclusion: "We will be the category leader", page: 2 }]);
    expect(["STRONG", "EXCEPTIONAL"]).toContain(q.level);
  });

  it("assertion-heavy decks read WEAK", () => {
    const d = makeDeal();
    d.latentSignals = signals({ reasoningChains: [1, 2, 3, 4].map((i) => ({ conclusion: `Claim ${i}`, support: "ASSERTION_ONLY" as const, chain: "", page: i })) });
    expect(run(d).qualityOfThinking.level).toBe("WEAK");
  });

  it.each([
    ["The $50B market growing 22% CAGR", "TOP_DOWN"],
    ["18,400 companies × $42k ACV = $773M", "BOTTOM_UP"],
    ["$50B market growing 22% CAGR; bottom-up: 4,700 clinics at $30k", "MIXED"],
    ["We sell software", "UNSTATED"],
  ] as const)("market sizing style of %j is %s", (description, style) => {
    const d = makeDeal();
    d.deckMarket = { tam: null, sam: null, som: null, description };
    expect(marketSizingStyle(d).style).toBe(style);
  });

  it("without reasoning chains the level is INSUFFICIENT_EVIDENCE but the computed checks remain", () => {
    const d = makeDeal();
    d.deckMarket = { tam: null, sam: null, som: null, description: "$40B market growing 18% CAGR" };
    const q = run(d).qualityOfThinking;
    expect(q.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(q.marketSizing.style).toBe("TOP_DOWN");
    expect(q.basis).toEqual(["COMPUTED"]);
  });
});

/* ================================================================== */
/* §7 Causal business understanding                                   */
/* ================================================================== */

const bridgeObs = (net: number, extra: Partial<MetricObservation> = {}) => [
  obs("new_arr", 1_200_000, { periodStart: "2025-09", periodEnd: "2026-08", page: 11, ...extra }),
  obs("expansion_arr", 400_000, { periodStart: "2025-09", periodEnd: "2026-08", page: 11, ...extra }),
  obs("churned_arr", 200_000, { periodStart: "2025-09", periodEnd: "2026-08", page: 11, ...extra }),
  obs("net_new_arr", net, { periodStart: "2025-09", periodEnd: "2026-08", page: 11, ...extra }),
];

describe("§7 causal business understanding — ARR bridge", () => {
  it.each([
    [1_400_000, "RECONCILES"],
    [1_450_000, "RECONCILES"],
    [2_000_000, "DOES_NOT_RECONCILE"],
  ] as const)("net new ARR %d vs new + expansion − churn = 1.4M → %s", (net, status) => {
    const b = arrBridge(saas("SERIES_A", bridgeObs(net)));
    expect(b.status).toBe(status);
    expect(b.computedNet).toBe(1_400_000);
    expect(b.pages).toEqual([11]);
  });

  it("checks the bridge against the ARR delta when two ARR points exist", () => {
    const ok = arrBridge(saas("SERIES_A", [...bridgeObs(1_400_000), obs("arr", 3_000_000, { periodEnd: "2025-09" }), obs("arr", 4_400_000, { periodEnd: "2026-08" })]));
    expect(ok.status).toBe("RECONCILES");
    expect(ok.arrDeltaCheck!.reconciles).toBe(true);
    const off = arrBridge(saas("SERIES_A", [...bridgeObs(1_400_000), obs("arr", 3_000_000, { periodEnd: "2025-09" }), obs("arr", 5_000_000, { periodEnd: "2026-08" })]));
    expect(off.status).toBe("DOES_NOT_RECONCILE");
    expect(off.arrDeltaCheck!.gapPct).toBeGreaterThan(5);
  });

  it("a partial bridge is INCOMPLETE and no bridge is ABSENT", () => {
    expect(arrBridge(saas("SERIES_A", [obs("new_arr", 1_000_000)])).status).toBe("INCOMPLETE");
    expect(arrBridge(saas("SERIES_A", [obs("arr", 1_000_000)])).status).toBe("ABSENT");
  });

  it("bridge + cohorts + churn reasons + explained movements rank above a deck with none, and say what they are based on", () => {
    const rich = saas("SERIES_A", [...bridgeObs(1_400_000), obs("nrr", 118, { unit: "PERCENT", currency: null, cohortDefinition: "2024 cohort, 12-month", label: "NRR by cohort" })]);
    rich.latentSignals = signals({
      operatingMaturity: [
        { signal: "CHURN_REASONS_KNOWN", status: "DEMONSTRATED", evidence: "Churn by reason table", page: 12 },
        { signal: "WIN_LOSS_UNDERSTANDING", status: "DEMONSTRATED", evidence: "Win/loss by competitor", page: 13 },
      ],
      causalExplanations: [{ metric: "ARR growth", explanationGiven: "Expansion from seat growth in 2024 cohort", page: 11 }],
    });
    const poor = saas("SERIES_A", [obs("arr", 4_000_000)]);
    poor.latentSignals = signals({ causalExplanations: [{ metric: "ARR growth", explanationGiven: null, page: 3 }] });
    const r = run(rich).causalUnderstanding;
    const p = run(poor).causalUnderstanding;
    expect(r.level).toBe("EXCEPTIONAL");
    expect(p.level).toBe("WEAK");
    expect(r.score!).toBeGreaterThan(p.score!);
    expect(r.scope).toBe("Based on the data available in the deck.");
    expect(r.cohortsDisclosed).toBe(true);
  });
});

/* ================================================================== */
/* §8 Consistency of ambition                                          */
/* ================================================================== */

describe("§8 consistency of ambition", () => {
  const localDeal = () => {
    const d = makeDeal();
    d.deckMarket = { tam: { amount: 30e9, currency: "USD", rawText: "$30B" }, sam: null, som: null, description: null };
    d.financing = { ...d.financing!, raiseAmount: { amount: 4_000_000, currency: "USD", rawText: "$4M" }, useOfFunds: ["Launch the local compliance workflow in France and Germany", "Hire 6 engineers"] };
    return d;
  };

  it("$30B TAM + $4M raise + a France / Germany local workflow → DISCONNECTED (at least STRETCHED)", () => {
    const a = run(localDeal()).ambition;
    expect(["DISCONNECTED", "STRETCHED"]).toContain(a.consistency);
    expect(a.consistency).toBe("DISCONNECTED");
    expect(a.tamToRaise).toBe(7500);
    expect(a.fundedGeography.scope).toBe("LOCAL");
    expect(a.fundedGeography.places).toEqual(["france", "germany"]);
    expect(a.question).toMatch(/^How does the company actually get from .+ to .+\?$/);
  });

  it("a proportionate ambition is CONSISTENT", () => {
    const d = makeDeal();
    d.deckMarket = { tam: { amount: 2e9, currency: "USD", rawText: "$2B" }, sam: null, som: null, description: null };
    d.financing = { ...d.financing!, useOfFunds: ["Expand sales across North America"] };
    expect(run(d).ambition.consistency).toBe("CONSISTENT");
  });

  it("the more severe of the model and computed readings is kept, and both are reported", () => {
    const d = makeDeal();
    d.deckMarket = { tam: { amount: 2e9, currency: "USD", rawText: "$2B" }, sam: null, som: null, description: null };
    d.latentSignals = signals({ ambition: { headline: "Operating system for global finance", operationalRoadmap: "US mid-market AP", bridge: "The deck does not explain the path", consistency: "DISCONNECTED" } });
    const a = run(d).ambition;
    expect(a.modelConsistency).toBe("DISCONNECTED");
    expect(a.consistency).toBe("DISCONNECTED");
    expect(a.bridgeStated).toBe(false);
    expect(a.basis).toEqual(["COMPUTED", "MODEL_OBSERVED"]);
  });

  it("without TAM, raise or use of funds the reading is UNCLEAR", () => {
    expect(run(emptyCanonical("STANDARD")).ambition.consistency).toBe("UNCLEAR");
  });

  it.each([
    ["Launch in France and Germany", "LOCAL"],
    ["Expand across Europe", "REGIONAL"],
    ["Global expansion", "GLOBAL"],
    ["Hire engineers", "UNSTATED"],
    ["This round helps us hire", "UNSTATED"],
  ] as const)("geography of %j is %s", (text, scope) => {
    expect(geoScope(text).scope).toBe(scope);
  });
});

/* ================================================================== */
/* §9 Resource efficiency                                              */
/* ================================================================== */

describe("§9 resource efficiency", () => {
  const A = efficiencyRatios({ monthsSinceFounding: 18, capitalRaisedUsd: 1_800_000, fte: 12, arrUsd: 2_400_000 });
  const B = efficiencyRatios({ monthsSinceFounding: 48, capitalRaisedUsd: 18_000_000, fte: 80, arrUsd: 3_000_000 });

  it("owner's example: 18 months / $1.8M / 12 FTE / $2.4M ARR vs 4 years / $18M / 80 FTE / $3M ARR", () => {
    expect(A).toEqual({ arrPerDollarRaised: 1.333, arrPerMonth: 133_333, arrPerFte: 200_000, capitalPerFte: 150_000, capitalPerMonth: 100_000 });
    expect(B).toEqual({ arrPerDollarRaised: 0.167, arrPerMonth: 62_500, arrPerFte: 37_500, capitalPerFte: 225_000, capitalPerMonth: 375_000 });
  });

  it("the first company is more efficient on every ratio", () => {
    expect(compareEfficiency(A, B)).toEqual({ arrPerDollarRaised: 1, arrPerMonth: 1, arrPerFte: 1, capitalPerFte: 1, capitalPerMonth: 1 });
    expect(compareEfficiency(B, A).arrPerDollarRaised).toBe(-1);
  });

  it("computes the same ratios from a canonical deal (founding year, total raised, headcount, ARR)", () => {
    const d = makeDeal();
    d.identity = { ...d.identity, foundedYear: 2025 };
    d.financing = { ...d.financing!, totalRaisedToDate: { amount: 1_800_000, currency: "USD", rawText: "$1.8M" } };
    d.metrics = [metric("arr", 2_400_000), metric("headcount", 12, { unit: "COUNT" })];
    const e = run(d, new Date("2027-01-15T00:00:00Z")).resourceEfficiency;
    expect(e.inputs.monthsSinceFounding).toBe(18);
    expect(e.ratios).toEqual(A);
    expect(e.label).toBe(EFFICIENCY_LABEL);
    expect(e.label).toContain("raw ratios, no benchmark distribution");
  });

  it("falls back to the sum of prior rounds from funding claims when total raised is not stated", () => {
    const d = makeDeal();
    d.claims = [claim("CLM-1", "Raised a $1.5M seed round in 2023", { category: "FUNDING", valueText: "$1.5M" }), claim("CLM-2", "Raised $300k pre-seed", { category: "FUNDING", valueText: "$300k" })];
    const e = run(d).resourceEfficiency;
    expect(e.inputs.capitalRaisedUsd).toBe(1_800_000);
    expect(e.inputs.capitalSource).toContain("sum of 2 prior round(s)");
  });

  it("missing inputs give null ratios and visible coverage, never a throw", () => {
    const e = run(emptyCanonical("FAST_SCREEN")).resourceEfficiency;
    expect(e.ratios.arrPerDollarRaised).toBeNull();
    expect(e.coverage.missing).toEqual(["founding year", "capital raised", "headcount", "ARR / revenue"]);
  });
});

/* ================================================================== */
/* §10 Disclosure quality                                              */
/* ================================================================== */

describe("§10 disclosure quality (never an honesty score)", () => {
  const withDecline = () => {
    const d = saas("SERIES_B", [...growthSaasObs(), obs("nrr", 121, { unit: "PERCENT", currency: null, periodEnd: "2025-08", page: 8 }), obs("nrr", 108, { unit: "PERCENT", currency: null, periodEnd: "2026-08", page: 8 })]);
    d.latentSignals = signals({
      disclosures: [{ kind: "UNFLATTERING_METRIC", detail: "NRR declined from 121% to 108%", page: 8 }],
      causalExplanations: [{ metric: "NRR", explanationGiven: "Main cause is SMB downgrades after the 2025 price change", page: 8 }],
    });
    return d;
  };
  const withOmission = () => {
    const d = saas("SERIES_B", growthSaasObs());
    d.latentSignals = signals();
    return d;
  };

  it("a deck disclosing a declining NRR and its cause ranks above one where NRR disappears", () => {
    const shown = run(withDecline()).disclosureQuality;
    const hidden = run(withOmission()).disclosureQuality;
    expect(shown.score).toBeGreaterThan(hidden.score);
    expect(shown.unflatteringTrends).toHaveLength(1);
    expect(shown.unflatteringTrends[0]).toMatchObject({ metricKey: "nrr", changePct: -10.7 });
    expect(shown.unflatteringTrends[0]!.explained).toContain("Main cause");
    expect(hidden.materialOmissions).toBeGreaterThanOrEqual(1);
    expect(shown.note).toContain("NRR declined from 121% to 108%");
  });

  it("more kinds of voluntary disclosure raise the level", () => {
    const base = makeDeal();
    base.latentSignals = signals();
    const open = makeDeal();
    open.latentSignals = signals({
      disclosures: (["LIMITATION", "RISK", "UNFLATTERING_METRIC", "PRECISE_DEFINITION", "OBJECTION_ADDRESSED", "FAILED_EXPERIMENT"] as const).map((kind) => ({ kind, detail: kind, page: 3 })),
    });
    expect(run(open).disclosureQuality.score).toBeGreaterThan(run(base).disclosureQuality.score);
    expect(["STRONG", "EXCEPTIONAL"]).toContain(run(open).disclosureQuality.level);
  });

  it("the report never uses the words 'honesty score'", () => {
    expect(JSON.stringify(run(withDecline()))).not.toMatch(/honesty score/i);
  });
});

/* ================================================================== */
/* §12 Report assembly, determinism, robustness                        */
/* ================================================================== */

const MODULES = ["operatingMaturity", "qualityOfThinking", "metricSelection", "narrativeInflation", "missingAsSignal", "precisionDiscipline", "causalUnderstanding", "ambition", "resourceEfficiency", "disclosureQuality"] as const;

function richDeal(): CanonicalDeal {
  const d = saas("SERIES_B", [
    ...growthSaasObs(),
    ...bridgeObs(1_400_000),
    obs("nrr", 121, { unit: "PERCENT", currency: null, periodEnd: "2025-08" }),
    obs("nrr", 108, { unit: "PERCENT", currency: null, periodEnd: "2026-08" }),
    obs("OTHER", 9000, { label: "Sign-ups", rawText: "9,000 sign-ups", unit: "COUNT", currency: null }),
  ]);
  d.latentSignals = allDemonstrated();
  d.deckMarket = { tam: { amount: 30e9, currency: "USD", rawText: "$30B" }, sam: null, som: null, description: "$30B market growing 20% CAGR" };
  return d;
}

describe("§12 latentReport", () => {
  it.each(MODULES.map((m) => [m]))("module %s states its basis, pages, coverage and rule", (m) => {
    const r = run(richDeal())[m];
    expect(r.basis.length).toBeGreaterThan(0);
    for (const b of r.basis) expect(["MODEL_OBSERVED", "COMPUTED"]).toContain(b);
    expect(Array.isArray(r.pages)).toBe(true);
    expect(r.coverage).toMatchObject({ available: expect.any(Array), missing: expect.any(Array), ratio: expect.any(Number) });
    expect(r.rule.length).toBeGreaterThan(20);
  });

  it("is deterministic for a given asOf", () => {
    expect(run(richDeal())).toEqual(run(richDeal()));
    expect(JSON.stringify(run(vanityMarketplace()))).toBe(JSON.stringify(run(vanityMarketplace())));
  });

  it("null latentSignals → computed-only report with coverage shown, no throw", () => {
    const d = richDeal();
    d.latentSignals = null;
    const r = run(d);
    expect(r.coverage.latentSignalsAvailable).toBe(false);
    expect(r.coverage.notes[0]).toContain("computed signals only");
    expect(r.operatingMaturity.signals.filter((s) => s.basis === "MODEL_OBSERVED")).toHaveLength(0);
    expect(r.metricSelection.decisionCoveragePct).not.toBeNull();
  });

  it("never throws on an empty canonical object", () => {
    const r = run(emptyCanonical("FAST_SCREEN"));
    expect(r.version).toBe("latent-1.0");
    expect(r.coverage.metricObservations).toBe(0);
    expect(r.narrativeInflation.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.signalsForSynthesis.length).toBeLessThanOrEqual(10);
  });

  it("pedigree words do not change any output", () => {
    const plain = richDeal();
    const pedigree = richDeal();
    pedigree.foundersFromDeck = [{ name: "Jane Doe", role: "CEO", backgroundFromDeck: "Ex-Google, Stanford PhD, Y Combinator alumna, McKinsey", priorOrganizations: ["Google", "McKinsey", "Stanford"], publicProfileUrls: [] }];
    pedigree.claims = [claim("CLM-T1", "CEO is ex-Google and a Stanford PhD, YC alumna", { category: "TEAM" })];
    expect(run(pedigree)).toEqual(run(plain));
  });

  it("signalsForSynthesis is compact, ordered by weight and always carries its basis", () => {
    const s = run(richDeal()).signalsForSynthesis;
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(10);
    for (let i = 1; i < s.length; i++) expect(s[i - 1]!.weight).toBeGreaterThanOrEqual(s[i]!.weight);
    for (const x of s) expect(x.basis.length).toBeGreaterThan(0);
    expect(s.map((x) => x.id)).toEqual(s.map((_, i) => `LAT-${String(i + 1).padStart(2, "0")}`));
  });

  it("surfaces the vanity-heavy marketplace as a negative synthesis signal", () => {
    const s = run(vanityMarketplace()).signalsForSynthesis;
    expect(s.some((x) => x.module === "metricSelection" && x.direction === "NEGATIVE")).toBe(true);
  });

  it("is marked secondary and is never folded into the Operating Quality Index", () => {
    const withLs = makeDeal();
    withLs.latentSignals = allDemonstrated();
    const now = new Date("2026-09-27T00:00:00Z");
    const a = derive(withLs, reg, DEFAULT_FUND_PROFILE, { now });
    const b = derive(makeDeal(), reg, DEFAULT_FUND_PROFILE, { now });
    expect(a.operatingQuality).toEqual(b.operatingQuality);
    expect(run(withLs).secondary).toBe(true);
  });

  it("carries a compact summary small enough for the partner-model prompt", () => {
    const r = run(richDeal());
    expect(JSON.stringify(r.summary).length).toBeLessThan(12_000);
    expect(r.summary.signalsForSynthesis).toEqual(r.signalsForSynthesis);
    expect(r.summary.metricSelection.decisionCoveragePct).toBe(r.metricSelection.decisionCoveragePct);
  });

  it("coverage counts assessed modules so absence of data is visible", () => {
    expect(run(richDeal()).coverage.modulesAssessed).toBeGreaterThan(run(emptyCanonical("FAST_SCREEN")).coverage.modulesAssessed);
    expect(run(richDeal()).coverage.modulesTotal).toBe(10);
  });

  it("runs in well under 20ms per deal", () => {
    const d = richDeal();
    run(d);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) run(d);
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  });
});
