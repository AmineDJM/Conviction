/**
 * Divergence engine guard rules learned from a real STANDARD run: absences are
 * never signals, unnamed providers are gaps, multi-homed providers are not a
 * single point, rigidities are cross-checked by code, and model signals alone
 * cannot make scalability STRONG. Includes a regression fixture shaped like
 * the real model output on the Ledgerline Series A deck.
 */
import { describe, expect, it } from "vitest";
import type { DivergenceDraft } from "@/domain/sections";
import { isFact, statesAbsence } from "@/engine/divergence/util";
import { dangerOf } from "@/engine/divergence/dependency";
import { normalizeLink } from "@/engine/divergence/loops";
import { factorOf } from "@/engine/divergence";
import { makeDeal, metric } from "./fixtures";
import { dealWith, derived, factor } from "./divergence.helpers";

describe("divergence rules · an absence is never a signal", () => {
  it.each([
    "No hiring plan or specific future roles are stated.",
    "The deck does not state implementation time.",
    "No services revenue is reported.",
    "No supplier concentration data is provided.",
    "Switching costs are not shown",
    "k-factor not shown",
  ])("states an absence: %s", (t) => {
    expect(statesAbsence(t)).toBe(true);
    expect(isFact(t)).toBe(false);
  });

  it.each(["Price raised 20% in 2025 with no churn", "Median onboarding 3 days, no services", "38M labelled invoices", "0 churned logos in 18 months", "Win/loss shows price, not accuracy, decides"])("is a fact: %s", (t) => {
    expect(isFact(t)).toBe(true);
  });

  it("ambition signals that only state an absence do not move the scope index", () => {
    const d = dealWith((x) => (x.ambition = { productScope: "PRODUCT_SUITE", geography: "MULTI_REGION", marketFraming: "UNCLEAR", statedEndState: null, signals: [1, 2].map((i) => ({ kind: "HIRING_PLAN" as const, direction: "CONTAINED" as const, evidence: `No hiring plan is stated (${i})`, page: i })) }));
    expect(factor(d, "AMBITION_CEILING").scopeIndex).toBe(1.5);
  });

  it("market readings justified by an absence are ignored", () => {
    const base = makeDeal();
    base.market = { ...base.market!, bottomUp: null };
    const d = dealWith((x) => (x.marketStructure.dimensions = (["BUYER_CONCENTRATION", "PRICING_POWER", "SWITCHING_COSTS"] as const).map((dimension) => ({ dimension, reading: "FAVORABLE" as const, evidence: "No concentration among buyers is stated", page: 7 }))), base);
    expect(factor(d, "MARKET_STRUCTURE").assessed).toBe(0);
    expect(factor(d, "MARKET_STRUCTURE").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("syndicate behaviour whose evidence states an absence is not counted", () => {
    const d = dealWith((x) => (x.syndicate = [{ name: "Fund A", kind: "VC_FUND", roundRole: "EXISTING_PARTICIPATION_UNSTATED", behaviours: ["FOLLOWS_ON_THIS_ROUND"], evidence: "Participation in this round is not stated", page: 19 }]));
    expect(factor(d, "SYNDICATE_QUALITY").level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("a mitigation that says there is none does not reduce danger", () => {
    expect(dangerOf({ criticality: "CORE", substitutability: "HARD", switchingTimeMonths: null, mitigation: "No mitigation is stated" })).toBe(9);
  });

  it("a loop link whose evidence says it is not shown is ASSERTED", () => {
    const l = normalizeLink({ from: "users", to: "invites", status: "PLAUSIBLE", evidence: "Invite conversion not shown", page: 3 });
    expect(l.status).toBe("ASSERTED");
    expect(l.adjustment).toMatch(/absence/);
  });
});

type Dep = DivergenceDraft["dependencies"][number];
const dep = (kind: Dep["kind"], provider: string, criticality: Dep["criticality"] = "CORE", substitutability: Dep["substitutability"] = "MODERATE", extra: Partial<Dep> = {}): Dep => ({ kind, provider, whatItProvides: "x", criticality, substitutability, switchingTimeMonths: null, mitigationStated: null, evidence: `${provider} named on p. 3`, page: 3, ...extra });

describe("divergence rules · unnamed and multi-homed dependencies", () => {
  it("an unnamed provider is a coverage gap, not a counted dependency", () => {
    const f = factor(dealWith((x) => (x.dependencies = [dep("CLOUD_INFRASTRUCTURE", "Unspecified hosting provider", "CORE", "UNKNOWN")])), "DEPENDENCY_SURFACE");
    expect(f.surfaceCount).toBe(0);
    expect(f.mostDangerous).toBeNull();
    expect(f.dependencies[0]!.undisclosed).toBe(true);
    expect(f.coverage.missing).toContain("named cloud infrastructure provider");
  });

  it("an unnamed model provider does not count as disclosed for an AI product", () => {
    const f = factor(dealWith((x) => (x.dependencies = [dep("MODEL_PROVIDER", "Unspecified inference provider or model stack", "CORE", "UNKNOWN")])), "DEPENDENCY_SURFACE");
    expect(f.reading).toBe("CONTAINED_MODEL_UNDISCLOSED");
    expect(f.coverage.missing).toContain("model provider (AI product)");
  });

  it("three ERP integrations are multi-homed: the kind counts once on the surface", () => {
    const f = factor(dealWith((x) => (x.dependencies = ["NetSuite", "Microsoft Dynamics", "Sage Intacct"].map((p) => dep("PLATFORM_API", p)))), "DEPENDENCY_SURFACE");
    expect(f.dependencies.every((d) => d.multiHomed)).toBe(true);
    expect(f.surfaceCount).toBe(1);
    expect(f.reading).not.toBe("WIDE_SURFACE");
  });

  it("two named model providers (core, hard) are not a single point of failure", () => {
    const f = factor(dealWith((x) => (x.dependencies = [dep("MODEL_PROVIDER", "OpenAI", "CORE", "HARD"), dep("MODEL_PROVIDER", "Anthropic", "CORE", "HARD")])), "DEPENDENCY_SURFACE");
    expect(f.reading).not.toBe("CRITICAL_SINGLE_POINT");
    expect(f.mostDangerous!.danger).toBeLessThan(9);
  });

  it("the same provider listed twice is not multi-homing", () => {
    const f = factor(dealWith((x) => (x.dependencies = [dep("MODEL_PROVIDER", "OpenAI", "CORE", "HARD"), dep("MODEL_PROVIDER", "openai", "CORE", "HARD")])), "DEPENDENCY_SURFACE");
    expect(f.reading).toBe("CRITICAL_SINGLE_POINT");
  });
});

describe("divergence rules · rigidities are cross-checked by code", () => {
  const withRigidities = (rig: DivergenceDraft["survivability"]["rigidities"], extraMetrics: ReturnType<typeof metric>[] = []) => {
    const base = makeDeal();
    base.metrics = [...base.metrics, ...extraMetrics];
    base.financing = { ...base.financing!, raiseAmount: { amount: 40e6, currency: "USD", rawText: "$40M" } };
    return dealWith((x) => {
      x.survivability.options = [
        { option: "CHANGE_GTM", status: "PLAUSIBLE", evidence: "Partner channel is 34% of new ARR", page: 6 },
        { option: "LICENSE_TECHNOLOGY", status: "PLAUSIBLE", evidence: "Two OEM inquiries logged", page: 8 },
      ];
      x.survivability.rigidities = rig;
    }, base);
  };

  it("a measured 54-day sales cycle is not a long-sales-cycle rigidity", () => {
    const f = factor(withRigidities([{ kind: "LONG_SALES_CYCLE", evidence: "Average sales cycle is 54 days.", page: 6 }, { kind: "SINGLE_REVENUE_LINE", evidence: "One product line", page: 4 }], [metric("sales_cycle_days", 54, { unit: "DAYS" })]), "STRATEGIC_SURVIVABILITY");
    expect(f.rigidities.map((r) => r.kind)).toEqual(["SINGLE_REVENUE_LINE"]);
    expect(f.evidence.some((e) => /not counted — long sales cycle/.test(e.text))).toBe(true);
    expect(f.level).toBe("STRONG");
  });

  it("a planned burn is not a fixed commitment; a lease is", () => {
    const planned = factor(withRigidities([{ kind: "FIXED_COMMITMENTS", evidence: "The 2027 plan includes monthly burn of $620k", page: 9 }, { kind: "SINGLE_REVENUE_LINE", evidence: "One product line", page: 4 }]), "STRATEGIC_SURVIVABILITY");
    expect(planned.rigidities).toHaveLength(1);
    const lease = factor(withRigidities([{ kind: "FIXED_COMMITMENTS", evidence: "10-year lease on a 4,000 m² plant", page: 9 }, { kind: "SINGLE_REVENUE_LINE", evidence: "One product line", page: 4 }]), "STRATEGIC_SURVIVABILITY");
    expect(lease.rigidities).toHaveLength(2);
    expect(lease.level).toBe("ADEQUATE");
  });
});

describe("divergence rules · scalability needs a measured input to be STRONG", () => {
  it("model signals alone cap at ADEQUATE", () => {
    const f = factor(dealWith((x) => (x.scalability.signals = [{ kind: "STANDARD_PRODUCT", direction: "SCALES", evidence: "One defined workflow posted to named ERPs", page: 3 }]), makeDeal({ metrics: [] })), "SCALABILITY_ARCHITECTURE");
    expect(f.points).toBe(-1);
    expect(f.level).toBe("ADEQUATE");
    expect(f.why).toMatch(/model-observed signals only/);
  });
});

/** Shaped like the real model output on evals/fixtures/decks/ledgerline-series-a.pdf (2026-09-27 STANDARD run). */
function ledgerlineLike() {
  const base = makeDeal();
  base.metrics = [...base.metrics, metric("sales_cycle_days", 54, { unit: "DAYS" }), metric("headcount", 38, { unit: "COUNT" }), metric("acv", 42_000)];
  return dealWith((x) => {
    x.ambition = {
      productScope: "PRODUCT_SUITE",
      geography: "GLOBAL",
      marketFraming: "NEW_CATEGORY",
      statedEndState: null,
      signals: [
        { kind: "PRODUCT_SCOPE", direction: "EXPANSIVE", evidence: "Posts to NetSuite, Dynamics and Sage Intacct; SAP B1 planned", page: 3 },
        { kind: "HIRING_PLAN", direction: "CONTAINED", evidence: "No hiring plan or specific future roles are stated.", page: 10 },
      ],
    };
    x.capTable.founders = [
      { name: "Maya Okafor", role: "CEO", status: "ACTIVE_FULL_TIME", ownershipPct: null, evidence: "CEO", page: 10 },
      { name: "Daniel Brandt", role: "CTO", status: "ACTIVE_FULL_TIME", ownershipPct: null, evidence: "CTO", page: 10 },
    ];
    x.survivability = {
      options: [
        { option: "CUT_BURN", status: "ASSERTED", evidence: "Net burn $365k/month, no cost-reduction plan stated", page: 9 },
        { option: "STRATEGIC_PARTNERSHIP", status: "DEMONSTRATED", evidence: "34% of new ARR comes from the NetSuite partner channel.", page: 6 },
        { option: "CHANGE_GTM", status: "PLAUSIBLE", evidence: "7 AEs plus a partner channel contributing 34% of new ARR", page: 6 },
      ],
      rigidities: [
        { kind: "LONG_SALES_CYCLE", evidence: "Average sales cycle is 54 days.", page: 6 },
        { kind: "SINGLE_REVENUE_LINE", evidence: "One accounts-payable automation product.", page: 4 },
        { kind: "FIXED_COMMITMENTS", evidence: "The 2027 plan includes monthly burn of $620k after the round.", page: 9 },
      ],
    };
    x.marketStructure = {
      dimensions: [
        { dimension: "FRAGMENTATION", reading: "FAVORABLE", evidence: "~190,000 US mid-market companies", page: 7 },
        { dimension: "BUYER_CONCENTRATION", reading: "FAVORABLE", evidence: "190,000 potential organizations; no concentration among buyers is stated.", page: 7 },
        { dimension: "PURCHASE_FREQUENCY", reading: "FAVORABLE", evidence: "Customers process 3,000–25,000 invoices per month", page: 2 },
        { dimension: "NETWORK_STRUCTURE", reading: "NEUTRAL", evidence: "34% of new ARR via NetSuite; no marketplace or network effects are stated.", page: 3 },
        { dimension: "INCUMBENT_BUNDLING", reading: "UNFAVORABLE", evidence: "Incumbent ERPs ship basic OCR; Bill.com and Tipalti overlap", page: 8 },
      ],
      topBuyersSharePct: null,
      topBuyersCount: null,
      addressableBuyerCount: 190_000,
      largestCompetitorSharePct: null,
    };
    x.dependencies = [
      dep("PLATFORM_API", "NetSuite", "CORE", "MODERATE", { mitigationStated: "Also posts to Dynamics and Sage Intacct" }),
      dep("PLATFORM_API", "Microsoft Dynamics", "CORE", "MODERATE", { mitigationStated: "Also posts to NetSuite and Sage Intacct" }),
      dep("PLATFORM_API", "Sage Intacct", "CORE", "MODERATE", { mitigationStated: "Also posts to NetSuite and Dynamics" }),
      dep("CLOUD_INFRASTRUCTURE", "Unspecified hosting provider", "CORE", "UNKNOWN"),
      dep("MODEL_PROVIDER", "Unspecified inference provider or model stack", "CORE", "UNKNOWN"),
    ];
    x.scalability.signals = [
      { kind: "HUMAN_IN_THE_LOOP", direction: "SCALES", evidence: "87% of invoices processed with no human touch after 90 days", page: 3 },
      { kind: "SERVICES_REVENUE", direction: "NEUTRAL", evidence: "No services revenue is reported.", page: null },
      { kind: "MARGIN_TREND", direction: "SCALES", evidence: "Gross margin is 74%. No historical margin trend is provided.", page: 4 },
    ];
  }, base);
}

describe("divergence rules · regression on a Ledgerline-shaped model output", () => {
  const r = derived(ledgerlineLike()).divergence;

  it("dependency surface: multi-homed ERPs and unnamed providers → not WIDE_SURFACE; the undisclosed model provider is flagged", () => {
    const f = factorOf(r, "DEPENDENCY_SURFACE");
    expect(f.reading).toBe("CONTAINED_MODEL_UNDISCLOSED");
    expect(f.level).toBe("ADEQUATE");
    expect(f.surfaceCount).toBe(1);
  });

  it("survivability: false rigidities (54-day cycle, a planned burn) do not downgrade", () => {
    const f = factorOf(r, "STRATEGIC_SURVIVABILITY");
    expect(f.rigidities.map((x) => x.kind)).toEqual(["SINGLE_REVENUE_LINE"]);
    expect(f.level).not.toBe("WEAK");
  });

  it("market structure: absence-based readings dropped, the rest balance to MIXED", () => {
    const f = factorOf(r, "MARKET_STRUCTURE");
    expect(f.dimensions.map((d) => d.dimension).sort()).toEqual(["FRAGMENTATION", "INCUMBENT_BUNDLING", "PURCHASE_FREQUENCY"]);
    expect(f.level).toBe("ADEQUATE");
  });

  it("scalability: signals only, no measured delivery cost → not STRONG", () => {
    expect(factorOf(r, "SCALABILITY_ARCHITECTURE").level).toBe("ADEQUATE");
  });

  it("ambition: the absence-based hiring signal is ignored", () => {
    expect(factorOf(r, "AMBITION_CEILING").signals.map((s) => s.kind)).toEqual(["PRODUCT_SCOPE"]);
  });

  it("cap table: a roster without stakes is not an alignment reading", () => {
    const f = factorOf(r, "CAP_TABLE_ALIGNMENT");
    expect(f.level).toBe("ADEQUATE");
    expect(f.reading).toBe("NO_ISSUE_SHOWN");
  });
});
