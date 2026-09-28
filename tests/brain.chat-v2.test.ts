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

describe("language detection covers ordinary French phrasing", () => {
  it.each(["Qu'a dit James Zhang sur Ledgerline ?", "Et son burn ?", "C'est quoi le runway", "Donne-moi le CAC", "Pourquoi on a passé ?"])("%s → fr", (q) => expect(detectLanguage(q)).toBe("fr"));
  it.each(["What did James say about Ledgerline?", "Is the NRR good?", "Show me the burn"])("%s → en", (q) => expect(detectLanguage(q)).toBe("en"));
});

describe("computations — money, multiples and horizons are parsed with their units", () => {
  it.each([
    ["1,5 Md", 1.5e9],
    ["2 milliards", 2e9],
    ["3 mds", 3e9],
    ["1,250M", 1.25e9],
    ["$1.2bn", 1.2e9],
    ["40M€", 40e6],
    ["250k", 250e3],
    ["2 millions", 2e6],
  ])("parseMoney(%s) = %s", (s, v) => expect(parseMoney(s)).toBe(v));

  it.each([
    // FR
    ["Que faut-il pour faire un 10x à 7 ans ?", { entryPostMoneyUsd: null, targetMultiple: 10, yearsToExit: 7 }],
    ["Quelle trajectoire pour un 10x à 1,5 Md de post-money ?", { entryPostMoneyUsd: 1.5e9, targetMultiple: 10 }],
    ["Quelle trajectoire nécessaire pour 5x à 2 milliards ?", { entryPostMoneyUsd: 2e9, targetMultiple: 5 }],
    ["trajectoire pour 10 fois à 40M€ post en 8 ans", { entryPostMoneyUsd: 40e6, targetMultiple: 10, yearsToExit: 8 }],
    ["Que faut-il pour retourner 30M$ à 60 mois ?", { entryPostMoneyUsd: null, targetMultiple: null, targetContributionUsd: 30e6, yearsToExit: 5 }],
    // EN
    ["What trajectory is required for a 10× return at $42M post?", { entryPostMoneyUsd: 42e6, targetMultiple: 10 }],
    ["What must happen so that 10x is possible at $42M post?", { entryPostMoneyUsd: 42e6, targetMultiple: 10 }],
    ["What would it take to return $30M at 60 months?", { entryPostMoneyUsd: null, targetMultiple: null, targetContributionUsd: 30e6, yearsToExit: 5 }],
    ["Required trajectory for 10x at $40M post in 8 years", { entryPostMoneyUsd: 40e6, targetMultiple: 10, yearsToExit: 8 }],
    ["Required trajectory for 3x at 7 years", { entryPostMoneyUsd: null, targetMultiple: 3, yearsToExit: 7 }],
  ] as const)("%s", (q, expected) => {
    expect(detectCompute(q)).toMatchObject({ kind: "TRAJECTORY", ...expected });
  });

  it("a horizon is never read as a price (the $7 post-money bug)", () => {
    const deal = makeDeal();
    const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE, { now: new Date("2026-09-01") });
    const out = runCompute(detectCompute("Que faut-il pour faire un 10x à 7 ans ?")!, economicsContext(deal, derived, getRegistry(), DEFAULT_FUND_PROFILE));
    expect(out.title).not.toMatch(/at \$7 post/);
    expect(out.text).not.toMatch(/not modelable/);
  });
});

describe("fast path — stale and inferred values are shown with explicit labels", () => {
  const co = { name: "Acme", slug: "acme" };
  it("a STALE value is answered, labelled stale with its last reported period", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "arr" ? { ...m, state: "STALE" as const, periodEnd: "2025-10", qualityFlags: ["STALE: 11 months old (max 6)"] } : m));
    const en = answerFact(detectFactQuestion("What is the ARR?")!, co, d, "en");
    expect(en.found).toBe(true);
    expect(en.text).toContain("$3.84M");
    expect(en.text).toContain("stale: last reported 2025-10");
    const fr = answerFact(detectFactQuestion("Quel est l'ARR ?")!, co, d, "fr");
    expect(fr.text).toContain("ancien : dernière valeur communiquée 2025-10");
  });

  it("an INFERRED value is answered, labelled as inferred by code from its inputs", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "arr" ? { ...m, state: "INFERRED" as const, inputs: ["MET-900"] } : m));
    const en = answerFact(detectFactQuestion("What is the ARR?")!, co, d, "en");
    expect(en.found).toBe(true);
    expect(en.text).toContain("inferred by code from MET-900");
    expect(answerFact(detectFactQuestion("Quel est l'ARR ?")!, co, d, "fr").text).toContain("inféré par le code à partir de MET-900");
  });

  it("an OBSERVED value carries no state label and is preferred over a stale one", () => {
    const d = makeDeal();
    const arr = d.metrics.find((m) => m.metricKey === "arr")!;
    d.metrics = [...d.metrics.filter((m) => m.metricKey !== "arr"), { ...arr, id: "MET-S", isPrimary: false, state: "STALE", periodEnd: "2026-08" }, { ...arr, id: "MET-O", isPrimary: false, periodEnd: "2026-03" }];
    const a = answerFact(detectFactQuestion("What is the ARR?")!, co, d, "en");
    expect(a.citations[0]!.title).toContain("MET-O");
    expect(a.text).not.toMatch(/stale:|inferred by code/);
  });

  it("UNKNOWN / WITHHELD values are still not answered", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m) => (m.metricKey === "arr" ? { ...m, state: "WITHHELD" as const } : m));
    expect(answerFact(detectFactQuestion("What is the ARR?")!, co, d, "en").found).toBe(false);
  });
});

describe("fast path — routing and language", () => {
  it.each(["Who is on the cap table?", "Show me the cap-table", "Qui est au cap table ?"])("%s is not a valuation question", (q) => {
    expect(detectFactQuestion(q)?.kind).not.toBe("VALUATION");
  });
  it.each(["What is the cap?", "Quel est le cap du SAFE ?", "What's the valuation cap?"])("%s is a valuation question", (q) => {
    expect(detectFactQuestion(q)?.kind).toBe("VALUATION");
  });
  it.each(["What is Hélio's ARR?", "What did Zoé say about Ledgerline?", "Is Café Inc's NRR good?"])("an accent in a proper noun does not flip %s to French", (q) => {
    expect(detectLanguage(q)).toBe("en");
  });
  it.each(["Quelle est la marge brute de Café Inc ?", "Où en est le runway ?", "Était-ce vérifié ?", "Quel est l'ARR de Hélio ?"])("%s → fr", (q) => {
    expect(detectLanguage(q)).toBe("fr");
  });
});
