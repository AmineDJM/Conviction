/**
 * POST /api/deals/:id/analysis-feedback — human utility of one analysis version (§129):
 *   { versionId, betterQuestions, importantRisks, missingEvidence, marketInsight, minutesSaved?, note? }
 *
 * One judgement per user per version (a new one replaces it). Audited.
 * Summarized on /quality; never feeds any score.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { recordAnalysisFeedback } from "@/server/question-feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  versionId: z.string().min(1).max(64),
  betterQuestions: z.boolean(),
  importantRisks: z.boolean(),
  missingEvidence: z.boolean(),
  marketInsight: z.boolean(),
  minutesSaved: z.number().int().min(-600).max(6000).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
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
  const version = repo.getVersion(company.id, body.versionId);
  if (!version) return Response.json({ error: "Unknown analysis version" }, { status: 404 });

  const row = recordAnalysisFeedback({
    workspaceId: s.workspaceId,
    companyId: company.id,
    versionId: version.row.id,
    userId: s.userId,
    betterQuestions: body.betterQuestions,
    importantRisks: body.importantRisks,
    missingEvidence: body.missingEvidence,
    marketInsight: body.marketInsight,
    minutesSaved: body.minutesSaved ?? null,
    note: body.note ?? null,
  });
  const flags = (["betterQuestions", "importantRisks", "missingEvidence", "marketInsight"] as const).filter((k) => body[k]).join(",") || "none";
  repo.audit(s.workspaceId, s.userId, "ANALYSIS_FEEDBACK", company.id, `v${version.row.versionNo}: ${flags}; minutes saved ${body.minutesSaved ?? "n/a"}`);
  return Response.json({ ok: true, feedback: row });
}
