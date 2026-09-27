import { describe, expect, it } from "vitest";
import { answerFact, detectFactQuestion, detectLanguage } from "@/brain/fast-path";
import { detectCompute, parseMoney, runCompute, economicsContext } from "@/brain/compute";
import { fragileVariables, matchMembers, premortemText, type PremortemMember } from "@/brain/premortem";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { makeDeal, metric } from "./fixtures";

const co = { name: "Acme AI", slug: "acme-ai" };

describe("fast path — detection", () => {
  it.each([
    ["Quel est le CAC de Acme ?", "cac"],
    ["ARR de Acme ?", "arr"],
    ["What is Acme's NRR?", "nrr"],
    ["marge brute d'Acme", "gross_margin"],
    ["Combien de clients a Acme ?", "paying_customers"],
    ["runway ?", "runway_months"],
    ["CAC payback d'Acme", "cac_payback_months"],
    ["burn mensuel", "monthly_net_burn"],
  ])("%s → %s", (q, key) => {
    const f = detectFactQuestion(q);
    expect(f?.kind).toBe("METRIC");
    expect(f && f.kind === "METRIC" && f.key).toBe(key);
  });

  it.each([
    "Pourquoi le CAC d'Acme est-il si bas ?",
    "Compare l'ARR d'Acme et de Parcelo",
    "Is Acme's NRR good for a Series A?",
    "Qu'est-ce que James va challenger sur le CAC ?",
    "ARR et burn d'Acme ?",
    "What is the investment thesis?",
  ])("routes judgment / multi-fact questions to the model: %s", (q) => {
    expect(detectFactQuestion(q)).toBeNull();
  });

  it("detects valuation and raise", () => {
    expect(detectFactQuestion("Quelle est la valorisation ?")?.kind).toBe("VALUATION");
    expect(detectFactQuestion("Combien lèvent-ils ?")?.kind).toBe("RAISE");
  });

  it("detects language", () => {
    expect(detectLanguage("Quel est le CAC ?")).toBe("fr");
    expect(detectLanguage("What is the CAC?")).toBe("en");
  });
});

describe("fast path — answers are read from the canonical record", () => {
  it("answers a present metric with value, status and a citation to the metric", () => {
    const deal = makeDeal();
    const a = answerFact(detectFactQuestion("ARR de Acme ?")!, co, deal, "fr");
    expect(a.found).toBe(true);
    expect(a.text).toContain("$3.84M");
    expect(a.text).toContain("déclaré par la société");
    expect(a.citations[0]!.href).toMatch(/^\/deals\/acme-ai\/evidence\?metric=MET-/);
  });

  it("HALLUCINATION TRAP: an absent metric yields 'On ne sait pas encore' and no number", () => {
    const deal = makeDeal(); // no CAC in the fixture
    const a = answerFact(detectFactQuestion("Quel est le CAC de Acme ?")!, co, deal, "fr");
    expect(a.found).toBe(false);
    expect(a.text).toContain("On ne sait pas encore");
    expect(a.text).not.toMatch(/CAC\s*:\s*\$/);
    // Related metrics are offered, clearly as other metrics.
    expect(a.text).toContain("Indicateurs voisins");
    expect(a.text).toContain("14 mo");
  });

  it("HALLUCINATION TRAP (en): absent metric says we don't know", () => {
    const a = answerFact(detectFactQuestion("What is Acme's GMV?")!, co, makeDeal(), "en");
    expect(a.found).toBe(false);
    expect(a.text).toContain("We don't know yet");
  });

  it("reports an explicitly withheld metric as withheld", () => {
    const deal = makeDeal();
    deal.metrics.push(metric("cac", null, { state: "WITHHELD" }));
    const a = answerFact(detectFactQuestion("CAC ?")!, co, deal, "fr");
    expect(a.text).toContain("explicitement ne pas communiquer");
  });

  it("surfaces quality flags and never labels a company number as verified", () => {
    const deal = makeDeal();
    deal.metrics = [metric("arr", 5_000_000, { qualityFlags: ["SIGNED_NOT_DEPLOYED: includes contracts"] })];
    const a = answerFact(detectFactQuestion("ARR ?")!, co, deal, "fr");
    expect(a.text).toContain("signé non déployé");
    expect(a.text).not.toMatch(/\bvérifié\b(?! )/);
  });

  it("valuation comes from the financing record, unknown otherwise", () => {
    const deal = makeDeal();
    expect(answerFact({ kind: "VALUATION" }, co, deal, "fr").text).toContain("$48.0M");
    deal.financing = { ...deal.financing!, preMoney: null, postMoney: null, valuationCap: null };
    const a = answerFact({ kind: "VALUATION" }, co, deal, "fr");
    expect(a.found).toBe(false);
    expect(a.text).toContain("On ne sait pas encore");
  });
});

describe("computations — detection", () => {
  it("parses money", () => {
    expect(parseMoney("$42M")).toBe(42e6);
    expect(parseMoney("42 M$")).toBe(42e6);
    expect(parseMoney("1,5 Md")).toBe(1.5e9);
  });

  it("detects the $42M / 20x trajectory question", () => {
    const r = detectCompute("À $42M post, quelle trajectoire opérationnelle minimale doit exister pour que ce deal retourne 20x notre capital ?");
    expect(r).toEqual({ kind: "TRAJECTORY", entryPostMoneyUsd: 42e6, targetMultiple: 20, targetContributionUsd: null, yearsToExit: null });
  });

  it.each([
    ["Et si le CAC double ?", "CAC_X2"],
    ["What if the next round slips 12 months?", "NEXT_ROUND_DELAY_12M"],
    ["Si la valorisation d'entrée double ?", "ENTRY_VALUATION_X2"],
    ["Et si OpenAI commoditise la feature ?", "COMMODITIZATION"],
    ["What if the incumbent bundles it for free?", "INCUMBENT_BUNDLES_FREE"],
  ])("counterfactual: %s", (q, id) => {
    const r = detectCompute(q);
    expect(r?.kind).toBe("COUNTERFACTUAL");
    expect(r && r.kind === "COUNTERFACTUAL" && r.scenarios).toContain(id);
  });

  it("ignores ordinary questions", () => {
    expect(detectCompute("Qui sont les fondateurs ?")).toBeNull();
  });

  it("computes the trajectory with the engine (numbers come from code)", () => {
    const deal = makeDeal();
    const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE, { now: new Date("2026-09-01") });
    const ctx = economicsContext(deal, derived, getRegistry(), DEFAULT_FUND_PROFILE);
    const out = runCompute(detectCompute("À $42M post, quelle trajectoire pour retourner 20x ?")!, ctx);
    expect(out.text).toContain("COMPUTED");
    expect(out.text).toMatch(/Required revenue by exit multiple/);
    expect(out.title).toContain("20×");
    const cf = runCompute({ kind: "COUNTERFACTUAL", scenarios: ["CAC_X2"] }, ctx);
    expect(cf.text).toContain("CAC doubles");
  });
});

describe("IC pre-mortem — never fabricates a member's view", () => {
  const deal = makeDeal();
  deal.risks = [
    { category: "GTM", title: "CAC payback may be understated", description: "CAC excludes founder-led sales time", severity: "HIGH", likelihood: "MODERATE", timing: "NEXT_12_MONTHS", mitigation: "", evidence: "", claimRefs: [], weaknessClass: "THESIS_KILLING", repair: null },
  ] as never;
  const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE, { now: new Date("2026-09-01") });
  const vars = fragileVariables(deal, derived);

  const members: PremortemMember[] = [
    { id: "m1", name: "James Zhang", role: "Partner", focus: ["unit economics"], documentedPreferences: "Wants fully loaded CAC and payback under 18 months.", observations: [] },
    { id: "m2", name: "Ada Silent", role: "Partner", focus: [], documentedPreferences: null, observations: [] },
  ];

  it("links a member only through documented/observed records", () => {
    const matches = matchMembers(members, vars, "co1");
    expect(matches.some((m) => m.memberName === "James Zhang" && m.basis === "DOCUMENTED")).toBe(true);
    expect(matches.some((m) => m.memberName === "Ada Silent")).toBe(false);
  });

  it("flags members with nothing recorded so the model cannot attribute a view", () => {
    const text = premortemText("Acme AI", vars, members, matchMembers(members, vars, "co1"), "co1");
    expect(text).toContain("Ada Silent");
    expect(text).toContain("NOTHING RECORDED");
    expect(text).toContain("CAC payback may be understated");
  });

  it("with no members at all, says so", () => {
    const text = premortemText("Acme AI", vars, [], [], "co1");
    expect(text).toContain("No IC members recorded");
  });

  it("observed statements outrank documented preferences", () => {
    const withObs: PremortemMember[] = [
      { ...members[0]! },
      { id: "m3", name: "Obs Person", role: "Principal", focus: [], documentedPreferences: null, observations: [{ kind: "CONCERN", statement: "Pushed hard on CAC payback and founder-led sales in the last IC", topic: "unit economics", provenance: "OBSERVED", observedAt: "2026-05-02", companyId: null }] },
    ];
    const matches = matchMembers(withObs, vars, "co1");
    expect(matches[0]!.basis).toBe("OBSERVED");
  });
});
