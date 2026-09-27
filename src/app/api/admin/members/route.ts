/**
 * Workspace members (all mutations OWNER-only and audited).
 *   GET                                  → members
 *   POST   {email, name, role}           → invite: creates the account, returns a one-time temporary password
 *   POST   {action:"reset", userId}      → new one-time temporary password, member signed out
 *   PATCH  {userId, role}                → change role (the last owner cannot be demoted)
 *   DELETE ?userId=                      → remove member (never the last owner)
 */
import { z } from "zod";
import * as members from "@/server/members";
import { requireRole } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fail(e: unknown) {
  if (e instanceof members.MemberError) return Response.json({ error: e.message }, { status: e.status });
  if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 400 });
  return Response.json({ error: (e as Error).message }, { status: 500 });
}

export async function GET() {
  const s = await requireRole();
  if (s instanceof Response) return s;
  return Response.json({ members: members.listMembers(s.workspaceId) });
}

export async function POST(req: Request) {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  const body = await req.json().catch(() => null);
  try {
    if (body?.action === "reset") {
      if (typeof body.userId !== "string") return Response.json({ error: "Missing userId" }, { status: 400 });
      return Response.json(members.resetPassword(s.workspaceId, s.userId, body.userId));
    }
    return Response.json(members.inviteMember(s.workspaceId, s.userId, body ?? {}));
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request) {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  const parsed = z.object({ userId: z.string().min(1), role: members.Role }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  try {
    return Response.json(members.changeRole(s.workspaceId, s.userId, parsed.data.userId, parsed.data.role));
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request) {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });
  try {
    members.removeMember(s.workspaceId, s.userId, userId);
    return Response.json({ ok: true, self: userId === s.userId });
  } catch (e) {
    return fail(e);
  }
}
