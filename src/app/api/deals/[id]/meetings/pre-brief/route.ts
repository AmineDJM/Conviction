/**
 * POST /api/deals/:id/meetings/pre-brief {versionId?} — build (or return) the
 * PRE_MEETING_BRIEF for the current version (or a given version). Deterministic
 * with one small cached model step (≤ $0.01); idempotent per version.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { ensurePreMeetingBrief } from "@/orchestration/pre-meeting-brief";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const Body = z.object({ versionId: z.string().max(64).nullable().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const version = parsed.data.versionId ? repo.getVersion(company.id, parsed.data.versionId) : repo.getCurrentVersion(company);
  if (!version) return Response.json({ error: "No analysis version" }, { status: 409 });
  try {
    const brief = await ensurePreMeetingBrief({ workspaceId: s.workspaceId, userId: s.userId, company, version });
    return Response.json({ briefId: brief.id, generation: brief.generation });
  } catch (e) {
    return Response.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
