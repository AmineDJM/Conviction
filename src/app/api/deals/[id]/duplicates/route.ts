/**
 * POST /api/deals/:id/duplicates
 *   { action: "merge", targetId, mode? }  → re-analyse this company's documents on `targetId` as its next deck
 *                                           version; this company is soft-deleted (kept for audit, redirects)
 *   { action: "dismiss", otherId }         → "different company": remembered on both sides
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { AnalysisRequestError } from "@/server/analyze";
import { dismissDuplicate, mergeIntoCompany } from "@/server/company-merge";
import * as repo from "@/server/repo";
import { AnalysisMode } from "@/domain/enums";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("merge"), targetId: z.string().min(1), mode: AnalysisMode.optional() }),
  z.object({ action: z.literal("dismiss"), otherId: z.string().min(1) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const b = parsed.data;
  if (b.action === "dismiss") {
    if (!repo.getCompany(s.workspaceId, b.otherId)) return Response.json({ error: "Not found" }, { status: 404 });
    dismissDuplicate(s.workspaceId, s.userId, company.id, b.otherId);
    return Response.json({ ok: true });
  }
  // A merge soft-deletes this company: same roles as deletion.
  if (s.role !== "OWNER" && s.role !== "PARTNER") return Response.json({ error: "Only owners and partners can merge companies" }, { status: 403 });
  try {
    const started = await mergeIntoCompany({ workspaceId: s.workspaceId, userId: s.userId, sourceId: company.id, targetId: b.targetId, mode: b.mode });
    started.promise.catch((e) => logger.error({ err: (e as Error).message, runId: started.run.id }, "background analysis crashed"));
    return Response.json({ ok: true, slug: started.company.slug, runId: started.run.id, outcome: started.outcome, deckVersion: started.deckVersion });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof AnalysisRequestError ? e.status : 500 });
  }
}
