/**
 * Divergence factors 5–10: market structure (size invariance), dependency
 * surface, land → expand → platform, organizational focus, compounding loops,
 * scalability architecture.
 */
import { describe, expect, it } from "vitest";
import type { DivergenceDraft } from "@/domain/sections";
import { STRUCTURE_WEIGHTS } from "@/engine/divergence/market-structure";
import { dangerOf, SINGLE_POINT_DANGER } from "@/engine/divergence/dependency";
import { loopStatus, normalizeLink } from "@/engine/divergence/loops";
import { grossMarginTrend } from "@/engine/divergence/scalability";
import { makeDeal, metric } from "./fixtures";
import { dealWith, factor, usd } from "./divergence.helpers";
import { obs } from "./fixtures/integrity/builders";

/* ---------------------------------------------------------------- */
/* 5. Market structure (not size)                                     */
/* ---------------------------------------------------------------- */

type Dim = DivergenceDraft["marketStructure"]["dimensions"][number];
const dim = (dimension: Dim["dimension"], reading: Dim["reading"], evidence = `${dimension} fact`): Dim => ({ dimension, reading, evidence, page: 7 });
const market = (dims: Dim[], extra: Partial<DivergenceDraft["marketStructure"]> = {}, base = makeDeal()) =>
  dealWith((d) => (d.marketStructure = { dimensions: dims, topBuyersSharePct: null, topBuyersCount: null, addressableBuyerCount: null, largestCompetitorSharePct: null, ...extra }), base);
const noBottomUp = () => {
  const b = makeDeal();
  b.market = { ...b.market!, bottomUp: null };
  return b;
};

describe("divergence · 5 market structure (not size)", () => {
  it("fewer than 3 readable dimensions → INSUFFICIENT_EVIDENCE", () => {
    const f = factor(market([dim("PRICING_POWER", "FAVORABLE")], {}, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.structureBalance).toBeNull();
  });

  it("a $20B TAM with top-5 buyers at 80%, low switching costs and incumbents giving it away → WEAK", () => {
    const base = noBottomUp();
    base.deckMarket = { ...base.deckMarket, tam: usd(20e9, "$20B") };
    const f = factor(market([dim("SWITCHING_COSTS", "UNFAVORABLE"), dim("INCUMBENT_BUNDLING", "UNFAVORABLE"), dim("PRICING_POWER", "UNFAVORABLE")], { topBuyersSharePct: 80, topBuyersCount: 5 }, base), "MARKET_STRUCTURE");
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("STRUCTURALLY_HOSTILE");
    expect(f.dimensions.find((d) => d.dimension === "BUYER_CONCENTRATION")!.basis).toBe("COMPUTED");
    expect(f.implications.join(" ")).toMatch(/Size is not structure/);
  });

  it("a smaller fragmented, underserved, winner-take-most market → STRONG", () => {
    const f = factor(market([dim("SWITCHING_COSTS", "FAVORABLE"), dim("WINNER_TAKE_DYNAMICS", "FAVORABLE"), dim("PRICING_POWER", "FAVORABLE")], { addressableBuyerCount: 40_000 }, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.level).toBe("STRONG");
    expect(f.reading).toBe("STRUCTURALLY_ATTRACTIVE");
    expect(f.dimensions.find((d) => d.dimension === "FRAGMENTATION")!.reading).toBe("FAVORABLE");
  });

  it("SIZE INVARIANCE: the same structure with a $500M or a $50B market gives the same level", () => {
    const dims = [dim("SWITCHING_COSTS", "FAVORABLE"), dim("PRICING_POWER", "NEUTRAL"), dim("PROCUREMENT_POWER", "UNFAVORABLE")];
    const small = noBottomUp();
    small.deckMarket = { ...small.deckMarket, tam: usd(5e8, "$500M") };
    const big = noBottomUp();
    big.deckMarket = { ...big.deckMarket, tam: usd(5e10, "$50B") };
    const a = factor(market(dims, {}, small), "MARKET_STRUCTURE");
    const b = factor(market(dims, {}, big), "MARKET_STRUCTURE");
    expect(a.level).toBe(b.level);
    expect(a.structureBalance).toBe(b.structureBalance);
    expect(a.marketSize.deckTamUsd).not.toBe(b.marketSize.deckTamUsd);
  });

  it("a stated top-buyer share overrides the model's favourable reading and caps the level at ADEQUATE", () => {
    const f = factor(market([dim("BUYER_CONCENTRATION", "FAVORABLE"), dim("SWITCHING_COSTS", "FAVORABLE"), dim("PRICING_POWER", "FAVORABLE"), dim("WINNER_TAKE_DYNAMICS", "FAVORABLE")], { topBuyersSharePct: 70 }, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.dimensions.find((d) => d.dimension === "BUYER_CONCENTRATION")!.reading).toBe("UNFAVORABLE");
    expect(f.level).toBe("ADEQUATE");
  });

  it("contradictory readings of one dimension collapse to NEUTRAL", () => {
    const f = factor(market([dim("PRICING_POWER", "FAVORABLE", "Raised prices"), dim("PRICING_POWER", "UNFAVORABLE", "Discounting to win"), dim("SWITCHING_COSTS", "FAVORABLE"), dim("PROCUREMENT_POWER", "NEUTRAL")], {}, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.dimensions.find((d) => d.dimension === "PRICING_POWER")!.reading).toBe("NEUTRAL");
    expect(f.implications.join(" ")).toMatch(/both ways/);
  });

  it("UNKNOWN readings and readings without a fact are ignored", () => {
    const f = factor(market([dim("PRICING_POWER", "UNKNOWN"), dim("SWITCHING_COSTS", "FAVORABLE", ""), dim("FRAGMENTATION", "FAVORABLE")], {}, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.assessed).toBe(1);
  });

  it("the buyer count falls back to the bottom-up market reconstruction", () => {
    const f = factor(market([dim("PRICING_POWER", "FAVORABLE"), dim("SWITCHING_COSTS", "NEUTRAL")]), "MARKET_STRUCTURE");
    const frag = f.dimensions.find((d) => d.dimension === "FRAGMENTATION")!;
    expect(frag.reading).toBe("FAVORABLE");
    expect(frag.evidence).toMatch(/bottom-up/);
    expect(f.assessed).toBe(3);
  });

  it("few buyers → concentrated (UNFAVORABLE fragmentation)", () => {
    const f = factor(market([dim("PRICING_POWER", "NEUTRAL"), dim("SWITCHING_COSTS", "NEUTRAL")], { addressableBuyerCount: 60 }, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.dimensions.find((d) => d.dimension === "FRAGMENTATION")!.reading).toBe("UNFAVORABLE");
  });

  it("a dominant incumbent means the winner-take position is already taken", () => {
    const f = factor(market([dim("PRICING_POWER", "NEUTRAL"), dim("SWITCHING_COSTS", "NEUTRAL")], { largestCompetitorSharePct: 55 }, noBottomUp()), "MARKET_STRUCTURE");
    expect(f.dimensions.find((d) => d.dimension === "WINNER_TAKE_DYNAMICS")!.reading).toBe("UNFAVORABLE");
  });

  it("an incumbent-copy adversarial test that FAILS reads as incumbent bundling risk when the deck is silent", () => {
    const base = noBottomUp();
    base.competition = { competitors: [], comparison: [], adversarialTests: [{ test: "INCUMBENT_COPY", scenario: "SAP bundles it", outcome: "Customers switch to the bundle", verdict: "FAILS" }] };
    const f = factor(market([dim("PRICING_POWER", "NEUTRAL"), dim("SWITCHING_COSTS", "NEUTRAL")], {}, base), "MARKET_STRUCTURE");
    expect(f.dimensions.find((d) => d.dimension === "INCUMBENT_BUNDLING")!.reading).toBe("UNFAVORABLE");
  });

  it("the value-capture dimensions weigh double", () => {
    expect(STRUCTURE_WEIGHTS.BUYER_CONCENTRATION).toBe(2);
    expect(STRUCTURE_WEIGHTS.SWITCHING_COSTS).toBe(2);
    expect(STRUCTURE_WEIGHTS.FRAGMENTATION).toBe(1);
    expect(Object.keys(STRUCTURE_WEIGHTS)).toHaveLength(10);
  });
});

/* ---------------------------------------------------------------- */
/* 6. Dependency surface                                              */
/* ---------------------------------------------------------------- */

type Dep = DivergenceDraft["dependencies"][number];
const dep = (kind: Dep["kind"], provider: string, criticality: Dep["criticality"], substitutability: Dep["substitutability"], extra: Partial<Dep> = {}): Dep => ({ kind, provider, whatItProvides: `${provider} service`, criticality, substitutability, switchingTimeMonths: null, mitigationStated: null, evidence: `${provider} stated on the architecture slide`, page: 11, ...extra });
const nonAi = () => {
  const b = makeDeal({ metrics: [] });
  b.classification = { ...b.classification, technology: [], productType: ["SAAS"] };
  return b;
};

describe("divergence · 6 dependency surface", () => {
  it("100% OpenAI dependency → CRITICAL_SINGLE_POINT, WEAK, most dangerous named", () => {
    const f = factor(dealWith((d) => (d.dependencies = [dep("MODEL_PROVIDER", "OpenAI", "CORE", "HARD", { whatItProvides: "100% of inference" })])), "DEPENDENCY_SURFACE");
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("CRITICAL_SINGLE_POINT");
    expect(f.mostDangerous!.provider).toBe("OpenAI");
    expect(f.mostDangerous!.danger).toBe(SINGLE_POINT_DANGER);
    expect(f.implications.join(" ")).toMatch(/COMMODITIZATION/);
  });

  it("the same single point with ≥ 3 owned asset types → ADEQUATE", () => {
    const f = factor(
      dealWith((d) => {
        d.dependencies = [dep("MODEL_PROVIDER", "OpenAI", "CORE", "HARD")];
        d.ownedAssets = (["PROPRIETARY_DATA", "DISTRIBUTION", "CUSTOMER_RELATIONSHIP"] as const).map((asset) => ({ asset, evidence: `${asset} evidence`, page: 10 }));
      }),
      "DEPENDENCY_SURFACE",
    );
    expect(f.level).toBe("ADEQUATE");
  });

  it("nothing critical on a non-AI product → STRONG (CONTAINED)", () => {
    const f = factor(dealWith((d) => (d.dependencies = [dep("CLOUD_INFRASTRUCTURE", "AWS", "IMPORTANT", "EASY")]), nonAi()), "DEPENDENCY_SURFACE");
    expect(f.level).toBe("STRONG");
    expect(f.reading).toBe("CONTAINED");
  });

  it("an AI product with an undisclosed model provider cannot be STRONG and the gap is listed", () => {
    const f = factor(dealWith(() => {}, makeDeal({ metrics: [] })), "DEPENDENCY_SURFACE");
    expect(f.level).toBe("ADEQUATE");
    expect(f.reading).toBe("CONTAINED_MODEL_UNDISCLOSED");
    expect(f.coverage.missing).toContain("model provider (AI product)");
  });

  it("four important, hard-to-replace dependencies → WIDE_SURFACE, WEAK", () => {
    const f = factor(dealWith((d) => (d.dependencies = ["Apple App Store", "Plaid", "Stripe", "Experian"].map((p, i) => dep((["APP_STORE", "PLATFORM_API", "BANKING_OR_PAYMENT_PARTNER", "DATA_SOURCE"] as const)[i]!, p, "IMPORTANT", "MODERATE"))), nonAi()), "DEPENDENCY_SURFACE");
    expect(f.surfaceCount).toBe(4);
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("WIDE_SURFACE");
  });

  it("danger = criticality × substitutability × switching time × mitigation", () => {
    expect(dangerOf({ criticality: "CORE", substitutability: "HARD", switchingTimeMonths: null, mitigation: null })).toBe(9);
    expect(dangerOf({ criticality: "CORE", substitutability: "HARD", switchingTimeMonths: 12, mitigation: null })).toBe(13.5);
    expect(dangerOf({ criticality: "CORE", substitutability: "MODERATE", switchingTimeMonths: 6, mitigation: null })).toBe(7.5);
    expect(dangerOf({ criticality: "CORE", substitutability: "HARD", switchingTimeMonths: null, mitigation: "Second provider live" })).toBe(6.75);
    expect(dangerOf({ criticality: "PERIPHERAL", substitutability: "EASY", switchingTimeMonths: null, mitigation: null })).toBe(1);
  });

  it("a stated mitigation takes a core/hard dependency below the single-point threshold", () => {
    const f = factor(dealWith((d) => (d.dependencies = [dep("MODEL_PROVIDER", "OpenAI", "CORE", "HARD", { mitigationStated: "Anthropic fallback in production" })])), "DEPENDENCY_SURFACE");
    expect(f.reading).toBe("MATERIAL");
    expect(f.level).toBe("ADEQUATE");
  });

  it("customer concentration ≥ 30% becomes a computed CORE key-customer dependency with the metric ref", () => {
    const f = factor(dealWith(() => {}, makeDeal({ metrics: [metric("customer_concentration_top1", 45, { unit: "PERCENT", id: "MET-C1" })] })), "DEPENDENCY_SURFACE");
    const k = f.dependencies.find((x) => x.kind === "KEY_CUSTOMER")!;
    expect(k.basis).toBe("COMPUTED");
    expect(k.criticality).toBe("CORE");
    expect(k.refs).toEqual(["MET-C1"]);
  });

  it("customer concentration of 20% is IMPORTANT; 10% is not a dependency", () => {
    const at = (v: number) => factor(dealWith(() => {}, makeDeal({ metrics: [metric("customer_concentration_top1", v, { unit: "PERCENT" })] })), "DEPENDENCY_SURFACE").dependencies.find((x) => x.kind === "KEY_CUSTOMER");
    expect(at(20)!.criticality).toBe("IMPORTANT");
    expect(at(10)).toBeUndefined();
  });

  it("a key customer reported by the model is not duplicated", () => {
    const f = factor(dealWith((d) => (d.dependencies = [dep("KEY_CUSTOMER", "Walmart", "CORE", "HARD")]), makeDeal({ metrics: [metric("customer_concentration_top1", 45, { unit: "PERCENT" })] })), "DEPENDENCY_SURFACE");
    expect(f.dependencies.filter((x) => x.kind === "KEY_CUSTOMER")).toHaveLength(1);
  });

  it("peripheral and easy dependencies are not on the surface; the list is sorted most dangerous first", () => {
    const f = factor(dealWith((d) => (d.dependencies = [dep("CLOUD_INFRASTRUCTURE", "AWS", "PERIPHERAL", "EASY"), dep("DATA_SOURCE", "Bloomberg", "CORE", "MODERATE")]), nonAi()), "DEPENDENCY_SURFACE");
    expect(f.surfaceCount).toBe(1);
    expect(f.dependencies[0]!.provider).toBe("Bloomberg");
  });

  it("no draft and no concentration → INSUFFICIENT_EVIDENCE", () => {
    expect(factor(makeDeal({ metrics: [] }), "DEPENDENCY_SURFACE").level).toBe("INSUFFICIENT_EVIDENCE");
  });
});

/* ---------------------------------------------------------------- */
/* 7. Land → expand → platform                                        */
/* ---------------------------------------------------------------- */

type Mod = DivergenceDraft["expansion"]["modules"][number];
const mod = (name: string, status: Mod["status"], price: number | null): Mod => ({ name, status, annualPricePerCustomer: price === null ? null : usd(price), evidence: `${name} on the roadmap slide`, page: 12 });
const wedgeDeal = (acv: number | null, extraMetrics = [] as ReturnType<typeof metric>[]) => makeDeal({ metrics: [...(acv !== null ? [metric("acv", acv, { id: "MET-ACV" })] : []), ...extraMetrics] });
const exp = (edit: (e: DivergenceDraft["expansion"]) => void, base = wedgeDeal(10_000)) => dealWith((d) => edit(d.expansion), base);

describe("divergence · 7 land → expand → platform", () => {
  it("a $10k wedge with a platform roadmap reaching $500k/customer → PLATFORM_ON_ROADMAP (ADEQUATE)", () => {
    const f = factor(exp((e) => (e.modules = [mod("Payments", "ROADMAP", 90_000), mod("Treasury", "ROADMAP", 150_000), mod("Procurement", "VISION", 250_000)])), "LAND_EXPAND_PLATFORM");
    expect(f.wedgeAcvUsd).toBe(10_000);
    expect(f.platformCeilingUsd).toBe(500_000);
    expect(f.platformMultiple).toBe(50);
    expect(f.level).toBe("ADEQUATE");
    expect(f.reading).toBe("PLATFORM_ON_ROADMAP");
  });

  it("a $10k wedge whose largest customer already pays $500k → PLATFORM_DEMONSTRATED (STRONG)", () => {
    const f = factor(exp((e) => (e.largestCustomerAnnualValue = usd(500_000))), "LAND_EXPAND_PLATFORM");
    expect(f.demonstratedMultiple).toBe(50);
    expect(f.level).toBe("STRONG");
  });

  it("NRR 130% demonstrates ≥ 2× and a ≥ 10× roadmap makes it STRONG", () => {
    const f = factor(exp((e) => (e.modules = [mod("Suite", "ROADMAP", 120_000)]), wedgeDeal(10_000, [metric("nrr", 130, { unit: "PERCENT" })])), "LAND_EXPAND_PLATFORM");
    expect(f.nrrPathUsd).toBeCloseTo(10_000 * 1.3 ** 5, -1);
    expect(f.demonstratedMultiple).toBeGreaterThanOrEqual(2);
    expect(f.level).toBe("STRONG");
    expect(f.reading).toBe("EXPANSION_DEMONSTRATED_PLATFORM_ROADMAP");
  });

  it("NRR 95% and nothing else to sell → SINGLE_PRODUCT_CEILING (WEAK)", () => {
    const f = factor(exp(() => {}, wedgeDeal(10_000, [metric("nrr", 95, { unit: "PERCENT" })])), "LAND_EXPAND_PLATFORM");
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("SINGLE_PRODUCT_CEILING");
    expect(f.implications.join(" ")).toMatch(/new logos/);
  });

  it("no wedge price → INSUFFICIENT_EVIDENCE", () => {
    const f = factor(exp(() => {}, wedgeDeal(null)), "LAND_EXPAND_PLATFORM");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.reading).toBe("WEDGE_PRICE_UNKNOWN");
  });

  it("wedge known but no expansion input → INSUFFICIENT_EVIDENCE (WEDGE_ONLY_KNOWN)", () => {
    const f = factor(exp(() => {}), "LAND_EXPAND_PLATFORM");
    expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
    expect(f.reading).toBe("WEDGE_ONLY_KNOWN");
  });

  it("the stated entry price is used when no ACV/ARPA exists (MODEL_OBSERVED)", () => {
    const f = factor(exp((e) => { e.entryPrice = usd(12_000, "$12k/yr"); e.largestCustomerAnnualValue = usd(60_000); }, wedgeDeal(null)), "LAND_EXPAND_PLATFORM");
    expect(f.wedgeAcvUsd).toBe(12_000);
    expect(f.computed.find((c) => c.key === "wedgeAcvUsd")!.basis).toBe("MODEL_OBSERVED");
  });

  it("the ACV metric wins over the stated entry price and carries its ref", () => {
    const f = factor(exp((e) => { e.entryPrice = usd(5_000); e.largestCustomerAnnualValue = usd(60_000); }), "LAND_EXPAND_PLATFORM");
    expect(f.wedgeAcvUsd).toBe(10_000);
    expect(f.evidence[0]!.refs).toContain("MET-ACV");
  });

  it("NRR is capped for compounding", () => {
    const f = factor(exp(() => {}, wedgeDeal(10_000, [metric("nrr", 400, { unit: "PERCENT" })])), "LAND_EXPAND_PLATFORM");
    expect(f.nrrPathUsd).toBeCloseTo(10_000 * 2 ** 5, -1);
  });

  it("states the growth structure: customers needed for $100M ARR at the wedge vs at the ceiling", () => {
    const f = factor(exp((e) => (e.largestCustomerAnnualValue = usd(500_000))), "LAND_EXPAND_PLATFORM");
    expect(f.computed.find((c) => c.key === "customersAtWedge")!.value).toBe(10_000);
    expect(f.computed.find((c) => c.key === "customersAtCeiling")!.value).toBe(200);
  });

  it("unpriced modules are counted and flagged", () => {
    const f = factor(exp((e) => (e.modules = [mod("Analytics", "LIVE", null), mod("API", "BETA", 5_000)])), "LAND_EXPAND_PLATFORM");
    expect(f.unpricedModules).toBe(1);
    expect(f.liveModulesUsd).toBe(5_000);
    expect(f.implications.join(" ")).toMatch(/without a stated price/);
  });

  it("the default Series A fixture (NRR 118%) shows meaningful expansion (ADEQUATE)", () => {
    const f = factor(makeDeal(), "LAND_EXPAND_PLATFORM");
    expect(f.demonstratedMultiple).toBeGreaterThan(2);
    expect(f.level).toBe("ADEQUATE");
  });

  it("two observed expansion kinds make a low multiple ADEQUATE", () => {
    const f = factor(exp((e) => (e.expansionEvidence = [{ kind: "SEAT_EXPANSION", evidence: "Seats +40% in year 2", page: 8 }, { kind: "CROSS_SELL", evidence: "22% bought module B", page: 8 }])), "LAND_EXPAND_PLATFORM");
    expect(f.level).toBe("ADEQUATE");
  });
});

/* ---------------------------------------------------------------- */
/* 8. Organizational focus                                            */
/* ---------------------------------------------------------------- */

const names = (n: number, p: string) => Array.from({ length: n }, (_, i) => `${p} ${i + 1}`);
const focusDeal = (products: number, markets: number, segments: number, channels: number, fte: number | null, base = makeDeal()) =>
  dealWith((d) => {
    d.focus = {
      products: names(products, "Product").map((name) => ({ name, status: "LIVE" as const, page: 5 })),
      customerSegments: names(segments, "Segment").map((name) => ({ name, page: 6 })),
      markets: names(markets, "Country").map((name) => ({ name, status: "ACTIVE" as const, page: 6 })),
      channels: names(channels, "Channel").map((name) => ({ name, page: 13 })),
    };
  }, fte === null ? base : { ...base, metrics: [...base.metrics, metric("headcount", fte, { unit: "COUNT" })] });

describe("divergence · 8 organizational focus", () => {
  it("12 people, 5 products, 4 markets, 2 segments, 2 channels → FRAGMENTED (WEAK)", () => {
    const f = factor(focusDeal(5, 4, 2, 2, 12), "ORGANIZATIONAL_FOCUS");
    expect(f.priorities).toBe(13);
    expect(f.excessPriorities).toBe(9);
    expect(f.excessPer10Fte).toBe(7.5);
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("FRAGMENTED");
  });

  it("12 people on one wedge (1/1/1/1) → FOCUSED (STRONG)", () => {
    const f = factor(focusDeal(1, 1, 1, 1, 12), "ORGANIZATIONAL_FOCUS");
    expect(f.excessPriorities).toBe(0);
    expect(f.level).toBe("STRONG");
  });

  it("the same priorities are fine for a 40-person company", () => {
    expect(factor(focusDeal(2, 2, 1, 1, 40), "ORGANIZATIONAL_FOCUS").level).toBe("STRONG");
  });

  it("roadmap products and planned markets are not counted", () => {
    const d = dealWith((x) => {
      x.focus = { products: [{ name: "Core", status: "LIVE", page: 1 }, { name: "Next", status: "ROADMAP", page: 1 }], customerSegments: [{ name: "SMB", page: 1 }], markets: [{ name: "France", status: "ACTIVE", page: 1 }, { name: "Germany", status: "PLANNED", page: 1 }], channels: [{ name: "Direct", page: 1 }] };
    }, { ...makeDeal(), metrics: [metric("headcount", 10, { unit: "COUNT" })] });
    const f = factor(d, "ORGANIZATIONAL_FOCUS");
    expect(f.priorities).toBe(4);
    expect(f.axes.find((a) => a.axis === "PRODUCTS")!.excluded).toEqual(["Next (roadmap)"]);
  });

  it("names are deduplicated (case and punctuation)", () => {
    const d = dealWith((x) => {
      x.focus = { products: [{ name: "AP Automation", status: "LIVE", page: 1 }, { name: "ap automation.", status: "LIVE", page: 2 }], customerSegments: [], markets: [], channels: [] };
    });
    expect(factor(d, "ORGANIZATIONAL_FOCUS").priorities).toBe(1);
  });

  it("headcount falls back to the deck's headcount by function", () => {
    const d = focusDeal(5, 4, 2, 2, null);
    d.divergence!.scalability.headcountByFunction = [{ function: "ENGINEERING_PRODUCT", count: 8, page: 18 }, { function: "SALES_MARKETING", count: 4, page: 18 }];
    const f = factor(d, "ORGANIZATIONAL_FOCUS");
    expect(f.fte).toBe(12);
    expect(f.fteSource).toMatch(/by function/);
  });

  it("without headcount: ≥ 6 excess → WEAK, ≤ 1 → ADEQUATE, in between → INSUFFICIENT_EVIDENCE", () => {
    expect(factor(focusDeal(3, 3, 2, 2, null), "ORGANIZATIONAL_FOCUS").level).toBe("WEAK");
    expect(factor(focusDeal(1, 2, 1, 1, null), "ORGANIZATIONAL_FOCUS").level).toBe("ADEQUATE");
    expect(factor(focusDeal(2, 2, 2, 1, null), "ORGANIZATIONAL_FOCUS").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("a short runway with ≥ 3 excess priorities downgrades one level", () => {
    const tight = makeDeal();
    tight.financing = { ...tight.financing!, raiseAmount: null, cashBalance: usd(1e6) };
    tight.financingPath = null;
    const stretched = factor(focusDeal(2, 2, 2, 1, 12), "ORGANIZATIONAL_FOCUS");
    const squeezed = factor(focusDeal(2, 2, 2, 1, 12, tight), "ORGANIZATIONAL_FOCUS");
    expect(stretched.level).toBe("ADEQUATE");
    expect(squeezed.runwayMonths).toBeLessThan(12);
    expect(squeezed.level).toBe("WEAK");
  });

  it("no draft → INSUFFICIENT_EVIDENCE", () => {
    expect(factor(makeDeal(), "ORGANIZATIONAL_FOCUS").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("computes capital per priority from cash + round", () => {
    const f = factor(focusDeal(1, 1, 1, 1, 12), "ORGANIZATIONAL_FOCUS");
    expect(f.capitalPerPriorityUsd).toBe(15_000_000 / 4);
  });
});

/* ---------------------------------------------------------------- */
/* 9. Compounding loops                                               */
/* ---------------------------------------------------------------- */

type Link = DivergenceDraft["loops"][number]["links"][number];
const link = (from: string, to: string, status: Link["status"], evidence = `${from} to ${to}: +12% measured`): Link => ({ from, to, status, evidence, page: 10 });
const loopDeal = (loops: DivergenceDraft["loops"]) => dealWith((d) => (d.loops = loops));

describe("divergence · 9 compounding loops", () => {
  it("a data loop with every link measured → DEMONSTRATED (STRONG)", () => {
    const f = factor(loopDeal([{ kind: "DATA", description: "data flywheel", links: [link("customers", "data", "DEMONSTRATED"), link("data", "accuracy", "DEMONSTRATED"), link("accuracy", "win rate", "DEMONSTRATED")] }]), "COMPOUNDING_LOOPS");
    expect(f.level).toBe("STRONG");
    expect(f.strongest!.status).toBe("DEMONSTRATED");
  });

  it("a data loop with a broken link → the loop is only as strong as its weakest link (WEAK)", () => {
    const f = factor(loopDeal([{ kind: "DATA", description: "data flywheel", links: [link("customers", "data", "DEMONSTRATED"), link("data", "accuracy", "DEMONSTRATED"), link("accuracy", "more customers", "ABSENT", "Win/loss shows price, not accuracy, decides")] }]), "COMPOUNDING_LOOPS");
    expect(f.level).toBe("WEAK");
    expect(f.strongest!.weakestLink!.to).toBe("more customers");
    expect(f.why).toMatch(/weakest link/);
    expect(f.implications.join(" ")).toMatch(/next proof is the weakest link/);
  });

  it("DEMONSTRATED without a measured number is downgraded to PLAUSIBLE by code", () => {
    const f = factor(loopDeal([{ kind: "DATA", description: "", links: [link("customers", "data", "DEMONSTRATED", "Every customer adds data"), link("data", "accuracy", "DEMONSTRATED")] }]), "COMPOUNDING_LOOPS");
    expect(f.level).toBe("ADEQUATE");
    expect(f.loops[0]!.links[0]!.adjustment).toMatch(/plausible/);
  });

  it("a link without a stated fact is ASSERTED", () => {
    expect(normalizeLink({ from: "a", to: "b", status: "PLAUSIBLE", evidence: "", page: null }).status).toBe("ASSERTED");
    expect(normalizeLink({ from: "a", to: "b", status: "ABSENT", evidence: "", page: null }).status).toBe("ABSENT");
  });

  it("a single link is not a loop (at most ASSERTED)", () => {
    const l = normalizeLink({ from: "a", to: "b", status: "DEMONSTRATED", evidence: "measured 40%", page: 1 });
    expect(loopStatus([l]).status).toBe("ASSERTED");
    expect(loopStatus([]).status).toBe("ABSENT");
  });

  it("the strongest of several loops decides the level", () => {
    const f = factor(
      loopDeal([
        { kind: "COMMUNITY_CONTENT", description: "", links: [link("users", "content", "ASSERTED", "claimed"), link("content", "users", "ASSERTED", "claimed")] },
        { kind: "INTEGRATION_ECOSYSTEM", description: "", links: [link("integrations", "customers", "PLAUSIBLE", "9 integrations live"), link("customers", "integrations", "PLAUSIBLE", "partners request listing")] },
      ]),
      "COMPOUNDING_LOOPS",
    );
    expect(f.strongest!.kind).toBe("INTEGRATION_ECOSYSTEM");
    expect(f.level).toBe("ADEQUATE");
  });

  it("a read deck with no loop → WEAK (NO_LOOP)", () => {
    const f = factor(loopDeal([]), "COMPOUNDING_LOOPS");
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("NO_LOOP");
  });

  it("no draft → INSUFFICIENT_EVIDENCE", () => {
    expect(factor(makeDeal(), "COMPOUNDING_LOOPS").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("organic acquisition share is context evidence and never changes link statuses", () => {
    const loops: DivergenceDraft["loops"] = [{ kind: "REFERRAL_VIRAL", description: "", links: [link("users", "invites", "PLAUSIBLE", "invite flow live"), link("invites", "users", "PLAUSIBLE", "k-factor not shown")] }];
    const a = factor(loopDeal(loops), "COMPOUNDING_LOOPS");
    const withOrganic = dealWith((d) => (d.loops = loops), { ...makeDeal(), metrics: [metric("organic_acquisition_share", 70, { unit: "PERCENT" })] });
    const b = factor(withOrganic, "COMPOUNDING_LOOPS");
    expect(b.level).toBe(a.level);
    expect(b.evidence.some((e) => /Organic acquisition share/.test(e.text))).toBe(true);
  });
});

/* ---------------------------------------------------------------- */
/* 10. Scalability architecture                                       */
/* ---------------------------------------------------------------- */

describe("divergence · 10 scalability architecture", () => {
  it("services-heavy scaling (45% services, 16-week implementations, 3 CS FTE per 10 customers) → WEAK", () => {
    const base = makeDeal({ metrics: [metric("services_revenue_share", 45, { unit: "PERCENT" }), metric("paying_customers", 20, { unit: "COUNT" })] });
    const f = factor(
      dealWith((d) => {
        d.scalability = { signals: [{ kind: "LOCAL_TEAM_PER_COUNTRY", direction: "FRAGILE", evidence: "Local implementation team per country", page: 14 }], implementationWeeks: 16, headcountByFunction: [{ function: "SERVICES_IMPLEMENTATION", count: 6, page: 18 }] };
      }, base),
      "SCALABILITY_ARCHITECTURE",
    );
    expect(f.servicesSharePct).toBe(45);
    expect(f.supportFtePer10Customers).toBe(3);
    expect(f.points).toBe(2 + 2 + 2 + 1);
    expect(f.level).toBe("WEAK");
    expect(f.reading).toBe("GROWTH_FRAGILIZES");
  });

  it("a standardised, self-serve product → STRONG", () => {
    const base = makeDeal({ metrics: [metric("services_revenue_share", 4, { unit: "PERCENT" })] });
    const f = factor(dealWith((d) => (d.scalability = { signals: [{ kind: "SELF_SERVE_ONBOARDING", direction: "SCALES", evidence: "Onboarding in 1 day, no services", page: 9 }], implementationWeeks: 1, headcountByFunction: [] }), base), "SCALABILITY_ARCHITECTURE");
    expect(f.level).toBe("STRONG");
  });

  it("gross margin falling with scale adds 2 points; rising takes one away", () => {
    const falling = makeDeal({ metrics: [] });
    falling.metricObservations = [obs("gross_margin", 70, { unit: "PERCENT", periodEnd: "2024-12", basis: "ACTUAL" }), obs("gross_margin", 61, { unit: "PERCENT", periodEnd: "2025-12", basis: "ACTUAL" })];
    const t = grossMarginTrend(falling)!;
    expect(t.deltaPts).toBe(-9);
    expect(t.points).toBe(2);
    const rising = makeDeal({ metrics: [] });
    rising.metricObservations = [obs("gross_margin", 60, { unit: "PERCENT", periodEnd: "2024-12", basis: "ACTUAL" }), obs("gross_margin", 72, { unit: "PERCENT", periodEnd: "2025-12", basis: "ACTUAL" })];
    expect(grossMarginTrend(rising)!.points).toBe(-1);
    expect(factor(rising, "SCALABILITY_ARCHITECTURE").level).toBe("STRONG");
  });

  it("the trend needs two distinct historical periods; forecasts are ignored", () => {
    const d = makeDeal({ metrics: [] });
    d.metricObservations = [obs("gross_margin", 70, { unit: "PERCENT", periodEnd: "2025-12", basis: "ACTUAL" }), obs("gross_margin", 80, { unit: "PERCENT", periodEnd: "2027-12", basis: "FORECAST" })];
    expect(grossMarginTrend(d)).toBeNull();
  });

  it("fragile signals count at most 3 and scaling signals at most −2", () => {
    const sig = (direction: "FRAGILE" | "SCALES", n: number) => Array.from({ length: n }, (_, i) => ({ kind: "HUMAN_IN_THE_LOOP" as const, direction, evidence: `Signal ${i}`, page: 3 }));
    const f = factor(dealWith((d) => (d.scalability = { signals: sig("FRAGILE", 6), implementationWeeks: null, headcountByFunction: [] }), makeDeal({ metrics: [] })), "SCALABILITY_ARCHITECTURE");
    expect(f.points).toBe(3);
    const g = factor(dealWith((d) => (d.scalability = { signals: sig("SCALES", 5), implementationWeeks: null, headcountByFunction: [] }), makeDeal({ metrics: [] })), "SCALABILITY_ARCHITECTURE");
    expect(g.points).toBe(-2);
  });

  it("time to value (days) is used when the implementation time is not stated", () => {
    const f = factor(makeDeal({ metrics: [metric("time_to_value_days", 98, { unit: "DAYS" })] }), "SCALABILITY_ARCHITECTURE");
    expect(f.implementationWeeks).toBe(14);
    expect(f.points).toBe(2);
  });

  it("nothing about delivery → INSUFFICIENT_EVIDENCE", () => {
    expect(factor(makeDeal({ metrics: [] }), "SCALABILITY_ARCHITECTURE").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("the current gross-margin LEVEL is not an input (only its slope)", () => {
    const at = (gm: number) => factor(dealWith((d) => (d.scalability.implementationWeeks = 8), makeDeal({ metrics: [metric("gross_margin", gm, { unit: "PERCENT" })] })), "SCALABILITY_ARCHITECTURE");
    expect(at(30).level).toBe(at(85).level);
    expect(at(30).points).toBe(at(85).points);
  });
});
