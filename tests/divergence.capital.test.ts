/**
 * Divergence factors 1–4: ambition ceiling, cap-table alignment, syndicate
 * quality (brand invariance), strategic survivability. Deterministic; the
 * model's output is built by hand.
 */
import { describe, expect, it } from "vitest";
import { emptyCanonical } from "@/domain/canonical";
import { ambitionClassOf, outcomeClass } from "@/engine/divergence/ambition";
import { founderBenchmarkFor, FOUNDER_OWNERSHIP_BENCHMARKS, DIVERGENCE_ASSUMPTIONS } from "@/engine/divergence/assumptions";
import { statedPreRoundCapTable } from "@/engine/divergence/captable";
import { BEHAVIOUR_POINTS } from "@/engine/divergence/syndicate";
import { slowdownArithmetic } from "@/engine/divergence/survivability";
import { financingMap } from "@/engine/financing";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import type { DivergenceInputs } from "@/engine/divergence/context";
import type { DivergenceDraft } from "@/domain/sections";
import { makeDeal, metric } from "./fixtures";
import { AS_OF, REG, dealWith, factor, report, usd } from "./divergence.helpers";

/* ---------------------------------------------------------------- */
/* 1. Founder ambition ceiling                                        */
/* ---------------------------------------------------------------- */

/** A French company by default: the continental-market rule (US/China/India) is tested separately. */
const frBase = () => {
  const b = makeDeal();
  b.identity = { ...b.identity, hqCountry: "France" };
  return b;
};
const scope = (productScope: DivergenceDraft["ambition"]["productScope"], geography: DivergenceDraft["ambition"]["geography"], marketFraming: DivergenceDraft["ambition"]["marketFraming"], base = frBase()) =>
  dealWith((d) => {
    d.ambition = { productScope, geography, marketFraming, statedEndState: null, signals: [] };
  }, base);

describe("divergence · 1 ambition ceiling", () => {
  it("is INSUFFICIENT_EVIDENCE without the model's ambition read", () => {
    const f = factor(makeDeal(), "AMBITION_CEILING");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.coverage.missing).toContain("model ambition read (divergence pass)");
  });

  it("classifies a single workflow, local, existing-category tool as a niche business", () => {
    const f = factor(scope("SINGLE_WORKFLOW", "LOCAL", "TOOL_IN_EXISTING_CATEGORY"), "AMBITION_CEILING");
    expect(f.ambitionClass).toBe("NICHE_BUSINESS");
    expect(f.scopeIndex).toBe(0);
  });

  it("classifies infrastructure, global, infrastructure-layer framing as a global platform", () => {
    const f = factor(scope("INFRASTRUCTURE", "GLOBAL", "INFRASTRUCTURE_LAYER"), "AMBITION_CEILING");
    expect(f.ambitionClass).toBe("GLOBAL_PLATFORM");
    expect(f.scopeIndex).toBe(3);
  });

  it("without a modelable trajectory maps global → STRONG, category → ADEQUATE, niche → WEAK", () => {
    expect(factor(scope("PLATFORM", "GLOBAL", "NEW_CATEGORY"), "AMBITION_CEILING").level).toBe("STRONG");
    expect(factor(scope("PRODUCT_SUITE", "REGIONAL", "CATEGORY_LEADER"), "AMBITION_CEILING").level).toBe("ADEQUATE");
    expect(factor(scope("SINGLE_WORKFLOW", "LOCAL", "TOOL_IN_EXISTING_CATEGORY"), "AMBITION_CEILING").level).toBe("WEAK");
  });

  it("links the class to the exit equity the economics trajectory needs (niche vs a multi-billion requirement → WEAK)", () => {
    const f = factor(scope("SINGLE_WORKFLOW", "LOCAL", "TOOL_IN_EXISTING_CATEGORY"), "AMBITION_CEILING", true);
    expect(f.requiredExitEquityUsd).toBeGreaterThan(0);
    expect(f.requiredOutcomeClass).not.toBeNull();
    expect(f.level).toBe("WEAK");
    expect(f.implications.join(" ")).toMatch(/Outcome size implied/);
  });

  it("a global platform meets the required outcome → STRONG with the required exit stated", () => {
    const f = factor(scope("INFRASTRUCTURE", "GLOBAL", "INFRASTRUCTURE_LAYER"), "AMBITION_CEILING", true);
    expect(f.level).toBe("STRONG");
    expect(f.why).toMatch(/at least the/);
  });

  it("one class short of the required outcome → ADEQUATE", () => {
    const f = factor(scope("PRODUCT_SUITE", "REGIONAL", "CATEGORY_LEADER"), "AMBITION_CEILING", true);
    expect(f.requiredOutcomeClass).toBe("GLOBAL_PLATFORM");
    expect(f.ambitionClass).toBe("CATEGORY_COMPANY");
    expect(f.level).toBe("ADEQUATE");
  });

  it("net expansive signals raise the scope index by 0.5; net contained lower it", () => {
    const sig = (direction: "EXPANSIVE" | "CONTAINED") => [1, 2].map((i) => ({ kind: "HIRING_PLAN" as const, direction, evidence: `Signal ${i} with a fact`, page: i }));
    const up = dealWith((d) => (d.ambition = { productScope: "PRODUCT_SUITE", geography: "MULTI_REGION", marketFraming: "UNCLEAR", statedEndState: null, signals: sig("EXPANSIVE") }));
    const down = dealWith((d) => (d.ambition = { productScope: "PRODUCT_SUITE", geography: "MULTI_REGION", marketFraming: "UNCLEAR", statedEndState: null, signals: sig("CONTAINED") }));
    expect(factor(up, "AMBITION_CEILING").scopeIndex).toBe(2);
    expect(factor(up, "AMBITION_CEILING").ambitionClass).toBe("GLOBAL_PLATFORM");
    expect(factor(down, "AMBITION_CEILING").scopeIndex).toBe(1);
  });

  it("signals without a stated fact are ignored", () => {
    const d = dealWith((x) => (x.ambition = { productScope: "PRODUCT_SUITE", geography: "MULTI_REGION", marketFraming: "UNCLEAR", statedEndState: null, signals: [1, 2, 3].map(() => ({ kind: "ROADMAP" as const, direction: "EXPANSIVE" as const, evidence: "", page: null })) }));
    expect(factor(d, "AMBITION_CEILING").scopeIndex).toBe(1.5);
    expect(factor(d, "AMBITION_CEILING").signals).toHaveLength(0);
  });

  it("a DISCONNECTED latent consistency caps a global ambition at ADEQUATE", () => {
    const d = scope("PLATFORM", "GLOBAL", "NEW_CATEGORY");
    d.latentSignals = { operatingMaturity: [], reasoningChains: [], vanityMetricsShown: [], presentationTechniques: [], disclosures: [], ambition: { headline: "Global leader", operationalRoadmap: "One city pilot", bridge: "not explained", consistency: "DISCONNECTED" }, causalExplanations: [] };
    const f = factor(d, "AMBITION_CEILING");
    expect(f.latentConsistency).toBe("DISCONNECTED");
    expect(f.level).toBe("ADEQUATE");
  });

  it("deck TAM never changes the ambition class", () => {
    const a = scope("PRODUCT_SUITE", "REGIONAL", "CATEGORY_LEADER");
    const b = { ...a, deckMarket: { ...a.deckMarket, tam: usd(80e9, "$80B") } };
    expect(factor(a, "AMBITION_CEILING").ambitionClass).toBe(factor(b, "AMBITION_CEILING").ambitionClass);
    expect(factor(a, "AMBITION_CEILING").scopeIndex).toBe(factor(b, "AMBITION_CEILING").scopeIndex);
  });

  it("computes the financing pace (months funded at the planned burn)", () => {
    const f = factor(scope("PLATFORM", "GLOBAL", "NEW_CATEGORY"), "AMBITION_CEILING");
    const months = f.computed.find((c) => c.key === "monthsFunded")!.value as number;
    expect(months).toBeCloseTo(15_000_000 / 550_000, 1);
  });

  it("a single-country scope in a continental-size market (US HQ) scores as regional", () => {
    const us = factor(scope("SINGLE_WORKFLOW", "LOCAL", "NEW_CATEGORY", makeDeal()), "AMBITION_CEILING");
    const fr = factor(scope("SINGLE_WORKFLOW", "LOCAL", "NEW_CATEGORY"), "AMBITION_CEILING");
    expect(us.scopeIndex).toBe(1);
    expect(us.ambitionClass).toBe("CATEGORY_COMPANY");
    expect(fr.scopeIndex).toBe(0.67);
    expect(fr.ambitionClass).toBe("NICHE_BUSINESS");
  });

  it("the continental rule also reads a stated geography signal (non-US HQ selling into the US)", () => {
    const d = dealWith((x) => (x.ambition = { productScope: "SINGLE_WORKFLOW", geography: "LOCAL", marketFraming: "NEW_CATEGORY", statedEndState: null, signals: [{ kind: "GEOGRAPHY", direction: "CONTAINED", evidence: "Target market is the US mid-market", page: 7 }] }), frBase());
    expect(factor(d, "AMBITION_CEILING").scopeIndex).toBe(1);
  });

  it("outcome and ambition class boundaries", () => {
    expect(outcomeClass(299e6)).toBe("NICHE_BUSINESS");
    expect(outcomeClass(300e6)).toBe("CATEGORY_COMPANY");
    expect(outcomeClass(3e9)).toBe("GLOBAL_PLATFORM");
    expect(ambitionClassOf(0.99)).toBe("NICHE_BUSINESS");
    expect(ambitionClassOf(1)).toBe("CATEGORY_COMPANY");
    expect(ambitionClassOf(2)).toBe("GLOBAL_PLATFORM");
  });
});

/* ---------------------------------------------------------------- */
/* 2. Cap table health & incentive alignment                          */
/* ---------------------------------------------------------------- */

const capDeal = (edit: (c: DivergenceDraft["capTable"]) => void, base = makeDeal()) => dealWith((d) => edit(d.capTable), base);

describe("divergence · 2 cap table alignment", () => {
  it("is INSUFFICIENT_EVIDENCE when no cap-table fact is shown", () => {
    const f = factor(makeDeal(), "CAP_TABLE_ALIGNMENT");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.coverage.missing).toContain("founder ownership");
    expect(f.departedFounderPct).toBeNull();
  });

  it("healthy founders (70% before a Series A, 10% pool available) → STRONG", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 70; c.optionPoolPct = 12; c.optionPoolAvailablePct = 10; }), "CAP_TABLE_ALIGNMENT");
    expect(f.level).toBe("STRONG");
    expect(f.reading).toBe("ALIGNED");
    expect(f.points).toBe(0);
  });

  it("over-diluted founder: 35% before a Series A falls below the stage floor after the round", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 35; c.optionPoolPct = 10; }), "CAP_TABLE_ALIGNMENT");
    const after = f.path.find((r) => r.label.startsWith("After Series A"))!;
    expect(after.activeFounderPct).toBeLessThan(30);
    expect(after.belowFloor).toBe(true);
    expect(f.issues.some((i) => /below the Series A floor/.test(i.issue) && i.points === 2)).toBe(true);
    expect(f.level).not.toBe("STRONG");
  });

  it("the ownership path runs through the registry's future rounds with monotone dilution", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 60; c.optionPoolPct = 10; }), "CAP_TABLE_ALIGNMENT");
    expect(f.path.map((r) => r.label)).toEqual(["Before this round (stated)", "After Series A (this round)", "After Series B", "After Series C", "After Series D"]);
    for (let i = 1; i < f.path.length; i++) expect(f.path[i]!.activeFounderPct).toBeLessThan(f.path[i - 1]!.activeFounderPct);
    const ratio = f.path[1]!.activeFounderPct / f.path[0]!.activeFounderPct;
    expect(ratio).toBeGreaterThan(0.6);
    expect(ratio).toBeLessThan(0.85);
  });

  it("the entry dilution matches the economics engine (raise ÷ post-money, pool top-up in the pre-money)", () => {
    // $12M on $48M pre = 20% new money; pool already at 10% of post → founders keep 80% of their stake at most.
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 50; c.optionPoolPct = 15; }), "CAP_TABLE_ALIGNMENT");
    expect(f.path[1]!.activeFounderPct).toBeCloseTo(50 * 0.8, 0);
  });

  it("departed co-founder holding 20% → +2 and a motivation implication", () => {
    const f = factor(
      capDeal((c) => {
        c.founderOwnershipPct = 45;
        c.optionPoolPct = 10;
        c.founders = [
          { name: "Ada", role: "CEO", status: "ACTIVE_FULL_TIME", ownershipPct: 45, evidence: "Cap table", page: 20 },
          { name: "Cy", role: "Co-founder", status: "DEPARTED", ownershipPct: 20, evidence: "Left in 2024, retains 20%", page: 20 },
        ];
      }),
      "CAP_TABLE_ALIGNMENT",
    );
    expect(f.departedFounderPct).toBe(20);
    expect(f.issues.find((i) => /Departed/.test(i.issue))!.points).toBe(2);
    expect(f.path[0]!.departedFounderPct).toBeCloseTo(20, 0);
    expect(f.implications.join(" ")).toMatch(/no longer working in the company/);
    expect(f.pages).toContain(20);
  });

  it("a departed co-founder with no stated stake is recorded without points", () => {
    const f = factor(capDeal((c) => { c.founders = [{ name: "Cy", role: "CTO", status: "DEPARTED", ownershipPct: null, evidence: "Left in 2025", page: 3 }]; }), "CAP_TABLE_ALIGNMENT");
    expect(f.departedFounderPct).toBeNull();
    expect(f.issues.some((i) => /stake not stated/.test(i.issue) && i.points === 0)).toBe(true);
  });

  it("stacked SAFEs: three caps → conversion overhang and stacking points → WEAK", () => {
    const f = factor(
      capDeal((c) => {
        c.founderOwnershipPct = 70;
        c.optionPoolPct = 10;
        c.convertibles = [
          { instrument: "SAFE_POST_MONEY", amount: usd(1e6), valuationCap: usd(5e6), discountPct: 20, evidence: "SAFE 1", page: 21 },
          { instrument: "SAFE_POST_MONEY", amount: usd(1.5e6), valuationCap: usd(8e6), discountPct: 20, evidence: "SAFE 2", page: 21 },
          { instrument: "SAFE_POST_MONEY", amount: usd(2e6), valuationCap: usd(12e6), discountPct: null, evidence: "SAFE 3", page: 21 },
        ];
      }),
      "CAP_TABLE_ALIGNMENT",
    );
    expect(f.outstandingConvertibles).toBe(3);
    expect(f.distinctCaps).toBe(3);
    expect(f.convertibleOverhangPct).toBeGreaterThan(DIVERGENCE_ASSUMPTIONS.convertibleOverhangHighPct);
    expect(f.level).toBe("WEAK");
    expect(f.implications.join(" ")).toMatch(/conversion overhang/);
  });

  it("a single small SAFE does not trigger overhang points", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 70; c.optionPoolPct = 10; c.convertibles = [{ instrument: "SAFE_POST_MONEY", amount: usd(250_000), valuationCap: usd(10e6), discountPct: null, evidence: "Angel SAFE", page: 4 }]; }), "CAP_TABLE_ALIGNMENT");
    expect(f.convertibleOverhangPct).toBeLessThan(DIVERGENCE_ASSUMPTIONS.convertibleOverhangWatchPct);
    expect(f.issues.some((i) => /convert/.test(i.issue))).toBe(false);
  });

  it("the overhang is computable without the founders' stake", () => {
    const f = factor(capDeal((c) => { c.convertibles = [{ instrument: "SAFE_POST_MONEY", amount: usd(2e6), valuationCap: usd(10e6), discountPct: null, evidence: "SAFE", page: 4 }]; }), "CAP_TABLE_ALIGNMENT");
    expect(f.convertibleOverhangPct).toBeCloseTo(20, 0);
  });

  it("the current round counts in the cap stack when it is a SAFE", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, instrument: "SAFE", valuationCap: usd(20e6), preMoney: null };
    const f = factor(capDeal((c) => { c.convertibles = [1, 2].map((i) => ({ instrument: "SAFE_POST_MONEY" as const, amount: usd(500_000), valuationCap: usd(i * 4e6), discountPct: null, evidence: `SAFE ${i}`, page: 4 })); }, base), "CAP_TABLE_ALIGNMENT");
    expect(f.distinctCaps).toBe(3);
    expect(f.issues.some((i) => /stacked/.test(i.issue))).toBe(true);
  });

  it("an insufficient unallocated pool for the stage adds a point and a hiring implication", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 70; c.optionPoolPct = 8; c.optionPoolAvailablePct = 3; }), "CAP_TABLE_ALIGNMENT");
    expect(f.issues.some((i) => /option pool/.test(i.issue) && i.points === 1)).toBe(true);
    expect(f.implications.join(" ")).toMatch(/Hiring/);
    expect(f.level).toBe("ADEQUATE");
  });

  it("heavy preferences and control terms add points", () => {
    const f = factor(
      capDeal((c) => {
        c.founderOwnershipPct = 70;
        c.optionPoolPct = 12;
        c.terms = [
          { term: "PARTICIPATING_PREFERRED", evidence: "Seed is participating", page: 22 },
          { term: "INVESTOR_OPERATING_VETO", evidence: "Seed lead approves budget", page: 22 },
        ];
      }),
      "CAP_TABLE_ALIGNMENT",
    );
    expect(f.points).toBe(2);
    expect(f.level).toBe("ADEQUATE");
  });

  it("this round's > 1x preference counts as heavy", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, terms: { ...base.financing!.terms, liquidationPreferenceMultiple: 2 } };
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 70; c.optionPoolPct = 12; }, base), "CAP_TABLE_ALIGNMENT");
    expect(f.issues.some((i) => /Heavy preferences/.test(i.issue))).toBe(true);
  });

  it("a stated investor conflict adds a point", () => {
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 70; c.optionPoolPct = 12; c.investorConflicts = [{ evidence: "Strategic investor is the largest competitor's parent", page: 19 }]; }), "CAP_TABLE_ALIGNMENT");
    expect(f.issues.some((i) => /Investor conflict/.test(i.issue))).toBe(true);
  });

  it("without entry terms the path stops before the round and the previous stage's benchmark is used", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, raiseAmount: null, preMoney: null, postMoney: null };
    const f = factor(capDeal((c) => { c.founderOwnershipPct = 40; c.optionPoolPct = 10; }, base), "CAP_TABLE_ALIGNMENT");
    expect(f.path).toHaveLength(1);
    expect(f.pathNotes.join(" ")).toMatch(/Entry terms/);
    expect(f.issues.some((i) => /post-Seed/.test(i.issue))).toBe(true);
  });

  it("STRONG requires a stated founder stake", () => {
    const f = factor(capDeal((c) => { c.optionPoolPct = 12; c.optionPoolAvailablePct = 11; }), "CAP_TABLE_ALIGNMENT");
    expect(f.level).toBe("ADEQUATE");
  });

  it("stated ownership above 100% is rescaled with a note", () => {
    const { ct, notes } = statedPreRoundCapTable(80, 30, 10, [], null);
    expect(notes[0]).toMatch(/rescaled/);
    const total = ct.holdings.reduce((s, h) => s + h.shares, 0);
    expect(total).toBeCloseTo(10_000_000, 0);
  });

  it("the founder ownership benchmark table is versioned, monotone and labelled MODEL_ASSUMPTION", () => {
    expect(FOUNDER_OWNERSHIP_BENCHMARKS.kind).toBe("MODEL_ASSUMPTION");
    expect(FOUNDER_OWNERSHIP_BENCHMARKS.version).toMatch(/^founder-ownership-/);
    const rows = FOUNDER_OWNERSHIP_BENCHMARKS.rows;
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.typicalPct).toBeLessThan(rows[i - 1]!.typicalPct);
      expect(rows[i]!.floorPct).toBeLessThan(rows[i]!.typicalPct);
    }
    expect(founderBenchmarkFor("Pre-seed")!.round).toBe("Pre-seed");
    expect(founderBenchmarkFor("After Series C")!.round).toBe("Series C");
    expect(founderBenchmarkFor("Next round")).toBeNull();
  });
});

/* ---------------------------------------------------------------- */
/* 3. Syndicate quality — behaviour, never brand                      */
/* ---------------------------------------------------------------- */

type Inv = DivergenceDraft["syndicate"][number];
const inv = (name: string, behaviours: Inv["behaviours"], evidence = "Stated on the investor slide with dates", extra: Partial<Inv> = {}): Inv => ({ name, kind: "VC_FUND", roundRole: "PARTICIPATES_CURRENT_ROUND", behaviours, evidence, page: 19, ...extra });
const synd = (list: Inv[], base = makeDeal()) => dealWith((d) => (d.syndicate = list), base);

describe("divergence · 3 syndicate quality (not prestige)", () => {
  it("no investors named → INSUFFICIENT_EVIDENCE", () => {
    const f = factor(makeDeal(), "SYNDICATE_QUALITY");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.reading).toBe("NO_INVESTORS_NAMED");
  });

  it("names from the financing extraction only → NAMES_ONLY, never a level", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, leadInvestor: "Sequoia Capital", existingInvestors: ["Andreessen Horowitz", "Y Combinator"] };
    const f = factor(base, "SYNDICATE_QUALITY");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.reading).toBe("NAMES_ONLY");
    expect(f.investors).toHaveLength(3);
    expect(f.implications.join(" ")).toMatch(/shows only names/);
  });

  it("famous names with no stated behaviour do not raise the level", () => {
    const f = factor(synd([inv("Sequoia Capital", []), inv("Benchmark", [])]), "SYNDICATE_QUALITY");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("BRAND INVARIANCE: swapping a famous fund for an unknown one with identical evidence leaves the level unchanged", () => {
    const behaviours: Inv["behaviours"] = ["FOLLOWS_ON_THIS_ROUND", "INTRODUCED_CUSTOMERS", "HELPED_RECRUIT"];
    const evidence = "Taking full pro-rata; introduced 3 of 12 customers; sourced the VP Engineering";
    const famous = factor(synd([inv("Sequoia Capital", behaviours, evidence)]), "SYNDICATE_QUALITY");
    const unknown = factor(synd([inv("Kestrel Row Ventures", behaviours, evidence)]), "SYNDICATE_QUALITY");
    expect(unknown.level).toBe(famous.level);
    expect(unknown.reading).toBe(famous.reading);
    expect(unknown.capabilities).toEqual(famous.capabilities);
    expect(unknown.computed.map((c) => c.value)).toEqual(famous.computed.map((c) => c.value));
  });

  it("BRAND INVARIANCE also holds for weak syndicates and for investor kind", () => {
    const a = factor(synd([inv("Andreessen Horowitz", ["NOT_FOLLOWING_ON"], "Not participating in this round", { roundRole: "EXISTING_NOT_PARTICIPATING" })]), "SYNDICATE_QUALITY");
    const b = factor(synd([inv("Smalltown Angels", ["NOT_FOLLOWING_ON"], "Not participating in this round", { roundRole: "EXISTING_NOT_PARTICIPATING", kind: "ANGEL" })]), "SYNDICATE_QUALITY");
    expect(a.level).toBe("WEAK");
    expect(b.level).toBe(a.level);
  });

  it("an extremely active specialist → STRONG; an inactive famous investor → WEAK", () => {
    const specialist = factor(synd([inv("Niche Fintech Fund", ["FOLLOWS_ON_THIS_ROUND", "INTRODUCED_CUSTOMERS", "HELPED_RECRUIT", "SECTOR_SPECIALIST"])]), "SYNDICATE_QUALITY");
    const famousInactive = factor(synd([inv("Sequoia Capital", ["NOT_FOLLOWING_ON"], "Declined to follow on", { roundRole: "EXISTING_NOT_PARTICIPATING" })]), "SYNDICATE_QUALITY");
    expect(specialist.level).toBe("STRONG");
    expect(specialist.reading).toBe("ACTIVE_AND_SUPPORTIVE");
    expect(famousInactive.level).toBe("WEAK");
  });

  it("behaviour reported without a stated fact is not counted", () => {
    const f = factor(synd([inv("Fund A", ["FOLLOWS_ON_THIS_ROUND", "INTRODUCED_CUSTOMERS"], "")]), "SYNDICATE_QUALITY");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.investors[0]!.counted).toHaveLength(0);
    expect(f.evidence.some((e) => /not counted/.test(e.text))).toBe(true);
  });

  it("partial support → ADEQUATE", () => {
    const f = factor(synd([inv("Fund A", ["FOLLOWS_ON_THIS_ROUND"])]), "SYNDICATE_QUALITY");
    expect(f.level).toBe("ADEQUATE");
    expect(f.capabilities.find((c) => c.capability === "NEXT_ROUND")!.net).toBe(2);
  });

  it("a conflict of interest makes governance negative", () => {
    const f = factor(synd([inv("Corp VC", ["CONFLICT_OF_INTEREST"], "Parent company sells a competing product", { kind: "STRATEGIC_CORPORATE" })]), "SYNDICATE_QUALITY");
    expect(f.capabilities.find((c) => c.capability === "GOVERNANCE")!.net).toBeLessThan(0);
    expect(f.level).toBe("WEAK");
  });

  it("cap-table investor conflicts and operating vetoes count against governance", () => {
    const d = dealWith((x) => {
      x.syndicate = [inv("Fund A", ["FOLLOWS_ON_THIS_ROUND", "INTRODUCED_CUSTOMERS", "HELPED_RECRUIT"])];
      x.capTable.investorConflicts = [{ evidence: "Two investors hold competing board seats", page: 19 }];
      x.capTable.terms = [{ term: "INVESTOR_OPERATING_VETO", evidence: "Veto on hiring above $200k", page: 22 }];
    });
    const f = factor(d, "SYNDICATE_QUALITY");
    expect(f.capabilities.find((c) => c.capability === "GOVERNANCE")!.net).toBe(-3);
    expect(f.level).toBe("ADEQUATE");
  });

  it("independent research that states a participation counts (content, not name); company-derived claims do not", () => {
    const base = makeDeal();
    const indep = { id: "CLM-900", category: "FUNDING" as const, statement: "Kestrel Row Ventures led the company's seed and participated again in 2025", valueText: null, entity: "company", period: null, material: true, unusualness: 2, proposition: null, evidenceNeeded: null, origin: "INDEPENDENT_SECONDARY" as const, verification: "PARTIALLY_VERIFIED" as const, freshness: "CURRENT" as const, independence: "INDEPENDENT" as const, verificationMethod: "research", limitations: null, contradictions: [], evidence: [], history: [] };
    const companyClaim = { ...indep, id: "CLM-901", origin: "COMPANY" as const, independence: "COMPANY_DERIVED" as const };
    base.claims = [indep, companyClaim];
    const f = factor(synd([inv("Kestrel Row Ventures", [])], base), "SYNDICATE_QUALITY");
    expect(f.investors[0]!.researchRefs).toEqual(["CLM-900"]);
    expect(f.level).toBe("ADEQUATE");
    expect(f.evidence.some((e) => e.basis === "RESEARCH" && e.refs.includes("CLM-900"))).toBe(true);
  });

  it("duplicate investor entries are merged", () => {
    const f = factor(synd([inv("Fund A", ["FOLLOWS_ON_THIS_ROUND"]), inv("fund a.", ["HELPED_RECRUIT"])]), "SYNDICATE_QUALITY");
    expect(f.investors).toHaveLength(1);
    expect(f.investors[0]!.counted.sort()).toEqual(["FOLLOWS_ON_THIS_ROUND", "HELPED_RECRUIT"]);
  });

  it("the behaviour table is the only input to the level (no name-, fame- or kind-keyed entries)", () => {
    for (const pts of Object.values(BEHAVIOUR_POINTS)) for (const v of Object.values(pts)) expect(Math.abs(v!)).toBeLessThanOrEqual(2);
    expect(Object.keys(BEHAVIOUR_POINTS)).toHaveLength(10);
  });
});

/* ---------------------------------------------------------------- */
/* 4. Strategic survivability                                         */
/* ---------------------------------------------------------------- */

function inputsFor(deal: ReturnType<typeof makeDeal>): DivergenceInputs {
  return { deal, draft: deal.divergence, registry: REG, peer: resolvePeerGroup(deal.classification), asOf: AS_OF, market: null, financing: financingMap(deal, REG), economics: null, latentAmbition: null, economicsContext: null };
}

const opt = (option: DivergenceDraft["survivability"]["options"][number]["option"], status: "DEMONSTRATED" | "PLAUSIBLE" | "ASSERTED" = "PLAUSIBLE") => ({ option, status, evidence: `${option} supported by a stated fact`, page: 15 });

describe("divergence · 4 strategic survivability", () => {
  it("computes the slowdown arithmetic exactly (cash + round, planned burn, flat gross profit, 40% opex cut)", () => {
    const a = slowdownArithmetic(inputsFor(makeDeal()));
    // makeDeal: $3M cash + $12M round, planned burn $550k, milestone 20 months; ARR $3.84M at 76% GM.
    const gp = (3_840_000 / 12) * 0.76;
    expect(a.cashAfterRoundUsd).toBe(15_000_000);
    expect(a.monthlyGrossProfitUsd).toBeCloseTo(gp, 0);
    expect(a.requiredMonths).toBe(20 + REG.returns.fundraisingLeadMonths + 24);
    expect(a.runwayAtPlanMonths).toBeCloseTo(15_000_000 / 550_000, 1);
    expect(a.burnAfterCutsUsd).toBeCloseTo((550_000 + gp) * 0.6 - gp, -1);
    expect(a.status).toBe("SURVIVES_WITH_CUTS");
    expect(a.requiredOpexCutPct).toBeGreaterThan(0);
    expect(a.requiredOpexCutPct).toBeLessThan(40);
  });

  it("DEFAULT_ALIVE_AFTER_CUTS when gross profit covers the cut cost base", () => {
    const d = makeDeal({ metrics: [metric("arr", 20_000_000), metric("gross_margin", 80, { unit: "PERCENT" })] });
    expect(slowdownArithmetic(inputsFor(d)).status).toBe("DEFAULT_ALIVE_AFTER_CUTS");
  });

  it("SURVIVES_AT_PLAN when the round funds the slowdown", () => {
    const d = makeDeal();
    d.financing = { ...d.financing!, raiseAmount: usd(40e6) };
    expect(slowdownArithmetic(inputsFor(d)).status).toBe("SURVIVES_AT_PLAN");
  });

  it("DOES_NOT_SURVIVE with a bridge sized from the shortfall", () => {
    const d = makeDeal({ metrics: [] });
    d.financing = { ...d.financing!, raiseAmount: usd(5e6), preMoney: usd(20e6) };
    const a = slowdownArithmetic(inputsFor(d));
    expect(a.status).toBe("DOES_NOT_SURVIVE");
    expect(a.monthlyGrossProfitUsd).toBeNull();
    expect(a.bridgeNeededAtPlanUsd).toBeCloseTo((a.requiredMonths! - 8_000_000 / 550_000) * 550_000, -2);
  });

  it("UNKNOWN without burn; INSUFFICIENT_EVIDENCE without options either", () => {
    const d = makeDeal();
    d.financing = { ...d.financing!, monthlyBurn: null };
    d.financingPath = null;
    expect(slowdownArithmetic(inputsFor(d)).status).toBe("UNKNOWN");
    expect(factor(d, "STRATEGIC_SURVIVABILITY").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("without the model's read of options: arithmetic alone, capped at ADEQUATE", () => {
    const f = factor(makeDeal(), "STRATEGIC_SURVIVABILITY");
    expect(f.level).toBe("ADEQUATE");
    expect(f.reading).toMatch(/^OPTIONS_UNREAD/);
  });

  it("survives at plan with ≥ 2 real options → STRONG (MANY/FEW paths)", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, raiseAmount: usd(40e6) };
    const f = factor(dealWith((d) => (d.survivability.options = [opt("LICENSE_TECHNOLOGY"), opt("ALTERNATIVE_MONETIZATION", "DEMONSTRATED")]), base), "STRATEGIC_SURVIVABILITY");
    expect(f.level).toBe("STRONG");
    expect(f.realOptions).toBe(2);
  });

  it("one path: survives only with cuts and no other option → WEAK", () => {
    const f = factor(dealWith(() => {}), "STRATEGIC_SURVIVABILITY");
    // Only the computed burn cut counts as an option.
    expect(f.realOptions).toBe(1);
    expect(f.level).toBe("WEAK");
    expect(f.implications.join(" ")).toMatch(/One path/);
  });

  it("asserted options are listed but not counted", () => {
    const f = factor(dealWith((d) => (d.survivability.options = [opt("LICENSE_TECHNOLOGY", "ASSERTED"), opt("CHANGE_GTM", "ASSERTED")])), "STRATEGIC_SURVIVABILITY");
    expect(f.assertedOnly).toBe(2);
    expect(f.realOptions).toBe(1);
  });

  it("the same option twice counts once", () => {
    const f = factor(dealWith((d) => (d.survivability.options = [opt("CHANGE_GTM"), opt("CHANGE_GTM", "DEMONSTRATED")])), "STRATEGIC_SURVIVABILITY");
    expect(f.realOptions).toBe(2); // CHANGE_GTM + computed CUT_BURN
  });

  it("two rigidities downgrade one level", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, raiseAmount: usd(40e6) };
    const f = factor(
      dealWith((d) => {
        d.survivability.options = [opt("LICENSE_TECHNOLOGY"), opt("CHANGE_GTM")];
        d.survivability.rigidities = [
          { kind: "HARDWARE_OR_INVENTORY", evidence: "$4M inventory commitment", page: 17 },
          { kind: "REGULATORY_TIMELINE", evidence: "Licence renewal due in 2027", page: 17 },
        ];
      }, base),
      "STRATEGIC_SURVIVABILITY",
    );
    expect(f.level).toBe("ADEQUATE");
  });

  it("runs the economics counterfactual engine with the +24-month delay in the full layer", () => {
    const f = factor(dealWith((d) => (d.survivability.options = [opt("CHANGE_GTM")])), "STRATEGIC_SURVIVABILITY", true);
    expect(f.counterfactualHeadline).toMatch(/next round \+24 months/);
    expect(f.evidence.some((e) => /Economics engine/.test(e.text))).toBe(true);
  });

  it("falls back to the economics report's 12-month reference shock when no context is given", () => {
    const d = makeDeal();
    const full = factor(d, "STRATEGIC_SURVIVABILITY", true);
    expect(full.counterfactualHeadline).not.toBeNull();
  });

  it("gross margin unknown → revenue does not offset cuts (conservative) and it says so", () => {
    const d = makeDeal({ metrics: [metric("arr", 3_000_000)] });
    const a = slowdownArithmetic(inputsFor(d));
    expect(a.monthlyGrossProfitUsd).toBeNull();
    expect(a.notes.join(" ")).toMatch(/Gross margin unknown/);
  });

  it("an empty canonical never throws", () => {
    const d = emptyCanonical("STANDARD");
    expect(() => slowdownArithmetic(inputsFor(d))).not.toThrow();
    expect(report(d).factors.find((f) => f.id === "STRATEGIC_SURVIVABILITY")!.level).toBe("INSUFFICIENT_EVIDENCE");
  });
});
