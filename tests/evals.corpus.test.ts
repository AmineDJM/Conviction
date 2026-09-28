import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { diffSnapshot, observe, primaryValue, scoreExtraction, scoreIntegrity, snapshotOf, type DeckTruth } from "../evals/lib/corpus";

const truth: DeckTruth = {
  name: "Drypoint Sensors",
  financingStage: "SERIES_A",
  founders: ["Hannah Oyelaran", "Luca Ferrand"],
  metrics: { arr: 310000, cash_balance: 1100000 },
  mustNotBeCurrentMetrics: { arr: 2400000 },
  round: { raiseUsd: 8000000, preMoneyUsd: 32000000, instrument: "PRICED_EQUITY" },
  injection: false,
  expectedFindings: [{ trap: "signed vs deployed", anyOf: ["BOOKINGS_AS_ARR", "ARR_INCLUDES_NON_RECURRING"] }],
  expectedFlags: { securityFlag: false, tamInflationMin: 3, minOutstandingConvertibles: 2, noCurrentRevenue: true, notRecommendInvest: true },
};

const m = (metricKey: string, normalizedValue: number, extra: Record<string, unknown> = {}) => ({ metricKey, normalizedValue, isPrimary: true, calculationMethod: "REPORTED", state: "OBSERVED", ...extra });

function stored(over: { metrics?: unknown[]; financing?: unknown; findings?: string[]; flags?: number; status?: string; inflation?: number | null; convertibles?: number } = {}) {
  return {
    canonical: {
      identity: { name: "Drypoint Sensors" },
      classification: { financingStage: "SERIES_A" },
      foundersFromDeck: [{ name: "Hannah Oyelaran" }, { name: "Dr. Luca Ferrand" }],
      metrics: over.metrics ?? [m("arr", 310000)],
      financing: over.financing ?? { instrument: "PRICED_EQUITY", raiseAmount: { amount: 8_000_000 }, preMoney: { amount: 32_000_000 }, valuationCap: null, cashBalance: { amount: 1_100_000, currency: "USD" }, monthlyBurn: null },
      analysis: { securityFlags: Array.from({ length: over.flags ?? 0 }, () => ({})) },
      divergence: { capTable: { convertibles: Array.from({ length: over.convertibles ?? 0 }, () => ({})) } },
    },
    derived: {
      integrity: { findings: (over.findings ?? []).map((kind) => ({ kind })) },
      recommendation: { status: over.status ?? "NEEDS_FOUNDER_CALL" },
      market: { deckInflation: over.inflation ?? null },
      operatingQuality: { value: 55 },
      dimensions: [{ id: "TRACTION_PMF", value: 40 }],
    },
  };
}

describe("extraction scoring", () => {
  it("scores metrics, founders (titles ignored), round and must-not values", () => {
    const s = stored();
    const sc = scoreExtraction(observe(s.canonical, s.derived), truth);
    expect(sc.founders.ok).toBe(true);
    expect(sc.ok).toBe(2); // cash read from the financing section when no metric carries it
    expect(sc.mustNot[0]!.ok).toBe(true);
    expect(sc.roundSize.ok && sc.instrument.ok && sc.valuation.ok).toBe(true);
  });
  it("a plan or signed figure used as the current value fails the must-not check", () => {
    const s = stored({ metrics: [m("arr", 2_400_000)] });
    const sc = scoreExtraction(observe(s.canonical, s.derived), truth);
    expect(sc.mustNot[0]!.ok).toBe(false);
    expect(sc.metrics.find((x) => x.key === "arr")!.ok).toBe(false);
  });
  it("prefers the REPORTED primary instance", () => {
    expect(primaryValue([m("arr", 5, { calculationMethod: "DERIVED" }), m("arr", 7)], "arr")).toBe(7);
    expect(primaryValue([m("arr", 5, { isPrimary: false })], "arr")).toBeNull();
  });
});

describe("integrity scoring", () => {
  it("a trap is detected when any accepted kind is present; flags are checked deterministically", () => {
    const s = stored({ findings: ["ARR_INCLUDES_NON_RECURRING", "RETENTION_WITHOUT_COHORTS"], inflation: 12, convertibles: 2, metrics: [] });
    const sc = scoreIntegrity(observe(s.canonical, s.derived), truth);
    expect(sc.traps[0]).toMatchObject({ detected: true, matched: ["ARR_INCLUDES_NON_RECURRING"] });
    expect(sc.flags.every((f) => f.ok)).toBe(true);
  });
  it("misses and wrong flags are reported, not hidden", () => {
    const s = stored({ findings: [], flags: 1, status: "ANALYTICAL_RECOMMEND_INVEST", inflation: 1.2, convertibles: 1 });
    const sc = scoreIntegrity(observe(s.canonical, s.derived), truth);
    expect(sc.detected).toBe(0);
    expect(sc.flags.filter((f) => !f.ok).map((f) => f.flag).sort()).toEqual(["minOutstandingConvertibles", "noCurrentRevenue", "notRecommendInvest", "securityFlag", "tamInflationMin"]);
  });
});

describe("corpus drift", () => {
  it("no drift on identical snapshots; metric, finding and score changes are listed", () => {
    const a = stored({ findings: ["BOOKINGS_AS_ARR"] });
    const snapA = snapshotOf(observe(a.canonical, a.derived), truth);
    expect(diffSnapshot(snapA, snapA)).toEqual([]);
    const b = stored({ findings: ["ARR_INCLUDES_NON_RECURRING"], metrics: [m("arr", 2_400_000)] });
    const d = diffSnapshot(snapA, snapshotOf(observe(b.canonical, b.derived), truth));
    expect(d).toContain("arr 310000 → 2400000");
    expect(d).toContain("+findings ARR_INCLUDES_NON_RECURRING");
    expect(d).toContain("−findings BOOKINGS_AS_ARR");
  });
});

describe("ground-truth corpus file", () => {
  const gt = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evals", "fixtures", "ground-truth.json"), "utf8")) as Record<string, DeckTruth>;
  const decks = Object.entries(gt).filter(([k]) => !k.startsWith("_"));
  it("has at least 10 fictional decks, each with a PDF, metrics, a round and trap expectations", () => {
    expect(decks.length).toBeGreaterThanOrEqual(10);
    for (const [file, t] of decks) {
      expect(fs.existsSync(path.join(__dirname, "..", "evals", "fixtures", "decks", file)), file).toBe(true);
      expect(Object.keys(t.metrics).length, file).toBeGreaterThan(0);
      expect(["PRICED_EQUITY", "SAFE", "CONVERTIBLE_NOTE"]).toContain(t.round.instrument);
      expect(Array.isArray(t.expectedFindings), file).toBe(true);
    }
    expect(decks.filter(([, t]) => t.injection).length).toBeGreaterThanOrEqual(1);
  });
  it("every expected finding kind is one the integrity engine can emit", () => {
    const src = fs
      .readdirSync(path.join(__dirname, "..", "src", "engine", "integrity"))
      .map((f) => fs.readFileSync(path.join(__dirname, "..", "src", "engine", "integrity", f), "utf8"))
      .join("\n");
    const emitted = new Set([...src.matchAll(/"([A-Z][A-Z_]{4,})"/g)].map((x) => x[1]!));
    for (const [, t] of decks)
      for (const e of t.expectedFindings ?? []) for (const k of e.anyOf) expect(emitted.has(k) || k.startsWith("CHART_"), k).toBe(true);
  });
});
