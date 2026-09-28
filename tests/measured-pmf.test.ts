import { describe, expect, it } from "vitest";
import { expectedPmfSignals, measuredPmf, PMF_SIGNAL_KEYS, pmfRank } from "@/engine/scoring/measured-pmf";
import type { RubricRating } from "@/domain/enums";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { makeDeal, metric, rubric } from "./fixtures";

const reg = getRegistry();
const peer = (d: ReturnType<typeof makeDeal>) => resolvePeerGroup(d.classification);
const traction = (d: ReturnType<typeof makeDeal>) => derive(d, reg, DEFAULT_FUND_PROFILE, { now: new Date("2026-09-01") }).dimensions.find((x) => x.id === "TRACTION_PMF")!;

describe("PMF quality anchored on measured signals", () => {
  it("identical metrics → identical PMF rating whatever the model said (the stability failure)", () => {
    const a = makeDeal();
    const b = makeDeal();
    a.metrics.push(metric("grr", 92, { unit: "PERCENT", sampleSize: 45 }));
    b.metrics.push(metric("grr", 92, { unit: "PERCENT", sampleSize: 45 }));
    a.rubric = a.rubric.map((r) => (r.criterion === "PMF_SIGNAL_QUALITY" ? rubric("PMF_SIGNAL_QUALITY", "ADEQUATE") : r));
    b.rubric = b.rubric.map((r) => (r.criterion === "PMF_SIGNAL_QUALITY" ? rubric("PMF_SIGNAL_QUALITY", "BELOW_BAR") : r));
    expect(traction(a).value).toBe(traction(b).value);
  });

  it("uses the measured signals and keeps the model's view in the rationale", () => {
    const d = makeDeal();
    d.metrics.push(metric("grr", 92, { unit: "PERCENT", sampleSize: 45 }));
    d.metrics.push(metric("logo_retention", 90, { unit: "PERCENT", sampleSize: 45 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "WEAK");
    expect(r.mode).toBe("MEASURED");
    expect(r.signals.length).toBeGreaterThanOrEqual(2);
    expect(r.explanation).toContain("model judged WEAK");
  });

  it("one signal of several expected does not rate PMF — a thin set is never rated above what a weak companion would allow", () => {
    const d = makeDeal();
    d.metrics = d.metrics.filter((m) => m.metricKey !== "nrr");
    d.metrics.push(metric("grr", 95, { unit: "PERCENT", sampleSize: 60 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "STRONG");
    expect(r.mode).toBe("UNMEASURED");
    expect(r.effectiveRating).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.explanation).toMatch(/Only 1 of 3 expected/);
    expect(r.explanation).toContain("STRONG");
  });

  it("a single-signal peer group clamps the model to [signal − 1, signal] — never above what was measured", () => {
    // Registry where only GRR is benchmarked for the peer group: one expected signal.
    const one = { ...reg, benchmarks: reg.benchmarks.filter((b) => !["nrr", "logo_retention", "pilot_to_production_rate", "d30_retention", "repeat_rate"].includes(b.metricKey)) };
    const d = makeDeal();
    d.metrics = d.metrics.filter((m) => m.metricKey !== "nrr");
    d.metrics.push(metric("grr", 95, { unit: "PERCENT", sampleSize: 60 })); // STRONG
    const p = peer(d);
    expect(expectedPmfSignals(one, p.profile, p.stageBand)).toEqual(["grr"]);
    const at = (model: RubricRating | null) => measuredPmf(d, one, p.profile, p.stageBand, model);
    expect(at("EXCEPTIONAL")).toMatchObject({ mode: "CLAMPED", effectiveRating: "STRONG" });
    expect(at("STRONG")).toMatchObject({ mode: "CLAMPED", effectiveRating: "STRONG" });
    expect(at("BELOW_BAR")).toMatchObject({ mode: "CLAMPED", effectiveRating: "ADEQUATE" });
    expect(at("WEAK").effectiveRating).toBe("ADEQUATE");
    expect(at(null)).toMatchObject({ mode: "MEASURED", effectiveRating: "STRONG" });
  });

  it("no measured signal → insufficient evidence, the model's view kept in the explanation", () => {
    const d = makeDeal();
    d.metrics = d.metrics.filter((m) => m.metricKey !== "nrr");
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "STRONG");
    expect(r.mode).toBe("UNMEASURED");
    expect(r.effectiveRating).toBe("INSUFFICIENT_EVIDENCE");
    expect(r.explanation).toContain("STRONG");
  });

  it("hiding a weak retention metric never improves PMF", () => {
    const weak = makeDeal();
    weak.metrics = weak.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 70 } : m));
    const hidden = makeDeal();
    hidden.metrics = hidden.metrics.filter((m) => m.metricKey !== "nrr");
    expect(traction(hidden).lower).toBeLessThanOrEqual(traction(weak).lower);
  });

  it("a small sample never rates above ADEQUATE and metrics alone never reach EXCEPTIONAL", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 180, sampleSize: 4, qualityFlags: ["SMALL_SAMPLE: n=4 < 10"] } : m));
    d.metrics.push(metric("grr", 99, { unit: "PERCENT", sampleSize: 4, qualityFlags: ["SMALL_SAMPLE: n=4 < 10"] }));
    d.metrics.push(metric("logo_retention", 99, { unit: "PERCENT", sampleSize: null, qualityFlags: ["SAMPLE_SIZE_UNKNOWN (min 20)"] }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "EXCEPTIONAL");
    expect(r.effectiveRating).toBe("ADEQUATE");
  });

  it("is conservative with an even number of signals (lower median)", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 140, sampleSize: 60 } : m));
    d.metrics.push(metric("grr", 60, { unit: "PERCENT", sampleSize: 60 }));
    d.metrics.push(metric("logo_retention", 95, { unit: "PERCENT", sampleSize: 60 }));
    d.metrics.push(metric("pilot_to_production_rate", 30, { unit: "PERCENT", sampleSize: 60 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, null);
    // NRR 140 and logo 95 STRONG, GRR 60 weak: the middle of the three expected signals.
    // Series A (GROWTH band): pilot conversion is an early-stage signal the registry does not score here, so 3 are expected.
    const sorted = r.signals.map((s) => pmfRank(s.rating)).sort((a, b) => a - b);
    expect(r.signals.map((s) => s.key).sort()).toEqual(["grr", "logo_retention", "nrr"]);
    expect(pmfRank(r.effectiveRating)).toBe(sorted[1]);
  });

  it("an undated signal counts no more than a stale one (both are not current evidence)", () => {
    const base = () => {
      const d = makeDeal();
      d.metrics.push(metric("grr", 95, { unit: "PERCENT", sampleSize: 60 }), metric("logo_retention", 95, { unit: "PERCENT", sampleSize: 60 }));
      return d;
    };
    const stale = base();
    stale.metrics = stale.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, state: "STALE" as const, qualityFlags: ["STALE: 15 months old (max 6)"] } : m));
    const undated = base();
    undated.metrics = undated.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, periodEnd: null, qualityFlags: ["NO_AS_OF_DATE"] } : m));
    const p = peer(stale);
    const rs = measuredPmf(stale, reg, p.profile, p.stageBand, "STRONG");
    const ru = measuredPmf(undated, reg, p.profile, p.stageBand, "STRONG");
    expect(pmfRank(ru.effectiveRating)).toBeLessThanOrEqual(pmfRank(rs.effectiveRating));
    expect(traction(undated).lower).toBeLessThanOrEqual(traction(stale).lower);
  });

  it("PROPERTY: removing any signal never raises the rating (every subset of the 6 PMF signals, several value grids and model views)", () => {
    const keys = PMF_SIGNAL_KEYS;
    // Per-grid values chosen to land on every rating band of the curves (and some small samples).
    const grids: Record<string, [number, number | null][]> = {
      nrr: [[70, 60], [100, 60], [118, 60], [140, 60], [160, 5]],
      grr: [[65, 60], [80, 60], [90, 60], [98, 60], [99, null]],
      logo_retention: [[55, 60], [75, 60], [88, 60], [95, 60], [96, 3]],
      pilot_to_production_rate: [[10, 60], [40, 60], [60, 60], [85, 60], [90, null]],
      d30_retention: [[5, 60], [20, 60], [40, 60], [60, 60], [70, 2]],
      repeat_rate: [[10, 60], [30, 60], [50, 60], [70, 60], [80, null]],
    };
    const classifications = [makeDeal().classification, { ...makeDeal().classification, industry: ["CONSUMER" as const], productType: ["MARKETPLACE" as const], revenueModel: ["TRANSACTION_FEE" as const], gtm: ["B2C" as const] }];
    let checked = 0;
    for (const cls of classifications) {
      const p = resolvePeerGroup(cls as never);
      for (let g = 0; g < 5; g++) {
        // Rotate grid indices per key so a set mixes strong and weak signals.
        const vals = Object.fromEntries(keys.map((k, i) => [k, grids[k]![(g + i) % 5]!]));
        const deal = (mask: number) => {
          const d = makeDeal();
          d.classification = cls as never;
          d.metrics = d.metrics.filter((m) => !(keys as readonly string[]).includes(m.metricKey));
          keys.forEach((k, i) => {
            if (!(mask & (1 << i))) return;
            const [v, n] = vals[k]!;
            d.metrics.push(metric(k, v, { unit: "PERCENT", sampleSize: n, qualityFlags: n === null ? ["SAMPLE_SIZE_UNKNOWN (min 20)"] : n < 10 ? [`SMALL_SAMPLE: n=${n} < 10`] : [] }));
          });
          return d;
        };
        for (const model of [null, "WEAK", "ADEQUATE", "EXCEPTIONAL"] as const) {
          const rating = new Map<number, number>();
          for (let mask = 0; mask < 1 << keys.length; mask++) rating.set(mask, pmfRank(measuredPmf(deal(mask), reg, p.profile, p.stageBand, model).effectiveRating));
          for (let mask = 0; mask < 1 << keys.length; mask++)
            for (let i = 0; i < keys.length; i++)
              if (mask & (1 << i)) {
                checked++;
                const without = rating.get(mask & ~(1 << i))!;
                if (without > rating.get(mask)!) throw new Error(`removing ${keys[i]} raised the rating (${[...keys].filter((_, j) => mask & (1 << j)).join(",")}; model ${model}; grid ${g})`);
              }
        }
      }
    }
    expect(checked).toBeGreaterThan(5000);
  });
});

describe("expected PMF signals follow the registry's stage and maturity rules (just as demanding as the scoring)", () => {
  it("a seed company at early revenue is expected to show pilot conversion, not retention it cannot have yet", () => {
    expect(expectedPmfSignals(reg, "ENTERPRISE_SAAS" as never, "EARLY", "EARLY_REVENUE")).toEqual(["pilot_to_production_rate"]);
    expect(expectedPmfSignals(reg, "ENTERPRISE_SAAS" as never, "EARLY", "PMF_EMERGING").sort()).toEqual(["grr", "logo_retention", "nrr", "pilot_to_production_rate"]);
    expect(expectedPmfSignals(reg, "ENTERPRISE_SAAS" as never, "GROWTH", "PMF_EMERGING").sort()).toEqual(["grr", "logo_retention", "nrr"]);
  });

  it("an early-revenue seed deal with a measured pilot conversion is rated from it (the model clamped to it)", () => {
    const d = makeDeal();
    d.classification = { ...d.classification, financingStage: "SEED", operationalMaturity: "EARLY_REVENUE" };
    d.metrics = d.metrics.filter((m) => !["nrr", "grr", "logo_retention"].includes(m.metricKey));
    d.metrics.push(metric("pilot_to_production_rate", 80, { unit: "PERCENT", sampleSize: 20 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "EXCEPTIONAL");
    expect(r.mode).toBe("CLAMPED");
    expect(pmfRank(r.effectiveRating)).toBeLessThanOrEqual(pmfRank(r.measuredRating));
  });

  it("the same seed deal without pilot conversion is not rated (nothing measured)", () => {
    const d = makeDeal();
    d.classification = { ...d.classification, financingStage: "SEED", operationalMaturity: "EARLY_REVENUE" };
    d.metrics = d.metrics.filter((m) => !["nrr", "grr", "logo_retention", "pilot_to_production_rate"].includes(m.metricKey));
    const p = peer(d);
    expect(measuredPmf(d, reg, p.profile, p.stageBand, "STRONG").effectiveRating).toBe("INSUFFICIENT_EVIDENCE");
  });
});
