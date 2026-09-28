import { describe, expect, it } from "vitest";
import { measuredPmf } from "@/engine/scoring/measured-pmf";
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
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "WEAK");
    expect(r.mode).toBe("MEASURED");
    expect(r.signals.length).toBeGreaterThanOrEqual(2);
    expect(r.explanation).toContain("model judged WEAK");
  });

  it("one signal clamps the model to within one step", () => {
    const d = makeDeal();
    d.metrics = d.metrics.filter((m) => m.metricKey !== "nrr");
    d.metrics.push(metric("grr", 95, { unit: "PERCENT", sampleSize: 60 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "WEAK");
    expect(r.mode).toBe("CLAMPED");
    expect(r.effectiveRating).not.toBe("WEAK");
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
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, "EXCEPTIONAL");
    expect(r.effectiveRating).toBe("ADEQUATE");
  });

  it("is conservative with an even number of signals (lower median)", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "nrr" ? { ...m, normalizedValue: 140, sampleSize: 60 } : m));
    d.metrics.push(metric("grr", 60, { unit: "PERCENT", sampleSize: 60 }));
    const p = peer(d);
    const r = measuredPmf(d, reg, p.profile, p.stageBand, null);
    const worst = r.signals.map((s) => s.rating).sort()[0];
    expect(r.signals.map((s) => s.rating)).toContain(r.effectiveRating);
    expect(worst).toBeDefined();
  });
});
