/**
 * FOUNDER QUESTION TRAINING — "You have three questions for the founder."
 *
 * Each question is scored deterministically on:
 *  - redundancy: a value question ("What is your NRR?") on a topic the deck
 *    already answers scores near zero; probing the same topic ("How is NRR
 *    defined, by cohort?") is not redundant;
 *  - decision impact: best match against the question bank built from the
 *    analysis — founder questions (tier, if-A/if-B), the reversing question,
 *    sensitivity drivers and founder-only information gaps;
 *  - information gain: how uncertain the underlying fact is today.
 *
 *   questionScore = redundant ? 0.1 × impact : impact × (0.5 + 0.5 × infoGain)
 *   exerciseScore = mean(questionScores) − 0.15 per duplicate-topic question
 *   efficiency    = share of questions that are non-redundant with score ≥ 0.5
 */
import type { TrainingCase } from "./case";
import { deckReportedMetrics } from "./case";
import { caseLine, emptyKey, makeExercise } from "./exercise";
import { aiSummary, expertFocus } from "./reveal";
import { contentTokens, isShallowValueQuestion, jaccard, TOPICS, topicsOf } from "./topics";
import type { Concept, Exercise, Grade, QuestionBankItem } from "./types";
import { CORRECT_THRESHOLD } from "./types";

const TIER_IMPACT = { MUST_ASK: 1, IMPORTANT: 0.7, OPTIONAL: 0.4 } as const;

export function questionBank(c: TrainingCase): QuestionBankItem[] {
  const d = c.deal;
  const bank: QuestionBankItem[] = [];
  for (const q of d.questions) {
    const impact = Math.min(1, TIER_IMPACT[q.tier] + (q.affects.includes("RECOMMENDATION") ? 0.1 : 0));
    // A question the founder already answered fully is no longer uncertain.
    const uncertainty = q.status === "RESOLVED" ? 0.3 : 0.8;
    bank.push({ id: q.id, question: q.question, impact, uncertainty, topics: topicsOf(`${q.question} ${q.whyItMatters}`), source: "FOUNDER_QUESTION", ifA: q.ifAnswerA, ifB: q.ifAnswerB });
  }
  if (d.decisionCore?.reversingQuestion) {
    const r = d.decisionCore.reversingQuestion;
    bank.push({ id: "REVERSING", question: r.question, impact: 1, uncertainty: 0.9, topics: topicsOf(r.question), source: "REVERSING_QUESTION", ifA: r.ifFavorable, ifB: r.ifUnfavorable });
  }
  d.sensitivityDrivers.forEach((s, i) =>
    bank.push({ id: `SENS-${i + 1}`, question: `${s.variable}: current assumption ${s.currentAssumption}; breaks at ${s.breaksAt}`, impact: 0.8, uncertainty: 0.7, topics: topicsOf(`${s.variable} ${s.metricKey ?? ""} ${s.why}`), source: "SENSITIVITY", ifA: null, ifB: `Thesis breaks at ${s.breaksAt}` }),
  );
  for (const g of d.informationGaps)
    if ((g.researchability === "FOUNDER_ONLY" || g.researchability === "BOTH") && g.status !== "RESOLVED")
      bank.push({ id: g.id, question: g.question, impact: Math.min(1, Math.max(0.2, g.decisionImportance / 5)), uncertainty: Math.min(1, Math.max(0.2, g.uncertainty / 5)), topics: topicsOf(`${g.question} ${g.whyItMatters}`), source: "GAP", ifA: null, ifB: null });
  return bank.sort((a, b) => b.impact * b.uncertainty - a.impact * a.uncertainty || (a.id < b.id ? -1 : 1));
}

/** Topics the deck already answers with a stated number or term. */
export function answeredTopics(c: TrainingCase): Set<string> {
  const keys = new Set(deckReportedMetrics(c.deal).map((m) => m.metricKey));
  const facts = new Set(c.facts.map((f) => f.id));
  const out = new Set<string>();
  for (const t of TOPICS) if (t.metricKeys.some((k) => keys.has(k)) || t.factIds.some((id) => facts.has(id))) out.add(t.id);
  return out;
}

/** Topics whose deck numbers carry quality flags (undefined, no sample …) — probing them has high information gain. */
function shakyTopics(c: TrainingCase): Set<string> {
  const flagged = new Set(c.deal.metrics.filter((m) => m.qualityFlags.length > 0).map((m) => m.metricKey));
  const out = new Set<string>();
  for (const t of TOPICS) if (t.metricKeys.some((k) => flagged.has(k))) out.add(t.id);
  return out;
}

const TOPIC_CONCEPT: Record<string, Concept> = {
  retention: "RETENTION_RISK",
  cac: "UNIT_ECONOMICS",
  burn: "RUNWAY_FINANCING",
  revenue: "METRIC_DEFINITION",
  growth: "GROWTH_QUALITY",
  pricing: "UNIT_ECONOMICS",
  margin: "UNIT_ECONOMICS",
  concentration: "CUSTOMER_CONCENTRATION",
  pilots: "CUSTOMER_QUALITY",
  founder_sales: "FOUNDER_DEPENDENCE",
  market: "MARKET_SIZE_INFLATION",
  valuation: "ENTRY_PRICE",
  competition: "COMPETITION",
  product: "TECHNICAL_ADVANTAGE",
};

export interface QuestionScore {
  question: string;
  topics: string[];
  impact: number;
  redundant: boolean;
  redundantWith: string | null;
  infoGain: number;
  matched: string | null;
  duplicate: boolean;
  score: number;
}

export function scoreQuestion(q: string, bank: QuestionBankItem[], answered: Set<string>, shaky: Set<string>, topConcernTopics: Set<string>): QuestionScore {
  const topics = topicsOf(q);
  const tokens = contentTokens(q);
  let best: { item: QuestionBankItem; sim: number } | null = null;
  for (const item of bank) {
    const topicSim = topics.length && item.topics.length ? jaccard(topics, item.topics) : 0;
    const sim = 0.6 * topicSim + 0.4 * jaccard(tokens, contentTokens(item.question));
    if (!best || sim > best.sim) best = { item, sim };
  }
  const matched = best && best.sim >= 0.25 ? best : null;
  const answeredTopic = topics.find((t) => answered.has(t)) ?? null;
  const redundant = !!answeredTopic && isShallowValueQuestion(q) && !topics.some((t) => shaky.has(t));
  let impact: number;
  if (matched) impact = matched.item.impact * Math.min(1, matched.sim / 0.5);
  else impact = topics.some((t) => topConcernTopics.has(t)) ? 0.6 : topics.length ? 0.3 : 0.15;
  impact = Math.max(impact, topics.some((t) => topConcernTopics.has(t)) ? 0.6 : 0);
  let infoGain: number;
  if (matched) infoGain = matched.item.uncertainty;
  else if (!topics.length) infoGain = 0.3;
  else if (topics.every((t) => answered.has(t))) infoGain = topics.some((t) => shaky.has(t)) ? 0.6 : 0.25;
  else infoGain = 0.7;
  const score = redundant ? 0.1 * impact : impact * (0.5 + 0.5 * infoGain);
  return {
    question: q,
    topics,
    impact: round(impact),
    redundant,
    redundantWith: redundant ? `The deck already states this (${answeredTopic}).` : null,
    infoGain: round(infoGain),
    matched: matched ? matched.item.question : null,
    duplicate: false,
    score: round(Math.min(1, score)),
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

export function concernTopics(c: TrainingCase): Set<string> {
  const top = c.concerns.slice(0, 2);
  const out = new Set<string>();
  for (const x of top) for (const t of TOPICS) if (t.metricKeys.includes(x.metricKey)) out.add(t.id);
  return out;
}

export function gradeFounderQuestions(questions: string[], c: TrainingCase, bank: QuestionBankItem[]): Grade {
  const answered = answeredTopics(c);
  const shaky = shakyTopics(c);
  const top = concernTopics(c);
  const qs = questions.map((q) => q.trim()).filter(Boolean).slice(0, 3);
  const seen = new Set<string>();
  const scored = qs.map((q) => {
    const s = scoreQuestion(q, bank, answered, shaky, top);
    const main = s.topics[0];
    if (main && seen.has(main) && s.topics.every((t) => seen.has(t))) {
      s.duplicate = true;
      s.score = round(Math.max(0, s.score - 0.15));
    }
    for (const t of s.topics) seen.add(t);
    return s;
  });
  const n = 3;
  const score = round(scored.reduce((a, s) => a + s.score, 0) / n);
  const efficiency = scored.filter((s) => !s.redundant && s.score >= 0.5).length / n;
  const observations: Grade["observations"] = [{ concept: "QUESTION_TARGETING", outcome: score >= CORRECT_THRESHOLD - 0.1 ? "CAUGHT" : "MISSED" }];
  const topItem = bank[0];
  if (topItem) {
    const concept = topItem.topics.map((t) => TOPIC_CONCEPT[t]).find(Boolean);
    const hit = scored.some((s) => s.matched === topItem.question || s.topics.some((t) => topItem.topics.includes(t)));
    if (concept) observations.push({ concept, outcome: hit ? "CAUGHT" : "MISSED" });
  }
  const redundantCount = scored.filter((s) => s.redundant).length;
  return {
    score,
    correct: score >= CORRECT_THRESHOLD - 0.1,
    method: "QUESTION_SCORING",
    summary: `Question efficiency ${Math.round(efficiency * 100)}% · ${redundantCount} redundant · mean decision impact ${(scored.reduce((a, s) => a + s.impact, 0) / Math.max(1, scored.length)).toFixed(2)}`,
    details: scored.map((s, i) => `Q${i + 1}: ${s.redundant ? "already answered by the deck" : s.matched ? `closest high-value question: “${s.matched.slice(0, 140)}”` : "no close match in the decision-critical question bank"} — impact ${s.impact.toFixed(2)}, information gain ${s.infoGain.toFixed(2)}${s.duplicate ? ", repeats an earlier topic" : ""} → ${s.score.toFixed(2)}`),
    observations,
    rubric: null,
    numeric: null,
    questions: scored.map((s) => ({ question: s.question, impact: s.impact, redundant: s.redundant, redundantWith: s.redundantWith, infoGain: s.infoGain, matched: s.matched, score: s.score })),
    decisionDistance: null,
  };
}

export function founderQuestionsExercise(c: TrainingCase): Exercise | null {
  const bank = questionBank(c);
  if (bank.length < 3) return null;
  const key = emptyKey();
  key.questionBank = bank.slice(0, 12);
  const best = bank.slice(0, 3);
  key.answer = `The three highest-value questions: ${best.map((b, i) => `(${i + 1}) ${b.question}`).join(" ")}`;
  key.workedSolution = [
    "Score = decision impact × (0.5 + 0.5 × information gain); a question the deck already answers scores 10% of its impact.",
    ...best.map((b) => `${b.question} — impact ${b.impact.toFixed(2)}, uncertainty ${b.uncertainty.toFixed(2)}${b.ifA ? `. If A: ${b.ifA}` : ""}${b.ifB ? ` If B: ${b.ifB}` : ""}`),
  ];
  key.alternativeReasoning = ["Asking for a number the deck states wastes a question; asking how it is defined, measured or composed does not."];
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c, ["Ask the question whose answer would change what you do next — not the one that fills a spreadsheet cell."]);
  key.concepts = ["QUESTION_TARGETING"];
  key.evidence = [{ label: "Decision-tested founder questions", href: `/deals/${c.ref.slug}/questions` }];
  const context = c.facts.filter((f) => f.group !== "Claims").slice(0, 26);
  return makeExercise({
    c,
    kind: "FOUNDER_QUESTIONS",
    variant: "three",
    skills: ["FOUNDER_QUESTIONING", c.domainSkill],
    level: 3,
    patterns: c.patterns.filter((p) => p.pattern === "OBVIOUS_ANSWER_WRONG" || p.pattern === "CONFLICTING_METRICS").map((p) => p.pattern),
    title: "You have three questions for the founder",
    prompt: `${caseLine(c)}\n\nYou have 30 minutes with the founder and time for three questions. Everything the deck shows is below. Which three questions do you ask? Each should be one the deck does not answer and whose answer would change your decision.`,
    context,
    input: { type: "questions", count: 3 },
    key,
  });
}
