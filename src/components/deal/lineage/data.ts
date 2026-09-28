import "server-only";
import type { LoadedDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import { canWrite } from "@/server/session";
import { metricDef } from "@/engine/metrics/dictionary";
import { overrideRows } from "@/components/deal/overrides/rows";
import type { LineageContextData, OverrideEvent } from "./lineage-view";

/** Everything the lineage drawer needs, from the effective canonical (display) and the raw one (overrides). */
export function lineageData(d: LoadedDeal): LineageContextData | null {
  const v = d.version;
  if (!v) return null;
  const c = v.canonical;
  const defs: LineageContextData["defs"] = {};
  for (const key of new Set(c.metrics.map((m) => m.metricKey))) {
    const def = metricDef(key);
    if (def) defs[key] = { name: def.name, definition: def.definition, formula: def.formula ?? null };
  }
  const events: OverrideEvent[] = repo
    .listHistory(d.company.id)
    .filter((h) => h.type === "OVERRIDE_ADDED" || h.type === "OVERRIDE_REVERTED")
    .map((h) => {
      const p = (h.payload ?? {}) as { ref?: string; by?: string | null; revertedBy?: string | null };
      return { at: h.createdAt, type: h.type, summary: h.summary, ref: p.ref ?? null, by: (h.type === "OVERRIDE_REVERTED" ? p.revertedBy : p.by) ?? null };
    });
  return {
    slug: d.company.slug,
    companyId: d.company.id,
    versionId: v.row.id,
    canWrite: canWrite(d.session),
    metrics: c.metrics,
    sources: c.sources,
    overrides: overrideRows(v.rawCanonical),
    events,
    defs,
  };
}
