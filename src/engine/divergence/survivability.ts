/**
 * 4. STRATEGIC SURVIVABILITY — if the market takes 24 months longer, can the
 * company cut burn, change GTM, monetize differently, license the technology,
 * slow down without dying? "One path vs many."
 *
 * Arithmetic ("default-alive under slowdown") from cash, round, burn, revenue
 * and gross margin with the financing map's conventions and a +24-month shock;
 * when an economics context is available, the counterfactual engine is run
 * with the same delay for the return impact. Distinct from runway.
 */
import type { SURVIVAL_OPTIONS } from "@/domain/sections";
import { runCounterfactual } from "../economics/counterfactuals";
import { operatingSnapshot } from "../economics/inputs";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, downgrade, ev, fmtUsd, isFact, metricRef, months1, num, pagesOfEvidence, round } from "./util";

type SurvivalOption = (typeof SURVIVAL_OPTIONS)[number];
export type SlowdownStatus = "DEFAULT_ALIVE_AFTER_CUTS" | "SURVIVES_AT_PLAN" | "SURVIVES_WITH_CUTS" | "DOES_NOT_SURVIVE" | "UNKNOWN";

export interface SlowdownArithmetic {
  status: SlowdownStatus;
  cashAfterRoundUsd: number | null;
  monthlyBurnUsd: number | null;
  burnSource: string;
  monthlyGrossProfitUsd: number | null;
  monthlyOpexUsd: number | null;
  runwayAtPlanMonths: number | null;
  /** Months the company must last: milestone (or registry round spacing) + fundraising lead + slowdown. */
  requiredMonths: number | null;
  burnAfterCutsUsd: number | null;
  runwayAfterCutsMonths: number | null;
  /** Opex cut needed to last `requiredMonths` without new money (0–100). */
  requiredOpexCutPct: number | null;
  bridgeNeededAtPlanUsd: number | null;
  notes: string[];
}

export interface SurvivabilityFactor extends FactorBase {
  id: "STRATEGIC_SURVIVABILITY";
  arithmetic: SlowdownArithmetic;
  options: { option: SurvivalOption | "CUT_BURN_COMPUTED"; status: string; evidence: string; page: number | null; basis: "MODEL_OBSERVED" | "COMPUTED" }[];
  realOptions: number;
  assertedOnly: number;
  rigidities: { kind: string; evidence: string; page: number | null }[];
  counterfactualHeadline: string | null;
}

export function slowdownArithmetic(inp: DivergenceInputs): SlowdownArithmetic {
  const notes: string[] = [];
  const fm = inp.financing;
  const cash = fm?.cashUsd ?? null;
  const raise = fm?.raiseUsd ?? null;
  const burn = fm?.monthlyBurnUsd ?? null;
  const empty: SlowdownArithmetic = {
    status: "UNKNOWN",
    cashAfterRoundUsd: null,
    monthlyBurnUsd: burn,
    burnSource: fm?.burnSource ?? "UNKNOWN",
    monthlyGrossProfitUsd: null,
    monthlyOpexUsd: null,
    runwayAtPlanMonths: null,
    requiredMonths: null,
    burnAfterCutsUsd: null,
    runwayAfterCutsMonths: null,
    requiredOpexCutPct: null,
    bridgeNeededAtPlanUsd: null,
    notes,
  };
  if (!burn || !(burn > 0) || (cash === null && raise === null)) {
    notes.push("Burn, cash or round size unknown — slowdown arithmetic not computed.");
    return empty;
  }
  const C = (cash ?? 0) + (raise ?? 0);
  if (cash === null) notes.push("Cash balance unknown — only the round is counted.");
  const op = operatingSnapshot(inp.deal);
  let gp: number | null = null;
  if (op.revenueUsd !== null && op.grossMarginPct !== null) gp = (op.revenueUsd / 12) * (op.grossMarginPct / 100);
  else if (op.revenueUsd !== null) notes.push("Gross margin unknown — revenue does not offset cuts (conservative).");
  const gpUsed = gp ?? 0;
  // Net burn = opex − gross profit (revenue held flat in a slowdown).
  const opex = burn + gpUsed;
  const lead = inp.registry?.returns.fundraisingLeadMonths ?? 6;
  const horizon = fm?.milestoneMonths ?? inp.registry?.returns.monthsBetweenRounds ?? 18;
  if (fm?.milestoneMonths === null || fm?.milestoneMonths === undefined) notes.push(`Milestone timing unknown — registry round spacing (${horizon} months) used.`);
  const required = horizon + lead + A.slowdownMonths;
  const runwayAtPlan = C / burn;
  const burnAfterCuts = opex * (1 - A.cuttableOpexPct / 100) - gpUsed;
  const runwayAfterCuts = burnAfterCuts > 0 ? C / burnAfterCuts : Infinity;
  const targetBurn = C / required;
  const requiredCut = opex > 0 ? Math.min(100, Math.max(0, (1 - (targetBurn + gpUsed) / opex) * 100)) : null;
  let status: SlowdownStatus;
  if (runwayAtPlan >= required) status = "SURVIVES_AT_PLAN";
  else if (burnAfterCuts <= 0) status = "DEFAULT_ALIVE_AFTER_CUTS";
  else if (runwayAfterCuts >= required) status = "SURVIVES_WITH_CUTS";
  else status = "DOES_NOT_SURVIVE";
  return {
    status,
    cashAfterRoundUsd: C,
    monthlyBurnUsd: burn,
    burnSource: fm?.burnSource ?? "UNKNOWN",
    monthlyGrossProfitUsd: gp !== null ? round(gp, 0) : null,
    monthlyOpexUsd: round(opex, 0),
    runwayAtPlanMonths: round(runwayAtPlan, 1),
    requiredMonths: required,
    burnAfterCutsUsd: round(burnAfterCuts, 0),
    runwayAfterCutsMonths: Number.isFinite(runwayAfterCuts) ? round(runwayAfterCuts, 1) : null,
    requiredOpexCutPct: requiredCut !== null ? round(requiredCut, 1) : null,
    bridgeNeededAtPlanUsd: round(Math.max(0, required - runwayAtPlan) * burn, 0),
    notes,
  };
}

const COMMITMENT_RE = /contract|lease|commit|obligat|minimum|take[- ]or[- ]pay|purchase order|inventory|debt|loan|covenant|licen[cs]e fee|capex|facility|factory|prepaid/i;

const STATUS_TEXT: Record<SlowdownStatus, string> = {
  SURVIVES_AT_PLAN: "survives a 24-month slowdown at the planned burn",
  DEFAULT_ALIVE_AFTER_CUTS: "becomes default-alive after cutting operating expense",
  SURVIVES_WITH_CUTS: "survives the slowdown only by cutting operating expense",
  DOES_NOT_SURVIVE: "does not survive a 24-month slowdown even after cuts",
  UNKNOWN: "slowdown arithmetic not computable",
};

export function strategicSurvivability(inp: DivergenceInputs): SurvivabilityFactor {
  const draft = inp.draft?.survivability ?? null;
  const ar = slowdownArithmetic(inp);
  const evidence: DivergenceEvidence[] = [];
  const opts: SurvivabilityFactor["options"] = [];
  const seen = new Set<string>();
  for (const o of draft?.options ?? []) {
    if (!isFact(o.evidence)) continue;
    opts.push({ option: o.option, status: o.status, evidence: o.evidence, page: o.page, basis: "MODEL_OBSERVED" });
  }
  if (ar.status === "SURVIVES_WITH_CUTS" || ar.status === "DEFAULT_ALIVE_AFTER_CUTS")
    opts.push({ option: "CUT_BURN_COMPUTED", status: "PLAUSIBLE", evidence: `A ${A.cuttableOpexPct}% opex cut takes net burn to ${fmtUsd(ar.burnAfterCutsUsd)}/month`, page: null, basis: "COMPUTED" });
  let realOptions = 0;
  let assertedOnly = 0;
  for (const o of opts) {
    const key = o.option === "CUT_BURN_COMPUTED" ? "CUT_BURN" : o.option;
    if (o.status === "ASSERTED") {
      if (!seen.has(`a:${key}`)) assertedOnly++;
      seen.add(`a:${key}`);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    realOptions++;
  }
  for (const o of opts) evidence.push(ev(o.basis, `${o.option.toLowerCase().replace(/_computed$/, "").replace(/_/g, " ")} (${o.status.toLowerCase()}): ${o.evidence}`, [o.page]));
  // Rigidities are cross-checked by code: a short measured sales cycle is not one, and a "fixed commitment" must name a contractual obligation.
  const cycle = metricRef(inp.deal, "sales_cycle_days");
  const rigidities: SurvivabilityFactor["rigidities"] = [];
  for (const r of draft?.rigidities ?? []) {
    if (!isFact(r.evidence)) continue;
    let reject: string | null = null;
    if (r.kind === "LONG_SALES_CYCLE" && cycle && cycle.value < A.longSalesCycleDays) reject = `measured sales cycle ${Math.round(cycle.value)} days < ${A.longSalesCycleDays}`;
    else if (r.kind === "FIXED_COMMITMENTS" && !COMMITMENT_RE.test(r.evidence)) reject = "no contractual obligation named (a plan is not a commitment)";
    if (reject) evidence.push(ev("COMPUTED", `Rigidity not counted — ${r.kind.toLowerCase().replace(/_/g, " ")}: ${reject}`, [r.page], [cycle?.ref]));
    else rigidities.push({ kind: r.kind, evidence: r.evidence, page: r.page });
  }
  for (const r of rigidities) evidence.push(ev("MODEL_OBSERVED", `Rigidity — ${r.kind.toLowerCase().replace(/_/g, " ")}: ${r.evidence}`, [r.page]));
  if (ar.status !== "UNKNOWN")
    evidence.push(
      ev(
        "COMPUTED",
        `Cash after round ${fmtUsd(ar.cashAfterRoundUsd)} at ${fmtUsd(ar.monthlyBurnUsd)}/month (${ar.burnSource.toLowerCase()}) = ${months1(ar.runwayAtPlanMonths)}; must last ${ar.requiredMonths} months (milestone + raise + ${A.slowdownMonths}-month slowdown); after a ${A.cuttableOpexPct}% opex cut: ${ar.runwayAfterCutsMonths === null ? "breakeven" : months1(ar.runwayAfterCutsMonths)}.`,
      ),
    );

  // Economics counterfactual with the same delay (return impact), when the full context is available.
  let counterfactualHeadline: string | null = null;
  if (inp.economicsContext) {
    try {
      const r = runCounterfactual(inp.economicsContext, { id: "custom", shock: { label: `Market ${A.slowdownMonths} months slower`, delayMonths: A.slowdownMonths } });
      const bm = r.base.moic.BASE;
      const sm = r.scenario.moic.BASE;
      counterfactualHeadline = `Economics engine, next round +${A.slowdownMonths} months: financing risk ${r.base.financingRisk} → ${r.scenario.financingRisk}${bm !== null && sm !== null ? `; BASE MOIC ${bm.toFixed(2)}× → ${sm.toFixed(2)}×` : ""}.`;
      evidence.push(ev("COMPUTED", counterfactualHeadline));
    } catch {
      counterfactualHeadline = null;
    }
  } else {
    const cf = inp.economics?.counterfactuals.find((c) => c.id === "NEXT_ROUND_DELAY_12M");
    if (cf) {
      counterfactualHeadline = cf.headline;
      evidence.push(ev("COMPUTED", `Economics engine (12-month reference shock): ${cf.headline}`));
    }
  }

  const A2: number | null = ar.status === "SURVIVES_AT_PLAN" || ar.status === "DEFAULT_ALIVE_AFTER_CUTS" ? 2 : ar.status === "SURVIVES_WITH_CUTS" ? 1 : ar.status === "DOES_NOT_SURVIVE" ? 0 : null;
  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  // Without the model's read of options, "one path" cannot be asserted: arithmetic alone, capped at ADEQUATE.
  if (!draft && A2 !== null) level = A2 >= 1 ? "ADEQUATE" : "WEAK";
  else if (A2 === 2) level = realOptions >= 2 ? "STRONG" : "ADEQUATE";
  else if (A2 === 1) level = realOptions >= 2 ? "ADEQUATE" : "WEAK";
  else if (A2 === 0) level = realOptions >= 3 ? "ADEQUATE" : "WEAK";
  else if (draft) level = realOptions >= 2 ? "ADEQUATE" : "WEAK";
  if (rigidities.length >= 2) level = downgrade(level);
  const paths = !draft ? "OPTIONS_UNREAD" : realOptions >= 3 ? "MANY_PATHS" : realOptions === 2 ? "FEW_PATHS" : "ONE_PATH";
  const reading = level === "INSUFFICIENT_EVIDENCE" ? "UNREAD" : `${paths}${ar.status !== "UNKNOWN" ? ` · ${ar.status}` : ""}`;
  const why =
    level === "INSUFFICIENT_EVIDENCE"
      ? "Neither the slowdown arithmetic (burn, cash, round) nor the company's options are shown."
      : `${ar.status !== "UNKNOWN" ? `The company ${STATUS_TEXT[ar.status]}` : "Slowdown arithmetic unavailable"}; ${realOptions} real option${realOptions === 1 ? "" : "s"}${assertedOnly ? ` (+${assertedOnly} only asserted)` : ""}${rigidities.length ? `, ${rigidities.length} rigidit${rigidities.length === 1 ? "y" : "ies"}` : ""}.`;

  const implications: string[] = [];
  if (ar.status === "DOES_NOT_SURVIVE" && ar.bridgeNeededAtPlanUsd) implications.push(`If the market is 24 months late the company needs ≈ ${fmtUsd(ar.bridgeNeededAtPlanUsd)} of bridge financing at plan (or a ${ar.requiredOpexCutPct}% opex cut, above the ${A.cuttableOpexPct}% assumed feasible).`);
  if (ar.status === "SURVIVES_WITH_CUTS") implications.push(`Survival depends on cutting ≈ ${ar.requiredOpexCutPct}% of operating expense early — the plan must name what gets cut.`);
  if (draft && realOptions <= 1) implications.push("One path: if the primary plan slips, there is no demonstrated fallback — the investment is a bet on timing, not only on the market.");
  if (counterfactualHeadline) implications.push(counterfactualHeadline);

  return {
    id: "STRATEGIC_SURVIVABILITY",
    n: 4,
    name: "Strategic survivability",
    question: "If the market takes 24 months longer, can the company slow down without dying?",
    level,
    reading,
    why,
    basis: basesOf(evidence, [ar.status !== "UNKNOWN" && "MODEL_ASSUMPTION"]),
    pages: pagesOfEvidence(evidence),
    rule: `Required months = milestone (else registry round spacing) + fundraising lead + ${A.slowdownMonths}-month slowdown. Net burn = opex − gross profit (revenue flat); up to ${A.cuttableOpexPct}% of opex cuttable (MODEL_ASSUMPTION). Arithmetic tier: survives at plan or default-alive after cuts 2, survives only with cuts 1, does not survive 0. Real options = distinct DEMONSTRATED/PLAUSIBLE options with a stated fact (+ computed burn cut). Tier 2: ≥ 2 options STRONG else ADEQUATE; tier 1: ≥ 2 ADEQUATE else WEAK; tier 0: ≥ 3 ADEQUATE else WEAK; no arithmetic: ≥ 2 ADEQUATE else WEAK; options not read (no divergence pass): arithmetic alone, capped at ADEQUATE. ≥ 2 rigidities downgrade one level; a rigidity counts only if code does not contradict it (measured sales cycle < ${A.longSalesCycleDays} days is not one; a fixed commitment must name a contractual obligation).`,
    evidence,
    coverage: coverage(
      [ar.status !== "UNKNOWN" && "burn, cash and round", ar.monthlyGrossProfitUsd !== null && "revenue and gross margin", !!draft && "options and rigidities (divergence pass)", inp.financing?.milestoneMonths != null && "milestone timing"],
      [ar.status === "UNKNOWN" && "burn, cash and round", ar.monthlyGrossProfitUsd === null && "revenue and gross margin", !draft && "options and rigidities (divergence pass)", inp.financing?.milestoneMonths == null && "milestone timing"],
      ar.notes.join(" ") || null,
    ),
    computed: [
      num("runwayAtPlan", "Runway at plan", ar.runwayAtPlanMonths, "MONTHS"),
      num("requiredMonths", "Months to survive (incl. slowdown)", ar.requiredMonths, "MONTHS"),
      num("burnAfterCuts", "Net burn after cuts", ar.burnAfterCutsUsd, "USD"),
      num("runwayAfterCuts", "Runway after cuts", ar.runwayAfterCutsMonths, "MONTHS"),
      num("requiredOpexCut", "Opex cut needed to survive", ar.requiredOpexCutPct, "PCT"),
      num("bridgeAtPlan", "Bridge needed at plan", ar.bridgeNeededAtPlanUsd, "USD"),
      num("realOptions", "Real options", realOptions, "COUNT"),
    ],
    implications,
    arithmetic: ar,
    options: opts,
    realOptions,
    assertedOnly,
    rigidities,
    counterfactualHeadline,
  };
}
