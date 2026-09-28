/**
 * Operating maturity anchored on measured revenue.
 *
 * The model classifies maturity from the deck, and two decks with identical metrics were classified
 * EARLY_REVENUE and PMF_EMERGING — which decides whether retention is scored at all. When a current
 * revenue figure is measured, code decides the maturity from it (declared policy thresholds below); the
 * model's label is kept only when nothing is measured (pre-revenue distinctions: prototype, pilot…) or
 * when an analyst explicitly overrode it.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { OperationalMaturity } from "@/domain/enums";

/** Declared policy (maturity_anchor_v1): annual run-rate revenue at which each maturity starts. */
export const MATURITY_REVENUE_THRESHOLDS_USD: [OperationalMaturity, number][] = [
  ["GROWTH", 50_000_000],
  ["SCALED_GTM", 10_000_000],
  ["PMF_EMERGING", 1_000_000],
  ["EARLY_REVENUE", 1],
];

export interface MaturityAnchor {
  model: OperationalMaturity;
  effective: OperationalMaturity;
  basis: "MEASURED_REVENUE" | "MODEL_CLASSIFICATION" | "ANALYST_OVERRIDE";
  detail: string;
}

const USABLE = new Set(["OBSERVED", "INFERRED", "STALE"]);

export function anchorMaturity(deal: CanonicalDeal): MaturityAnchor {
  const model = deal.classification.operationalMaturity;
  if (deal.overrides.some((o) => o.target === "CLASSIFICATION" && o.field === "operationalMaturity" && o.carry?.status !== "UNANCHORED"))
    return { model, effective: model, basis: "ANALYST_OVERRIDE", detail: `Set by an analyst override (${model})` };
  const rev =
    deal.metrics.find((m) => m.metricKey === "arr" && m.isPrimary && m.normalizedValue !== null && USABLE.has(m.state)) ??
    deal.metrics.find((m) => m.metricKey === "revenue_ttm" && m.isPrimary && m.normalizedValue !== null && USABLE.has(m.state));
  if (!rev || rev.normalizedValue! <= 0) return { model, effective: model, basis: "MODEL_CLASSIFICATION", detail: `No measured current revenue; model classification ${model} kept` };
  const effective = MATURITY_REVENUE_THRESHOLDS_USD.find(([, min]) => rev.normalizedValue! >= min)![0];
  return {
    model,
    effective,
    basis: "MEASURED_REVENUE",
    detail: `${rev.metricKey === "arr" ? "ARR" : "Revenue (TTM)"} ${rev.rawValue} (${rev.id}) → ${effective}${effective !== model ? ` (model classified ${model})` : ""}`,
  };
}

/** The deal with its maturity anchored (the stored canonical is untouched). */
export function withAnchoredMaturity(deal: CanonicalDeal): { deal: CanonicalDeal; anchor: MaturityAnchor } {
  const anchor = anchorMaturity(deal);
  if (anchor.effective === deal.classification.operationalMaturity) return { deal, anchor };
  return { deal: { ...deal, classification: { ...deal.classification, operationalMaturity: anchor.effective } }, anchor };
}

/** Maturity as scored, with the model's label when code anchored it differently (for reports). */
export function maturityText(classified: OperationalMaturity, anchor: MaturityAnchor | undefined, label: (s: string) => string): string {
  if (!anchor || anchor.effective === classified) return label(classified);
  return `${label(anchor.effective)} (anchored on measured revenue; the analysis classified it ${label(classified).toLowerCase()})`;
}
