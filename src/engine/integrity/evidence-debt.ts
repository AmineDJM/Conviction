/**
 * 5. EVIDENCE DEBT and 6. VERIFICATION PRIORITY.
 *
 * EVIDENCE DEBT RULE (documented, deterministic):
 *   Items = material claims + primary company-reported metrics not already
 *   linked to a material claim. Each item gets a support status:
 *     CONTRADICTED  — verification CONTRADICTED, a CONTRADICTS evidence link, or a recorded contradiction;
 *     VERIFIED      — verification VERIFIED with ≥ 1 independent confirmation or a non-company origin;
 *     INDEPENDENTLY_SUPPORTED — ≥ 1 independent confirming source (independentConfirmations),
 *                     or a non-company, independent origin;
 *     COMPANY_ONLY  — everything else (company assertion or anecdote only).
 *   Weight w = 1 + 0.5 × (unusualness − 1), unusualness clamped to 1–5 (metrics: 2).
 *   debtShare = Σ w(COMPANY_ONLY ∪ CONTRADICTED) / Σ w(all items).
 *   Level: < 0.25 LOW · < 0.50 MODERATE · < 0.75 HIGH · ≥ 0.75 VERY_HIGH.
 *   Any CONTRADICTED material claim in the scope raises the level by one (max VERY_HIGH).
 *   Applied per area and pooled for the overall level. An area with no items has level null.
 *
 * VERIFICATION PRIORITY INDEX (not a probability):
 *   index = round(100 × materiality × unusualness × uncertainty), each factor in [0, 1]:
 *     materiality = (material ? 1 : 0.35) × category weight;
 *     unusualness = clamp(unusualness, 1, 5) / 5;
 *     uncertainty = min(1, verification base × independence factor × freshness factor).
 */
import type { CanonicalDeal, Claim, MetricInstance } from "@/domain/canonical";
import { independentConfirmations } from "../scoring/evidence";
import { metricDef } from "../metrics/dictionary";
import type { IntegrityContext } from "./context";
import type { AreaDebt, DebtItem, DebtLevel, EvidenceArea, EvidenceDebtResult, SupportStatus, VerificationPriorityItem, VerificationPriorityResult } from "./types";
import { isNum, round } from "./util";

export const EVIDENCE_AREAS: readonly EvidenceArea[] = ["PRODUCT_PROOF", "TRACTION", "MARKET", "GTM", "MOAT", "TEAM", "FINANCING"];
const LEVELS: readonly DebtLevel[] = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"];

export const EVIDENCE_DEBT_RULE =
  "debtShare = Σ w(company-only or contradicted) / Σ w(all), w = 1 + 0.5 × (unusualness − 1); < 0.25 LOW, < 0.50 MODERATE, < 0.75 HIGH, else VERY_HIGH; any contradicted material claim raises one level.";

const GTM_METRIC_KEYS = new Set(["sales_cycle_days", "win_rate", "pipeline_value", "founder_led_revenue_share", "cac", "cac_payback_months", "magic_number", "ltv", "ltv_to_cac", "organic_acquisition_share"]);
const FINANCING_METRIC_KEYS = new Set(["cash_balance", "monthly_net_burn", "runway_months", "capital_to_next_milestone", "months_to_next_milestone"]);
const GTM_TEXT = /\b(sales cycle|pipeline|win rate|channel|reseller|distribution partner|cac|payback|go[- ]to[- ]market|quota|outbound|inbound)\b/i;

export function areaForClaim(c: Claim, linkedMetrics: MetricInstance[]): EvidenceArea | null {
  switch (c.category) {
    case "PRODUCT":
    case "TECHNOLOGY":
    case "REGULATORY":
      return "PRODUCT_PROOF";
    case "METRIC":
    case "CUSTOMER":
    case "FINANCIAL":
      if (linkedMetrics.some((m) => GTM_METRIC_KEYS.has(m.metricKey)) || (c.category === "METRIC" && GTM_TEXT.test(c.statement))) return "GTM";
      if (linkedMetrics.length && linkedMetrics.every((m) => FINANCING_METRIC_KEYS.has(m.metricKey))) return "FINANCING";
      return "TRACTION";
    case "MARKET":
      return "MARKET";
    case "PARTNERSHIP":
      return "GTM";
    case "COMPETITION":
    case "IP":
      return "MOAT";
    case "TEAM":
      return "TEAM";
    case "FUNDING":
      return "FINANCING";
    default:
      return null;
  }
}

export function areaForMetric(m: MetricInstance): EvidenceArea {
  if (GTM_METRIC_KEYS.has(m.metricKey) || metricDef(m.metricKey)?.family === "GTM") return "GTM";
  if (FINANCING_METRIC_KEYS.has(m.metricKey)) return "FINANCING";
  return "TRACTION";
}

export function isContradicted(c: Claim): boolean {
  return c.verification === "CONTRADICTED" || c.contradictions.length > 0 || c.evidence.some((e) => e.effect === "CONTRADICTS");
}

export function claimSupport(c: Claim, ctx: IntegrityContext): { status: SupportStatus; independent: number } {
  const dealView = { ...ctx.deal, sources: ctx.sources } as CanonicalDeal;
  let ic = 0;
  try {
    ic = independentConfirmations(c, dealView);
  } catch {
    ic = 0;
  }
  if (isContradicted(c)) return { status: "CONTRADICTED", independent: ic };
  if (c.verification === "VERIFIED" && (ic >= 1 || c.origin !== "COMPANY")) return { status: "VERIFIED", independent: ic };
  if (ic >= 1) return { status: "INDEPENDENTLY_SUPPORTED", independent: ic };
  if ((c.origin === "PRIMARY_EXTERNAL" || c.origin === "INDEPENDENT_SECONDARY") && c.independence === "INDEPENDENT") return { status: "INDEPENDENTLY_SUPPORTED", independent: ic };
  return { status: "COMPANY_ONLY", independent: ic };
}

function metricSupport(m: MetricInstance): SupportStatus {
  if (m.state === "CONTRADICTED" || m.verification === "CONTRADICTED") return "CONTRADICTED";
  if (m.verification === "VERIFIED") return "VERIFIED";
  if (m.verification === "PARTIALLY_VERIFIED") return "INDEPENDENTLY_SUPPORTED";
  return "COMPANY_ONLY";
}

const clampU = (u: number) => Math.min(5, Math.max(1, Math.round(isNum(u) ? u : 2)));
export const debtWeight = (u: number) => 1 + 0.5 * (clampU(u) - 1);

export function debtLevel(share: number | null, contradictedMaterial: boolean): DebtLevel | null {
  if (share === null) return null;
  let i = share < 0.25 ? 0 : share < 0.5 ? 1 : share < 0.75 ? 2 : 3;
  if (contradictedMaterial) i = Math.min(3, i + 1);
  return LEVELS[i]!;
}

export function evidenceDebt(ctx: IntegrityContext): EvidenceDebtResult {
  const items: DebtItem[] = [];
  const material = ctx.claims.filter((c) => c.material);
  const materialIds = new Set(material.map((c) => c.id));
  for (const c of material) {
    const linked = ctx.metrics.filter((m) => m.claimId === c.id);
    const area = areaForClaim(c, linked);
    if (!area) continue;
    const { status } = claimSupport(c, ctx);
    const w = debtWeight(c.unusualness);
    const factor = status === "COMPANY_ONLY" ? 1 : status === "CONTRADICTED" ? 1.5 : 0;
    items.push({ ref: c.id, kind: "CLAIM", area, status, unusualness: clampU(c.unusualness), weight: w, debtContribution: round(w * factor, 4), label: c.statement.slice(0, 160) });
  }
  const seenKeys = new Set<string>();
  for (const m of ctx.metrics) {
    if (!m.isPrimary || m.calculationMethod === "DERIVED" || !isNum(m.normalizedValue) || seenKeys.has(m.metricKey)) continue;
    if (m.claimId && materialIds.has(m.claimId)) continue;
    if (m.state !== "OBSERVED" && m.state !== "STALE" && m.state !== "INFERRED" && m.state !== "CONTRADICTED") continue;
    seenKeys.add(m.metricKey);
    const status = metricSupport(m);
    const w = debtWeight(2);
    const factor = status === "COMPANY_ONLY" ? 0.8 : status === "CONTRADICTED" ? 1.2 : 0;
    items.push({ ref: m.id, kind: "METRIC", area: areaForMetric(m), status, unusualness: 2, weight: w, debtContribution: round(w * factor, 4), label: `${metricDef(m.metricKey)?.shortName ?? m.metricKey} ${m.rawValue}`.slice(0, 160) });
  }

  const summarize = (scope: DebtItem[]) => {
    const total = scope.reduce((a, i) => a + i.weight, 0);
    const debt = scope.filter((i) => i.status === "COMPANY_ONLY" || i.status === "CONTRADICTED").reduce((a, i) => a + i.weight, 0);
    const share = total > 0 ? round(debt / total, 4) : null;
    const contradictedMaterial = scope.some((i) => i.kind === "CLAIM" && i.status === "CONTRADICTED");
    return { share, level: debtLevel(share, contradictedMaterial) };
  };

  const areas: AreaDebt[] = EVIDENCE_AREAS.map((area) => {
    const scope = items.filter((i) => i.area === area);
    const { share, level } = summarize(scope);
    return {
      area,
      items: scope.length,
      verified: scope.filter((i) => i.status === "VERIFIED").length,
      independentlySupported: scope.filter((i) => i.status === "INDEPENDENTLY_SUPPORTED").length,
      companyOnly: scope.filter((i) => i.status === "COMPANY_ONLY").length,
      contradicted: scope.filter((i) => i.status === "CONTRADICTED").length,
      companyOnlyWeightedShare: share,
      level,
      rule: EVIDENCE_DEBT_RULE,
    };
  });
  const overall = summarize(items);
  const topDebt = items
    .filter((i) => i.debtContribution > 0)
    .sort((a, b) => b.debtContribution - a.debtContribution || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
    .slice(0, 10);
  return { rule: EVIDENCE_DEBT_RULE, overall: overall.level, overallCompanyOnlyWeightedShare: overall.share, areas, topDebt };
}

/* ---------------------------------------------------------------- */
/* 6. Verification priority                                          */
/* ---------------------------------------------------------------- */

export const VERIFICATION_PRIORITY_LABEL = "Verification Priority Index — not a probability";

export const CATEGORY_WEIGHT: Record<string, number> = {
  METRIC: 1,
  FINANCIAL: 1,
  CUSTOMER: 1,
  REGULATORY: 0.9,
  PRODUCT: 0.85,
  TECHNOLOGY: 0.85,
  FUNDING: 0.8,
  TEAM: 0.8,
  IP: 0.75,
  MARKET: 0.7,
  PARTNERSHIP: 0.7,
  COMPETITION: 0.6,
  OTHER: 0.5,
};
const VERIFICATION_BASE: Record<string, number> = { VERIFIED: 0.1, PARTIALLY_VERIFIED: 0.45, UNVERIFIED: 0.85, CONTRADICTED: 1 };
const INDEPENDENCE_FACTOR: Record<string, number> = { INDEPENDENT: 0.7, SHARED_ORIGIN: 0.9, COMPANY_DERIVED: 1 };
const FRESHNESS_FACTOR: Record<string, number> = { CURRENT: 1, AGING: 1.1, STALE: 1.25 };

export function verificationPriority(ctx: IntegrityContext): VerificationPriorityResult {
  const items: VerificationPriorityItem[] = ctx.claims.map((c) => {
    const materiality = (c.material ? 1 : 0.35) * (CATEGORY_WEIGHT[c.category] ?? 0.5);
    const unusualness = clampU(c.unusualness) / 5;
    const uncertainty = isContradicted(c)
      ? 1
      : Math.min(1, (VERIFICATION_BASE[c.verification] ?? 0.85) * (INDEPENDENCE_FACTOR[c.independence] ?? 1) * (FRESHNESS_FACTOR[c.freshness] ?? 1));
    return {
      claimId: c.id,
      statement: c.statement.slice(0, 200),
      category: c.category,
      index: Math.round(100 * materiality * unusualness * uncertainty),
      materiality: round(materiality, 4),
      unusualness: round(unusualness, 4),
      uncertainty: round(uncertainty, 4),
      pages: ctx.claimPages(c),
    };
  });
  items.sort((a, b) => b.index - a.index || b.materiality - a.materiality || (a.claimId < b.claimId ? -1 : a.claimId > b.claimId ? 1 : 0));
  return {
    label: VERIFICATION_PRIORITY_LABEL,
    formula: "100 × materiality ((material ? 1 : 0.35) × category weight) × unusualness (1–5 / 5) × uncertainty (verification × independence × freshness, ≤ 1)",
    items,
  };
}
