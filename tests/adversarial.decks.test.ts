/**
 * Adversarial suite — whole manipulated decks. Each scenario is a realistic
 * deck built around one presentation technique (or several); the engine must
 * surface it with the right severity and point at the right refs.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalDeal } from "@/domain/canonical";
import type { IntegritySeverity } from "@/engine/integrity";
import { claim, cleanDeal, kinds, link, m, obs, run, setMetric, removeMetric, transcriptSource, webSource, withStage } from "./fixtures/integrity/builders";

const usd = (amount: number) => ({ amount, currency: "USD", rawText: `$${amount}` });
const RANK: IntegritySeverity[] = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

type Scenario = [name: string, build: () => CanonicalDeal, mustInclude: string[], minTopSeverity: IntegritySeverity];

const SCENARIOS: Scenario[] = [
  [
    "forecast dressed as traction (only FORECAST/TARGET numbers)",
    () => {
      const d = cleanDeal();
      d.metrics = d.metrics.filter((x) => !["arr", "arr_growth_yoy", "acv", "paying_customers"].includes(x.metricKey));
      d.metricObservations = [obs("arr", 12_000_000, { basis: "FORECAST", periodEnd: "2027-12", page: 3 }), obs("paying_customers", 400, { unit: "COUNT", currency: null, basis: "TARGET", periodEnd: "2027-12", page: 4 })];
      return d;
    },
    ["FORECAST_BASE_NOT_DISCLOSED", "EXPECTED_EVIDENCE_MISSING"],
    "MODERATE",
  ],
  [
    "signed vs deployed: most 'ARR' is signed, not live",
    () => {
      const d = cleanDeal();
      setMetric(d, "arr", 900_000);
      d.metricObservations.push(obs("arr", 5_000_000, { basis: "SIGNED", page: 3, rawText: "$5M ARR (contracted)" }));
      return d;
    },
    ["BOOKINGS_AS_ARR"],
    "HIGH",
  ],
  [
    "pilots counted as customers + logo wall",
    () => {
      const d = cleanDeal();
      setMetric(d, "paying_customers", 92, { unit: "COUNT", definitionUsed: "customers incl. paid pilots and design partners" });
      d.metrics.push(m("MET-PIL", "pilots", 70, { unit: "COUNT" }));
      d.customers!.namedCustomers = ["Apple", "Walmart", "JPMorgan", "Siemens"].map((name) => ({ name, relationship: "LOGO_ONLY" as const, evidenceLevel: "LOGO_ONLY" as const, note: null }));
      d.claims.push(claim("CLM-L", { category: "CUSTOMER", statement: "Trusted by Apple, Walmart, JPMorgan and Siemens", page: 2 }));
      return d;
    },
    ["PILOTS_AS_CUSTOMERS", "LOGO_ONLY_CUSTOMERS"],
    "HIGH",
  ],
  [
    "AI gross margin inflated by excluding inference and human ops",
    () => {
      const d = cleanDeal();
      setMetric(d, "gross_margin", 91, { unit: "PERCENT", definitionUsed: "Software gross margin, excluding inference compute and human-in-the-loop review" });
      return d;
    },
    ["GROSS_MARGIN_EXCLUDES_COGS"],
    "HIGH",
  ],
  [
    "TAM manipulated: TAM ≫ price × customers, SAM > TAM, SOM > SAM",
    () => {
      const d = cleanDeal();
      d.deckMarket = { tam: usd(900e9), sam: usd(1_200e9), som: usd(1_500e9), description: "Global enterprise software" };
      return d;
    },
    ["IMPLIED_TAM_VS_PRICE_X_CUSTOMERS", "IMPLIED_DECK_TAM_VS_RECONSTRUCTED", "IMPLIED_SAM_WITHIN_TAM", "IMPLIED_SOM_WITHIN_SAM"],
    "CRITICAL",
  ],
  [
    "SAFE with a cap that matches no stated valuation",
    () => {
      const d = withStage(cleanDeal(), "SEED");
      d.financing = { ...d.financing!, instrument: "SAFE", raiseAmount: usd(3_000_000), valuationCap: usd(8_000_000), postMoney: usd(20_000_000), preMoney: null };
      return d;
    },
    ["IMPLIED_SAFE_CAP"],
    "CRITICAL",
  ],
  [
    "priced round where pre + raise ≠ post",
    () => {
      const d = cleanDeal();
      d.financing = { ...d.financing!, preMoney: usd(40_000_000), postMoney: usd(45_000_000), raiseAmount: usd(15_000_000) }; // implied pre 30M
      return d;
    },
    ["IMPLIED_PRE_MONEY"],
    "HIGH",
  ],
  [
    "services disguised as SaaS (65% services)",
    () => {
      const d = cleanDeal();
      d.metrics.push(m("MET-SVC", "services_revenue_share", 65, { unit: "PERCENT" }));
      return d;
    },
    ["SERVICES_AS_SAAS"],
    "CRITICAL",
  ],
  [
    "founder contradicts the deck on the call",
    () => {
      const d = cleanDeal();
      d.sources.push(transcriptSource());
      d.claims[0] = { ...d.claims[0]!, evidence: [...d.claims[0]!.evidence, link("SRC-900", "CONTRADICTS", { location: "founder call", excerpt: "ARR is closer to $2.5M; the rest is signed" })], contradictions: ["Founder call: ARR is closer to $2.5M"] };
      return d;
    },
    ["CLAIM_SELF_CONTRADICTED"],
    "HIGH",
  ],
  [
    "independent source contradicts a material customer claim",
    () => {
      const d = cleanDeal();
      d.sources.push(webSource("SRC-040", "https://www.reuters.com/globex-drops-vendor"));
      d.claims[1] = { ...d.claims[1]!, verification: "CONTRADICTED", evidence: [...d.claims[1]!.evidence, link("SRC-040", "CONTRADICTS", { excerpt: "Globex ended the contract in May" })] };
      return d;
    },
    ["CLAIM_CONTRADICTED"],
    "CRITICAL",
  ],
  [
    "verified claim resting on a press wire and a stale article",
    () => {
      const d = cleanDeal();
      d.sources.push(webSource("SRC-041", "https://www.prnewswire.com/acme-partnership"), webSource("SRC-042", "https://www.ft.com/old", { publishedDate: "2022-03-01" }));
      d.claims.push(claim("CLM-P", { category: "PARTNERSHIP", statement: "Strategic partnership with a top-3 ERP vendor", verification: "VERIFIED", evidence: [link("SRC-001", "ORIGIN"), link("SRC-041", "CONFIRMS"), link("SRC-042", "CONFIRMS")] }));
      return d;
    },
    ["VERIFICATION_RESTS_ON_WEAK_SOURCE"],
    "HIGH",
  ],
  [
    "duplicated press counted as independent confirmations",
    () => {
      const d = cleanDeal();
      const t = "Acme signs landmark deal with Globex to automate global payables";
      d.sources.push(webSource("SRC-043", "https://www.site-one.com/a", { title: t }), webSource("SRC-044", "https://www.site-two.com/b", { title: `${t} today` }), webSource("SRC-045", "https://www.site-three.com/c", { title: `BREAKING: ${t}` }));
      d.claims.push(claim("CLM-D", { category: "CUSTOMER", statement: "Globex signed a global deal", verification: "VERIFIED", evidence: [link("SRC-043", "CONFIRMS"), link("SRC-044", "CONFIRMS"), link("SRC-045", "CONFIRMS")] }));
      return d;
    },
    ["DUPLICATED_PRESS"],
    "MODERATE",
  ],
  [
    "runway claimed 30 months, implied 8.6 pre / 27 post (closest ok) — then 48 months",
    () => {
      const d = cleanDeal();
      removeMetric(d, "runway_months");
      d.financing!.runwayClaimMonths = 48;
      return d;
    },
    ["IMPLIED_RUNWAY"],
    "CRITICAL",
  ],
  [
    "900% growth on a $15k base",
    () => {
      const d = cleanDeal();
      d.metrics = d.metrics.filter((x) => x.id !== "MET-002");
      setMetric(d, "arr", 150_000);
      setMetric(d, "arr_growth_yoy", 900, { unit: "PERCENT" });
      return d;
    },
    ["GROWTH_ON_TINY_BASE"],
    "HIGH",
  ],
  [
    "self-serve claim with a nine-month enterprise cycle",
    () => {
      const d = cleanDeal();
      d.classification = { ...d.classification, gtm: ["SELF_SERVE"] };
      setMetric(d, "sales_cycle_days", 270, { unit: "DAYS", sampleSize: 12 });
      return d;
    },
    ["SELF_SERVE_WITH_ENTERPRISE_SIGNALS"],
    "HIGH",
  ],
  [
    "Series B with aggregate 140% NRR, no cohorts, no denominator",
    () => {
      const d = withStage(cleanDeal(), "SERIES_B");
      setMetric(d, "nrr", 140, { unit: "PERCENT", sampleSize: null, cohortDefinition: null });
      return d;
    },
    ["RETENTION_WITHOUT_COHORTS", "RATE_WITHOUT_DENOMINATOR", "EXPECTED_EVIDENCE_MISSING"],
    "HIGH",
  ],
  [
    "cumulative revenue chart presented as momentum",
    () => {
      const d = cleanDeal();
      d.metricObservations.push(obs("arr", 14_000_000, { periodType: "CUMULATIVE", rawText: "$14M ARR since launch", page: 3 }));
      return d;
    },
    ["CUMULATIVE_AS_RUN_RATE"],
    "HIGH",
  ],
  [
    "hockey stick: 12× in 16 months after 20% trailing growth",
    () => {
      const d = cleanDeal();
      d.metrics = d.metrics.map((x) => (x.id === "MET-002" ? { ...x, normalizedValue: 3_200_000 } : x));
      setMetric(d, "arr_growth_yoy", 20, { unit: "PERCENT" });
      d.metricObservations.push(obs("arr", 46_000_000, { basis: "FORECAST", periodEnd: "2027-12", page: 11 }));
      return d;
    },
    ["HOCKEY_STICK_FORECAST"],
    "HIGH",
  ],
  [
    "ACV contradiction between the pricing slide and ARR / customers",
    () => {
      const d = cleanDeal();
      setMetric(d, "acv", 150_000, { location: "p. 8" });
      return d;
    },
    ["IMPLIED_ACV"],
    "CRITICAL",
  ],
  [
    "the round does not fund the milestone it is raised for",
    () => {
      const d = cleanDeal();
      d.financingPath = { ...d.financingPath!, milestoneMonths: 36, plannedMonthlyBurnUsd: 1_000_000 }; // needs 36M, has 15M
      return d;
    },
    ["IMPLIED_RAISE_FUNDS_MILESTONE"],
    "CRITICAL",
  ],
  [
    "GMV presented as revenue in a marketplace",
    () => {
      const d = cleanDeal();
      d.classification = { ...d.classification, productType: ["MARKETPLACE"], revenueModel: ["TAKE_RATE"] };
      setMetric(d, "arr", 20_000_000);
      d.metrics.push(m("MET-GMV", "gmv", 20_500_000), m("MET-TAKE", "take_rate", 8, { unit: "PERCENT" }));
      return d;
    },
    ["GMV_AS_REVENUE", "IMPLIED_NET_REVENUE_FROM_GMV"],
    "CRITICAL",
  ],
  [
    "same metric, different values on different slides",
    () => {
      const d = cleanDeal();
      d.metricObservations = [obs("arr", 3_840_000, { page: 3 }), obs("arr", 5_100_000, { page: 14 }), obs("paying_customers", 92, { unit: "COUNT", currency: null, page: 4 }), obs("paying_customers", 150, { unit: "COUNT", currency: null, page: 15 })];
      return d;
    },
    ["CROSS_SLIDE_VALUE_CONFLICT"],
    "HIGH",
  ],
];

describe("adversarial decks", () => {
  it.each(SCENARIOS)("%s", (_name, build, mustInclude, minTop) => {
    const r = run(build());
    for (const k of mustInclude) expect(kinds(r)).toContain(k);
    expect(RANK.indexOf(r.findings[0]!.severity)).toBeGreaterThanOrEqual(RANK.indexOf(minTop));
    expect(r.diagnostics).toEqual([]);
    // Every finding is actionable: it points at something or explains itself.
    for (const f of r.findings) expect(f.metricIds.length + f.claimIds.length + f.sourceIds.length + f.pages.length > 0 || f.detail.length > 40).toBe(true);
  });

  it("everything at once: top 5 are all CRITICAL/HIGH and the summary counts are consistent", () => {
    const d = cleanDeal();
    for (const [, build] of SCENARIOS.slice(1, 9)) {
      const x = build();
      d.metrics = [...d.metrics.filter((a) => !x.metrics.some((b) => b.metricKey === a.metricKey && b.isPrimary && a.isPrimary)), ...x.metrics.filter((b) => !d.metrics.some((a) => a.id === b.id))];
      d.metricObservations.push(...x.metricObservations.filter((o) => !d.metricObservations.includes(o)));
      d.claims.push(...x.claims.filter((c) => !d.claims.some((y) => y.id === c.id)));
      d.deckMarket = x.deckMarket.tam?.amount !== 5e9 ? x.deckMarket : d.deckMarket;
      d.customers = x.customers?.namedCustomers.some((n) => n.evidenceLevel === "LOGO_ONLY") ? x.customers : d.customers;
    }
    const r = run(d);
    expect(r.summary.top.every((t) => t.severity === "CRITICAL" || t.severity === "HIGH")).toBe(true);
    expect(r.summary.critical + r.summary.high).toBeGreaterThanOrEqual(5);
    expect(r.summary.headline).toMatch(/critical/);
  });

  it("a clean deck and its manipulated twin differ only by the manipulation's findings", () => {
    const clean = run(cleanDeal());
    const twin = cleanDeal();
    setMetric(twin, "acv", 150_000);
    const r = run(twin);
    expect(clean.findings).toEqual([]);
    // The inflated ACV also makes the deck's own price × customers exceed its TAM (LOW).
    expect(r.findings.map((f) => [f.kind, f.severity])).toEqual([
      ["IMPLIED_ACV", "CRITICAL"],
      ["IMPLIED_TAM_VS_PRICE_X_CUSTOMERS", "LOW"],
    ]);
  });
});
