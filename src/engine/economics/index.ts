/**
 * Institutional economics engine (deterministic).
 *
 *  - captable-returns: pro-forma cap table, dilution path, waterfall, timing/IRR
 *  - trajectory:       backward operating trajectory ("what must be true")
 *  - sensitivity:      decision breakpoints, most fragile first
 *  - counterfactuals:  instant, pure what-if scenarios
 *
 * All outputs are conventional and deterministic — never probabilities.
 */
import { describeAssumptions, type AssumptionEntry } from "./assumptions";
import { capTableReturns, type CapTableReturns } from "./captable-returns";
import {
  BUILT_IN_SCENARIO_IDS,
  evaluateState,
  runCounterfactualOnState,
  summarizeCounterfactual,
  type CounterfactualSummary,
} from "./counterfactuals";
import { stateFromContext, type EconomicsContext } from "./inputs";
import { sensitivityMap, type SensitivityMap } from "./sensitivity";
import { trajectoryFromState, type TrajectoryResult } from "./trajectory";

export const ECONOMICS_ENGINE_VERSION = "1.0";

export interface EconomicsReport {
  version: string;
  modelable: boolean;
  reasons: string[];
  assumptions: AssumptionEntry[];
  capTableReturns: CapTableReturns;
  trajectory: {
    /** Returning the fund's target deal contribution (fund.targetDealReturnUsd). */
    fundTarget: TrajectoryResult;
    /** Returning N× our capital (default 20×). */
    capitalMultiple: TrajectoryResult;
  };
  sensitivity: SensitivityMap;
  counterfactuals: CounterfactualSummary[];
}

export type { EconomicsContext } from "./inputs";

export function economicsReport(ctx: EconomicsContext): EconomicsReport {
  const state = stateFromContext(ctx);
  const a = state.inputs.a;
  const fundTarget = trajectoryFromState(state, { targetContributionUsd: ctx.fund.targetDealReturnUsd });
  const capitalMultiple = trajectoryFromState(state, { targetMultiple: a.trajectoryMultiple });
  const sensitivity = sensitivityMap(state, fundTarget);
  const base = evaluateState(state);
  const counterfactuals = BUILT_IN_SCENARIO_IDS.map((id) => summarizeCounterfactual(runCounterfactualOnState(state, id, base)));
  return {
    version: ECONOMICS_ENGINE_VERSION,
    modelable: state.modelable,
    reasons: state.reasons,
    assumptions: describeAssumptions(a),
    capTableReturns: capTableReturns(state, ctx.returns),
    trajectory: { fundTarget, capitalMultiple },
    sensitivity,
    counterfactuals,
  };
}

export { requiredTrajectory, trajectoryFromState } from "./trajectory";
export type { TrajectoryOptions, TrajectoryResult, Plausibility } from "./trajectory";
export { runCounterfactual, BUILT_IN_SCENARIOS, BUILT_IN_SCENARIO_IDS } from "./counterfactuals";
export type { CounterfactualScenario, CounterfactualResult, CustomShock, BuiltInScenarioId, CounterfactualSummary } from "./counterfactuals";
export { sensitivityMap } from "./sensitivity";
export type { SensitivityRow, SensitivityMap } from "./sensitivity";
export { capTableReturns, buildProFormaPath, OUR_HOLDER } from "./captable-returns";
export type { CapTableReturns, CapTableScenario, RoundRow } from "./captable-returns";
export { stateFromContext } from "./inputs";
export { DEFAULT_ECONOMICS_ASSUMPTIONS } from "./assumptions";
export type { EconomicsAssumptions } from "./assumptions";
