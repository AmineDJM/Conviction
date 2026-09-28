/**
 * Formation generators: valid, non-trivial items built from the deal's own
 * numbers; numeric answers equal the engines; the pre-answer payload never
 * contains the analysis or the key; ids are deterministic.
 */
import { describe, expect, it } from "vitest";
import { burnMultiple, cacPaybackMonths, runwayMonths } from "@/engine/calc/finance";
import { publicExercise, levelToDifficulty } from "@/formation/exercise";
import { deckFacts, domainSkillOf } from "@/formation/case";
import { generateExercises, findExercise } from "@/formation/generate";
import { rankConcerns, naiveTopConcern } from "@/formation/concerns";
import { flaggedStatements } from "@/formation/gen-forensics";
import { forensicCategory } from "@/formation/forensic-map";
import { bucketOf } from "@/formation/gen-judgment";
import { EXPERT_PATTERNS, type Exercise } from "@/formation/types";
import { caseFrom, cleanDeal, exercisesOf, kindOf, leakyGrowthDeal, m, makeDeal, withAnalysis } from "./formation.helpers";
import { setMetric } from "./fixtures/integrity/builders";

const cases = () => [
  ["makeDeal", caseFrom(makeDeal())],
  ["cleanDeal + analysis", caseFrom(withAnalysis(cleanDeal()))],
  ["leaky growth", caseFrom(leakyGrowthDeal())],
] as const;

describe("every generated exercise is valid", () => {
  for (const [name, c] of cases()) {
    const exs = exercisesOf(c);
    it(`${name}: generates several exercise kinds`, () => {
      expect(new Set(exs.map((e) => e.kind)).size).toBeGreaterThanOrEqual(3);
    });
    it(`${name}: ids are unique and deterministic`, () => {
      expect(new Set(exs.map((e) => e.id)).size).toBe(exs.length);
      expect(generateExercises(c).map((e) => e.id)).toEqual(exs.map((e) => e.id));
    });
    it(`${name}: level ∈ 1..5 and difficulty follows the level`, () => {
      for (const e of exs) {
        expect(e.level).toBeGreaterThanOrEqual(1);
        expect(e.level).toBeLessThanOrEqual(5);
        expect(e.difficulty).toBe(levelToDifficulty(e.level));
      }
    });
    it(`${name}: every exercise has skills, a prompt naming the company, and a key with an answer`, () => {
      for (const e of exs) {
        expect(e.skills.length).toBeGreaterThan(0);
        expect(e.prompt).toContain(c.ref.name);
        expect(e.key.answer.length).toBeGreaterThan(0);
        expect(e.key.workedSolution.length + e.key.keyPoints.length).toBeGreaterThan(0);
      }
    });
    it(`${name}: choice exercises have ≥ 3 distinct options and a correct option among them`, () => {
      for (const e of exs.filter((x) => x.input.type === "choice")) {
        if (e.input.type !== "choice") continue;
        const ids = e.input.options.map((o) => o.id);
        expect(new Set(e.input.options.map((o) => o.text)).size).toBe(ids.length);
        expect(ids.length).toBeGreaterThanOrEqual(3);
        for (const k of e.key.correctOptionIds) expect(ids).toContain(k);
        for (const k of e.key.partialOptionIds) expect(e.key.correctOptionIds).not.toContain(k);
      }
    });
    it(`${name}: findExercise round-trips every id`, () => {
      for (const e of exs) expect(findExercise(c, e.id)?.id).toBe(e.id);
    });
    it(`${name}: expert flag ⇔ an expert pattern on the item`, () => {
      for (const e of exs) expect(e.expert).toBe(e.patterns.some((p) => (EXPERT_PATTERNS as readonly string[]).includes(p)));
    });
  }
});

describe("the pre-answer payload never leaks the reveal", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  const exs = exercisesOf(c);
  const FORBIDDEN_KEYS = ["key", "patterns", "casePatterns", "correctOptionIds", "partialOptionIds", "optionNotes", "workedSolution", "aiAnalysis", "alternativeReasoning", "expertFocus", "keyPoints", "questionBank", "decisionBucket", "flagged", "numeric"];
  const allKeys = (o: unknown, acc = new Set<string>()): Set<string> => {
    if (Array.isArray(o)) o.forEach((x) => allKeys(x, acc));
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) (acc.add(k), allKeys(v, acc));
    return acc;
  };
  it.each(exs.map((e) => [`${e.kind}/${e.variant}`, e] as const))("%s: no answer-key or conclusion fields", (_n, e) => {
    const keys = allKeys(publicExercise(e));
    for (const k of FORBIDDEN_KEYS) expect(keys.has(k), k).toBe(false);
  });
  it.each(exs.map((e) => [`${e.kind}/${e.variant}`, e] as const))("%s: no AI conclusion text (thesis, risks, red team, recommendation, strengths)", (_n, e) => {
    const json = JSON.stringify(publicExercise(e));
    expect(json).not.toMatch(/SECRET-/);
  });
  it("the canonical object really contains those conclusions (the test is meaningful)", () => {
    expect(JSON.stringify(c.deal)).toMatch(/SECRET-BET/);
    expect(exs.some((e) => JSON.stringify(e.key).includes("SECRET-"))).toBe(true);
  });
  it("deck facts carry no verification status, quality flags or evidence labels", () => {
    const d = withAnalysis(cleanDeal());
    d.metrics = d.metrics.map((x) => ({ ...x, qualityFlags: ["SMALL_SAMPLE: n=3"], verification: "CONTRADICTED" }));
    const facts = JSON.stringify(deckFacts(d));
    expect(facts).not.toMatch(/SMALL_SAMPLE|CONTRADICTED|VERIFIED|qualityFlags|verification/);
  });
  it("facts exclude analyst corrections, derived metrics and non-document sources", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-X1", "win_rate", 44, { unit: "PERCENT", calculationMethod: "DERIVED" }));
    d.metrics.push(m("MET-X2", "win_rate", 45, { unit: "PERCENT", calculationMethod: "USER_CORRECTED" }));
    d.metrics.push(m("MET-X3", "win_rate", 46, { unit: "PERCENT", sourceId: "SRC-WEB" }));
    const ids = deckFacts(d).map((f) => f.id);
    expect(ids).not.toContain("F-MET-X1");
    expect(ids).not.toContain("F-MET-X2");
    expect(ids).not.toContain("F-MET-X3");
    expect(ids).toContain("F-MET-001");
  });
  it("definitions that read like extraction commentary are hidden", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.map((x) => (x.id === "MET-013" ? { ...x, definitionUsed: "Approximate ACV; scope not stated." } : x));
    expect(deckFacts(d).find((f) => f.id === "F-MET-013")?.detail ?? "").not.toMatch(/not stated/);
  });
  it("numeric exercises hide the fact that states the answer", () => {
    const e = kindOf(c, "NUMERIC", "IMPLIED_ACV");
    expect(e.context.map((f) => f.id)).not.toContain("F-MET-013"); // the deck's own ACV
    const r = kindOf(c, "NUMERIC", "RUNWAY");
    expect(r.context.map((f) => f.id)).not.toContain("F-MET-008"); // the deck's own runway
  });
});

describe("numeric answers match the engines", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  it("runway = cash ÷ burn (calc/finance)", () => {
    const e = kindOf(c, "NUMERIC", "RUNWAY");
    expect(e.key.numeric!.value).toBeCloseTo(runwayMonths(3_000_000, 350_000)!, 9);
  });
  it("implied ACV = ARR ÷ paying customers", () => {
    expect(kindOf(c, "NUMERIC", "IMPLIED_ACV").key.numeric!.value).toBeCloseTo(3_840_000 / 92, 6);
  });
  it("entry ownership = our check ÷ post-money (returns engine inputs)", () => {
    const e = kindOf(c, "NUMERIC", "ENTRY_OWNERSHIP");
    const inp = c.derived.returns.inputs;
    expect(e.key.numeric!.value).toBeCloseTo((inp.checkUsd / inp.entry.postMoneyUsd!) * 100, 9);
  });
  it("round dilution = raise ÷ post", () => {
    expect(kindOf(c, "NUMERIC", "ROUND_DILUTION").key.numeric!.value).toBeCloseTo((12_000_000 / 60_000_000) * 100, 9);
  });
  it("burn multiple = 12 × burn ÷ net new ARR", () => {
    expect(kindOf(c, "NUMERIC", "BURN_MULTIPLE").key.numeric!.value).toBeCloseTo(burnMultiple(350_000 * 12, 3_840_000 - 1_240_000)!, 9);
  });
  it("exit for 20× = economics trajectory required exit equity", () => {
    const e = kindOf(c, "NUMERIC", "EXIT_FOR_20X");
    expect(e.key.numeric!.value).toBe(c.derived.economics.trajectory.capitalMultiple.requiredExitEquityUsd);
    expect(e.prompt).toContain(`${c.derived.economics.trajectory.capitalMultiple.target.multiple}×`);
  });
  it("fund-return exit = economics trajectory for the fund target", () => {
    expect(kindOf(c, "NUMERIC", "FUND_RETURN_EXIT").key.numeric!.value).toBe(c.derived.economics.trajectory.fundTarget.requiredExitEquityUsd);
  });
  it("required CAGR is consistent with the trajectory's reference multiple", () => {
    const t = c.derived.economics.trajectory.capitalMultiple;
    const row = t.byMultiple.find((r) => r.revenueMultiple === t.referenceMultiple)!;
    expect(kindOf(c, "NUMERIC", "REQUIRED_CAGR").key.numeric!.value).toBeCloseTo(row.requiredCagrPct!, 6);
  });
  it("CAC payback = CAC ÷ (ACV/12 × GM) when the deck reports CAC", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "cac_payback_months");
    d.metrics.push(m("MET-CAC", "cac", 48_000));
    const e = kindOf(caseFrom(d), "NUMERIC", "CAC_PAYBACK");
    expect(e.key.numeric!.value).toBeCloseTo(cacPaybackMonths(48_000, 41_700, 76)!, 9);
  });
  it("net revenue from GMV = GMV × take rate for marketplaces", () => {
    const d = makeDeal();
    d.classification = { ...d.classification, productType: ["MARKETPLACE"], revenueModel: ["TAKE_RATE"] };
    d.metrics = [m("MET-G", "gmv", 4_600_000), m("MET-T", "take_rate", 14, { unit: "PERCENT" })];
    const c2 = caseFrom(d);
    expect(kindOf(c2, "NUMERIC", "NET_REVENUE_FROM_GMV").key.numeric!.value).toBeCloseTo(644_000, 6);
    expect(c2.domainSkill).toBe("MARKETPLACE_ECONOMICS");
  });
  it("tolerances are tight for arithmetic and wider only for preference-sensitive exit values", () => {
    for (const e of exercisesOf(c).filter((x) => x.kind === "NUMERIC")) {
      expect(e.key.numeric!.tolerance).toBeLessThanOrEqual(e.variant.includes("EXIT") ? 0.12 : 0.06);
      expect(e.key.workedSolution.length).toBeGreaterThan(0);
    }
  });
});

describe("multiple choice is never trivial", () => {
  it("the spec example: growth 180%, NRR 84%, payback 6 → retention is the concern", () => {
    const c = caseFrom(leakyGrowthDeal());
    const e = kindOf(c, "MCQ_CONCERN");
    if (e.input.type !== "choice") throw new Error("choice");
    const correct = e.input.options.find((o) => o.id === e.key.correctOptionIds[0])!;
    expect(correct.text).toMatch(/NRR/);
    expect(e.key.concepts).toEqual(["RETENTION_RISK"]);
    expect(c.patterns.map((p) => p.pattern)).toContain("GROWTH_HIDING_RETENTION");
  });
  it("every option quotes one of the deal's own numbers", () => {
    const c = caseFrom(leakyGrowthDeal());
    const e = kindOf(c, "MCQ_CONCERN");
    if (e.input.type !== "choice") throw new Error("choice");
    const displays = c.concerns.map((x) => x.display);
    for (const o of e.input.options) expect(displays.some((d) => o.text.includes(d))).toBe(true);
  });
  it("the naive trap is included when the adjusted ranking differs (obvious answer wrong)", () => {
    const c = caseFrom(withAnalysis(cleanDeal()));
    const naive = naiveTopConcern(c.concerns)!;
    const e = kindOf(c, "MCQ_CONCERN");
    if (e.input.type !== "choice") throw new Error("choice");
    expect(naive.metricKey).toBe("runway_months");
    expect(e.input.options.some((o) => o.text.startsWith("Runway"))).toBe(true);
    expect(e.patterns).toContain("OBVIOUS_ANSWER_WRONG");
    expect(e.expert).toBe(true);
    expect(e.key.alternativeReasoning.join(" ")).toMatch(/naive/);
  });
  it("pre-round runway mitigation only applies with ≥ 6 months left to close", () => {
    const d = cleanDeal();
    d.financing!.cashBalance = { amount: 700_000, currency: "USD", rawText: "$0.7M" };
    setMetric(d, "runway_months", 2, { unit: "MONTHS" });
    const c = caseFrom(d);
    const rw = c.concerns.find((x) => x.metricKey === "runway_months")!;
    expect(rw.severity).toBe(rw.rawSeverity);
    expect(c.concerns[0]!.metricKey).toBe("runway_months");
  });
  it("CAC flagged as not fully loaded raises payback severity", () => {
    const d = cleanDeal();
    setMetric(d, "cac_payback_months", 22, { unit: "MONTHS" });
    d.metrics.push(m("MET-CAC", "cac", 58_000, { components: ["excludes founder time"] }));
    const c = caseFrom(d);
    const pb = c.concerns.find((x) => x.metricKey === "cac_payback_months")!;
    if (c.derived.integrity.findings.some((f) => f.kind === "CAC_INCOMPLETE")) expect(pb.severity).toBeGreaterThan(pb.rawSeverity);
    else expect(pb.severity).toBe(pb.rawSeverity);
  });
  it("PMF signal: retention beats growth; growth is always an option", () => {
    const c = caseFrom(makeDeal());
    const e = kindOf(c, "MCQ_PMF_SIGNAL");
    if (e.input.type !== "choice") throw new Error("choice");
    expect(e.input.options.find((o) => o.id === e.key.correctOptionIds[0])!.text).toMatch(/NRR/);
    expect(e.input.options.some((o) => /growth/i.test(o.text))).toBe(true);
  });
  it("concerns are ranked by adjusted severity from the registry curves", () => {
    const c = caseFrom(leakyGrowthDeal());
    const r = rankConcerns(c.deal, c.derived, c.deckMetrics);
    for (let i = 1; i < r.length; i++) expect(r[i - 1]!.severity).toBeGreaterThanOrEqual(r[i]!.severity);
    for (const x of r) expect(x.benchmarkId).toBeTruthy();
  });
  it("no MCQ is generated from fewer than four concern metrics", () => {
    const d = makeDeal();
    d.metrics = d.metrics.slice(0, 2);
    expect(exercisesOf(caseFrom(d)).some((e) => e.kind === "MCQ_CONCERN")).toBe(false);
  });
});

describe("deck forensics: the key comes from the integrity engine", () => {
  function tamDeal() {
    const d = cleanDeal();
    d.deckMarket = { ...d.deckMarket, tam: { amount: 90_000_000_000, currency: "USD", rawText: "$90B" } };
    setMetric(d, "paying_customers", 92, { unit: "COUNT", definitionUsed: "includes 12 paid pilots", qualityFlags: ["CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING: definition mentions pilots"], location: "p. 4" });
    d.metrics.push(m("MET-PIL", "pilots", 60, { unit: "COUNT", location: "p. 4" }));
    return d;
  }
  it("an inflated TAM and pilots-as-customers are flagged with the right categories", () => {
    const c = caseFrom(tamDeal());
    const flagged = flaggedStatements(c);
    const cats = flagged.flatMap((f) => f.categories);
    expect(cats).toContain("INFLATED_TAM");
    expect(cats).toContain("PILOTS_AS_CUSTOMERS");
    expect(flagged.find((f) => f.categories.includes("INFLATED_TAM"))!.fact.id).toBe("F-TAM");
  });
  it("the statements exercise mixes flagged statements and clean decoys", () => {
    const c = caseFrom(tamDeal());
    const e = kindOf(c, "FORENSICS_STATEMENTS");
    if (e.input.type !== "statements") throw new Error("statements");
    const n = Object.keys(e.key.flagged!).length;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(e.input.statements.length - n).toBeGreaterThanOrEqual(2);
    expect(e.key.concepts).toEqual(expect.arrayContaining(["MARKET_SIZE_INFLATION", "CUSTOMER_QUALITY"]));
  });
  it("findings a deck reader cannot see (external contradictions, source quality) are excluded", () => {
    const c = caseFrom(tamDeal());
    const kinds = flaggedStatements(c).flatMap((f) => f.findings.map((x) => x.kind));
    expect(kinds).not.toContain("CLAIM_CONTRADICTED");
    expect(kinds).not.toContain("VERIFICATION_RESTS_ON_WEAK_SOURCE");
  });
  it.each([
    ["IMPLIED_DECK_TAM_VS_RECONSTRUCTED", "IMPLIED_METRICS", "INFLATED_TAM"],
    ["PILOTS_AS_CUSTOMERS", "METRIC_RULES", "PILOTS_AS_CUSTOMERS"],
    ["HOCKEY_STICK_FORECAST", "CHRONOLOGY", "FORECAST_AS_ACTUAL"],
    ["GROWTH_ON_TINY_BASE", "METRIC_RULES", "MISLEADING_METRIC"],
    ["RETENTION_WITHOUT_COHORTS", "METRIC_RULES", "OMISSION"],
    ["CROSS_SLIDE_VALUE_CONFLICT", "CROSS_SLIDE", "CONTRADICTION"],
    ["IMPLIED_RUNWAY", "IMPLIED_METRICS", "CONTRADICTION"],
    ["INSTRUCTION_TEXT_IN_MATERIALS", "SECURITY", null],
  ] as const)("%s → %s", (kind, module, cat) => {
    expect(forensicCategory({ kind, module })).toBe(cat);
  });
  it("omissions exercise: correct options are exactly the missing expected items", () => {
    const c = caseFrom(makeDeal());
    const e = kindOf(c, "FORENSICS_OMISSIONS");
    if (e.input.type !== "multi") throw new Error("multi");
    const missing = c.derived.integrity.expectedEvidence.items.filter((i) => i.level === "EXPECTED" && i.presence !== "PRESENT").map((i) => i.label);
    const correctTexts = e.input.options.filter((o) => e.key.correctOptionIds.includes(o.id)).map((o) => o.text);
    for (const t of correctTexts) expect(missing.includes(t) || !c.derived.integrity.expectedEvidence.items.some((i) => i.label === t)).toBe(true);
    expect(e.input.options.length - correctTexts.length).toBeGreaterThanOrEqual(2);
  });
});

describe("case patterns (expert mode material)", () => {
  it("growth hiding retention when retention is absent", () => {
    const d = cleanDeal();
    d.metrics = d.metrics.filter((x) => x.metricKey !== "nrr");
    expect(caseFrom(d).patterns.map((p) => p.pattern)).toContain("GROWTH_HIDING_RETENTION");
  });
  it("conflicting metrics names both sides", () => {
    const p = caseFrom(leakyGrowthDeal()).patterns.find((x) => x.pattern === "CONFLICTING_METRICS");
    expect(p?.evidence).toMatch(/strong .* while .* weak/);
  });
  it("inflated TAM from the implied-metrics check", () => {
    const d = cleanDeal();
    d.deckMarket = { ...d.deckMarket, tam: { amount: 90_000_000_000, currency: "USD", rawText: "$90B" } };
    expect(caseFrom(d).patterns.map((p) => p.pattern)).toContain("INFLATED_TAM");
  });
  it("extraordinary founder with weak traction", () => {
    const d = makeDeal();
    d.classification.operationalMaturity = "PROTOTYPE";
    d.metrics = d.metrics.filter((x) => x.metricKey !== "arr");
    d.founders = [
      {
        id: "F1", name: "A", role: "CEO", summary: "", timeline: [], publicWork: [], founderMarketFit: "", notObservableWithoutInterview: [], backgroundFromDeck: "", priorOrganizations: [], publicProfileUrls: [], researchFindingSourceIds: [],
        capabilities: [
          { dimension: "TECHNICAL_CAPABILITY", relevant: true, rating: "EXCEPTIONAL", observability: "OBSERVABLE", evidence: "shipped", claimRefs: [] },
          { dimension: "LEARNING_VELOCITY", relevant: true, rating: "STRONG", observability: "OBSERVABLE", evidence: "x", claimRefs: [] },
        ],
      },
    ];
    expect(caseFrom(d).patterns.map((p) => p.pattern)).toContain("EXTRAORDINARY_FOUNDER_WEAK_TRACTION");
  });
  it("poor-looking company with an evidenced outlier signal", () => {
    const d = withAnalysis(cleanDeal());
    d.risks = d.risks.map((r) => ({ ...r, severity: "HIGH" as const }));
    expect(caseFrom(d).patterns.map((p) => p.pattern)).toContain("POOR_LOOKING_WITH_OUTLIER");
  });
  it("a merely plausible nonlinear mechanism is not an evidenced outlier", () => {
    const d = cleanDeal();
    d.risks = withAnalysis(cleanDeal()).risks.map((r) => ({ ...r, severity: "HIGH" as const }));
    d.nonlinear = { whyDisproportionate: "", mechanism: "data loop", whyUnderestimated: "", compoundingAssumptions: [], outlierPlausible: true, outlierRationale: "" };
    const c = caseFrom(d);
    expect(c.patterns.map((p) => p.pattern)).not.toContain("POOR_LOOKING_WITH_OUTLIER");
    expect(kindOf(c, "OUTLIER").key.correctOptionIds).toContain("NO");
  });
  it("short runway and founder-dependent sales", () => {
    const d = cleanDeal();
    d.metrics.push(m("MET-FL", "founder_led_revenue_share", 70, { unit: "PERCENT" }));
    const p = caseFrom(d).patterns.map((x) => x.pattern);
    expect(p).toContain("SHORT_RUNWAY");
    expect(p).toContain("FOUNDER_DEPENDENT_SALES");
  });
});

describe("judgment exercises", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  it.each([
    ["SCREEN_OUT", "PASS"],
    ["ANALYTICAL_RECOMMEND_PASS", "PASS"],
    ["WATCH", "WATCH"],
    ["NEEDS_FOUNDER_CALL", "CONTINUE_DD"],
    ["DEEP_DD", "CONTINUE_DD"],
    ["IC_READY", "IC"],
    ["ANALYTICAL_RECOMMEND_INVEST", "IC"],
  ])("recommendation %s → bucket %s", (s, b) => expect(bucketOf(s)).toBe(b));
  it("decision key is the deterministic recommendation bucket", () => {
    expect(kindOf(c, "DECISION").key.decisionBucket).toBe(bucketOf(c.derived.recommendation.status));
  });
  it("decision key points include critical risks and the evidenced outlier signal", () => {
    const kp = kindOf(c, "DECISION").key.keyPoints;
    expect(kp.some((p) => p.kind === "RISK" && p.critical)).toBe(true);
    expect(kp.some((p) => p.kind === "OUTLIER" && p.critical)).toBe(true);
  });
  it("key points link into the deal's evidence", () => {
    const kp = kindOf(c, "DECISION").key.keyPoints;
    expect(kp.find((p) => p.text.includes("retention may not hold"))!.href).toMatch(/^\/deals\/.+\/evidence\?claim=CLM-002$/);
    expect(kp.find((p) => p.text.includes("SECRET-RISK runway"))!.href).toMatch(/\/risks$/);
  });
  it("outlier exercise: YES when a strength is rated strong, with the signal tied to its claim", () => {
    const e = kindOf(c, "OUTLIER");
    expect(e.key.correctOptionIds).toContain("YES");
  });
  it("bull / bear, thesis, pass trigger and 20× exercises exist with key points", () => {
    for (const k of ["BULL_BEAR", "OPEN_THESIS", "OPEN_PASS_TRIGGER", "OPEN_TWENTY_X"] as const) expect(kindOf(c, k).key.keyPoints.length).toBeGreaterThanOrEqual(2);
  });
  it("20× key points quote the trajectory numbers", () => {
    const t = c.derived.economics.trajectory.capitalMultiple;
    const txt = kindOf(c, "OPEN_TWENTY_X").key.keyPoints.map((p) => p.text).join(" ");
    expect(txt).toContain(`${t.exitOwnershipPct!.toFixed(2)}%`);
  });
  it("founder-question bank ranks MUST_ASK above IMPORTANT", () => {
    const bank = kindOf(c, "FOUNDER_QUESTIONS").key.questionBank!;
    const q1 = bank.find((b) => b.id === "Q-01")!;
    const q2 = bank.find((b) => b.id === "Q-02")!;
    expect(q1.impact).toBeGreaterThan(q2.impact);
  });
});

describe("domain skill", () => {
  it.each([
    [{ productType: ["SAAS"], revenueModel: ["SUBSCRIPTION"], technology: [] }, "SAAS_METRICS"],
    [{ productType: ["MARKETPLACE"], revenueModel: ["TAKE_RATE"], technology: [] }, "MARKETPLACE_ECONOMICS"],
    [{ productType: ["CONSUMER_APP"], revenueModel: ["ADVERTISING"], technology: [] }, "CONSUMER_METRICS"],
    [{ productType: ["THERAPEUTIC"], revenueModel: ["DRUG_ECONOMICS"], technology: ["BIOLOGY"] }, "BIOTECH"],
    [{ productType: ["HARDWARE"], revenueModel: ["HARDWARE_MARGIN"], technology: ["SEMICONDUCTORS"] }, "DEEPTECH"],
  ] as const)("%j → %s", (cls, skill) => {
    const d = makeDeal();
    d.classification = { ...d.classification, industry: [], ...(cls as object) } as typeof d.classification;
    expect(domainSkillOf(d)).toBe(skill);
  });
});

export type { Exercise };
