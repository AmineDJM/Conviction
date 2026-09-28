/**
 * BACKWARD OPERATING TRAJECTORY.
 *
 * "At $X post, what minimal operating trajectory must exist for this deal to
 * return N× our capital (or $Y to the fund)?"
 *
 * The required exit equity is solved with the cap-table model (bisection on
 * exit equity so that OUR waterfall proceeds equal the target), so dilution,
 * pool refreshes, follow-on and preferences are all accounted for. Everything
 * downstream (revenue, CAGR, ARR path, customers, SAM share) is arithmetic on
 * that number. Conventional labels, never probabilities.
 */
import { cagr } from "../calc/finance";
import { buildProFormaPath, preferenceStack, scenarioEvaluator } from "./captable-returns";
import { withInputs, type EconomicsContext, type EconomicsState, stateFromContext } from "./inputs";
import { bisect, solveIncreasing } from "./solve";

export type Plausibility = "PLAUSIBLE" | "DEMANDING" | "HEROIC" | "IMPLAUSIBLE" | "UNKNOWN";

export interface TrajectoryOptions {
  /** Target gross multiple of OUR invested capital (initial + follow-on). */
  targetMultiple?: number;
  /** Target proceeds to the fund, USD. Ignored when targetMultiple is set. */
  targetContributionUsd?: number;
  /** Entry post-money (or SAFE cap) override. */
  entryPostMoneyUsd?: number;
  checkUsd?: number;
  followOn?: boolean;
  yearsToExit?: number;
  revenueMultiples?: number[];
  /** Maximum number of registry future rounds raised before the exit (default: all that fit before the exit date). */
  rounds?: number;
}

export interface TrajectoryMultipleRow {
  revenueMultiple: number;
  source: "REGISTRY" | "DEAL" | "USER";
  requiredRevenueUsd: number;
  requiredCagrPct: number | null;
  requiredCustomers: number | null;
  samSharePct: number | null;
  samPlausibility: Plausibility;
}

export interface TrajectoryYear {
  year: number;
  minRevenueUsd: number;
  customers: number | null;
  /** New logos needed that year at ARPA, net of expansion/contraction of the base (requires NRR). */
  newLogos: number | null;
  netNewCustomers: number | null;
}

export interface GrowthPersistence {
  label: "MODEL_ASSUMPTION";
  decayPerYear: number;
  requiredStartingGrowthPct: number | null;
  requiredStartingGrowthRangePct: [number | null, number | null];
  currentGrowthPct: number | null;
  currentGrowthSource: string;
  /** Revenue at exit if current growth decays at the heuristic rate. */
  projectedExitRevenueUsd: number | null;
  /** projected ÷ required, percent. */
  coveragePct: number | null;
  plausibility: Plausibility;
  explanation: string;
}

export interface TrajectoryResult {
  modelable: boolean;
  reasons: string[];
  question: string;
  target: { kind: "MULTIPLE" | "CONTRIBUTION"; multiple: number | null; contributionUsd: number | null; requiredProceedsUsd: number | null };
  entryPostMoneyUsd: number | null;
  checkUsd: number;
  followOnUsd: number;
  investedUsd: number;
  yearsToExit: number;
  roundsBeforeExit: number;
  exitOwnershipPct: number | null;
  requiredExitEquityUsd: number | null;
  /** target ÷ exit ownership — what a no-preference model would say. */
  naiveExitEquityUsd: number | null;
  preferenceStackAtExitUsd: number | null;
  current: {
    revenueUsd: number | null;
    revenueSource: string;
    arpaUsd: number | null;
    arpaSource: string;
    customers: number | null;
    nrrPct: number | null;
  };
  referenceMultiple: number;
  byMultiple: TrajectoryMultipleRow[];
  path: TrajectoryYear[];
  growthPersistence: GrowthPersistence;
  samShare: { samHighUsd: number | null; sharePct: number | null; plausibility: Plausibility };
  plausibility: Plausibility;
  summary: string[];
}

const RANK: Record<Plausibility, number> = { UNKNOWN: -1, PLAUSIBLE: 0, DEMANDING: 1, HEROIC: 2, IMPLAUSIBLE: 3 };

export function samPlausibility(sharePct: number | null, t: { PLAUSIBLE: number; DEMANDING: number; HEROIC: number }): Plausibility {
  if (sharePct === null) return "UNKNOWN";
  return sharePct <= t.PLAUSIBLE ? "PLAUSIBLE" : sharePct <= t.DEMANDING ? "DEMANDING" : sharePct <= t.HEROIC ? "HEROIC" : "IMPLAUSIBLE";
}

export function worstPlausibility(...ps: Plausibility[]): Plausibility {
  return ps.reduce<Plausibility>((w, p) => (RANK[p] > RANK[w] ? p : w), "UNKNOWN");
}

/** Revenue growth factor over `years` when growth starts at g0 and decays by d each year (fractional last year). */
export function decayedGrowthFactor(g0: number, d: number, years: number): number {
  const n = Math.floor(years);
  let f = 1;
  for (let t = 0; t < n; t++) f *= 1 + g0 * Math.pow(1 - d, t);
  const frac = years - n;
  if (frac > 1e-9) f *= Math.pow(Math.max(1e-9, 1 + g0 * Math.pow(1 - d, n)), frac);
  return f;
}

/** Starting growth (fraction) that compounds to `ratio` over `years` under decay `d`. */
export function requiredStartingGrowth(ratio: number, d: number, years: number): number | null {
  if (!(ratio > 0) || !(years > 0)) return null;
  return bisect((g) => decayedGrowthFactor(g, d, years) - ratio, -0.99, 1000, { iterations: 200, relTol: 1e-12 });
}

const fmtUsd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}k`);

export function trajectoryFromState(state0: EconomicsState, opts: TrajectoryOptions = {}): TrajectoryResult {
  const a = state0.inputs.a;
  let state = state0;
  if (opts.entryPostMoneyUsd !== undefined) state = withInputs(state, { postMoneyUsd: opts.entryPostMoneyUsd });
  if (opts.checkUsd !== undefined) {
    const ratio = state.inputs.checkUsd > 0 ? state.inputs.reserveUsd / state.inputs.checkUsd : state.fund.reserveRatio;
    state = withInputs(state, { checkUsd: opts.checkUsd, reserveUsd: opts.checkUsd * ratio, raiseUsd: Math.max(state.inputs.raiseUsd, opts.checkUsd) });
  }
  if (opts.followOn !== undefined) state = withInputs(state, { followOn: opts.followOn });
  const inp = state.inputs;
  const reg = state.registry;
  const years = opts.yearsToExit ?? inp.exits.BASE.years;
  const rounds = Math.min(opts.rounds ?? inp.futureRounds.length, inp.futureRounds.length);
  const regMultiples = reg.returns.backwardsRevenueMultiples;
  const userMultiples = opts.revenueMultiples?.filter((m) => m > 0);
  const multiples: { m: number; source: TrajectoryMultipleRow["source"] }[] = userMultiples?.length
    ? userMultiples.map((m) => ({ m, source: "USER" as const }))
    : regMultiples.map((m) => ({ m, source: "REGISTRY" as const }));
  if (!userMultiples?.length)
    for (const e of Object.values(inp.exits))
      if (e.revenueMultiple && e.revenueMultiple > 0 && !multiples.some((x) => x.m === e.revenueMultiple)) multiples.push({ m: e.revenueMultiple, source: "DEAL" });
  multiples.sort((x, y) => x.m - y.m);
  const refList = userMultiples?.length ? [...userMultiples].sort((x, y) => x - y) : regMultiples;
  const referenceMultiple = refList[Math.floor((refList.length - 1) / 2)] ?? 10;

  const targetKind: "MULTIPLE" | "CONTRIBUTION" = opts.targetMultiple !== undefined ? "MULTIPLE" : "CONTRIBUTION";
  const contribution = opts.targetContributionUsd ?? state.fund.targetDealReturnUsd;
  const post = inp.postMoneyUsd;
  const question =
    targetKind === "MULTIPLE"
      ? `At ${post ? fmtUsd(post) : "an unknown"} post, what minimal operating trajectory must exist for this deal to return ${opts.targetMultiple}× our capital?`
      : `At ${post ? fmtUsd(post) : "an unknown"} post, what minimal operating trajectory must exist for this deal to return ${fmtUsd(contribution)} to the fund?`;
  const op = state.op;
  const current = {
    revenueUsd: op.revenueUsd,
    revenueSource: op.revenueSource,
    arpaUsd: op.arpaUsd,
    arpaSource: op.arpaSource,
    customers: op.customers,
    nrrPct: op.nrrPct,
  };
  const emptyGrowth: GrowthPersistence = {
    label: "MODEL_ASSUMPTION",
    decayPerYear: a.growthDecayPerYear,
    requiredStartingGrowthPct: null,
    requiredStartingGrowthRangePct: [null, null],
    currentGrowthPct: op.growthPct,
    currentGrowthSource: op.growthSource,
    projectedExitRevenueUsd: null,
    coveragePct: null,
    plausibility: "UNKNOWN",
    explanation: "Not computed.",
  };
  const fail = (reasons: string[]): TrajectoryResult => ({
    modelable: false,
    reasons,
    question,
    target: { kind: targetKind, multiple: opts.targetMultiple ?? null, contributionUsd: targetKind === "CONTRIBUTION" ? contribution : null, requiredProceedsUsd: null },
    entryPostMoneyUsd: post,
    checkUsd: inp.checkUsd,
    followOnUsd: 0,
    investedUsd: inp.checkUsd,
    yearsToExit: years,
    roundsBeforeExit: 0,
    exitOwnershipPct: null,
    requiredExitEquityUsd: null,
    naiveExitEquityUsd: null,
    preferenceStackAtExitUsd: null,
    current,
    referenceMultiple,
    byMultiple: [],
    path: [],
    growthPersistence: emptyGrowth,
    samShare: { samHighUsd: state.samHighUsd, sharePct: null, plausibility: "UNKNOWN" },
    plausibility: "UNKNOWN",
    summary: reasons,
  });
  if (!state.modelable) return fail(state.reasons);
  if (!(years > 0)) return fail(["Years to exit must be positive."]);
  const path = buildProFormaPath(inp, rounds);
  if (!path) return fail(["Financing terms are inconsistent — the cap-table model cannot run."]);
  const ev = scenarioEvaluator(path, inp, rounds, years);
  const requiredProceeds = targetKind === "MULTIPLE" ? opts.targetMultiple! * ev.investedUsd : contribution;
  const own = ev.exitOwnership;
  const naive = own > 0 ? requiredProceeds / own : null;
  const E = own > 0 ? solveIncreasing(ev.proceedsAt, requiredProceeds, 0, (naive ?? 1) * 1.01 + preferenceStack(ev.exitCt)) : null;
  const roundsRaised = ev.steps.filter((s) => s.row.kind === "PRICED").length;
  if (E === null) return fail(["Target unreachable: our exit ownership is zero."]);

  const rev0 = op.revenueUsd;
  const samHigh = state.samHighUsd;
  const t = reg.returns.samSharePlausibility;
  const byMultiple: TrajectoryMultipleRow[] = multiples.map(({ m, source }) => {
    const R = E / m;
    const g = rev0 ? cagr(rev0, R, years) : null;
    const share = samHigh ? (R / samHigh) * 100 : null;
    return {
      revenueMultiple: m,
      source,
      requiredRevenueUsd: R,
      requiredCagrPct: g === null ? null : g * 100,
      requiredCustomers: op.arpaUsd ? Math.ceil(R / op.arpaUsd) : null,
      samSharePct: share,
      samPlausibility: samPlausibility(share, t),
    };
  });
  const Rref = E / referenceMultiple;
  const gRef = rev0 ? cagr(rev0, Rref, years) : null;

  // Year-by-year minimum revenue path (constant CAGR — the smoothest path that reaches the requirement).
  const path_: TrajectoryYear[] = [];
  if (rev0 && gRef !== null) {
    const ticks: number[] = [];
    for (let y = 0; y <= Math.floor(years + 1e-9); y++) ticks.push(y);
    if (years - Math.floor(years + 1e-9) > 1e-9) ticks.push(years);
    let prevRev: number | null = null;
    let prevCust: number | null = null;
    let prevT = 0;
    for (const y of ticks) {
      const r = rev0 * Math.pow(1 + gRef, y);
      const customers = op.arpaUsd ? Math.ceil(r / op.arpaUsd) : null;
      let newLogos: number | null = null;
      if (prevRev !== null && op.arpaUsd && op.nrrPct !== null) {
        const retained = prevRev * Math.pow(op.nrrPct / 100, y - prevT);
        newLogos = Math.max(0, Math.ceil((r - retained) / op.arpaUsd));
      }
      path_.push({
        year: y,
        minRevenueUsd: r,
        customers,
        newLogos,
        netNewCustomers: prevCust !== null && customers !== null ? customers - prevCust : null,
      });
      prevRev = r;
      prevCust = customers;
      prevT = y;
    }
  }

  // Growth persistence heuristic (MODEL_ASSUMPTION).
  const ratio = rev0 ? Rref / rev0 : null;
  const d = a.growthDecayPerYear;
  const g0 = ratio ? requiredStartingGrowth(ratio, d, years) : null;
  const gLo = ratio ? requiredStartingGrowth(ratio, a.growthDecayRange[0], years) : null;
  const gHi = ratio ? requiredStartingGrowth(ratio, a.growthDecayRange[1], years) : null;
  const gc = op.growthPct;
  const projected = rev0 && gc !== null ? rev0 * decayedGrowthFactor(gc / 100, d, years) : null;
  let growthPl: Plausibility = "UNKNOWN";
  if (g0 !== null && gc !== null) {
    if (g0 <= 0) growthPl = "PLAUSIBLE";
    else if (gc <= 0) growthPl = "IMPLAUSIBLE";
    else {
      const k = g0 / (gc / 100);
      const gp = a.growthPlausibility;
      growthPl = k <= gp.PLAUSIBLE ? "PLAUSIBLE" : k <= gp.DEMANDING ? "DEMANDING" : k <= gp.HEROIC ? "HEROIC" : "IMPLAUSIBLE";
    }
  }
  const growthPersistence: GrowthPersistence = {
    label: "MODEL_ASSUMPTION",
    decayPerYear: d,
    requiredStartingGrowthPct: g0 === null ? null : g0 * 100,
    requiredStartingGrowthRangePct: [gLo === null ? null : gLo * 100, gHi === null ? null : gHi * 100],
    currentGrowthPct: gc,
    currentGrowthSource: op.growthSource,
    projectedExitRevenueUsd: projected,
    coveragePct: projected !== null ? (projected / Rref) * 100 : null,
    plausibility: growthPl,
    explanation:
      g0 === null
        ? "Current revenue unknown — the growth-persistence comparison cannot be made."
        : `If growth decays ~${Math.round(d * 100)}%/yr (heuristic, MODEL_ASSUMPTION), reaching ${fmtUsd(Rref)} in ${years} years requires starting growth of ${(g0 * 100).toFixed(0)}% (range ${gHi !== null && gLo !== null ? `${(gLo * 100).toFixed(0)}–${(gHi * 100).toFixed(0)}%` : "n/a"})${gc !== null ? ` vs current ${gc.toFixed(0)}% (${op.growthSource})` : ""}.`,
  };
  const share = samHigh ? (Rref / samHigh) * 100 : null;
  const samPl = samPlausibility(share, t);
  const plausibility = worstPlausibility(samPl, growthPl);

  const summary: string[] = [];
  summary.push(
    `Our ${fmtUsd(ev.investedUsd)} (${fmtUsd(inp.checkUsd)} initial${ev.followOnUsd > 0 ? ` + ${fmtUsd(ev.followOnUsd)} follow-on` : ""}) ends at ${(own * 100).toFixed(2)}% fully diluted after ${roundsRaised} further round${roundsRaised === 1 ? "" : "s"}; returning ${fmtUsd(requiredProceeds)} requires an exit equity value of ${fmtUsd(E)}${naive !== null && E > naive * 1.001 ? ` (${fmtUsd(naive)} before preference effects)` : ""}.`,
  );
  summary.push(
    `At ${referenceMultiple}× revenue that is ${fmtUsd(Rref)} of revenue in ${years} years${rev0 ? ` — from ${fmtUsd(rev0)} (${op.revenueSource}) today, a ${gRef !== null ? (gRef * 100).toFixed(0) : "n/a"}% CAGR` : ""}.`,
  );
  if (op.arpaUsd) {
    const last = path_[path_.length - 1];
    summary.push(
      `At ${fmtUsd(op.arpaUsd)} ARPA (${op.arpaSource}) that means ~${Math.ceil(Rref / op.arpaUsd).toLocaleString("en-US")} customers at exit${op.customers ? ` vs ${op.customers.toLocaleString("en-US")} today` : ""}${last?.newLogos !== null && last?.newLogos !== undefined ? `; ~${last.newLogos.toLocaleString("en-US")} new logos in the final year at ${op.nrrPct}% NRR` : ""}.`,
    );
  }
  if (share !== null) summary.push(`That revenue is ${share.toFixed(1)}% of the reconstructed SAM upper bound (${fmtUsd(samHigh!)}) → ${samPl}.`);
  summary.push(growthPersistence.explanation + (growthPl !== "UNKNOWN" ? ` → ${growthPl}.` : ""));
  summary.push(`Overall trajectory: ${plausibility} (worst of market-share and growth-persistence tests; conventional labels, not probabilities).`);

  return {
    modelable: true,
    reasons: [],
    question,
    target: { kind: targetKind, multiple: opts.targetMultiple ?? null, contributionUsd: targetKind === "CONTRIBUTION" ? contribution : null, requiredProceedsUsd: requiredProceeds },
    entryPostMoneyUsd: post,
    checkUsd: inp.checkUsd,
    followOnUsd: ev.followOnUsd,
    investedUsd: ev.investedUsd,
    yearsToExit: years,
    roundsBeforeExit: roundsRaised,
    exitOwnershipPct: own * 100,
    requiredExitEquityUsd: E,
    naiveExitEquityUsd: naive,
    preferenceStackAtExitUsd: preferenceStack(ev.exitCt),
    current,
    referenceMultiple,
    byMultiple,
    path: path_,
    growthPersistence,
    samShare: { samHighUsd: samHigh, sharePct: share, plausibility: samPl },
    plausibility,
    summary,
  };
}

/** Public entry point: the trajectory question on an economics context. */
export function requiredTrajectory(ctx: EconomicsContext, opts: TrajectoryOptions = {}): TrajectoryResult {
  return trajectoryFromState(stateFromContext(ctx), opts);
}
