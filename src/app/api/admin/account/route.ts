/** POST /api/admin/account {current, next} → change your own password (any role); other sessions are signed out. */
import { cookies } from "next/headers";
import { z } from "zod";
import { changeOwnPassword, MemberError } from "@/server/members";
import { SESSION_COOKIE, unsignSession } from "@/server/auth";
import { requireRole } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const s = await requireRole();
  if (s instanceof Response) return s;
  const sessionId = unsignSession((await cookies()).get(SESSION_COOKIE)?.value);
  try {
    changeOwnPassword(s.workspaceId, s.userId, sessionId, (await req.json().catch(() => null)) ?? {});
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof MemberError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return Response.json({ error: e.issues.map((i) => i.message).join("; ") }, { status: 400 });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
