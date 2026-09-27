/**
 * One return model everywhere. Headline scenarios (MOIC, IRR, ownership,
 * proceeds) come from the pro-forma cap-table model — pool refreshes, prior
 * preferred, SAFE/note conversion, follow-on terms and the full preference
 * stack. The simplified model is kept only for comparison. Server (derive),
 * browser (interactive returns view), memos, compare, portfolio and the Fund
 * Brain therefore read the same numbers.
 */
import type { BenchmarkRegistry } from "@/engine/benchmarks/types";
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { MarketReconstruction } from "@/engine/market";
import type { ReturnModel, ScenarioResult } from "@/engine/returns";
import { capTableReturns, type CapTableReturns } from "@/engine/economics/captable-returns";
import { stateFromContext } from "@/engine/economics/inputs";

export function unifyReturns(simple: ReturnModel, ct: CapTableReturns): ReturnModel {
  if (!ct.modelable || ct.scenarios.length === 0) return { ...simple, engine: "SIMPLIFIED", simplified: null };
  const scenarios: ScenarioResult[] = ct.scenarios.map((c) => ({
    scenario: c.scenario,
    exitEquityUsd: c.exitEquityUsd,
    years: c.years,
    basis: c.basis,
    roundsRaised: c.roundsRaised,
    initialUsd: c.initialUsd,
    followOnUsd: c.followOnUsd,
    investedUsd: c.investedUsd,
    entryOwnershipPct: c.entryOwnershipPct,
    exitOwnershipPct: c.exitOwnershipPct,
    proceedsUsd: c.proceedsUsd,
    proceedsIfConvertedUsd: c.proceedsIfConvertedUsd,
    preferenceBinding: c.preferenceBinding,
    grossMoic: c.grossMoic,
    grossIrr: c.grossIrr,
    fundContributionPctOfFund: c.fundContributionPctOfFund,
  }));
  return {
    ...simple,
    scenarios,
    engine: "CAP_TABLE",
    simplified: simple.scenarios,
    assumptions: [
      "Returns come from the pro-forma cap-table model: option-pool top-up and refresh each round, prior preferred at an inferred price, SAFE/note conversion at the next priced round, our follow-on on that round's terms, full preference waterfall at exit.",
      ...ct.notes,
      ...simple.assumptions.filter((a) => a.startsWith("Future rounds") || a.startsWith("Follow-on") || a.startsWith("Exit equity")),
    ],
  };
}

export function unifiedReturnModel(simple: ReturnModel, ctx: { deal: CanonicalDeal; registry: BenchmarkRegistry; fund: FundProfile; market: Pick<MarketReconstruction, "primary"> }): { model: ReturnModel; capTable: CapTableReturns | null } {
  if (!simple.modelable) return { model: { ...simple, engine: "SIMPLIFIED", simplified: null }, capTable: null };
  try {
    const state = stateFromContext({ deal: ctx.deal, registry: ctx.registry, fund: ctx.fund, returns: simple, backwards: null, market: ctx.market as MarketReconstruction });
    const ct = capTableReturns(state, simple);
    return { model: unifyReturns(simple, ct), capTable: ct };
  } catch {
    // The simplified model remains a valid (labelled) fallback.
    return { model: { ...simple, engine: "SIMPLIFIED", simplified: null }, capTable: null };
  }
}
