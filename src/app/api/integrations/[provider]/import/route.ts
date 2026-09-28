/**
 * POST /api/integrations/:provider/import {companyId, externalId, itemId, startTime?, title?, callDate?, participants?}
 * Downloads the transcript (or audio) with YOUR token and starts the
 * founder-meeting workflow (source ZOOM / GOOGLE_MEET). 202 {meetingId, runId, kind};
 * progress at /api/runs/:runId.
 */
import { importRemoteMeeting, ImportInput } from "@/server/connectors/import";
import { logger } from "@/lib/log";
import { crossSite, currentActor, errorResponse, providerParam } from "../../shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const provider = providerParam((await params).provider);
  if (!provider) return Response.json({ error: "Unknown integration" }, { status: 404 });
  if (crossSite(req)) return Response.json({ error: "Cross-site request refused" }, { status: 403 });
  const actor = await currentActor();
  if (!actor) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = ImportInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  try {
    const r = await importRemoteMeeting(provider, actor, parsed.data);
    r.promise.catch((e) => logger.error({ err: (e as Error).message?.slice(0, 200), runId: r.runId }, "background founder meeting (import) crashed"));
    return Response.json({ meetingId: r.meetingId, runId: r.runId, kind: r.kind }, { status: 202 });
  } catch (e) {
    return errorResponse(e, "import");
  }
}
