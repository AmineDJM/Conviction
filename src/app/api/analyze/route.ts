/**
 * POST /api/analyze (multipart): files[], mode, name?, url?, force?
 *   companyId + intent (NEW_DECK_VERSION | ADD_DOCUMENTS): analyse on that existing company (deck-version flow)
 *   distinctFrom[]: companies the user confirmed this upload is NOT (duplicate prompt answered "different company")
 */
import { apiSession, canWrite } from "@/server/session";
import { AnalysisRequestError, startAnalysis } from "@/server/analyze";
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
  const companyId = (form.get("companyId") as string | null) || null;
  const intent = (form.get("intent") as string | null) || "NEW_DECK_VERSION";
  if (companyId && intent !== "NEW_DECK_VERSION" && intent !== "ADD_DOCUMENTS") return Response.json({ error: "Invalid intent" }, { status: 400 });
  try {
    const { company, run, promise, outcome, deckVersion } = await startAnalysis({
      workspaceId: s.workspaceId,
      userId: s.userId,
      mode: mode.data,
      companyName: (form.get("name") as string | null) || null,
      companyUrl: (form.get("url") as string | null) || null,
      force: form.get("force") === "1",
      target: companyId ? { companyId, intent: intent as "NEW_DECK_VERSION" | "ADD_DOCUMENTS" } : null,
      distinctFrom: form.getAll("distinctFrom").filter((x): x is string => typeof x === "string" && x.length > 0),
      files: await Promise.all(files.map(async (f) => ({ filename: f.name, mime: f.type, data: Buffer.from(await f.arrayBuffer()) }))),
    });
    // The pipeline continues in the background; progress is persisted on the run.
    promise.catch((e) => logger.error({ err: (e as Error).message, runId: run.id }, "background analysis crashed"));
    return Response.json({ companyId: company.id, runId: run.id, slug: company.slug, outcome, deckVersion });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof AnalysisRequestError ? e.status : 400 });
  }
}
