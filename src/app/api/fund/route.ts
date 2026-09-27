/**
 * Fund Brain memory API.
 *   GET                         → profile + knowledge + members + observations + meetings
 *   PUT    {profile}            → update fund profile (re-derivation happens on next analysis / recalculation)
 *   POST   {type, ...}          → create knowledge | member | observation | meeting
 *   PATCH  {type:"member", id}  → update member
 *   DELETE ?type=&id=           → delete knowledge | member | observation
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { FundProfile } from "@/domain/fund";
import { getDefaultFund, upsertDefaultFund, audit } from "@/server/repo";
import * as fm from "@/server/fund-memory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const s = await apiSession();
  if (s instanceof Response) return s;
  return Response.json({ profile: getDefaultFund(s.workspaceId), ...fm.listFundMemory(s.workspaceId) });
}

export async function PUT(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = FundProfile.safeParse({ ...getDefaultFund(s.workspaceId), ...(body?.profile ?? {}) });
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  upsertDefaultFund(s.workspaceId, parsed.data);
  audit(s.workspaceId, s.userId, "FUND_PROFILE_UPDATED");
  return Response.json({ ok: true, profile: getDefaultFund(s.workspaceId) });
}

const PostBody = z.discriminatedUnion("type", [
  z.object({ type: z.literal("knowledge"), data: fm.KnowledgeInput }),
  z.object({ type: z.literal("member"), data: fm.MemberInput }),
  z.object({ type: z.literal("observation"), data: fm.ObservationInput }),
  z.object({ type: z.literal("meeting"), data: fm.MeetingInput }),
]);

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = PostBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  try {
    const b = parsed.data;
    if (b.type === "knowledge") return Response.json({ id: fm.addKnowledge(s.workspaceId, s.userId, b.data) });
    if (b.type === "member") return Response.json({ id: fm.addMember(s.workspaceId, s.userId, b.data) });
    if (b.type === "observation") return Response.json({ id: fm.addObservation(s.workspaceId, s.userId, b.data) });
    return Response.json(await fm.addMeeting(s.workspaceId, s.userId, b.data));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function PATCH(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const body = await req.json().catch(() => null);
  const parsed = fm.MemberInput.safeParse(body?.data);
  if (!parsed.success || typeof body?.id !== "string") return Response.json({ error: "Invalid member" }, { status: 400 });
  fm.updateMember(s.workspaceId, s.userId, body.id, parsed.data);
  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const type = url.searchParams.get("type");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  if (type === "knowledge") fm.deleteKnowledge(s.workspaceId, s.userId, id);
  else if (type === "member") fm.deleteMember(s.workspaceId, s.userId, id);
  else if (type === "observation") fm.deleteObservation(s.workspaceId, s.userId, id);
  else return Response.json({ error: "Unknown type" }, { status: 400 });
  return Response.json({ ok: true });
}
