/**
 * §43–44 Capital-to-milestone map and financing risk. Deterministic.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "./benchmarks/types";
import { toUsd } from "./metrics/normalize";

export interface FinancingEvent {
  month: number;
  label: string;
  kind: "NOW" | "ROUND" | "MILESTONE" | "RAISE_START" | "CASH_OUT";
}

export interface DelayScenario {
  delayMonths: number;
  cashOutBeforeRaise: boolean;
  shortfallMonths: number;
  bridgeNeededUsd: number;
}

export interface FinancingMap {
  cashUsd: number | null;
  raiseUsd: number | null;
  monthlyBurnUsd: number | null;
  burnSource: "PLANNED" | "CURRENT" | "UNKNOWN";
  runwayAfterRoundMonths: number | null;
  proofPurchased: string | null;
  milestoneMonths: number | null;
  requiredMonths: number | null;
  bufferMonths: number | null;
  delays: DelayScenario[];
  events: FinancingEvent[];
  risk: "LOW" | "MODERATE" | "HIGH" | "CRITICAL" | "UNKNOWN";
  explanation: string;
}

export function financingMap(deal: CanonicalDeal, registry: BenchmarkRegistry): FinancingMap {
  const f = deal.financing;
  const usd = (m: { amount: number | null; currency: string } | null | undefined) =>
    m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null;

  const cashMetric = deal.metrics.find((m) => m.metricKey === "cash_balance" && m.isPrimary)?.normalizedValue ?? null;
  const burnMetric = deal.metrics.find((m) => m.metricKey === "monthly_net_burn" && m.isPrimary)?.normalizedValue ?? null;
  const cashUsd = usd(f?.cashBalance) ?? cashMetric;
  const raiseUsd = usd(f?.raiseAmount);
  const planned = deal.financingPath?.plannedMonthlyBurnUsd ?? null;
  const current = usd(f?.monthlyBurn) ?? burnMetric;
  const monthlyBurnUsd = planned ?? current;
  const burnSource = planned ? "PLANNED" : current ? "CURRENT" : "UNKNOWN";
  const milestoneMonths = deal.financingPath?.milestoneMonths ?? null;
  const lead = registry.returns.fundraisingLeadMonths;

  const runwayAfterRoundMonths =
    monthlyBurnUsd && monthlyBurnUsd > 0 && (cashUsd !== null || raiseUsd !== null)
      ? ((cashUsd ?? 0) + (raiseUsd ?? 0)) / monthlyBurnUsd
      : null;
  const requiredMonths = milestoneMonths !== null ? milestoneMonths + lead : null;
  const bufferMonths = runwayAfterRoundMonths !== null && requiredMonths !== null ? runwayAfterRoundMonths - requiredMonths : null;

  const delays: DelayScenario[] = registry.returns.delayScenariosMonths.map((d) => {
    if (runwayAfterRoundMonths === null || requiredMonths === null || !monthlyBurnUsd)
      return { delayMonths: d, cashOutBeforeRaise: false, shortfallMonths: 0, bridgeNeededUsd: 0 };
    const shortfall = Math.max(0, requiredMonths + d - runwayAfterRoundMonths);
    return { delayMonths: d, cashOutBeforeRaise: shortfall > 0, shortfallMonths: shortfall, bridgeNeededUsd: shortfall * monthlyBurnUsd };
  });

  const events: FinancingEvent[] = [{ month: 0, label: "Today", kind: "NOW" }];
  if (raiseUsd) events.push({ month: 0, label: `Round closes (+$${(raiseUsd / 1e6).toFixed(1)}M)`, kind: "ROUND" });
  if (milestoneMonths !== null) {
    events.push({ month: milestoneMonths, label: deal.financingPath?.proofPurchased ?? "Milestone", kind: "MILESTONE" });
    events.push({ month: Math.max(0, milestoneMonths), label: "Start next raise", kind: "RAISE_START" });
  }
  if (runwayAfterRoundMonths !== null) events.push({ month: runwayAfterRoundMonths, label: "Cash out (no new money)", kind: "CASH_OUT" });
  events.sort((a, b) => a.month - b.month);

  let risk: FinancingMap["risk"] = "UNKNOWN";
  let explanation = "Insufficient cash, burn or milestone data to build the capital-to-milestone map.";
  if (bufferMonths !== null) {
    const d6 = delays.find((d) => d.delayMonths === 6);
    const d12 = delays.find((d) => d.delayMonths === 12);
    if (bufferMonths < 0) risk = "CRITICAL";
    else if (d6?.cashOutBeforeRaise) risk = "HIGH";
    else if (d12?.cashOutBeforeRaise) risk = "MODERATE";
    else risk = "LOW";
    explanation = `Runway after the round ≈ ${runwayAfterRoundMonths!.toFixed(0)} months at $${(monthlyBurnUsd! / 1e3).toFixed(0)}k/month (${burnSource.toLowerCase()} burn). Milestone at ${milestoneMonths} months + ${lead} months to raise = ${requiredMonths} months required → buffer ${bufferMonths.toFixed(1)} months.`;
  } else if (runwayAfterRoundMonths !== null) {
    explanation = `Runway after the round ≈ ${runwayAfterRoundMonths.toFixed(0)} months; milestone timing unknown.`;
  }
  return {
    cashUsd,
    raiseUsd,
    monthlyBurnUsd,
    burnSource,
    runwayAfterRoundMonths,
    proofPurchased: deal.financingPath?.proofPurchased ?? null,
    milestoneMonths,
    requiredMonths,
    bufferMonths,
    delays,
    events,
    risk,
    explanation,
  };
}
