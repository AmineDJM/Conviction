/** GET /api/admin/consistency → projection / facts / memory / chunk violations for this workspace (OWNER, PARTNER). */
import { checkConsistency } from "@/server/consistency";
import { requireRole } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const s = await requireRole("OWNER", "PARTNER");
  if (s instanceof Response) return s;
  const report = checkConsistency(s.workspaceId);
  return Response.json({ ok: report.violations.length === 0, ...report });
}
