/**
 * POST /api/deals/:id/questions — record that a founder question was asked,
 * store the answer, and mark it resolved / not fully resolved (§63–65).
 * Creates a new canonical version (reason QUESTION_UPDATE).
 */
import { after } from "next/server";
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { QuestionStatus } from "@/domain/enums";
import { commitCanonicalUpdate } from "@/server/versioning";
import { applyQuestionUpdate, CorrectionError } from "@/orchestration/corrections";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  questionId: z.string().regex(/^Q-\d{2,}$/, "Invalid question id"),
  status: QuestionStatus,
  answer: z.string().max(8000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  versionId: z.string().optional(),
});

const STATUS_TEXT: Record<string, string> = { OPEN: "reopened", ASKED: "asked", RESOLVED: "resolved", NOT_FULLY_RESOLVED: "not fully resolved" };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;

  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const current = repo.getCurrentVersion(company);
  if (!current) return Response.json({ error: "No analysis version" }, { status: 409 });
  if (body.versionId && body.versionId !== current.row.id) return Response.json({ error: "This deal changed since you loaded it. Reload and try again." }, { status: 409 });

  try {
    const { deal, before, after: q } = applyQuestionUpdate(current.canonical, { questionId: body.questionId, status: body.status, answer: body.answer, note: body.note });
    const unchanged = before.status === q.status && before.answer === q.answer && before.resolutionNote === q.resolutionNote;
    if (unchanged) return Response.json({ ok: true, unchanged: true, versionId: current.row.id });
    const verb = before.status === q.status ? "answer updated" : STATUS_TEXT[q.status];
    const res = commitCanonicalUpdate({
      workspaceId: s.workspaceId,
      userId: s.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "QUESTION_UPDATE",
      summary: `${q.id} ${verb}`,
      history: {
        type: "QUESTION_UPDATED",
        summary: `${q.id} ${verb}: ${q.question.slice(0, 140)}`,
        payload: { questionId: q.id, from: before.status, to: q.status, answered: !!q.answer },
      },
      audit: { action: "QUESTION_UPDATED", detail: `${q.id} ${before.status} → ${q.status}` },
    });
    after(() => res.reindex());
    return Response.json({ ok: true, versionId: res.version.id, versionNo: res.version.versionNo, question: q, recommendationChanged: res.recommendationChanged });
  } catch (e) {
    if (e instanceof CorrectionError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: `Could not update question: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
