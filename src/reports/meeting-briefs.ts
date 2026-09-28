/**
 * PRE_MEETING_BRIEF and POST_MEETING_BRIEF builders — deterministic.
 *
 * The pre-meeting brief is rendered from the canonical object and the derived
 * analysis (decision core, sensitivity drivers, questions with their two
 * answers, information gaps, risks, integrity). An optional small model pass
 * (pre_meeting_brief_v1) only rephrases meeting objectives and "what we already
 * know"; `mergePreBriefModel` validates it and keeps deterministic text for
 * anything missing, so the brief always builds when the model call fails.
 *
 * The post-meeting brief is assembled from the post-meeting extraction
 * (founder_call_update_v3) with every item re-anchored to the verbatim
 * transcript, plus the deterministic Before → After diff of the two versions.
 */
import type { CanonicalDeal, Claim, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import type { PreMeetingBriefOutput } from "@/ai/prompts/meeting-brief";
import type { MeetingGuard } from "@/orchestration/assemble";
import {
  POST_MEETING_BRIEF_BUILDER,
  PRE_MEETING_BRIEF_BUILDER,
  type MeetingParticipant,
  type PostMeetingBrief,
  type PreMeetingBrief,
  type TranscriptRefView,
  type TranscriptSegment,
} from "@/domain/meetings";
import { resolveRefs } from "@/ingestion/transcript";
import { metricDef } from "@/engine/metrics/dictionary";
import { metricValue } from "@/lib/format";
import { buildQuickMemo } from "./quick-memo";
import { brief, clip, enumLabel, stripRefs } from "./text";
import { meetingDiff, sortChanges } from "./meeting-diff";

/* ---------------------------------------------------------------- */
/* Shared helpers                                                     */
/* ---------------------------------------------------------------- */

const TIER_ORDER = { MUST_ASK: 0, IMPORTANT: 1, OPTIONAL: 2 } as const;
const LEVELS = ["LOW", "MODERATE", "HIGH", "CRITICAL"];
const KEY_TRACTION = ["arr", "revenue_ttm", "gmv", "arr_growth_yoy", "revenue_growth_yoy", "mom_growth", "nrr", "grr", "gross_margin", "paying_customers", "cac_payback_months", "burn_multiple", "runway_months"];
const GROUPS = [
  ["arr", "revenue_ttm"],
  ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"],
  ["nrr", "grr"],
];

function words(s: string) {
  return new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
}
function similar(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let n = 0;
  for (const w of x) if (y.has(w)) n++;
  return n / Math.min(x.size, y.size) >= 0.6;
}

export function metricEvidenceLabel(m: Pick<MetricInstance, "state" | "verification" | "calculationMethod">): string {
  if (m.state === "CONTRADICTED" || m.verification === "CONTRADICTED") return "Contradicted";
  if (m.verification === "VERIFIED") return "Verified";
  if (m.state === "UNKNOWN" || m.state === "WITHHELD") return "Unknown";
  if (m.calculationMethod === "DERIVED") return "Derived";
  if (m.state === "INFERRED") return "Inferred";
  return "Company-reported";
}

function keyTraction(metrics: MetricInstance[], max = 5) {
  const primary = metrics.filter((m) => m.isPrimary && m.normalizedValue !== null);
  const used = new Set<number>();
  const out: MetricInstance[] = [];
  for (const k of KEY_TRACTION) {
    const m = primary.find((x) => x.metricKey === k);
    if (!m) continue;
    const g = GROUPS.findIndex((grp) => grp.includes(k));
    if (g >= 0 && used.has(g)) continue;
    if (g >= 0) used.add(g);
    out.push(m);
    if (out.length >= max) break;
  }
  return out;
}

const POSITIVE = /\b(supports?|strengthens?|credible|proceed|advances?|move to|deep dd|ic[- ]ready|upgrade|de-?risks?|validates?|confirms?|improves?|positive|scalable|repeatable|durable|defensible|advantage|testable)\b/gi;
const NEGATIVE = /\b(pass|watch|downgrade|weakens?|weak|concern|kills?|breaks?|fails?|screen out|red flag|reduces? (?:confidence|conviction)|lowers? (?:confidence|conviction)|unreliable|discount|stop|pause|stretched|walk away|worse|cannot|can't|doesn't|does not|not scalable|dependent|dependency|fragile|stalls?|substitution|overstated|defer|resize)\b/gi;

/**
 * Which recorded answer is the favourable one? Questions record "if answer A /
 * if answer B" without saying which is good; code reads the implications. When
 * the reading is ambiguous the brief says "Answer A / Answer B" instead of guessing.
 */
export function orientAnswers(a: string, b: string): { strong: string; weak: string; known: boolean } {
  const score = (t: string) => (t.match(POSITIVE)?.length ?? 0) - (t.match(NEGATIVE)?.length ?? 0);
  const sa = score(a);
  const sb = score(b);
  // Claim an orientation only when one reading is clearly favourable and the other is not.
  if (sa > 0 && sb < 0) return { strong: a, weak: b, known: true };
  if (sb > 0 && sa < 0) return { strong: b, weak: a, known: true };
  if (sa - sb >= 2) return { strong: a, weak: b, known: true };
  if (sb - sa >= 2) return { strong: b, weak: a, known: true };
  return { strong: a, weak: b, known: false };
}

/* ---------------------------------------------------------------- */
/* PRE_MEETING_BRIEF                                                  */
/* ---------------------------------------------------------------- */

export interface VersionMetaForBrief {
  id: string;
  versionNo: number;
  createdAt: string;
  stageCode: string;
  stageLabel: string;
}

/** Highest-value open questions: all MUST_ASK, then IMPORTANT, to at most 6 (OPTIONAL only to reach 3). */
export function briefQuestions(c: CanonicalDeal) {
  const open = c.questions.filter((q) => q.status !== "RESOLVED").sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  const core = open.filter((q) => q.tier !== "OPTIONAL").slice(0, 6);
  return core.length >= 3 ? core : open.slice(0, 3);
}

export function buildPreMeetingBrief(c: CanonicalDeal, d: DerivedAnalysis, v: VersionMetaForBrief): PreMeetingBrief {
  const q = buildQuickMemo(c, d);
  const entry = d.returns.inputs.entry;

  /* ---------- what matters most ---------- */
  const killerRisk = d.risk.thesisKillers[0] ?? null;
  const thesisKiller = killerRisk
    ? { text: `${killerRisk.title} — ${brief(killerRisk.description, 200)}`, refs: [killerRisk.id, ...killerRisk.claimRefs].slice(0, 4) }
    : c.decisionCore?.compression.breakingPoint
      ? { text: brief(c.decisionCore.compression.breakingPoint, 240), refs: [] }
      : c.thesis?.fatalWeakness
        ? { text: brief(c.thesis.fatalWeakness, 240), refs: [] }
        : null;
  const ranked = [...c.risks].filter((r) => r.id !== killerRisk?.id).sort((a, b) => LEVELS.indexOf(b.severity) * 4 + LEVELS.indexOf(b.likelihood) - (LEVELS.indexOf(a.severity) * 4 + LEVELS.indexOf(a.likelihood)));
  const concernRisk = ranked[0];
  const biggestConcern = concernRisk
    ? { text: `${concernRisk.title} — ${brief(concernRisk.description, 200)}`, refs: [concernRisk.id, ...concernRisk.claimRefs].slice(0, 4) }
    : c.whatWorriesMe[0]
      ? { text: clip(stripRefs(c.whatWorriesMe[0]), 240), refs: [] }
      : null;
  const strength = c.exceptionalStrengths[0];
  const exceptionalStrength = strength
    ? { text: `${clip(stripRefs(strength.claim), 220)} (${enumLabel(strength.rating).toLowerCase()})`, refs: strength.claimRefs.slice(0, 4) }
    : c.decisionCore?.compression.exceptionalStrength
      ? { text: clip(stripRefs(c.decisionCore.compression.exceptionalStrength), 240), refs: [] }
      : null;

  const unknowns: PreMeetingBrief["whatMattersMost"]["keyUnknowns"] = [];
  const pushUnknown = (u: (typeof unknowns)[number]) => {
    if (unknowns.length >= 5 || !u.text.trim() || unknowns.some((x) => similar(x.text, u.text))) return;
    unknowns.push(u);
  };
  const statusRank = { UNKNOWN: 0, CONTRADICTED: 1, COMPANY_REPORTED: 2, INFERRED: 3, VERIFIED: 9 } as const;
  for (const det of [...(c.decisionCore?.determinants ?? [])].filter((x) => x.status !== "VERIFIED").sort((a, b) => statusRank[a.status] - statusRank[b.status]).slice(0, 3))
    pushUnknown({ text: `${clip(stripRefs(det.fact), 180)} — ${enumLabel(det.status).toLowerCase()}`, source: "DETERMINANT", refs: det.refs.slice(0, 3) });
  const gapById = new Map(c.informationGaps.map((g) => [g.id, g]));
  for (const p of [...d.researchPriority].sort((a, b) => Number(b.channel === "FOUNDER") - Number(a.channel === "FOUNDER") || b.index - a.index)) {
    const g = gapById.get(p.gapId);
    if (g && g.decisionImportance >= 3) pushUnknown({ text: clip(stripRefs(g.question), 200), source: "GAP", refs: [g.id] });
  }
  for (const s of c.sensitivityDrivers) pushUnknown({ text: `${s.variable}: ${clip(stripRefs(s.currentAssumption), 90)}; the thesis breaks at ${clip(stripRefs(s.breaksAt), 80)}`, source: "SENSITIVITY", refs: s.metricKey ? [s.metricKey] : [] });
  for (const x of briefQuestions(c)) pushUnknown({ text: clip(stripRefs(x.question), 200), source: "QUESTION", refs: [x.id] });

  /* ---------- objectives (deterministic; rephrased by the model when available) ---------- */
  const objectives: PreMeetingBrief["objectives"] = [];
  const pushObj = (objective: string, why: string, refs: string[]) => {
    if (objectives.length >= 4 || objectives.some((o) => similar(o.objective, objective))) return;
    objectives.push({ objective: clip(objective, 200), why: clip(why, 220), refs, origin: "DETERMINISTIC" });
  };
  if (c.decisionCore?.reversingQuestion.question) pushObj(`Establish: ${stripRefs(c.decisionCore.reversingQuestion.question)}`, "The single answer that could reverse the decision.", []);
  if (killerRisk) pushObj(`Test the thesis-killing risk: ${killerRisk.title}`, brief(killerRisk.description, 200), [killerRisk.id]);
  if (c.thesis?.fatalQuestion) pushObj(`Establish: ${stripRefs(c.thesis.fatalQuestion)}`, "The most important unresolved question in the thesis.", []);
  const driver = c.sensitivityDrivers[0];
  if (driver) pushObj(`Pin down ${driver.variable} (the thesis breaks at ${stripRefs(driver.breaksAt)})`, brief(driver.why, 200), driver.metricKey ? [driver.metricKey] : []);
  if (c.nextBestAction?.type === "FOUNDER_REQUEST") pushObj(`Secure: ${stripRefs(c.nextBestAction.action)}`, brief(c.nextBestAction.rationale, 200), []);
  for (const x of briefQuestions(c).filter((x) => x.tier === "MUST_ASK")) pushObj(`Establish: ${stripRefs(x.question)}`, brief(x.whyItMatters, 200), [x.id]);

  /* ---------- questions ---------- */
  const questions = briefQuestions(c).map((x) => {
    const o = orientAnswers(x.ifAnswerA, x.ifAnswerB);
    return {
      id: x.id,
      tier: x.tier,
      question: stripRefs(x.question),
      alreadyKnow: clip(stripRefs(x.knownContext), 320) || "Nothing recorded yet.",
      alreadyKnowOrigin: "DETERMINISTIC" as const,
      whyItMatters: clip(stripRefs(x.whyItMatters), 320),
      strongAnswer: clip(stripRefs(o.strong), 280),
      weakAnswer: clip(stripRefs(o.weak), 280),
      orientationKnown: o.known,
      affects: x.affects,
    };
  });

  const caveats: string[] = [];
  if (c.analysis.depth === "PARTIAL") caveats.push(`Analysis is partial${c.analysis.partialReasons.length ? `: ${c.analysis.partialReasons.slice(0, 2).join("; ")}` : ""}.`);
  if (c.analysis.researchNotCompleted.length) caveats.push(`Research not completed: ${c.analysis.researchNotCompleted.slice(0, 2).join("; ")}.`);
  const contradictions = d.integrity?.contradictions?.length ?? 0;
  if (contradictions) caveats.push(`${contradictions} contradiction${contradictions > 1 ? "s" : ""} flagged by the integrity engine — see Evidence.`);
  caveats.push("Every number is company-reported unless marked verified. Answers in the meeting remain company-reported.");

  return {
    builderVersion: PRE_MEETING_BRIEF_BUILDER,
    company: { name: c.identity.name, oneLiner: stripRefs(c.identity.oneLiner) },
    analysis: { versionId: v.id, versionNo: v.versionNo, stageCode: v.stageCode, stageLabel: v.stageLabel, depth: c.analysis.depth, createdAt: v.createdAt },
    quickMemo: {
      whatItDoes: q.product?.whatItDoes ?? (q.oneLiner || null),
      productType: q.product?.type ?? (c.classification.productType.map(enumLabel).join(", ") || null),
      user: q.product?.user ?? null,
      buyer: q.product?.buyer ?? null,
      businessModel: q.businessModel ? `${q.businessModel.how}${q.businessModel.pricing ? ` · ${q.businessModel.pricing}` : ""}` : null,
      gtm: q.gtm ? `${q.gtm.motion}${q.gtm.cycle ? ` · cycle ${q.gtm.cycle}` : ""}` : null,
      founders: q.founders.map((f) => ({ name: f.name, role: f.role, background: f.background })),
      keyTraction: keyTraction(c.metrics).map((m) => ({ metricId: m.id, label: metricDef(m.metricKey)?.shortName ?? m.label, value: metricValue(m.unit, m.normalizedValue), evidence: metricEvidenceLabel(m) })),
      market: q.market ? [q.market.range ? `${q.market.range} (${q.market.method?.toLowerCase() ?? "reconstructed"})` : null, q.market.wedge ? `wedge: ${q.market.wedge}` : null].filter(Boolean).join(" · ") || null : null,
      round: entry.raiseUsd || entry.postMoneyUsd ? q.facts.filter((f) => f.label === "Round" || f.label === "Post-money" || f.label === "Cap").map((f) => `${f.label} ${f.value}`).join(" · ") : null,
      competitors: q.competitors.map((x) => `${x.name} (${x.type.toLowerCase()})`),
      investmentView: { status: q.view.status as PreMeetingBrief["quickMemo"]["investmentView"]["status"], label: q.view.label, rationale: q.view.rationale },
    },
    whatMattersMost: { exceptionalStrength, biggestConcern, thesisKiller, keyUnknowns: unknowns },
    objectives,
    questions,
    caveats,
  };
}

/** Compact record for the pre-meeting model pass. Only facts already in the version. */
export function preBriefModelInput(c: CanonicalDeal, d: DerivedAnalysis, b: PreMeetingBrief) {
  return {
    company: { name: c.identity.name, oneLiner: c.identity.oneLiner },
    bet: c.thesis?.bet ?? c.decisionCore?.compression.bet ?? null,
    fatalQuestion: c.thesis?.fatalQuestion ?? null,
    reversingQuestion: c.decisionCore?.reversingQuestion ?? null,
    thesisKillers: d.risk.thesisKillers.map((r) => ({ id: r.id, title: r.title, description: clip(r.description, 300) })),
    topRisks: c.risks.slice(0, 5).map((r) => ({ id: r.id, title: r.title, severity: r.severity, likelihood: r.likelihood })),
    decisiveUnknowns: (c.decisionCore?.determinants ?? []).map((x) => ({ fact: x.fact, status: x.status, refs: x.refs })),
    sensitivityDrivers: c.sensitivityDrivers.map((s) => ({ variable: s.variable, currentAssumption: s.currentAssumption, breaksAt: s.breaksAt })),
    metrics: keyTraction(c.metrics, 8).map((m) => ({ id: m.id, metric: metricDef(m.metricKey)?.shortName ?? m.label, value: metricValue(m.unit, m.normalizedValue), definition: m.definitionUsed, evidence: metricEvidenceLabel(m) })),
    questions: b.questions.map((x) => {
      const full = c.questions.find((k) => k.id === x.id);
      return { id: x.id, question: x.question, whyItMatters: x.whyItMatters, knownContext: full?.knownContext ?? x.alreadyKnow };
    }),
    founderGaps: d.researchPriority.filter((g) => g.channel === "FOUNDER").slice(0, 5).map((g) => ({ id: g.gapId, question: g.question })),
  };
}

/** Merge the model's phrasing into the deterministic brief; anything invalid keeps the deterministic text. */
export function mergePreBriefModel(b: PreMeetingBrief, out: PreMeetingBriefOutput): PreMeetingBrief {
  const next = structuredClone(b);
  const objectives = out.objectives
    .filter((o) => o.objective.trim().length > 10)
    .slice(0, 4)
    .map((o) => ({ objective: clip(o.objective.trim(), 200), why: clip(o.why.trim(), 220), refs: [...new Set(o.refs.filter((r) => /^(Q|GAP|RSK|CLM|MET|SRC)-\d+$/.test(r)))].slice(0, 4), origin: "MODEL" as const }));
  if (objectives.length >= 2) next.objectives = objectives;
  for (const q of next.questions) {
    const m = out.questions.find((x) => x.questionId === q.id);
    if (m && m.alreadyKnow.trim().length > 8) {
      q.alreadyKnow = clip(m.alreadyKnow.trim(), 320);
      q.alreadyKnowOrigin = "MODEL";
    }
  }
  return next;
}

/* ---------------------------------------------------------------- */
/* POST_MEETING_BRIEF                                                 */
/* ---------------------------------------------------------------- */

export interface PostBriefInput {
  meeting: { id: string; seq: number; title: string; heldAt: string; participants: MeetingParticipant[]; source: string };
  pre: { versionId: string; versionNo: number; stageCode: string; canonical: CanonicalDeal; derived: DerivedAnalysis };
  post: { versionId: string; versionNo: number; stageCode: string; canonical: CanonicalDeal; derived: DerivedAnalysis };
  preBriefId: string | null;
  preBrief: PreMeetingBrief | null;
  extraction: FounderCallOutput;
  segments: TranscriptSegment[];
  guards: MeetingGuard[];
}

function conflictKind(cl: Claim | undefined, deal: CanonicalDeal): PostMeetingBrief["contradictions"][number]["conflictsWith"] {
  if (!cl) return "DECK";
  const kinds = cl.evidence.map((e) => deal.sources.find((s) => s.id === e.sourceId)?.kind);
  if (kinds.includes("WEB")) return "EXTERNAL_EVIDENCE";
  if (kinds.filter((k) => k === "TRANSCRIPT").length > 1 || (kinds[0] === "TRANSCRIPT" && cl.evidence[0]?.effect === "ORIGIN")) return "PRIOR_FOUNDER_STATEMENT";
  return "DECK";
}

export function buildPostMeetingBrief(inp: PostBriefInput): PostMeetingBrief {
  const x = inp.extraction;
  const segs = inp.segments;
  const pre = inp.pre.canonical;
  const post = inp.post.canonical;
  const r = (refs: string[] | undefined, excerpt?: string | null): TranscriptRefView[] => resolveRefs(segs, refs, excerpt);
  const unanchored: string[] = [];
  let items = 0;
  const track = <T extends { refs: TranscriptRefView[] }>(label: string, item: T): T => {
    items++;
    if (!item.refs.length) unanchored.push(clip(label, 90));
    return item;
  };
  const claimById = new Map(post.claims.map((c) => [c.id, c]));
  const preClaimIds = new Set(pre.claims.map((c) => c.id));
  const createdClaims = post.claims.filter((c) => !preClaimIds.has(c.id));

  const discussed = x.discussed.slice(0, 8).map((t) => track(t.topic, { topic: t.topic, summary: t.summary, refs: r(t.transcriptRefs) }));

  const newInformation = [
    ...x.newClaims.map((n) =>
      track(n.statement, {
        statement: n.statement,
        category: enumLabel(n.category),
        targetId: createdClaims.find((c) => c.statement === n.statement)?.id ?? null,
        evidenceLabel: "COMPANY_REPORTED" as const,
        refs: r(n.transcriptRefs, n.excerpt),
      }),
    ),
    ...x.newMetrics
      .filter((m) => !pre.metrics.some((p) => p.metricKey === m.metricKey && p.normalizedValue === m.value))
      .map((m) =>
        track(m.label, {
          statement: `${metricDef(m.metricKey)?.shortName ?? m.label}: ${m.rawText}${m.definitionAsStated ? ` (${m.definitionAsStated})` : ""}`,
          category: "Metric",
          targetId: post.metrics.find((k) => k.excerpt === m.excerpt && k.metricKey === m.metricKey)?.id ?? null,
          evidenceLabel: "COMPANY_REPORTED" as const,
          refs: r([], m.excerpt),
        }),
      ),
  ];

  const clarifications = [
    ...x.claimUpdates
      .filter((u) => u.change === "CLARIFIED")
      .map((u) => {
        const cl = claimById.get(u.claimId);
        return track(u.founderSaid, { subject: clip(stripRefs(cl?.statement ?? u.claimId), 140), before: u.before, clarified: u.founderSaid, implication: u.note, targetId: cl ? cl.id : null, refs: r(u.transcriptRefs, u.transcriptExcerpt) });
      }),
    // A metric clarification that restates a clarified claim (same underlying fact) is shown once.
    ...(x.metricClarifications ?? [])
      .filter((u) => {
        const m = post.metrics.find((k) => k.id === u.metricId);
        return !(m?.claimId && x.claimUpdates.some((c) => c.change === "CLARIFIED" && c.claimId === m.claimId));
      })
      .map((u) => {
      const m = post.metrics.find((k) => k.id === u.metricId);
      return track(u.clarifiedDefinition, {
        subject: m ? (metricDef(m.metricKey)?.shortName ?? m.label) : u.metricId,
        before: u.deckValue,
        clarified: u.clarifiedDefinition,
        implication: u.implication,
        targetId: m ? m.id : null,
        refs: r(u.transcriptRefs, u.transcriptExcerpt),
      });
    }),
  ];

  const confirmations = x.claimUpdates
    .filter((u) => u.change === "CONFIRMED")
    .map((u) => {
      const cl = claimById.get(u.claimId);
      return track(u.founderSaid, { statement: clip(stripRefs(cl?.statement ?? u.before), 200), detail: u.founderSaid, claimId: cl ? cl.id : null, evidenceLabel: "COMPANY_REPORTED" as const, refs: r(u.transcriptRefs, u.transcriptExcerpt) });
    });

  const contradictions: PostMeetingBrief["contradictions"] = [];
  for (const c of x.contradictions ?? [])
    contradictions.push(track(c.statement, { statement: c.statement, conflictsWith: c.conflictsWith, priorStatement: c.priorStatement, targetId: c.targetId && (claimById.has(c.targetId) || post.metrics.some((m) => m.id === c.targetId) || post.sources.some((s) => s.id === c.targetId)) ? c.targetId : null, material: c.material, refs: r(c.transcriptRefs, c.transcriptExcerpt) }));
  for (const u of x.claimUpdates.filter((k) => k.change === "CONTRADICTED")) {
    if (contradictions.some((k) => k.targetId === u.claimId)) continue;
    const cl = claimById.get(u.claimId);
    contradictions.push(track(u.founderSaid, { statement: u.founderSaid, conflictsWith: conflictKind(cl, pre), priorStatement: u.before || (cl?.statement ?? ""), targetId: cl ? cl.id : null, material: cl?.material ?? true, refs: r(u.transcriptRefs, u.transcriptExcerpt) }));
  }

  // What remains unanswered: every briefed or decisive question not resolved, and decisive gaps still open.
  const briefed = new Set(inp.preBrief?.questions.map((q) => q.id) ?? []);
  const unanswered: PostMeetingBrief["unanswered"] = [
    ...post.questions
      .filter((q) => q.status !== "RESOLVED" && (briefed.has(q.id) || q.tier !== "OPTIONAL"))
      .map((q) => ({ id: q.id, text: stripRefs(q.question), status: q.status, note: q.status === "NOT_FULLY_RESOLVED" ? q.answer : q.status === "OPEN" ? "Not discussed" : q.answer })),
    ...post.informationGaps.filter((g) => (g.status === "OPEN" || g.status === "NEEDS_FOUNDER") && g.decisionImportance >= 4).map((g) => ({ id: g.id, text: stripRefs(g.question), status: g.status, note: g.resolutionNote })),
  ];

  const whatChanged = sortChanges(meetingDiff(inp.pre, inp.post, { extraction: x, segments: segs, guards: inp.guards })).filter((row) => row.material).slice(0, 14);
  const next = x.nextAction ?? post.nextBestAction ?? { action: "Verify the meeting's material statements with documents and references", rationale: "Founder statements are company-reported.", type: "DOCUMENT_REVIEW" as const };

  return {
    builderVersion: POST_MEETING_BRIEF_BUILDER,
    company: { name: post.identity.name },
    meeting: inp.meeting,
    preAnalysis: { versionId: inp.pre.versionId, versionNo: inp.pre.versionNo, stageCode: inp.pre.stageCode },
    preBriefId: inp.preBriefId,
    postAnalysis: { versionId: inp.post.versionId, versionNo: inp.post.versionNo, stageCode: inp.post.stageCode },
    summary: x.summary,
    discussed,
    newInformation,
    clarifications,
    confirmations,
    contradictions,
    unanswered,
    whatChanged,
    recommendation: { before: inp.pre.derived.recommendation.status, after: inp.post.derived.recommendation.status },
    nextAction: { action: next.action, rationale: next.rationale, type: next.type, refs: [] },
    anchoring: { items, anchored: items - unanchored.length, unanchored },
  };
}
