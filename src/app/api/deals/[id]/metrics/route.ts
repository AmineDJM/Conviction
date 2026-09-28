/**
 * POST /api/deals/:id/metrics — kept for API compatibility ("Correct this metric").
 *
 * There is one correction model: analyst overrides. This route no longer creates
 * a USER_CORRECTED metric copy; it records an override of the metric's value
 * through the same path as POST /api/deals/:id/overrides (new version, reason
 * USER_OVERRIDE, history + audit, re-index). The metric keeps its id.
 */
import { after } from "next/server";
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { commitOverride } from "@/server/overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({
  metricId: z.string().regex(/^MET-\d{3,}$/, "Invalid metric id"),
  value: z.number().finite(),
  note: z.string().trim().min(3, "Explain the correction (source or reason)").max(2000),
  /** Optional optimistic-concurrency guard: the version the analyst was looking at. */
  versionId: z.string().optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const b = parsed.data;
  const r = commitOverride({ workspaceId: s.workspaceId, userId: s.userId, name: s.name }, (await params).id, { target: "METRIC", ref: b.metricId, field: "normalizedValue", to: b.value, reason: b.note, versionId: b.versionId });
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  after(() => r.commit.reindex());
  return Response.json({ ...r.body, metricId: b.metricId, deprecated: "Use POST /api/deals/:id/overrides" });
}
