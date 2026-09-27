/**
 * Integrity engine — 2. implied metrics ("the equations between slides").
 */
import { describe, expect, it } from "vitest";
import { severityForDeltaPct, relDeltaPct } from "@/engine/integrity/util";
import { parseHires } from "@/engine/integrity/implied";
import { cleanDeal, findingsOf, implied, kinds, m, obs, removeMetric, run, setMetric } from "./fixtures/integrity/builders";

const usd = (amount: number, raw = `$${amount}`) => ({ amount, currency: "USD", rawText: raw });

describe("tolerance-based severity", () => {
  it.each([
    [0, null],
    [1.99, null],
    [2, "LOW"],
    [9.99, "LOW"],
    [10, "MODERATE"],
    [24.9, "MODERATE"],
    [25, "HIGH"],
    [50, "HIGH"],
    [50.01, "CRITICAL"],
    [400, "CRITICAL"],
    [Number.POSITIVE_INFINITY, "CRITICAL"],
  ])("Δ %d%% → %s", (d, sev) => {
    expect(severityForDeltaPct(d)).toBe(sev);
  });
  it("relative delta is measured against the implied value", () => {
    expect(relDeltaPct(150, 100)).toBe(50);
    expect(relDeltaPct(100, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(relDeltaPct(0, 0)).toBe(0);
  });
});

describe("implied ACV = ARR / customers (ACV contradiction)", () => {
  it.each([
    [41_700, "CONSISTENT", null],
    [44_000, "INCONSISTENT", "LOW"],
    [50_000, "INCONSISTENT", "MODERATE"],
    [60_000, "INCONSISTENT", "HIGH"],
    [120_000, "INCONSISTENT", "CRITICAL"],
    [15_000, "INCONSISTENT", "CRITICAL"],
  ])("stated ACV %d vs implied 41.7k → %s %s", (acv, verdict, sev) => {
    const d = cleanDeal();
    setMetric(d, "acv", acv);
    const r = run(d);
    const row = implied(r, "ACV");
    expect(row.impliedValue).toBeCloseTo(41_739.13, 1);
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
    expect(findingsOf(r, "IMPLIED_ACV").map((f) => f.severity)).toEqual(sev ? [sev] : []);
  });

  it("finding points at the ARR, customer and ACV metric ids and their pages", () => {
    const d = cleanDeal();
    setMetric(d, "acv", 120_000, { location: "p. 9" });
    const f = findingsOf(run(d), "IMPLIED_ACV")[0]!;
    expect(f.metricIds).toEqual(expect.arrayContaining(["MET-001", "MET-011", "MET-013"]));
    expect(f.pages).toEqual([3, 4, 9]);
  });

  it("a derived ACV is never treated as a stated one", () => {
    const d = cleanDeal();
    setMetric(d, "acv", 41_739, { calculationMethod: "DERIVED" });
    expect(implied(run(d), "ACV").verdict).toBe("UNVERIFIABLE");
  });

  it("zero customers makes ACV unverifiable, not infinite", () => {
    const d = cleanDeal();
    setMetric(d, "paying_customers", 0, { unit: "COUNT" });
    expect(implied(run(d), "ACV").impliedValue).toBeNull();
  });
});

describe("runway claimed vs implied (pre- vs post-round)", () => {
  it.each([
    // [claimed months, verdict, severity, interpretation]
    [8.6, "CONSISTENT", null, "pre-round"],
    [27, "CONSISTENT", null, "post-round"],
    [36, "INCONSISTENT", "HIGH", "post-round"],
    [60, "INCONSISTENT", "CRITICAL", "post-round"],
    [18, "INCONSISTENT", "HIGH", "post-round"],
  ])("claim %d months → %s %s (closest %s)", (claim, verdict, sev, interp) => {
    const d = cleanDeal();
    removeMetric(d, "runway_months");
    d.financing!.runwayClaimMonths = claim;
    const row = implied(run(d), "RUNWAY");
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
    expect(row.note).toContain(interp);
  });

  it("post-round uses planned burn when stated, current burn otherwise", () => {
    const d = cleanDeal();
    removeMetric(d, "runway_months");
    d.financing!.runwayClaimMonths = 42.9; // (3M + 12M) / 350k
    d.financingPath!.plannedMonthlyBurnUsd = null;
    expect(implied(run(d), "RUNWAY").verdict).toBe("CONSISTENT");
  });

  it("cash-flow positive company: runway is unbounded and never flagged", () => {
    const d = cleanDeal();
    d.financing!.monthlyBurn = usd(-50_000);
    d.financing!.runwayClaimMonths = 99;
    expect(implied(run(d), "RUNWAY").verdict).toBe("UNVERIFIABLE");
  });

  it("burn in EUR is converted before dividing", () => {
    const d = cleanDeal();
    removeMetric(d, "runway_months");
    d.financing!.monthlyBurn = { amount: 320_000, currency: "EUR", rawText: "€320k" };
    d.financing!.runwayClaimMonths = 8.6;
    expect(implied(run(d), "RUNWAY").impliedValue).not.toBeCloseTo(3_000_000 / 320_000, 1);
  });
});

describe("customer growth vs ARR growth ⇒ implied ARPA / expansion", () => {
  const withCustomers = (prior: number, nrr: number | null) => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.id !== "MET-012");
    d.metrics.push(m("MET-012", "paying_customers", prior, { unit: "COUNT", periodEnd: "2025-08", isPrimary: false }));
    setMetric(d, "arr_growth_yoy", 200, { unit: "PERCENT" });
    if (nrr === null) removeMetric(d, "nrr");
    else setMetric(d, "nrr", nrr, { unit: "PERCENT", sampleSize: 45, cohortDefinition: "trailing 12 months" });
    return d;
  };
  it("customers +60%, ARR +200% ⇒ ≈ 88% ARPA growth needed (example from the spec)", () => {
    const row = implied(run(withCustomers(57.5, null)), "ARPA_EXPANSION");
    expect(row.impliedValue).toBeCloseTo(87.5, 0);
    expect([row.verdict, row.severity]).toEqual(["INCONSISTENT", "MODERATE"]);
  });
  it.each([
    // [prior customers (now 92), ARR growth %, NRR, verdict, severity]
    [57.5, 200, 110, "INCONSISTENT", "MODERATE"], // NRR explains 10 of 88 points
    [57.5, 200, 160, "CONSISTENT", null], // NRR 160% can carry it
    [80, 200, null, "INCONSISTENT", "HIGH"], // customers +15% ⇒ ARPA +161%
    [80, 20, null, "CONSISTENT", null], // customers +15%, ARR +20%
    [30, 200, null, "CONSISTENT", null], // customers and ARR both ~3×
  ])("prior customers %d, ARR growth %d%%, NRR %s → %s %s", (prior, g, nrr, verdict, sev) => {
    const d = withCustomers(prior, nrr);
    setMetric(d, "arr_growth_yoy", g, { unit: "PERCENT" });
    const row = implied(run(d), "ARPA_EXPANSION");
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
  });
  it("ARR far behind customer growth ⇒ LOW (falling ARPA or non-paying counted)", () => {
    const d = withCustomers(10, 110);
    setMetric(d, "arr_growth_yoy", 50, { unit: "PERCENT" });
    const row = implied(run(d), "ARPA_EXPANSION");
    expect([row.verdict, row.severity]).toEqual(["INCONSISTENT", "LOW"]);
  });
  it("without a customer history the relation is unverifiable", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.id !== "MET-012");
    expect(implied(run(d), "ARPA_EXPANSION").verdict).toBe("UNVERIFIABLE");
  });
});

describe("stated growth vs the ARR points shown", () => {
  it.each([
    [210, "CONSISTENT"],
    [400, "INCONSISTENT"],
    [150, "INCONSISTENT"],
  ])("stated %d%% vs series ≈ 210%% → %s", (g, verdict) => {
    const d = cleanDeal();
    setMetric(d, "arr_growth_yoy", g, { unit: "PERCENT" });
    expect(implied(run(d), "ARR_GROWTH").verdict).toBe(verdict);
  });
  it("uses observations when instances hold a single point", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.id !== "MET-002");
    d.metricObservations.push(obs("arr", 1_000_000, { periodEnd: "2025-08", page: 3 }));
    const row = implied(run(d), "ARR_GROWTH");
    expect(row.impliedValue).toBeCloseTo(284, 0);
    expect(row.severity).toBe("MODERATE");
  });
});

describe("ARR per FTE, burn multiple, MRR × 12", () => {
  it.each([
    [128_000, "CONSISTENT"],
    [300_000, "INCONSISTENT"],
  ])("stated revenue per employee %d → %s", (v, verdict) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-RPE", "revenue_per_employee", v));
    expect(implied(run(d), "ARR_PER_FTE").verdict).toBe(verdict);
  });
  it.each([
    [1.6, null],
    [0.8, "CRITICAL"],
    [1.3, "MODERATE"],
  ])("stated burn multiple %d vs implied ≈ 1.62 → %s", (bm, sev) => {
    const d = cleanDeal();
    setMetric(d, "burn_multiple", bm, { unit: "MULTIPLE" });
    expect(implied(run(d), "BURN_MULTIPLE").severity).toBe(sev);
  });
  it("burn multiple is unbounded when ARR shrank", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.map((x) => (x.id === "MET-002" ? { ...x, normalizedValue: 5_000_000 } : x));
    const row = implied(run(d), "BURN_MULTIPLE");
    expect(row.impliedValue).toBeNull();
    expect(row.note).toContain("unbounded");
  });
  it.each([
    [320_000, "CONSISTENT"],
    [250_000, "INCONSISTENT"],
  ])("MRR %d vs ARR $3.84M → %s", (mrr, verdict) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-MRR", "mrr", mrr));
    expect(implied(run(d), "ARR_VS_MRR").verdict).toBe(verdict);
  });
});

describe("round terms: implied pre/post, dilution, SAFE", () => {
  it.each([
    [48_000_000, 60_000_000, "CONSISTENT", null],
    [50_000_000, 60_000_000, "INCONSISTENT", "LOW"],
    [60_000_000, 60_000_000, "INCONSISTENT", "HIGH"],
    [80_000_000, 60_000_000, "INCONSISTENT", "CRITICAL"],
  ])("pre %d, post %d, raise 12M → %s %s", (pre, post, verdict, sev) => {
    const d = cleanDeal();
    d.financing!.preMoney = usd(pre);
    d.financing!.postMoney = usd(post);
    const row = implied(run(d), "PRE_MONEY");
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
  });
  it("implied dilution = raise / post", () => {
    expect(implied(run(cleanDeal()), "DILUTION").impliedValue).toBeCloseTo(20, 5);
  });
  it("option-pool top-up is added to the dilution note", () => {
    const d = cleanDeal();
    d.financing!.optionPoolIncreasePct = 10;
    expect(implied(run(d), "DILUTION").note).toContain("30.0%");
  });
  it("raise ≥ post-money is an impossible round → CRITICAL", () => {
    const d = cleanDeal();
    d.financing!.preMoney = null;
    d.financing!.postMoney = usd(10_000_000);
    const r = run(d);
    expect(implied(r, "DILUTION").severity).toBe("CRITICAL");
    expect(kinds(r)).toContain("IMPLIED_DILUTION");
  });
  it.each([
    [10_000_000, 10_000_000, null, "CONSISTENT"], // post-money SAFE, cap = post
    [8_000_000, null, 8_000_000, "CONSISTENT"], // cap = pre
    [20_000_000, 10_000_000, null, "INCONSISTENT"],
  ])("SAFE cap %d vs post %s / pre %s → %s", (cap, post, pre, verdict) => {
    const d = cleanDeal();
    d.financing = { ...d.financing!, instrument: "SAFE", raiseAmount: usd(2_000_000), valuationCap: usd(cap), postMoney: post ? usd(post) : null, preMoney: pre ? usd(pre) : null };
    expect(implied(run(d), "SAFE_CAP").verdict).toBe(verdict);
  });
  it("uncapped SAFE: valuation unverifiable and dilution not computable", () => {
    const d = cleanDeal();
    d.financing = { ...d.financing!, instrument: "SAFE", raiseAmount: usd(2_000_000), valuationCap: null, postMoney: null, preMoney: null };
    const r = run(d);
    expect(implied(r, "SAFE_CAP").note).toContain("Uncapped");
    expect(implied(r, "DILUTION").impliedValue).toBeNull();
  });
  it("SAFE dilution is computed from the cap when no valuation is stated", () => {
    const d = cleanDeal();
    d.financing = { ...d.financing!, instrument: "SAFE", raiseAmount: usd(2_000_000), valuationCap: usd(10_000_000), postMoney: null, preMoney: null };
    expect(implied(run(d), "DILUTION").impliedValue).toBeCloseTo(20, 5);
  });
});

describe("market: TAM manipulation", () => {
  it.each([
    [5e9, "CONSISTENT", null],
    [30e9, "INCONSISTENT", "MODERATE"],
    [100e9, "INCONSISTENT", "HIGH"],
    [500e9, "INCONSISTENT", "CRITICAL"],
    [1e9, "INCONSISTENT", "LOW"], // TAM below the company's own price × customers
  ])("deck TAM %d vs price × customers ≈ $8.3B → %s %s", (tam, verdict, sev) => {
    const d = cleanDeal();
    d.deckMarket = { tam: usd(tam), sam: null, som: null, description: null };
    const row = implied(run(d), "TAM_VS_PRICE_X_CUSTOMERS");
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
  });
  it.each([
    [5e9, null],
    [20e9, "MODERATE"],
    [80e9, "HIGH"],
    [400e9, "CRITICAL"],
  ])("deck TAM %d vs reconstructed $5B → %s", (tam, sev) => {
    const d = cleanDeal();
    d.deckMarket = { tam: usd(tam), sam: null, som: null, description: null };
    expect(implied(run(d), "DECK_TAM_VS_RECONSTRUCTED").severity).toBe(sev);
  });
  it.each([
    [5e9, 1.5e9, 150e6, []],
    [5e9, 6e9, 150e6, ["IMPLIED_SAM_WITHIN_TAM"]],
    [5e9, 1.5e9, 2e9, ["IMPLIED_SOM_WITHIN_SAM"]],
    [5e9, 12e9, 150e6, ["IMPLIED_SAM_WITHIN_TAM"]],
  ])("TAM %d ⊇ SAM %d ⊇ SOM %d", (tam, sam, som, expected) => {
    const d = cleanDeal();
    d.deckMarket = { tam: usd(tam), sam: usd(sam), som: usd(som), description: null };
    const r = run(d);
    expect(kinds(r).filter((k) => k === "IMPLIED_SAM_WITHIN_TAM" || k === "IMPLIED_SOM_WITHIN_SAM")).toEqual(expected);
  });
  it("SAM more than twice TAM is CRITICAL", () => {
    const d = cleanDeal();
    d.deckMarket = { tam: usd(1e9), sam: usd(3e9), som: null, description: null };
    expect(implied(run(d), "SAM_WITHIN_TAM").severity).toBe("CRITICAL");
  });
  it("revenue already above SOM", () => {
    const d = cleanDeal();
    d.deckMarket = { ...d.deckMarket, som: usd(2_000_000) };
    expect(implied(run(d), "SOM_VS_REVENUE").severity).toBe("MODERATE");
  });
  it("TAM in EUR is converted before comparison", () => {
    const d = cleanDeal();
    d.deckMarket = { tam: { amount: 5e9, currency: "EUR", rawText: "€5B" }, sam: null, som: null, description: null };
    expect(implied(run(d), "DECK_TAM_VS_RECONSTRUCTED").verdict).toBe("CONSISTENT");
  });
});

describe("use of funds vs planned burn × milestone", () => {
  it.each([
    [20, 550_000, "CONSISTENT", null], // 11M needed, 15M available
    [30, 550_000, "INCONSISTENT", "LOW"], // 16.5M needed → 9% short
    [30, 700_000, "INCONSISTENT", "HIGH"], // 21M → 28.6% short
    [36, 900_000, "INCONSISTENT", "CRITICAL"], // 32.4M → 53.7% short
  ])("milestone %d months at %d/month → %s %s", (months, burn, verdict, sev) => {
    const d = cleanDeal();
    d.financingPath = { ...d.financingPath!, milestoneMonths: months, plannedMonthlyBurnUsd: burn };
    const row = implied(run(d), "RAISE_FUNDS_MILESTONE");
    expect([row.verdict, row.severity]).toEqual([verdict, sev]);
  });
  it("funds the milestone but not the fundraising buffer → note only", () => {
    const d = cleanDeal();
    d.financingPath = { ...d.financingPath!, milestoneMonths: 25, plannedMonthlyBurnUsd: 550_000 };
    const row = implied(run(d), "RAISE_FUNDS_MILESTONE");
    expect(row.verdict).toBe("CONSISTENT");
    expect(row.note).toContain("not the ~6-month raise");
  });
  it("claimed milestone beyond post-round runway", () => {
    const d = cleanDeal();
    d.financing!.milestonesClaimed = [{ milestone: "$25M ARR", monthsFromNow: 40 }];
    const row = implied(run(d), "MILESTONES_WITHIN_RUNWAY");
    expect(row.verdict).toBe("INCONSISTENT");
  });
  it.each([
    [["50% R&D", "30% sales", "20% G&A"], "CONSISTENT"],
    [["50% R&D", "40% sales", "30% G&A"], "INCONSISTENT"],
  ])("use-of-funds allocation %j → %s", (uof, verdict) => {
    const d = cleanDeal();
    d.financing!.useOfFunds = uof;
    expect(implied(run(d), "USE_OF_FUNDS_ALLOCATION").verdict).toBe(verdict);
  });
});

describe("hiring plan vs burn", () => {
  it.each([
    [["hire 30 engineers"], 30],
    [["12 new hires in sales"], 12],
    [["grow the team to 45"], 15],
    [["expand into Europe"], null],
  ])("parseHires(%j) with 30 on staff → %s", (texts, n) => {
    expect(parseHires(texts, 30)).toBe(n);
  });
  it("30 hires cannot fit in a $200k/month burn increase", () => {
    const d = cleanDeal();
    d.financing!.useOfFunds = ["hire 30 engineers and AEs"];
    const row = implied(run(d), "HIRING_PLAN_VS_BURN");
    expect(row.verdict).toBe("INCONSISTENT");
    expect(row.severity).toBe("MODERATE"); // assumption-driven: capped
  });
  it("10 hires fit", () => {
    const d = cleanDeal();
    d.financing!.useOfFunds = ["hire 10 engineers"];
    expect(implied(run(d), "HIRING_PLAN_VS_BURN").verdict).toBe("CONSISTENT");
  });
  it("forecast headcount is used when the text gives no number", () => {
    const d = cleanDeal();
    d.metricObservations.push(obs("headcount", 80, { unit: "COUNT", currency: null, basis: "FORECAST", periodEnd: "2027-12" }));
    expect(implied(run(d), "HIRING_PLAN_VS_BURN").impliedValue).toBe(50 * 12_500);
  });
});

describe("marketplace, concentration and unit-economics identities", () => {
  it.each([
    [1_200_000, "CONSISTENT"],
    [3_000_000, "INCONSISTENT"],
  ])("revenue %d vs GMV $10M × 12%% → %s", (rev, verdict) => {
    const d = cleanDeal();
    removeMetric(d, "arr");
    d.metrics.push(m("MET-REV", "revenue_ttm", rev), m("MET-GMV", "gmv", 10_000_000), m("MET-TAKE", "take_rate", 12, { unit: "PERCENT" }));
    expect(implied(run(d), "NET_REVENUE_FROM_GMV").verdict).toBe(verdict);
  });
  it.each([
    [12, 35, 92, null],
    [40, 30, 92, "CRITICAL"], // top-1 > top-5
    [2, 3, 92, "HIGH"], // top-5 < 500/92
    [5, 60, 10, "HIGH"], // top-1 < 100/10
  ])("top1 %d, top5 %d, N=%d → %s", (t1, t5, n, sev) => {
    const d = cleanDeal();
    setMetric(d, "customer_concentration_top1", t1, { unit: "PERCENT" });
    setMetric(d, "customer_concentration_top5", t5, { unit: "PERCENT" });
    setMetric(d, "paying_customers", n, { unit: "COUNT" });
    expect(implied(run(d), "CONCENTRATION_BOUNDS").severity).toBe(sev);
  });
  it.each([
    [14, "CONSISTENT"],
    [6, "INCONSISTENT"],
  ])("CAC payback stated %d vs CAC 37k / (ACV/12 × 76%%) ≈ 14 → %s", (p, verdict) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-CAC", "cac", 37_000, { definitionUsed: "fully loaded" }));
    setMetric(d, "cac_payback_months", p, { unit: "MONTHS" });
    expect(implied(run(d), "CAC_PAYBACK").verdict).toBe(verdict);
  });
  it.each([
    [5, "CONSISTENT"],
    [9, "INCONSISTENT"],
  ])("LTV/CAC stated %d vs 150k / 30k → %s", (v, verdict) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-LTV", "ltv", 150_000), m("MET-CAC", "cac", 30_000, { definitionUsed: "fully loaded" }), m("MET-LC", "ltv_to_cac", v, { unit: "MULTIPLE" }));
    expect(implied(run(d), "LTV_TO_CAC").verdict).toBe(verdict);
  });
  it.each([
    [25, "CONSISTENT"],
    [60, "INCONSISTENT"],
  ])("DAU/MAU stated %d vs 50k / 200k → %s", (v, verdict) => {
    const d = cleanDeal();
    d.metrics.push(m("MET-DAU", "dau", 50_000, { unit: "COUNT" }), m("MET-MAU", "mau", 200_000, { unit: "COUNT" }), m("MET-DM", "dau_mau", v, { unit: "PERCENT" }));
    expect(implied(run(d), "DAU_MAU").verdict).toBe(verdict);
  });
});

describe("implied table contract", () => {
  it("every row has a formula, inputs and a verdict; UNVERIFIABLE rows list what is missing", () => {
    const d = cleanDeal();
    d.financing = null;
    d.financingPath = null;
    const r = run(d);
    for (const row of r.impliedMetrics) {
      expect(row.formula.length).toBeGreaterThan(3);
      expect(["CONSISTENT", "INCONSISTENT", "UNVERIFIABLE"]).toContain(row.verdict);
      if (row.verdict === "UNVERIFIABLE") expect(row.severity).toBeNull();
      if (row.verdict === "INCONSISTENT") expect(row.severity).not.toBeNull();
    }
    expect(implied(r, "RAISE_FUNDS_MILESTONE").missingInputs).toEqual(expect.arrayContaining(["raise", "milestone months"]));
  });
});
