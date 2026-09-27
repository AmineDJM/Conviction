/**
 * Test helpers for the economics and portfolio engines. Contexts are built
 * from the engine's own building blocks (not via derive()) so these tests
 * isolate the economics layer.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { DEFAULT_FUND_PROFILE, type FundProfile } from "@/domain/fund";
import { getRegistry } from "@/engine/benchmarks";
import { reconstructMarket } from "@/engine/market";
import { backwardsReturn, buildReturnInputs, runReturnModel } from "@/engine/returns";
import type { EconomicsContext } from "@/engine/economics/inputs";
import type { EconomicsAssumptions } from "@/engine/economics/assumptions";
import type { CapTable } from "@/engine/calc/captable";
import { makeDeal } from "./fixtures";

export const reg = getRegistry();
export const fund: FundProfile = DEFAULT_FUND_PROFILE;

export function money(amount: number, rawText = String(amount)) {
  return { amount, currency: "USD", rawText };
}

export interface CtxOptions {
  fund?: FundProfile;
  returnOverrides?: Parameters<typeof buildReturnInputs>[3];
  capTable?: CapTable | null;
  assumptions?: Partial<EconomicsAssumptions>;
}

export function ctxFor(deal: CanonicalDeal, o: CtxOptions = {}): EconomicsContext {
  const f = o.fund ?? fund;
  const market = reconstructMarket(deal);
  const inputs = buildReturnInputs(deal, reg, f, o.returnOverrides);
  const returns = runReturnModel(inputs, reg, f);
  const base = returns.scenarios.find((s) => s.scenario === "BASE");
  const backwards = base ? backwardsReturn(f.targetDealReturnUsd, base.exitOwnershipPct, reg, { usd: null, source: "n/a" }, market.primary?.highUsd ?? null) : null;
  return { deal, registry: reg, fund: f, returns, backwards, market, capTable: o.capTable ?? null, assumptions: o.assumptions };
}

/** Series A SaaS: $12M on $48M pre ($60M post) — the default fixture. */
export function seriesA(overrides: Partial<CanonicalDeal> = {}): CanonicalDeal {
  return makeDeal(overrides);
}

/** Series A SaaS priced at $42M post ($8M on $34M pre). */
export function seriesA42(): CanonicalDeal {
  const d = makeDeal();
  d.financing = { ...d.financing!, raiseAmount: money(8_000_000), preMoney: null, postMoney: money(42_000_000) };
  return d;
}

/** Seed post-money SAFE: $3M at a $15M cap, 20% discount. */
export function seedSafe(opts: { cap?: number; raise?: number; discount?: number | null } = {}): CanonicalDeal {
  const d = makeDeal();
  d.classification = { ...d.classification, financingStage: "SEED", operationalMaturity: "EARLY_REVENUE" };
  d.financing = {
    ...d.financing!,
    instrument: "SAFE",
    raiseAmount: money(opts.raise ?? 3_000_000),
    preMoney: null,
    postMoney: null,
    valuationCap: money(opts.cap ?? 15_000_000),
    discountPct: opts.discount === undefined ? 20 : opts.discount,
  };
  return d;
}

export function withExits(deal: CanonicalDeal, exits: { scenario: "FAILURE" | "LOW" | "BASE" | "BULL" | "OUTLIER"; rev: number; mult: number; years: number }[]): CanonicalDeal {
  return { ...deal, exitAssumptions: exits.map((e) => ({ scenario: e.scenario, exitRevenueUsd: e.rev, revenueMultiple: e.mult, yearsToExit: e.years, rationale: "test" })) };
}
