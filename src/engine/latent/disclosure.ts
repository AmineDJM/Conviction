/**
 * §10 DISCLOSURE QUALITY (never an "honesty score") — what the deck
 * voluntarily discloses that a purely promotional deck would hide, plus how
 * precisely it states its numbers.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { metricDef } from "../metrics/dictionary";
import type { MissingAsSignal } from "./missing";
import type { NarrativeInflation } from "./inflation";
import type { PrecisionDiscipline } from "./precision";
import type { LatentEvidence, LatentModule, QualityLevel } from "./types";
import { CURRENT_BASES, bases, coverage, lower, monthKey, obsUsd, pagesOf, parseDate, round } from "./util";

export interface UnflatteringTrend {
  metricKey: string;
  from: { value: number; period: string; page: number | null };
  to: { value: number; period: string; page: number | null };
  changePct: number;
  explained: string | null;
}

export interface DisclosureQuality extends LatentModule {
  level: QualityLevel;
  score: number;
  disclosuresByKind: Record<string, number>;
  unflatteringTrends: UnflatteringTrend[];
  withheldCount: number;
  materialOmissions: number;
  evidence: LatentEvidence[];
  note: string;
}

const KIND_POINTS: Record<string, number> = { LIMITATION: 1, RISK: 1, UNFLATTERING_METRIC: 1.5, PRECISE_DEFINITION: 1, OBJECTION_ADDRESSED: 1, FAILED_EXPERIMENT: 1.5 };

/** Metrics shown with two dated values where the latest moved in the unfavourable direction. */
export function unflatteringTrends(deal: CanonicalDeal): UnflatteringTrend[] {
  const byKey = new Map<string, Map<string, { value: number; period: string; page: number | null }>>();
  for (const o of deal.metricObservations ?? []) {
    if (o.metricKey === "OTHER" || !CURRENT_BASES.has(o.basis) || o.value === null || !o.periodEnd || o.state === "WITHHELD") continue;
    const def = metricDef(o.metricKey);
    if (!def || def.direction === "CONTEXTUAL") continue;
    const mk = monthKey(o.periodEnd);
    const v = obsUsd(o);
    if (!mk || v === null) continue;
    const m = byKey.get(o.metricKey) ?? new Map();
    if (!m.has(mk)) m.set(mk, { value: v, period: o.periodEnd, page: o.page });
    byKey.set(o.metricKey, m);
  }
  const expl = deal.latentSignals?.causalExplanations ?? [];
  const out: UnflatteringTrend[] = [];
  for (const [key, pts] of [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (pts.size < 2) continue;
    const sorted = [...pts.values()].sort((a, b) => (parseDate(a.period)?.getTime() ?? 0) - (parseDate(b.period)?.getTime() ?? 0));
    const prev = sorted[sorted.length - 2]!;
    const last = sorted[sorted.length - 1]!;
    const dir = metricDef(key)!.direction;
    const worse = dir === "HIGHER_IS_BETTER" ? last.value < prev.value : last.value > prev.value;
    if (!worse || prev.value === 0) continue;
    const def = metricDef(key)!;
    const names = [key, key.replace(/_/g, " "), lower(def.shortName), lower(def.name)];
    const e = expl.find((c) => !!c.explanationGiven && names.some((n) => lower(c.metric).includes(n)));
    out.push({ metricKey: key, from: prev, to: last, changePct: round(((last.value - prev.value) / Math.abs(prev.value)) * 100, 1), explained: e?.explanationGiven ?? null });
  }
  return out;
}

export function disclosureQuality(deal: CanonicalDeal, prec: PrecisionDiscipline, missing: MissingAsSignal, infl: NarrativeInflation): DisclosureQuality {
  const ls = deal.latentSignals;
  const disc = ls?.disclosures ?? [];
  const byKind: Record<string, number> = {};
  for (const d of disc) byKind[d.kind] = (byKind[d.kind] ?? 0) + 1;
  const trends = unflatteringTrends(deal);
  const evidence: LatentEvidence[] = [];

  let score = 0;
  for (const [kind, n] of Object.entries(byKind).sort()) {
    score += (KIND_POINTS[kind] ?? 1) * Math.min(2, n);
  }
  for (const d of disc) evidence.push({ basis: "MODEL_OBSERVED", text: `${d.kind}: ${d.detail}`, page: d.page });
  const trendPts = Math.min(4, trends.reduce((a, t) => a + (t.explained ? 2 : 1.5), 0));
  score += trendPts;
  for (const t of trends)
    evidence.push({
      basis: "COMPUTED",
      text: `Unflattering trend shown: ${t.metricKey} ${t.from.value} (${t.from.period}) → ${t.to.value} (${t.to.period}), ${t.changePct}%${t.explained ? `; cause given: ${t.explained}` : ""}`,
      page: t.to.page,
    });
  if (prec.score !== null) {
    score += 3 * (prec.score / 100);
    evidence.push({ basis: "COMPUTED", text: `Precision discipline ${prec.level} (${prec.score}/100)`, page: null });
  }
  if (prec.forecastSeparation.pct !== null) score += prec.forecastSeparation.pct / 100;
  const omissionPenalty = Math.min(3, missing.highCount);
  score -= omissionPenalty;
  if (omissionPenalty) evidence.push({ basis: "COMPUTED", text: `${missing.highCount} material decision metric(s) absent at this stage: ${missing.omissions.filter((o) => o.severity === "HIGH" && o.kind !== "NOT_YET_EXPECTED").map((o) => o.metric).join(", ")}`, page: null });
  const inflPenalty = infl.level === "HIGH" ? 2 : infl.level === "MODERATE" ? 1 : 0;
  score -= inflPenalty;
  score = round(score, 2);

  const hasInputs = !!ls || prec.observations > 0;
  let level: QualityLevel;
  if (!hasInputs) level = "INSUFFICIENT_EVIDENCE";
  else if (score >= 9) level = "EXCEPTIONAL";
  else if (score >= 6) level = "STRONG";
  else if (score >= 3) level = "MODERATE";
  else level = "WEAK";

  return {
    basis: bases("COMPUTED", !!ls && "MODEL_OBSERVED"),
    pages: pagesOf(evidence.map((e) => e.page)),
    coverage: coverage(
      [ls ? "model disclosures" : null, prec.observations ? "precision discipline" : null, "omission analysis", "narrative inflation"].filter((x): x is string => !!x),
      [ls ? null : "model disclosures (latentSignals)", prec.observations ? null : "metric observations"].filter((x): x is string => !!x),
    ),
    rule:
      "Score = Σ disclosure kinds (limitation, risk, precise definition, objection addressed 1; unflattering metric, failed experiment 1.5; max 2 of each) + unflattering trends shown (1.5 each, 2 with a stated cause, max 4) + 3 × precision score + forecast separation share − material (HIGH) omissions (max 3) − narrative inflation (HIGH 2, MODERATE 1). EXCEPTIONAL ≥9, STRONG ≥6, MODERATE ≥3, else WEAK.",
    level,
    score,
    disclosuresByKind: byKind,
    unflatteringTrends: trends,
    withheldCount: missing.withheld.length,
    materialOmissions: missing.highCount,
    evidence,
    note: "Disclosure quality, not honesty: a deck showing 'NRR declined from 121% to 108%; main cause is …' is more reassuring than one where the metric disappears.",
  };
}
