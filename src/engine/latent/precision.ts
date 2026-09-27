/**
 * §6 PRECISION DISCIPLINE — "~$5M ARR" vs "$4.83M ARR as of Aug. 31, 2026;
 * excludes signed but not live contracts". Computed from the raw metric
 * observations: definitions, dates, scope, forecast separation, approximation.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { LatentBasis, LatentEvidence, LatentModule, QualityLevel } from "./types";
import { CURRENT_BASES, FORWARD_BASES_SET, bases, coverage, dateGranularity, dedupeObservations, isFuture, isQuantitative, lower, obsHeadline, pagesOf, pct, round } from "./util";

export interface SubScore {
  /** 0–100, null when not assessable. */
  pct: number | null;
  numerator: number;
  denominator: number;
}

export interface PrecisionDiscipline extends LatentModule {
  level: QualityLevel;
  /** Weighted 0–100 score of the sub-scores that are assessable. */
  score: number | null;
  observations: number;
  definitionQuality: SubScore;
  temporalPrecision: SubScore & { day: number; month: number; year: number; none: number };
  scopePrecision: SubScore;
  forecastSeparation: SubScore & { issues: LatentEvidence[] };
  approximationRate: SubScore & { examples: string[] };
  precisePrecedents: string[];
  impreciseExamples: string[];
}

const APPROX_RE =
  /~|≈|\bapprox\w*|\babout\b|\baround\b|\broughly\b|\bnearly\b|\balmost\b|\bcirca\b|\bca\.|\bc\.\s?\$|\bover\b|\bmore than\b|\bupwards of\b|\bnorth of\b|\bup to\b|>\s*\$?\d|[\dkmb]\s*\+(?!\d)|\$?\d+(?:\.\d+)?\s*[kmb%]?\s*(?:–|—|-|to)\s*\$?\d+(?:\.\d+)?\s*[kmb%]?(?!\d)|\bseveral\b|\bdozens?\b|\bhundreds of\b|\bthousands of\b|\bmillions of\b/i;
const SCOPE_RE = /\binclud\w*|\bexclud\w*|\bnet of\b|\bexcept\b|\bonly\b|\bex\.?\s|\bgross of\b|\bafter\b|\bbefore\b|\bcompris\w*|\bconsists? of\b|\bwithout\b|\bnot (live|deployed|signed|billing|recurring)\b/i;
const FORWARD_LABEL_RE =
  /forecast|projected|projection|\bplan(ned)?\b|target|\bgoal\b|expected|estimate|budget|pipeline|outlook|guidance|\b20\d\d\s?e\b|\bfy\s?\d{2,4}\s?e\b|\(e\)|\bby (the )?(end of )?(q\d )?20\d\d\b|\bwill\b|\bprojected\b/i;

export function isApproximate(rawText: string): boolean {
  const t = rawText.replace(/\b(19|20)\d{2}-\d{1,2}(-\d{1,2})?\b/g, " ");
  return APPROX_RE.test(t);
}

export function statesScope(o: Pick<MetricObservation, "components" | "definitionAsStated" | "rawText">): boolean {
  return o.components.some((c) => SCOPE_RE.test(c)) || SCOPE_RE.test(o.definitionAsStated ?? "") || /\b(includ|exclud)\w*/i.test(o.rawText);
}

/**
 * Forecast separation: every forward-looking value must be labelled as such
 * and must not be mixed, unlabelled, onto a chart of actuals. Future-dated
 * values presented as actual/current are separation failures too.
 */
export function forecastSeparation(deal: CanonicalDeal, obs: MetricObservation[], asOf: Date): PrecisionDiscipline["forecastSeparation"] {
  const issues: LatentEvidence[] = [];
  const chartIssuePages = new Set((deal.forensics?.chartForensics ?? []).filter((c) => c.page !== null).map((c) => c.page!));
  const modelFdaPages = new Set(
    (deal.latentSignals?.presentationTechniques ?? []).filter((t) => t.technique === "FORECAST_DRAWN_AS_ACTUAL" && t.page !== null).map((t) => t.page!),
  );
  const actualChartPages = new Set(obs.filter((o) => o.sourceKind === "CHART" && CURRENT_BASES.has(o.basis) && o.page !== null).map((o) => o.page!));
  const forward = obs.filter((o) => FORWARD_BASES_SET.has(o.basis));
  const futureActuals = obs.filter((o) => CURRENT_BASES.has(o.basis) && isFuture(o.periodEnd, asOf));
  let clean = 0;
  for (const o of forward) {
    const labelled = FORWARD_LABEL_RE.test(obsHeadline(o)) || isFuture(o.periodEnd, asOf, 0);
    const onActualChart = o.sourceKind === "CHART" && o.page !== null && actualChartPages.has(o.page);
    const flagged = o.page !== null && (chartIssuePages.has(o.page) || modelFdaPages.has(o.page));
    if (labelled && !(onActualChart && flagged)) clean++;
    else if (!labelled) issues.push({ basis: "COMPUTED", text: `Forward-looking value "${o.rawText}" (${o.basis.toLowerCase()}) is not labelled as forecast/target`, page: o.page });
    else issues.push({ basis: "COMPUTED", text: `Forecast "${o.rawText}" is drawn on the same chart as actuals (p. ${o.page}) and the chart is flagged`, page: o.page });
  }
  for (const o of futureActuals)
    issues.push({ basis: "COMPUTED", text: `"${o.rawText}" is presented as ${o.basis.toLowerCase()} but dated ${o.periodEnd} (after the analysis date)`, page: o.page });
  const denominator = forward.length + futureActuals.length;
  return { pct: pct(clean, denominator), numerator: clean, denominator, issues };
}

export function precisionDiscipline(deal: CanonicalDeal, asOf: Date): PrecisionDiscipline {
  const obs = dedupeObservations(deal.metricObservations ?? []).filter(isQuantitative);
  const n = obs.length;
  const defined = obs.filter((o) => !!o.definitionAsStated?.trim() || o.components.length > 0);
  const gran = { day: 0, month: 0, year: 0, none: 0 };
  for (const o of obs) gran[lower(dateGranularity(o.periodEnd)) as keyof typeof gran]++;
  const temporalPoints = gran.day + 0.8 * gran.month + 0.4 * gran.year;
  const scoped = obs.filter(statesScope);
  const approx = obs.filter((o) => isApproximate(o.rawText));
  const fs = forecastSeparation(deal, obs, asOf);

  const definitionQuality: SubScore = { pct: pct(defined.length, n), numerator: defined.length, denominator: n };
  const temporalPrecision = { pct: n ? round((temporalPoints / n) * 100, 1) : null, numerator: gran.day + gran.month + gran.year, denominator: n, ...gran };
  const scopePrecision: SubScore = { pct: pct(scoped.length, n), numerator: scoped.length, denominator: n };
  const approximationRate = { pct: pct(approx.length, n), numerator: approx.length, denominator: n, examples: approx.slice(0, 5).map((o) => o.rawText) };

  const parts: { w: number; v: number | null }[] = [
    { w: 0.25, v: definitionQuality.pct },
    { w: 0.25, v: temporalPrecision.pct },
    { w: 0.15, v: scopePrecision.pct },
    { w: 0.15, v: fs.pct },
    { w: 0.2, v: approximationRate.pct === null ? null : 100 - approximationRate.pct },
  ];
  const usable = parts.filter((p) => p.v !== null);
  const wsum = usable.reduce((a, p) => a + p.w, 0);
  const score = n && wsum ? round(usable.reduce((a, p) => a + p.w * p.v!, 0) / wsum, 1) : null;
  let level: QualityLevel;
  if (score === null) level = "INSUFFICIENT_EVIDENCE";
  else if (score >= 85 && n >= 5) level = "EXCEPTIONAL";
  else if (score >= 65) level = "STRONG";
  else if (score >= 40) level = "MODERATE";
  else level = "WEAK";

  const precise = obs.filter((o) => dateGranularity(o.periodEnd) === "DAY" && !isApproximate(o.rawText) && (statesScope(o) || !!o.definitionAsStated));
  const imprecise = obs.filter((o) => isApproximate(o.rawText) && !o.periodEnd);
  // Forecast separation also reads the model's chart forensics / presentation techniques when present.
  const usesModel = (deal.forensics?.chartForensics.length ?? 0) > 0 || (deal.latentSignals?.presentationTechniques ?? []).some((t) => t.technique === "FORECAST_DRAWN_AS_ACTUAL");
  const basis: LatentBasis[] = bases("COMPUTED", usesModel && fs.denominator > 0 && "MODEL_OBSERVED");
  return {
    basis,
    pages: pagesOf(obs.map((o) => o.page)),
    coverage: coverage(n ? ["metric observations"] : [], n ? [] : ["metric observations"], n ? `${n} quantitative observations assessed.` : "No quantitative observations were extracted."),
    rule:
      "Score = weighted mean of available sub-scores: definition 25% (definition or components stated), temporal 25% (as-of date: day 1.0, month 0.8, year 0.4, none 0), scope 15% (inclusions/exclusions stated), forecast separation 15% (forward values labelled and not mixed on flagged actual charts; future-dated actuals fail), non-approximation 20%. " +
      "EXCEPTIONAL ≥85 (≥5 observations), STRONG ≥65, MODERATE ≥40, else WEAK.",
    level,
    score,
    observations: n,
    definitionQuality,
    temporalPrecision,
    scopePrecision,
    forecastSeparation: fs,
    approximationRate,
    precisePrecedents: precise.slice(0, 5).map((o) => `${o.rawText}${o.periodEnd ? ` (as of ${o.periodEnd})` : ""}${o.components.length ? `; ${o.components.join("; ")}` : ""}`),
    impreciseExamples: imprecise.slice(0, 5).map((o) => o.rawText),
  };
}
