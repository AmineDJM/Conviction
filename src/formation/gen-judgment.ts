/**
 * Judgment exercises: investment decision, bull / bear construction, outlier
 * detection and open questions (thesis, next metric, pass trigger, what must
 * be true for 20×). Open answers are graded against key points built from the
 * analysis (critical risks, outlier signals, engine facts).
 */
import type { DecisionStatus } from "@/domain/enums";
import type { TrainingCase } from "./case";
import { caseLine, emptyKey, makeExercise } from "./exercise";
import { money } from "./format";
import { DECISION_LABEL_F } from "./labels";
import { outlierSignals } from "./patterns";
import { aiSummary, claimLink, expertFocus, links, riskAndOutlierPoints } from "./reveal";
import { DECISION_BUCKETS, type CasePattern, type DecisionBucket, type Exercise, type KeyPoint, type Skill } from "./types";

export function bucketOf(status: DecisionStatus | string | null | undefined): DecisionBucket | null {
  switch (status) {
    case "SCREEN_OUT":
    case "ANALYTICAL_RECOMMEND_PASS":
      return "PASS";
    case "WATCH":
      return "WATCH";
    case "NEEDS_FOUNDER_CALL":
    case "NEEDS_TARGETED_DILIGENCE":
    case "DEEP_DD":
      return "CONTINUE_DD";
    case "IC_READY":
    case "ANALYTICAL_RECOMMEND_INVEST":
      return "IC";
    default:
      return null;
  }
}

export const bucketRank = (b: DecisionBucket) => DECISION_BUCKETS.indexOf(b);

/** Facts for a whole-company judgment: traction, economics, financing, market, team, customers, then claims. */
function broadContext(c: TrainingCase, max = 22) {
  const order = ["Company", "Traction", "Economics", "Customers", "Financing", "Market", "Team", "Claims"];
  return [...c.facts].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group)).slice(0, max);
}

const expertPatternsOf = (c: TrainingCase): CasePattern[] => c.patterns.filter((p) => p.expert).map((p) => p.pattern);

export function decisionExercise(c: TrainingCase): Exercise | null {
  const bucket = bucketOf(c.derived.recommendation?.status);
  if (!bucket) return null;
  const key = emptyKey();
  key.decisionBucket = bucket;
  key.correctOptionIds = [bucket];
  key.keyPoints = riskAndOutlierPoints(c);
  const rec = c.derived.recommendation;
  key.answer = `The analysis says: ${DECISION_LABEL_F[bucket]}.`;
  key.workedSolution = [
    ...(rec?.rationale ? [rec.rationale] : []),
    ...(rec?.trace ?? []).filter((g) => g.outcome === "BLOCK" || g.outcome === "APPLIED").slice(0, 4).map((g) => `${g.outcome === "BLOCK" ? "Gate blocked" : "Gate applied"} — ${g.gate}: ${g.detail}`),
  ];
  if (!key.workedSolution.length) key.workedSolution = aiSummary(c);
  key.aiAnalysis = aiSummary(c);
  if (c.deal.redTeam) {
    key.alternativeReasoning.push(...c.deal.redTeam.caseAgainstPassing.slice(0, 2).map((x) => `Against passing: ${x}`));
    key.alternativeReasoning.push(...c.deal.redTeam.caseAgainstInvesting.slice(0, 2).map((x) => `Against investing: ${x}`));
  }
  key.expertFocus = expertFocus(c);
  key.concepts = [...new Set(key.keyPoints.filter((p) => p.critical && p.concept).map((p) => p.concept!))];
  key.evidence = links(...key.keyPoints.map((p) => (p.href ? { label: p.text.slice(0, 110), href: p.href } : null)));
  const patterns = expertPatternsOf(c);
  return makeExercise({
    c,
    kind: "DECISION",
    variant: "decision",
    skills: ["INVESTMENT_JUDGMENT", c.domainSkill],
    level: 3 + Math.min(1, Math.max(0, patterns.length - 1)),
    patterns,
    title: "Your decision",
    prompt: `${caseLine(c)}\n\nYou have read the deck. What do you do next — pass, watch, continue diligence, or take it to IC? Justify it in a few sentences: the facts that decide it, and what would change your mind.`,
    context: broadContext(c),
    input: { type: "decision", options: DECISION_BUCKETS.map((id) => ({ id, label: DECISION_LABEL_F[id] })) },
    key,
  });
}

export function bullBearExercise(c: TrainingCase): Exercise | null {
  const points = riskAndOutlierPoints(c);
  if (points.filter((p) => p.kind === "RISK").length < 2) return null;
  const key = emptyKey();
  key.keyPoints = [
    ...points,
    ...c.deal.whatILike.slice(0, 3).map((t, i) => ({ id: `L${i + 1}`, kind: "OUTLIER" as const, text: t, critical: false, concept: null, href: null })),
  ];
  key.answer = "The strongest case on each side, from the red team:";
  key.workedSolution = [
    ...(c.deal.redTeam?.caseAgainstPassing ?? []).slice(0, 3).map((x) => `Bull — ${x}`),
    ...(c.deal.redTeam?.caseAgainstInvesting ?? []).slice(0, 3).map((x) => `Bear — ${x}`),
  ];
  if (c.deal.redTeam?.passRegretScenario) key.alternativeReasoning.push(`Pass regret: ${c.deal.redTeam.passRegretScenario}`);
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c, ["A good bull case names the mechanism that makes the outcome nonlinear; a good bear case names the one fact that breaks it."]);
  key.concepts = [...new Set(points.filter((p) => p.critical && p.concept).map((p) => p.concept!))];
  key.evidence = links(...points.map((p) => (p.href ? { label: p.text.slice(0, 110), href: p.href } : null)));
  return makeExercise({
    c,
    kind: "BULL_BEAR",
    variant: "bullbear",
    skills: ["INVESTMENT_JUDGMENT", "RISK_DETECTION"],
    level: 3,
    patterns: expertPatternsOf(c).filter((p) => p === "CONFLICTING_METRICS" || p === "GREAT_COMPANY_BAD_PRICE"),
    title: "Build the bull and the bear case",
    prompt: `${caseLine(c)}\n\nWrite the best case for investing and the best case for passing. Each in three to five sentences, anchored in the numbers.`,
    context: broadContext(c),
    input: { type: "bullbear" },
    key,
  });
}

/** Outlier detection on imperfect companies: is anything exceptional enough to overlook the weaknesses? */
export function outlierExercise(c: TrainingCase): Exercise | null {
  const highRisks = c.deal.risks.filter((r) => r.severity === "HIGH" || r.severity === "CRITICAL").length;
  const highFindings = (c.derived.integrity?.findings ?? []).filter((f) => f.severity === "HIGH" || f.severity === "CRITICAL").length;
  const oqi = c.derived.operatingQuality?.value ?? null;
  const imperfect = highRisks >= 2 || highFindings >= 2 || (oqi !== null && oqi < 60);
  if (!imperfect) return null;
  const signals = outlierSignals(c.deal);
  const exceptional = signals.length > 0;
  // Candidate signals are deck facts; the ones cited by an exceptional strength are correct.
  const strongClaimIds = new Set(c.deal.exceptionalStrengths.filter((e) => e.rating === "STRONG" || e.rating === "EXCEPTIONAL").flatMap((e) => e.claimRefs));
  const candidates = c.facts.filter((f) => f.group === "Traction" || f.group === "Team" || f.group === "Economics" || (f.group === "Claims" && f.ref));
  const correct = candidates.filter((f) => f.ref?.kind === "claim" && strongClaimIds.has(f.ref.id));
  const pool = [...correct, ...candidates.filter((f) => !correct.includes(f))].slice(0, 8);
  const ordered = [...pool].sort((a, b) => (a.id < b.id ? -1 : 1));
  const opts = ordered.map((f, i) => ({ id: `G${i + 1}`, text: `${f.label}: ${f.value}` }));
  const key = emptyKey();
  key.correctOptionIds = [exceptional ? "YES" : "NO", ...ordered.map((f, i) => (correct.includes(f) ? opts[i]!.id : null)).filter((x): x is string => !!x)];
  key.keyPoints = riskAndOutlierPoints(c);
  key.answer = exceptional ? `Yes — ${signals.map((s) => s.text).join(" · ")}` : "No outlier signal the evidence supports yet — the analysis did not rate any strength as strong or exceptional.";
  key.workedSolution = [
    ...c.deal.exceptionalStrengths.map((e) => `${e.claim} — rated ${e.rating.toLowerCase().replace(/_/g, " ")}. Why it matters: ${e.whyItMatters} Invalidated by: ${e.invalidation}`),
    ...(c.deal.nonlinear ? [`Nonlinear outcome ${c.deal.nonlinear.outlierPlausible ? "plausible" : "not established"}: ${c.deal.nonlinear.outlierRationale}`] : []),
  ].slice(0, 6);
  if (c.deal.decisionCore?.asymmetricConviction) {
    const a = c.deal.decisionCore.asymmetricConviction;
    key.alternativeReasoning.push(`What the market sees: ${a.whatTheMarketSees}`, `Repairable weaknesses: ${a.repairableWeaknesses}`, `Exceptional and hard to copy: ${a.exceptionalAndHardToCopy}`);
  }
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c, ["Outliers rarely look clean: judge the strength that could make the outcome nonlinear, then ask whether the weaknesses are repairable."]);
  key.concepts = exceptional ? ["OUTLIER_SIGNAL"] : ["OUTLIER_SIGNAL"];
  key.evidence = links(...[...strongClaimIds].map((id) => claimLink(c, id)), { label: "Deal overview", href: `/deals/${c.ref.slug}` });
  return makeExercise({
    c,
    kind: "OUTLIER",
    variant: "outlier",
    skills: ["OUTLIER_DETECTION", c.domainSkill],
    level: 4,
    patterns: c.patterns.filter((p) => p.pattern === "POOR_LOOKING_WITH_OUTLIER" || p.pattern === "EXTRAORDINARY_FOUNDER_WEAK_TRACTION").map((p) => p.pattern),
    title: "Is anything here exceptional enough?",
    prompt: `${caseLine(c)}\n\nThis company has visible weaknesses. Is anything exceptional enough to overlook them? Answer yes or no, pick the signal(s) that carry your view, and explain what would make it nonlinear — or why nothing does.`,
    context: broadContext(c, 18),
    input: { type: "outlier", signals: opts },
    key,
  });
}

/* ---------------------------------------------------------------- */
/* Open questions                                                      */
/* ---------------------------------------------------------------- */

function openExercise(c: TrainingCase, kind: Exercise["kind"], title: string, question: string, points: KeyPoint[], level: number, skills: (Skill | null)[], worked: string[], focus: string[] = [], minWords = 40): Exercise | null {
  if (points.length < 2) return null;
  const key = emptyKey();
  key.keyPoints = points;
  key.answer = "What an answer should contain:";
  key.workedSolution = worked.length ? worked : points.map((p) => p.text);
  key.aiAnalysis = aiSummary(c);
  key.expertFocus = expertFocus(c, focus);
  key.concepts = [...new Set(points.filter((p) => p.critical && p.concept).map((p) => p.concept!))];
  key.evidence = links(...points.map((p) => (p.href ? { label: p.text.slice(0, 110), href: p.href } : null)));
  return makeExercise({
    c,
    kind,
    variant: kind.toLowerCase(),
    skills,
    level,
    patterns: expertPatternsOf(c).slice(0, 2),
    title,
    prompt: `${caseLine(c)}\n\n${question}`,
    context: broadContext(c),
    input: { type: "text", minWords, placeholder: "Write your answer. Numbers beat adjectives." },
    key,
  });
}

export function thesisExercise(c: TrainingCase): Exercise | null {
  const t = c.deal.thesis;
  const points: KeyPoint[] = [];
  if (t?.bet) points.push({ id: "T1", kind: "FACT", text: `The bet: ${t.bet}`, critical: true, concept: "RETURN_PATH", href: `/deals/${c.ref.slug}` });
  (t?.requiredConditions ?? []).slice(0, 3).forEach((rc, i) => points.push({ id: `T${i + 2}`, kind: "FACT", text: `Must be true: ${rc.condition} (${rc.status.toLowerCase().replace(/_/g, " ")})`, critical: i === 0, concept: null, href: null }));
  points.push(...riskAndOutlierPoints(c, 3));
  return openExercise(c, "OPEN_THESIS", "State your actual thesis", "In three sentences: what exactly would you be betting on, what must be true, and how does it return the fund?", points, 3, ["INVESTMENT_JUDGMENT", c.domainSkill], [
    ...(t ? [`Bet: ${t.bet}`, ...t.thesisPoints.map((p) => `• ${p}`), `Return path: ${t.returnPath}`] : []),
  ]);
}

export function nextMetricExercise(c: TrainingCase): Exercise | null {
  const items = c.derived.integrity?.expectedEvidence?.items ?? [];
  const missing = items.filter((i) => i.level === "EXPECTED" && i.presence !== "PRESENT");
  const points: KeyPoint[] = [
    ...missing.slice(0, 3).map((m, i) => ({ id: `M${i + 1}`, kind: "FACT" as const, text: `${m.label}${m.perfectSlide ? ` — ${m.perfectSlide}` : ""}`, critical: i === 0, concept: "MISSING_EVIDENCE" as const, href: `/deals/${c.ref.slug}/evidence` })),
    ...(c.deal.nextBestAction ? [{ id: "NBA", kind: "FACT" as const, text: `${c.deal.nextBestAction.action} — ${c.deal.nextBestAction.rationale}`, critical: true, concept: "QUESTION_TARGETING" as const, href: `/deals/${c.ref.slug}/questions` }] : []),
    ...c.deal.perfectSlides.slice(0, 2).map((p, i) => ({ id: `P${i + 1}`, kind: "FACT" as const, text: `${p.missing}: ${p.slide}`, critical: false, concept: "MISSING_EVIDENCE" as const, href: null })),
    ...c.deal.questions.filter((q) => q.tier === "MUST_ASK").slice(0, 2).map((q, i) => ({ id: `Q${i + 1}`, kind: "FACT" as const, text: q.question, critical: i === 0 && !c.deal.nextBestAction, concept: "QUESTION_TARGETING" as const, href: `/deals/${c.ref.slug}/questions` })),
  ];
  return openExercise(c, "OPEN_NEXT_METRIC", "The next metric you would request", "What is the single next metric or document you would request, exactly how should it be cut (period, cohort, definition), and what answer would change your decision?", points, 2, ["FOUNDER_QUESTIONING", c.domainSkill], [], ["Specify the cut: '12-month logo and revenue retention by quarterly cohort' beats 'retention data'."], 25);
}

export function passTriggerExercise(c: TrainingCase): Exercise | null {
  const d = c.deal;
  const points: KeyPoint[] = [];
  if (d.decisionCore?.compression.breakingPoint) points.push({ id: "B1", kind: "RISK", text: `Breaking point: ${d.decisionCore.compression.breakingPoint}`, critical: true, concept: null, href: `/deals/${c.ref.slug}` });
  d.falsification.slice(0, 2).forEach((f, i) => f.falsifiers.slice(0, 1).forEach((x) => points.push({ id: `F${i + 1}`, kind: "RISK", text: `Falsifier of “${f.thesis}”: ${x.falsifier}`, critical: i === 0, concept: null, href: null })));
  (d.thesis?.whatCouldBreak ?? []).slice(0, 3).forEach((w, i) => points.push({ id: `W${i + 1}`, kind: "RISK", text: w, critical: false, concept: null, href: null }));
  d.sensitivityDrivers.slice(0, 2).forEach((s, i) => points.push({ id: `S${i + 1}`, kind: "RISK", text: `${s.variable} breaks at ${s.breaksAt}`, critical: true, concept: null, href: null }));
  points.push(...riskAndOutlierPoints(c, 3).filter((p) => p.kind === "RISK"));
  return openExercise(c, "OPEN_PASS_TRIGGER", "What would make you pass?", "Name the specific findings — with thresholds — that would make you pass on this company. Be concrete: which number, below or above what level, measured how?", points, 3, ["RISK_DETECTION", c.domainSkill], [
    ...(d.thesis?.fatalWeakness ? [`Fatal weakness: ${d.thesis.fatalWeakness}`] : []),
    ...points.slice(0, 5).map((p) => p.text),
  ]);
}

export function twentyXExercise(c: TrainingCase): Exercise | null {
  const cm = c.derived.economics?.trajectory?.capitalMultiple;
  if (!cm?.modelable || !cm.requiredExitEquityUsd) return null;
  const ref = cm.byMultiple.find((r) => r.revenueMultiple === cm.referenceMultiple);
  const points: KeyPoint[] = [
    { id: "E1", kind: "FACT", text: `Exit equity of ${money(cm.requiredExitEquityUsd)} needed for ${cm.target.multiple}× (exit ownership ${cm.exitOwnershipPct?.toFixed(2)}%)`, critical: true, concept: "RETURN_PATH", href: `/deals/${c.ref.slug}/returns` },
    ...(ref ? [{ id: "E2", kind: "FACT" as const, text: `${money(ref.requiredRevenueUsd)} revenue at ${ref.revenueMultiple}× in ${cm.yearsToExit} years (${ref.requiredCagrPct !== null ? `${ref.requiredCagrPct.toFixed(0)}% CAGR` : "CAGR n/a"})`, critical: true, concept: "GROWTH_QUALITY" as const, href: `/deals/${c.ref.slug}/returns` }] : []),
    ...(ref?.requiredCustomers ? [{ id: "E3", kind: "FACT" as const, text: `~${ref.requiredCustomers.toLocaleString("en-US")} customers at current ARPA`, critical: false, concept: "RETURN_PATH" as const, href: null }] : []),
    ...(cm.samShare.sharePct !== null ? [{ id: "E4", kind: "FACT" as const, text: `${cm.samShare.sharePct.toFixed(1)}% of the reconstructed SAM (${cm.samShare.plausibility.toLowerCase()})`, critical: true, concept: "MARKET_SIZE_INFLATION" as const, href: `/deals/${c.ref.slug}/market` }] : []),
    { id: "E5", kind: "FACT", text: `Growth persistence: ${cm.growthPersistence.explanation}`, critical: false, concept: "GROWTH_QUALITY", href: null },
    ...(c.deal.thesis?.requiredConditions ?? []).slice(0, 2).map((rc, i) => ({ id: `C${i + 1}`, kind: "FACT" as const, text: rc.condition, critical: false, concept: null, href: null })),
  ];
  return openExercise(c, "OPEN_TWENTY_X", "What must be true for 20×?", `What must be true — in numbers — for this investment to return ${cm.target.multiple}× your capital? Think exit value, revenue, growth, customers and market share.`, points, 4, ["RETURN_MODELING", "MARKET_SIZING"], cm.summary, [`Overall trajectory: ${cm.plausibility.toLowerCase()}.`]);
}
