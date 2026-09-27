import { apiSession, canWrite } from "@/server/session";
import { startAnalysis } from "@/server/analyze";
import { AnalysisMode } from "@/domain/enums";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(req: Request) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const mode = AnalysisMode.safeParse(form.get("mode") ?? "STANDARD");
  if (!mode.success) return Response.json({ error: "Invalid mode" }, { status: 400 });
  if (!files.length) return Response.json({ error: "Add at least one document" }, { status: 400 });
  try {
    const { company, run, promise } = await startAnalysis({
      workspaceId: s.workspaceId,
      userId: s.userId,
      mode: mode.data,
      companyName: (form.get("name") as string | null) || null,
      companyUrl: (form.get("url") as string | null) || null,
      files: await Promise.all(files.map(async (f) => ({ filename: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) }))),
    });
    // The pipeline continues in the background; progress is persisted on the run.
    promise.catch((e) => logger.error({ err: (e as Error).message, runId: run.id }, "background analysis crashed"));
    return Response.json({ companyId: company.id, runId: run.id, slug: company.slug });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
