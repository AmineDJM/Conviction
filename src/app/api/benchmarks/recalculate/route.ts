import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { recalculatePortfolio } from "@/server/recalculate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({ registryId: z.string().optional(), reason: z.enum(["BENCHMARK_RECALC", "FUND_PROFILE_CHANGE"]).optional() });

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  try {
    const rows = await recalculatePortfolio(s.workspaceId, s.userId, parsed.data.registryId, parsed.data.reason);
    return Response.json({ rows });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
