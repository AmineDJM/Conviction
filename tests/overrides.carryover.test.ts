/**
 * Overrides survive re-analysis: ids change (MET-007 → MET-012), anchors do not.
 * Re-anchoring is deterministic, strict on periods, refuses ambiguity, and never
 * drops an override silently — an un-anchorable one is kept, reported and not applied.
 * Legacy USER_CORRECTED instances are upgraded to overrides with no data loss.
 */
import { describe, expect, it } from "vitest";
import { CanonicalDeal, type Claim, type MetricInstance } from "@/domain/canonical";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { getRegistry } from "@/engine/benchmarks";
import { derive } from "@/engine/derive";
import { deriveMetrics } from "@/engine/metrics/derive";
import { addOverride, applyOverrides, resolveOverrides, validateOverride, type Override } from "@/engine/overrides";
import { anchorFor, anchorHolds, findAnchorTarget, normStatement, stableHash } from "@/engine/override-anchors";
import { reanchorOverrides, upgradeLegacyCorrections, withCarriedOverrides } from "@/engine/override-carry";
import { makeDeal, metric } from "./fixtures";

const AT = "2026-09-20T10:00:00.000Z";
const reg = getRegistry();

function claim(id: string, statement: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    category: "METRIC",
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
    evidence: [],
    history: [],
    ...extra,
  };
}

const seq = (start: number) => {
  let n = start;
  return () => `MET-${String(n++).padStart(3, "0")}`;
};

/** First analysis: ARR is MET-001, customers MET-002, NRR MET-003 (derived ACV after). */
function v1(): CanonicalDeal {
  const d = makeDeal();
  d.metrics = deriveMetrics(
    [
      metric("arr", 3_840_000, { id: "MET-001", rawValue: "$3.84M ARR", periodEnd: "2026-06" }),
      metric("paying_customers", 92, { id: "MET-002", unit: "COUNT", periodEnd: "2026-06" }),
      metric("nrr", 118, { id: "MET-003", unit: "PERCENT", periodEnd: "2026-06" }),
    ],
    seq(10),
  );
  d.claims = [claim("CLM-001", "ARR reached $3.84M in June 2026"), claim("CLM-002", "Customers include three of the top ten US banks", { category: "CUSTOMER" })];
  return CanonicalDeal.parse(d);
}

/** Re-analysis of the same deck: same facts, different ids (MET-007 is now NRR, ARR is MET-012). */
function v2Renumbered(): CanonicalDeal {
  const d = makeDeal();
  d.metrics = deriveMetrics(
    [
      metric("nrr", 118, { id: "MET-001", unit: "PERCENT", periodEnd: "2026-06" }),
      metric("paying_customers", 92, { id: "MET-007", unit: "COUNT", periodEnd: "2026-06" }),
      metric("arr", 3_840_000, { id: "MET-012", rawValue: "$3.84M ARR", periodEnd: "2026-06" }),
    ],
    seq(20),
  );
  d.claims = [claim("CLM-001", "Customers include three of the top ten US banks.", { category: "CUSTOMER" }), claim("CLM-002", "ARR reached $3.84M in June 2026")];
  return CanonicalDeal.parse(d);
}

function withArrOverride(d: CanonicalDeal, to = 3_000_000) {
  const v = validateOverride(d, { target: "METRIC", ref: "MET-001", field: "normalizedValue", to });
  if (!v.ok) throw new Error(v.error);
  return addOverride(d, { target: "METRIC", ref: "MET-001", field: "normalizedValue", from: v.from, to: v.value, reason: "Data room: ARR excludes $840k of pilots", by: "Analyst", at: AT });
}

const eff = (d: CanonicalDeal, id: string) => applyOverrides(d).metrics.find((m) => m.id === id)!;

describe("anchors", () => {
  it("records key + period + basis for metrics, a statement hash for claims, a path for fields", () => {
    const d = v1();
    expect(anchorFor(d, { target: "METRIC", ref: "MET-001", field: "normalizedValue" })).toEqual({ kind: "METRIC", metricKey: "arr", label: "arr", periodEnd: "2026-06", periodType: "POINT_IN_TIME", basis: "CURRENT" });
    const c = anchorFor(d, { target: "CLAIM", ref: "CLM-002", field: "verification" });
    expect(c).toMatchObject({ kind: "CLAIM", category: "CUSTOMER", statementHash: stableHash(normStatement("Customers include three of the top ten US banks")) });
    expect(anchorFor(d, { target: "CLASSIFICATION", ref: "classification", field: "financingStage" })).toEqual({ kind: "FIELD", path: "classification.financingStage" });
    expect(anchorFor(d, { target: "METRIC", ref: "MET-999", field: "normalizedValue" })).toBeNull();
  });

  it("normalizes statements (case, punctuation, thousands separators, trailing dots)", () => {
    expect(normStatement("ARR reached $3,840,000.")).toBe(normStatement("arr reached $3840000"));
    expect(stableHash("a")).toBe(stableHash("a"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
    expect(stableHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("addOverride stores the anchor of its target", () => {
    const { override } = withArrOverride(v1());
    expect(override.anchor).toMatchObject({ kind: "METRIC", metricKey: "arr", periodEnd: "2026-06" });
    expect(override.carry).toBeNull();
  });

  it("an override whose id now designates another metric is not applied (guard)", () => {
    const { deal } = withArrOverride(v1());
    // Simulate the old carry-over bug: overrides copied verbatim onto a renumbered analysis.
    const naive = { ...v2Renumbered(), overrides: deal.overrides };
    const res = resolveOverrides(naive);
    expect(res.applied).toHaveLength(0);
    expect(res.stale[0]!.reason).toMatch(/no longer designates arr/);
    expect(applyOverrides(naive).metrics.find((m) => m.id === "MET-001")!.normalizedValue).toBe(118); // NRR untouched
    expect(anchorHolds(naive, "METRIC", "MET-001", deal.overrides[0]!.anchor!)).toBe(false);
  });
});

describe("re-anchoring on re-analysis", () => {
  it("moves a metric override to the new id of the same metric and period", () => {
    const { deal: prev } = withArrOverride(v1());
    const next = v2Renumbered();
    const { overrides, report } = reanchorOverrides({ overrides: prev.overrides, source: prev, fromVersionId: "ver_1" }, next, AT);
    expect(overrides).toHaveLength(1);
    expect(overrides[0]!.ref).toBe("MET-012");
    expect(overrides[0]!.id).toBe(prev.overrides[0]!.id);
    expect(overrides[0]!.carry).toMatchObject({ status: "REANCHORED", match: "EXACT", fromRef: "MET-001", fromVersionId: "ver_1" });
    expect(report[0]).toMatchObject({ status: "REANCHORED", fromRef: "MET-001", toRef: "MET-012" });
    const carried = { ...next, overrides };
    expect(eff(carried, "MET-012").normalizedValue).toBe(3_000_000);
    expect(eff(carried, "MET-001").normalizedValue).toBe(118); // the metric that now holds MET-001 is untouched
    // Derived metrics (ACV = ARR / customers) are recomputed from the overridden input.
    const acv = applyOverrides(carried).metrics.find((m) => m.metricKey === "acv");
    if (acv) expect(acv.normalizedValue).toBeCloseTo(3_000_000 / 92, 3);
    // Scores see the override exactly as before the re-analysis.
    const before = derive(prev, reg, DEFAULT_FUND_PROFILE, { now: new Date(AT) });
    const after = derive(carried, reg, DEFAULT_FUND_PROFILE, { now: new Date(AT) });
    expect(after.operatingQuality.value).toBe(before.operatingQuality.value);
  });

  it("does NOT move an override onto another period: reported as not re-applied, kept, never applied", () => {
    const { deal: prev } = withArrOverride(v1());
    const next = v2Renumbered();
    next.metrics = next.metrics.map((m) => (m.metricKey === "arr" ? { ...m, periodEnd: "2026-12", normalizedValue: 5_100_000 } : m));
    const { overrides, report } = reanchorOverrides({ overrides: prev.overrides, source: prev }, next, AT);
    expect(overrides).toHaveLength(1); // never dropped
    expect(overrides[0]!.carry!.status).toBe("UNANCHORED");
    expect(overrides[0]!.carry!.note).toMatch(/^not re-applied: target not found in the new analysis — the new analysis reports arr for 2026-12, not for 2026-06/);
    expect(report[0]!.toRef).toBeNull();
    const carried = { ...next, overrides };
    const res = resolveOverrides(carried);
    expect(res.applied).toHaveLength(0);
    expect(res.stale[0]!.reason).toMatch(/not re-applied/);
    expect(applyOverrides(carried).metrics.find((m) => m.metricKey === "arr")!.normalizedValue).toBe(5_100_000);
  });

  it("reports a missing metric, an ambiguous basis, and matches a unique other-basis instance", () => {
    const { deal: prev } = withArrOverride(v1());
    const gone = v2Renumbered();
    gone.metrics = gone.metrics.filter((m) => m.metricKey !== "arr" && m.calculationMethod !== "DERIVED");
    expect(reanchorOverrides({ overrides: prev.overrides, source: prev }, gone, AT).overrides[0]!.carry!.note).toMatch(/arr \(2026-06\) is not in the new analysis/);

    const oneLtm = v2Renumbered();
    oneLtm.metrics = oneLtm.metrics.map((m) => (m.metricKey === "arr" ? { ...m, basis: "LTM" } : m));
    const r1 = reanchorOverrides({ overrides: prev.overrides, source: prev }, oneLtm, AT).overrides[0]!;
    expect(r1.carry).toMatchObject({ status: "REANCHORED", match: "PERIOD" });
    expect(r1.carry!.note).toMatch(/basis differs/);

    const two = v2Renumbered();
    two.metrics = [...two.metrics.map((m) => (m.metricKey === "arr" ? { ...m, basis: "LTM" } : m)), metric("arr", 3_700_000, { id: "MET-030", periodEnd: "2026-06", basis: "ACTUAL", isPrimary: false })];
    expect(reanchorOverrides({ overrides: prev.overrides, source: prev }, two, AT).overrides[0]!.carry!.note).toMatch(/appears 2 times with other bases/);
  });

  it("matches OTHER metrics on their label, never across labels", () => {
    const d = makeDeal();
    d.metrics = [metric("OTHER", 12, { id: "MET-001", label: "Pilots converted", unit: "COUNT" }), metric("OTHER", 40, { id: "MET-002", label: "Waitlist (k)", unit: "COUNT" })];
    const { deal } = addOverride(CanonicalDeal.parse(d), { target: "METRIC", ref: "MET-001", field: "normalizedValue", from: 12, to: 9, reason: "Three pilots lapsed", by: null, at: AT });
    const next = makeDeal();
    next.metrics = [metric("OTHER", 40, { id: "MET-001", label: "Waitlist (k)", unit: "COUNT" }), metric("OTHER", 12, { id: "MET-002", label: "Pilots converted.", unit: "COUNT" })];
    const r = reanchorOverrides({ overrides: deal.overrides, source: deal }, CanonicalDeal.parse(next), AT).overrides[0]!;
    expect(r.ref).toBe("MET-002");
  });

  it("re-anchors claim overrides on the statement (exact, then similar), refusing ambiguity", () => {
    const prev = v1();
    const { deal } = addOverride(prev, { target: "CLAIM", ref: "CLM-002", field: "verification", from: "UNVERIFIED", to: "VERIFIED", reason: "Reference calls with two banks", by: "A", at: AT });
    const next = v2Renumbered();
    const exact = reanchorOverrides({ overrides: deal.overrides, source: deal }, next, AT).overrides[0]!;
    expect(exact).toMatchObject({ ref: "CLM-001", carry: { status: "REANCHORED", match: "STATEMENT" } });
    expect(applyOverrides({ ...next, overrides: [exact] }).claims.find((c) => c.id === "CLM-001")!.verification).toBe("VERIFIED");

    const reworded = structuredClone(next);
    reworded.claims[0]!.statement = "Customers include three of the top ten banks in the US";
    const similar = reanchorOverrides({ overrides: deal.overrides, source: deal }, reworded, AT).overrides[0]!;
    expect(similar.carry).toMatchObject({ status: "REANCHORED", match: "SIMILAR" });

    const ambiguous = structuredClone(reworded);
    ambiguous.claims.push(claim("CLM-003", "Customers include three of the top ten banks in the EU", { category: "CUSTOMER" }));
    expect(reanchorOverrides({ overrides: deal.overrides, source: deal }, ambiguous, AT).overrides[0]!.carry!.note).toMatch(/several claims/);

    const none = structuredClone(next);
    none.claims = [claim("CLM-001", "Gross margin is 76%")];
    expect(reanchorOverrides({ overrides: deal.overrides, source: deal }, none, AT).overrides[0]!.carry!.status).toBe("UNANCHORED");
  });

  it("re-applies classification and identity overrides by path and notes when the new analysis agrees", () => {
    let d = v1();
    d = addOverride(d, { target: "CLASSIFICATION", ref: "classification", field: "financingStage", from: "SERIES_A", to: "SEED", reason: "Seed extension", by: "A", at: AT }).deal;
    d = addOverride(d, { target: "ENTITY", ref: "identity", field: "hqCountry", from: "United States", to: "France", reason: "Registry", by: "A", at: AT }).deal;
    const next = v2Renumbered();
    next.identity.hqCountry = "France";
    const { overrides } = reanchorOverrides({ overrides: d.overrides, source: d }, next, AT);
    expect(overrides.map((o) => o.carry!.match)).toEqual(["FIELD", "FIELD"]);
    expect(overrides[1]!.carry!.note).toMatch(/now reports the overridden value/);
    expect(applyOverrides({ ...next, overrides }).classification.financingStage).toBe("SEED");
  });

  it("flags a restated source value on a re-applied override", () => {
    const { deal: prev } = withArrOverride(v1());
    const next = v2Renumbered();
    next.metrics = next.metrics.map((m) => (m.metricKey === "arr" ? { ...m, normalizedValue: 3_600_000, rawValue: "$3.6M" } : m));
    const o = reanchorOverrides({ overrides: prev.overrides, source: prev }, next, AT).overrides[0]!;
    expect(o.carry!.status).toBe("REANCHORED");
    expect(o.carry!.note).toMatch(/the source changed: the new analysis reports 3600000 \(was 3840000 when overridden\)/);
  });

  it("anchors legacy overrides (stored before anchors) from the analysis they were made on, and refuses without it", () => {
    const { deal: prev } = withArrOverride(v1());
    const legacy: Override[] = prev.overrides.map((o) => ({ ...o, anchor: null }));
    const next = v2Renumbered();
    expect(reanchorOverrides({ overrides: legacy, source: prev }, next, AT).overrides[0]!.ref).toBe("MET-012");
    const blind = reanchorOverrides({ overrides: legacy, source: null }, next, AT).overrides[0]!;
    expect(blind.carry!.status).toBe("UNANCHORED");
    expect(resolveOverrides({ ...next, overrides: [blind] }).applied).toHaveLength(0); // never applied to whatever holds MET-001 now
  });

  it("an override not re-applied in v2 comes back in v3 when the target reappears", () => {
    const { deal: prev } = withArrOverride(v1());
    const v2 = v2Renumbered();
    v2.metrics = v2.metrics.filter((m) => m.metricKey !== "arr" && m.calculationMethod !== "DERIVED");
    const carried2 = { ...v2, overrides: reanchorOverrides({ overrides: prev.overrides, source: prev, fromVersionId: "v1" }, v2, AT).overrides };
    expect(carried2.overrides[0]!.carry!.status).toBe("UNANCHORED");
    const v3 = v2Renumbered();
    const carried3 = reanchorOverrides({ overrides: carried2.overrides, source: carried2, fromVersionId: "v2" }, v3, AT).overrides;
    expect(carried3[0]).toMatchObject({ ref: "MET-012", carry: { status: "REANCHORED", fromVersionId: "v2" } });
    expect(eff({ ...v3, overrides: carried3 }, "MET-012").normalizedValue).toBe(3_000_000);
  });

  it("is deterministic and pure; the pipeline's two passes (before / after extraction) converge", () => {
    const { deal: prev } = withArrOverride(v1());
    const next = v2Renumbered();
    const snapshot = JSON.stringify(prev);
    const a = reanchorOverrides({ overrides: prev.overrides, source: prev }, next, AT);
    const b = reanchorOverrides({ overrides: prev.overrides, source: prev }, next, AT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(prev)).toBe(snapshot);
    // Pass 1: before extraction nothing but fields can anchor (the metric one is UNANCHORED, not applied).
    const empty = CanonicalDeal.parse({ ...makeDeal(), metrics: [], claims: [] });
    const early = withCarriedOverrides(empty, { overrides: prev.overrides, source: prev }, AT);
    expect(early.overrides[0]!.carry!.status).toBe("UNANCHORED");
    // Pass 2 re-anchors from the previous version again (not from pass 1).
    const late = withCarriedOverrides({ ...next, overrides: early.overrides }, { overrides: prev.overrides, source: prev }, AT);
    expect(late.overrides[0]!.ref).toBe("MET-012");
    expect(withCarriedOverrides(next, null, AT)).toBe(next);
  });

  it("findAnchorTarget breaks ties on primary instance then id", () => {
    const d = makeDeal();
    d.metrics = [metric("arr", 1, { id: "MET-009", periodEnd: "2026-06", isPrimary: false }), metric("arr", 2, { id: "MET-004", periodEnd: "2026-06", isPrimary: true })];
    expect(findAnchorTarget(CanonicalDeal.parse(d), { kind: "METRIC", metricKey: "arr", label: "arr", periodEnd: "2026-06", periodType: "POINT_IN_TIME", basis: "CURRENT" })).toEqual({ ref: "MET-004", match: "EXACT" });
  });
});

describe("legacy USER_CORRECTED instances → overrides (no data loss)", () => {
  /** What the old "Correct this metric" path stored: the original kept (non-primary), a primary USER_CORRECTED copy, derived metrics re-derived from the copy. */
  function legacyDeal(): CanonicalDeal {
    const d = makeDeal();
    const original = metric("arr", 3_840_000, { id: "MET-001", rawValue: "$3.84M ARR", isPrimary: false, periodEnd: "2026-06" });
    const corrected: MetricInstance = {
      ...original,
      id: "MET-012",
      rawValue: "3000000 USD (analyst correction)",
      normalizedValue: 3_000_000,
      calculationMethod: "USER_CORRECTED",
      isPrimary: true,
      qualityFlags: ["USER_CORRECTED: was $3.84M ARR"],
      notes: "Corrected by Jane Analyst on 2026-05-01 (replaces MET-001, was $3.84M ARR). Data room ARR bridge excludes pilots",
    };
    d.metrics = deriveMetrics([original, metric("paying_customers", 92, { id: "MET-002", unit: "COUNT", periodEnd: "2026-06" }), corrected], seq(20));
    return CanonicalDeal.parse(d);
  }

  it("becomes an override on the original instance with the same author, date, note and value", () => {
    const legacy = legacyDeal();
    const acvLegacy = legacy.metrics.find((m) => m.metricKey === "acv")!;
    expect(acvLegacy.inputs).toContain("MET-012");
    const { deal, converted, kept } = upgradeLegacyCorrections(legacy);
    expect(kept).toEqual([]);
    expect(converted).toEqual([{ overrideId: "OVR-001", correctedId: "MET-012", originalId: "MET-001" }]);
    expect(deal.metrics.some((m) => m.calculationMethod === "USER_CORRECTED")).toBe(false);
    const o = deal.overrides[0]!;
    expect(o).toMatchObject({ target: "METRIC", ref: "MET-001", field: "normalizedValue", from: 3_840_000, to: 3_000_000, by: "Jane Analyst", at: "2026-05-01T00:00:00.000Z", reason: "Data room ARR bridge excludes pilots" });
    expect(o.legacy).toEqual({ correctedInstanceId: "MET-012", rawValue: "3000000 USD (analyst correction)", notes: legacy.metrics.find((m) => m.id === "MET-012")!.notes });
    expect(o.anchor).toMatchObject({ kind: "METRIC", metricKey: "arr", periodEnd: "2026-06" });
    // Raw original kept; the derived metric now points at it.
    expect(deal.metrics.find((m) => m.id === "MET-001")).toMatchObject({ normalizedValue: 3_840_000, isPrimary: true, rawValue: "$3.84M ARR" });
    expect(deal.metrics.find((m) => m.metricKey === "acv")!.inputs).toContain("MET-001");
    expect(legacy.metrics.some((m) => m.id === "MET-012")).toBe(true); // input untouched
  });

  it("the effective deal and every score are unchanged by the upgrade", () => {
    const legacy = legacyDeal();
    const { deal } = upgradeLegacyCorrections(legacy);
    const e = applyOverrides(deal);
    const arr = e.metrics.find((m) => m.metricKey === "arr" && m.isPrimary)!;
    expect(arr.normalizedValue).toBe(3_000_000);
    expect(e.metrics.filter((m) => m.metricKey === "arr" && m.isPrimary)).toHaveLength(1);
    const acvOld = legacy.metrics.find((m) => m.metricKey === "acv")!;
    const acvNew = e.metrics.find((m) => m.metricKey === "acv")!;
    expect(acvNew.id).toBe(acvOld.id);
    expect(acvNew.normalizedValue).toBeCloseTo(acvOld.normalizedValue!, 6);
    const now = new Date(AT);
    const a = derive(legacy, reg, DEFAULT_FUND_PROFILE, { now });
    const b = derive(deal, reg, DEFAULT_FUND_PROFILE, { now });
    expect(b.operatingQuality).toEqual(a.operatingQuality);
    expect(b.dimensions.map((x) => x.value)).toEqual(a.dimensions.map((x) => x.value));
    expect(b.recommendation.status).toBe(a.recommendation.status);
  });

  it("is idempotent, returns the same object when there is nothing to upgrade, and survives carry-over", () => {
    const once = upgradeLegacyCorrections(legacyDeal()).deal;
    expect(upgradeLegacyCorrections(once).deal).toBe(once);
    const next = v2Renumbered();
    const r = reanchorOverrides({ overrides: once.overrides, source: once }, next, AT).overrides[0]!;
    expect(r).toMatchObject({ ref: "MET-012", carry: { status: "REANCHORED" }, legacy: { correctedInstanceId: "MET-012" } });
  });

  it("keeps a correction it cannot attribute (no original, or a derived original) as it is — nothing is lost", () => {
    const d = makeDeal();
    const orphan = metric("gross_margin", 70, { id: "MET-050", unit: "PERCENT", calculationMethod: "USER_CORRECTED", notes: "Corrected by X on 2026-01-01 (replaces MET-999, was 76%).", periodEnd: "2019-01" });
    d.metrics = [...d.metrics.filter((m) => m.metricKey !== "gross_margin"), orphan];
    const r = upgradeLegacyCorrections(CanonicalDeal.parse(d));
    expect(r.kept).toEqual([{ correctedId: "MET-050", reason: "original instance not found" }]);
    expect(r.deal.metrics.find((m) => m.id === "MET-050")!.calculationMethod).toBe("USER_CORRECTED");
    expect(r.deal.overrides).toHaveLength(0);
  });

  it("orders legacy corrections before later overrides so the later analyst decision wins", () => {
    const legacy = legacyDeal();
    const withLater = { ...legacy, overrides: [{ id: "OVR-001", target: "METRIC" as const, ref: "MET-001", field: "normalizedValue", from: 3_840_000, to: 3_200_000, reason: "Later override", by: "B", at: "2026-06-01T00:00:00.000Z", anchor: null, carry: null, legacy: null }] };
    const { deal } = upgradeLegacyCorrections(withLater);
    expect(deal.overrides.map((o) => o.id)).toEqual(["OVR-002", "OVR-001"]);
    expect(applyOverrides(deal).metrics.find((m) => m.id === "MET-001")!.normalizedValue).toBe(3_200_000);
  });
});
