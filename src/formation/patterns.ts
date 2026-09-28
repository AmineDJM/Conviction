/**
 * CASE PATTERNS — deterministic tags describing what makes a case instructive.
 * Every tag carries the evidence that triggered it. Expert patterns are the
 * ones where the obvious reading of the deck is misleading.
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { EXPERT_PATTERNS, type CasePattern } from "./types";
import type { Concern } from "./concerns";
import { naiveTopConcern } from "./concerns";
import { money } from "./format";

export interface PatternReading {
  pattern: CasePattern;
  evidence: string;
  expert: boolean;
}

const STRONG = new Set(["STRONG", "EXCEPTIONAL"]);
const HIGH = new Set(["HIGH", "CRITICAL"]);

export const PILOT_FINDINGS = ["PILOTS_AS_CUSTOMERS", "LOGO_ONLY_CUSTOMERS", "CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING", "LOGO_WALL_EXCEEDS_CUSTOMER_COUNT", "SIGNED_NOT_DEPLOYED", "ARR_INCLUDES_NON_RECURRING", "ARR_MAY_INCLUDE_NON_RECURRING"];
export const FORECAST_FINDINGS = ["HOCKEY_STICK", "HOCKEY_STICK_FORECAST", "ACTUAL_IN_FUTURE", "ACTUAL_DATED_IN_FUTURE", "UNDATED_FORECAST", "FORECAST_BASE_NOT_DISCLOSED", "CONTRACTED_ONLY_REVENUE", "BOOKINGS_AS_ARR", "STALE_METRIC_AS_CURRENT"];
export const TAM_FINDINGS = ["IMPLIED_DECK_TAM_VS_RECONSTRUCTED", "IMPLIED_TAM_VS_PRICE_X_CUSTOMERS", "IMPLIED_SOM_VS_REVENUE", "IMPLIED_SAM_WITHIN_TAM", "IMPLIED_SOM_WITHIN_SAM"];

function val(deal: CanonicalDeal, metrics: Record<string, MetricInstance>, key: string): number | null {
  const m = metrics[key] ?? deal.metrics.find((x) => x.metricKey === key && x.isPrimary && x.normalizedValue !== null);
  return m?.normalizedValue ?? null;
}

export function growthPct(deal: CanonicalDeal, metrics: Record<string, MetricInstance>): number | null {
  const g = val(deal, metrics, "arr_growth_yoy") ?? val(deal, metrics, "revenue_growth_yoy");
  if (g !== null) return g;
  const mom = val(deal, metrics, "mom_growth");
  return mom !== null ? (Math.pow(1 + mom / 100, 12) - 1) * 100 : null;
}

export interface OutlierSignal {
  id: string;
  text: string;
  kind: string;
  /** EVIDENCED: an exceptional strength rated strong/exceptional or an explicit decision-core outlier signal. PLAUSIBLE: a nonlinear mechanism the analysis finds plausible but not demonstrated. */
  support: "EVIDENCED" | "PLAUSIBLE";
}

/** Outlier signals in the analysis. Only EVIDENCED signals make a case "exceptional". */
export function outlierSignals(deal: CanonicalDeal, opts: { includePlausible?: boolean } = {}): OutlierSignal[] {
  const out: OutlierSignal[] = [];
  for (const e of deal.exceptionalStrengths) if (STRONG.has(e.rating)) out.push({ id: e.id, text: e.claim, kind: e.kind, support: "EVIDENCED" });
  (deal.decisionCore?.outlierSignals ?? []).forEach((s, i) => out.push({ id: `DC-O${i + 1}`, text: s.signal, kind: "DECISION_CORE", support: "EVIDENCED" }));
  if (opts.includePlausible && deal.nonlinear?.outlierPlausible) out.push({ id: "NONLINEAR", text: deal.nonlinear.mechanism, kind: "NONLINEAR", support: "PLAUSIBLE" });
  return out;
}

export function casePatterns(deal: CanonicalDeal, derived: DerivedAnalysis, metrics: Record<string, MetricInstance>, concerns: Concern[]): PatternReading[] {
  const out: PatternReading[] = [];
  const add = (pattern: CasePattern, evidence: string) => out.push({ pattern, evidence, expert: (EXPERT_PATTERNS as readonly string[]).includes(pattern) });
  const kinds = new Set((derived.integrity?.findings ?? []).map((f) => f.kind));
  const findings = derived.integrity?.findings ?? [];
  const growth = growthPct(deal, metrics);
  const rec = derived.recommendation?.status ?? deal.aiRecommendation?.suggestedStatus ?? null;

  // Obvious answer is wrong: the naive and the adjusted concern rankings disagree, or strong headline growth with a negative verdict.
  const top = concerns[0];
  const naive = naiveTopConcern(concerns);
  if (top && naive && naive.metricKey !== top.metricKey && naive.rawSeverity - top.rawSeverity > 0.05)
    add("OBVIOUS_ANSWER_WRONG", `${naive.label} (${naive.display}) looks like the biggest problem, but ${top.label} (${top.display}) matters more: ${naive.adjustments[0] ?? top.adjustments[0] ?? "see the worked solution"}`);
  else if (growth !== null && growth >= 150 && (rec === "ANALYTICAL_RECOMMEND_PASS" || rec === "SCREEN_OUT" || rec === "WATCH"))
    add("OBVIOUS_ANSWER_WRONG", `Headline growth of ${growth.toFixed(0)}% yet the analysis does not recommend proceeding.`);

  // Conflicting metrics: a clearly strong and a clearly weak operating metric in different families.
  const strong = concerns.filter((c) => c.severity <= 0.2 && c.concept !== "RUNWAY_FINANCING");
  const weak = concerns.filter((c) => c.severity >= 0.5);
  const pair = weak.flatMap((w) => strong.filter((s) => s.concept !== w.concept).map((s) => [s, w] as const))[0];
  if (pair) add("CONFLICTING_METRICS", `${pair[0].label} is strong (${pair[0].display}) while ${pair[1].label} is weak (${pair[1].display}).`);

  // Extraordinary founder, weak traction.
  const founderStrength = deal.founders.some((f) => f.capabilities.filter((c) => c.relevant && STRONG.has(c.rating) && c.observability !== "NOT_OBSERVABLE").length >= 2) ||
    deal.exceptionalStrengths.some((e) => e.kind === "FOUNDER_INSIGHT" && STRONG.has(e.rating));
  const revenue = val(deal, metrics, "arr") ?? val(deal, metrics, "revenue_ttm");
  const earlyTraction = ["PRE_PRODUCT", "PROTOTYPE", "PILOT", "EARLY_REVENUE"].includes(deal.classification.operationalMaturity) || (revenue !== null && revenue < 500_000);
  if (founderStrength && earlyTraction) add("EXTRAORDINARY_FOUNDER_WEAK_TRACTION", `Founder capability rated strong on observable evidence, with ${revenue !== null ? `${money(revenue)} revenue` : "little revenue"} (${deal.classification.operationalMaturity.toLowerCase().replace(/_/g, " ")}).`);

  // Good company, demanding price.
  const oqi = derived.operatingQuality?.value ?? null;
  const traj = derived.economics?.trajectory?.capitalMultiple;
  const post = derived.returns?.inputs?.entry?.postMoneyUsd ?? null;
  const entryMultiple = post && revenue ? post / revenue : null;
  if (oqi !== null && oqi >= 60 && ((traj && (traj.plausibility === "HEROIC" || traj.plausibility === "IMPLAUSIBLE")) || (entryMultiple !== null && entryMultiple >= 50)))
    add("GREAT_COMPANY_BAD_PRICE", `Operating quality ${oqi.toFixed(0)} but ${traj && (traj.plausibility === "HEROIC" || traj.plausibility === "IMPLAUSIBLE") ? `the 20× trajectory is ${traj.plausibility.toLowerCase()}` : `entry at ${entryMultiple!.toFixed(0)}× revenue`}.`);

  // Poor-looking company with an outlier signal.
  const highRisks = deal.risks.filter((r) => HIGH.has(r.severity)).length;
  const highFindings = findings.filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").length;
  const signals = outlierSignals(deal);
  if ((oqi !== null && oqi < 55) || highRisks >= 2 || highFindings >= 3) {
    if (signals.length) add("POOR_LOOKING_WITH_OUTLIER", `${highRisks} high-severity risks / ${highFindings} high integrity findings, yet: ${signals[0]!.text}`);
  }

  // Growth hiding retention.
  const nrr = val(deal, metrics, "nrr");
  const grr = val(deal, metrics, "grr");
  const logo = val(deal, metrics, "logo_retention");
  const d30 = val(deal, metrics, "d30_retention");
  const repeat = val(deal, metrics, "repeat_rate");
  const retentionShown = [nrr, grr, logo, d30, repeat].some((x) => x !== null);
  const retentionWeak = (nrr !== null && nrr < 100) || (grr !== null && grr < 85) || (logo !== null && logo < 85) || (d30 !== null && d30 < 15) || (repeat !== null && repeat < 40);
  if (growth !== null && growth >= 100 && (retentionWeak || !retentionShown))
    add("GROWTH_HIDING_RETENTION", retentionShown ? `Growth ${growth.toFixed(0)}% with weak retention (${[nrr !== null ? `NRR ${nrr.toFixed(0)}%` : null, grr !== null ? `GRR ${grr.toFixed(0)}%` : null, logo !== null ? `logo retention ${logo.toFixed(0)}%` : null, d30 !== null ? `D30 ${d30.toFixed(0)}%` : null, repeat !== null ? `repeat ${repeat.toFixed(0)}%` : null].filter(Boolean).join(", ")}).` : `Growth ${growth.toFixed(0)}% and no retention metric on the deck.`);

  // Small market that can expand.
  const samHigh = derived.market?.primary?.highUsd ?? null;
  if (samHigh !== null && samHigh < 1.5e9 && (deal.market?.expansion.length ?? 0) > 0)
    add("WEAK_MARKET_CAN_EXPAND", `Reconstructed market up to ${money(samHigh)}, with ${deal.market!.expansion.length} adjacent market${deal.market!.expansion.length > 1 ? "s" : ""} (${deal.market!.expansion[0]!.market}).`);

  if (TAM_FINDINGS.some((k) => kinds.has(k))) {
    const f = findings.find((x) => TAM_FINDINGS.includes(x.kind))!;
    add("INFLATED_TAM", f.title);
  }
  const pilotTechnique = deal.latentSignals?.presentationTechniques.some((t) => t.technique === "PILOTS_MIXED_WITH_CUSTOMERS" || t.technique === "LOGOS_WITHOUT_STATUS") ?? false;
  if (PILOT_FINDINGS.some((k) => kinds.has(k)) || pilotTechnique) add("PILOTS_AS_CUSTOMERS", findings.find((x) => PILOT_FINDINGS.includes(x.kind))?.title ?? "The deck mixes pilots or logos with paying customers.");
  const forecastTechnique = deal.latentSignals?.presentationTechniques.some((t) => t.technique === "FORECAST_DRAWN_AS_ACTUAL" || t.technique === "PIPELINE_AS_BOOKED") ?? false;
  if (FORECAST_FINDINGS.some((k) => kinds.has(k)) || forecastTechnique) add("FORECAST_AS_ACTUAL", findings.find((x) => FORECAST_FINDINGS.includes(x.kind))?.title ?? "Forward-looking figures are presented like actuals.");
  if (deal.financingPath && HIGH.has(deal.financingPath.capitalIntensity)) add("CAPITAL_INTENSIVE", `Capital intensity ${deal.financingPath.capitalIntensity.toLowerCase()}: ${deal.financingPath.proofPurchased}`);
  const founderLed = val(deal, metrics, "founder_led_revenue_share");
  if (founderLed !== null && founderLed >= 50 && derived.peerGroup.stageBand !== "EARLY") add("FOUNDER_DEPENDENT_SALES", `Founders involved in ${founderLed.toFixed(0)}% of closed revenue at ${derived.peerGroup.name}.`);
  const runway = concerns.find((c) => c.metricKey === "runway_months");
  if (runway && runway.value < 12) add("SHORT_RUNWAY", `${runway.display} of runway at current burn.`);
  const top1 = val(deal, metrics, "customer_concentration_top1");
  const top5 = val(deal, metrics, "customer_concentration_top5");
  if ((top1 !== null && top1 >= 25) || (top5 !== null && top5 >= 60)) add("CUSTOMER_CONCENTRATION", top1 !== null && top1 >= 25 ? `Largest customer ${top1.toFixed(0)}% of revenue.` : `Top five customers ${top5!.toFixed(0)}% of revenue.`);
  const strain = concerns.find((c) => (c.concept === "UNIT_ECONOMICS" || c.concept === "CAPITAL_EFFICIENCY") && c.severity >= 0.5);
  if (strain) add("UNIT_ECONOMICS_STRAIN", `${strain.label} ${strain.display}.`);
  return out;
}
