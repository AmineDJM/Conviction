/**
 * Meetings workflow repository (founder_meetings, meeting_segments, meeting_briefs).
 * Every query is scoped by company (and workspace where a user supplies the id).
 * Briefs and transcript segments are insert-only; a meeting row records workflow
 * state and the ids of the four objects it produced.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { resolveStages, type BriefGeneration, type MeetingParticipant, type ResolvedStage, type TranscriptSegment } from "@/domain/meetings";
import { segmentRef } from "@/domain/meetings";
import { newId, nowIso } from "./ids";

const s = schema;

export type MeetingRow = typeof s.founderMeetings.$inferSelect;
export type BriefRow = typeof s.meetingBriefs.$inferSelect;
export type MeetingSource = MeetingRow["source"];

/* ------------------------------ Stages ------------------------------ */

export function versionStages(companyId: string, db: DB = getDb()): Map<string, ResolvedStage> {
  const rows = db
    .select({ id: s.companyVersions.id, versionNo: s.companyVersions.versionNo, reason: s.companyVersions.reason, stage: s.companyVersions.stage, stageSeq: s.companyVersions.stageSeq })
    .from(s.companyVersions)
    .where(eq(s.companyVersions.companyId, companyId))
    .all();
  return resolveStages(rows);
}

export function stageOfVersion(companyId: string, versionId: string, db: DB = getDb()): ResolvedStage | null {
  return versionStages(companyId, db).get(versionId) ?? null;
}

/** Number of POST_MEETING_ANALYSIS versions produced so far (meeting n → V{n}). */
export function nextPostMeetingSeq(companyId: string, db: DB = getDb()): number {
  let max = 0;
  for (const st of versionStages(companyId, db).values()) if (st.stage === "POST_MEETING_ANALYSIS") max = Math.max(max, st.seq ?? 0);
  return max + 1;
}

/* ------------------------------ Meetings ------------------------------ */

export function createMeeting(
  v: {
    workspaceId: string;
    companyId: string;
    title: string;
    heldAt: string;
    participants: MeetingParticipant[];
    source: MeetingSource;
    status: MeetingRow["status"];
    preAnalysisVersionId: string;
    preBriefId: string | null;
    transcriptDocumentId?: string | null;
    recordingDocumentId?: string | null;
    runId?: string | null;
    createdBy: string | null;
  },
  db: DB = getDb(),
): MeetingRow {
  const id = newId("mtg");
  db.transaction((tx) => {
    const last = tx.select({ n: sql<number>`coalesce(max(${s.founderMeetings.seq}), 0)` }).from(s.founderMeetings).where(eq(s.founderMeetings.companyId, v.companyId)).get();
    tx.insert(s.founderMeetings)
      .values({
        id,
        workspaceId: v.workspaceId,
        companyId: v.companyId,
        seq: (last?.n ?? 0) + 1,
        title: v.title,
        heldAt: v.heldAt,
        participants: v.participants,
        source: v.source,
        status: v.status,
        error: null,
        runId: v.runId ?? null,
        transcriptDocumentId: v.transcriptDocumentId ?? null,
        recordingDocumentId: v.recordingDocumentId ?? null,
        transcription: null,
        speakerNames: {},
        preAnalysisVersionId: v.preAnalysisVersionId,
        preBriefId: v.preBriefId,
        postBriefId: null,
        postAnalysisVersionId: null,
        extraction: null,
        createdBy: v.createdBy,
        createdAt: nowIso(),
      })
      .run();
  });
  return db.select().from(s.founderMeetings).where(eq(s.founderMeetings.id, id)).get()!;
}

type MeetingPatch = Partial<Pick<MeetingRow, "status" | "error" | "runId" | "transcriptDocumentId" | "transcription" | "speakerNames" | "postBriefId" | "postAnalysisVersionId" | "extraction">>;

/** Workflow state only. The frozen pre-meeting analysis id and the ingestion facts are never patched. */
export function updateMeeting(meetingId: string, patch: MeetingPatch, db: DB = getDb()) {
  db.update(s.founderMeetings).set(patch).where(eq(s.founderMeetings.id, meetingId)).run();
}

export function getMeeting(companyId: string, meetingId: string, db: DB = getDb()): MeetingRow | undefined {
  return db.select().from(s.founderMeetings).where(and(eq(s.founderMeetings.companyId, companyId), eq(s.founderMeetings.id, meetingId))).get();
}

export function listMeetings(companyId: string, db: DB = getDb()): MeetingRow[] {
  return db.select().from(s.founderMeetings).where(eq(s.founderMeetings.companyId, companyId)).orderBy(asc(s.founderMeetings.seq)).all();
}

export function meetingForRun(runId: string, db: DB = getDb()): MeetingRow | undefined {
  return db.select().from(s.founderMeetings).where(eq(s.founderMeetings.runId, runId)).get();
}

/* ------------------------------ Transcript ------------------------------ */

export function saveSegments(meetingId: string, segments: Omit<TranscriptSegment, "ref">[], db: DB = getDb()) {
  db.transaction((tx) => {
    for (const [i, seg] of segments.entries())
      tx.insert(s.meetingSegments).values({ id: newId("seg"), meetingId, idx: i, speaker: seg.speaker, startSec: seg.startSec, endSec: seg.endSec, text: seg.text }).run();
  });
}

export function getSegments(meetingId: string, db: DB = getDb()): TranscriptSegment[] {
  return db
    .select()
    .from(s.meetingSegments)
    .where(eq(s.meetingSegments.meetingId, meetingId))
    .orderBy(asc(s.meetingSegments.idx))
    .all()
    .map((r) => ({ ref: segmentRef(r.idx), idx: r.idx, speaker: r.speaker, startSec: r.startSec, endSec: r.endSec, text: r.text }));
}

/* ------------------------------ Briefs ------------------------------ */

export function insertBrief(
  v: { workspaceId: string; companyId: string; kind: BriefRow["kind"]; versionId: string; meetingId: string | null; builderVersion: string; content: unknown; generation: BriefGeneration; createdBy: string | null },
  db: DB = getDb(),
): BriefRow {
  const id = newId("brf");
  db.insert(s.meetingBriefs)
    .values({ id, workspaceId: v.workspaceId, companyId: v.companyId, kind: v.kind, versionId: v.versionId, meetingId: v.meetingId, builderVersion: v.builderVersion, content: v.content as never, generation: v.generation, createdBy: v.createdBy, createdAt: nowIso() })
    .run();
  return db.select().from(s.meetingBriefs).where(eq(s.meetingBriefs.id, id)).get()!;
}

export function getBrief(companyId: string, briefId: string, db: DB = getDb()): BriefRow | undefined {
  return db.select().from(s.meetingBriefs).where(and(eq(s.meetingBriefs.companyId, companyId), eq(s.meetingBriefs.id, briefId))).get();
}

/** The most recent pre-meeting brief built from this version with the given builder. */
export function preBriefForVersion(versionId: string, builderVersion: string, db: DB = getDb()): BriefRow | undefined {
  return db
    .select()
    .from(s.meetingBriefs)
    .where(and(eq(s.meetingBriefs.versionId, versionId), eq(s.meetingBriefs.kind, "PRE_MEETING_BRIEF"), eq(s.meetingBriefs.builderVersion, builderVersion)))
    .orderBy(desc(s.meetingBriefs.createdAt))
    .get();
}

export function listBriefs(companyId: string, db: DB = getDb()): BriefRow[] {
  return db.select().from(s.meetingBriefs).where(eq(s.meetingBriefs.companyId, companyId)).orderBy(desc(s.meetingBriefs.createdAt)).all();
}
