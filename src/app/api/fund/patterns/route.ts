/** POST → recompute INFERRED fund patterns from recorded observations and IC decisions. */
import { apiSession, canWrite } from "@/server/session";
import { refreshPatterns } from "@/server/fund-brain";
import { audit } from "@/server/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const patterns = refreshPatterns(s.workspaceId);
  audit(s.workspaceId, s.userId, "FUND_PATTERNS_REFRESHED", undefined, `${patterns.length} pattern(s)`);
  return Response.json({ count: patterns.length, patterns });
}
