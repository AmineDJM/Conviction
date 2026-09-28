/**
 * POST /api/deals/:id/refresh — refresh only stale data (orchestration/refresh.ts).
 * Body (optional): {budgetUsd} — bounded server-side ($0.02–$0.25, default REFRESH_BUDGET_USD).
 * 202 {runId, items} when a run starts (poll /api/runs/:id, cancel /api/runs/:id/cancel);
 * 200 {noop: true, message} when nothing is stale — no run, no version, no model call.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { RefreshError, startRefresh } from "@/orchestration/refresh";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ budgetUsd: z.number().positive().max(1).nullable().optional() }).nullable();

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
    const r = await startRefresh({ workspaceId: s.workspaceId, userId: s.userId, companyIdOrSlug: (await params).id, budgetUsd: parsed.data?.budgetUsd ?? null });
    if (r.noop) return Response.json({ noop: true, message: r.message });
    r.promise.catch((e) => logger.error({ err: (e as Error).message, runId: r.run.id }, "background refresh crashed"));
    return Response.json({ runId: r.run.id, items: r.plan.items.map((x) => x.key) }, { status: 202 });
  } catch (e) {
    if (e instanceof RefreshError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `Could not start the refresh: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
