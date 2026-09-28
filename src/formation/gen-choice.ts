/**
 * Multiple-choice generators. Never trivial: every option is one of the deal's
 * own numbers with a plausible reading; the key comes from the benchmark
 * registry, the integrity engine and documented expert adjustments.
 */
import { metricDef } from "@/engine/metrics/dictionary";
import { findBenchmark, interpolate } from "@/engine/scoring/curve";
import { getRegistry } from "@/engine/benchmarks";
import type { TrainingCase } from "./case";
import { metricFactId, pickFacts } from "./case";
import type { Concern } from "./concerns";
import { naiveTopConcern } from "./concerns";
import { caseLine, emptyKey, makeExercise } from "./exercise";
import { formatMetric, seededShuffle } from "./format";
import { aiSummary, expertFocus, links, metricLink } from "./reveal";
import type { CasePattern, Exercise } from "./types";

const letter = (i: number) => String.fromCharCode(65 + i);

/* ---------------------------------------------------------------- */
/* Which variable should concern you most?                            */
/* ---------------------------------------------------------------- */

/** Partial credit window: an option within this severity of the top concern is a defensible second answer. */
export const CONCERN_PARTIAL_WINDOW = 0.1;

export function concernExercise(c: TrainingCase): Exercise | null {
  const concerns = c.concerns;
  if (concerns.length < 4) return null;
  const top = concerns[0]!;
  const naive = naiveTopConcern(concerns);
  const trap = naive && naive.metricKey !== top.metricKey ? naive : null;
  // Options: the top concern, the naive trap, then the strongest remaining concerns with distinct concepts.
  const chosen: Concern[] = [top];
  if (trap) chosen.push(trap);
  for (const x of concerns) {
    if (chosen.length >= 4) break;
    if (chosen.some((y) => y.metricKey === x.metricKey || y.concept === x.concept)) continue;
    chosen.push(x);
  }
  for (const x of concerns) {
    if (chosen.length >= 4) break;
    if (!chosen.some((y) => y.metricKey === x.metricKey)) chosen.push(x);
  }
  if (chosen.length < 4) return null;
  const second = concerns[1]!;
  const margin = top.severity - second.severity;
  const order = seededShuffle(chosen, `${c.ref.versionId}:concern`);
  const options = order.map((x, i) => ({ id: letter(i), text: `${x.label} — ${x.display}: ${x.implication}.` }));
  const idOf = (k: string) => options[order.findIndex((x) => x.metricKey === k)]!.id;
  const key = emptyKey();
  key.correctOptionIds = [idOf(top.metricKey)];
  key.partialOptionIds = order.filter((x) => x !== top && x.severity >= top.severity - CONCERN_PARTIAL_WINDOW).map((x) => idOf(x.metricKey));
  for (const x of order)
    key.optionNotes[idOf(x.metricKey)] = `${x.label} ${x.display}: benchmark severity ${(x.rawSeverity * 100).toFixed(0)}/100 (${x.benchmarkId})${x.adjustments.length ? ` → ${(x.severity * 100).toFixed(0)}/100 after adjustment. ${x.adjustments.join(" ")}` : "."}`;
  key.answer = `${top.label} (${top.display}) — ${top.implication}.`;
  key.workedSolution = [
    "Read each number against the peer-group benchmark curve in the active registry (the same curves the scoring engine uses): severity = 100 − curve score.",
    ...order.map((x) => key.optionNotes[idOf(x.metricKey)]!),
    `Highest adjusted severity: ${top.label}. ${margin < CONCERN_PARTIAL_WINDOW ? `${second.label} is close behind (within ${(CONCERN_PARTIAL_WINDOW * 100).toFixed(0)} points) and earns partial credit.` : `The gap to the next concern (${second.label}) is ${(margin * 100).toFixed(0)} points.`}`,
  ];
  if (trap) key.alternativeReasoning.push(`${trap.label} looks worst on a naive reading (${(trap.rawSeverity * 100).toFixed(0)}/100), but ${trap.adjustments[0] ?? "the adjustment above changes the ranking."}`);
  key.alternativeReasoning.push(`A defensible second answer is ${second.label} (${second.display}) if you weight ${second.concept.toLowerCase().replace(/_/g, " ")} above ${top.concept.toLowerCase().replace(/_/g, " ")} for this company.`);
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c, [`${top.label}: ${top.adjustments[0] ?? top.implication}`]);
  key.evidence = links(...order.map((x) => metricLink(c, x.metricId)));
  key.concepts = [top.concept];
  const others = c.concerns.filter((x) => !order.some((y) => y.metricKey === x.metricKey)).slice(0, 2);
  const factIds = [...order, ...others].map((x) => metricFactId({ id: x.metricId } as never));
  const context = pickFacts(c, [...factIds, "F-RAISE", "F-PRE", "F-POST", "F-CASH", "F-BURN"]);
  const derivedNote = order.filter((x) => x.derived).map((x) => x.label);
  const numbers = order.map((x) => `${x.label} ${x.display}`).join(", ");
  const patterns: CasePattern[] = trap ? ["OBVIOUS_ANSWER_WRONG"] : [];
  if (c.patterns.some((p) => p.pattern === "CONFLICTING_METRICS")) patterns.push("CONFLICTING_METRICS");
  return makeExercise({
    c,
    kind: "MCQ_CONCERN",
    variant: "concern",
    skills: [c.domainSkill, "RISK_DETECTION"],
    level: 2 + (margin < 0.12 ? 1 : 0),
    patterns,
    title: "Which variable should concern you most?",
    prompt: `${caseLine(c)}\n\n${numbers}${derivedNote.length ? ` (${derivedNote.join(", ")} computed from the deck's own figures)` : ""}. Which variable should concern you most, and why?`,
    context,
    input: { type: "choice", options, justification: true },
    key,
  });
}

/* ---------------------------------------------------------------- */
/* Signal versus noise: strongest evidence of PMF                     */
/* ---------------------------------------------------------------- */

/** How directly a metric evidences product-market fit (MODEL_ASSUMPTION, documented in the key). */
export const PMF_WEIGHT: Record<string, number> = {
  nrr: 1,
  grr: 1,
  logo_retention: 0.9,
  d30_retention: 1,
  dau_mau: 0.8,
  repeat_rate: 0.95,
  pilot_to_production_rate: 0.85,
  organic_acquisition_share: 0.8,
  arr_growth_yoy: 0.5,
  revenue_growth_yoy: 0.5,
  mom_growth: 0.5,
  paying_customers: 0.3,
  arr: 0.3,
  gmv: 0.3,
  mau: 0.25,
  active_accounts: 0.3,
  pilots: 0.2,
};
const GROWTH_KEYS = new Set(["arr_growth_yoy", "revenue_growth_yoy", "mom_growth", "paying_customers", "arr", "gmv", "mau", "active_accounts", "pilots"]);

export interface PmfCandidate {
  metricKey: string;
  metricId: string;
  label: string;
  display: string;
  weight: number;
  benchmarkScore: number | null;
  quality: number;
  strength: number;
  notes: string[];
}

export function pmfCandidates(c: TrainingCase): PmfCandidate[] {
  const registry = getRegistry(c.derived.registryId);
  const { profile, stageBand } = c.derived.peerGroup;
  const out: PmfCandidate[] = [];
  const growthMetric = c.deal.metrics.find((m) => m.isPrimary && m.calculationMethod === "DERIVED" && m.metricKey === "arr_growth_yoy");
  const pool = { ...c.deckMetrics };
  if (!pool.arr_growth_yoy && !pool.revenue_growth_yoy && growthMetric) pool.arr_growth_yoy = growthMetric;
  if (pool.arr_growth_yoy && pool.revenue_growth_yoy) delete pool.revenue_growth_yoy;
  for (const [key, m] of Object.entries(pool)) {
    const weight = PMF_WEIGHT[key];
    if (weight === undefined || m.normalizedValue === null) continue;
    const bench = findBenchmark(registry, key, profile, stageBand);
    const score = bench?.curve ? interpolate(bench.curve, m.normalizedValue) : null;
    const notes: string[] = [];
    let quality = 1;
    const def = metricDef(key);
    if (def?.unit === "PERCENT" && !GROWTH_KEYS.has(key) && m.sampleSize === null) {
      quality -= 0.3;
      notes.push("no sample size stated");
    }
    if (m.qualityFlags.some((f) => f.startsWith("DEFINITION_NOT_STATED"))) {
      quality -= 0.15;
      notes.push("definition not stated");
    }
    if (m.state === "INFERRED") {
      quality -= 0.1;
      notes.push("inferred from the deck, not stated");
    }
    const strength = weight * Math.max(0.1, quality) * ((score ?? 60) / 100);
    out.push({ metricKey: key, metricId: m.id, label: def?.shortName ?? key, display: formatMetric(m), weight, benchmarkScore: score, quality: Math.max(0.1, quality), strength: Math.round(strength * 1000) / 1000, notes });
  }
  return out.sort((a, b) => b.strength - a.strength || (a.metricKey < b.metricKey ? -1 : 1));
}

export function pmfSignalExercise(c: TrainingCase): Exercise | null {
  const cands = pmfCandidates(c);
  if (cands.length < 3) return null;
  const top = cands[0]!;
  const growth = cands.find((x) => GROWTH_KEYS.has(x.metricKey));
  if (!growth || growth.metricKey === top.metricKey) return null; // the exercise exists to separate growth from PMF
  const opts = [top, growth, ...cands.filter((x) => x !== top && x !== growth)].slice(0, 4);
  const order = seededShuffle(opts, `${c.ref.versionId}:pmf`);
  const options = order.map((x, i) => ({ id: letter(i), text: `${x.label}: ${x.display}` }));
  const idOf = (k: string) => options[order.findIndex((x) => x.metricKey === k)]!.id;
  const key = emptyKey();
  key.correctOptionIds = [idOf(top.metricKey)];
  for (const x of order)
    key.optionNotes[idOf(x.metricKey)] = `${x.label} ${x.display}: PMF relevance ${x.weight} × evidence quality ${x.quality.toFixed(2)} × benchmark ${x.benchmarkScore !== null ? x.benchmarkScore.toFixed(0) : "n/a (60 assumed)"}/100 = ${x.strength.toFixed(2)}${x.notes.length ? ` (${x.notes.join(", ")})` : ""}.`;
  key.answer = `${top.label} (${top.display}) — it measures whether customers keep choosing the product, which growth alone cannot show.`;
  key.workedSolution = [
    "PMF evidence = how directly the metric shows customers keep choosing the product (retention, repeat, conversion > growth and scale, which can be bought) × evidence quality × benchmark position.",
    ...order.map((x) => key.optionNotes[idOf(x.metricKey)]!),
  ];
  const growthLooksBetter = growth.benchmarkScore !== null && top.benchmarkScore !== null && growth.benchmarkScore > top.benchmarkScore;
  key.alternativeReasoning.push(
    growthLooksBetter
      ? `${growth.label} (${growth.display}) benchmarks better than ${top.label}, which is why it is tempting — but growth can come from spend, a few large deals or pilots; it is not proof that customers stay.`
      : `${growth.label} (${growth.display}) is the headline, but growth can come from spend or a few large deals; it is not proof that customers stay.`,
  );
  if (c.deal.pmf?.assessment) key.aiAnalysis.push(`PMF assessment: ${c.deal.pmf.assessment}`);
  key.aiAnalysis.push(...aiSummary(c));
  key.expertFocus = expertFocus(c);
  key.evidence = links(...order.map((x) => metricLink(c, x.metricId)));
  key.concepts = ["PMF_EVIDENCE"];
  return makeExercise({
    c,
    kind: "MCQ_PMF_SIGNAL",
    variant: "pmf",
    skills: ["PMF", c.domainSkill],
    level: 2 + (growthLooksBetter ? 1 : 0),
    patterns: c.patterns.some((p) => p.pattern === "GROWTH_HIDING_RETENTION") ? ["GROWTH_HIDING_RETENTION"] : [],
    title: "Which number is the strongest evidence of product-market fit?",
    prompt: `${caseLine(c)}\n\nOf the numbers below, which one is the strongest evidence of product-market fit — the one you would put in front of your partners?`,
    context: pickFacts(c, order.map((x) => `F-${x.metricId}`)),
    input: { type: "choice", options, justification: true },
    key,
  });
}

/* ---------------------------------------------------------------- */
/* The missing number: what to request first                          */
/* ---------------------------------------------------------------- */

const SEV_RANK: Record<string, number> = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 };

export function missingMetricExercise(c: TrainingCase): Exercise | null {
  const items = c.derived.integrity?.expectedEvidence?.items ?? [];
  const missing = items.filter((i) => i.level === "EXPECTED" && i.presence !== "PRESENT").sort((a, b) => (SEV_RANK[b.severity ?? ""] ?? 0) - (SEV_RANK[a.severity ?? ""] ?? 0) || (a.itemId < b.itemId ? -1 : 1));
  const present = items.filter((i) => i.presence === "PRESENT" && i.level === "EXPECTED");
  if (missing.length < 1 || present.length < 2) return null;
  const top = missing[0]!;
  const pool = [top, ...missing.slice(1, 2), ...seededShuffle(present, `${c.ref.versionId}:present`).slice(0, 4 - Math.min(2, missing.length))];
  const order = seededShuffle(pool, `${c.ref.versionId}:missing`);
  const options = order.map((x, i) => ({ id: letter(i), text: x.label }));
  const key = emptyKey();
  const idOf = (itemId: string) => options[order.findIndex((x) => x.itemId === itemId)]!.id;
  key.correctOptionIds = [idOf(top.itemId)];
  key.partialOptionIds = order.filter((x) => x !== top && x.presence !== "PRESENT").map((x) => idOf(x.itemId));
  for (const x of order)
    key.optionNotes[idOf(x.itemId)] =
      x.presence === "PRESENT" ? `${x.label}: already on the deck (${x.refs.join(", ") || "present"}) — asking for it spends a question on something you have.` : `${x.label}: ${x.presence === "WITHHELD" ? "withheld" : "missing"} (severity ${x.severity?.toLowerCase() ?? "n/a"}).${x.perfectSlide ? ` Ideal slide: ${x.perfectSlide}` : ""}`;
  key.answer = `${top.label} — the most decision-relevant expected evidence the deck does not show.`;
  key.workedSolution = ["Stage-specific expected evidence (integrity engine) marks what a comparable deck should show.", ...order.map((x) => key.optionNotes[idOf(x.itemId)]!)];
  key.alternativeReasoning = missing.slice(1, 3).map((m) => `${m.label} is also missing and earns partial credit.`);
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c);
  key.concepts = ["MISSING_EVIDENCE", "QUESTION_TARGETING"];
  key.evidence = [{ label: "Evidence explorer", href: `/deals/${c.ref.slug}/evidence` }];
  const context = c.facts.filter((f) => f.group === "Traction" || f.group === "Economics" || f.group === "Customers" || f.group === "Financing").slice(0, 16);
  return makeExercise({
    c,
    kind: "MCQ_MISSING_METRIC",
    variant: "missing",
    skills: ["FOUNDER_QUESTIONING", c.domainSkill],
    level: 2 + (present.length >= 3 ? 1 : 0),
    title: "Which piece of evidence would you request first?",
    prompt: `${caseLine(c)}\n\nYou get one data request before the partner meeting. Given what the deck already shows, which would you ask for first?`,
    context,
    input: { type: "choice", options, justification: true },
    key,
  });
}
