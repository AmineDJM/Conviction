/**
 * §9 RESOURCE EFFICIENCY — output per unit of time, capital and headcount.
 * Execution efficiency proxy: raw ratios, no benchmark distribution.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { LatentEvidence, LatentModule } from "./types";
import { bases, coverage, currentValue, fmtUsd, moneyUsd, pagesOf, parseScaled, round } from "./util";

export interface EfficiencyInputs {
  monthsSinceFounding: number | null;
  capitalRaisedUsd: number | null;
  fte: number | null;
  arrUsd: number | null;
}

export interface EfficiencyRatios {
  /** ARR per $1 raised. */
  arrPerDollarRaised: number | null;
  /** ARR added per month of existence (USD). */
  arrPerMonth: number | null;
  /** ARR per full-time employee (USD). */
  arrPerFte: number | null;
  /** Capital raised per full-time employee (USD). */
  capitalPerFte: number | null;
  /** Capital raised per month of existence (USD). */
  capitalPerMonth: number | null;
}

export interface ResourceEfficiency extends LatentModule {
  label: string;
  inputs: EfficiencyInputs & { arrSource: string | null; capitalSource: string | null; foundedYear: number | null; asOf: string };
  ratios: EfficiencyRatios;
  evidence: LatentEvidence[];
  readings: string[];
}

export const EFFICIENCY_LABEL = "Execution efficiency proxy — raw ratios, no benchmark distribution";

const div = (a: number | null, b: number | null, dp = 2) => (a !== null && b !== null && b > 0 ? round(a / b, dp) : null);

export function efficiencyRatios(i: EfficiencyInputs): EfficiencyRatios {
  return {
    arrPerDollarRaised: div(i.arrUsd, i.capitalRaisedUsd, 3),
    arrPerMonth: div(i.arrUsd, i.monthsSinceFounding, 0),
    arrPerFte: div(i.arrUsd, i.fte, 0),
    capitalPerFte: div(i.capitalRaisedUsd, i.fte, 0),
    capitalPerMonth: div(i.capitalRaisedUsd, i.monthsSinceFounding, 0),
  };
}

/** Compare two companies ratio by ratio: +1 when A is more efficient, −1 when B is, 0 when equal or not comparable. */
export function compareEfficiency(a: EfficiencyRatios, b: EfficiencyRatios): Record<keyof EfficiencyRatios, -1 | 0 | 1> {
  const cmp = (x: number | null, y: number | null, higherBetter: boolean): -1 | 0 | 1 => {
    if (x === null || y === null || x === y) return 0;
    return (x > y) === higherBetter ? 1 : -1;
  };
  return {
    arrPerDollarRaised: cmp(a.arrPerDollarRaised, b.arrPerDollarRaised, true),
    arrPerMonth: cmp(a.arrPerMonth, b.arrPerMonth, true),
    arrPerFte: cmp(a.arrPerFte, b.arrPerFte, true),
    capitalPerFte: cmp(a.capitalPerFte, b.capitalPerFte, false),
    capitalPerMonth: cmp(a.capitalPerMonth, b.capitalPerMonth, false),
  };
}

/** Months since founding; foundedYear only → founding assumed on 1 July of that year. */
export function monthsSinceFounding(foundedYear: number | null | undefined, asOf: Date): number | null {
  if (!foundedYear || foundedYear < 1900) return null;
  const m = (asOf.getUTCFullYear() - foundedYear) * 12 + (asOf.getUTCMonth() - 6);
  return m > 0 ? m : null;
}

function capitalRaised(deal: CanonicalDeal): { usd: number; source: string } | null {
  const total = moneyUsd(deal.financing?.totalRaisedToDate);
  if (total !== null && total > 0) return { usd: total, source: `total raised to date (${deal.financing!.totalRaisedToDate!.rawText})` };
  // Sum of known prior rounds from FUNDING claims (distinct values only).
  const seen = new Set<number>();
  let sum = 0;
  for (const c of deal.claims ?? []) {
    if (c.category !== "FUNDING" || !/\braised\b|\bround\b|\bseed\b|\bseries\b|\bpre-?seed\b/i.test(c.statement) || /\braising\b|\bseeking\b|\bthis round\b/i.test(c.statement)) continue;
    const v = parseScaled(c.valueText ?? "");
    if (v !== null && v >= 10_000 && !seen.has(v)) {
      seen.add(v);
      sum += v;
    }
  }
  return sum > 0 ? { usd: sum, source: `sum of ${seen.size} prior round(s) from funding claims` } : null;
}

export function resourceEfficiency(deal: CanonicalDeal, asOf: Date): ResourceEfficiency {
  const months = monthsSinceFounding(deal.identity?.foundedYear, asOf);
  const cap = capitalRaised(deal);
  const fte = currentValue(deal, "headcount");
  const arr = currentValue(deal, "arr");
  const rev = arr ? null : currentValue(deal, "revenue_ttm");
  const mrr = arr || rev ? null : currentValue(deal, "mrr");
  const arrUsd = arr?.value ?? rev?.value ?? (mrr ? mrr.value * 12 : null);
  const arrSource = arr ? `ARR ${arr.source}` : rev ? `revenue TTM ${rev.source}` : mrr ? `MRR × 12 ${mrr.source}` : null;
  const inputs: EfficiencyInputs = { monthsSinceFounding: months, capitalRaisedUsd: cap?.usd ?? null, fte: fte?.value ?? null, arrUsd };
  const ratios = efficiencyRatios(inputs);
  const readings: string[] = [];
  if (ratios.arrPerDollarRaised !== null) readings.push(`${fmtUsd(ratios.arrPerDollarRaised)} of ARR per $1 raised (${fmtUsd(arrUsd)} on ${fmtUsd(cap?.usd)})`);
  if (ratios.arrPerMonth !== null) readings.push(`${fmtUsd(ratios.arrPerMonth)} of ARR per month of existence (${months} months)`);
  if (ratios.arrPerFte !== null) readings.push(`${fmtUsd(ratios.arrPerFte)} of ARR per FTE (${fte!.value} FTE)`);
  if (ratios.capitalPerFte !== null) readings.push(`${fmtUsd(ratios.capitalPerFte)} raised per FTE`);
  const evidence: LatentEvidence[] = [
    arrSource ? { basis: "COMPUTED", text: `Output: ${arrSource}`, page: arr?.page ?? rev?.page ?? mrr?.page ?? null } : null,
    cap ? { basis: "COMPUTED", text: `Capital: ${cap.source}`, page: null } : null,
    fte ? { basis: "COMPUTED", text: `Headcount: ${fte.source}`, page: fte.page } : null,
    months !== null ? { basis: "COMPUTED", text: `Founded ${deal.identity.foundedYear} (assumed mid-year) → ${months} months to ${asOf.toISOString().slice(0, 10)}`, page: null } : null,
  ].filter((x): x is LatentEvidence => !!x);
  return {
    basis: bases("COMPUTED"),
    pages: pagesOf(evidence.map((e) => e.page)),
    coverage: coverage(
      [months !== null ? "founding year" : null, cap ? "capital raised" : null, fte ? "headcount" : null, arrUsd !== null ? "ARR / revenue" : null].filter((x): x is string => !!x),
      [months !== null ? null : "founding year", cap ? null : "capital raised", fte ? null : "headcount", arrUsd !== null ? null : "ARR / revenue"].filter((x): x is string => !!x),
      EFFICIENCY_LABEL,
    ),
    rule: "Raw ratios: ARR / capital raised, ARR / months since founding (founding assumed 1 July of the founded year), ARR / FTE, capital / FTE, capital / month. ARR falls back to revenue TTM, then MRR × 12; capital falls back to the sum of prior rounds in funding claims. No benchmark distribution is applied.",
    label: EFFICIENCY_LABEL,
    inputs: { ...inputs, arrSource, capitalSource: cap?.source ?? null, foundedYear: deal.identity?.foundedYear ?? null, asOf: asOf.toISOString().slice(0, 10) },
    ratios,
    evidence,
    readings,
  };
}
