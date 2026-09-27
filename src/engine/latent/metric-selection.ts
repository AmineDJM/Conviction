/**
 * §3 METRIC SELECTION INTELLIGENCE — which metrics did the founder choose to
 * show, relative to the decision metrics an investor needs for this peer group?
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { PeerGroupRef } from "../scoring/peer";
import {
  DECISION_TABLE,
  STAGE_RANK,
  cohortObservations,
  keyPresence,
  matchVanity,
  matchVanityText,
  slotsMentioned,
  type DecisionSlot,
  type KeyPresence,
  type PresenceStatus,
} from "./decision-metrics";
import type { LatentBasis, LatentModule, RiskLevel } from "./types";
import { bases, coverage, dedupeObservations, isQuantitative, norm, pagesOf, pct } from "./util";
import type { StageBand } from "../benchmarks/types";

export type SlotStatus = "PRESENT" | "STALE" | "WITHHELD" | "ABSENT" | "FORWARD_ONLY" | "NOT_YET_EXPECTED" | "NOT_APPLICABLE";

export interface SlotAssessment {
  slotId: string;
  label: string;
  family: DecisionSlot["family"];
  keys: string[];
  expectedFrom: StageBand;
  /** Counted in the coverage denominator. */
  expected: boolean;
  status: SlotStatus;
  /** Which metric satisfied the slot, as shown. */
  satisfiedBy: string | null;
  pages: number[];
  why: string;
}

export interface VanityItem {
  id: string;
  pattern: string | null;
  metric: string;
  page: number | null;
  sources: LatentBasis[];
  /** Expected decision metrics that are absent and that this vanity metric typically stands in for. */
  substitutesForAbsent: string[];
}

export interface MetricSelection extends LatentModule {
  peerGroup: string;
  /** Decision-Relevant Metric Coverage: present expected decision metrics / expected decision metrics (0–100). */
  decisionCoveragePct: number | null;
  expectedCount: number;
  presentCount: number;
  slots: SlotAssessment[];
  presentDecisionMetrics: string[];
  absentDecisionMetrics: string[];
  vanityDependence: RiskLevel;
  /** Vanity observations / quantitative observations shown (0–100). */
  vanitySharePct: number | null;
  quantitativeObservations: number;
  vanityMetrics: VanityItem[];
  /** Vanity metrics shown where the decision metric they stand in for is absent. */
  vanityInPlaceOfDecision: { vanity: string; absentDecisionMetric: string; page: number | null }[];
}

export function isPreRevenue(deal: CanonicalDeal): boolean {
  const c = deal.classification;
  return (c?.revenueModel ?? []).includes("PRE_REVENUE") || c?.operationalMaturity === "PRE_PRODUCT" || c?.operationalMaturity === "PROTOTYPE";
}

export function assessSlots(deal: CanonicalDeal, peer: PeerGroupRef, presence: Map<string, KeyPresence>): SlotAssessment[] {
  const band = STAGE_RANK[peer.stageBand] ?? 0;
  const preRevenue = isPreRevenue(deal);
  const cohorts = cohortObservations(deal.metricObservations ?? []);
  const rows = DECISION_TABLE[peer.profile] ?? DECISION_TABLE.GENERAL;
  return rows.map(({ slot, from }) => {
    const statuses = slot.keys.map((k) => presence.get(k)).filter((p): p is KeyPresence => !!p);
    const best = (s: PresenceStatus) => statuses.find((p) => p.status === s);
    let status: SlotStatus = "ABSENT";
    let hit: KeyPresence | undefined;
    for (const s of ["PRESENT", "STALE", "WITHHELD", "NOT_APPLICABLE", "FORWARD_ONLY"] as const) {
      hit = best(s);
      if (hit) {
        status = s;
        break;
      }
    }
    let satisfiedBy = hit && (status === "PRESENT" || status === "STALE") ? `${hit.key}${hit.shownAs ? ` (${hit.shownAs})` : ""}` : null;
    let pages = hit?.pages ?? [];
    if (status !== "PRESENT" && slot.cohortEvidence && cohorts.length) {
      status = "PRESENT";
      satisfiedBy = `cohort data: ${cohorts[0]!.label}`;
      pages = pagesOf(cohorts.map((c) => c.page));
    }
    const notYetMeaningful = !!slot.requiresRevenue && preRevenue;
    const expected = STAGE_RANK[from] <= band && !notYetMeaningful && status !== "NOT_APPLICABLE";
    if (!expected && status === "ABSENT") status = notYetMeaningful ? "NOT_APPLICABLE" : "NOT_YET_EXPECTED";
    return { slotId: slot.id, label: slot.label, family: slot.family, keys: [...slot.keys], expectedFrom: from, expected, status, satisfiedBy, pages, why: slot.why };
  });
}

export function metricSelection(deal: CanonicalDeal, peer: PeerGroupRef, asOf: Date): MetricSelection {
  const presence = keyPresence(deal, asOf);
  const slots = assessSlots(deal, peer, presence);
  const expected = slots.filter((s) => s.expected);
  const present = expected.filter((s) => s.status === "PRESENT");
  const absent = expected.filter((s) => s.status !== "PRESENT");
  const absentIds = new Set(absent.map((s) => s.slotId));
  const catalog = (DECISION_TABLE[peer.profile] ?? DECISION_TABLE.GENERAL).map((r) => r.slot);

  // Vanity: computed from observations, merged with the model's list.
  const obs = dedupeObservations(deal.metricObservations ?? []).filter(isQuantitative);
  const vanity: VanityItem[] = [];
  const byPattern = new Map<string, VanityItem>();
  let vanityObs = 0;
  const add = (patternId: string | null, label: string, metric: string, page: number | null, basis: LatentBasis, displaces: string[]) => {
    const key = patternId ?? `MODEL:${norm(metric)}`;
    const existing = byPattern.get(key);
    const subs = displaces.filter((d) => absentIds.has(d)).map((d) => slots.find((s) => s.slotId === d)!.label);
    if (existing) {
      existing.sources = bases(...existing.sources, basis);
      existing.substitutesForAbsent = [...new Set([...existing.substitutesForAbsent, ...subs])];
      if (existing.page === null) existing.page = page;
      return existing;
    }
    const item: VanityItem = { id: `VAN-${String(vanity.length + 1).padStart(2, "0")}`, pattern: patternId ? label : null, metric, page, sources: [basis], substitutesForAbsent: [...new Set(subs)] };
    vanity.push(item);
    byPattern.set(key, item);
    return item;
  };
  for (const o of obs) {
    const v = matchVanity(o);
    if (!v) continue;
    vanityObs++;
    add(v.id, v.label, `${o.label}: ${o.rawText}`, o.page, "COMPUTED", v.displaces);
  }
  let modelOnly = 0;
  for (const m of deal.latentSignals?.vanityMetricsShown ?? []) {
    const v = matchVanityText(m.metric);
    const mentioned = slotsMentioned(m.decisionMetricItDisplaces, catalog).map((s) => s.id);
    const displaces = [...new Set([...(v?.displaces ?? []), ...mentioned])];
    const had = byPattern.has(v?.id ?? `MODEL:${norm(m.metric)}`);
    add(v?.id ?? null, v?.label ?? m.metric, m.metric, m.page, "MODEL_OBSERVED", displaces);
    if (!had) modelOnly++;
  }

  const denominator = Math.max(obs.length, vanityObs + modelOnly);
  const numerator = vanityObs + modelOnly;
  const share = pct(numerator, denominator);
  const inPlace = vanity.flatMap((v) => v.substitutesForAbsent.map((a) => ({ vanity: v.metric, absentDecisionMetric: a, page: v.page })));
  const displacingItems = vanity.filter((v) => v.substitutesForAbsent.length > 0).length;

  let vanityDependence: RiskLevel;
  if (denominator === 0) vanityDependence = "INSUFFICIENT_EVIDENCE";
  else if ((share ?? 0) >= 35 || displacingItems >= 2) vanityDependence = "HIGH";
  else if ((share ?? 0) >= 15 || displacingItems >= 1) vanityDependence = "MODERATE";
  else vanityDependence = "LOW";

  const available = [obs.length ? "metric observations" : null, deal.metrics?.length ? "normalized metrics" : null, deal.latentSignals ? "model vanity list" : null].filter((x): x is string => !!x);
  const missing = [obs.length ? null : "metric observations", deal.latentSignals ? null : "model vanity list (latentSignals)"].filter((x): x is string => !!x);

  return {
    basis: bases("COMPUTED", vanity.some((v) => v.sources.includes("MODEL_OBSERVED")) && "MODEL_OBSERVED"),
    pages: pagesOf([...present.flatMap((s) => s.pages), ...vanity.map((v) => v.page)]),
    coverage: coverage(available, missing, expected.length ? null : "No decision metric is expected for this peer group and stage."),
    rule:
      "Decision-Relevant Metric Coverage = expected decision metrics shown as current values / decision metrics expected for the peer group (profile × stage band; revenue metrics are not expected pre-revenue). " +
      "Vanity Metric Dependence: HIGH if ≥35% of quantitative observations are vanity metrics or ≥2 vanity metrics stand in for absent expected decision metrics; MODERATE if ≥15% or 1 such substitution; else LOW.",
    peerGroup: peer.name,
    decisionCoveragePct: pct(present.length, expected.length),
    expectedCount: expected.length,
    presentCount: present.length,
    slots,
    presentDecisionMetrics: present.map((s) => s.label),
    absentDecisionMetrics: absent.map((s) => s.label),
    vanityDependence,
    vanitySharePct: share,
    quantitativeObservations: obs.length,
    vanityMetrics: vanity,
    vanityInPlaceOfDecision: inPlace,
  };
}
