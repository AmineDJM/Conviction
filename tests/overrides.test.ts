import { describe, expect, it } from "vitest";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { CanonicalDeal } from "@/domain/canonical";
import { getRegistry } from "@/engine/benchmarks";
import { derive } from "@/engine/derive";
import { deriveMetrics } from "@/engine/metrics/derive";
import {
  OVERRIDE_PROPAGATED_STEP,
  OVERRIDE_STEP,
  addOverride,
  applyOverrides,
  isOverridden,
  removeOverride,
  resolveOverrides,
  validateOverride,
} from "@/engine/overrides";
import { makeDeal, metric } from "./fixtures";

const reg = getRegistry();
const AT = "2026-09-20T10:00:00.000Z";

function baseDeal() {
  const d = makeDeal();
  // Explicit ids; ARR / customers feed a derived ACV (ARR / paying customers).
  d.metrics = deriveMetrics(
    [
      metric("arr", 3_840_000, { id: "MET-001", rawValue: "$3.84M ARR", lineage: [{ step: "EXTRACTED", detail: '"$3.84M ARR" on p. 3' }] }),
      metric("paying_customers", 92, { id: "MET-002", unit: "COUNT" }),
      metric("nrr", 118, { id: "MET-003", unit: "PERCENT", sampleSize: 45 }),
      metric("gross_margin", 76, { id: "MET-004", unit: "PERCENT" }),
      metric("burn_multiple", 1.4, { id: "MET-005", unit: "MULTIPLE" }),
    ],
    (() => {
      let n = 10;
      return () => `MET-0${n++}`;
    })(),
  );
  d.claims = [
    {
      id: "CLM-001",
      category: "METRIC",
      statement: "ARR reached $3.84M",
      valueText: "$3.84M",
      entity: "company",
      period: "2026-08",
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
      evidence: [],
      history: [],
    },
  ];
  return CanonicalDeal.parse(d);
}

function withNrrOverride(to = 92) {
  const raw = baseDeal();
  const v = validateOverride(raw, { target: "METRIC", ref: "MET-003", field: "normalizedValue", to });
  if (!v.ok) throw new Error(v.error);
  return addOverride(raw, { target: "METRIC", ref: "MET-003", field: "normalizedValue", from: v.from, to: v.value, reason: "Data room cohort file shows 92% NRR", by: "Analyst", at: AT });
}

describe("applyOverrides", () => {
  it("never mutates the raw extraction", () => {
    const { deal } = withNrrOverride();
    const snapshot = JSON.stringify(deal);
    const eff = applyOverrides(deal);
    expect(JSON.stringify(deal)).toBe(snapshot);
    expect(deal.metrics.find((m) => m.id === "MET-003")!.normalizedValue).toBe(118);
    expect(eff.metrics.find((m) => m.id === "MET-003")!.normalizedValue).toBe(92);
    // The company-reported raw text stays visible on the effective instance.
    expect(eff.metrics.find((m) => m.id === "MET-003")!.rawValue).toBe(deal.metrics.find((m) => m.id === "MET-003")!.rawValue);
  });

  it("returns the same object when there is nothing to apply", () => {
    const raw = baseDeal();
    expect(applyOverrides(raw)).toBe(raw);
  });

  it("records an OVERRIDE lineage step and flag, and is idempotent", () => {
    const { deal, override } = withNrrOverride();
    const eff = applyOverrides(deal);
    const m = eff.metrics.find((x) => x.id === "MET-003")!;
    const steps = m.lineage.filter((l) => l.step === OVERRIDE_STEP);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.detail).toContain(`[${override.id}]`);
    expect(steps[0]!.detail).toContain("118 → 92");
    expect(isOverridden(m)).toBe(true);
    expect(JSON.stringify(applyOverrides(eff))).toBe(JSON.stringify(eff));
  });

  it("revert restores the raw values exactly", () => {
    const { deal, override } = withNrrOverride();
    const { deal: reverted, removed } = removeOverride(deal, override.id);
    expect(removed?.id).toBe(override.id);
    expect(JSON.stringify(applyOverrides(reverted))).toBe(JSON.stringify(baseDeal()));
  });

  it("derive() scores the overridden value", () => {
    const raw = baseDeal();
    const { deal } = withNrrOverride(92);
    const now = new Date(AT);
    const before = derive(raw, reg, DEFAULT_FUND_PROFILE, { now });
    const after = derive(deal, reg, DEFAULT_FUND_PROFILE, { now });
    const nrrComponent = (d: typeof before) =>
      d.dimensions.flatMap((x) => x.components).find((c) => (c as { metricKey?: string }).metricKey === "nrr") as { value?: number | null; metricValue?: number | null } | undefined;
    // Same result as deriving the effective deal directly: overrides flow into every score.
    const direct = derive(applyOverrides(deal), reg, DEFAULT_FUND_PROFILE, { now });
    expect(JSON.stringify({ ...after, computedAt: 0 })).toBe(JSON.stringify({ ...direct, computedAt: 0 }));
    expect(JSON.stringify(after.dimensions)).not.toBe(JSON.stringify(before.dimensions));
    expect(nrrComponent(after)).toBeDefined();
  });

  it("recomputes derived metrics that depend on an overridden input and keeps their ids", () => {
    const raw = baseDeal();
    const acv = raw.metrics.find((m) => m.metricKey === "acv")!;
    expect(acv.calculationMethod).toBe("DERIVED");
    const v = validateOverride(raw, { target: "METRIC", ref: "MET-002", field: "normalizedValue", to: 64 });
    expect(v.ok).toBe(true);
    const { deal, override } = addOverride(raw, { target: "METRIC", ref: "MET-002", field: "normalizedValue", from: 92, to: 64, reason: "Signed contracts count", by: null, at: AT });
    const res = resolveOverrides(deal);
    const acv2 = res.deal.metrics.find((m) => m.metricKey === "acv")!;
    expect(acv2.id).toBe(acv.id);
    expect(acv2.normalizedValue).toBeCloseTo(3_840_000 / 64, 3);
    expect(acv2.lineage.some((l) => l.step === OVERRIDE_PROPAGATED_STEP && l.detail.includes(`[${override.id}]`))).toBe(true);
    expect(res.applied[0]!.propagatedTo).toContain(acv.id);
    expect(isOverridden(acv2)).toBe(false); // marked as propagated, not as an override itself
    // Idempotent pass reports the same propagation.
    expect(resolveOverrides(res.deal).applied[0]!.propagatedTo).toContain(acv.id);
  });

  it("refuses to override a derived metric, unknown refs and invalid values", () => {
    const raw = baseDeal();
    const acv = raw.metrics.find((m) => m.metricKey === "acv")!;
    expect(validateOverride(raw, { target: "METRIC", ref: acv.id, field: "normalizedValue", to: 1 }).ok).toBe(false);
    expect(validateOverride(raw, { target: "METRIC", ref: "MET-999", field: "normalizedValue", to: 1 }).ok).toBe(false);
    expect(validateOverride(raw, { target: "METRIC", ref: "MET-001", field: "rawValue", to: "x" }).ok).toBe(false);
    expect(validateOverride(raw, { target: "CLASSIFICATION", ref: "classification", field: "financingStage", to: "SERIES_Z" }).ok).toBe(false);
    expect(validateOverride(raw, { target: "CLAIM", ref: "CLM-001", field: "verification", to: "UNVERIFIED" }).ok).toBe(false); // equals current
  });

  it("applies classification, entity and claim overrides without touching raw data", () => {
    let deal = baseDeal();
    const cls = validateOverride(deal, { target: "CLASSIFICATION", ref: "classification", field: "financingStage", to: "SEED" });
    const ent = validateOverride(deal, { target: "ENTITY", ref: "identity", field: "hqCountry", to: "France" });
    const clm = validateOverride(deal, { target: "CLAIM", ref: "CLM-001", field: "verification", to: "VERIFIED" });
    expect(cls.ok && ent.ok && clm.ok).toBe(true);
    deal = addOverride(deal, { target: "CLASSIFICATION", ref: "classification", field: "financingStage", from: "SERIES_A", to: "SEED", reason: "Round is a seed extension", by: "A", at: AT }).deal;
    deal = addOverride(deal, { target: "ENTITY", ref: "identity", field: "hqCountry", from: "United States", to: "France", reason: "Registry filing", by: "A", at: AT }).deal;
    deal = addOverride(deal, { target: "CLAIM", ref: "CLM-001", field: "verification", from: "UNVERIFIED", to: "VERIFIED", reason: "Bank statements reviewed", by: "A", at: AT }).deal;
    const eff = applyOverrides(deal);
    expect(eff.classification.financingStage).toBe("SEED");
    expect(eff.identity.hqCountry).toBe("France");
    expect(eff.claims[0]!.verification).toBe("VERIFIED");
    expect(eff.claims[0]!.history.at(-1)!.change).toBe("CORRECTED");
    expect(deal.classification.financingStage).toBe("SERIES_A");
    expect(deal.claims[0]!.verification).toBe("UNVERIFIED");
    expect(deal.claims[0]!.history).toHaveLength(0);
    expect(derive(deal, reg, DEFAULT_FUND_PROFILE).peerGroup.stageBand).toBe(derive(eff, reg, DEFAULT_FUND_PROFILE).peerGroup.stageBand);
  });

  it("lists overrides whose target disappeared as stale instead of failing", () => {
    const { deal } = withNrrOverride();
    const next = { ...deal, metrics: deal.metrics.filter((m) => m.id !== "MET-003") };
    const res = resolveOverrides(next);
    expect(res.applied).toHaveLength(0);
    expect(res.stale).toHaveLength(1);
  });
});
