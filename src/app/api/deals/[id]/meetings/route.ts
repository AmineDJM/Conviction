/**
 * POST /api/deals/:id/meetings — ingest a founder meeting (meetings workflow).
 *
 *  JSON       {transcript, title?, callDate?, participants?}
 *  multipart  file = transcript (.txt .md .vtt .srt) or recording (wav, mp3, m4a, mp4, webm, ogg, flac),
 *             or transcript = text; title?, callDate?, participants? (JSON array)
 *
 * Freezes the current version as the meeting's PRE_MEETING_ANALYSIS and returns
 * {meetingId, runId} immediately; transcription and the post-meeting pass run in
 * the background (progress: /api/runs/:runId).
 */
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { FounderCallError, MAX_TRANSCRIPT_CHARS, startFounderCall } from "@/orchestration/founder-call";
import { AUDIO_EXTENSIONS, MAX_RECORDING_BYTES } from "@/ai/transcribe";
import { MeetingParticipant } from "@/domain/meetings";
import { logger } from "@/lib/log";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 800;

const Meta = z.object({
  title: z.string().max(200).nullable().optional(),
  callDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  participants: z.array(MeetingParticipant).max(20).optional(),
});
const Json = Meta.extend({ transcript: z.string().max(MAX_TRANSCRIPT_CHARS + 10_000), filename: z.string().max(200).nullable().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const companyIdOrSlug = (await params).id;
  try {
    let input: Parameters<typeof startFounderCall>[0];
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      let participants: unknown = [];
      try {
        participants = JSON.parse((form.get("participants") as string | null) || "[]");
      } catch {
        return Response.json({ error: "participants must be a JSON array" }, { status: 400 });
      }
      const meta = Meta.safeParse({ title: (form.get("title") as string | null) || null, callDate: (form.get("callDate") as string | null) || null, participants });
      if (!meta.success) return Response.json({ error: meta.error.issues[0]?.message ?? "Invalid fields" }, { status: 400 });
      const file = form.get("file");
      input = { workspaceId: s.workspaceId, userId: s.userId, companyIdOrSlug, ...meta.data };
      if (file instanceof File && file.size > 0) {
        if (AUDIO_EXTENSIONS.test(file.name) || file.type.startsWith("audio/") || file.type.startsWith("video/")) {
          if (file.size > MAX_RECORDING_BYTES) return Response.json({ error: `Recording exceeds ${MAX_RECORDING_BYTES / 1024 / 1024} MB` }, { status: 400 });
          input.recording = { data: Buffer.from(await file.arrayBuffer()), filename: file.name, mime: file.type };
        } else if (/\.(txt|md|vtt|srt)$/i.test(file.name) || file.type.startsWith("text/")) {
          if (file.size > 2 * 1024 * 1024) return Response.json({ error: "Transcript file exceeds 2 MB" }, { status: 400 });
          input.transcript = await file.text();
          input.filename = file.name;
        } else return Response.json({ error: "Upload a transcript (.txt, .md, .vtt, .srt) or a recording (wav, mp3, m4a, mp4, webm, ogg, flac)" }, { status: 400 });
      } else input.transcript = (form.get("transcript") as string | null) ?? "";
    } else {
      const parsed = Json.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
      input = { workspaceId: s.workspaceId, userId: s.userId, companyIdOrSlug, ...parsed.data };
    }
    const { run, meeting, promise } = await startFounderCall(input);
    promise.catch((e) => logger.error({ err: (e as Error).message, runId: run.id }, "background founder meeting crashed"));
    return Response.json({ meetingId: meeting.id, runId: run.id }, { status: 202 });
  } catch (e) {
    if (e instanceof FounderCallError) return Response.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return Response.json({ error: e.issues[0]?.message ?? "Invalid input" }, { status: 400 });
    return Response.json({ error: `Could not start the meeting workflow: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
