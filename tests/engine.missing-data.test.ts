/**
 * Missing data must never improve a score or an outcome — regression tests for the
 * defects where withholding (a sample size, an as-of date, a valuation, a signal) or a
 * rejected / unconverted input used to raise a score, unlock a gate or mislabel a value.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { getRegistry } from "@/engine/benchmarks";
import { derive } from "@/engine/derive";
import { decisionFocus, formatByUnit } from "@/engine/focus";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { addOverride, applyOverrides, resolveOverrides } from "@/engine/overrides";
import { upgradeLegacyCorrections } from "@/engine/override-carry";
import { isAnalystCorrected } from "@/engine/override-marks";
import { backwardsReturn } from "@/engine/returns";
import { reconstructMarket } from "@/engine/market";
import { matchCompanies } from "@/engine/company-match";
import { resolveDeckLineage, type LineageDoc } from "@/engine/deck-lineage";
import { normalizeObservation, toUsd } from "@/engine/metrics/normalize";
import { deckDiff } from "@/engine/latent/deck-diff";
import { makeDeal, metric } from "./fixtures";

const reg = getRegistry();
const now = new Date("2026-09-01");
const run = (d: CanonicalDeal) => derive(d, reg, DEFAULT_FUND_PROFILE, { now });
const dim = (d: CanonicalDeal, id: string) => run(d).dimensions.find((x) => x.id === id)!;
const withNrr = (patch: Partial<MetricInstance>) => {
  const d = makeDeal();
  d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, ...patch } : m));
  // Enough PMF signals for the measured PMF rating to be computed (3 of 4 expected).
  d.metrics.push(metric("grr", 92, { unit: "PERCENT", sampleSize: 45 }), metric("logo_retention", 92, { unit: "PERCENT", sampleSize: 45 }));
  return d;
};

describe("withholding a sample size or an as-of date never raises the score", () => {
  it("an undisclosed sample size is charged like a disclosed small sample", () => {
    const disclosed = withNrr({ sampleSize: 12, qualityFlags: ["SMALL_SAMPLE: n=12 < 20"] });
    const withheld = withNrr({ sampleSize: null, qualityFlags: ["SAMPLE_SIZE_UNKNOWN (min 20)"] });
    const a = run(disclosed);
    const b = run(withheld);
    const credit = (x: typeof a) => x.dimensions.find((d) => d.id === "TRACTION_PMF")!.components.find((c) => c.metricKey === "nrr")!.credit;
    expect(credit(b)).toBe(credit(a));
    expect(credit(b)).toBeLessThan(1);
    const ta = a.dimensions.find((d) => d.id === "TRACTION_PMF")!;
    const tb = b.dimensions.find((d) => d.id === "TRACTION_PMF")!;
    expect(tb.lower).toBeLessThanOrEqual(ta.lower);
    expect(tb.value!).toBeLessThanOrEqual(ta.value!);
    expect(b.operatingQuality.lower).toBeLessThanOrEqual(a.operatingQuality.lower);
  });

  it("an undated figure earns no more coverage credit than a dated-but-stale one", () => {
    const stale = withNrr({ state: "STALE", periodEnd: "2025-06", qualityFlags: ["STALE: 15 months old (max 6)"] });
    const undated = withNrr({ state: "OBSERVED", periodEnd: null, qualityFlags: ["NO_AS_OF_DATE"] });
    const a = run(stale);
    const b = run(undated);
    const nrr = (x: typeof a) => x.dimensions.find((d) => d.id === "TRACTION_PMF")!.components.find((c) => c.metricKey === "nrr")!;
    expect(nrr(b).credit).toBeLessThanOrEqual(nrr(a).credit);
    expect(b.dimensions.find((d) => d.id === "TRACTION_PMF")!.lower).toBeLessThanOrEqual(a.dimensions.find((d) => d.id === "TRACTION_PMF")!.lower);
    expect(b.operatingQuality.lower).toBeLessThanOrEqual(a.operatingQuality.lower);
  });

  it("end to end: an NRR whose period is withheld never beats the same NRR dated 15 months ago", () => {
    let i = 0;
    const ob = (periodEnd: string | null) =>
      normalizeObservation(
        { metricKey: "nrr", label: "NRR", rawText: "NRR 118% across 45 customers, trailing 12-month cohort", value: 118, unit: "PERCENT", currency: null, periodType: "TTM", periodStart: null, periodEnd, definitionAsStated: "x", components: [], sampleSize: 45, cohortDefinition: "ttm", state: "OBSERVED", basis: "CURRENT", sourceKind: "TEXT", page: 1, excerpt: "" } as never,
        { asOf: now, nextId: () => `N${i++}`, sourceIdForPage: () => "S" },
      )!;
    const lowerOf = (pe: string | null) => {
      const d = makeDeal();
      d.metrics = [...d.metrics.filter((x) => x.metricKey !== "nrr"), { ...ob(pe), isPrimary: true }];
      const a = run(d);
      return { traction: a.dimensions.find((x) => x.id === "TRACTION_PMF")!.lower, oqi: a.operatingQuality.lower };
    };
    const dated = lowerOf("2025-06");
    const undated = lowerOf(null);
    expect(undated.traction).toBeLessThanOrEqual(dated.traction);
    expect(undated.oqi).toBeLessThanOrEqual(dated.oqi);
  });

  it.each([["SAMPLE_SIZE_UNKNOWN (min 20)"], ["NO_AS_OF_DATE"]])("a metric flagged %s is never an outlier candidate", (flag) => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 175, rawValue: "175%", qualityFlags: [flag] } : m));
    const a = run(d);
    const f = decisionFocus(d, reg, resolvePeerGroup(d.classification), { sensitivity: a.economics.sensitivity.rows, gates: a.fundFit.gates });
    expect(f.outlierCandidates.some((o) => o.label.startsWith("NRR"))).toBe(false);
  });
});

describe("the exceptional override is tested on the Power-Law lower bound", () => {
  function exceptional(withPrice: boolean) {
    const d = makeDeal();
    d.market = { ...d.market!, bottomUp: { customerDefinition: "x", customerCountLow: 20_000, customerCountHigh: 40_000, annualSpendLowUsd: 10_000, annualSpendHighUsd: 25_000, spendBasis: "t" } };
    d.powerLawRatings = { ...d.powerLawRatings!, nonlinearMechanism: "STRONG", exceptionalStrength: "EXCEPTIONAL" };
    d.exceptionalStrengths = [{ claim: "x", evidence: "y", rating: "EXCEPTIONAL", claimRefs: [] } as never];
    d.financing = { ...d.financing!, preMoney: withPrice ? { amount: 400_000_000, currency: "USD", rawText: "$400M" } : null };
    return d;
  }
  const override = (d: CanonicalDeal) => {
    const a = run(d);
    return { applied: a.recommendation.exceptionalOverride, trace: a.recommendation.trace.find((t) => t.gate === "EXCEPTIONAL_OVERRIDE")!, pl: a.powerLaw, thesis: a.recommendation.trace.find((t) => t.gate === "THESIS_KILLER")! };
  };

  it("withholding the valuation (the weak outlier-path component) never enables the override", () => {
    const disclosed = override(exceptional(true));
    const withheld = override(exceptional(false));
    expect(disclosed.applied).toBe(false);
    // The observed-only average rises when the price is withheld; the lower bound does not.
    expect(withheld.pl.value!).toBeGreaterThan(disclosed.pl.value!);
    expect(withheld.pl.lower).toBeLessThanOrEqual(disclosed.pl.lower);
    expect(withheld.applied).toBe(false);
    expect(withheld.trace.outcome).toBe("N/A");
  });

  it("…and so never bypasses a likely thesis killer", () => {
    const d = exceptional(false);
    d.risks = [...d.risks, { category: "MARKET", title: "Regulation bans the product", description: "x", severity: "CRITICAL", likelihood: "HIGH", timing: "NEXT_12_MONTHS", mitigation: "", evidence: "", claimRefs: [], weaknessClass: "THESIS_KILLING", repair: null } as never];
    const r = override(d);
    expect(r.thesis.outcome).toBe("BLOCK");
  });
});

describe("an analyst value supplied for an UNKNOWN / WITHHELD metric is scored and labelled as analyst-provided", () => {
  const traction = (d: CanonicalDeal) => {
    const t = dim(d, "TRACTION_PMF");
    return { lower: t.lower, value: t.value, nrr: t.components.find((c) => c.metricKey === "nrr")! };
  };

  it.each(["UNKNOWN", "WITHHELD"] as const)("%s → OBSERVED, flagged ANALYST_OVERRIDE, never verified", (state) => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, id: "MET-900", normalizedValue: null, rawValue: "not disclosed", state, verification: "VERIFIED" } : m));
    expect(traction(d).nrr.score).toBeNull();
    const { deal } = addOverride(d, { target: "METRIC", ref: "MET-900", field: "normalizedValue", from: null, to: 118, reason: "founder call", by: "Ana", at: "2026-09-01T00:00:00Z" } as never);
    const m = resolveOverrides(deal).deal.metrics.find((x) => x.id === "MET-900")!;
    expect(m).toMatchObject({ state: "OBSERVED", normalizedValue: 118, verification: "UNVERIFIED" });
    expect(m.qualityFlags.find((f) => f.startsWith("ANALYST_OVERRIDE"))).toMatch(/analyst-provided value — not reported by the company/);
    expect(isAnalystCorrected(m)).toBe(true);
    const t = traction(deal);
    expect(t.nrr.state).toBe("OBSERVED");
    expect(t.nrr.score).toBe(traction(makeDeal()).nrr.score);
    // Idempotent.
    expect(applyOverrides(applyOverrides(deal))).toEqual(applyOverrides(deal));
  });

  it("a reported value corrected by an override keeps its state and verification", () => {
    const d = makeDeal();
    const id = d.metrics.find((m) => m.metricKey === "nrr")!.id;
    const { deal } = addOverride(d, { target: "METRIC", ref: id, field: "normalizedValue", from: 118, to: 110, reason: "bridge", by: "Ana", at: "2026-09-01T00:00:00Z" } as never);
    const m = applyOverrides(deal).metrics.find((x) => x.id === id)!;
    expect(m.state).toBe("OBSERVED");
    expect(m.qualityFlags.find((f) => f.startsWith("ANALYST_OVERRIDE"))).toBe("ANALYST_OVERRIDE: company reported 118");
  });

  function legacy(originalPatch: Partial<MetricInstance> = {}) {
    const L = makeDeal();
    L.metrics = L.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, id: "MET-010", normalizedValue: null, rawValue: "not disclosed", state: "UNKNOWN" as const, isPrimary: false, ...originalPatch } : m));
    L.metrics.push(metric("nrr", 118, { id: "MET-011", unit: "PERCENT", sampleSize: 45, calculationMethod: "USER_CORRECTED", qualityFlags: ["USER_CORRECTED: was n/a"], notes: "Corrected by Ana on 2026-05-01 (replaces MET-010). call", isPrimary: true }));
    return L;
  }

  it("scores are unchanged before/after upgradeLegacyCorrections for an UNKNOWN original", () => {
    const L = legacy();
    const up = upgradeLegacyCorrections(L);
    expect(up.converted).toEqual([expect.objectContaining({ correctedId: "MET-011", originalId: "MET-010" })]);
    const a = run(L);
    const b = run(up.deal);
    expect(b.operatingQuality).toEqual(a.operatingQuality);
    expect(b.dimensions.map((x) => [x.id, x.value, x.lower, x.coverage])).toEqual(a.dimensions.map((x) => [x.id, x.value, x.lower, x.coverage]));
    expect(b.recommendation.status).toBe(a.recommendation.status);
  });

  it("a correction whose original would score differently (other flags / sample) is kept as it is, so scores stay unchanged", () => {
    const L = legacy({ sampleSize: null, qualityFlags: ["SAMPLE_SIZE_UNKNOWN (min 20)"] });
    const up = upgradeLegacyCorrections(L);
    expect(up.converted).toEqual([]);
    expect(up.kept[0]!.reason).toMatch(/sampleSize, quality flags; kept so scores are unchanged/);
    expect(run(up.deal).operatingQuality).toEqual(run(L).operatingQuality);
  });
});

describe("backwards return uses the conservative (lower-middle) revenue multiple", () => {
  it("[4, 8, 12, 20] → 8×, the higher required revenue", () => {
    const b = backwardsReturn(100_000_000, 10, reg, { usd: null, source: "n/a" }, 10_000_000_000);
    expect(reg.returns.backwardsRevenueMultiples).toEqual([4, 8, 12, 20]);
    expect(b.explanation).toContain("at 8×");
    expect(b.medianSamSharePct).toBeCloseTo(b.byMultiple.find((r) => r.revenueMultiple === 8)!.samSharePct!, 9);
  });

  it("the median is order-independent and conservative", () => {
    const shuffled = { ...reg, returns: { ...reg.returns, backwardsRevenueMultiples: [20, 4, 12, 8] } };
    expect(backwardsReturn(100_000_000, 10, shuffled, { usd: null, source: "n/a" }, 10_000_000_000).explanation).toContain("at 8×");
  });
});

describe("a market range rejected as too small never hands the score to a larger range", () => {
  const withMarket = (bottomUpSpendHighUsd: number) => {
    const d = makeDeal();
    d.market = {
      ...d.market!,
      bottomUp: { customerDefinition: "clinics", customerCountLow: 100, customerCountHigh: 200, annualSpendLowUsd: 10_000, annualSpendHighUsd: bottomUpSpendHighUsd, spendBasis: "t" },
      valueCapture: null,
      topDown: { lowUsd: 1_000_000_000, highUsd: 3_000_000_000, basis: "analyst reports" } as never,
    };
    return d;
  };

  it("bottom-up below $5M → not scored (top-down shown, not substituted)", () => {
    const tiny = reconstructMarket(withMarket(20_000)); // 200 × $20k = $4M
    expect(tiny.primary).toBeNull();
    expect(tiny.midpointUsd).toBeNull();
    expect(tiny.ranges.some((r) => r.method === "TOP_DOWN")).toBe(true);
    expect(tiny.rejected.some((r) => r.startsWith("Market not scored"))).toBe(true);
  });

  it("a smaller (rejected) bottom-up never scores above a plausible small one", () => {
    const plausible = run(withMarket(30_000)); // 200 × $30k = $6M, accepted
    const rejected = run(withMarket(20_000)); // $4M, rejected
    const market = (a: typeof plausible) => a.dimensions.find((x) => x.id === "MARKET")!;
    expect(market(rejected).lower).toBeLessThanOrEqual(market(plausible).lower);
    expect(rejected.powerLaw.lower).toBeLessThanOrEqual(plausible.powerLaw.lower);
    expect(rejected.operatingQuality.lower).toBeLessThanOrEqual(plausible.operatingQuality.lower);
  });
});

describe("focus values are formatted by unit, never by magnitude", () => {
  it.each([
    [12_000, "paying_customers", undefined, "12,000"],
    [25_000, "headcount", undefined, "25,000"],
    [12_000, "arr", undefined, "$12k"],
    [3_200_000, "arr", undefined, "$3.20M"],
    [40_000_000, "post_money", "USD", "$40.00M"],
    [85_000, "monthly_net_burn", "USD_PER_MONTH", "$85k"],
    [85_000, null, "USD_PER_MONTH", "$85k/mo"],
    [110, "nrr", "PCT", "110%"],
    [14.5, "runway_months", "MONTHS", "14.5 mo"],
    [4.2, "exit_multiple", "MULTIPLE", "4.2×"],
    [15_000, null, undefined, "15,000"],
  ] as const)("%s (%s, %s) → %s", (v, key, unit, out) => {
    expect(formatByUnit(v, key, unit)).toBe(out);
  });
});

describe("company match: a descriptive-suffix-only name difference is never conclusive", () => {
  const cand = (founders: string[] = [], website: string | null = null) => [{ id: "c1", name: "Mistral Labs", website, founders }];
  it("“Mistral AI” vs “Mistral Labs” with nothing else → POSSIBLE, reason says the names differ by a suffix", () => {
    const [m] = matchCompanies({ name: "Mistral AI", nameSource: "IDENTITY", website: null, founders: [] }, cand());
    expect(m!.verdict).toBe("POSSIBLE");
    expect(m!.reasons[0]).toMatch(/descriptive suffix/);
  });
  it("…SAME_LIKELY only when a founder or the domain agrees; DIFFERENT_LIKELY when founders are disjoint", () => {
    expect(matchCompanies({ name: "Mistral AI", nameSource: "IDENTITY", website: null, founders: ["Arthur Mensch"] }, cand(["Arthur Mensch"]))[0]!.verdict).toBe("SAME_LIKELY");
    expect(matchCompanies({ name: "Mistral AI", nameSource: "IDENTITY", website: "https://mistral.ai", founders: [] }, cand([], "https://www.mistral.ai"))[0]!.verdict).toBe("SAME_LIKELY");
    expect(matchCompanies({ name: "Mistral AI", nameSource: "IDENTITY", website: null, founders: ["Jane Roe"] }, cand(["John Doe"]))[0]!.verdict).toBe("DIFFERENT_LIKELY");
  });
  it("an exact name ranks above a suffix-only name", () => {
    const r = matchCompanies({ name: "Mistral AI", nameSource: "IDENTITY", website: null, founders: [] }, [
      { id: "a", name: "Mistral Labs", founders: [] },
      { id: "b", name: "Mistral AI, Inc.", founders: [] },
    ]);
    expect(r.map((x) => x.companyId)).toEqual(["b", "a"]);
  });
});

describe("deck lineage orders by instant, not by timestamp string", () => {
  const doc = (id: string, createdAt: string, deckVersion: number | null = null): LineageDoc => ({ id, filename: `${id}.pdf`, kind: "PDF", createdAt, deckVersion, supersedesDocumentId: null });
  it("an offset ISO timestamp earlier in UTC wins over a later SQLite timestamp", () => {
    // 09:00+02:00 = 07:00Z, before 08:00Z — the string compare said the opposite.
    expect(resolveDeckLineage([doc("late", "2026-05-01 08:00:00"), doc("early", "2026-05-01T09:00:00+02:00")])[0]!.documentId).toBe("early");
  });
  it("a legacy deck uploaded before the first explicit version (in UTC) is v1", () => {
    const l = resolveDeckLineage([doc("legacy", "2026-05-01T09:00:00+02:00"), doc("v2", "2026-05-01 08:00:00", 2)]);
    expect(l.map((e) => [e.seq, e.documentId])).toEqual([
      [1, "legacy"],
      [2, "v2"],
    ]);
  });
});

describe("deck-to-deck milestones: units must fit, money is converted, unconvertible amounts are dropped", () => {
  const o = (metricKey: string, value: number, currency: string, periodEnd: string, extra: Record<string, unknown> = {}) =>
    ({ metricKey, label: metricKey.toUpperCase(), rawText: `${metricKey} ${value} ${currency}`, value, unit: "USD_OR_CURRENCY", currency, periodType: "ANNUAL", periodStart: null, periodEnd, definitionAsStated: null, components: [], sampleSize: null, cohortDefinition: null, state: "OBSERVED", basis: "CURRENT", sourceKind: "TEXT", page: 3, excerpt: "", ...extra }) as never;
  const decks = (milestones: string[], prevObs: never[], curObs: never[]) => {
    const prev = makeDeal();
    const cur = makeDeal();
    prev.financing = { ...prev.financing!, milestonesClaimed: milestones.map((milestone) => ({ milestone, monthsFromNow: 6 })) as never };
    prev.metricObservations = prevObs;
    cur.metricObservations = curObs;
    return deckDiff(prev, cur, { previousAsOf: new Date("2026-03-15"), currentAsOf: new Date("2026-09-28") });
  };

  it("“Hire 5 sales reps” is not a revenue target (no match, no absurd HIT)", () => {
    const r = decks(["Hire 5 sales reps"], [], [o("revenue_ttm", 3_000_000, "USD", "2026-09")]);
    const m = r.milestones.find((x) => x.description === "Hire 5 sales reps")!;
    expect(m.metricKey).toBeNull();
    expect(m.status).not.toBe("HIT");
    expect(m.gapPct).toBeNull();
    expect(r.headlines.some((h) => h.startsWith("Hit:"))).toBe(false);
  });

  it("“Reach €5M revenue” is converted to USD with the shared FX table before judging", () => {
    const r = decks(["Reach €5M revenue", "Atteindre 5 MEUR de chiffre d'affaires"], [], [o("revenue_ttm", 5_200_000, "USD", "2026-09")]);
    const eurUsd = toUsd(5_000_000, "EUR")!.usd;
    expect(eurUsd).toBeGreaterThan(5_200_000); // €5M is more than $5.2M at the table rate
    for (const m of r.milestones) {
      expect(m.metricKey).toBe("revenue_ttm");
      expect(m.target).toBeCloseTo(eurUsd, 0);
      expect(m.status).toBe("MISSED");
    }
  });

  it("a money amount never targets a count, and a USD metric needs a money amount", () => {
    const r = decks(["Reach $2M from 50 customers", "Reach 120 customers"], [], [o("paying_customers", 130, "USD", "2026-09", { unit: "COUNT", currency: null })]);
    expect(r.milestones.find((x) => x.description.startsWith("Reach $2M"))!.metricKey).toBeNull();
    expect(r.milestones.find((x) => x.description === "Reach 120 customers")).toMatchObject({ metricKey: "paying_customers", target: 120, status: "HIT" });
  });

  it("an amount in a currency without an FX rate is dropped, never compared unconverted", () => {
    const r = decks([], [o("arr", 4_000_000, "XYZ", "2026-03")], [o("arr", 40_000_000, "USD", "2026-03")]);
    expect(r.changedNumbers.some((c) => c.metricKey === "arr")).toBe(false);
    const f = decks([], [o("arr", 9_000_000, "XYZ", "2026-06", { basis: "FORECAST" })], [o("arr", 4_000_000, "USD", "2026-06")]);
    const m = f.milestones.find((x) => x.metricKey === "arr")!;
    expect(m.target).toBeNull();
    expect(m.status).not.toBe("MISSED");
  });
});
