/** Role guard for /api/admin/* route handlers. */
import { apiSession } from "@/server/session";
import type { SessionContext } from "@/server/auth";

export async function requireRole(...roles: SessionContext["role"][]): Promise<SessionContext | Response> {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (roles.length && !roles.includes(s.role)) return Response.json({ error: `Requires role: ${roles.join(" or ")}` }, { status: 403 });
  return s;
}
