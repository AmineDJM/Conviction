/**
 * POST /api/deals/:id/founder-call — add a founder call transcript (§65).
 * Accepts JSON {transcript, filename?, callDate?} or multipart with a .txt
 * `file` (or a `transcript` field). Returns the run id immediately; the model
 * pass runs in the background and the client polls /api/runs/:id.
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { FounderCallError, MAX_TRANSCRIPT_CHARS, startFounderCall } from "@/orchestration/founder-call";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const Body = z.object({
  transcript: z.string().max(MAX_TRANSCRIPT_CHARS + 10_000),
  filename: z.string().max(200).nullable().optional(),
  callDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

async function readBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    let transcript = (form.get("transcript") as string | null) ?? "";
    let filename = (form.get("filename") as string | null) ?? null;
    if (file instanceof File && file.size > 0) {
      if (!/\.(txt|md|vtt|srt)$/i.test(file.name) && !file.type.startsWith("text/")) throw new FounderCallError("Upload a plain-text transcript (.txt)");
      if (file.size > 2 * 1024 * 1024) throw new FounderCallError("Transcript file exceeds 2 MB");
      transcript = await file.text();
      filename = file.name;
    }
    return { transcript, filename, callDate: (form.get("callDate") as string | null) || null };
  }
  return req.json().catch(() => null);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  try {
    const parsed = Body.safeParse(await readBody(req));
    if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    const { run, promise } = await startFounderCall({
      workspaceId: s.workspaceId,
      userId: s.userId,
      companyIdOrSlug: (await params).id,
      transcript: parsed.data.transcript,
      filename: parsed.data.filename,
      callDate: parsed.data.callDate,
    });
    promise.catch((e) => logger.error({ err: (e as Error).message, runId: run.id }, "background founder call crashed"));
    return Response.json({ runId: run.id }, { status: 202 });
  } catch (e) {
    if (e instanceof FounderCallError) return Response.json({ error: e.message }, { status: e.status });
    return Response.json({ error: `Could not start founder call update: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
