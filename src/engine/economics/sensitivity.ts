/**
 * DECISION SENSITIVITY MAP — "what to verify first".
 *
 * For each quantitative driver, the exact value at which the investment case
 * breaks, solved by bisection over the deterministic cap-table model (or in
 * closed form where the model is linear). Merged with the model-proposed
 * sensitivity drivers of the canonical deal. Rows are sorted by the smallest
 * margin to the breakpoint: the most fragile assumption comes first.
 */
import type { SensitivityDriver } from "@/domain/sections";
import { financingMap } from "../financing";
import { buildProFormaPath, preferenceStack, roundsForScenario, scenarioEvaluator } from "./captable-returns";
import type { EconomicsInputs, EconomicsState, Scenario } from "./inputs";
import { solveMonotone } from "./solve";
import type { TrajectoryResult } from "./trajectory";

export type SensitivityUnit = "USD" | "USD_PER_MONTH" | "PCT" | "MONTHS" | "MULTIPLE" | "TEXT";

export interface SensitivityRow {
  id: string;
  variable: string;
  metricKey: string | null;
  current: number | string | null;
  breaksAt: number | string | null;
  unit: SensitivityUnit;
  /** Distance from current to breakpoint in the breaking direction, % of current. Negative = already broken. Null = not computable. */
  margin: number | null;
  method: "COMPUTED" | "MODEL";
  /** BREAKS_ABOVE: the case breaks if the variable rises above `breaksAt`. */
  direction: "BREAKS_ABOVE" | "BREAKS_BELOW" | "UNKNOWN";
  why: string;
  broken: boolean | null;
  /** Model-proposed drivers attached to this computed row (same metric). */
  modelViews: { variable: string; currentAssumption: string; breaksAt: string; why: string }[];
}

export interface SensitivityMap {
  rows: SensitivityRow[];
  verifyFirst: string[];
  notes: string[];
}

/** Outcome of one scenario without IRR (fast path for solvers). */
export function scenarioOutcome(inp: EconomicsInputs, s: Scenario): { moic: number; proceedsUsd: number; investedUsd: number; exitOwnership: number } | null {
  const rounds = roundsForScenario(inp, s);
  const path = buildProFormaPath(inp, rounds);
  if (!path) return null;
  const ev = scenarioEvaluator(path, inp, rounds, inp.exits[s].years);
  const proceeds = ev.proceedsAt(inp.exits[s].exitEquityUsd);
  if (!Number.isFinite(proceeds) || !Number.isFinite(ev.investedUsd)) return null;
  return { moic: proceeds / ev.investedUsd, proceedsUsd: proceeds, investedUsd: ev.investedUsd, exitOwnership: ev.exitOwnership };
}

export function marginPct(current: number, breaksAt: number, direction: "BREAKS_ABOVE" | "BREAKS_BELOW"): number {
  const denom = Math.abs(current) > 1e-12 ? Math.abs(current) : 1;
  return ((direction === "BREAKS_ABOVE" ? breaksAt - current : current - breaksAt) / denom) * 100;
}

const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}k`);

function row(p: Omit<SensitivityRow, "margin" | "broken" | "modelViews" | "method"> & { method?: SensitivityRow["method"]; margin?: number | null }): SensitivityRow {
  let margin = p.margin ?? null;
  if (margin === null) {
    if (typeof p.current === "number" && typeof p.breaksAt === "number" && p.direction !== "UNKNOWN") margin = marginPct(p.current, p.breaksAt, p.direction);
  }
  return { ...p, method: p.method ?? "COMPUTED", margin, broken: margin === null ? null : margin < 0, modelViews: [] };
}

/** Metric keys (and aliases) each computed row answers for, used to attach model-proposed drivers. */
const ALIASES: Record<string, string[]> = {
  ENTRY_VALUATION: ["post_money", "pre_money", "valuation", "entry_valuation", "valuation_cap"],
  OUTLIER_EXIT_OWNERSHIP: ["exit_ownership", "ownership"],
  DILUTION_PER_ROUND: ["dilution", "dilution_per_round"],
  BASE_EXIT: ["exit_multiple", "revenue_multiple", "exit_value"],
  SAM: ["sam", "market_size", "serviceable_market"],
  MONTHLY_BURN: ["monthly_net_burn", "runway_months", "cash_balance"],
  MILESTONE_TIMING: ["months_to_next_milestone", "capital_to_next_milestone"],
  CAC: ["cac", "cac_payback_months", "ltv_to_cac"],
  NRR: ["nrr"],
};

function aliasGroup(id: string): string {
  if (id.startsWith("ENTRY_VALUATION_")) return "ENTRY_VALUATION";
  if (id.startsWith("SAM_")) return "SAM";
  return id;
}

export function sensitivityMap(state: EconomicsState, trajectory: TrajectoryResult | null, drivers: SensitivityDriver[] = state.deal.sensitivityDrivers): SensitivityMap {
  const rows: SensitivityRow[] = [];
  const notes: string[] = [];
  const inp = state.inputs;
  const a = inp.a;
  const it = { iterations: a.bisectionIterations, relTol: 1e-7 };
  const fund = state.fund;

  if (state.modelable) {
    const baseAt = (patch: Partial<EconomicsInputs>) => scenarioOutcome({ ...inp, ...patch }, "BASE");
    const current = inp.postMoneyUsd!;
    const cur = baseAt({});
    // 1. Entry valuation at which base MOIC falls below the targets.
    const targets = [...new Set([fund.targetFundMultiple, 3, 10])].sort((x, y) => x - y);
    // Lowest price searched: the round buys 80% of the company (a pre-money of a quarter of the round).
    const lo = inp.instrument === "CONVERTIBLE_NOTE" ? inp.raiseUsd * 0.25 : inp.raiseUsd * 1.25;
    const hi = Math.max(current, lo) * 1000;
    for (const m of targets) {
      const f = (post: number) => (baseAt({ postMoneyUsd: post })?.moic ?? 0) - m;
      const id = `ENTRY_VALUATION_${m}X`;
      const variable = `Entry ${inp.instrument === "SAFE" || inp.instrument === "CONVERTIBLE_NOTE" ? "valuation cap" : "post-money"} (base MOIC ≥ ${m}×)`;
      const why = `Highest price at which the BASE case still returns ${m}× gross (cap-table model, dilution and preferences included)${m === fund.targetFundMultiple ? " — the fund's target multiple" : ""}.`;
      // MOIC ∝ 1/price when converting: the scaled price is an excellent first guess.
      const guess = cur && cur.moic > 0 ? (current * cur.moic) / m : current;
      const sol = solveMonotone(f, guess, lo, hi, { ...it, log: true, increasing: false });
      if (sol.outOfRange === "BELOW_LO")
        rows.push(row({ id, variable, metricKey: "post_money", current, breaksAt: null, unit: "USD", direction: "BREAKS_ABOVE", margin: -100, why: `${why} Not achievable at any searched price (down to a pre-money of 25% of the round) under the BASE exit.` }));
      else rows.push(row({ id, variable, metricKey: "post_money", current, breaksAt: sol.root, unit: "USD", direction: "BREAKS_ABOVE", why }));
    }

    // 2. Exit ownership at which the OUTLIER case can no longer return the target contribution.
    const outlier = scenarioOutcome(inp, "OUTLIER");
    const E = inp.exits.OUTLIER.exitEquityUsd;
    if (outlier && E > 0) {
      rows.push(
        row({
          id: "OUTLIER_EXIT_OWNERSHIP",
          variable: "Exit ownership (OUTLIER returns the target contribution)",
          metricKey: "exit_ownership",
          current: outlier.exitOwnership * 100,
          breaksAt: (fund.targetDealReturnUsd / E) * 100,
          unit: "PCT",
          direction: "BREAKS_BELOW",
          why: `Returning ${fmtUsd(fund.targetDealReturnUsd)} from a ${fmtUsd(E)} outlier exit needs ownership ≥ target ÷ exit (all preferred convert at that size).`,
        }),
      );
    }

    // 3. Uniform dilution per future round tolerated before base MOIC < fund target.
    const nBase = roundsForScenario(inp, "BASE");
    if (nBase > 0 && cur) {
      const baseRounds = inp.futureRounds.slice(0, nBase);
      const curDil = baseRounds.reduce((s, r) => s + r.dilutionPct, 0) / baseRounds.length;
      const m = fund.targetFundMultiple;
      const DMAX = 80;
      const f = (d: number) => (baseAt({ futureRounds: inp.futureRounds.map((r) => ({ ...r, dilutionPct: d })) })?.moic ?? 0) - m;
      const why = `Uniform new-money dilution per future round at which the BASE case drops below the fund's ${m}× target (pool refresh on top).`;
      const sol = solveMonotone(f, curDil, 0, DMAX, { ...it, increasing: false });
      if (sol.outOfRange === "BELOW_LO")
        rows.push(row({ id: "DILUTION_PER_ROUND", variable: "Dilution per future round", metricKey: "dilution", current: curDil, breaksAt: null, unit: "PCT", direction: "BREAKS_ABOVE", margin: -100, why: `${why} Below target even with zero dilution.` }));
      else rows.push(row({ id: "DILUTION_PER_ROUND", variable: "Dilution per future round", metricKey: "dilution", current: curDil, breaksAt: sol.root, unit: "PCT", direction: "BREAKS_ABOVE", why }));
    }

    // 4. Base exit value / multiple at which base MOIC < 1×.
    const Eb = inp.exits.BASE.exitEquityUsd;
    const pathB = buildProFormaPath(inp, nBase);
    if (pathB && Eb > 0) {
      const ev = scenarioEvaluator(pathB, inp, nBase, inp.exits.BASE.years);
      // Proceeds are flat at exactly 1× between "stack covered" and "we convert" (1x non-participating), so solve
      // for a hair below 1×: the breakpoint is the lower edge of that plateau, where MOIC starts falling below 1×.
      const stack = preferenceStack(ev.exitCt);
      const star = solveMonotone((e) => ev.proceedsAt(e) - ev.investedUsd * (1 - 1e-7), stack > 0 ? stack : Eb, 0, Math.max(Eb, ev.investedUsd) * 1e4, { ...it, increasing: true }).root;
      const mult = inp.exits.BASE.revenueMultiple;
      const why = "BASE-case exit below which we lose money (MOIC < 1×) after the preference stack.";
      if (star !== null) {
        if (mult) rows.push(row({ id: "BASE_EXIT", variable: "Base exit revenue multiple (MOIC ≥ 1×)", metricKey: "exit_multiple", current: mult, breaksAt: (star / Eb) * mult, unit: "MULTIPLE", direction: "BREAKS_BELOW", why }));
        else rows.push(row({ id: "BASE_EXIT", variable: "Base exit equity value (MOIC ≥ 1×)", metricKey: "exit_value", current: Eb, breaksAt: star, unit: "USD", direction: "BREAKS_BELOW", why }));
      }
    }
  } else notes.push(...state.reasons.map((r) => `Valuation-dependent breakpoints skipped: ${r}`));

  // 5. SAM at which the required SAM share becomes HEROIC / IMPLAUSIBLE.
  if (trajectory?.modelable && trajectory.requiredExitEquityUsd) {
    const R = trajectory.requiredExitEquityUsd / trajectory.referenceMultiple;
    const t = state.registry.returns.samSharePlausibility;
    const sam = state.samHighUsd;
    for (const [id, label, thr] of [
      ["SAM_HEROIC", "HEROIC", t.DEMANDING],
      ["SAM_IMPLAUSIBLE", "IMPLAUSIBLE", t.HEROIC],
    ] as const) {
      rows.push(
        row({
          id,
          variable: `Reconstructed SAM (required share turns ${label})`,
          metricKey: "sam",
          current: sam,
          breaksAt: R / (thr / 100),
          unit: "USD",
          direction: "BREAKS_BELOW",
          why: `Returning ${fmtUsd(trajectory.target.requiredProceedsUsd ?? 0)} needs ${fmtUsd(R)} revenue at ${trajectory.referenceMultiple}×; above ${thr}% of SAM that is ${label}.`,
        }),
      );
    }
  }

  // 6. Runway: burn increase / milestone delay before cash runs out ahead of the next raise.
  const fm = financingMap(state.deal, state.registry);
  if (fm.runwayAfterRoundMonths !== null && fm.requiredMonths !== null && fm.monthlyBurnUsd) {
    const capital = fm.runwayAfterRoundMonths * fm.monthlyBurnUsd;
    rows.push(
      row({
        id: "MONTHLY_BURN",
        variable: "Monthly net burn (cash lasts to the next raise)",
        metricKey: "monthly_net_burn",
        current: fm.monthlyBurnUsd,
        breaksAt: capital / fm.requiredMonths,
        unit: "USD_PER_MONTH",
        direction: "BREAKS_ABOVE",
        why: `${fmtUsd(capital)} of cash after the round must cover ${fm.requiredMonths} months (milestone ${fm.milestoneMonths} + ${state.registry.returns.fundraisingLeadMonths} to raise).`,
      }),
    );
    rows.push(
      row({
        id: "MILESTONE_TIMING",
        variable: "Months to the financing milestone",
        metricKey: "months_to_next_milestone",
        current: fm.milestoneMonths,
        breaksAt: fm.runwayAfterRoundMonths - state.registry.returns.fundraisingLeadMonths,
        unit: "MONTHS",
        direction: "BREAKS_ABOVE",
        why: `Runway ${fm.runwayAfterRoundMonths.toFixed(1)} months minus ${state.registry.returns.fundraisingLeadMonths} months of fundraising lead time.`,
      }),
    );
  } else notes.push("Runway breakpoints need cash, burn and milestone timing.");

  // 7. CAC that breaks the payback threshold.
  const op = state.op;
  const P = a.cacPaybackThresholdMonths;
  if (op.cacUsd !== null && op.arpaUsd && op.grossMarginPct) {
    rows.push(
      row({
        id: "CAC",
        variable: `CAC (payback ≤ ${P} months)`,
        metricKey: "cac",
        current: op.cacUsd,
        breaksAt: P * (op.arpaUsd / 12) * (op.grossMarginPct / 100),
        unit: "USD",
        direction: "BREAKS_ABOVE",
        why: `CAC at which gross-margin-adjusted payback reaches ${P} months at ${fmtUsd(op.arpaUsd)} ARPA and ${op.grossMarginPct}% gross margin (${op.cacSource}).`,
      }),
    );
  } else if (op.cacPaybackMonths !== null) {
    rows.push(
      row({ id: "CAC", variable: "CAC payback (months)", metricKey: "cac_payback_months", current: op.cacPaybackMonths, breaksAt: P, unit: "MONTHS", direction: "BREAKS_ABOVE", why: `Payback above ${P} months breaks acquisition economics.` }),
    );
  }

  // 8. NRR threshold.
  if (op.nrrPct !== null) {
    rows.push(
      row({
        id: "NRR",
        variable: "Net revenue retention",
        metricKey: "nrr",
        current: op.nrrPct,
        breaksAt: a.nrrThresholdPct,
        unit: "PCT",
        direction: "BREAKS_BELOW",
        why: `Below ${a.nrrThresholdPct}% the installed base shrinks: every dollar of growth must come from new logos.`,
      }),
    );
  }

  // Merge the model-proposed drivers.
  for (const d of drivers) {
    const key = d.metricKey?.toLowerCase() ?? null;
    const target = key ? rows.find((r) => r.method === "COMPUTED" && (r.metricKey === key || (ALIASES[aliasGroup(r.id)] ?? []).includes(key))) : undefined;
    const view = { variable: d.variable, currentAssumption: d.currentAssumption, breaksAt: d.breaksAt, why: d.why };
    if (target) target.modelViews.push(view);
    else
      rows.push({
        id: `MODEL_${rows.filter((r) => r.method === "MODEL").length + 1}`,
        variable: d.variable,
        metricKey: d.metricKey,
        current: d.currentAssumption,
        breaksAt: d.breaksAt,
        unit: "TEXT",
        margin: null,
        method: "MODEL",
        direction: "UNKNOWN",
        why: d.why,
        broken: null,
        modelViews: [],
      });
  }

  rows.sort((x, y) => {
    if (x.margin === null && y.margin === null) return 0;
    if (x.margin === null) return 1;
    if (y.margin === null) return -1;
    return x.margin - y.margin;
  });
  const verifyFirst = rows
    .filter((r) => r.margin !== null)
    .slice(0, 3)
    .map((r) => `${r.variable}: ${r.broken ? "already beyond its breakpoint" : `${r.margin!.toFixed(0)}% from breaking`}`);
  return { rows, verifyFirst, notes };
}
