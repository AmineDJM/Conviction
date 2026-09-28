import type { CanonicalDeal } from "@/domain/canonical";
import { resolveOverrides } from "@/engine/overrides";
import { describeAnchor } from "@/engine/override-anchors";
import type { OverrideRow } from "./overrides-panel";

/** Rows for the overrides panel / lineage drawer, from the RAW canonical object. */
export function overrideRows(raw: CanonicalDeal): OverrideRow[] {
  const res = resolveOverrides(raw);
  const applied = new Map(res.applied.map((a) => [a.override.id, a]));
  const stale = new Map(res.stale.map((s) => [s.override.id, s.reason]));
  return (raw.overrides ?? []).map((o) => ({
    id: o.id,
    target: o.target,
    ref: o.ref,
    field: o.field,
    from: o.from,
    to: o.to,
    rawValue: applied.get(o.id)?.rawValue ?? o.from,
    reason: o.reason,
    by: o.by,
    at: o.at,
    propagatedTo: applied.get(o.id)?.propagatedTo ?? [],
    stale: stale.get(o.id) ?? null,
    target_label: o.anchor ? describeAnchor(o.anchor) : null,
    carry: o.carry ? { status: o.carry.status, match: o.carry.match, fromRef: o.carry.fromRef, note: o.carry.note } : null,
    legacyCorrection: o.legacy ? o.legacy.correctedInstanceId : null,
  }));
}
