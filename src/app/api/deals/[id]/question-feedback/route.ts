/**
 * POST /api/deals/:id/question-feedback — "Was this founder question useful?"
 *   { questionId, versionId, verdict: USEFUL | NOT_USEFUL | ALREADY_KNOWN, note?, source?: MANUAL | AFTER_MEETING, meetingId? }
 *
 * Stored per question per analysis version (one judgement per user; a new one
 * replaces it). Does not create a version: feedback is about the analysis, not
 * part of it. Audited. Summarized on /quality (useful-question rate).
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { getDb, schema } from "@/db/client";
import { QUESTION_VERDICTS, recordQuestionFeedback } from "@/server/question-feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  questionId: z.string().regex(/^Q-\d{2,}$/, "Invalid question id"),
  versionId: z.string().min(1).max(64),
  verdict: z.enum(QUESTION_VERDICTS),
  note: z.string().trim().max(1000).nullable().optional(),
  source: z.enum(["MANUAL", "AFTER_MEETING"]).default("MANUAL"),
  meetingId: z.string().max(64).nullable().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;

  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  // Any version of this company (feedback may be given on the version the meeting used).
  const version = repo.getVersion(company.id, body.versionId);
  if (!version) return Response.json({ error: "Unknown analysis version" }, { status: 404 });
  const q = version.canonical.questions.find((x) => x.id === body.questionId);
  if (!q) return Response.json({ error: `Unknown question ${body.questionId} in this version` }, { status: 404 });
  if (body.meetingId) {
    const m = getDb()
      .select({ id: schema.founderMeetings.id })
      .from(schema.founderMeetings)
      .where(and(eq(schema.founderMeetings.id, body.meetingId), eq(schema.founderMeetings.companyId, company.id)))
      .get();
    if (!m) return Response.json({ error: "Unknown meeting" }, { status: 404 });
  }

  const row = recordQuestionFeedback({
    workspaceId: s.workspaceId,
    companyId: company.id,
    versionId: version.row.id,
    userId: s.userId,
    question: q,
    verdict: body.verdict,
    note: body.note ?? null,
    source: body.meetingId ? "AFTER_MEETING" : body.source,
    meetingId: body.meetingId ?? null,
  });
  repo.audit(s.workspaceId, s.userId, "QUESTION_FEEDBACK", company.id, `${q.id} (${version.row.id}) ${body.verdict}${row.note ? " + note" : ""}`);
  return Response.json({ ok: true, feedback: { questionId: q.id, verdict: row.verdict, note: row.note, versionId: row.versionId } });
}
