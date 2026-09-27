/**
 * Institutional economics engine (deterministic). Placeholder contract —
 * implemented in this folder: pro-forma cap table returns, timing/IRR,
 * backward operating trajectory, decision sensitivity breakpoints and
 * counterfactual scenarios.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { ReturnModel, BackwardsResult } from "../returns";
import type { MarketReconstruction } from "../market";

export interface EconomicsReport {
  version: string;
}

export interface EconomicsContext {
  deal: CanonicalDeal;
  registry: BenchmarkRegistry;
  fund: FundProfile;
  returns: ReturnModel;
  backwards: BackwardsResult | null;
  market: MarketReconstruction;
}

export function economicsReport(_ctx: EconomicsContext): EconomicsReport {
  return { version: "0" };
}
