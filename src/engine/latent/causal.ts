/**
 * §7 CAUSAL BUSINESS UNDERSTANDING — does the deck decompose its numbers
 * (ARR bridge, cohorts, churn reasons, win/loss, explanations of movements)?
 * Based on the data available in the deck only.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import { cohortObservations } from "./decision-metrics";
import type { LatentEvidence, LatentModule, QualityLevel } from "./types";
import { BRIDGE_KEYS, CURRENT_BASES, bases, coverage, fmtUsd, monthKey, obsUsd, pageFromLocation, pagesOf, parseDate, pct, round } from "./util";

export type BridgeStatus = "RECONCILES" | "DOES_NOT_RECONCILE" | "INCOMPLETE" | "ABSENT";

export interface ArrBridge {
  status: BridgeStatus;
  period: { start: string | null; end: string | null } | null;
  newArr: number | null;
  expansionArr: number | null;
  churnedArr: number | null;
  netNewArr: number | null;
  /** new + expansion − churned. */
  computedNet: number | null;
  /** |computed − stated net| / |stated net|. */
  netGapPct: number | null;
  /** Check against the change between two ARR points, when available. */
  arrDeltaCheck: { startArr: number; endArr: number; delta: number; gapPct: number; reconciles: boolean; assumption: string } | null;
  pages: number[];
  detail: string;
}

export interface CausalUnderstanding extends LatentModule {
  level: QualityLevel;
  score: number | null;
  bridge: ArrBridge;
  cohortsDisclosed: boolean;
  churnReasons: string;
  winLoss: string;
  explainedMovements: { metric: string; explained: boolean; page: number | null }[];
  explainedPct: number | null;
  evidence: LatentEvidence[];
  scope: string;
}

type Pt = { key: string; value: number; start: string | null; end: string | null; page: number | null };

function bridgePoints(deal: CanonicalDeal): Pt[] {
  const fromObs = (deal.metricObservations ?? [])
    .filter((o) => (BRIDGE_KEYS as readonly string[]).includes(o.metricKey) && CURRENT_BASES.has(o.basis) && o.value !== null && o.state !== "WITHHELD")
    .map((o: MetricObservation) => ({ key: o.metricKey, value: obsUsd(o) ?? o.value!, start: o.periodStart, end: o.periodEnd, page: o.page }));
  if (fromObs.length) return fromObs;
  return (deal.metrics ?? [])
    .filter((m) => (BRIDGE_KEYS as readonly string[]).includes(m.metricKey) && m.normalizedValue !== null)
    .map((m) => ({ key: m.metricKey, value: m.normalizedValue!, start: m.periodStart, end: m.periodEnd, page: pageFromLocation(m.location) }));
}

function arrPoints(deal: CanonicalDeal): { value: number; end: string; page: number | null }[] {
  const pts = new Map<string, { value: number; end: string; page: number | null }>();
  for (const o of deal.metricObservations ?? []) {
    if (o.metricKey !== "arr" || !CURRENT_BASES.has(o.basis) || o.value === null || !o.periodEnd) continue;
    const mk = monthKey(o.periodEnd);
    const v = obsUsd(o);
    if (mk && v !== null && !pts.has(mk)) pts.set(mk, { value: v, end: o.periodEnd, page: o.page });
  }
  if (!pts.size)
    for (const m of deal.metrics ?? []) {
      if (m.metricKey !== "arr" || m.normalizedValue === null || !m.periodEnd || !CURRENT_BASES.has(m.basis)) continue;
      const mk = monthKey(m.periodEnd);
      if (mk && !pts.has(mk)) pts.set(mk, { value: m.normalizedValue, end: m.periodEnd, page: pageFromLocation(m.location) });
    }
  return [...pts.values()].sort((a, b) => (parseDate(a.end)?.getTime() ?? 0) - (parseDate(b.end)?.getTime() ?? 0));
}

export function arrBridge(deal: CanonicalDeal, tolerance = 0.05): ArrBridge {
  const pts = bridgePoints(deal);
  const empty: ArrBridge = { status: "ABSENT", period: null, newArr: null, expansionArr: null, churnedArr: null, netNewArr: null, computedNet: null, netGapPct: null, arrDeltaCheck: null, pages: [], detail: "No ARR bridge (new / expansion / churned / net new ARR) in the deck." };
  if (!pts.length) return empty;
  // Group by period; use the most recent group with the most components.
  const groups = new Map<string, Pt[]>();
  for (const p of pts) {
    const k = `${monthKey(p.start) ?? ""}|${monthKey(p.end) ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const ranked = [...groups.entries()].sort((a, b) => {
    const ca = new Set(a[1].map((p) => p.key)).size;
    const cb = new Set(b[1].map((p) => p.key)).size;
    if (cb !== ca) return cb - ca;
    return b[0].localeCompare(a[0]);
  });
  const group = ranked[0]![1];
  const get = (k: string) => group.find((p) => p.key === k)?.value ?? null;
  const newArr = get("new_arr");
  const expansionArr = get("expansion_arr");
  const churnedRaw = get("churned_arr");
  const churnedArr = churnedRaw === null ? null : Math.abs(churnedRaw);
  const netNewArr = get("net_new_arr");
  const period = { start: group[0]!.start, end: group[0]!.end };
  const pages = pagesOf(group.map((p) => p.page));
  const components = [newArr, expansionArr, churnedArr].filter((x) => x !== null).length;
  const computedNet = newArr !== null ? newArr + (expansionArr ?? 0) - (churnedArr ?? 0) : null;

  let netGapPct: number | null = null;
  let status: BridgeStatus;
  let detail: string;
  const net = netNewArr ?? computedNet;
  if (newArr !== null && netNewArr !== null && (expansionArr !== null || churnedArr !== null)) {
    netGapPct = netNewArr !== 0 ? round((Math.abs(computedNet! - netNewArr) / Math.abs(netNewArr)) * 100, 1) : computedNet === 0 ? 0 : 100;
    status = netGapPct <= tolerance * 100 ? "RECONCILES" : "DOES_NOT_RECONCILE";
    detail = `New ${fmtUsd(newArr)} + expansion ${fmtUsd(expansionArr ?? 0)} − churned ${fmtUsd(churnedArr ?? 0)} = ${fmtUsd(computedNet)} vs stated net new ${fmtUsd(netNewArr)} (gap ${netGapPct}%, tolerance ${tolerance * 100}%).`;
  } else {
    status = "INCOMPLETE";
    detail = `Partial bridge: ${components} of 3 components${netNewArr !== null ? " plus net new ARR" : ""} shown — cannot be reconciled.`;
  }

  // ARR delta check.
  let arrDeltaCheck: ArrBridge["arrDeltaCheck"] = null;
  const arr = arrPoints(deal);
  if (net !== null && arr.length >= 2) {
    const sKey = monthKey(period.start);
    const eKey = monthKey(period.end);
    let startPt = sKey ? arr.find((a) => monthKey(a.end) === sKey) : undefined;
    let endPt = eKey ? arr.find((a) => monthKey(a.end) === eKey) : undefined;
    let assumption = "ARR points match the bridge period start and end.";
    if (!startPt || !endPt) {
      startPt = arr[arr.length - 2];
      endPt = arr[arr.length - 1];
      assumption = "Assumes the bridge covers the interval between the two most recent ARR points.";
    }
    if (startPt && endPt && startPt !== endPt) {
      const delta = endPt.value - startPt.value;
      const gapPct = net !== 0 ? round((Math.abs(delta - net) / Math.abs(net)) * 100, 1) : delta === 0 ? 0 : 100;
      arrDeltaCheck = { startArr: startPt.value, endArr: endPt.value, delta, gapPct, reconciles: gapPct <= tolerance * 100, assumption };
      detail += ` ARR moved ${fmtUsd(startPt.value)} → ${fmtUsd(endPt.value)} (Δ ${fmtUsd(delta)}) vs bridge net ${fmtUsd(net)}: gap ${gapPct}%.`;
      if (status === "RECONCILES" && !arrDeltaCheck.reconciles) status = "DOES_NOT_RECONCILE";
      if (status === "INCOMPLETE" && newArr !== null && arrDeltaCheck.reconciles && components >= 2) status = "RECONCILES";
    }
  }
  return { status, period, newArr, expansionArr, churnedArr, netNewArr, computedNet, netGapPct, arrDeltaCheck, pages, detail };
}

const BRIDGE_POINTS: Record<BridgeStatus, number> = { RECONCILES: 3, INCOMPLETE: 1.5, DOES_NOT_RECONCILE: 0.5, ABSENT: 0 };
const STATUS_POINTS: Record<string, number> = { DEMONSTRATED: 2, PARTIAL: 1, NOT_SHOWN: 0, CONTRADICTED: 0 };

export function causalUnderstanding(deal: CanonicalDeal): CausalUnderstanding {
  const ls = deal.latentSignals;
  const bridge = arrBridge(deal);
  const cohorts = cohortObservations(deal.metricObservations ?? []);
  const cohortsDisclosed = cohorts.length > 0;
  const om = ls?.operatingMaturity ?? [];
  const pick = (id: string) => om.filter((e) => e.signal === id).sort((a, b) => (STATUS_POINTS[a.status] ?? 0) - (STATUS_POINTS[b.status] ?? 0))[0] ?? null;
  const churn = pick("CHURN_REASONS_KNOWN");
  const winLoss = pick("WIN_LOSS_UNDERSTANDING");
  const expl = ls?.causalExplanations ?? [];
  const explainedMovements = expl.map((c) => ({ metric: c.metric, explained: !!c.explanationGiven?.trim(), page: c.page }));
  const explainedPct = pct(explainedMovements.filter((e) => e.explained).length, explainedMovements.length);

  let points = BRIDGE_POINTS[bridge.status] + (cohortsDisclosed ? 2 : 0);
  let max = 5;
  if (churn) {
    points += STATUS_POINTS[churn.status] ?? 0;
    max += 2;
  }
  if (winLoss) {
    points += STATUS_POINTS[winLoss.status] ?? 0;
    max += 2;
  }
  if (expl.length) {
    points += 3 * (explainedPct! / 100);
    max += 3;
  }
  const hasData = (deal.metricObservations?.length ?? 0) > 0 || (deal.metrics?.length ?? 0) > 0 || !!ls;
  const score = hasData ? round(points / max, 3) : null;
  let level: QualityLevel;
  if (score === null) level = "INSUFFICIENT_EVIDENCE";
  else if (score >= 0.75) level = "EXCEPTIONAL";
  else if (score >= 0.5) level = "STRONG";
  else if (score >= 0.25) level = "MODERATE";
  else level = "WEAK";

  const evidence: LatentEvidence[] = [
    { basis: "COMPUTED", text: `ARR bridge: ${bridge.status}. ${bridge.detail}`, page: bridge.pages[0] ?? null },
    { basis: "COMPUTED", text: cohortsDisclosed ? `Cohort data shown: ${cohorts.map((c) => c.label).slice(0, 3).join(", ")}` : "No cohort data shown", page: cohorts[0]?.page ?? null },
    ...(churn ? [{ basis: "MODEL_OBSERVED" as const, text: `Churn reasons ${churn.status}: ${churn.evidence}`, page: churn.page }] : []),
    ...(winLoss ? [{ basis: "MODEL_OBSERVED" as const, text: `Win/loss ${winLoss.status}: ${winLoss.evidence}`, page: winLoss.page }] : []),
    ...expl.filter((c) => c.explanationGiven).map((c) => ({ basis: "MODEL_OBSERVED" as const, text: `${c.metric}: ${c.explanationGiven}`, page: c.page })),
  ];
  return {
    basis: bases("COMPUTED", !!ls && "MODEL_OBSERVED"),
    pages: pagesOf([...bridge.pages, ...cohorts.map((c) => c.page), churn?.page, winLoss?.page, ...expl.map((c) => c.page)]),
    coverage: coverage(
      ["ARR bridge check", "cohort check", churn ? "churn reasons" : null, winLoss ? "win/loss" : null, expl.length ? "causal explanations" : null].filter((x): x is string => !!x),
      [churn ? null : "churn reasons (model)", winLoss ? null : "win/loss (model)", expl.length ? null : "causal explanations (model)"].filter((x): x is string => !!x),
      "Based on the data available in the deck.",
    ),
    rule:
      "Points: ARR bridge reconciles 3 / incomplete 1.5 / does not reconcile 0.5 / absent 0 (net = new + expansion − churned within 5%, and ARR delta when two ARR points exist); cohorts 2; churn reasons and win/loss DEMONSTRATED 2 / PARTIAL 1; explained movements 3 × share. Score = points / max of assessed components. EXCEPTIONAL ≥0.75, STRONG ≥0.50, MODERATE ≥0.25, else WEAK.",
    level,
    score,
    bridge,
    cohortsDisclosed,
    churnReasons: churn ? `${churn.status}: ${churn.evidence}` : "Not assessed",
    winLoss: winLoss ? `${winLoss.status}: ${winLoss.evidence}` : "Not assessed",
    explainedMovements,
    explainedPct,
    evidence,
    scope: "Based on the data available in the deck.",
  };
}
