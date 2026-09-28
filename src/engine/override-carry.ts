/**
 * OVERRIDE CARRY-OVER AND LEGACY UPGRADE (pure, deterministic).
 *
 * 1. `reanchorOverrides` — when a company is re-analysed (same deck in a new
 *    mode, a new deck version, or documents added) the analyst's overrides are
 *    carried over from the previous version. Their ids (MET-007…) mean nothing
 *    in the new analysis, so each override is re-anchored on its stable anchor
 *    (engine/override-anchors.ts). An override whose target cannot be found is
 *    KEPT, marked UNANCHORED with the reason, shown to the analyst and never
 *    applied — it is never silently dropped, and never applied to whatever
 *    target happens to reuse its old id.
 *
 * 2. `upgradeLegacyCorrections` — the old "Correct this metric" path stored a
 *    USER_CORRECTED copy of the metric. On read, each such copy becomes an
 *    analyst override on the original instance (same value, same author, same
 *    note, same date; the copy's id and raw text are kept in `legacy`). The
 *    effective deal, and therefore every score, is unchanged.
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import { anchorFor, describeAnchor, findAnchorTarget } from "./override-anchors";
import type { Override } from "./overrides";

export interface CarryOverSource {
  /** The overrides to carry (usually `previous.overrides`). */
  overrides: Override[];
  /** The analysis the overrides were made on — used to anchor overrides stored before anchors existed. */
  source?: Pick<CanonicalDeal, "metrics" | "claims" | "classification" | "identity"> | null;
  fromVersionId?: string | null;
}

export interface CarryOverReportItem {
  id: string;
  target: Override["target"];
  field: string;
  status: "REANCHORED" | "UNANCHORED";
  fromRef: string;
  toRef: string | null;
  match: NonNullable<Override["carry"]>["match"];
  note: string;
}

const show = (v: unknown) => (v === null || v === undefined ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function rawAt(deal: Pick<CanonicalDeal, "metrics" | "claims" | "classification" | "identity">, o: { target: Override["target"]; ref: string; field: string }): unknown {
  switch (o.target) {
    case "METRIC":
      return deal.metrics.find((m) => m.id === o.ref)?.[o.field as keyof MetricInstance];
    case "CLAIM":
      return deal.claims.find((c) => c.id === o.ref)?.[o.field as "verification" | "material"];
    case "CLASSIFICATION":
      return (deal.classification as Record<string, unknown>)[o.field];
    case "ENTITY":
      return (deal.identity as Record<string, unknown>)[o.field];
  }
}

/**
 * Re-anchors carried overrides onto `next`. Every input override is in the
 * output (same id, same order); the report says, for each, where it landed or
 * why it was not re-applied.
 */
export function reanchorOverrides(carry: CarryOverSource, next: CanonicalDeal, at: string): { overrides: Override[]; report: CarryOverReportItem[] } {
  const overrides: Override[] = [];
  const report: CarryOverReportItem[] = [];
  const src = carry.source ? (carry.source as CanonicalDeal) : null;
  for (const o of carry.overrides ?? []) {
    const anchor = o.anchor ?? (src ? anchorFor(src, o) : null);
    const base = { fromRef: o.ref, fromVersionId: carry.fromVersionId ?? null, at };
    if (!anchor) {
      const note = `not re-applied: ${o.target.toLowerCase()} ${o.ref} could not be identified in the analysis it was made on`;
      overrides.push({ ...o, anchor: null, carry: { ...base, status: "UNANCHORED", match: null, note } });
      report.push({ id: o.id, target: o.target, field: o.field, status: "UNANCHORED", fromRef: o.ref, toRef: null, match: null, note });
      continue;
    }
    const hit = findAnchorTarget(next, anchor);
    if (hit.ref === null) {
      const note = `not re-applied: target not found in the new analysis — ${hit.reason}`;
      overrides.push({ ...o, anchor, carry: { ...base, status: "UNANCHORED", match: null, note } });
      report.push({ id: o.id, target: o.target, field: o.field, status: "UNANCHORED", fromRef: o.ref, toRef: null, match: null, note });
      continue;
    }
    const nowRaw = rawAt(next, { target: o.target, ref: hit.ref, field: o.field });
    const wasRaw = src ? rawAt(src, o) : undefined;
    const parts = [`re-applied to ${o.target === "METRIC" || o.target === "CLAIM" ? `${hit.ref} (${describeAnchor(anchor)})` : describeAnchor(anchor)}`];
    if (hit.match === "PERIOD") parts.push("chronology basis differs from the original target");
    if (hit.match === "SIMILAR") parts.push("matched on a similar statement");
    if (same(nowRaw, o.to)) parts.push(`the new analysis now reports the overridden value (${show(o.to)})`);
    else if (wasRaw !== undefined && !same(nowRaw, wasRaw)) parts.push(`the source changed: the new analysis reports ${show(nowRaw)} (was ${show(wasRaw)} when overridden) — review`);
    const note = parts.join("; ");
    overrides.push({ ...o, ref: hit.ref, anchor, carry: { ...base, status: "REANCHORED", match: hit.match, note } });
    report.push({ id: o.id, target: o.target, field: o.field, status: "REANCHORED", fromRef: o.ref, toRef: hit.ref, match: hit.match, note });
  }
  return { overrides, report };
}

/** The deal with the carried overrides re-anchored on it (new object; `deal` is not mutated). */
export function withCarriedOverrides(deal: CanonicalDeal, carry: CarryOverSource | null | undefined, at: string): CanonicalDeal {
  if (!carry?.overrides?.length) return deal;
  return { ...deal, overrides: reanchorOverrides(carry, deal, at).overrides };
}

/* ------------------------------------------------------------------ */
/* Legacy USER_CORRECTED instances → overrides                          */
/* ------------------------------------------------------------------ */

export interface LegacyUpgrade {
  deal: CanonicalDeal;
  converted: { overrideId: string; correctedId: string; originalId: string }[];
  /** Corrections kept as USER_CORRECTED instances because no original could be identified (no data loss either way). */
  kept: { correctedId: string; reason: string }[];
}

const num = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

function swapId(s: string, from: string, to: string) {
  return s.replace(new RegExp(`\\b${from.replace(/[-]/g, "\\-")}\\b`, "g"), to);
}

/**
 * Upgrades legacy USER_CORRECTED metric instances to analyst overrides.
 * Returns the input object itself when there is nothing to upgrade.
 */
export function upgradeLegacyCorrections(deal: CanonicalDeal): LegacyUpgrade {
  const corrected = deal.metrics.filter((m) => m.calculationMethod === "USER_CORRECTED").sort((a, b) => num(a.id) - num(b.id));
  if (!corrected.length) return { deal, converted: [], kept: [] };
  const next = structuredClone(deal);
  let maxOvr = 0;
  for (const o of next.overrides) maxOvr = Math.max(maxOvr, num(o.id));
  const legacy: Override[] = [];
  const converted: LegacyUpgrade["converted"] = [];
  const kept: LegacyUpgrade["kept"] = [];

  for (const c of corrected) {
    const named = /replaces (MET-[\w-]+)/.exec(c.notes ?? "")?.[1];
    const pool = next.metrics.filter((m) => m.id !== c.id && m.calculationMethod !== "USER_CORRECTED");
    const original =
      (named ? pool.find((m) => m.id === named) : undefined) ??
      pool.filter((m) => m.calculationMethod === "REPORTED" && m.metricKey === c.metricKey && m.periodEnd === c.periodEnd && m.basis === c.basis).sort((a, b) => num(a.id) - num(b.id))[0];
    if (!original) {
      kept.push({ correctedId: c.id, reason: "original instance not found" });
      continue;
    }
    if (original.calculationMethod === "DERIVED") {
      kept.push({ correctedId: c.id, reason: `corrects derived metric ${original.id}; overrides apply to inputs only` });
      continue;
    }
    if (c.normalizedValue === null) {
      kept.push({ correctedId: c.id, reason: "correction has no value" });
      continue;
    }
    const who = /Corrected by (.+?) on (\d{4}-\d{2}-\d{2})/.exec(c.notes ?? "");
    const note = (c.notes ?? "").replace(/^Corrected by .+? on \d{4}-\d{2}-\d{2} \(replaces [^)]*\)\.?\s*/, "").trim();
    const id = `OVR-${String(++maxOvr).padStart(3, "0")}`;
    const o: Override = {
      id,
      target: "METRIC",
      ref: original.id,
      field: "normalizedValue",
      from: original.normalizedValue,
      to: c.normalizedValue,
      reason: note || "Analyst correction (recorded before overrides existed)",
      by: who?.[1] ?? null,
      at: who ? `${who[2]}T00:00:00.000Z` : (deal.analysis.provenance?.startedAt ?? "1970-01-01T00:00:00.000Z"),
      anchor: anchorFor(next, { target: "METRIC", ref: original.id, field: "normalizedValue" }),
      carry: null,
      legacy: { correctedInstanceId: c.id, rawValue: c.rawValue, notes: c.notes },
    };
    legacy.push(o);
    converted.push({ overrideId: id, correctedId: c.id, originalId: original.id });
    // The corrected copy was the primary instance; the original takes its place (and its value, via the override).
    original.isPrimary = c.isPrimary || original.isPrimary;
    next.metrics = next.metrics
      .filter((m) => m.id !== c.id)
      .map((m) =>
        m.inputs.includes(c.id) || m.lineage.some((l) => l.detail.includes(c.id))
          ? { ...m, inputs: m.inputs.map((i) => (i === c.id ? original.id : i)), lineage: m.lineage.map((l) => ({ ...l, detail: swapId(l.detail, c.id, original.id) })), notes: m.notes ? swapId(m.notes, c.id, original.id) : m.notes }
          : m,
      );
  }
  if (!legacy.length) return { deal, converted, kept };
  // Legacy corrections predate every override: they come first, so a later override of the same value wins.
  next.overrides = [...legacy, ...next.overrides];
  return { deal: next, converted, kept };
}
