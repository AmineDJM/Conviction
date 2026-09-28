/**
 * PATCH /api/deals/:id/meetings/:meetingId {speakerNames} — name diarized
 * speakers ("A" → "Maya Chen, CEO"). Display metadata only: the verbatim
 * segments, the briefs and the analysis versions are not rewritten.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Body = z.object({ speakerNames: z.record(z.string().max(40), z.string().max(80)) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; meetingId: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const { id, meetingId } = await params;
  const company = repo.getCompany(s.workspaceId, id);
  const meeting = company && meetings.getMeeting(company.id, meetingId);
  if (!company || !meeting) return Response.json({ error: "Not found" }, { status: 404 });
  const labels = new Set(meetings.getSegments(meeting.id).map((x) => x.speaker).filter(Boolean));
  const names = Object.fromEntries(Object.entries(parsed.data.speakerNames).filter(([k, v]) => labels.has(k) && v.trim()).map(([k, v]) => [k, v.trim()]));
  meetings.updateMeeting(meeting.id, { speakerNames: names });
  repo.audit(s.workspaceId, s.userId, "MEETING_SPEAKERS_NAMED", company.id, `${meeting.id}: ${Object.keys(names).length} speaker(s)`);
  return Response.json({ ok: true, speakerNames: names });
}
