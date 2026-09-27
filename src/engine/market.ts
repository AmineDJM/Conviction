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

const fmt = (n: number) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${n.toFixed(0)}`;
};

export function reconstructMarket(c: CanonicalDeal): MarketReconstruction {
  const ranges: MarketRange[] = [];
  const m = c.market;
  if (m?.bottomUp) {
    const b = m.bottomUp;
    const lo = Math.min(b.customerCountLow, b.customerCountHigh) * Math.min(b.annualSpendLowUsd, b.annualSpendHighUsd);
    const hi = Math.max(b.customerCountLow, b.customerCountHigh) * Math.max(b.annualSpendLowUsd, b.annualSpendHighUsd);
    if (hi > 0)
      ranges.push({
        method: "BOTTOM_UP",
        lowUsd: lo,
        highUsd: hi,
        formula: `${b.customerCountLow.toLocaleString("en-US")}–${b.customerCountHigh.toLocaleString("en-US")} ${b.customerDefinition} × ${fmt(b.annualSpendLowUsd)}–${fmt(b.annualSpendHighUsd)} / yr`,
        basis: b.spendBasis,
      });
  }
  const rejected: string[] = [];
  if (m?.valueCapture) {
    const v = m.valueCapture;
    const lo = v.economicValueCreatedLowUsd * (v.captureShareLowPct / 100);
    const hi = v.economicValueCreatedHighUsd * (v.captureShareHighPct / 100);
    // A serviceable market below $5M is almost always a per-customer figure mislabelled as a market.
    if (hi > 0 && hi < MIN_PLAUSIBLE_MARKET_USD) rejected.push(`VALUE_CAPTURE rejected: ${fmt(lo)}–${fmt(hi)} is below ${fmt(MIN_PLAUSIBLE_MARKET_USD)} (likely per-customer value, not a market)`);
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
