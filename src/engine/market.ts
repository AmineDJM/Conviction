/**
 * §32 Market reconstruction — the model supplies assumptions, code computes
 * ranges. The deck TAM is never accepted as the market size.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { toUsd } from "./metrics/normalize";

export interface MarketRange {
  method: "BOTTOM_UP" | "VALUE_CAPTURE" | "TOP_DOWN";
  lowUsd: number;
  highUsd: number;
  formula: string;
  basis: string;
}

export interface MarketReconstruction {
  ranges: MarketRange[];
  primary: MarketRange | null;
  /** Geometric midpoint of the primary range — used for scoring. */
  midpointUsd: number | null;
  deckTamUsd: number | null;
  /** deck TAM / reconstructed high; > 3 means the deck is likely inflating the market. */
  deckInflation: number | null;
  /** max(high)/min(low) across methods; > 10 means methods disagree materially. */
  methodDivergence: number | null;
  /** Ranges discarded by deterministic plausibility checks, with the reason. */
  rejected: string[];
}

export const MIN_PLAUSIBLE_MARKET_USD = 5_000_000;
/** Above this, a bottom-up "annual spend per customer" is almost certainly a total market figure. */
export const MAX_PLAUSIBLE_SPEND_PER_CUSTOMER_USD = 25_000_000;
/** No single-product serviceable market exceeds this; larger figures are unit errors. */
export const MAX_PLAUSIBLE_MARKET_USD = 2_000_000_000_000;

const fmt = (n: number) => {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
};

export function reconstructMarket(c: CanonicalDeal): MarketReconstruction {
  const ranges: MarketRange[] = [];
  const m = c.market;
  const rejected: string[] = [];
  if (m?.bottomUp) {
    const b = m.bottomUp;
    const cLo = Math.min(b.customerCountLow, b.customerCountHigh);
    const cHi = Math.max(b.customerCountLow, b.customerCountHigh);
    const sLo = Math.min(b.annualSpendLowUsd, b.annualSpendHighUsd);
    const sHi = Math.max(b.annualSpendLowUsd, b.annualSpendHighUsd);
    const perCustomer = `${cLo.toLocaleString("en-US")}–${cHi.toLocaleString("en-US")} ${b.customerDefinition} × ${fmt(sLo)}–${fmt(sHi)} / yr`;
    if (sHi > MAX_PLAUSIBLE_SPEND_PER_CUSTOMER_USD && cHi > 1) {
      // "Annual spend" of $125M–$1.2B per customer is a total market figure put in the per-customer field:
      // use it as the total when the implied spend per customer is plausible, never multiply it again.
      const impliedHi = sHi / Math.max(1, cLo);
      if (impliedHi <= MAX_PLAUSIBLE_SPEND_PER_CUSTOMER_USD && sHi >= MIN_PLAUSIBLE_MARKET_USD) {
        ranges.push({ method: "BOTTOM_UP", lowUsd: sLo, highUsd: sHi, formula: `${fmt(sLo)}–${fmt(sHi)} total annual spend across ${cLo.toLocaleString("en-US")}–${cHi.toLocaleString("en-US")} ${b.customerDefinition}`, basis: b.spendBasis });
        rejected.push(`BOTTOM_UP reinterpreted: ${fmt(sLo)}–${fmt(sHi)} was given as spend per customer but is a total (×${cHi.toLocaleString("en-US")} customers would give ${fmt(cHi * sHi)})`);
      } else rejected.push(`BOTTOM_UP rejected: ${perCustomer} — spend per customer above ${fmt(MAX_PLAUSIBLE_SPEND_PER_CUSTOMER_USD)} is implausible`);
    } else if (cHi * sHi > MAX_PLAUSIBLE_MARKET_USD) {
      rejected.push(`BOTTOM_UP rejected: ${perCustomer} = ${fmt(cHi * sHi)}, above ${fmt(MAX_PLAUSIBLE_MARKET_USD)} (unit error)`);
    } else if (cHi * sHi > 0) ranges.push({ method: "BOTTOM_UP", lowUsd: cLo * sLo, highUsd: cHi * sHi, formula: perCustomer, basis: b.spendBasis });
  }
  if (m?.valueCapture) {
    const v = m.valueCapture;
    const lo = v.economicValueCreatedLowUsd * (v.captureShareLowPct / 100);
    const hi = v.economicValueCreatedHighUsd * (v.captureShareHighPct / 100);
    // A serviceable market below $5M is almost always a per-customer figure mislabelled as a market.
    if (hi > 0 && hi < MIN_PLAUSIBLE_MARKET_USD) rejected.push(`VALUE_CAPTURE rejected: ${fmt(lo)}–${fmt(hi)} is below ${fmt(MIN_PLAUSIBLE_MARKET_USD)} (likely per-customer value, not a market)`);
    else if (hi > MAX_PLAUSIBLE_MARKET_USD) rejected.push(`VALUE_CAPTURE rejected: ${fmt(lo)}–${fmt(hi)} is above ${fmt(MAX_PLAUSIBLE_MARKET_USD)} (unit error)`);
    else if (hi > 0)
      ranges.push({
        method: "VALUE_CAPTURE",
        lowUsd: Math.min(lo, hi),
        highUsd: Math.max(lo, hi),
        formula: `${fmt(v.economicValueCreatedLowUsd)}–${fmt(v.economicValueCreatedHighUsd)} value created × ${v.captureShareLowPct}–${v.captureShareHighPct}% captured`,
        basis: v.basis,
      });
  }
  for (const r of [...ranges]) {
    if (r.method === "BOTTOM_UP" && r.highUsd < MIN_PLAUSIBLE_MARKET_USD) {
      ranges.splice(ranges.indexOf(r), 1);
      rejected.push(`BOTTOM_UP rejected: ${fmt(r.lowUsd)}–${fmt(r.highUsd)} is below ${fmt(MIN_PLAUSIBLE_MARKET_USD)}`);
    }
  }
  if (m?.topDown && m.topDown.highUsd > 0) {
    ranges.push({
      method: "TOP_DOWN",
      lowUsd: Math.min(m.topDown.lowUsd, m.topDown.highUsd),
      highUsd: Math.max(m.topDown.lowUsd, m.topDown.highUsd),
      formula: "Independent market estimates",
      basis: m.topDown.basis,
    });
  }
  const primary = ranges.find((r) => r.method === "BOTTOM_UP") ?? ranges.find((r) => r.method === "VALUE_CAPTURE") ?? ranges[0] ?? null;
  const midpointUsd = primary ? Math.sqrt(Math.max(primary.lowUsd, 1) * primary.highUsd) : null;

  let deckTamUsd: number | null = null;
  const tam = c.deckMarket.tam;
  if (tam?.amount) deckTamUsd = toUsd(tam.amount, tam.currency)?.usd ?? null;

  const deckInflation = deckTamUsd && primary ? deckTamUsd / primary.highUsd : null;
  const methodDivergence =
    ranges.length >= 2 ? Math.max(...ranges.map((r) => r.highUsd)) / Math.max(1, Math.min(...ranges.map((r) => r.lowUsd))) : null;

  return { ranges, primary, midpointUsd, deckTamUsd, deckInflation, methodDivergence, rejected };
}
