/**
 * HUMAN OVERRIDES (pure, deterministic).
 *
 * An analyst can override a metric value, a classification axis, an identity
 * (entity) field or a claim's verification / materiality. Overrides are
 * stored in `canonical.overrides`; the raw extraction is NEVER overwritten.
 * `applyOverrides(deal)` returns the effective deal that `derive()` scores and
 * the UI displays, with every overridden value traceable:
 *   - metrics gain an `OVERRIDE` lineage step and an `ANALYST_OVERRIDE` flag;
 *   - derived metrics that depend on an overridden input are recomputed by the
 *     same formulas (engine/metrics/derive) and record `OVERRIDE_PROPAGATED`;
 *   - claims gain a `CORRECTED` history entry.
 *
 * Idempotent: applying twice yields the same object (each override leaves a
 * marker carrying its id). Never mutates its input.
 *
 * Ids change when a company is re-analysed, so every override also stores a
 * stable `anchor` (engine/override-anchors.ts); carry-over re-anchors it
 * (engine/override-carry.ts). An override is applied only when its target still
 * matches its anchor; an UNANCHORED override is kept and reported, never applied.
 */
import { z } from "zod";
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import { Classification, Identity } from "@/domain/sections";
import { VerificationStatus } from "@/domain/enums";
import { deriveMetrics } from "./metrics/derive";
import { OVERRIDE_FLAG, OVERRIDE_PROPAGATED_STEP, OVERRIDE_STEP, isOverridden } from "./override-marks";
import { anchorFor, anchorHolds, describeAnchor } from "./override-anchors";

export { OVERRIDE_FLAG, OVERRIDE_PROPAGATED_STEP, OVERRIDE_STEP, isOverridden };

export type Override = CanonicalDeal["overrides"][number];
export type OverrideTarget = Override["target"];

/** The fields each target accepts. Anything else is refused by `validateOverride`. */
export const OVERRIDE_FIELDS: Record<OverrideTarget, readonly string[]> = {
  METRIC: ["normalizedValue"],
  CLASSIFICATION: ["industry", "productType", "technology", "revenueModel", "gtm", "operationalMaturity", "financingStage"],
  ENTITY: ["name", "legalName", "website", "hqCountry", "foundedYear"],
  CLAIM: ["verification", "material"],
};

/** Refs for the singleton targets. */
export const CLASSIFICATION_REF = "classification";
export const ENTITY_REF = "identity";

const marker = (id: string) => `[${id}]`;

function valueSchema(target: OverrideTarget, field: string): z.ZodType | null {
  if (!OVERRIDE_FIELDS[target].includes(field)) return null;
  switch (target) {
    case "METRIC":
      return z.number().finite();
    case "CLASSIFICATION":
      return (Classification.shape as Record<string, z.ZodType>)[field] ?? null;
    case "ENTITY":
      return (Identity.shape as Record<string, z.ZodType>)[field] ?? null;
    case "CLAIM":
      return field === "verification" ? VerificationStatus : z.boolean();
  }
}

export type ValidationResult = { ok: true; value: unknown; from: unknown } | { ok: false; error: string };

/** Reads the current value a (target, ref, field) points at in a deal. `undefined` = target not found. */
export function currentValue(deal: CanonicalDeal, target: OverrideTarget, ref: string, field: string): unknown {
  switch (target) {
    case "METRIC":
      return deal.metrics.find((m) => m.id === ref)?.[field as keyof MetricInstance];
    case "CLASSIFICATION":
      return ref === CLASSIFICATION_REF ? (deal.classification as Record<string, unknown>)[field] : undefined;
    case "ENTITY":
      return ref === ENTITY_REF ? (deal.identity as Record<string, unknown>)[field] : undefined;
    case "CLAIM":
      return deal.claims.find((c) => c.id === ref)?.[field as "verification" | "material"];
  }
}

/**
 * Validates an override against the deal it will apply to. `from` is the
 * effective value it replaces (after earlier overrides), for the audit trail.
 */
export function validateOverride(deal: CanonicalDeal, o: { target: OverrideTarget; ref: string; field: string; to: unknown }): ValidationResult {
  const schema = valueSchema(o.target, o.field);
  if (!schema) return { ok: false, error: `Field "${o.field}" cannot be overridden on ${o.target.toLowerCase()} (allowed: ${OVERRIDE_FIELDS[o.target].join(", ")})` };
  const parsed = schema.safeParse(o.to);
  if (!parsed.success) return { ok: false, error: `Invalid value for ${o.field}: ${parsed.error.issues[0]?.message ?? "rejected"}` };
  if (o.target === "METRIC") {
    const m = deal.metrics.find((x) => x.id === o.ref);
    if (!m) return { ok: false, error: `Unknown metric ${o.ref}` };
    if (m.calculationMethod === "DERIVED") return { ok: false, error: `${o.ref} is computed by code from other metrics; override one of its inputs (${m.inputs.join(", ") || "none recorded"}) instead` };
  }
  const effective = applyOverrides(deal);
  const from = currentValue(effective, o.target, o.ref, o.field);
  if (from === undefined) return { ok: false, error: `Unknown ${o.target.toLowerCase()} reference ${o.ref}` };
  if (JSON.stringify(from) === JSON.stringify(parsed.data)) return { ok: false, error: "The override equals the current value" };
  return { ok: true, value: parsed.data, from };
}

export interface AppliedOverride {
  override: Override;
  /** Value in the raw (un-overridden) deal. */
  rawValue: unknown;
  /** Metric ids recomputed because they depend on this override. */
  propagatedTo: string[];
}

export interface OverrideResolution {
  deal: CanonicalDeal;
  applied: AppliedOverride[];
  /** Overrides whose target no longer exists in this version (e.g. re-analysis renumbered metrics). */
  stale: { override: Override; reason: string }[];
}

const display = (v: unknown) => (v === null || v === undefined ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v));

/** Remaps re-derived metric ids back onto the ids they had before, so references stay stable. */
function rederive(metrics: MetricInstance[], overridden: Map<string, Override[]>): { metrics: MetricInstance[]; propagated: Map<string, string[]> } {
  const kept = metrics.filter((m) => m.calculationMethod !== "DERIVED");
  const oldDerived = metrics.filter((m) => m.calculationMethod === "DERIVED");
  let k = 0;
  const fresh = deriveMetrics(kept, () => `__NEW_${k++}__`);
  // deriveMetrics dedupes; never lose a kept instance.
  for (const m of kept) if (!fresh.some((f) => f.id === m.id)) fresh.push({ ...m, isPrimary: false });

  let max = 0;
  for (const m of metrics) {
    const n = /^MET-(\d+)$/.exec(m.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const f of fresh) {
    if (!f.id.startsWith("__NEW_")) continue;
    const prev = oldDerived.find((o) => o.metricKey === f.metricKey && !used.has(o.id));
    const id = prev ? prev.id : `MET-${String(++max).padStart(3, "0")}`;
    used.add(id);
    map.set(f.id, id);
  }
  const swap = (s: string) => s.replace(/__NEW_\d+__/g, (t) => map.get(t) ?? t);
  const propagated = new Map<string, string[]>();
  const out = fresh.map((m) => {
    if (!m.id.startsWith("__NEW_")) return m;
    const id = map.get(m.id)!;
    const inputs = m.inputs.map(swap);
    const lineage = m.lineage.map((l) => ({ step: l.step, detail: swap(l.detail) }));
    const notes = m.notes ? swap(m.notes) : m.notes;
    // Derived instances inherit input flags; the override flag belongs to the overridden input only.
    const qualityFlags = m.qualityFlags.filter((f) => !f.startsWith(OVERRIDE_FLAG));
    return { ...m, id, inputs, lineage, notes, qualityFlags };
  });
  // Transitive dependents of every overridden metric.
  const byId = new Map(out.map((m) => [m.id, m]));
  const dependsOn = (m: MetricInstance, seen = new Set<string>()): string[] => {
    const hits: string[] = [];
    for (const i of m.inputs) {
      if (seen.has(i)) continue;
      seen.add(i);
      if (overridden.has(i)) hits.push(i);
      const im = byId.get(i);
      if (im?.calculationMethod === "DERIVED") hits.push(...dependsOn(im, seen));
    }
    return hits;
  };
  for (const m of out) {
    if (m.calculationMethod !== "DERIVED") continue;
    const src = [...new Set(dependsOn(m))];
    if (!src.length) continue;
    const ids = src.flatMap((s) => overridden.get(s)!.map((o) => o.id));
    m.lineage.push({ step: OVERRIDE_PROPAGATED_STEP, detail: `${ids.map(marker).join(" ")} recomputed from analyst-overridden input ${src.join(", ")}` });
    for (const s of src) for (const o of overridden.get(s)!) propagated.set(o.id, [...(propagated.get(o.id) ?? []), m.id]);
  }
  return { metrics: out, propagated };
}

/**
 * Resolves the overrides of a deal: the effective deal plus, for each
 * override, the raw value it replaced and the metrics it propagated to.
 */
export function resolveOverrides(deal: CanonicalDeal): OverrideResolution {
  const list = deal.overrides ?? [];
  if (!list.length) return { deal, applied: [], stale: [] };
  const next = structuredClone(deal);
  const applied: AppliedOverride[] = [];
  const stale: OverrideResolution["stale"] = [];
  const metricOverrides = new Map<string, Override[]>();
  let needsRederive = false;

  for (const o of list) {
    if (o.carry?.status === "UNANCHORED") {
      stale.push({ override: o, reason: o.carry.note });
      continue;
    }
    const rawValue = currentValue(deal, o.target, o.ref, o.field);
    if (rawValue === undefined || !OVERRIDE_FIELDS[o.target].includes(o.field)) {
      stale.push({ override: o, reason: `${o.target.toLowerCase()} ${o.ref}.${o.field} is not present in this version` });
      continue;
    }
    // Never apply an override to a different target that happens to carry the same id.
    if (o.anchor && !anchorHolds(deal, o.target, o.ref, o.anchor)) {
      stale.push({ override: o, reason: `not applied: ${o.ref} no longer designates ${describeAnchor(o.anchor)}` });
      continue;
    }
    const tag = marker(o.id);
    const note = `${tag} analyst override ${display(o.from)} → ${display(o.to)}${o.by ? ` by ${o.by}` : ""} on ${o.at.slice(0, 10)}: ${o.reason}`;
    if (o.target === "METRIC") {
      const m = next.metrics.find((x) => x.id === o.ref)!;
      if (m.calculationMethod === "DERIVED") {
        stale.push({ override: o, reason: `${o.ref} is derived by code; overrides apply to inputs only` });
        continue;
      }
      metricOverrides.set(o.ref, [...(metricOverrides.get(o.ref) ?? []), o]);
      if (!m.lineage.some((l) => l.step === OVERRIDE_STEP && l.detail.startsWith(tag))) {
        m.normalizedValue = o.to as number;
        m.lineage.push({ step: OVERRIDE_STEP, detail: note });
        m.qualityFlags = [...m.qualityFlags.filter((f) => !f.startsWith(OVERRIDE_FLAG)), `${OVERRIDE_FLAG}: company reported ${m.rawValue}`];
        needsRederive = true;
      }
    } else if (o.target === "CLASSIFICATION") {
      (next.classification as Record<string, unknown>)[o.field] = structuredClone(o.to);
    } else if (o.target === "ENTITY") {
      (next.identity as Record<string, unknown>)[o.field] = structuredClone(o.to);
    } else {
      const c = next.claims.find((x) => x.id === o.ref)!;
      (c as Record<string, unknown>)[o.field] = o.to;
      if (!c.history.some((h) => h.note.startsWith(tag))) c.history.push({ at: o.at, change: "CORRECTED", note });
    }
    applied.push({ override: o, rawValue, propagatedTo: [] });
  }

  // Re-derive only when a derived metric depends (transitively) on an overridden input.
  const derived = next.metrics.filter((m) => m.calculationMethod === "DERIVED");
  const reach = new Set(metricOverrides.keys());
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of derived)
      if (!reach.has(m.id) && m.inputs.some((i) => reach.has(i))) {
        reach.add(m.id);
        grew = true;
      }
  }
  const hasDependents = derived.some((m) => reach.has(m.id));
  if (needsRederive && hasDependents) {
    const { metrics, propagated } = rederive(next.metrics, metricOverrides);
    next.metrics = metrics;
    for (const a of applied) a.propagatedTo = propagated.get(a.override.id) ?? [];
  } else if (metricOverrides.size && hasDependents) {
    // Already applied (idempotent pass): read propagation back from lineage.
    for (const a of applied)
      a.propagatedTo = next.metrics.filter((m) => m.lineage.some((l) => l.step === OVERRIDE_PROPAGATED_STEP && l.detail.includes(marker(a.override.id)))).map((m) => m.id);
  }
  return { deal: next, applied, stale };
}

/** The effective deal: raw extraction + analyst overrides. Pure; the input is never mutated. */
export function applyOverrides(deal: CanonicalDeal): CanonicalDeal {
  return resolveOverrides(deal).deal;
}

/**
 * Appends an override (new canonical object; raw data untouched). The stable
 * anchor of its target is computed from `deal` unless given.
 */
export function addOverride(
  deal: CanonicalDeal,
  o: Omit<Override, "id" | "from" | "anchor" | "carry" | "legacy"> & { from: unknown; anchor?: Override["anchor"] },
): { deal: CanonicalDeal; override: Override } {
  let max = 0;
  for (const x of deal.overrides ?? []) {
    const n = /^OVR-(\d+)$/.exec(x.id);
    if (n) max = Math.max(max, Number(n[1]));
  }
  const override: Override = { ...o, id: `OVR-${String(max + 1).padStart(3, "0")}`, anchor: o.anchor ?? anchorFor(deal, o), carry: null, legacy: null };
  return { deal: { ...structuredClone(deal), overrides: [...(deal.overrides ?? []), override] }, override };
}

/** Removes an override (revert). The previous versions keep it as history. */
export function removeOverride(deal: CanonicalDeal, id: string): { deal: CanonicalDeal; removed: Override | null } {
  const removed = (deal.overrides ?? []).find((o) => o.id === id) ?? null;
  if (!removed) return { deal, removed: null };
  return { deal: { ...structuredClone(deal), overrides: deal.overrides.filter((o) => o.id !== id) }, removed };
}
