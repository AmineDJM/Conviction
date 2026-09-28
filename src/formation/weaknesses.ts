/**
 * RECURRING WEAKNESSES — only from repeated observed evidence.
 *
 * Every graded attempt emits concept observations (CAUGHT / MISSED). A concept
 * is a recurring weakness when, over its opportunities n:
 *   n ≥ MIN_OPPORTUNITIES (4), misses ≥ MIN_MISSES (3), and the posterior mean
 *   miss rate under a uniform Beta(1,1) prior, (misses + 1) / (n + 2), ≥ 0.6.
 * A single bad day never produces a weakness; every statement carries its
 * counts and the cases it came from.
 */
import { CONCEPT_LABEL } from "./labels";
import { chronological, graded, type AttemptRecord } from "./records";
import type { Concept } from "./types";

export const MIN_OPPORTUNITIES = 4;
export const MIN_MISSES = 3;
export const WEAKNESS_POSTERIOR = 0.6;
export const STRENGTH_POSTERIOR = 0.75;

export interface ConceptStat {
  concept: Concept;
  n: number;
  misses: number;
  caught: number;
  posteriorMiss: number;
  cases: string[];
  examples: { attemptId: string; caseName: string; title: string; at: string; outcome: "CAUGHT" | "MISSED" }[];
}

export interface Weakness {
  concept: Concept;
  statement: string;
  n: number;
  misses: number;
  posteriorMiss: number;
  cases: string[];
  examples: ConceptStat["examples"];
}

const PHRASE: Partial<Record<Concept, string>> = {
  RETENTION_RISK: "Consistently underweights retention risk",
  UNIT_ECONOMICS: "Consistently underweights weak unit economics",
  CAPITAL_EFFICIENCY: "Consistently overlooks capital efficiency",
  RUNWAY_FINANCING: "Consistently underweights financing risk",
  CAPITAL_INTENSITY: "Consistently misses capital intensity",
  CUSTOMER_CONCENTRATION: "Consistently overlooks customer concentration",
  FOUNDER_DEPENDENCE: "Consistently overlooks founder-dependent sales",
  GROWTH_QUALITY: "Consistently takes growth at face value",
  MARKET_SIZE_INFLATION: "Consistently accepts inflated market sizes",
  CUSTOMER_QUALITY: "Consistently counts pilots and logos as customers",
  FORECAST_VS_ACTUAL: "Consistently reads forecasts as actuals",
  METRIC_DEFINITION: "Consistently accepts metrics without checking definitions",
  INTERNAL_CONSISTENCY: "Consistently misses internal contradictions",
  MISSING_EVIDENCE: "Consistently misses what the deck leaves out",
  ENTRY_PRICE: "Consistently underweights entry price",
  DILUTION: "Consistently underestimates dilution",
  RETURN_PATH: "Consistently misjudges the return path",
  OUTLIER_SIGNAL: "Consistently misses outlier signals",
  TECHNICAL_ADVANTAGE: "Consistently discounts technical advantage",
  FOUNDER_CAPABILITY: "Consistently misreads founder capability",
  COMPETITION: "Consistently underweights competition",
  PMF_EVIDENCE: "Consistently misreads PMF evidence",
  QUESTION_TARGETING: "Consistently asks low-yield founder questions",
};

export function conceptStats(all: AttemptRecord[]): ConceptStat[] {
  const m = new Map<Concept, ConceptStat>();
  for (const a of chronological(graded(all)))
    for (const o of a.grade.observations) {
      const st = m.get(o.concept) ?? { concept: o.concept, n: 0, misses: 0, caught: 0, posteriorMiss: 0.5, cases: [], examples: [] };
      st.n++;
      if (o.outcome === "MISSED") st.misses++;
      else st.caught++;
      if (!st.cases.includes(a.exercise.case.name)) st.cases.push(a.exercise.case.name);
      st.examples.push({ attemptId: a.id, caseName: a.exercise.case.name, title: a.exercise.title, at: a.answeredAt, outcome: o.outcome });
      st.posteriorMiss = (st.misses + 1) / (st.n + 2);
      m.set(o.concept, st);
    }
  return [...m.values()].sort((a, b) => b.posteriorMiss - a.posteriorMiss || b.n - a.n);
}

export function isWeakness(st: Pick<ConceptStat, "n" | "misses" | "posteriorMiss">): boolean {
  return st.n >= MIN_OPPORTUNITIES && st.misses >= MIN_MISSES && st.posteriorMiss >= WEAKNESS_POSTERIOR;
}

export function isStrength(st: Pick<ConceptStat, "n" | "caught" | "posteriorMiss">): boolean {
  return st.n >= MIN_OPPORTUNITIES && st.caught >= MIN_MISSES && 1 - st.posteriorMiss >= STRENGTH_POSTERIOR;
}

export function detectWeaknesses(all: AttemptRecord[]): Weakness[] {
  return conceptStats(all)
    .filter(isWeakness)
    .map((st) => ({
      concept: st.concept,
      statement: `${PHRASE[st.concept] ?? `Consistently misses ${CONCEPT_LABEL[st.concept]}`} — missed in ${st.misses} of ${st.n} opportunities${st.cases.length ? ` (${st.cases.slice(0, 3).join(", ")}${st.cases.length > 3 ? "…" : ""})` : ""}.`,
      n: st.n,
      misses: st.misses,
      posteriorMiss: st.posteriorMiss,
      cases: st.cases,
      examples: st.examples.filter((e) => e.outcome === "MISSED").slice(-4),
    }));
}
