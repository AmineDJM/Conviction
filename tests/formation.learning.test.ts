/**
 * Formation learning model: Glicko skill updates, adaptive difficulty,
 * calibration math, weakness detection, mistake library, investor development,
 * the journal, and the absence of gamification.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { expectedScore, initialProfile, INITIAL_RATING, isExpert, replayProfile, RD_MAX, targetDifficulty, updateSkill, inflateRd, band, EXPERT_RATING } from "@/formation/skill-model";
import { brierScore, calibration } from "@/formation/calibration";
import { kendallTauB, mastery, median } from "@/formation/mastery";
import { detectWeaknesses, conceptStats, MIN_OPPORTUNITIES } from "@/formation/weaknesses";
import { classifyMistakes, mistakeLibrary } from "@/formation/mistakes";
import { tendencies, MIN_DECISIONS } from "@/formation/development";
import { selectNext } from "@/formation/selection";
import { buildJournal, journalEntry, type CompanyTimeline } from "@/formation/journal";
import { levelToDifficulty } from "@/formation/exercise";
import type { Exercise, Grade } from "@/formation/types";
import { attempt, caseFrom, cleanDeal, exercisesOf, kindOf, leakyGrowthDeal, makeDeal, rubric, simpleGrade, withAnalysis } from "./formation.helpers";

describe("Glicko skill model", () => {
  it("expected score is 0.5 at equal rating and difficulty and increases with rating", () => {
    expect(expectedScore(1300, 1300)).toBeCloseTo(0.5, 9);
    expect(expectedScore(1400, 1300)).toBeGreaterThan(expectedScore(1300, 1300));
  });
  it.each([0, 0.25, 0.5, 0.75])("posterior rating is strictly increasing in the score (s=%d → s+0.25)", (s) => {
    expect(updateSkill(1200, 200, 1300, s + 0.25).rating).toBeGreaterThan(updateSkill(1200, 200, 1300, s).rating);
  });
  it("a score above expectation raises the rating, below lowers it", () => {
    const E = expectedScore(1200, 1200);
    expect(updateSkill(1200, 200, 1200, E + 0.2).rating).toBeGreaterThan(1200);
    expect(updateSkill(1200, 200, 1200, E - 0.2).rating).toBeLessThan(1200);
  });
  it("uncertainty shrinks with every observation", () => {
    let rd = RD_MAX;
    for (let i = 0; i < 10; i++) {
      const u = updateSkill(1200, rd, 1200, 0.5);
      expect(u.rd).toBeLessThan(rd);
      rd = u.rd;
    }
  });
  it("a hard item solved moves the rating more than an easy one", () => {
    expect(updateSkill(1200, 200, 1600, 1).delta).toBeGreaterThan(updateSkill(1200, 200, 1000, 1).delta);
  });
  it("secondary skills move half as much", () => {
    expect(updateSkill(1200, 200, 1300, 1, 0.5).delta).toBeLessThan(updateSkill(1200, 200, 1300, 1).delta);
  });
  it("inactivity inflates uncertainty, capped at RD_MAX", () => {
    expect(inflateRd(60, 30)).toBeGreaterThan(60);
    expect(inflateRd(60, 10_000)).toBe(RD_MAX);
  });
  it("replay is deterministic and order-independent of input order", () => {
    const obs = [
      { at: "2026-09-02T00:00:00Z", skills: ["SAAS_METRICS" as const], difficulty: 1200, score: 1 },
      { at: "2026-09-01T00:00:00Z", skills: ["SAAS_METRICS" as const], difficulty: 1200, score: 0 },
    ];
    expect(replayProfile(obs).profile.SAAS_METRICS.rating).toBe(replayProfile([...obs].reverse()).profile.SAAS_METRICS.rating);
    expect(replayProfile(obs).profile.SAAS_METRICS.n).toBe(2);
  });
  it("sustained success rises monotonically and settles into bands", () => {
    let prof = initialProfile().RETURN_MODELING;
    const bands: string[] = [];
    for (let i = 0; i < 25; i++) {
      const u = updateSkill(prof.rating, prof.rd, levelToDifficulty(Math.min(5, 1 + Math.floor(i / 5))), 1);
      expect(u.rating).toBeGreaterThan(prof.rating);
      prof = { ...prof, rating: u.rating, rd: u.rd, n: prof.n + 1 };
      bands.push(band(prof));
    }
    expect(bands[bands.length - 1]).not.toBe("Foundational");
  });
  it("expert mode needs three skills above the expert rating with settled uncertainty", () => {
    const p = initialProfile();
    expect(isExpert(p)).toBe(false);
    for (const s of ["SAAS_METRICS", "RETURN_MODELING", "DECK_FORENSICS"] as const) p[s] = { ...p[s], rating: EXPERT_RATING + 10, rd: 100, n: 20 };
    expect(isExpert(p)).toBe(true);
  });
  it("target difficulty sits below the rating so expected success ≈ 0.6, and rises with it", () => {
    expect(expectedScore(1300, targetDifficulty(1300))).toBeCloseTo(0.6, 6);
    expect(targetDifficulty(1500)).toBeGreaterThan(targetDifficulty(1300));
  });
});

describe("adaptive difficulty", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  const pool = [...exercisesOf(c), ...exercisesOf(caseFrom(leakyGrowthDeal())), ...exercisesOf(caseFrom(makeDeal()))];
  it("selected difficulty rises as the user keeps succeeding", () => {
    const history: ReturnType<typeof attempt>[] = [];
    const picked: number[] = [];
    for (let i = 0; i < 30; i++) {
      const { profile } = replayProfile(history.map((a) => ({ at: a.answeredAt, skills: a.exercise.skills, difficulty: a.exercise.difficulty, score: 1 })));
      const sel = selectNext(pool, history, profile, [], [], { seed: String(i) })!;
      picked.push(sel.exercise.difficulty);
      history.push(attempt(sel.exercise, { type: "numeric", value: "1" }, simpleGrade(1)));
    }
    const early = picked.slice(0, 8).reduce((a, b) => a + b, 0) / 8;
    const late = picked.slice(-8).reduce((a, b) => a + b, 0) / 8;
    expect(late).toBeGreaterThan(early);
  });
  it("a new user starts on foundational items", () => {
    const sel = selectNext(pool, [], initialProfile(), [], [], { seed: "0" })!;
    expect(sel.exercise.level).toBeLessThanOrEqual(3);
  });
  it("does not repeat an answered exercise while others remain", () => {
    const first = selectNext(pool, [], initialProfile(), [], [], { seed: "x" })!.exercise;
    const second = selectNext(pool, [attempt(first, { type: "numeric", value: "1" }, simpleGrade(1))], initialProfile(), [], [], { seed: "x" })!.exercise;
    expect(second.id).not.toBe(first.id);
  });
  it("case and kind filters restrict the pool", () => {
    const sel = selectNext(pool, [], initialProfile(), [], [], { caseId: c.ref.companyId, kind: "DECISION" })!;
    expect(sel.exercise.case.companyId).toBe(c.ref.companyId);
    expect(sel.exercise.kind).toBe("DECISION");
  });
  it("an explicit drill restricts the selection to that mistake's material", () => {
    const sel = selectNext(pool, [], initialProfile(), [], [], { drill: "IGNORED_CHURN" })!;
    expect(sel.drill).toBe("IGNORED_CHURN");
    expect(["MCQ_CONCERN", "MCQ_PMF_SIGNAL", "BULL_BEAR", "DECISION"].includes(sel.exercise.kind) || sel.exercise.key.concepts.includes("RETENTION_RISK")).toBe(true);
    expect(sel.reason).toMatch(/Targeted drill/);
  });
  it("recurring mistakes periodically trigger a drill", () => {
    const hist = [0, 1, 2].map(() => attempt(pool[0]!, { type: "numeric", value: "1" }, simpleGrade(0)));
    const lib = mistakeLibrary([1, 2].map((i) => ({ kind: "OVERVALUED_TAM" as const, attemptId: `a${i}`, companyId: "c", caseName: "X", exerciseTitle: "t", at: `2026-09-0${i}`, evidence: "e" })));
    const sel = selectNext(pool, hist, initialProfile(), [], lib, { seed: "s" })!;
    expect(sel.drill).toBe("OVERVALUED_TAM");
  });
  it("expert mode prefers expert items", () => {
    const sel = selectNext(pool, [], initialProfile(), [], [], { expertMode: true, seed: "e" })!;
    expect(sel.expertMode).toBe(true);
  });
});

describe("calibration math", () => {
  it("Brier score of perfect forecasts is 0, of always-50% is 0.25", () => {
    expect(brierScore([{ confidence: 1, correct: true }, { confidence: 0, correct: false }])).toBe(0);
    expect(brierScore([{ confidence: 0.5, correct: true }, { confidence: 0.5, correct: false }])).toBe(0.25);
  });
  it("hand-computed example", () => {
    const pts = [
      { confidence: 0.9, correct: true },
      { confidence: 0.9, correct: false },
      { confidence: 0.6, correct: true },
      { confidence: 0.3, correct: false },
    ];
    expect(brierScore(pts)).toBeCloseTo((0.01 + 0.81 + 0.16 + 0.09) / 4, 12);
    const r = calibration(pts);
    expect(r.hitRate).toBe(0.5);
    expect(r.meanConfidence).toBeCloseTo(0.675, 12);
    expect(r.overconfidence).toBeCloseTo(0.175, 12);
    expect(r.brierReference).toBe(0.25);
    expect(r.brierSkill).toBeCloseTo(1 - r.brier! / 0.25, 12);
  });
  it("reliability bins partition the points", () => {
    const pts = Array.from({ length: 50 }, (_, i) => ({ confidence: i / 49, correct: i % 3 === 0 }));
    const r = calibration(pts);
    expect(r.bins.reduce((a, b) => a + b.n, 0)).toBe(50);
    expect(r.bins.length).toBe(5);
  });
  it("Murphy decomposition: BS = reliability − resolution + uncertainty (exact when confidences are constant within bins)", () => {
    const pts = [
      ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.9, correct: i < 7 })),
      ...Array.from({ length: 10 }, (_, i) => ({ confidence: 0.3, correct: i < 4 })),
    ];
    const r = calibration(pts);
    expect(r.brier!).toBeCloseTo(r.reliability! - r.resolution! + r.uncertainty!, 12);
  });
  it("empty input yields nulls, never NaN", () => {
    const r = calibration([]);
    expect(r.brier).toBeNull();
    expect(r.overconfidence).toBeNull();
  });
});

describe("mastery metrics", () => {
  it("Kendall τ-b: identical order 1, reversed −1", () => {
    expect(kendallTauB([0, 1, 2, 3], [0, 1, 2, 3])).toBeCloseTo(1, 12);
    expect(kendallTauB([0, 1, 2, 3], [3, 2, 1, 0])).toBeCloseTo(-1, 12);
    expect(kendallTauB([0, 1], [0, 1])).toBeNull();
  });
  it("median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
  it("numerical accuracy, question efficiency and improvement are computed from graded attempts", () => {
    const c = caseFrom(withAnalysis(cleanDeal()));
    const e = kindOf(c, "NUMERIC", "RUNWAY");
    const atts = [0.2, 0.3, 0.4, 0.8, 0.9, 1].map((s, i) => attempt(e, { type: "numeric", value: "1" }, simpleGrade(s, { numeric: { given: 1, expected: 1, relError: i < 3 ? 0.5 : 0.01 } })));
    const m = mastery(atts);
    expect(m.numericalAccuracy.withinTolerance).toBeCloseTo(0.5, 9);
    expect(m.improvement.delta!).toBeGreaterThan(0);
    expect(m.improvement.series.length).toBe(6);
  });
});

function missedObs(ex: Exercise, concept: "RETENTION_RISK" | "MARKET_SIZE_INFLATION", outcome: "MISSED" | "CAUGHT"): Grade {
  return simpleGrade(outcome === "MISSED" ? 0 : 1, { observations: [{ concept, outcome }] });
}

describe("weakness detection requires repeated evidence", () => {
  const ex = kindOf(caseFrom(leakyGrowthDeal()), "MCQ_CONCERN");
  const ans = { type: "choice" as const, optionId: "A" };
  it("one or two misses never make a weakness", () => {
    expect(detectWeaknesses([attempt(ex, ans, missedObs(ex, "RETENTION_RISK", "MISSED"))])).toEqual([]);
    expect(detectWeaknesses([0, 1].map(() => attempt(ex, ans, missedObs(ex, "RETENTION_RISK", "MISSED"))))).toEqual([]);
  });
  it(`three misses in ${MIN_OPPORTUNITIES} opportunities do, with counts in the statement`, () => {
    const atts = ["MISSED", "MISSED", "CAUGHT", "MISSED"].map((o) => attempt(ex, ans, missedObs(ex, "RETENTION_RISK", o as "MISSED")));
    const w = detectWeaknesses(atts);
    expect(w.length).toBe(1);
    expect(w[0]!.statement).toMatch(/underweights retention risk — missed in 3 of 4/);
    expect(w[0]!.cases).toContain("Leaky Growth");
  });
  it("mostly-caught concepts are not weaknesses even with 3 misses", () => {
    const atts = [...Array(3).fill("MISSED"), ...Array(7).fill("CAUGHT")].map((o) => attempt(ex, ans, missedObs(ex, "RETENTION_RISK", o)));
    expect(detectWeaknesses(atts)).toEqual([]);
    expect(conceptStats(atts)[0]!.n).toBe(10);
  });
  it("ungraded attempts are ignored", () => {
    expect(conceptStats([attempt(ex, ans, null), attempt(ex, ans, null)])).toEqual([]);
  });
});

describe("mistake library", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  it("ignored churn from a missed retention concept, with evidence", () => {
    const ex = kindOf(caseFrom(leakyGrowthDeal()), "MCQ_CONCERN");
    const ms = classifyMistakes(attempt(ex, { type: "choice", optionId: "A" }, missedObs(ex, "RETENTION_RISK", "MISSED")));
    expect(ms.map((x) => x.kind)).toContain("IGNORED_CHURN");
    expect(ms[0]!.evidence.length).toBeGreaterThan(10);
  });
  it("overvalued TAM from a missed market-size concept", () => {
    const ex = kindOf(c, "OPEN_TWENTY_X");
    expect(classifyMistakes(attempt(ex, { type: "text", text: "x" }, missedObs(ex, "MARKET_SIZE_INFLATION", "MISSED"))).map((x) => x.kind)).toContain("OVERVALUED_TAM");
  });
  it("pedigree reliance from the rubric", () => {
    const ex = kindOf(c, "DECISION");
    const g = simpleGrade(0.5, { rubric: rubric({ pedigreeReliance: true }) });
    expect(classifyMistakes(attempt(ex, { type: "decision", decision: "IC", justification: "Stanford founders" }, g)).map((x) => x.kind)).toContain("OVERWEIGHTED_PEDIGREE");
  });
  it("growth confused with PMF on a wrong PMF-signal answer", () => {
    const ex = kindOf(caseFrom(makeDeal()), "MCQ_PMF_SIGNAL");
    expect(classifyMistakes(attempt(ex, { type: "choice", optionId: "A" }, simpleGrade(0))).map((x) => x.kind)).toContain("CONFUSED_GROWTH_WITH_PMF");
  });
  it("calculation error and confident error on numeric misses", () => {
    const ex = kindOf(c, "NUMERIC", "RUNWAY");
    const ms = classifyMistakes(attempt(ex, { type: "numeric", value: "20" }, simpleGrade(0, { numeric: { given: 20, expected: 8.6, relError: 1.3 } }), { confidence: 0.9 }));
    expect(ms.map((x) => x.kind)).toEqual(expect.arrayContaining(["MATH_ERROR", "OVERCONFIDENT_ERROR"]));
  });
  it("redundant founder questions", () => {
    const ex = kindOf(c, "FOUNDER_QUESTIONS");
    const g = simpleGrade(0.1, { questions: [{ question: "What is your ARR?", impact: 0.3, redundant: true, redundantWith: "x", infoGain: 0.2, matched: null, score: 0.03 }] });
    expect(classifyMistakes(attempt(ex, { type: "questions", questions: ["What is your ARR?"] }, g)).map((x) => x.kind)).toContain("ASKED_WHAT_DECK_ANSWERED");
  });
  it("passing on a technical advantage the analysis rates as an outlier", () => {
    const ex = kindOf(c, "DECISION");
    expect(classifyMistakes(attempt(ex, { type: "decision", decision: "PASS", justification: "too early" }, simpleGrade(0.3, { rubric: rubric() }))).map((x) => x.kind)).toContain("PASSED_ON_TECH_ADVANTAGE");
  });
  it("more negative / more positive than the analysis", () => {
    const ex = kindOf(c, "DECISION");
    const bucket = ex.key.decisionBucket!;
    expect(bucket).toBe("CONTINUE_DD");
    expect(classifyMistakes(attempt(ex, { type: "decision", decision: "PASS", justification: "x" }, simpleGrade(0.3, { rubric: rubric() }))).map((x) => x.kind)).toContain("TOO_CONSERVATIVE");
  });
  it("a good answer produces no mistakes", () => {
    const ex = kindOf(c, "NUMERIC", "RUNWAY");
    expect(classifyMistakes(attempt(ex, { type: "numeric", value: "8.6" }, simpleGrade(1, { numeric: { given: 8.6, expected: 8.57, relError: 0.003 } }), { confidence: 0.9 }))).toEqual([]);
  });
  it("the library aggregates, sorts by count and marks recurring at two occurrences", () => {
    const lib = mistakeLibrary([
      { kind: "IGNORED_CHURN", attemptId: "a", companyId: "c", caseName: "A", exerciseTitle: "t", at: "2026-09-01", evidence: "e" },
      { kind: "IGNORED_CHURN", attemptId: "b", companyId: "c", caseName: "B", exerciseTitle: "t", at: "2026-09-02", evidence: "e" },
      { kind: "MATH_ERROR", attemptId: "c", companyId: "c", caseName: "A", exerciseTitle: "t", at: "2026-09-03", evidence: "e" },
    ]);
    expect(lib[0]!.kind).toBe("IGNORED_CHURN");
    expect(lib[0]!.recurring).toBe(true);
    expect(lib[0]!.cases).toEqual(["A", "B"]);
    expect(lib[1]!.recurring).toBe(false);
  });
});

describe("investor development: evidence-based tendencies only", () => {
  const c = caseFrom(withAnalysis(cleanDeal()));
  const ex = kindOf(c, "DECISION");
  it(`below ${MIN_DECISIONS} decisions the posture reads "not enough evidence yet"`, () => {
    const t = tendencies([attempt(ex, { type: "decision", decision: "PASS", justification: "x" }, simpleGrade(0.3))], initialProfile());
    const posture = t.find((x) => x.id === "posture")!;
    expect(posture.status).toBe("INSUFFICIENT");
    expect(posture.statement).toMatch(/Not enough evidence yet — 1 of 5/);
  });
  it("repeated passes on deals the analysis keeps alive → more conservative, with counts and examples", () => {
    const atts = Array.from({ length: 6 }, () => attempt(ex, { type: "decision", decision: "PASS", justification: "x" }, simpleGrade(0.3)));
    const posture = tendencies(atts, initialProfile()).find((x) => x.id === "posture")!;
    expect(posture.status).toBe("EVIDENCED");
    expect(posture.statement).toMatch(/More conservative than the analysis: below its call in 6 of 6/);
    expect(posture.examples.length).toBeGreaterThan(0);
  });
  it("no strengths are claimed without enough attempts", () => {
    const t = tendencies([], initialProfile());
    expect(t.filter((x) => x.status === "EVIDENCED")).toEqual([]);
  });
  it("strengths need five attempts and a high average", () => {
    const p = initialProfile();
    p.RETURN_MODELING = { ...p.RETURN_MODELING, n: 6, meanScore: 0.9, rating: 1450 };
    expect(tendencies([], p).some((x) => x.statement.startsWith("Strong on return modeling"))).toBe(true);
  });
});

describe("investor journal", () => {
  const c = caseFrom(withAnalysis(cleanDeal()), { companyId: "co_j", versionId: "ver_1" });
  const ex = kindOf(c, "DECISION");
  const base: CompanyTimeline = {
    companyId: "co_j",
    name: c.ref.name,
    slug: c.ref.slug,
    icDecision: "PENDING",
    icDecidedAt: null,
    executionStatus: "NOT_STARTED",
    versions: [{ id: "ver_1", versionNo: 1, createdAt: "2026-09-01T00:00:00Z", reason: "DECK_ANALYSIS", recommendation: "NEEDS_TARGETED_DILIGENCE", metrics: { arr: 3_840_000, paying_customers: 92 } }],
    answeredQuestions: [],
  };
  const a = attempt(ex, { type: "decision", decision: "PASS", justification: "retention unproven" }, simpleGrade(0.3), { at: "2026-09-05T00:00:00Z" });
  it("records what was believed, with confidence and the analysis at the time", () => {
    const j = journalEntry(a, base);
    expect(j.belief).toMatch(/^Pass — retention unproven/);
    expect(j.decision).toBe("PASS");
    expect(j.analysisAtTime).toBe("CONTINUE_DD");
  });
  it("shows a divergence when IC later approves a deal you passed on", () => {
    const j = journalEntry(a, { ...base, icDecision: "APPROVED", icDecidedAt: "2026-09-20T00:00:00Z" });
    expect(j.since.find((d) => d.kind === "IC")).toMatchObject({ tone: "diverge" });
  });
  it("an IC decision taken before your answer is not a later outcome", () => {
    const j = journalEntry(a, { ...base, icDecision: "APPROVED", icDecidedAt: "2026-09-02T00:00:00Z" });
    expect(j.since.some((d) => d.kind === "IC")).toBe(false);
  });
  it("shows company progress and analysis changes on later versions", () => {
    const t: CompanyTimeline = { ...base, versions: [...base.versions, { id: "ver_2", versionNo: 2, createdAt: "2026-09-25T00:00:00Z", reason: "FOUNDER_CALL", recommendation: "WATCH", metrics: { arr: 4_500_000, paying_customers: 92 } }] };
    const j = journalEntry(a, t);
    expect(j.since.find((d) => d.kind === "PROGRESS")!.text).toMatch(/ARR: \$3\.84M → \$4\.50M \(\+17%\)/);
    expect(j.since.find((d) => d.kind === "ANALYSIS")!.text).toMatch(/continue diligence” to “watch/);
  });
  it("founder meeting answers after the belief are compared with your questions", () => {
    const qex = kindOf(c, "FOUNDER_QUESTIONS");
    const qa = attempt(qex, { type: "questions", questions: ["What is retention by cohort?", "Who are your competitors?", "Burn?"] }, simpleGrade(0.5), { at: "2026-09-05T00:00:00Z" });
    const t = { ...base, answeredQuestions: [{ id: "Q-01", question: "Can you share retention by cohort?", answer: "NRR 112% on the 2024 cohort", status: "RESOLVED", answeredAt: "2026-09-10T00:00:00Z" }] };
    const j = journalEntry(qa, t);
    expect(j.since.find((d) => d.kind === "FOUNDER_MEETING")!.text).toMatch(/1 of your 3 were on the same topics/);
  });
  it("entries are newest first", () => {
    const b = attempt(ex, { type: "decision", decision: "IC", justification: "x" }, simpleGrade(0.3), { at: "2026-09-06T00:00:00Z" });
    expect(buildJournal([a, b], [base]).map((x) => x.attemptId)).toEqual([b.id, a.id]);
  });
});

describe("mastery, not gamification", () => {
  const files = [
    ...fs.readdirSync(path.join(process.cwd(), "src/formation")).map((f) => path.join("src/formation", f)),
    ...fs.readdirSync(path.join(process.cwd(), "src/components/formation")).map((f) => path.join("src/components/formation", f)),
    "src/app/(app)/formation/page.tsx",
    "src/app/(app)/formation/practice/page.tsx",
    "src/app/(app)/formation/journal/page.tsx",
    "src/app/(app)/formation/mistakes/page.tsx",
  ];
  it.each(files)("%s has no points, streaks, confetti, XP, leaderboards or trophies", (f) => {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8").toLowerCase();
    for (const w of ["streak", "confetti", " xp", "leaderboard", "trophy", "achievement unlocked", "level up", "🎉", "🔥", "points earned", "earn points"]) expect(src, `${f}: ${w}`).not.toContain(w);
  });
  it("the rating is never shown as a score to chase: bands and uncertainty accompany it", () => {
    expect(band({ skill: "PMF", rating: INITIAL_RATING, rd: RD_MAX, n: 0, lastAt: null, meanScore: null })).toBe("Not assessed");
  });
});
