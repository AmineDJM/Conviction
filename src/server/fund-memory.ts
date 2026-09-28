/**
 * Fund Brain institutional memory: documented knowledge, IC members,
 * observations and meetings. Every write re-indexes fund memory for retrieval.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db/client";
import { newId, normName, nowIso } from "./ids";
import { indexFundMemory } from "@/brain/indexer";
import { CostController } from "@/ai/cost";
import { structured } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { IC_OBSERVATIONS, IcObservationsOutput, icObservationsInstructions } from "@/ai/prompts/ic-observations";
import { recordCost, audit, getCompany } from "./repo";
import { refreshPatterns } from "./fund-brain";
import { logger } from "@/lib/log";

const s = schema;

export const KnowledgeInput = z.object({
  kind: z.enum(["STRATEGY", "CRITERIA", "VERTICAL", "IC_PREFERENCE", "POLICY", "LESSON", "NOTE"]),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(20_000),
  provenance: z.enum(["DOCUMENTED", "INFERRED", "OBSERVED"]).default("DOCUMENTED"),
  sourceRef: z.string().max(500).nullable().optional(),
});

export const MemberInput = z.object({
  name: z.string().min(1).max(120),
  role: z.string().min(1).max(120),
  bio: z.string().max(4000).nullable().optional(),
  focus: z.array(z.string().max(80)).max(20).default([]),
  documentedPreferences: z.string().max(10_000).nullable().optional(),
});

export const ObservationInput = z.object({
  memberId: z.string(),
  kind: z.enum(["QUESTION", "CONCERN", "SUPPORT", "VOTE", "PATTERN"]),
  statement: z.string().min(1).max(4000),
  quote: z.string().max(4000).nullable().optional(),
  topic: z.string().max(120).nullable().optional(),
  companyId: z.string().nullable().optional(),
  provenance: z.enum(["OBSERVED", "INFERRED"]).default("OBSERVED"),
  observedAt: z.string().optional(),
});

export const MeetingInput = z.object({
  kind: z.enum(["PARTNER_MEETING", "IC", "FOUNDER_CALL"]),
  title: z.string().min(1).max(200),
  heldAt: z.string(),
  companyId: z.string().nullable().optional(),
  transcript: z.string().max(400_000).nullable().optional(),
  notes: z.string().max(40_000).nullable().optional(),
  extractObservations: z.boolean().default(true),
});

export function listFundMemory(workspaceId: string) {
  const db = getDb();
  return {
    knowledge: db.select().from(s.fundKnowledge).where(eq(s.fundKnowledge.workspaceId, workspaceId)).orderBy(desc(s.fundKnowledge.updatedAt)).all(),
    members: db.select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all(),
    observations: db.select().from(s.icObservations).where(eq(s.icObservations.workspaceId, workspaceId)).orderBy(desc(s.icObservations.observedAt)).all(),
    meetings: db
      .select({ id: s.meetings.id, kind: s.meetings.kind, title: s.meetings.title, heldAt: s.meetings.heldAt, companyId: s.meetings.companyId, hasTranscript: s.meetings.transcript })
      .from(s.meetings)
      .where(eq(s.meetings.workspaceId, workspaceId))
      .orderBy(desc(s.meetings.heldAt))
      .all()
      .map((m) => ({ ...m, hasTranscript: !!m.hasTranscript })),
  };
}

function reindex(workspaceId: string) {
  // INFERRED patterns follow the record: recomputed whenever members or observations change.
  try {
    refreshPatterns(workspaceId);
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "pattern refresh failed");
  }
  indexFundMemory(workspaceId).catch((e) => logger.warn({ err: (e as Error).message }, "fund memory reindex failed"));
}

export function addKnowledge(workspaceId: string, userId: string, input: z.infer<typeof KnowledgeInput>) {
  const id = newId("fk");
  getDb()
    .insert(s.fundKnowledge)
    .values({ id, workspaceId, ...input, sourceRef: input.sourceRef ?? null, createdAt: nowIso(), updatedAt: nowIso() })
    .run();
  audit(workspaceId, userId, "FUND_KNOWLEDGE_ADDED", id);
  reindex(workspaceId);
  return id;
}

export function deleteKnowledge(workspaceId: string, userId: string, id: string) {
  getDb().delete(s.fundKnowledge).where(and(eq(s.fundKnowledge.workspaceId, workspaceId), eq(s.fundKnowledge.id, id))).run();
  audit(workspaceId, userId, "FUND_KNOWLEDGE_DELETED", id);
  reindex(workspaceId);
}

export function addMember(workspaceId: string, userId: string, input: z.infer<typeof MemberInput>) {
  const id = newId("icm");
  getDb()
    .insert(s.icMembers)
    .values({ id, workspaceId, name: input.name, normName: normName(input.name), role: input.role, bio: input.bio ?? null, focus: input.focus, documentedPreferences: input.documentedPreferences ?? null, createdAt: nowIso() })
    .run();
  audit(workspaceId, userId, "IC_MEMBER_ADDED", id);
  reindex(workspaceId);
  return id;
}

export function updateMember(workspaceId: string, userId: string, id: string, input: z.infer<typeof MemberInput>) {
  getDb()
    .update(s.icMembers)
    .set({ name: input.name, normName: normName(input.name), role: input.role, bio: input.bio ?? null, focus: input.focus, documentedPreferences: input.documentedPreferences ?? null })
    .where(and(eq(s.icMembers.workspaceId, workspaceId), eq(s.icMembers.id, id)))
    .run();
  audit(workspaceId, userId, "IC_MEMBER_UPDATED", id);
  reindex(workspaceId);
}

export function deleteMember(workspaceId: string, userId: string, id: string) {
  getDb().delete(s.icMembers).where(and(eq(s.icMembers.workspaceId, workspaceId), eq(s.icMembers.id, id))).run();
  audit(workspaceId, userId, "IC_MEMBER_DELETED", id);
  reindex(workspaceId);
}

/** A company reference from a request must be a live company of the caller's workspace. */
function workspaceCompanyId(workspaceId: string, companyId: string | null | undefined): string | null {
  if (!companyId) return null;
  const c = getCompany(workspaceId, companyId);
  if (!c) throw new Error("Unknown company");
  return c.id;
}

export function addObservation(workspaceId: string, userId: string, input: z.infer<typeof ObservationInput>, meetingId: string | null = null, reindexNow = true) {
  const member = getDb().select().from(s.icMembers).where(and(eq(s.icMembers.workspaceId, workspaceId), eq(s.icMembers.id, input.memberId))).get();
  if (!member) throw new Error("Unknown IC member");
  const companyId = workspaceCompanyId(workspaceId, input.companyId);
  const id = newId("obs");
  getDb()
    .insert(s.icObservations)
    .values({
      id,
      workspaceId,
      memberId: input.memberId,
      meetingId,
      companyId,
      kind: input.kind,
      statement: input.statement,
      quote: input.quote ?? null,
      topic: input.topic ?? null,
      provenance: input.provenance,
      observedAt: input.observedAt ?? nowIso(),
    })
    .run();
  if (reindexNow) {
    audit(workspaceId, userId, "IC_OBSERVATION_ADDED", id);
    reindex(workspaceId);
  }
  return id;
}

export function deleteObservation(workspaceId: string, userId: string, id: string) {
  getDb().delete(s.icObservations).where(and(eq(s.icObservations.workspaceId, workspaceId), eq(s.icObservations.id, id))).run();
  audit(workspaceId, userId, "IC_OBSERVATION_DELETED", id);
  reindex(workspaceId);
}

/** Store a meeting and (optionally) extract verbatim-backed observations for registered IC members. */
export async function addMeeting(workspaceId: string, userId: string, input: z.infer<typeof MeetingInput>) {
  const db = getDb();
  const companyId = workspaceCompanyId(workspaceId, input.companyId);
  const id = newId("mtg");
  db.insert(s.meetings)
    .values({ id, workspaceId, kind: input.kind, title: input.title, heldAt: input.heldAt, companyId, transcript: input.transcript ?? null, notes: input.notes ?? null, createdAt: nowIso() })
    .run();
  audit(workspaceId, userId, "MEETING_ADDED", id);
  let extracted = 0;
  const members = db.select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all();
  if (input.extractObservations && input.transcript && members.length) {
    const cost = new CostController(0.08, 0.08, (e) => recordCost(workspaceId, null, "ANALYSIS", e));
    const res = await structured({
      step: "IC_OBSERVATIONS",
      promptVersion: IC_OBSERVATIONS.version,
      instructions: icObservationsInstructions(members.map((m) => m.name)),
      input: [{ role: "user", content: wrapUntrusted("meeting transcript", input.transcript.slice(0, 180_000)) }],
      schema: IcObservationsOutput,
      schemaName: "ic_observations",
      maxOutputTokens: 6000,
      effort: "low",
      cost,
    });
    const companies = db.select({ id: s.companies.id, norm: s.companies.normName }).from(s.companies).where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt))).all();
    for (const o of res.data.observations) {
      const m = members.find((x) => x.normName === normName(o.memberName));
      // Only keep observations whose quote actually appears in the transcript.
      if (!m || !o.quote || !input.transcript.includes(o.quote.slice(0, 40))) continue;
      const co = o.companyName ? companies.find((c) => c.norm === normName(o.companyName!)) : null;
      addObservation(workspaceId, userId, { memberId: m.id, kind: o.kind, statement: o.statement, quote: o.quote, topic: o.topic, companyId: co?.id ?? companyId, provenance: "OBSERVED", observedAt: input.heldAt }, id, false);
      extracted++;
    }
  }
  reindex(workspaceId);
  return { id, extracted };
}
