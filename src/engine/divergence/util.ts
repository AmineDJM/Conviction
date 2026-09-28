/** Small pure helpers of the Divergence Factors engine. Never throw on missing data. */
import type { CanonicalDeal } from "@/domain/canonical";
import { CURRENT_BASES, coverage as latentCoverage, fmtUsd, latestObservation, moneyUsd, obsUsd, pageFromLocation, pagesOf, primaryMetric, round, uniqSorted } from "../latent/util";
import type { ComputedUnit, ComputedValue, DivergenceBasis, DivergenceCoverage, DivergenceEvidence, DivergenceLevel } from "./types";
import { LEVEL_RANK } from "./types";

export { fmtUsd, moneyUsd, pagesOf, round, uniqSorted, CURRENT_BASES };

export function coverage(available: (string | null | false | undefined)[], missing: (string | null | false | undefined)[], note: string | null = null): DivergenceCoverage {
  return latentCoverage(
    available.filter((x): x is string => !!x),
    missing.filter((x): x is string => !!x),
    note,
  );
}

export function ev(basis: DivergenceBasis, text: string, pages: (number | null | undefined)[] = [], refs: (string | null | undefined)[] = []): DivergenceEvidence {
  return { basis, text, pages: pagesOf(pages), refs: uniqSorted<string>(refs) };
}

export function num(key: string, label: string, value: number | string | null, unit: ComputedUnit, basis: DivergenceBasis = "COMPUTED"): ComputedValue {
  return { key, label, value: typeof value === "number" && !Number.isFinite(value) ? null : value, unit, basis };
}

export function basesOf(evidence: DivergenceEvidence[], extra: (DivergenceBasis | false | null | undefined)[] = []): DivergenceBasis[] {
  return uniqSorted<DivergenceBasis>([...evidence.map((e) => e.basis), ...extra.filter((x): x is DivergenceBasis => !!x)]);
}

export function pagesOfEvidence(evidence: DivergenceEvidence[]): number[] {
  return pagesOf(evidence.flatMap((e) => e.pages));
}

/** Evidence text is usable when it says something (the model sometimes returns "" or "n/a"). */
export function hasText(s: string | null | undefined): boolean {
  const t = (s ?? "").trim().toLowerCase();
  return t.length >= 3 && !["n/a", "na", "none", "null", "not stated", "not shown", "unknown", "-", "—"].includes(t);
}

/**
 * True when the "evidence" only says that something is NOT in the materials
 * ("No hiring plan is stated", "does not state switching costs"). An absence
 * is a coverage gap, never a signal: such items are listed, not counted.
 */
export const ABSENCE_RE =
  /\b(no|not|none|nor|never|without|does not|doesn['’]t|do not|don['’]t|is not|are not|isn['’]t|aren['’]t)\b[^.;]{0,90}\b(state|stated|states|provide|provided|provides|report|reported|reports|describe|described|describes|show|shown|shows|disclose|disclosed|discloses|given|mention|mentioned|specify|specified|specifies|available|identified|quantified)\b/i;
/** French disclosure verbs / participles (stems): précisé, indiqué, mentionné, communiqué, fourni, détaillé, chiffré… */
const FR_DISCLOSE = "précis|indiqu|mentionn|communiqu|fourni|détaill|quantifi|chiffr|présent|donn|décri|identifi|renseign|disponibl|document|explicit|abord|évoqu|spécifi|montr";
const NL = "(?<![\\p{L}])"; // no letter before (\b is ASCII-only: "précisé" would not end on a boundary)
const NR = "(?![\\p{L}])";
/**
 * French forms of an absence ("Aucun plan de recrutement n'est mentionné", "Le deck ne précise pas…", "Pas de plan
 * d'embauche indiqué", "non communiqué", "néant", "à définir") and the language-neutral "TBD". A negation alone is not
 * an absence ("Aucun churn sur 24 mois" is a fact): it needs a disclosure verb, as in English.
 */
export const ABSENCE_FR_RE = new RegExp(
  [
    `${NL}(?:(?:aucun|aucune|sans|pas\\s+d(?:e|u|es))${NR}|pas\\s+d['’])[^.;]{0,90}?${NL}(?:${FR_DISCLOSE})\\p{L}*`,
    `${NL}n(?:e\\s+|['’])(?:(?:le|la|les|en|y)\\s+|l['’])?(?:${FR_DISCLOSE})\\p{L}*\\s+(?:pas|jamais|nulle\\s+part)${NR}`,
    `${NL}n(?:e\\s+|['’])(?:est|sont|a|ont|était|étaient|avait|avaient)\\s+(?:pas|jamais)\\s+(?:(?:été|encore|clairement)\\s+)*(?:${FR_DISCLOSE})\\p{L}*`,
    `${NL}non\\s+(?:${FR_DISCLOSE})\\p{L}*`,
    `${NL}(?:néant|neant|tbd|à\\s+définir|a\\s+definir|à\\s+préciser|to\\s+be\\s+(?:determined|defined|confirmed))${NR}`,
  ].join("|"),
  "iu",
);
export function statesAbsence(s: string | null | undefined): boolean {
  return ABSENCE_RE.test(s ?? "") || ABSENCE_FR_RE.test(s ?? "");
}

/** Evidence that states a fact (not an absence) — the only kind that can move a level. */
export function isFact(s: string | null | undefined): boolean {
  return hasText(s) && !statesAbsence(s);
}

/** True when the text carries a measured quantity (a digit). */
export function hasNumber(s: string | null | undefined): boolean {
  return /\d/.test(s ?? "");
}

export function normName(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function downgrade(l: DivergenceLevel): DivergenceLevel {
  return l === "STRONG" ? "ADEQUATE" : l === "ADEQUATE" ? "WEAK" : l;
}

export function minLevel(a: DivergenceLevel, b: DivergenceLevel): DivergenceLevel {
  if (a === "INSUFFICIENT_EVIDENCE") return b;
  if (b === "INSUFFICIENT_EVIDENCE") return a;
  return LEVEL_RANK[a] <= LEVEL_RANK[b] ? a : b;
}

/** Current value of a metric with its id (for refs) and page: normalized metric first, raw observation second. */
export function metricRef(deal: CanonicalDeal, key: string): { value: number; ref: string | null; page: number | null; raw: string } | null {
  try {
    const m = primaryMetric(deal, key);
    if (m && m.normalizedValue !== null && Number.isFinite(m.normalizedValue)) return { value: m.normalizedValue, ref: m.id, page: pageFromLocation(m.location), raw: m.rawValue };
    const o = latestObservation(deal.metricObservations ?? [], key);
    if (o) {
      const v = obsUsd(o);
      if (v !== null && Number.isFinite(v)) return { value: v, ref: null, page: o.page, raw: o.rawText };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export const pct1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${round(n, 1)}%`);
export const months1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${round(n, 1)} months`);
export const mult1 = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "n/a" : `${round(n, 1)}×`);
