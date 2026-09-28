/**
 * FOUNDER MEETING WORKFLOW — four distinct, separately accessible, versioned objects:
 *
 *   1. PRE_MEETING_ANALYSIS     a company version (company_versions.stage) — the full analysis before the meeting
 *   2. PRE_MEETING_BRIEF        meeting_briefs row — one page, built from (1)
 *   3. POST_MEETING_BRIEF       meeting_briefs row — what the meeting added, with transcript refs
 *   4. POST_MEETING_ANALYSIS_Vn a company version — the complete analysis after meeting n
 *
 * Versions and briefs are immutable. A meeting never rewrites an earlier conclusion:
 * the "What changed after the meeting?" view diffs (1) against (4).
 */
import { z } from "zod";
import { DecisionStatus, QuestionTier } from "./enums";
import { NextBestAction } from "./sections";

/* ---------------------------------------------------------------- */
/* Version stage                                                      */
/* ---------------------------------------------------------------- */

export const VERSION_STAGES = ["PRE_MEETING_ANALYSIS", "POST_MEETING_ANALYSIS", "DECK_REANALYSIS"] as const;
export type VersionStage = (typeof VERSION_STAGES)[number];

export interface ResolvedStage {
  stage: VersionStage;
  seq: number | null;
  /** PRE_MEETING_ANALYSIS · POST_MEETING_ANALYSIS_V2 · DECK_REANALYSIS */
  code: string;
  /** "Pre-meeting analysis" · "Post-meeting analysis V2" · "Deck re-analysis (after meeting)" */
  label: string;
}

export function stageCode(stage: VersionStage, seq: number | null): string {
  return stage === "POST_MEETING_ANALYSIS" ? `POST_MEETING_ANALYSIS_V${seq ?? 1}` : stage;
}

export function stageLabel(stage: VersionStage, seq: number | null): string {
  if (stage === "POST_MEETING_ANALYSIS") return `Post-meeting analysis V${seq ?? 1}`;
  if (stage === "DECK_REANALYSIS") return "Deck re-analysis (after a meeting)";
  return "Pre-meeting analysis";
}

/**
 * Resolve the stage of every version of a company. Rows written since the
 * workflow existed carry `stage`; older rows are resolved deterministically:
 * DECK_ANALYSIS → PRE_MEETING_ANALYSIS, FOUNDER_CALL → POST_MEETING_ANALYSIS_Vn
 * (n counted in order), any other edit inherits the stage of the version before it.
 */
export function resolveStages(rows: { id: string; versionNo: number; reason: string; stage: VersionStage | null; stageSeq: number | null }[]): Map<string, ResolvedStage> {
  const out = new Map<string, ResolvedStage>();
  let prev: { stage: VersionStage; seq: number | null } = { stage: "PRE_MEETING_ANALYSIS", seq: null };
  let calls = 0;
  for (const r of [...rows].sort((a, b) => a.versionNo - b.versionNo)) {
    let cur: { stage: VersionStage; seq: number | null };
    if (r.stage) cur = { stage: r.stage, seq: r.stageSeq };
    else if (r.reason === "DECK_ANALYSIS") cur = { stage: calls > 0 ? "DECK_REANALYSIS" : "PRE_MEETING_ANALYSIS", seq: null };
    else if (r.reason === "FOUNDER_CALL") cur = { stage: "POST_MEETING_ANALYSIS", seq: calls + 1 };
    else cur = prev;
    if (cur.stage === "POST_MEETING_ANALYSIS") calls = Math.max(calls, cur.seq ?? calls + 1);
    out.set(r.id, { ...cur, code: stageCode(cur.stage, cur.seq), label: stageLabel(cur.stage, cur.seq) });
    prev = cur;
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Transcript                                                         */
/* ---------------------------------------------------------------- */

export const MeetingParticipant = z.object({
  name: z.string().min(1).max(120),
  role: z.string().max(120).nullable(),
  side: z.enum(["FUND", "COMPANY", "OTHER"]),
});
export type MeetingParticipant = z.infer<typeof MeetingParticipant>;

export interface TranscriptSegment {
  /** "T-12": the 12th speaker turn. Stable reference used in briefs and claims. */
  ref: string;
  idx: number;
  speaker: string | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
}

/** A resolved pointer into the verbatim transcript. */
export const TranscriptRefView = z.object({
  ref: z.string(),
  speaker: z.string().nullable(),
  startSec: z.number().nullable(),
  excerpt: z.string(),
});
export type TranscriptRefView = z.infer<typeof TranscriptRefView>;

export function segmentRef(idx: number) {
  return `T-${idx + 1}`;
}

export function formatTimestamp(sec: number | null): string | null {
  if (sec === null || !Number.isFinite(sec)) return null;
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${String(m).padStart(2, "0")}:${ss}`;
}

/* ---------------------------------------------------------------- */
/* PRE_MEETING_BRIEF                                                  */
/* ---------------------------------------------------------------- */

export const PRE_MEETING_BRIEF_BUILDER = "pre_meeting_brief_v1";
export const POST_MEETING_BRIEF_BUILDER = "post_meeting_brief_v1";

const Ref = z.string();

export const PreMeetingBrief = z.object({
  builderVersion: z.literal(PRE_MEETING_BRIEF_BUILDER),
  company: z.object({ name: z.string(), oneLiner: z.string() }),
  analysis: z.object({ versionId: z.string(), versionNo: z.number(), stageCode: z.string(), stageLabel: z.string(), depth: z.enum(["FULL", "PARTIAL"]), createdAt: z.string() }),
  quickMemo: z.object({
    whatItDoes: z.string().nullable(),
    productType: z.string().nullable(),
    user: z.string().nullable(),
    buyer: z.string().nullable(),
    businessModel: z.string().nullable(),
    gtm: z.string().nullable(),
    founders: z.array(z.object({ name: z.string(), role: z.string(), background: z.string() })),
    keyTraction: z.array(z.object({ metricId: z.string(), label: z.string(), value: z.string(), evidence: z.string() })),
    market: z.string().nullable(),
    round: z.string().nullable(),
    competitors: z.array(z.string()),
    investmentView: z.object({ status: DecisionStatus, label: z.string(), rationale: z.string() }),
  }),
  whatMattersMost: z.object({
    exceptionalStrength: z.object({ text: z.string(), refs: z.array(Ref) }).nullable(),
    biggestConcern: z.object({ text: z.string(), refs: z.array(Ref) }).nullable(),
    thesisKiller: z.object({ text: z.string(), refs: z.array(Ref) }).nullable(),
    keyUnknowns: z.array(z.object({ text: z.string(), source: z.enum(["DETERMINANT", "GAP", "SENSITIVITY", "QUESTION"]), refs: z.array(Ref) })),
  }),
  objectives: z.array(z.object({ objective: z.string(), why: z.string(), refs: z.array(Ref), origin: z.enum(["MODEL", "DETERMINISTIC"]) })),
  questions: z.array(
    z.object({
      id: z.string(),
      tier: QuestionTier,
      question: z.string(),
      alreadyKnow: z.string(),
      alreadyKnowOrigin: z.enum(["MODEL", "DETERMINISTIC"]),
      whyItMatters: z.string(),
      strongAnswer: z.string(),
      weakAnswer: z.string(),
      /** True when code could tell which of the two recorded answers is the favourable one; otherwise shown as "Answer A / B". */
      orientationKnown: z.boolean(),
      affects: z.array(z.string()),
    }),
  ),
  caveats: z.array(z.string()),
});
export type PreMeetingBrief = z.infer<typeof PreMeetingBrief>;

/* ---------------------------------------------------------------- */
/* What changed (deterministic diff rows)                             */
/* ---------------------------------------------------------------- */

export const CHANGE_GROUPS = ["RECOMMENDATION", "SCORE", "RUBRIC", "FOUNDER", "THESIS", "RISK", "METRIC", "CLAIM", "QUESTION", "GAP", "EVIDENCE"] as const;

export const DimensionChange = z.object({
  group: z.enum(CHANGE_GROUPS),
  /** Stable join key, e.g. RUBRIC:CHANNEL_SCALABILITY, RSK-03, Q-02, METRIC:cac, CLM-014. */
  key: z.string(),
  /** Investment area: Thesis, Founders, Product, PMF, Traction, GTM, Economics, Competition, Moat, Financing, Risks, Returns, Evidence, Unknowns, Recommendation. */
  area: z.string(),
  dimension: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  /** Coarse reading for ratings: UNKNOWN / CONCERN / ADEQUATE / STRENGTH (null when not a rating). */
  beforeLevel: z.string().nullable(),
  afterLevel: z.string().nullable(),
  material: z.boolean(),
  founderSaid: z.string().nullable(),
  reason: z.string().nullable(),
  refs: z.array(TranscriptRefView),
  /** Set when code limited what founder statements alone could change. */
  guard: z.string().nullable(),
});
export type DimensionChange = z.infer<typeof DimensionChange>;

/* ---------------------------------------------------------------- */
/* POST_MEETING_BRIEF                                                 */
/* ---------------------------------------------------------------- */

const Item = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, refs: z.array(TranscriptRefView) });

export const PostMeetingBrief = z.object({
  builderVersion: z.literal(POST_MEETING_BRIEF_BUILDER),
  company: z.object({ name: z.string() }),
  meeting: z.object({ id: z.string(), seq: z.number(), title: z.string(), heldAt: z.string(), participants: z.array(MeetingParticipant), source: z.string() }),
  preAnalysis: z.object({ versionId: z.string(), versionNo: z.number(), stageCode: z.string() }),
  preBriefId: z.string().nullable(),
  postAnalysis: z.object({ versionId: z.string(), versionNo: z.number(), stageCode: z.string() }),
  summary: z.string(),
  discussed: z.array(Item({ topic: z.string(), summary: z.string() })),
  /** targetId: the claim (CLM-) or metric (MET-) created from it in the post-meeting analysis. */
  newInformation: z.array(Item({ statement: z.string(), category: z.string(), targetId: z.string().nullable(), evidenceLabel: z.literal("COMPANY_REPORTED") })),
  clarifications: z.array(Item({ subject: z.string(), before: z.string(), clarified: z.string(), implication: z.string(), targetId: z.string().nullable() })),
  confirmations: z.array(Item({ statement: z.string(), detail: z.string(), claimId: z.string().nullable(), evidenceLabel: z.literal("COMPANY_REPORTED") })),
  contradictions: z.array(
    Item({
      statement: z.string(),
      conflictsWith: z.enum(["DECK", "PRIOR_FOUNDER_STATEMENT", "EXTERNAL_EVIDENCE", "EXISTING_METRIC", "WITHIN_MEETING"]),
      priorStatement: z.string(),
      targetId: z.string().nullable(),
      material: z.boolean(),
    }),
  ),
  unanswered: z.array(z.object({ id: z.string(), text: z.string(), status: z.string(), note: z.string().nullable() })),
  whatChanged: z.array(DimensionChange),
  recommendation: z.object({ before: DecisionStatus, after: DecisionStatus }),
  nextAction: NextBestAction.extend({ refs: z.array(TranscriptRefView) }),
  anchoring: z.object({ items: z.number(), anchored: z.number(), unanchored: z.array(z.string()) }),
});
export type PostMeetingBrief = z.infer<typeof PostMeetingBrief>;

export interface BriefGeneration {
  mode: "DETERMINISTIC" | "DETERMINISTIC_PLUS_MODEL";
  model: string | null;
  promptVersion: string | null;
  costUsd: number;
  cached: boolean;
  fallbackReason: string | null;
}
