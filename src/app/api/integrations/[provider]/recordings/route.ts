/**
 * GET /api/integrations/:provider/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD —
 * your own cloud recordings (Zoom) / conference records (Meet) in the range,
 * with their importable transcript / audio items. Uses only your connection.
 */
import { listRemoteMeetings } from "@/server/connectors/import";
import { currentActor, errorResponse, providerParam } from "../../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerParam((await params).provider);
  if (!provider) return Response.json({ error: "Unknown integration" }, { status: 404 });
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const to = q.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = q.get("from") ?? new Date(Date.parse(to) - 29 * 864e5).toISOString().slice(0, 10);
  try {
    return Response.json({ meetings: await listRemoteMeetings(provider, actor, { from, to }) }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return errorResponse(e, "list recordings");
  }
}
