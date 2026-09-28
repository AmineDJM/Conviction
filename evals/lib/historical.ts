/**
 * Historical evaluation (§127) — pure parts: outcomes CSV parsing, outcome and
 * stance classes, calibration statistics and the as-of re-anchoring of an
 * analysis. Tested in tests/evals.historical.test.ts.
 *
 * A historical evaluation is only as good as its hindsight hygiene: the model
 * may know what happened to a famous company. Every row therefore carries a
 * contamination verdict (user-declared `famous` column and/or a measured
 * recognition probe), and calibration is reported with and without the
 * contaminated rows.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { applyMetricsExtraction } from "@/orchestration/assemble";

/* ------------------------------ CSV ------------------------------ */

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') q = false;
      else field += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export interface OutcomeRow {
  company: string;
  deckDate: string;
  outcome: string;
  outcomeDate: string | null;
  source: string;
  deckFile: string | null;
  /** User-declared: the company (or its outcome) is widely known. */
  famous: boolean | null;
}

const col = (header: string[], ...names: string[]) => header.findIndex((h) => names.includes(h.trim().toLowerCase().replace(/[\s-]+/g, "_")));

/** Columns: company, deck_date, outcome, outcome_date, source [, deck_file, famous]. Rows with a missing company, date or outcome are rejected with a reason. */
export function parseOutcomes(text: string): { rows: OutcomeRow[]; errors: string[] } {
  const all = parseCsv(text);
  const errors: string[] = [];
  if (!all.length) return { rows: [], errors: ["empty CSV"] };
  const h = all[0]!;
  const ix = {
    company: col(h, "company"),
    deckDate: col(h, "deck_date", "date"),
    outcome: col(h, "outcome"),
    outcomeDate: col(h, "outcome_date"),
    source: col(h, "source", "outcome_source"),
    deckFile: col(h, "deck_file", "deck", "file"),
    famous: col(h, "famous", "well_known"),
  };
  for (const k of ["company", "deckDate", "outcome", "source"] as const) if (ix[k] < 0) errors.push(`missing column ${k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase())}`);
  if (errors.length) return { rows: [], errors };
  const rows: OutcomeRow[] = [];
  all.slice(1).forEach((r, i) => {
    const get = (j: number) => (j >= 0 ? (r[j] ?? "").trim() : "");
    const line = i + 2;
    const company = get(ix.company);
    const deckDate = get(ix.deckDate);
    const outcome = get(ix.outcome);
    if (!company || !outcome) return errors.push(`line ${line}: company and outcome are required`);
    if (!/^\d{4}-\d{2}(-\d{2})?$/.test(deckDate) || Number.isNaN(new Date(deckDate).getTime())) return errors.push(`line ${line}: deck_date must be YYYY-MM or YYYY-MM-DD (got "${deckDate}")`);
    const od = get(ix.outcomeDate);
    if (od && od < deckDate) return errors.push(`line ${line}: outcome_date precedes deck_date`);
    const fam = get(ix.famous).toLowerCase();
    rows.push({ company, deckDate, outcome, outcomeDate: od || null, source: get(ix.source), deckFile: get(ix.deckFile) || null, famous: fam ? /^(y|yes|true|1)$/.test(fam) : null });
  });
  return { rows, errors };
}

/* ------------------------------ Classes ------------------------------ */

export type OutcomeClass = "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "UNKNOWN";
export type Stance = "ADVANCE" | "DILIGENCE" | "PASS";

/**
 * Outcome label → class. Preferred labels: RAISED_UP_ROUND, ACQUIRED_GOOD, IPO (positive);
 * ALIVE_FLAT, BRIDGE, ACQUIHIRE (neutral); SHUT_DOWN, DOWN_ROUND, ACQUIRED_DISTRESSED (negative).
 * Free text is classified by keywords; anything else is UNKNOWN (never guessed).
 */
export function outcomeClass(label: string): OutcomeClass {
  const s = label.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(raised_up_round|acquired_good|ipo|positive)$/.test(s)) return "POSITIVE";
  if (/^(alive_flat|bridge|acquihire|neutral)$/.test(s)) return "NEUTRAL";
  if (/^(shut_down|down_round|acquired_distressed|negative)$/.test(s)) return "NEGATIVE";
  const t = label.toLowerCase();
  if (/shut|wound down|wind[- ]down|bankrupt|insolven|ceased|closed|dead|failed|down round|distress|fire sale/.test(t)) return "NEGATIVE";
  if (/acqui-?hire|flat|bridge|zombie|still operating|alive/.test(t)) return "NEUTRAL";
  if (/\bipo\b|up round|series [a-e]\b|raised|acquired at|strategic acquisition|profitable/.test(t)) return "POSITIVE";
  return "UNKNOWN";
}

export function stanceOf(status: string): Stance {
  if (status === "ANALYTICAL_RECOMMEND_INVEST" || status === "IC_READY" || status === "DEEP_DD") return "ADVANCE";
  if (status === "SCREEN_OUT" || status === "ANALYTICAL_RECOMMEND_PASS") return "PASS";
  return "DILIGENCE";
}

/* ------------------------------ Calibration ------------------------------ */

export interface Prediction {
  company: string;
  outcome: OutcomeClass;
  stance: Stance;
  oqi: number | null;
  contaminated: boolean;
}

export interface Calibration {
  n: number;
  confusion: Record<Stance, Record<OutcomeClass, number>>;
  /** P(outcome POSITIVE | stance). */
  positiveRateByStance: Record<Stance, number | null>;
  /** P(stance ADVANCE | outcome). */
  advanceRateByOutcome: Record<OutcomeClass, number | null>;
  /** Mean OQI by outcome. */
  oqiByOutcome: Record<OutcomeClass, number | null>;
  /** P(OQI of a random POSITIVE > OQI of a random NEGATIVE), ties ½ — null without both classes. */
  oqiAuc: number | null;
  baseRatePositive: number | null;
  warning: string | null;
}

const STANCES: Stance[] = ["ADVANCE", "DILIGENCE", "PASS"];
const OUTCOMES: OutcomeClass[] = ["POSITIVE", "NEUTRAL", "NEGATIVE", "UNKNOWN"];

export function calibrate(ps: Prediction[]): Calibration {
  const confusion = Object.fromEntries(STANCES.map((s) => [s, Object.fromEntries(OUTCOMES.map((o) => [o, 0]))])) as Calibration["confusion"];
  for (const p of ps) confusion[p.stance][p.outcome]++;
  const known = ps.filter((p) => p.outcome !== "UNKNOWN");
  const ratio = (a: number, b: number) => (b ? a / b : null);
  const positiveRateByStance = Object.fromEntries(STANCES.map((s) => [s, ratio(known.filter((p) => p.stance === s && p.outcome === "POSITIVE").length, known.filter((p) => p.stance === s).length)])) as Calibration["positiveRateByStance"];
  const advanceRateByOutcome = Object.fromEntries(OUTCOMES.map((o) => [o, ratio(ps.filter((p) => p.outcome === o && p.stance === "ADVANCE").length, ps.filter((p) => p.outcome === o).length)])) as Calibration["advanceRateByOutcome"];
  const oqiByOutcome = Object.fromEntries(
    OUTCOMES.map((o) => {
      const xs = ps.filter((p) => p.outcome === o && p.oqi !== null).map((p) => p.oqi!);
      return [o, xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null];
    }),
  ) as Calibration["oqiByOutcome"];
  const pos = ps.filter((p) => p.outcome === "POSITIVE" && p.oqi !== null).map((p) => p.oqi!);
  const neg = ps.filter((p) => p.outcome === "NEGATIVE" && p.oqi !== null).map((p) => p.oqi!);
  let auc: number | null = null;
  if (pos.length && neg.length) {
    let w = 0;
    for (const a of pos) for (const b of neg) w += a > b ? 1 : a === b ? 0.5 : 0;
    auc = w / (pos.length * neg.length);
  }
  return {
    n: ps.length,
    confusion,
    positiveRateByStance,
    advanceRateByOutcome,
    oqiByOutcome,
    oqiAuc: auc,
    baseRatePositive: ratio(known.filter((p) => p.outcome === "POSITIVE").length, known.length),
    warning: ps.length < 30 ? `n = ${ps.length}: descriptive only — far too few companies for any statistical claim about calibration.` : null,
  };
}

/* ------------------------------ Hindsight contamination ------------------------------ */

export interface ProbeAnswer {
  recognizes: boolean;
  statedOutcome: string | null;
}

/** Contaminated when the user declared the company famous, or the model says it recognises it / states an outcome. */
export function contamination(row: Pick<OutcomeRow, "famous">, probe: ProbeAnswer | null): { contaminated: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (row.famous) reasons.push("declared famous in the outcomes file");
  if (probe?.recognizes) reasons.push("the model says it recognises the company");
  if (probe?.statedOutcome && probe.statedOutcome.trim()) reasons.push(`the model states an outcome: "${probe.statedOutcome.trim().slice(0, 120)}"`);
  return { contaminated: reasons.length > 0, reasons };
}

/* ------------------------------ As-of re-anchoring ------------------------------ */

/** "2021-06" → 2021-06-30T23:59:59Z (end of month); "2021-06-15" → that day, end of day UTC. */
export function asOfDate(deckDate: string): Date {
  if (/^\d{4}-\d{2}$/.test(deckDate)) {
    const [y, m] = deckDate.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(y, m, 0, 23, 59, 59));
  }
  return new Date(`${deckDate}T23:59:59Z`);
}

/**
 * The analysis as it would have been computed on the deck date: raw metric
 * observations are re-normalised against `asOf` (staleness, periods, "future"
 * actuals) and the reference date of the deterministic engine is set to it.
 * Claim freshness labels assigned at extraction are not recomputed (documented limitation).
 */
export function reanchorAsOf(c: CanonicalDeal, asOf: Date): CanonicalDeal {
  let next = structuredClone(c);
  if (next.metricObservations?.length && next.financing) next = applyMetricsExtraction(next, { metrics: next.metricObservations, financing: next.financing, deckMarket: next.deckMarket ?? { tam: null, sam: null, som: null, description: null } }, asOf);
  next.analysis = { ...next.analysis, provenance: next.analysis.provenance ? { ...next.analysis.provenance, startedAt: asOf.toISOString() } : next.analysis.provenance };
  return next;
}
