/**
 * POST /api/deals/:id/reanalyze — re-run the analysis on the documents already on record (after a failed or
 * interrupted run). Body (optional): {mode}. 202 {runId}; poll /api/runs/:id.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { AnalysisRequestError, retryAnalysis } from "@/server/analyze";
import { ANALYSIS_MODES } from "@/domain/enums";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ mode: z.enum(ANALYSIS_MODES).optional() }).nullable();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const text = await req.text().catch(() => "");
  let json: unknown = null;
  try {
    json = text.trim() ? JSON.parse(text) : null;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Body.safeParse(json);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  try {
    const r = await retryAnalysis({ workspaceId: s.workspaceId, userId: s.userId, companyIdOrSlug: (await params).id, mode: parsed.data?.mode });
    r.promise.catch((e: unknown) => logger.error({ err: (e as Error).message, runId: r.run.id }, "background re-analysis crashed"));
    return Response.json({ runId: r.run.id }, { status: 202 });
  } catch (e) {
    if (e instanceof AnalysisRequestError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: "Could not start the analysis" }, { status: 500 });
  }
}
