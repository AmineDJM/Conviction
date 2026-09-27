/**
 * Deck-to-deck reveal: what changed between two deck versions of the same
 * company — and what the founder stopped talking about.
 */
import { describe, expect, it } from "vitest";
import { emptyCanonical, type CanonicalDeal, type Claim } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import { deckDiff } from "@/engine/latent/deck-diff";
import { makeDeal } from "./fixtures";

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

function claim(id: string, statement: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    category: "PRODUCT",
    statement,
    valueText: null,
    entity: "company",
    period: null,
    material: true,
    unusualness: 3,
    proposition: null,
    evidenceNeeded: null,
    origin: "COMPANY",
    verification: "UNVERIFIED",
    freshness: "CURRENT",
    independence: "COMPANY_DERIVED",
    verificationMethod: "Stated in company materials",
    limitations: null,
    contradictions: [],
    evidence: [{ sourceId: "SRC-001", effect: "ORIGIN", excerpt: statement, location: "p. 6", note: null }],
    history: [],
    ...extra,
  };
}

const named = (name: string, evidenceLevel: "LOGO_ONLY" | "PILOT" | "PAYING" | "RECURRING" | "UNKNOWN" = "PAYING") => ({ name, relationship: "PAYING" as const, evidenceLevel, note: null });

/** Previous deck: March 2026. */
function previousDeck(): CanonicalDeal {
  const d = makeDeal();
  d.metrics = [];
  d.metricObservations = [
    obs("arr", 3_000_000, { label: "ARR", rawText: "$3.0M ARR", periodEnd: "2026-02", page: 4 }),
    obs("nrr", 121, { label: "NRR", rawText: "121% NRR", unit: "PERCENT", currency: null, periodEnd: "2026-02", page: 9 }),
    obs("paying_customers", 60, { label: "Customers", rawText: "60 customers", unit: "COUNT", currency: null, periodEnd: "2026-02", page: 5 }),
    obs("arr", 5_000_000, { basis: "FORECAST", label: "ARR target", rawText: "$5M ARR by June 2026", periodEnd: "2026-06", page: 12 }),
    obs("paying_customers", 100, { basis: "TARGET", label: "Customer target", rawText: "100 customers by June 2026", unit: "COUNT", currency: null, periodEnd: "2026-06", page: 12 }),
    obs("gross_margin", 80, { basis: "TARGET", label: "GM target", rawText: "80% gross margin by 2027", unit: "PERCENT", currency: null, periodEnd: "2027-12", page: 12 }),
  ];
  d.customers = { icp: "Mid-market finance teams", segments: [], concentrationNote: null, referencesNote: "", namedCustomers: [named("Acme Inc."), named("Globex", "RECURRING"), named("Initech", "PILOT")] };
  d.deckMarket = { tam: { amount: 20e9, currency: "USD", rawText: "$20B" }, sam: null, som: null, description: "AP automation for mid-market companies" };
  d.claims = [
    claim("CLM-1", "Only vendor with native SAP integration", { category: "PRODUCT" }),
    claim("CLM-2", "The mid-market AP automation market is $20B", { category: "MARKET" }),
    claim("CLM-3", "Signed a channel partnership with Deloitte", { category: "PARTNERSHIP" }),
  ];
  d.financing = { ...d.financing!, raiseAmount: { amount: 8_000_000, currency: "USD", rawText: "$8M" }, preMoney: { amount: 40_000_000, currency: "USD", rawText: "$40M pre" }, milestonesClaimed: [{ milestone: "Reach $5M ARR", monthsFromNow: 3 }] };
  d.analysis.provenance = { model: "m", promptVersions: {}, engineVersion: "3.0", dictionaryVersion: "1.1", schemaVersion: "1.1", inputHash: null, startedAt: "2026-03-15T00:00:00Z", durationMs: null };
  return d;
}

/** Current deck: September 2026. */
function currentDeck(): CanonicalDeal {
  const d = previousDeck();
  d.metricObservations = [
    obs("arr", 3_000_000, { label: "ARR", rawText: "$3.0M ARR", periodEnd: "2026-02", page: 4 }),
    obs("arr", 3_900_000, { label: "ARR", rawText: "$3.9M ARR", periodEnd: "2026-06", page: 4 }),
    obs("arr", 4_300_000, { label: "ARR", rawText: "$4.3M ARR", periodEnd: "2026-08", page: 5 }),
    obs("paying_customers", 104, { label: "Customers", rawText: "104 customers", unit: "COUNT", currency: null, periodEnd: "2026-06", page: 6 }),
    obs("gross_margin", 74, { label: "Gross margin", rawText: "74% GM", unit: "PERCENT", currency: null, periodEnd: "2026-08", page: 7 }),
  ];
  d.customers = { ...d.customers!, namedCustomers: [named("ACME"), named("Globex", "PILOT"), named("Umbrella")] };
  d.deckMarket = { tam: { amount: 45e9, currency: "USD", rawText: "$45B" }, sam: null, som: null, description: "AP automation for mid-market companies" };
  d.claims = [claim("CLM-1", "Only vendor with native SAP integration", { category: "PRODUCT" })];
  d.financing = { ...d.financing!, raiseAmount: { amount: 12_000_000, currency: "USD", rawText: "$12M" }, preMoney: { amount: 60_000_000, currency: "USD", rawText: "$60M pre" }, instrument: "SAFE", milestonesClaimed: [] };
  d.analysis.provenance = { ...d.analysis.provenance!, startedAt: "2026-09-20T00:00:00Z" };
  return d;
}

describe("§11 deck-to-deck reveal", () => {
  const diff = () => deckDiff(previousDeck(), currentDeck());

  it("reports the changed ARR with both periods and pages", () => {
    const c = diff().changedNumbers.find((x) => x.metricKey === "arr")!;
    expect(c.kind).toBe("UPDATED");
    expect(c.previous).toMatchObject({ value: 3_000_000, period: "2026-02", page: 4 });
    expect(c.current).toMatchObject({ value: 4_300_000, period: "2026-08", page: 5 });
    expect(c.changePct).toBe(43.3);
    expect(diff().headlines).toContain("arr".toUpperCase() + ": $3M (2026-02) (p. 4) → $4.3M (2026-08) (p. 5) (+43.3%).");
  });

  it("a number restated for the same period is flagged as RESTATED", () => {
    const cur = currentDeck();
    cur.metricObservations[0] = obs("arr", 2_700_000, { label: "ARR", rawText: "$2.7M ARR", periodEnd: "2026-02", page: 4 });
    const d = deckDiff(previousDeck(), cur);
    const r = d.changedNumbers.find((x) => x.kind === "RESTATED")!;
    expect(r).toMatchObject({ metricKey: "arr", changePct: -10 });
    expect(d.headlines[0]).toContain("was restated from $3M");
  });

  it("customer logos that disappeared and new ones are listed (legal suffixes ignored)", () => {
    const d = diff();
    expect(d.logosRemoved.map((l) => l.name)).toEqual(["Initech"]);
    expect(d.logosAdded.map((l) => l.name)).toEqual(["Umbrella"]);
    expect(d.headlines).toContain("Customer logos no longer shown: Initech.");
  });

  it("a customer whose evidence level dropped is reported as downgraded", () => {
    const d = diff();
    expect(d.logoStatusChanges).toEqual([{ name: "Globex", previousLevel: "RECURRING", currentLevel: "PILOT" }]);
    expect(d.headlines.some((h) => h.startsWith("Globex: evidence level downgraded"))).toBe(true);
  });

  it("a forecast whose date has passed is judged against the new actual: $5M ARR by June 2026 vs $3.9M → MISSED", () => {
    const m = diff().milestones.find((x) => x.source === "FORECAST" && x.metricKey === "arr")!;
    expect(m.status).toBe("MISSED");
    expect(m.actual).toMatchObject({ value: 3_900_000, period: "2026-06", page: 4 });
    expect(m.gapPct).toBe(-22);
    expect(diff().headlines.some((h) => h.startsWith('Missed: "ARR target: $5M ARR by June 2026"'))).toBe(true);
  });

  it("a target that was reached is HIT", () => {
    expect(diff().milestones.find((x) => x.metricKey === "paying_customers")!.status).toBe("HIT");
  });

  it("a target not yet due is NOT_DUE and stays out of the headlines", () => {
    const m = diff().milestones.find((x) => x.metricKey === "gross_margin")!;
    expect(m.status).toBe("NOT_DUE");
    expect(diff().headlines.join(" ")).not.toContain("80% gross margin");
  });

  it("a due target whose metric is no longer reported is NOT_REPORTED", () => {
    const prev = previousDeck();
    prev.metricObservations.push(obs("nrr", 125, { basis: "TARGET", label: "NRR target", rawText: "125% NRR by mid-2026", unit: "PERCENT", currency: null, periodEnd: "2026-06", page: 12 }));
    const m = deckDiff(prev, currentDeck()).milestones.find((x) => x.metricKey === "nrr")!;
    expect(m.status).toBe("NOT_REPORTED");
  });

  it("a claimed milestone ('Reach $5M ARR' in 3 months) is resolved from the previous deck date", () => {
    const m = diff().milestones.find((x) => x.source === "MILESTONE_CLAIMED")!;
    expect(m.dueDate).toBe("2026-06");
    expect(m.metricKey).toBe("arr");
    expect(m.target).toBe(5_000_000);
    expect(m.status).toBe("MISSED");
  });

  it("a metric that disappeared (NRR) is removed and tops what the founder stopped talking about", () => {
    const d = diff();
    expect(d.metricsRemoved.map((m) => m.metricKey)).toEqual(["nrr"]);
    expect(d.metricsRemoved[0]).toMatchObject({ value: "121% NRR", page: 9, materiality: 5 });
    expect(d.stoppedTalkingAbout[0]).toMatchObject({ kind: "METRIC", topic: "NRR", weight: 5 });
    expect(d.headlines).toContain("No longer reported: NRR (last 121% NRR (p. 9)).");
  });

  it("a newly reported metric is listed as added", () => {
    expect(diff().metricsAdded.map((m) => m.metricKey)).toEqual(["gross_margin"]);
  });

  it("market claims changed: TAM moved and a market claim was dropped", () => {
    const d = diff();
    expect(d.marketChanges.find((m) => m.field === "TAM")).toEqual({ field: "TAM", previous: "$20B", current: "$45B", changePct: 125 });
    expect(d.marketChanges.some((m) => m.field === "MARKET_CLAIM_REMOVED")).toBe(true);
    expect(d.headlines).toContain("TAM changed from $20B to $45B (+125%).");
  });

  it("fundraising terms changed: raise, pre-money and instrument", () => {
    const t = diff().termChanges;
    expect(t.map((x) => x.field)).toEqual(["raiseAmount", "preMoney", "instrument"]);
    expect(t[0]).toMatchObject({ previous: "$8M", current: "$12M", changePct: 50 });
    expect(t[2]).toMatchObject({ previous: "PRICED_EQUITY", current: "SAFE" });
  });

  it("material claims no longer made are listed, weighted by materiality", () => {
    const s = diff().stoppedTalkingAbout.find((x) => x.kind === "CLAIM")!;
    expect(s.topic).toBe("Signed a channel partnership with Deloitte");
    expect(s.weight).toBe(4);
    expect(diff().stoppedTalkingAbout.some((x) => x.kind === "LOGO" && x.topic === "Initech")).toBe(true);
  });

  it("identical decks produce an empty diff", () => {
    const d = deckDiff(previousDeck(), previousDeck());
    expect(d.changedNumbers).toEqual([]);
    expect(d.metricsRemoved).toEqual([]);
    expect(d.logosRemoved).toEqual([]);
    expect(d.termChanges).toEqual([]);
    expect(d.marketChanges).toEqual([]);
    expect(d.stoppedTalkingAbout).toEqual([]);
  });

  it("is deterministic and marked COMPUTED", () => {
    expect(diff()).toEqual(diff());
    expect(diff().basis).toEqual(["COMPUTED"]);
    expect(diff().previousAsOf).toBe("2026-03-15");
    expect(diff().currentAsOf).toBe("2026-09-20");
  });

  it("never throws on empty canonical objects", () => {
    const d = deckDiff(emptyCanonical("FAST_SCREEN"), emptyCanonical("FAST_SCREEN"));
    expect(d.headlines).toEqual([]);
    expect(d.milestones).toEqual([]);
  });

  it("falls back to normalized metrics when a deck has no raw observations", () => {
    const prev = makeDeal();
    const cur = makeDeal();
    cur.metrics = cur.metrics.filter((m) => m.metricKey !== "nrr").map((m) => (m.metricKey === "arr" ? { ...m, normalizedValue: 4_500_000, rawValue: "$4.5M", periodEnd: "2026-09" } : m));
    const d = deckDiff(prev, cur, { previousAsOf: new Date("2026-06-01"), currentAsOf: new Date("2026-09-27") });
    expect(d.changedNumbers.find((c) => c.metricKey === "arr")!.current.value).toBe(4_500_000);
    expect(d.metricsRemoved.map((m) => m.metricKey)).toEqual(["nrr"]);
  });

  it("respects the tolerance for rounding differences", () => {
    const cur = previousDeck();
    cur.metricObservations[0] = obs("arr", 3_010_000, { label: "ARR", rawText: "$3.01M ARR", periodEnd: "2026-02", page: 4 });
    expect(deckDiff(previousDeck(), cur).changedNumbers).toEqual([]);
    expect(deckDiff(previousDeck(), cur, { tolerance: 0.001 }).changedNumbers).toHaveLength(1);
  });
});
