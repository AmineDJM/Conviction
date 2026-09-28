/** Builders for the Divergence Factors suites. No network: model output is constructed here. */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DivergenceDraft } from "@/domain/sections";
import type { Money } from "@/domain/money";
import { getRegistry } from "@/engine/benchmarks";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { derive } from "@/engine/derive";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { divergenceReport, factorOf, type DivergenceContext, type DivergenceFactor, type DivergenceReport } from "@/engine/divergence";
import { makeDeal } from "./fixtures";

export const REG = getRegistry();
export const FUND = DEFAULT_FUND_PROFILE;
export const AS_OF = new Date("2026-09-27T00:00:00Z");

export const usd = (amount: number, rawText = `$${amount.toLocaleString("en-US")}`): Money => ({ amount, currency: "USD", rawText });

export function emptyDraft(): DivergenceDraft {
  return {
    ambition: { productScope: "UNCLEAR", geography: "UNSTATED", marketFraming: "UNCLEAR", statedEndState: null, signals: [] },
    capTable: { founderOwnershipPct: null, founders: [], optionPoolPct: null, optionPoolAvailablePct: null, convertibles: [], terms: [], investorConflicts: [] },
    syndicate: [],
    survivability: { options: [], rigidities: [] },
    marketStructure: { dimensions: [], topBuyersSharePct: null, topBuyersCount: null, addressableBuyerCount: null, largestCompetitorSharePct: null },
    dependencies: [],
    ownedAssets: [],
    expansion: { pricingModel: "UNKNOWN", entryPrice: null, largestCustomerAnnualValue: null, modules: [], expansionEvidence: [] },
    focus: { products: [], customerSegments: [], markets: [], channels: [] },
    loops: [],
    scalability: { signals: [], implementationWeeks: null, headcountByFunction: [] },
  };
}

/** A deal carrying a divergence draft built by `edit`. */
export function dealWith(edit: (d: DivergenceDraft) => void = () => {}, base: CanonicalDeal = makeDeal()): CanonicalDeal {
  const d = emptyDraft();
  edit(d);
  return { ...base, divergence: d };
}

/** Engine-only report (no economics context) at a fixed date. */
export function report(deal: CanonicalDeal, ctx: DivergenceContext = {}): DivergenceReport {
  return divergenceReport(deal, REG, resolvePeerGroup(deal.classification), { asOf: AS_OF, ...ctx });
}

/** Full deterministic layer (economics trajectory, financing map, counterfactual) as the pipeline computes it. */
export function derived(deal: CanonicalDeal) {
  return derive(deal, REG, FUND, { now: AS_OF });
}

export function factor<T extends DivergenceFactor["id"]>(deal: CanonicalDeal, id: T, full = false): Extract<DivergenceFactor, { id: T }> {
  const r = full ? derived(deal).divergence : report(deal);
  return factorOf(r, id);
}

export const LEVELS = ["STRONG", "ADEQUATE", "WEAK", "INSUFFICIENT_EVIDENCE"] as const;

/** A deal rich in every kind of divergence signal (used for invariance and robustness checks). */
export function richDeal(): CanonicalDeal {
  return dealWith((d) => {
    d.ambition = {
      productScope: "PLATFORM",
      geography: "GLOBAL",
      marketFraming: "NEW_CATEGORY",
      statedEndState: "The operating system for accounts payable worldwide",
      signals: [
        { kind: "HIRING_PLAN", direction: "EXPANSIVE", evidence: "Hiring GMs for US and UK in 2027", page: 14 },
        { kind: "ROADMAP", direction: "EXPANSIVE", evidence: "Payments, treasury and procurement modules on the roadmap", page: 12 },
      ],
    };
    d.capTable = {
      founderOwnershipPct: 62,
      founders: [
        { name: "Ada", role: "CEO", status: "ACTIVE_FULL_TIME", ownershipPct: 34, evidence: "Cap table slide", page: 18 },
        { name: "Bo", role: "CTO", status: "ACTIVE_FULL_TIME", ownershipPct: 28, evidence: "Cap table slide", page: 18 },
      ],
      optionPoolPct: 12,
      optionPoolAvailablePct: 10,
      convertibles: [],
      terms: [],
      investorConflicts: [],
    };
    d.syndicate = [{ name: "Fintech Seed Partners", kind: "VC_FUND", roundRole: "PARTICIPATES_CURRENT_ROUND", behaviours: ["FOLLOWS_ON_THIS_ROUND", "INTRODUCED_CUSTOMERS", "HELPED_RECRUIT"], evidence: "Existing investor taking pro-rata; introduced 4 of the first 10 customers; sourced the VP Sales", page: 19 }];
    d.survivability = {
      options: [
        { option: "CUT_BURN", status: "PLAUSIBLE", evidence: "60% of burn is hiring plan not yet committed", page: 16 },
        { option: "ALTERNATIVE_MONETIZATION", status: "DEMONSTRATED", evidence: "Payments take-rate already live with 12 customers", page: 9 },
      ],
      rigidities: [],
    };
    d.marketStructure = {
      dimensions: [
        { dimension: "SWITCHING_COSTS", reading: "FAVORABLE", evidence: "Integrated into ERP posting; 0 churned logos", page: 7 },
        { dimension: "PRICING_POWER", reading: "FAVORABLE", evidence: "Price raised 20% in 2025 with no churn", page: 8 },
        { dimension: "PROCUREMENT_POWER", reading: "NEUTRAL", evidence: "Finance team buys; no procurement process below $50k", page: 8 },
      ],
      topBuyersSharePct: null,
      topBuyersCount: null,
      addressableBuyerCount: 180_000,
      largestCompetitorSharePct: 8,
    };
    d.dependencies = [{ kind: "MODEL_PROVIDER", provider: "OpenAI", whatItProvides: "Invoice field extraction", criticality: "IMPORTANT", substitutability: "MODERATE", switchingTimeMonths: 2, mitigationStated: "Abstraction layer tested with two providers", evidence: "Model-agnostic pipeline", page: 11 }];
    d.ownedAssets = [{ asset: "PROPRIETARY_DATA", evidence: "38M labelled invoices", page: 10 }];
    d.expansion = {
      pricingModel: "PLATFORM_FEE",
      entryPrice: usd(40_000),
      largestCustomerAnnualValue: usd(260_000),
      modules: [{ name: "Payments", status: "LIVE", annualPricePerCustomer: usd(30_000), evidence: "Live since Q1", page: 12 }],
      expansionEvidence: [{ kind: "CROSS_SELL", evidence: "31% of customers bought Payments within 6 months", page: 12 }],
    };
    d.focus = { products: [{ name: "AP automation", status: "LIVE", page: 5 }], customerSegments: [{ name: "Mid-market finance teams", page: 6 }], markets: [{ name: "United States", status: "ACTIVE", page: 6 }], channels: [{ name: "Direct sales", page: 13 }] };
    d.loops = [
      {
        kind: "DATA",
        description: "More invoices → better extraction → less manual review → more customers",
        links: [
          { from: "customers", to: "labelled invoices", status: "DEMONSTRATED", evidence: "38M invoices, +2.1M per month", page: 10 },
          { from: "labelled invoices", to: "extraction accuracy", status: "DEMONSTRATED", evidence: "Accuracy 91% → 98.4% over 18 months", page: 10 },
          { from: "extraction accuracy", to: "win rate", status: "PLAUSIBLE", evidence: "Accuracy is the top buying criterion in lost-deal notes", page: 13 },
        ],
      },
    ];
    d.scalability = { signals: [{ kind: "SELF_SERVE_ONBOARDING", direction: "SCALES", evidence: "Median onboarding 3 days, no services", page: 9 }], implementationWeeks: 1, headcountByFunction: [{ function: "CUSTOMER_SUCCESS_SUPPORT", count: 3, page: 18 }] };
  });
}
