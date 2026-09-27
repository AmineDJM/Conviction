/**
 * POST /api/deals/:id/metrics — analyst correction of a metric instance (§16).
 * Creates a new canonical version (reason METRIC_CORRECTION); the original
 * instance is preserved as the audit trail.
 */
import { after } from "next/server";
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { commitCanonicalUpdate } from "@/server/versioning";
import { applyMetricCorrection, CorrectionError } from "@/orchestration/corrections";
import { metricValue } from "@/lib/format";

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
  const body = parsed.data;

  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const current = repo.getCurrentVersion(company);
  if (!current) return Response.json({ error: "No analysis version to correct" }, { status: 409 });
  if (body.versionId && body.versionId !== current.row.id) return Response.json({ error: "This deal changed since you loaded it. Reload and try again." }, { status: 409 });

  try {
    const { deal, corrected, previous } = applyMetricCorrection(current.canonical, { metricId: body.metricId, value: body.value, note: body.note, actor: s.name });
    const label = corrected.label || corrected.metricKey;
    const res = commitCanonicalUpdate({
      workspaceId: s.workspaceId,
      userId: s.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "METRIC_CORRECTION",
      summary: `${label}: ${previous.rawValue} → ${metricValue(corrected.unit, body.value)} (analyst correction)`,
      history: {
        type: "METRIC_CORRECTED",
        summary: `${label} (${previous.id}) corrected: ${previous.rawValue} → ${metricValue(corrected.unit, body.value)}`,
        payload: { metricId: previous.id, correctedId: corrected.id, metricKey: corrected.metricKey, from: previous.normalizedValue, to: body.value, unit: corrected.unit, note: body.note },
      },
      audit: { action: "METRIC_CORRECTED", detail: `${previous.id} → ${corrected.id}` },
    });
    after(() => res.reindex());
    return Response.json({ ok: true, versionId: res.version.id, versionNo: res.version.versionNo, metricId: corrected.id, recommendation: res.derived.recommendation.status, recommendationChanged: res.recommendationChanged });
  } catch (e) {
    if (e instanceof CorrectionError) return Response.json({ error: e.message }, { status: 400 });
    return Response.json({ error: `Could not save correction: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
