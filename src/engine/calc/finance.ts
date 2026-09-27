/**
 * Exact, dependency-free financial calculations. Every function here is
 * unit-tested (tests/calc.test.ts). The language model never computes these.
 */

export function moic(proceeds: number, invested: number): number | null {
  if (!(invested > 0)) return null;
  return proceeds / invested;
}

export interface CashFlow {
  /** Years from t0. */
  t: number;
  amount: number;
}

function npv(rate: number, flows: CashFlow[]): number {
  return flows.reduce((acc, f) => acc + f.amount / Math.pow(1 + rate, f.t), 0);
}

/**
 * Internal rate of return for irregular cash flows (annual compounding).
 * Returns null when no sign change exists or no root is bracketed.
 * Bisection is used deliberately: robust, monotone for conventional flows.
 */
export function irr(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;
  const hasNeg = flows.some((f) => f.amount < 0);
  const hasPos = flows.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) {
    // Total loss: IRR is -100%.
    if (hasNeg && !hasPos) return -1;
    return null;
  }
  let lo = -0.999999;
  let hi = 10;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);
  // Expand upper bound for extreme outcomes.
  while (fLo * fHi > 0 && hi < 1e4) {
    hi *= 4;
    fHi = npv(hi, flows);
  }
  if (fLo * fHi > 0) return null;
  for (let i = 0; i < 300; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (Math.abs(fMid) < 1e-9 || hi - lo < 1e-12) return mid;
    if (fLo * fMid < 0) {
      hi = mid;
      fHi = fMid;
    } else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

/** Compound annual growth rate between two values over `years`. */
export function cagr(start: number, end: number, years: number): number | null {
  if (!(start > 0) || !(end >= 0) || !(years > 0)) return null;
  return Math.pow(end / start, 1 / years) - 1;
}

/** Compounded average monthly growth. */
export function cmgr(start: number, end: number, months: number): number | null {
  if (!(start > 0) || !(end >= 0) || !(months > 0)) return null;
  return Math.pow(end / start, 1 / months) - 1;
}

export function runwayMonths(cash: number, monthlyNetBurn: number): number | null {
  if (!(cash >= 0)) return null;
  if (!(monthlyNetBurn > 0)) return null; // cash-flow positive → runway not meaningful
  return cash / monthlyNetBurn;
}

/** Burn multiple = net burn / net new ARR over the same period. */
export function burnMultiple(netBurnOverPeriod: number, netNewArrOverPeriod: number): number | null {
  if (!(netNewArrOverPeriod > 0)) return null;
  if (netBurnOverPeriod < 0) return 0;
  return netBurnOverPeriod / netNewArrOverPeriod;
}

/** Gross-margin-adjusted CAC payback in months. grossMarginPct in percent units. */
export function cacPaybackMonths(cac: number, annualContractValue: number, grossMarginPct: number): number | null {
  if (!(cac >= 0) || !(annualContractValue > 0) || !(grossMarginPct > 0)) return null;
  return cac / ((annualContractValue / 12) * (grossMarginPct / 100));
}

/** NRR in percent units from cohort components. */
export function nrr(startArr: number, expansion: number, contraction: number, churn: number): number | null {
  if (!(startArr > 0)) return null;
  return ((startArr + expansion - contraction - churn) / startArr) * 100;
}

export function grr(startArr: number, contraction: number, churn: number): number | null {
  if (!(startArr > 0)) return null;
  return Math.min(100, ((startArr - contraction - churn) / startArr) * 100);
}

/** LTV with annual revenue churn in percent units. */
export function ltv(acv: number, grossMarginPct: number, annualChurnPct: number): number | null {
  if (!(acv > 0) || !(grossMarginPct > 0) || !(annualChurnPct > 0)) return null;
  return (acv * (grossMarginPct / 100)) / (annualChurnPct / 100);
}

export function ratio(a: number | null | undefined, b: number | null | undefined): number | null {
  if (a === null || a === undefined || b === null || b === undefined || b === 0) return null;
  return a / b;
}

export function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
