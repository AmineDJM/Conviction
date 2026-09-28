/**
 * "WHAT CHANGED AFTER THE MEETING?" — deterministic.
 *
 * Before / After are computed by code from the two stored versions (the frozen
 * PRE_MEETING_ANALYSIS and POST_MEETING_ANALYSIS_Vn): recommendation, scores,
 * rubric ratings, founder capabilities, thesis conditions, risks, primary
 * metrics, claims, questions, gaps and evidence quality. The "Founder said" and
 * "Reason" columns are joined from the post-meeting extraction by stable key
 * and carry transcript refs. Nothing here is generated prose about the scores.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import type { MeetingGuard } from "@/orchestration/assemble";
import type { DimensionChange, TranscriptRefView, TranscriptSegment } from "@/domain/meetings";
import { resolveRefs } from "@/ingestion/transcript";
import { DECISION_LABEL, metricValue } from "@/lib/format";
import { metricDef } from "@/engine/metrics/dictionary";
import { enumLabel } from "./text";
import { normName } from "@/server/ids";

export interface DiffSide {
  canonical: CanonicalDeal;
  derived: DerivedAnalysis;
}

export interface MeetingDiffContext {
  extraction?: FounderCallOutput | null;
  segments?: TranscriptSegment[];
  guards?: MeetingGuard[];
}

const RUBRIC_AREA: Record<string, string> = {
  FOUNDER_MARKET_FIT: "Founders",
  EXECUTION_EVIDENCE: "Founders",
  TEAM_COMPLETENESS: "Founders",
  PAIN_SEVERITY: "Product",
  VALUE_QUANTIFIED: "Product",
  PRODUCT_DIFFERENTIATION: "Product",
  VALUE_CAPTURE: "Market",
  MARKET_GROWTH: "Market",
  WEDGE_QUALITY: "Market",
  PMF_SIGNAL_QUALITY: "PMF",
  ICP_CLARITY: "GTM",
  SALES_MOTION_FIT: "GTM",
  CHANNEL_SCALABILITY: "GTM",
  PRICING_POWER: "Economics",
  MOAT_CURRENT: "Moat",
  MOAT_TRAJECTORY: "Moat",
  TIMING_CATALYST: "Why now",
  INFLECTION_EVIDENCE: "Traction",
};

const RISK_AREA: Record<string, string> = {
  TECHNICAL: "Product",
  PRODUCT: "Product",
  MARKET: "Market",
  GTM: "GTM",
  CUSTOMER: "Traction",
  COMPETITION: "Competition",
  REGULATORY: "Risks",
  LEGAL_IP: "Risks",
  FINANCING: "Financing",
  EXECUTION: "Founders",
  KEY_PERSON: "Founders",
};

const METRIC_AREA = (key: string) =>
  /cac|payback|ltv|margin|burn|runway|acv|arpu|pricing|magic/.test(key) ? "Economics" : /nrr|grr|churn|retention|cohort/.test(key) ? "PMF" : /pipeline|win_rate|sales_cycle|quota/.test(key) ? "GTM" : "Traction";

/** Coarse reading of an anchored rating: what a partner means by "unknown → concern". */
export function ratingLevel(r: string | null | undefined): string | null {
  switch (r) {
    case "INSUFFICIENT_EVIDENCE":
      return "UNKNOWN";
    case "WEAK":
    case "BELOW_BAR":
      return "CONCERN";
    case "ADEQUATE":
      return "ADEQUATE";
    case "STRONG":
    case "EXCEPTIONAL":
      return "STRENGTH";
    default:
      return null;
  }
}

function conditionLevel(s: string | null | undefined): string | null {
  return s === "HYPOTHETICAL" ? "UNKNOWN" : s === "CONTRADICTED" ? "CONCERN" : s === "PARTIALLY_SUPPORTED" ? "ADEQUATE" : s === "SUPPORTED" ? "STRENGTH" : null;
}

const LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];

function rowOf(p: Omit<DimensionChange, "founderSaid" | "reason" | "refs" | "guard" | "beforeLevel" | "afterLevel"> & Partial<Pick<DimensionChange, "founderSaid" | "reason" | "refs" | "guard" | "beforeLevel" | "afterLevel">>): DimensionChange {
  return { founderSaid: null, reason: null, refs: [], guard: null, beforeLevel: null, afterLevel: null, ...p };
}

export function meetingDiff(before: DiffSide, after: DiffSide, ctx: MeetingDiffContext = {}): DimensionChange[] {
  const out = ctx.extraction ?? null;
  const segs = ctx.segments ?? [];
  const refs = (r: string[] | undefined, excerpt?: string | null): TranscriptRefView[] => (segs.length ? resolveRefs(segs, r, excerpt) : []);
  const guard = (key: string) => {
    const g = ctx.guards?.find((x) => x.key === key);
    return g ? `Proposed ${enumLabel(g.proposed)}; applied ${enumLabel(g.applied)} — ${g.note}` : null;
  };
  const rows: DimensionChange[] = [];
  const a = before.canonical;
  const b = after.canonical;
  const da = before.derived;
  const db = after.derived;

  /* ---------- Recommendation ---------- */
  if (da.recommendation.status !== db.recommendation.status)
    rows.push(
      rowOf({
        group: "RECOMMENDATION",
        key: "RECOMMENDATION",
        area: "Recommendation",
        dimension: "Recommendation (gate-admitted)",
        before: DECISION_LABEL[da.recommendation.status] ?? da.recommendation.status,
        after: DECISION_LABEL[db.recommendation.status] ?? db.recommendation.status,
        material: true,
        reason: out?.recommendation.rationale ?? null,
      }),
    );

  /* ---------- Rubric ratings ---------- */
  const rubricKeys = [...new Set([...a.rubric.map((r) => r.criterion), ...b.rubric.map((r) => r.criterion)])];
  for (const k of rubricKeys) {
    const x = a.rubric.find((r) => r.criterion === k)?.rating ?? null;
    const y = b.rubric.find((r) => r.criterion === k)?.rating ?? null;
    if (x === y) continue;
    const u = out?.rubricUpdates?.find((r) => r.criterion === k);
    rows.push(
      rowOf({
        group: "RUBRIC",
        key: `RUBRIC:${k}`,
        area: RUBRIC_AREA[k] ?? "Thesis",
        dimension: enumLabel(k),
        before: x ? enumLabel(x) : "Not rated",
        after: y ? enumLabel(y) : "Not rated",
        beforeLevel: ratingLevel(x) ?? "UNKNOWN",
        afterLevel: ratingLevel(y) ?? "UNKNOWN",
        material: true,
        founderSaid: u?.founderSaid ?? null,
        reason: u?.reason ?? null,
        refs: refs(u?.transcriptRefs),
        guard: guard(`RUBRIC:${k}`),
      }),
    );
  }

  /* ---------- Founder capabilities ---------- */
  for (const f of b.founders) {
    const pf = a.founders.find((x) => x.id === f.id) ?? a.founders.find((x) => normName(x.name) === normName(f.name));
    for (const cap of f.capabilities) {
      const prev = pf?.capabilities.find((x) => x.dimension === cap.dimension);
      if (prev && prev.rating === cap.rating && prev.observability === cap.observability) continue;
      if (!prev && !out) continue;
      const u = out?.capabilityUpdates?.find((x) => x.dimension === cap.dimension && normName(x.founderName) === normName(f.name));
      rows.push(
        rowOf({
          group: "FOUNDER",
          key: `FOUNDER:${f.id}:${cap.dimension}`,
          area: "Founders",
          dimension: `${f.name} · ${enumLabel(cap.dimension)}`,
          before: prev ? `${enumLabel(prev.rating)} (${enumLabel(prev.observability).toLowerCase()})` : "Not assessed",
          after: `${enumLabel(cap.rating)} (${enumLabel(cap.observability).toLowerCase()})`,
          beforeLevel: ratingLevel(prev?.rating) ?? "UNKNOWN",
          afterLevel: ratingLevel(cap.rating),
          material: !prev || prev.rating !== cap.rating,
          founderSaid: u?.founderSaid ?? null,
          reason: u?.reason ?? null,
          refs: refs(u?.transcriptRefs),
          guard: guard(`FOUNDER:${f.id}:${cap.dimension}`),
        }),
      );
    }
  }

  /* ---------- Thesis conditions ---------- */
  const ca = a.thesis?.requiredConditions ?? [];
  const cb = b.thesis?.requiredConditions ?? [];
  cb.forEach((cond, i) => {
    const prev = ca[i];
    if (prev && prev.condition === cond.condition && prev.status === cond.status) return;
    const u = out?.conditionUpdates?.find((x) => x.conditionIndex === i);
    rows.push(
      rowOf({
        group: "THESIS",
        key: `CONDITION:${i}`,
        area: "Thesis",
        dimension: `Condition: ${cond.condition}`,
        before: prev ? enumLabel(prev.status) : "—",
        after: enumLabel(cond.status),
        beforeLevel: conditionLevel(prev?.status),
        afterLevel: conditionLevel(cond.status),
        material: true,
        founderSaid: u?.founderSaid ?? null,
        reason: u?.reason ?? null,
        refs: refs(u?.transcriptRefs),
        guard: guard(`CONDITION:${i}`),
      }),
    );
  });

  /* ---------- Risks ---------- */
  for (const r of b.risks) {
    const prev = a.risks.find((x) => x.id === r.id);
    const u = out?.riskUpdates?.find((x) => x.riskId === r.id) ?? (!prev ? out?.riskUpdates?.find((x) => !x.riskId && normName(x.title) === normName(r.title)) : undefined);
    const fmt = (x: typeof r) => `${enumLabel(x.severity)} severity · ${enumLabel(x.likelihood).toLowerCase()} likelihood${x.weaknessClass === "THESIS_KILLING" ? " · thesis-killing" : x.weaknessClass === "STRUCTURAL" ? " · structural" : ""}`;
    if (prev && prev.severity === r.severity && prev.likelihood === r.likelihood && prev.weaknessClass === r.weaknessClass) continue;
    rows.push(
      rowOf({
        group: "RISK",
        key: r.id,
        area: RISK_AREA[r.category] ?? "Risks",
        dimension: `${prev ? "" : "New risk: "}${r.title}`,
        before: prev ? fmt(prev) : "Not identified",
        after: fmt(r),
        material: prev ? true : LEVELS.indexOf(r.severity) >= 2 || r.weaknessClass !== "REPAIRABLE",
        founderSaid: u?.founderSaid ?? null,
        reason: u?.reason ?? null,
        refs: refs(u?.transcriptRefs),
        guard: guard(r.id),
      }),
    );
  }

  /* ---------- Primary metrics ---------- */
  const pa = new Map(a.metrics.filter((m) => m.isPrimary).map((m) => [m.metricKey, m]));
  const pb = new Map(b.metrics.filter((m) => m.isPrimary).map((m) => [m.metricKey, m]));
  for (const key of new Set([...pa.keys(), ...pb.keys()])) {
    const x = pa.get(key);
    const y = pb.get(key);
    const name = metricDef(key)?.shortName ?? y?.label ?? x?.label ?? key;
    const newFlags = y ? y.qualityFlags.filter((f) => !(x?.id === y.id ? x.qualityFlags : []).includes(f) && /IN_MEETING$/.test(f)) : [];
    // A clarified or contradicted deck metric stays primary with the same value: report the flag, not a value change.
    const sameValue = x && y && x.normalizedValue === y.normalizedValue && x.state === y.state;
    if (sameValue && !newFlags.length) continue;
    const clar = out?.metricClarifications?.find((c) => c.metricId === y?.id || c.metricId === x?.id);
    const contra = out?.contradictions?.find((c) => c.targetId === y?.id || c.targetId === x?.id);
    const stated = out?.newMetrics?.find((o) => o.metricKey === key);
    const fmt = (m: typeof x) => (m ? `${metricValue(m.unit, m.normalizedValue)}${m.definitionUsed ? ` (${m.definitionUsed})` : ""}` : "Not reported");
    rows.push(
      rowOf({
        group: "METRIC",
        key: `METRIC:${key}`,
        area: METRIC_AREA(key),
        dimension: name,
        before: fmt(x),
        after: sameValue ? `${fmt(y)} · ${newFlags.map((f) => (f.startsWith("DEFINITION") ? "definition clarified" : "contradicted in meeting")).join(", ")}` : fmt(y),
        material: !sameValue || newFlags.includes("CONTRADICTED_IN_MEETING"),
        founderSaid: clar?.clarifiedDefinition ?? contra?.statement ?? stated?.excerpt ?? null,
        reason: clar?.implication ?? (contra ? `Conflicts with ${contra.priorStatement}` : stated ? "Stated in the meeting (company-reported)" : null),
        refs: refs(clar?.transcriptRefs ?? contra?.transcriptRefs, clar?.transcriptExcerpt ?? contra?.transcriptExcerpt ?? stated?.excerpt),
      }),
    );
  }

  /* ---------- Claims: verification and contradictions ---------- */
  const claimsA = new Map(a.claims.map((c) => [c.id, c]));
  for (const cl of b.claims) {
    const prev = claimsA.get(cl.id);
    if (!prev) continue;
    const newContra = cl.contradictions.length > prev.contradictions.length;
    if (prev.verification === cl.verification && !newContra) continue;
    const u = out?.claimUpdates?.find((x) => x.claimId === cl.id) ?? undefined;
    const c2 = out?.contradictions?.find((x) => x.targetId === cl.id);
    rows.push(
      rowOf({
        group: "CLAIM",
        key: cl.id,
        area: "Evidence",
        dimension: cl.statement,
        before: `${enumLabel(prev.verification)}${prev.contradictions.length ? ` · ${prev.contradictions.length} contradiction(s)` : ""}`,
        after: `${enumLabel(cl.verification)}${newContra ? " · contradicted by founder statement" : ""}`,
        material: cl.material,
        founderSaid: u?.founderSaid ?? c2?.statement ?? null,
        reason: u?.note ?? (c2 ? `Conflicts with ${c2.priorStatement}` : null),
        refs: refs(u?.transcriptRefs ?? c2?.transcriptRefs, u?.transcriptExcerpt ?? c2?.transcriptExcerpt),
      }),
    );
  }

  /* ---------- Questions and gaps (unknowns stay visible) ---------- */
  const qa = new Map(a.questions.map((q) => [q.id, q]));
  for (const q of b.questions) {
    const prev = qa.get(q.id);
    if (!prev || prev.status === q.status) continue;
    const u = out?.questionUpdates?.find((x) => x.questionId === q.id);
    rows.push(
      rowOf({
        group: "QUESTION",
        key: q.id,
        area: "Unknowns",
        dimension: q.question,
        before: enumLabel(prev.status),
        after: enumLabel(q.status),
        material: q.tier === "MUST_ASK",
        founderSaid: u?.answerSummary ?? q.answer,
        reason: u?.implication ?? null,
        refs: refs(u?.transcriptRefs, u?.transcriptExcerpt),
      }),
    );
  }
  const ga = new Map(a.informationGaps.map((g) => [g.id, g]));
  for (const g of b.informationGaps) {
    const prev = ga.get(g.id);
    if (!prev || prev.status === g.status) continue;
    const u = out?.gapUpdates?.find((x) => x.gapId === g.id);
    rows.push(
      rowOf({
        group: "GAP",
        key: g.id,
        area: "Unknowns",
        dimension: g.question,
        before: enumLabel(prev.status),
        after: enumLabel(g.status),
        material: g.decisionImportance >= 4,
        founderSaid: u?.note ?? null,
        reason: null,
        refs: refs(u?.transcriptRefs),
      }),
    );
  }
  const openA = a.questions.filter((q) => q.status !== "RESOLVED").length + a.informationGaps.filter((g) => g.status === "OPEN" || g.status === "NEEDS_FOUNDER").length;
  const openB = b.questions.filter((q) => q.status !== "RESOLVED").length + b.informationGaps.filter((g) => g.status === "OPEN" || g.status === "NEEDS_FOUNDER").length;
  if (openA !== openB)
    rows.push(rowOf({ group: "GAP", key: "UNKNOWNS", area: "Unknowns", dimension: "Open questions and information gaps", before: String(openA), after: String(openB), material: false, reason: "Counted by code from question and gap statuses" }));

  /* ---------- Scores and evidence (computed by code) ---------- */
  const computed = "Recomputed by code from the updated inputs (not a model judgement)";
  for (const d of db.dimensions) {
    const p = da.dimensions.find((x) => x.id === d.id);
    const fv = (x: typeof d | undefined) => (x ? `${x.value === null ? "—" : Math.round(x.value)} · ${enumLabel(x.status).toLowerCase()} · coverage ${Math.round(x.coverage * 100)}%` : "—");
    const moved = !p || p.status !== d.status || Math.abs((p.value ?? -1) - (d.value ?? -1)) >= 1 || Math.abs(p.coverage - d.coverage) >= 0.05;
    if (!moved) continue;
    rows.push(
      rowOf({
        group: "SCORE",
        key: `DIM:${d.id}`,
        area: d.name,
        dimension: `${d.name} (index, not a probability)`,
        before: fv(p),
        after: fv(d),
        material: !p || p.status !== d.status || Math.abs((p.value ?? 0) - (d.value ?? 0)) >= 5,
        reason: computed,
      }),
    );
  }
  const oq = (x: DerivedAnalysis) => `${x.operatingQuality.value === null ? "—" : Math.round(x.operatingQuality.value)} [${Math.round(x.operatingQuality.lower)}–${Math.round(x.operatingQuality.upper)}]`;
  if (oq(da) !== oq(db))
    rows.push(rowOf({ group: "SCORE", key: "OQI", area: "Thesis", dimension: "Operating quality index [bounds]", before: oq(da), after: oq(db), material: Math.abs((da.operatingQuality.value ?? 0) - (db.operatingQuality.value ?? 0)) >= 5, reason: computed }));
  if (da.evidence.category !== db.evidence.category || Math.round(da.evidence.index) !== Math.round(db.evidence.index))
    rows.push(
      rowOf({
        group: "EVIDENCE",
        key: "EVIDENCE",
        area: "Evidence",
        dimension: "Evidence quality",
        before: `${enumLabel(da.evidence.category)} · ${Math.round(da.evidence.index)}`,
        after: `${enumLabel(db.evidence.category)} · ${Math.round(db.evidence.index)}`,
        material: da.evidence.category !== db.evidence.category,
        reason: "Computed from claim verification; founder statements are company-reported and do not raise it",
      }),
    );
  if (da.risk.headline !== db.risk.headline)
    rows.push(rowOf({ group: "RISK", key: "RISK_HEADLINE", area: "Risks", dimension: "Risk headline", before: enumLabel(da.risk.headline), after: enumLabel(db.risk.headline), material: true, reason: computed }));
  const pl = (x: DerivedAnalysis) => (x.powerLaw.value === null ? null : Math.round(x.powerLaw.value));
  if (pl(da) !== pl(db))
    rows.push(rowOf({ group: "SCORE", key: "POWER_LAW", area: "Returns", dimension: "Power-law index (not a probability)", before: String(pl(da) ?? "—"), after: String(pl(db) ?? "—"), material: Math.abs((pl(da) ?? 0) - (pl(db) ?? 0)) >= 5, reason: computed }));

  return rows;
}

/** Order for display: material first, then by investment area. */
const AREA_ORDER = ["Recommendation", "Thesis", "Founders", "Product", "PMF", "Traction", "GTM", "Economics", "Market", "Competition", "Moat", "Financing", "Risks", "Returns", "Evidence", "Unknowns"];
export function sortChanges(rows: DimensionChange[]): DimensionChange[] {
  const idx = (a: string) => {
    const i = AREA_ORDER.indexOf(a);
    return i < 0 ? AREA_ORDER.length : i;
  };
  return [...rows].sort((x, y) => Number(y.material) - Number(x.material) || idx(x.area) - idx(y.area));
}
