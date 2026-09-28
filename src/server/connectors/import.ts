/**
 * Import a Zoom / Google Meet recording into the founder-meeting workflow.
 *
 * Listing and import always use the ACTING user's own connection
 * (withAccessToken looks it up by workspace + user). The imported transcript
 * enters through the same entry point as an upload — startFounderCall — with
 * source ZOOM / GOOGLE_MEET, so parsing, storage (encrypted TRANSCRIPT
 * document + segments), the frozen pre-meeting analysis, the run and its
 * audit entry are identical to a manual upload.
 *
 *   Zoom        TRANSCRIPT (VTT)  → transcript text → parser (speakers + cue times)
 *               AUDIO (M4A/MP4)   → recording → transcription path (fallback)
 *   Google Meet transcript entries → WebVTT with <v Speaker> voice spans → parser
 *               entries expired    → transcript Doc exported via Drive → parser
 */
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema as s, type DB } from "@/db/client";
import { MeetingParticipant } from "@/domain/meetings";
import { MAX_RECORDING_BYTES, TranscriptionError, splitRecording } from "@/ai/transcribe";
import { startFounderCall } from "@/orchestration/founder-call";
import type { SessionContext } from "@/server/auth";
import * as repo from "@/server/repo";
import { newId, nowIso, slugify } from "@/server/ids";
import { IntegrationError } from "./http";
import { SPECS, type ConnectorId } from "./meeting-connectors";
import { withAccessToken } from "./oauth";
import * as zoom from "./zoom";
import * as meet from "./google-meet";

export interface Owner {
  workspaceId: string;
  userId: string;
  role: SessionContext["role"];
}

export interface RemoteItem {
  id: string;
  kind: "TRANSCRIPT" | "AUDIO";
  label: string;
  sizeBytes: number | null;
  importable: boolean;
  note: string | null;
}

export interface RemoteMeeting {
  provider: ConnectorId;
  externalId: string;
  title: string;
  startTime: string | null;
  localDate: string;
  durationSec: number | null;
  items: RemoteItem[];
  imported: { companyId: string; companyName: string; meetingId: string; at: string }[];
}

const ENTRY_RETENTION_DAYS = 30;
const MAX_RANGE_DAYS = 31;

function requireWriter(owner: Owner) {
  if (owner.role === "VIEWER") throw new IntegrationError("FORBIDDEN", "Your role is read-only; a partner or analyst can import meetings.");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function validateRange(from: string, to: string): { from: string; to: string } {
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) throw new IntegrationError("INVALID", "Dates must be YYYY-MM-DD");
  const days = (Date.parse(to) - Date.parse(from)) / 864e5;
  if (days < 0) throw new IntegrationError("INVALID", "The start date is after the end date");
  if (days > MAX_RANGE_DAYS - 1) throw new IntegrationError("INVALID", `Choose a range of at most ${MAX_RANGE_DAYS} days (Zoom lists one month per request)`);
  return { from, to };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]!);
      }
    }),
  );
  return out;
}

function importedIndex(workspaceId: string, provider: ConnectorId, externalIds: string[], db: DB) {
  const map = new Map<string, RemoteMeeting["imported"]>();
  if (!externalIds.length) return map;
  const rows = db
    .select({ externalId: s.integrationImports.externalId, companyId: s.integrationImports.companyId, companyName: s.companies.name, meetingId: s.integrationImports.meetingId, at: s.integrationImports.createdAt })
    .from(s.integrationImports)
    .innerJoin(s.companies, eq(s.companies.id, s.integrationImports.companyId))
    .where(and(eq(s.integrationImports.workspaceId, workspaceId), eq(s.integrationImports.provider, provider), inArray(s.integrationImports.externalId, externalIds.slice(0, 500))))
    .all();
  for (const r of rows) map.set(r.externalId, [...(map.get(r.externalId) ?? []), { companyId: r.companyId, companyName: r.companyName, meetingId: r.meetingId, at: r.at }]);
  return map;
}

const mb = (n: number | null | undefined) => (!n ? "" : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/* ------------------------------ Listing ------------------------------ */

export async function listRemoteMeetings(provider: ConnectorId, owner: Owner, range: { from: string; to: string }, db: DB = getDb()): Promise<RemoteMeeting[]> {
  requireWriter(owner);
  const { from, to } = validateRange(range.from, range.to);
  const list = await withAccessToken(
    provider,
    owner,
    async (token, row): Promise<Omit<RemoteMeeting, "imported">[]> => {
      if (provider === "zoom") {
        const meetings = await zoom.listZoomRecordings(token, from, to);
        return meetings.map((m) => {
          const items: RemoteItem[] = [];
          const t = zoom.zoomTranscriptFile(m);
          if (t) {
            const why = zoom.zoomTranscriptBlocker(t);
            items.push({ id: t.id!, kind: "TRANSCRIPT", label: `Transcript (VTT${t.file_size ? `, ${mb(t.file_size)}` : ""}) — speakers and timestamps`, sizeBytes: t.file_size ?? null, importable: !why, note: why });
          }
          const a = zoom.zoomAudioFile(m);
          if (a) {
            const why = zoom.zoomAudioBlocker(a);
            items.push({ id: a.id!, kind: "AUDIO", label: `Audio (${(a.file_type ?? "").toUpperCase()}${a.file_size ? `, ${mb(a.file_size)}` : ""}) — transcribed with speaker labels`, sizeBytes: a.file_size ?? null, importable: !why, note: why });
          }
          return { provider, externalId: m.uuid, title: (m.topic ?? "").trim() || "Zoom meeting", startTime: m.start_time ?? null, localDate: zoom.zoomLocalDate(m), durationSec: m.duration ? m.duration * 60 : null, items };
        });
      }
      const scopes = row.scopes.split(/\s+/).filter(Boolean);
      const drive = meet.hasDriveScope(scopes);
      const records = (await meet.listConferenceRecords(token, `${from}T00:00:00Z`, `${to}T23:59:59Z`)).slice(0, meet.MAX_LISTED_RECORDS);
      const codes = new Map<string, Promise<string | null>>();
      return mapLimit(records, 4, async (r) => {
        const transcripts = await meet.listTranscripts(token, r.name);
        if (r.space && !codes.has(r.space)) codes.set(r.space, meet.getMeetingCode(token, r.space));
        const code = r.space ? await codes.get(r.space)! : null;
        const docId = transcripts.find((t) => t.docsDestination?.document)?.docsDestination?.document;
        const docName = drive ? await meet.docTitle(token, docId) : null;
        const ended = Date.parse(r.endTime ?? "");
        const entriesExpired = Number.isFinite(ended) && Date.now() - ended > ENTRY_RETENTION_DAYS * 864e5;
        const items: RemoteItem[] = transcripts.map((t) => {
          let note: string | null = null;
          let importable = true;
          if (t.state === "STARTED") {
            importable = false;
            note = "transcription still running";
          } else if (entriesExpired) {
            if (t.docsDestination?.document && drive) note = "entries expired after 30 days — the transcript Doc will be exported via Drive";
            else {
              importable = false;
              note = t.docsDestination?.document ? "entries expired after 30 days and Drive access was not granted — reconnect and allow Drive (Meet files)" : "entries expired after 30 days and no transcript Doc exists";
            }
          }
          return { id: t.name, kind: "TRANSCRIPT", label: "Transcript — speakers and timestamps (Meet transcript entries)", sizeBytes: null, importable, note };
        });
        return {
          provider,
          externalId: r.name,
          title: docName ?? `Google Meet${code ? ` ${code}` : ""}`,
          startTime: r.startTime ?? null,
          localDate: (r.startTime ?? new Date().toISOString()).slice(0, 10),
          durationSec: meet.describeDuration(r.startTime, r.endTime),
          items,
        };
      });
    },
    db,
  );
  const imported = importedIndex(owner.workspaceId, provider, list.map((m) => m.externalId), db);
  repo.audit(owner.workspaceId, owner.userId, "INTEGRATION_RECORDINGS_LISTED", owner.userId, `${provider} ${from}..${to}: ${list.length} meeting(s)`, db);
  return list.map((m) => ({ ...m, imported: imported.get(m.externalId) ?? [] })).sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""));
}

/* ------------------------------ Import ------------------------------ */

export const ImportInput = z.object({
  companyId: z.string().min(1).max(120),
  externalId: z.string().min(1).max(300),
  itemId: z.string().min(1).max(300),
  /** Start time from the listing: narrows the server-side re-lookup (Zoom). */
  startTime: z.string().max(40).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  callDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  participants: z.array(MeetingParticipant).max(20).optional(),
});
export type ImportInput = z.infer<typeof ImportInput>;

interface Fetched {
  kind: "TRANSCRIPT" | "AUDIO" | "TRANSCRIPT_ENTRIES" | "TRANSCRIPT_DOC";
  title: string;
  localDate: string;
  transcript?: { text: string; filename: string };
  recording?: { data: Buffer; filename: string; mime: string };
  detail: string;
}

async function fetchZoom(token: string, v: ImportInput): Promise<Fetched> {
  const { meeting, file } = await zoom.resolveZoomFile(token, v.externalId, v.itemId, v.startTime ?? null);
  const title = (meeting.topic ?? "").trim() || "Zoom meeting";
  const localDate = zoom.zoomLocalDate(meeting);
  const base = `zoom-${slugify(title)}-${localDate}`;
  if (file.file_type === "TRANSCRIPT") {
    const text = await zoom.downloadZoomTranscript(token, file);
    return { kind: "TRANSCRIPT", title, localDate, transcript: { text, filename: `${base}.vtt` }, detail: `VTT transcript ${mb(text.length)}` };
  }
  if (file.file_type === "M4A" || file.file_type === "MP4") {
    const data = await zoom.downloadZoomAudio(token, file);
    const ext = file.file_type === "M4A" ? "m4a" : "mp4";
    const mime = ext === "m4a" ? "audio/mp4" : "video/mp4";
    try {
      splitRecording(data, `${base}.${ext}`, mime); // same limits the transcription run applies, checked before a run is created
    } catch (e) {
      if (e instanceof TranscriptionError) throw new IntegrationError("TOO_LARGE", e.message);
      throw e;
    }
    return { kind: "AUDIO", title, localDate, recording: { data, filename: `${base}.${ext}`, mime }, detail: `${file.file_type} audio ${mb(data.length)} → transcription` };
  }
  throw new IntegrationError("INVALID", "Only the transcript (VTT) or the audio file of a Zoom recording can be imported.");
}

async function fetchMeet(token: string, scopes: string[], v: ImportInput): Promise<Fetched> {
  if (!meet.RECORD_NAME_RE.test(v.externalId) || !meet.TRANSCRIPT_NAME_RE.test(v.itemId) || !v.itemId.startsWith(`${v.externalId}/`)) throw new IntegrationError("INVALID", "Invalid Google Meet transcript reference");
  const tr = await meet.getTranscript(token, v.itemId);
  if (tr.state === "STARTED") throw new IntegrationError("INVALID", "This Meet transcript is still being produced; import it after the meeting ends.");
  const localDate = (tr.startTime ?? new Date().toISOString()).slice(0, 10);
  const docId = tr.docsDestination?.document;
  const drive = meet.hasDriveScope(scopes);
  const title = (drive ? await meet.docTitle(token, docId) : null) ?? `Google Meet ${localDate}`;
  const base = `meet-${slugify(title)}-${localDate}`;
  let entries: meet.TranscriptEntry[] = [];
  try {
    entries = await meet.listEntries(token, tr.name);
  } catch (e) {
    if (!(e instanceof IntegrationError && e.code === "NOT_FOUND")) throw e; // expired entries: fall back to the Doc
  }
  if (entries.some((e) => e.text?.trim())) {
    const names = await meet.participantNames(token, v.externalId);
    const rows = meet.mapEntries(entries, names, tr.startTime);
    const speakers = new Set(rows.map((r) => r.speaker)).size;
    return { kind: "TRANSCRIPT_ENTRIES", title, localDate, transcript: { text: meet.entriesToVtt(rows), filename: `${base}.vtt` }, detail: `${rows.length} transcript entries, ${speakers} speaker(s)` };
  }
  if (!docId) throw new IntegrationError("NOT_FOUND", "This Meet transcript has no entries (Google keeps them 30 days) and no transcript Doc.");
  if (!drive) throw new IntegrationError("FORBIDDEN", "Transcript entries are no longer available (Google keeps them 30 days). Exporting the transcript Doc needs Drive access to Meet files: reconnect Google Meet and allow it.");
  const text = meet.normalizeDocTranscript(await meet.exportTranscriptDoc(token, docId));
  return { kind: "TRANSCRIPT_DOC", title, localDate, transcript: { text, filename: `${base}.txt` }, detail: `transcript Doc export ${mb(text.length)}` };
}

/**
 * Download the chosen transcript (or audio) with the user's own token and
 * start the founder-meeting workflow for the company. Returns as soon as the
 * meeting and run exist; the analysis continues in `promise`.
 */
export async function importRemoteMeeting(provider: ConnectorId, owner: Owner, input: ImportInput, db: DB = getDb()) {
  requireWriter(owner);
  const v = ImportInput.parse(input);
  const company = repo.getCompany(owner.workspaceId, v.companyId, db);
  if (!company) throw new IntegrationError("NOT_FOUND", "Company not found");
  const latest = repo.latestRun(company.id, db);
  if (latest && (latest.status === "RUNNING" || latest.status === "QUEUED")) throw new IntegrationError("INVALID", "An analysis run is already in progress for this company");

  const got = await withAccessToken(provider, owner, (token, row) => (provider === "zoom" ? fetchZoom(token, v) : fetchMeet(token, row.scopes.split(/\s+/).filter(Boolean), v)), db);
  if (got.recording && got.recording.data.length > MAX_RECORDING_BYTES) throw new IntegrationError("TOO_LARGE", "Recording exceeds the upload limit");

  const started = await startFounderCall({
    workspaceId: owner.workspaceId,
    userId: owner.userId,
    companyIdOrSlug: company.id,
    transcript: got.transcript?.text ?? null,
    filename: got.transcript?.filename ?? null,
    recording: got.recording ?? null,
    callDate: v.callDate ?? got.localDate,
    title: v.title?.trim() || got.title,
    participants: v.participants ?? [],
    source: provider === "zoom" ? "ZOOM" : "GOOGLE_MEET",
  });
  db.insert(s.integrationImports)
    .values({ id: newId("imp"), workspaceId: owner.workspaceId, userId: owner.userId, provider, externalId: v.externalId, itemId: v.itemId, kind: got.kind, companyId: company.id, meetingId: started.meeting.id, title: started.meeting.title, createdAt: nowIso() })
    .run();
  repo.audit(owner.workspaceId, owner.userId, "INTEGRATION_IMPORT", company.id, `${SPECS[provider].name}: ${got.detail} → ${started.meeting.id} (${started.run.id})`, db);
  return { meetingId: started.meeting.id, runId: started.run.id, kind: got.kind, promise: started.promise };
}
