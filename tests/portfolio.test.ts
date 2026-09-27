/**
 * Portfolio intelligence on six synthetic deals: redundancy, exposure,
 * correlated risks, asymmetric upside and the next-$1M allocation rule.
 */
import { describe, expect, it } from "vitest";
import type { CanonicalDeal, Risk } from "@/domain/canonical";
import type { DecisionStatus, EvidenceQuality, ExecutionStatus, RiskCategory } from "@/domain/enums";
import type { FundProfile } from "@/domain/fund";
import { financingMap } from "@/engine/financing";
import { priceSensitivity } from "@/engine/returns";
import { economicsReport } from "@/engine/economics";
import {
  capitalFor,
  EVIDENCE_FACTORS,
  jaccard,
  portfolioBrief,
  portfolioIntelligence,
  redundancyScore,
  riskDrivers,
  type PortfolioDeal,
} from "@/engine/portfolio";
import { ctxFor, fund, money, seriesA } from "./economics.helpers";

let rn = 0;
function risk(category: RiskCategory, title: string, description = title): Risk {
  rn++;
  return {
    id: `RSK-${rn}`,
    category,
    title,
    description,
    severity: "HIGH",
    likelihood: "MODERATE",
    timing: "NEXT_12_MONTHS",
    mitigation: "",
    evidence: "",
    claimRefs: [],
    weaknessClass: "REPAIRABLE",
    repair: null,
  };
}
const competitor = (name: string, type: "DIRECT" | "INCUMBENT" | "DO_NOTHING" = "DIRECT") => ({ name, type, description: "", scale: null, url: null, sourceRefs: [] });
const competition = (...c: ReturnType<typeof competitor>[]) => ({ competitors: c, comparison: [], adversarialTests: [] });
const customers = (...segments: string[]) => ({ icp: "", segments, namedCustomers: [], concentrationNote: null, referencesNote: "" });

interface Spec {
  id: string;
  name: string;
  deal: CanonicalDeal;
  status: DecisionStatus;
  mandate?: "PASS" | "FAIL" | "INCOMPLETE";
  evidence: EvidenceQuality;
  powerLaw: number | null;
  exec?: ExecutionStatus;
}

function build(spec: Spec, f: FundProfile = fund): PortfolioDeal {
  const d = { ...spec.deal, executionStatus: spec.exec ?? "NOT_STARTED" } as CanonicalDeal;
  const ctx = ctxFor(d, { fund: f });
  return {
    companyId: spec.id,
    name: spec.name,
    canonical: d,
    derived: {
      returns: ctx.returns,
      priceSensitivity: priceSensitivity(ctx.returns.inputs, ctx.registry),
      powerLaw: { value: spec.powerLaw },
      evidence: { category: spec.evidence, index: 50 },
      recommendation: { status: spec.status },
      fundFit: { mandate: spec.mandate ?? "PASS" },
      financing: financingMap(d, ctx.registry),
      economics: economicsReport(ctx),
    },
  };
}

// 1. InvoiceAI — AP automation, signed.
const invoiceAi = seriesA();
invoiceAi.identity = { ...invoiceAi.identity, name: "InvoiceAI" };
invoiceAi.competition = competition(competitor("Bill.com"), competitor("SAP", "INCUMBENT"), competitor("Spreadsheets", "DO_NOTHING"));
invoiceAi.customers = customers("Mid-market finance teams");
invoiceAi.risks = [risk("COMPETITION", "OpenAI could ship invoice parsing", "A model provider adds native invoice extraction")];
invoiceAi.financingPath = { ...invoiceAi.financingPath!, plannedMonthlyBurnUsd: 400_000 };

// 2. PayablesBot — near-duplicate of InvoiceAI, in diligence.
const payables = seriesA();
payables.identity = { ...payables.identity, name: "PayablesBot" };
payables.competition = competition(competitor("Bill.com"), competitor("SAP", "INCUMBENT"));
payables.customers = customers("mid-market finance teams");
payables.risks = [risk("COMPETITION", "Dependence on GPT-4 pricing", "Inference costs set by OpenAI")];
payables.financingPath = { ...payables.financingPath!, plannedMonthlyBurnUsd: 400_000 };
payables.financing = { ...payables.financing!, preMoney: money(30_000_000) }; // $42M post — cheaper

// 3. MedScribe — clinical documentation, funded.
const medscribe = seriesA();
medscribe.identity = { ...medscribe.identity, name: "MedScribe", hqCountry: "France" };
medscribe.classification = { ...medscribe.classification, industry: ["HEALTHCARE"], gtm: ["ENTERPRISE_SALES"] };
medscribe.competition = competition(competitor("Nuance", "INCUMBENT"), competitor("Abridge"));
medscribe.customers = customers("Hospital systems");
medscribe.risks = [risk("REGULATORY", "HIPAA exposure on patient audio"), risk("TECHNICAL", "Transcription runs on OpenAI inference")];
medscribe.financingPath = { ...medscribe.financingPath!, plannedMonthlyBurnUsd: 400_000 };

// 4. ClinicOps — healthcare ops, admissible but CRITICAL financing risk.
const clinic = seriesA();
clinic.identity = { ...clinic.identity, name: "ClinicOps" };
clinic.classification = { ...clinic.classification, industry: ["HEALTHCARE"], productType: ["SAAS"], technology: ["NONE_TRADITIONAL"] };
clinic.competition = competition(competitor("Epic", "INCUMBENT"));
clinic.customers = customers("Independent clinics");
clinic.risks = [risk("REGULATORY", "HIPAA business associate obligations")];
clinic.financingPath = { ...clinic.financingPath!, plannedMonthlyBurnUsd: 1_200_000 };

// 5. RoboFarm — screened out.
const robo = seriesA();
robo.identity = { ...robo.identity, name: "RoboFarm" };
robo.classification = { ...robo.classification, industry: ["AGRICULTURE_FOOD"], productType: ["ROBOTICS", "HARDWARE"], gtm: ["ENTERPRISE_SALES"] };
robo.competition = competition(competitor("John Deere", "INCUMBENT"));
robo.customers = customers("Large farms");
robo.risks = [];

// 6. ShopLens — mandate failure.
const shop = seriesA();
shop.identity = { ...shop.identity, name: "ShopLens", hqCountry: "Brazil" };
shop.classification = { ...shop.classification, industry: ["RETAIL_COMMERCE"], productType: ["CONSUMER_APP"], gtm: ["PLG"] };
shop.competition = competition(competitor("Shopify", "INCUMBENT"));
shop.customers = customers("Shopify merchants");
shop.risks = [risk("MARKET", "Shopify platform dependency")];

const SPECS: Spec[] = [
  { id: "c1", name: "InvoiceAI", deal: invoiceAi, status: "DEEP_DD", evidence: "HIGH", powerLaw: 80, exec: "SIGNED" },
  { id: "c2", name: "PayablesBot", deal: payables, status: "DEEP_DD", evidence: "MODERATE", powerLaw: 70 },
  { id: "c3", name: "MedScribe", deal: medscribe, status: "IC_READY", evidence: "VERY_HIGH", powerLaw: 75, exec: "FUNDED" },
  { id: "c4", name: "ClinicOps", deal: clinic, status: "NEEDS_TARGETED_DILIGENCE", evidence: "LOW", powerLaw: 50 },
  { id: "c5", name: "RoboFarm", deal: robo, status: "SCREEN_OUT", evidence: "LOW", powerLaw: 30 },
  { id: "c6", name: "ShopLens", deal: shop, status: "DEEP_DD", mandate: "FAIL", evidence: "HIGH", powerLaw: 65 },
];
const deals = SPECS.map((s) => build(s));
const report = portfolioIntelligence(deals, fund);

describe("redundancy", () => {
  it("flags the two AP-automation deals as REDUNDANT with the shared items as reason", () => {
    const p = report.redundancy.find((r) => r.a.companyId === "c1" && r.b.companyId === "c2")!;
    expect(p.level).toBe("REDUNDANT");
    expect(p.shared.competitors).toEqual(["bill com", "sap"]);
    expect(p.shared.segments).toEqual(["mid market finance teams"]);
    expect(p.reason).toContain("InvoiceAI and PayablesBot");
  });

  it("the redundant pair ranks first and unrelated deals do not appear", () => {
    expect(report.redundancy[0]!.a.companyId).toBe("c1");
    expect(report.redundancy.some((r) => [r.a.companyId, r.b.companyId].includes("c5"))).toBe(false);
  });

  it("the score is the weighted Jaccard over classification, competitors and segments", () => {
    const r = redundancyScore(invoiceAi, payables);
    const expected = (0.4 * r.components.classification + 0.35 * r.components.competitors! + 0.25 * r.components.segments!) / 1;
    expect(r.score).toBeCloseTo(expected, 12);
    expect(r.components.classification).toBe(1);
  });

  it("'do nothing' alternatives are not counted as competitors", () => {
    expect(redundancyScore(invoiceAi, payables).components.competitors).toBe(1);
  });

  it.each([
    [["a", "b"], ["a", "b"], 1],
    [["a", "b"], ["b", "c"], 1 / 3],
    [["a"], ["b"], 0],
    [[], [], 0],
  ])("jaccard(%j, %j) = %d", (a, b, j) => {
    expect(jaccard(new Set(a), new Set(b))).toBeCloseTo(j, 12);
  });
});

describe("exposure", () => {
  it("committed = SIGNED/FUNDED deals weighted by default check + reserves", () => {
    const c = report.exposure.committed;
    expect(c.deals).toBe(2);
    expect(c.capitalUsd).toBe(capitalFor(deals[0]!) + capitalFor(deals[2]!));
    expect(capitalFor(deals[0]!)).toBe(4_000_000);
    expect(c.pctOfFund).toBeCloseTo((8_000_000 / 150_000_000) * 100, 9);
  });

  it("committed sector buckets split 50/50 and both exceed the 40% policy limit", () => {
    const s = report.exposure.committed.sector;
    expect(s.map((b) => [b.key, b.pctOfViewCapital])).toEqual([
      ["ENTERPRISE_SOFTWARE", 50],
      ["HEALTHCARE", 50],
    ]);
    expect(s.every((b) => b.overLimit)).toBe(true);
  });

  it("the pipeline view adds admissible deals only (not screened out, not mandate failures)", () => {
    const p = report.exposure.pipeline;
    expect(p.deals).toBe(4);
    expect(p.sector.find((b) => b.key === "HEALTHCARE")!.count).toBe(2);
    expect(p.sector.some((b) => b.key === "AGRICULTURE_FOOD" || b.key === "RETAIL_COMMERCE")).toBe(false);
  });

  it("stage and geography buckets are reported", () => {
    expect(report.exposure.pipeline.stage).toEqual([expect.objectContaining({ key: "SERIES_A", count: 4 })]);
    expect(report.exposure.committed.geography.map((g) => g.key).sort()).toEqual(["France", "United States"]);
  });

  it("per-company concentration is checked against the fund limit", () => {
    expect(report.exposure.companyConcentration.every((c) => c.ok)).toBe(true);
    const small = { ...fund, fundSizeUsd: 30_000_000 };
    const r = portfolioIntelligence(SPECS.map((s) => build(s, small)), small);
    expect(r.exposure.companyConcentration.filter((c) => !c.ok).length).toBeGreaterThan(0);
  });
});

describe("correlated risks", () => {
  it("detects platform, incumbent, segment and regulatory drivers", () => {
    const keys = riskDrivers(medscribe).map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(["incumbent:nuance", "platform:openai", "platform:foundation model inference provider", "regulatory:hipaa", "segment:hospital systems"]));
  });

  it("clusters the three OpenAI-dependent deals", () => {
    const c = report.correlatedRisks.find((x) => x.driver.key === "platform:openai")!;
    expect(c.companies.map((x) => x.companyId)).toEqual(["c1", "c2", "c3"]);
  });

  it("clusters the HIPAA-exposed deals with their shared risk category", () => {
    const c = report.correlatedRisks.find((x) => x.driver.key === "regulatory:hipaa")!;
    expect(c.companies.map((x) => x.name)).toEqual(["MedScribe", "ClinicOps"]);
    expect(c.sharedRiskCategories).toEqual(["REGULATORY"]);
  });

  it("clusters the AP deals on their shared incumbent and segment, and ignores singletons", () => {
    expect(report.correlatedRisks.find((x) => x.driver.key === "incumbent:sap")!.companies).toHaveLength(2);
    expect(report.correlatedRisks.find((x) => x.driver.key === "segment:mid market finance teams")!.companies).toHaveLength(2);
    expect(report.correlatedRisks.every((x) => x.companies.length >= 2)).toBe(true);
    expect(report.correlatedRisks.some((x) => x.driver.key === "incumbent:john deere")).toBe(false);
  });

  it("clusters are sorted by size first", () => {
    const sizes = report.correlatedRisks.map((c) => c.companies.length);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeLessThanOrEqual(sizes[i - 1]!);
  });
});

describe("asymmetric upside", () => {
  const byId = (id: string) => report.asymmetricUpside.find((a) => a.companyId === id)!;

  it("qualifies a deal with ≥20× outlier, a price under the 20× ceiling and a high evidence-adjusted Power-Law index", () => {
    const a = byId("c1");
    expect(a.qualifies).toBe(true);
    expect(a.outlierMoicSource).toBe("CAP_TABLE");
    expect(a.adjustedPowerLaw).toBeCloseTo(80 * 0.85, 12);
    expect(a.entryPostMoneyUsd!).toBeLessThanOrEqual(a.maxPostFor20xUsd!);
  });

  it("the evidence haircut can disqualify an otherwise asymmetric deal", () => {
    const a = byId("c2");
    expect(a.checks.outlierMoic && a.checks.price).toBe(true);
    expect(a.adjustedPowerLaw).toBeCloseTo(70 * 0.65, 12);
    expect(a.qualifies).toBe(false);
  });

  it("an entry price above the 20× ceiling disqualifies", () => {
    const d = seriesA();
    d.exitAssumptions = [{ scenario: "OUTLIER", exitRevenueUsd: 50_000_000, revenueMultiple: 10, yearsToExit: 9, rationale: "t" }];
    const a = portfolioIntelligence([build({ id: "x", name: "X", deal: d, status: "DEEP_DD", evidence: "VERY_HIGH", powerLaw: 90 })], fund).asymmetricUpside[0]!;
    expect(a.checks.price).toBe(false);
    expect(a.qualifies).toBe(false);
  });

  it("qualifying deals come first", () => {
    const q = report.asymmetricUpside.map((a) => a.qualifies);
    expect(q.indexOf(false)).toBeGreaterThan(q.lastIndexOf(true));
  });
});

describe("where to allocate the next $1M", () => {
  const alloc = report.allocation;

  it("excludes screened-out, mandate-failing and CRITICAL-financing deals, with reasons", () => {
    expect(alloc.excluded.map((e) => [e.companyId, e.reason])).toEqual([
      ["c4", "Financing risk CRITICAL (cash runs out before the next raise)"],
      ["c5", "Recommendation SCREEN_OUT"],
      ["c6", "Fails a fund mandate gate"],
    ]);
  });

  it("ranks by bull proceeds per $ at the current price × $1M × evidence factor", () => {
    for (const r of alloc.ranking) {
      const d = deals.find((x) => x.companyId === r.companyId)!;
      const bull = d.derived.priceSensitivity.find((x) => x.scenario === "BULL")!.currentImpliedMoic!;
      expect(r.source).toBe("PRICE_SENSITIVITY");
      expect(r.capacityPerUnitUsd).toBeCloseTo(bull * 1_000_000 * EVIDENCE_FACTORS[r.evidenceCategory], 6);
    }
    const caps = alloc.ranking.map((r) => r.capacityPerUnitUsd);
    for (let i = 1; i < caps.length; i++) expect(caps[i]!).toBeLessThanOrEqual(caps[i - 1]!);
    expect(alloc.ranking.map((r) => r.rank)).toEqual(alloc.ranking.map((_, i) => i + 1));
  });

  it("with registry exits anchored to each deal's own price, evidence decides between the duplicates", () => {
    const [c1, c2] = ["c1", "c2"].map((id) => alloc.ranking.find((r) => r.companyId === id)!);
    expect(c1!.bullProceedsPerDollar).toBeCloseTo(c2!.bullProceedsPerDollar, 9);
    expect(alloc.ranking.map((r) => r.companyId)).toEqual(["c3", "c1", "c2"]);
  });

  it("company-specific exits make the cheaper duplicate worth more per $", () => {
    const exits = (d: CanonicalDeal) => ({ ...d, exitAssumptions: [{ scenario: "BULL" as const, exitRevenueUsd: 100_000_000, revenueMultiple: 10, yearsToExit: 8, rationale: "t" }] });
    const r = portfolioIntelligence(
      [
        build({ id: "p", name: "Pricey", deal: exits(invoiceAi), status: "DEEP_DD", evidence: "HIGH", powerLaw: 50 }),
        build({ id: "q", name: "Cheap", deal: exits(payables), status: "DEEP_DD", evidence: "HIGH", powerLaw: 50 }),
      ],
      fund,
    );
    expect(r.allocation.ranking.map((x) => x.companyId)).toEqual(["q", "p"]);
  });

  it("CRITICAL financing deals can be included explicitly", () => {
    const r = portfolioIntelligence(deals, fund, { allowCriticalFinancing: true });
    expect(r.allocation.ranking.some((x) => x.companyId === "c4")).toBe(true);
  });

  it("ties are broken by Power-Law index", () => {
    const twin = (id: string, pl: number) => build({ id, name: id, deal: seriesA(), status: "DEEP_DD", evidence: "HIGH", powerLaw: pl });
    const r = portfolioIntelligence([twin("a", 40), twin("b", 90)], fund);
    expect(r.allocation.ranking.map((x) => x.companyId)).toEqual(["b", "a"]);
  });

  it("shows the formula and the factor table", () => {
    expect(alloc.formula).toMatch(/BULL-case proceeds per \$ at the current price/);
    expect(alloc.formula).toMatch(/not a probability/);
    expect(alloc.evidenceFactors).toEqual(EVIDENCE_FACTORS);
  });
});

describe("brief, determinism, robustness", () => {
  it("portfolioBrief is deterministic text covering every section", () => {
    const a = portfolioBrief(report, fund);
    expect(a).toBe(portfolioBrief(portfolioIntelligence(SPECS.map((s) => build(s)), fund), fund));
    expect(a).toContain("6 deals analyzed");
    expect(a).toContain("Redundant pairs: InvoiceAI–PayablesBot");
    expect(a).toContain("Asymmetric upside: MedScribe");
    expect(a).toContain("InvoiceAI (OUTLIER");
    expect(a).toContain("Next $1.0M: 1. MedScribe");
    expect(a).toMatch(/Excluded from allocation: ClinicOps/);
  });

  it("input order does not change the report", () => {
    expect(JSON.stringify(portfolioIntelligence([...deals].reverse(), fund))).toBe(JSON.stringify(report));
  });

  it("an empty portfolio is handled", () => {
    const r = portfolioIntelligence([], fund);
    expect(r.deals).toBe(0);
    expect(portfolioBrief(r, fund)).toContain("0 deals analyzed");
  });

  it("a deal without valuation is excluded from allocation, not a crash", () => {
    const d = seriesA();
    d.financing = { ...d.financing!, preMoney: null, postMoney: null };
    const r = portfolioIntelligence([build({ id: "z", name: "Z", deal: d, status: "DEEP_DD", evidence: "HIGH", powerLaw: 60 })], fund);
    expect(r.allocation.excluded[0]!.reason).toMatch(/not modelable/);
    expect(r.asymmetricUpside[0]!.qualifies).toBe(false);
  });
});
