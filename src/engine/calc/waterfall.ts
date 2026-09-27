/**
 * Liquidation preference waterfall.
 *
 * Debt is repaid first. Preferred classes are paid by seniority (pari passu
 * within a tier). Non-participating preferred converts to common when that
 * yields more; this is solved iteratively until no class changes its choice.
 * Participating preferred takes its preference and then shares as-converted.
 */
import type { CapTable } from "./captable";

export interface WaterfallClass {
  name: string;
  /** As-converted shares. */
  shares: number;
  /** Preference amount (invested × multiple). 0 for common. */
  preference: number;
  participating: boolean;
  seniority: number;
}

export interface WaterfallResult {
  byClass: Record<string, number>;
  converted: Record<string, boolean>;
  debtRepaid: number;
}

export function runWaterfall(exitValue: number, classes: WaterfallClass[], debt = 0): WaterfallResult {
  const debtRepaid = Math.min(Math.max(exitValue, 0), debt);
  const equity = Math.max(0, exitValue - debtRepaid);
  const prefClasses = classes.filter((c) => c.preference > 0);
  const converted: Record<string, boolean> = {};
  for (const c of prefClasses) converted[c.name] = false;

  let result: Record<string, number> = {};
  for (let iter = 0; iter < 50; iter++) {
    result = distribute(equity, classes, converted);
    let changed = false;
    for (const c of prefClasses) {
      if (c.participating) continue;
      // Would this class be better off flipping its choice (holding others fixed)?
      const alt = { ...converted, [c.name]: !converted[c.name] };
      const altResult = distribute(equity, classes, alt);
      if ((altResult[c.name] ?? 0) > (result[c.name] ?? 0) + 1e-9) {
        converted[c.name] = !converted[c.name];
        changed = true;
      }
    }
    if (!changed) break;
  }
  return { byClass: result, converted, debtRepaid };
}

function distribute(equity: number, classes: WaterfallClass[], converted: Record<string, boolean>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of classes) out[c.name] = 0;
  let remaining = equity;

  // 1. Preferences by seniority tiers (desc), pari passu within tier.
  const takingPref = classes.filter((c) => c.preference > 0 && (c.participating || !converted[c.name]));
  const tiers = [...new Set(takingPref.map((c) => c.seniority))].sort((a, b) => b - a);
  for (const tier of tiers) {
    const tierClasses = takingPref.filter((c) => c.seniority === tier);
    const tierPref = tierClasses.reduce((a, c) => a + c.preference, 0);
    const paid = Math.min(remaining, tierPref);
    for (const c of tierClasses) out[c.name]! += tierPref > 0 ? (paid * c.preference) / tierPref : 0;
    remaining -= paid;
  }

  // 2. Residual pro rata among common, converted preferred, and participating preferred.
  const sharing = classes.filter((c) => c.preference === 0 || converted[c.name] || c.participating);
  const shareTotal = sharing.reduce((a, c) => a + c.shares, 0);
  if (shareTotal > 0 && remaining > 0) {
    for (const c of sharing) out[c.name]! += (remaining * c.shares) / shareTotal;
  }
  return out;
}

/** Convenience: build waterfall classes per holder from a cap table and run it. */
export function waterfallFromCapTable(ct: CapTable, exitValue: number): Record<string, number> {
  const classByName = new Map(ct.classes.map((c) => [c.name, c]));
  // Each holder-class pair is a waterfall line, so holders' payouts can be summed.
  const lines: WaterfallClass[] = ct.holdings.map((h) => {
    const cls = classByName.get(h.className)!;
    const isPref = cls.type === "PREFERRED";
    return {
      name: `${h.holder}::${h.className}`,
      shares: h.shares,
      preference: isPref ? h.shares * cls.originalIssuePrice * cls.liquidationPrefMultiple : 0,
      participating: isPref && cls.participating,
      seniority: cls.seniority,
    };
  });
  const debt = ct.debt.reduce((a, d) => a + d.principal, 0);
  const res = runWaterfall(exitValue, lines, debt);
  const byHolder: Record<string, number> = {};
  for (const [k, v] of Object.entries(res.byClass)) {
    const holder = k.split("::")[0]!;
    byHolder[holder] = (byHolder[holder] ?? 0) + v;
  }
  for (const d of ct.debt) byHolder[d.holder] = (byHolder[d.holder] ?? 0) + (d.principal / Math.max(debt, 1)) * res.debtRepaid;
  return byHolder;
}
