/**
 * §122–126 Scoring stability, prestige bias, missing data, economic
 * sensitivity — the deterministic guarantees of Layer A.
 */
import { describe, expect, it } from "vitest";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { makeDeal, metric } from "./fixtures";
import { aggregate } from "@/engine/scoring/dimensions";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { interpolate } from "@/engine/scoring/curve";
import { reconstructMarket } from "@/engine/market";

const reg = getRegistry();
const now = new Date("2026-09-27T00:00:00Z");

describe("peer groups", () => {
  it("resolves profile and stage from independent axes", () => {
    const p = resolvePeerGroup(makeDeal().classification);
    expect(p.profile).toBe("ENTERPRISE_SAAS");
    expect(p.stageBand).toBe("GROWTH");
  });
  it("biotech never lands in a SaaS peer group", () => {
    const d = makeDeal();
    d.classification.productType = ["THERAPEUTIC"];
    expect(resolvePeerGroup(d.classification).profile).toBe("BIOTECH_MEDTECH");
  });
});

describe("curves", () => {
  it("interpolates and clamps", () => {
    const c = [{ value: 0, score: 0 }, { value: 10, score: 100 }];
    expect(interpolate(c, 5)).toBe(50);
    expect(interpolate(c, -5)).toBe(0);
    expect(interpolate(c, 50)).toBe(100);
  });
});

describe("aggregate bounds", () => {
  it("missing weight widens bounds instead of being redistributed silently", () => {
    const s = aggregate(reg, [
      { weight: 0.5, credit: 1, score: 80 },
      { weight: 0.5, credit: 0, score: null },
    ]);
    expect(s.value).toBe(80);
    expect(s.lower).toBe(40);
    expect(s.upper).toBe(90);
    expect(s.coverage).toBe(0.5);
    expect(s.status).toBe("PARTIAL");
  });
  it("NOT_SCORABLE below the partial threshold", () => {
    const s = aggregate(reg, [
      { weight: 0.8, credit: 0, score: null },
      { weight: 0.2, credit: 1, score: 90 },
    ]);
    expect(s.status).toBe("NOT_SCORABLE");
  });
});

describe("§122 score stability", () => {
  it("identical canonical data → identical scores (marketing language is not an input)", () => {
    const a = makeDeal();
    const b = makeDeal();
    b.identity.oneLiner = "The world's leading revolutionary AI-native platform transforming finance forever.";
    b.classification.rationale = "Category-defining visionary disruptor.";
    const da = derive(a, reg, DEFAULT_FUND_PROFILE, { now });
    const db = derive(b, reg, DEFAULT_FUND_PROFILE, { now });
    expect(db.operatingQuality).toEqual(da.operatingQuality);
    expect(db.dimensions.map((d) => d.value)).toEqual(da.dimensions.map((d) => d.value));
  });
});

describe("§123 prestige bias", () => {
  it("investor names, schools and employers do not enter the operating analysis", () => {
    const a = makeDeal();
    const b = makeDeal();
    b.foundersFromDeck = [{ name: "X", role: "CEO", backgroundFromDeck: "Stanford, ex-Google, ex-McKinsey", priorOrganizations: ["Google", "McKinsey"], publicProfileUrls: [] }];
    b.financing = { ...b.financing!, existingInvestors: ["Sequoia", "a16z"], leadInvestor: "Sequoia" };
    const da = derive(a, reg, DEFAULT_FUND_PROFILE, { now });
    const db = derive(b, reg, DEFAULT_FUND_PROFILE, { now });
    expect(db.operatingQuality).toEqual(da.operatingQuality);
  });
});

describe("§124 missing data", () => {
  it("removing a weak metric never raises the conservative bound or improves the decision", () => {
    const full = makeDeal();
    full.metrics = full.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 82 } : m));
    const stripped = makeDeal();
    stripped.metrics = stripped.metrics.filter((m) => m.metricKey !== "nrr");
    const a = derive(full, reg, DEFAULT_FUND_PROFILE, { now });
    const b = derive(stripped, reg, DEFAULT_FUND_PROFILE, { now });
    const trA = a.dimensions.find((d) => d.id === "TRACTION_PMF")!;
    const trB = b.dimensions.find((d) => d.id === "TRACTION_PMF")!;
    expect(trB.lower).toBeLessThanOrEqual(trA.lower);
    expect(trB.coverage).toBeLessThan(trA.coverage);
    expect(b.operatingQuality.lower).toBeLessThanOrEqual(a.operatingQuality.lower);
  });

  it("withheld metrics count as missing, not as zero and not as absent weight", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? metric("nrr", null, { state: "WITHHELD", unit: "PERCENT" }) : m));
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    const comp = r.dimensions.find((x) => x.id === "TRACTION_PMF")!.components.find((c) => c.id === "retention")!;
    expect(comp.state).toBe("WITHHELD");
    expect(comp.weight).toBeGreaterThan(0);
    expect(comp.score).toBeNull();
  });

  it("metrics not yet meaningful at this maturity are excluded by the registry, not by the deal", () => {
    const d = makeDeal();
    d.classification.operationalMaturity = "PILOT";
    d.classification.financingStage = "SEED";
    // A pilot-stage company has no measured revenue (with revenue, maturity is anchored on it — see below).
    d.metrics = d.metrics.filter((m) => !["arr", "revenue_ttm", "mrr"].includes(m.metricKey));
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    const comp = r.dimensions.find((x) => x.id === "TRACTION_PMF")!.components.find((c) => c.id === "retention")!;
    expect(comp.state).toBe("NOT_YET_MEANINGFUL");
    expect(r.maturity).toMatchObject({ effective: "PILOT", basis: "MODEL_CLASSIFICATION" });
  });

  it("measured revenue anchors maturity: identical metrics give identical maturity whatever the model's label", () => {
    const a = makeDeal();
    const b = makeDeal();
    a.classification.operationalMaturity = "EARLY_REVENUE";
    b.classification.operationalMaturity = "PMF_EMERGING";
    const ra = derive(a, reg, DEFAULT_FUND_PROFILE, { now });
    const rb = derive(b, reg, DEFAULT_FUND_PROFILE, { now });
    expect(ra.maturity).toMatchObject({ effective: "PMF_EMERGING", basis: "MEASURED_REVENUE", model: "EARLY_REVENUE" });
    expect(ra.dimensions.find((x) => x.id === "TRACTION_PMF")!.value).toBe(rb.dimensions.find((x) => x.id === "TRACTION_PMF")!.value);
  });

  it.each([
    [300_000, "EARLY_REVENUE"],
    [3_840_000, "PMF_EMERGING"],
    [12_000_000, "SCALED_GTM"],
    [60_000_000, "GROWTH"],
  ])("ARR %d → %s", (arr, maturity) => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "arr" ? { ...m, normalizedValue: arr } : m));
    expect(derive(d, reg, DEFAULT_FUND_PROFILE, { now }).maturity!.effective).toBe(maturity);
  });

  it("an analyst override of maturity is respected", () => {
    const d = makeDeal();
    d.classification.operationalMaturity = "SCALED_GTM";
    d.overrides = [{ id: "OVR-1", target: "CLASSIFICATION", ref: "classification", field: "operationalMaturity", from: "PMF_EMERGING", to: "SCALED_GTM", reason: "board deck", by: "gp", at: "2026-09-01", anchor: null, carry: null } as never];
    expect(derive(d, reg, DEFAULT_FUND_PROFILE, { now }).maturity).toMatchObject({ basis: "ANALYST_OVERRIDE" });
  });

  it("small samples lose coverage credit", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, sampleSize: 7, qualityFlags: ["SMALL_SAMPLE: n=7 < 20"] } : m));
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    const comp = r.dimensions.find((x) => x.id === "TRACTION_PMF")!.components.find((c) => c.id === "retention")!;
    expect(comp.credit).toBe(0.5);
    expect(r.smallSampleWarnings.map((w) => w.metricKey)).toContain("nrr");
  });
});

describe("§126 economic sensitivity", () => {
  it("doubling the entry valuation worsens every non-failure scenario", () => {
    const a = derive(makeDeal(), reg, DEFAULT_FUND_PROFILE, { now });
    const post = a.returns.inputs.entry.postMoneyUsd!;
    const b = derive(makeDeal(), reg, DEFAULT_FUND_PROFILE, { now, returnOverrides: { postMoneyUsd: post * 2 } });
    for (const s of ["LOW", "BASE", "BULL", "OUTLIER"] as const) {
      const sa = a.returns.scenarios.find((x) => x.scenario === s)!;
      const sb = b.returns.scenarios.find((x) => x.scenario === s)!;
      expect(sb.exitEquityUsd).toBe(sa.exitEquityUsd); // exits never move with the price we pay
      expect(sb.exitOwnershipPct).toBeLessThan(sa.exitOwnershipPct);
      // When the liquidation preference binds in both cases the multiple is floored, never improved.
      if (sa.preferenceBinding && sb.preferenceBinding) expect(sb.grossMoic!).toBeLessThanOrEqual(sa.grossMoic!);
      else expect(sb.grossMoic!).toBeLessThan(sa.grossMoic!);
    }
    const ps = b.priceSensitivity.find((r) => r.scenario === "BASE")!;
    expect(ps.currentImpliedMoic!).toBeLessThan(a.priceSensitivity.find((r) => r.scenario === "BASE")!.currentImpliedMoic!);
  });

  it("company-specific exit assumptions hold exit value constant when price changes", () => {
    const deal = makeDeal({
      exitAssumptions: [
        { scenario: "FAILURE", exitRevenueUsd: null, revenueMultiple: null, yearsToExit: 3, rationale: "" },
        { scenario: "LOW", exitRevenueUsd: 10e6, revenueMultiple: 3, yearsToExit: 5, rationale: "" },
        { scenario: "BASE", exitRevenueUsd: 60e6, revenueMultiple: 8, yearsToExit: 7, rationale: "" },
        { scenario: "BULL", exitRevenueUsd: 200e6, revenueMultiple: 10, yearsToExit: 8, rationale: "" },
        { scenario: "OUTLIER", exitRevenueUsd: 600e6, revenueMultiple: 12, yearsToExit: 9, rationale: "" },
      ],
    });
    const a = derive(deal, reg, DEFAULT_FUND_PROFILE, { now });
    const b = derive(deal, reg, DEFAULT_FUND_PROFILE, { now, returnOverrides: { postMoneyUsd: a.returns.inputs.entry.postMoneyUsd! * 2 } });
    for (const s of ["BASE", "BULL", "OUTLIER"] as const) {
      expect(b.returns.scenarios.find((x) => x.scenario === s)!.grossMoic!).toBeLessThan(a.returns.scenarios.find((x) => x.scenario === s)!.grossMoic!);
    }
  });

  it("backwards analysis: required equity = contribution / ownership", () => {
    const r = derive(makeDeal(), reg, DEFAULT_FUND_PROFILE, { now, targetContributionUsd: 50_000_000 });
    const bw = r.backwards!;
    expect(bw.requiredExitEquityUsd).toBeCloseTo(50_000_000 / (bw.exitOwnershipPct / 100), 2);
    expect(bw.byMultiple[0]!.requiredRevenueUsd).toBeCloseTo(bw.requiredExitEquityUsd / bw.byMultiple[0]!.revenueMultiple, 2);
  });
});

describe("financing path", () => {
  it("computes runway, buffer and delay shortfalls", () => {
    const r = derive(makeDeal(), reg, DEFAULT_FUND_PROFILE, { now });
    const f = r.financing;
    expect(f.runwayAfterRoundMonths).toBeCloseTo(15_000_000 / 550_000, 6);
    expect(f.requiredMonths).toBe(26);
    expect(f.bufferMonths!).toBeCloseTo(15_000_000 / 550_000 - 26, 6);
    // Positive buffer, but a 6-month milestone delay runs out of cash before the next round.
    expect(f.delays[0]!.cashOutBeforeRaise).toBe(true);
    expect(f.delays[0]!.bridgeNeededUsd).toBeCloseTo((26 + 6 - 15_000_000 / 550_000) * 550_000, 2);
    expect(f.risk).toBe("HIGH");
  });
});

describe("mandate gates and decision", () => {
  it("mandate failure is binary and forces SCREEN_OUT", () => {
    const fund = { ...DEFAULT_FUND_PROFILE, geographies: ["Europe"] };
    const r = derive(makeDeal(), reg, fund, { now });
    expect(r.fundFit.mandate).toBe("FAIL");
    expect(r.recommendation.status).toBe("SCREEN_OUT");
  });

  it("the model's suggestion is rejected when not admissible", () => {
    const d = makeDeal({ aiRecommendation: { suggestedStatus: "ANALYTICAL_RECOMMEND_INVEST", rationale: "love it", watch: null } });
    d.questions = [{ id: "Q-01", question: "?", tier: "MUST_ASK", whyItMatters: "", knownContext: "", ifAnswerA: "a", ifAnswerB: "b", affects: ["RECOMMENDATION"], status: "OPEN", answer: null, answeredAt: null, resolutionNote: null }];
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    expect(r.recommendation.aiAccepted).toBe(false);
    expect(r.recommendation.status).not.toBe("ANALYTICAL_RECOMMEND_INVEST");
  });

  it("fast screens cannot be IC ready", () => {
    const d = makeDeal({ aiRecommendation: { suggestedStatus: "IC_READY", rationale: "", watch: null } });
    d.analysis.mode = "FAST_SCREEN";
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    expect(["SCREEN_OUT", "NEEDS_FOUNDER_CALL", "WATCH", "ANALYTICAL_RECOMMEND_PASS"]).toContain(r.recommendation.status);
  });
});

describe("evidence independence", () => {
  it("five articles repeating one press release count as one confirmation", () => {
    const d = makeDeal();
    d.sources = [0, 1, 2, 3, 4].map((i) => ({
      id: `SRC-W${i}`,
      kind: "WEB" as const,
      title: `Article ${i}`,
      url: `https://news${i}.example/x`,
      documentId: null,
      publisher: null,
      publishedDate: null,
      retrievedAt: now.toISOString(),
      origin: "INDEPENDENT_SECONDARY" as const,
      independenceGroup: "PR-2026-05",
      citationVerified: true,
    }));
    d.claims = [
      {
        id: "CLM-001",
        category: "METRIC",
        statement: "ARR is $3.8M",
        valueText: "$3.8M",
        entity: "company",
        period: null,
        material: true,
        unusualness: 2,
        proposition: null,
        evidenceNeeded: null,
        origin: "COMPANY",
        verification: "PARTIALLY_VERIFIED",
        freshness: "CURRENT",
        independence: "SHARED_ORIGIN",
        verificationMethod: "press",
        limitations: null,
        contradictions: [],
        evidence: d.sources.map((s) => ({ sourceId: s.id, effect: "CONFIRMS" as const, excerpt: "", location: null, note: null })),
        history: [],
      },
    ];
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    expect(r.evidence.independentConfirmations).toBe(1);
  });
});

describe("market plausibility", () => {
  it("rejects per-customer figures mislabelled as a market", async () => {
    const { reconstructMarket } = await import("@/engine/market");
    const d = makeDeal();
    d.market = { ...d.market!, bottomUp: null, valueCapture: { economicValueCreatedLowUsd: 41_000, economicValueCreatedHighUsd: 3_420_000, captureShareLowPct: 10, captureShareHighPct: 20, basis: "" } };
    const m = reconstructMarket(d);
    expect(m.ranges.find((r) => r.method === "VALUE_CAPTURE")).toBeUndefined();
    expect(m.rejected[0]).toMatch(/VALUE_CAPTURE rejected/);
  });
});

describe("founder call gate", () => {
  it("does not recommend another founder call once one was held and must-ask questions are addressed", () => {
    const d = makeDeal({ aiRecommendation: { suggestedStatus: "NEEDS_FOUNDER_CALL", rationale: "stale", watch: null } });
    d.questions = [{ id: "Q-01", question: "?", tier: "MUST_ASK", whyItMatters: "", knownContext: "", ifAnswerA: "a", ifAnswerB: "b", affects: ["RECOMMENDATION"], status: "NOT_FULLY_RESOLVED", answer: "partial", answeredAt: null, resolutionNote: null }];
    d.sources.push({ id: "SRC-900", kind: "TRANSCRIPT", title: "Call", url: null, documentId: null, publisher: null, publishedDate: null, retrievedAt: now.toISOString(), origin: "COMPANY", independenceGroup: "COMPANY", citationVerified: true });
    const r = derive(d, reg, DEFAULT_FUND_PROFILE, { now });
    expect(r.recommendation.status).not.toBe("NEEDS_FOUNDER_CALL");
  });
});

describe("market reconstruction plausibility guards", () => {
  const withBottomUp = (customerCountLow: number, customerCountHigh: number, annualSpendLowUsd: number, annualSpendHighUsd: number) => {
    const d = makeDeal();
    d.market = { ...d.market!, bottomUp: { customerDefinition: "mid-market firms", customerCountLow, customerCountHigh, annualSpendLowUsd, annualSpendHighUsd, spendBasis: "test" }, valueCapture: null, topDown: null };
    return reconstructMarket(d);
  };
  it("a total spend put in the per-customer field is used as the total, never multiplied again", () => {
    const r = withBottomUp(18_000, 20_000, 125_000_000, 1_200_000_000);
    expect(r.primary!.highUsd).toBe(1_200_000_000);
    expect(r.rejected.some((x) => x.startsWith("BOTTOM_UP reinterpreted"))).toBe(true);
  });
  it("a normal per-customer spend is multiplied", () => {
    const r = withBottomUp(150_000, 200_000, 15_000, 25_000);
    expect(r.primary!.highUsd).toBe(5_000_000_000);
    expect(r.rejected).toEqual([]);
  });
  it("a trillion-scale product is rejected as a unit error", () => {
    const r = withBottomUp(1_000_000, 50_000_000, 10_000, 20_000_000);
    expect(r.ranges.some((x) => x.method === "BOTTOM_UP")).toBe(false);
    expect(r.rejected.some((x) => x.includes("unit error") || x.includes("implausible"))).toBe(true);
  });
});

describe("team ratings above ADEQUATE need evidence beyond the company's own statements", () => {
  const withFmf = (verification: "UNVERIFIED" | "VERIFIED") => {
    const d = makeDeal();
    d.claims.push({ ...d.claims[0]!, id: "CLM-900", statement: "CEO ran AP operations for 8 years", verification, origin: verification === "VERIFIED" ? "PRIMARY_EXTERNAL" : "COMPANY", independence: verification === "VERIFIED" ? "INDEPENDENT" : "COMPANY_DERIVED" } as never);
    d.rubric = d.rubric.filter((r) => r.criterion !== "FOUNDER_MARKET_FIT");
    d.rubric.push({ criterion: "FOUNDER_MARKET_FIT", rating: "STRONG", rationale: "claimed AP background", claimRefs: ["CLM-900"] });
    return derive(d, reg, DEFAULT_FUND_PROFILE, { now }).dimensions.find((x) => x.id === "TEAM")!.components.find((c) => c.id === "founder_market_fit")!;
  };
  it("a STRONG founder-market fit resting on company claims only is capped at ADEQUATE, and says so", () => {
    const c = withFmf("UNVERIFIED");
    expect(c.rating).toBe("ADEQUATE");
    expect(c.flags.join(" ")).toContain("CAPPED_UNVERIFIED_TEAM_CLAIMS");
  });
  it("with a verified claim the STRONG rating stands", () => {
    expect(withFmf("VERIFIED").rating).toBe("STRONG");
  });
});
