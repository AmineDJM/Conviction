import { apiSession, canWrite } from "@/server/session";
import { getRun } from "@/server/repo";
import { cancelRun } from "@/orchestration/run-control";

export const dynamic = "force-dynamic";

/** Cancel a running analysis. Work already done is kept as a PARTIAL version; nothing is invented. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const run = getRun(s.workspaceId, (await params).id);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  if (run.status !== "RUNNING" && run.status !== "QUEUED") return Response.json({ error: `Run is ${run.status}` }, { status: 409 });
  return Response.json({ cancelled: cancelRun(run.id) });
}
