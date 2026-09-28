/** Resolved inputs shared by every divergence module (built once in index.ts). */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DivergenceDraft } from "@/domain/sections";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { PeerGroupRef } from "../scoring/peer";
import type { MarketReconstruction } from "../market";
import type { FinancingMap } from "../financing";
import type { EconomicsContext, EconomicsReport } from "../economics";
import type { Ambition } from "../latent/ambition";

export interface DivergenceInputs {
  deal: CanonicalDeal;
  /** Model-extracted divergence signals (null on FAST/partial analyses or older versions). */
  draft: DivergenceDraft | null;
  registry: BenchmarkRegistry | null;
  peer: PeerGroupRef;
  asOf: Date;
  market: MarketReconstruction | null;
  financing: FinancingMap | null;
  economics: EconomicsReport | null;
  /** The latent engine's headline-vs-funded-plan consistency (reused, never recomputed differently). */
  latentAmbition: Ambition | null;
  /** When available, the survivability module runs the economics counterfactual engine with a +24-month delay. */
  economicsContext: EconomicsContext | null;
}
