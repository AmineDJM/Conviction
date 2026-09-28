/**
 * Zoom Cloud Recording API (user-level OAuth app).
 *
 *   GET /v2/users/me/recordings?from=YYYY-MM-DD&to=YYYY-MM-DD&page_size=300&next_page_token=…
 *       → meetings[] { uuid, id, topic, start_time, timezone, duration, recording_files[] }
 *       recording_files[] { id, file_type (MP4 | M4A | TRANSCRIPT | CC | CHAT | TIMELINE | …),
 *                           file_extension (VTT | M4A | MP4 | …), file_size, download_url, status, recording_type }
 *       The date range is at most one month per request.
 *   download_url + "Authorization: Bearer <access token>" → the file (usually a 302 to a signed CDN URL).
 *
 * The transcript (file_type TRANSCRIPT, VTT) is preferred: it keeps Zoom's
 * speaker names and cue timestamps and goes through the same parser as an
 * uploaded .vtt. Without one, the audio file goes through the recording
 * transcription path. Download URLs are never taken from the browser: the
 * import re-lists the user's recordings and resolves the file server-side.
 */
import { MAX_RECORDING_BYTES } from "@/ai/transcribe";
import { apiJson, download, endpoints, IntegrationError } from "./http";

export const MAX_TRANSCRIPT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 10;

export interface ZoomFile {
  id?: string;
  meeting_id?: string;
  recording_start?: string;
  recording_end?: string;
  file_type?: string;
  file_extension?: string;
  file_size?: number;
  download_url?: string;
  status?: string;
  recording_type?: string;
}

export interface ZoomMeeting {
  uuid: string;
  id?: number | string;
  topic?: string;
  start_time?: string;
  timezone?: string;
  duration?: number;
  recording_files?: ZoomFile[];
}

interface ZoomListResponse {
  meetings?: ZoomMeeting[];
  next_page_token?: string;
}

export async function listZoomRecordings(token: string, from: string, to: string): Promise<ZoomMeeting[]> {
  const out: ZoomMeeting[] = [];
  let next = "";
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ from, to, page_size: "300" });
    if (next) q.set("next_page_token", next);
    const r = await apiJson<ZoomListResponse>("Zoom", `${endpoints().zoomApi}/users/me/recordings?${q}`, { token });
    out.push(...(r.meetings ?? []).filter((m) => typeof m.uuid === "string" && m.uuid));
    next = r.next_page_token ?? "";
    if (!next) break;
  }
  return out;
}

/** Tokens go only to Zoom hosts (and the local mock in development). */
export function zoomTrusted(u: URL): boolean {
  const mock = endpoints().mock;
  if (mock && u.origin === new URL(mock).origin) return true;
  const h = u.hostname.toLowerCase();
  return u.protocol === "https:" && (h === "zoom.us" || h.endsWith(".zoom.us") || h === "zoom.com" || h.endsWith(".zoom.com"));
}

export function zoomTranscriptFile(m: ZoomMeeting): ZoomFile | null {
  return (m.recording_files ?? []).find((f) => f.file_type === "TRANSCRIPT" && (f.file_extension ?? "VTT").toUpperCase() === "VTT" && f.id) ?? null;
}

/** Audio for the transcription fallback: the audio-only M4A, else the smallest MP4. */
export function zoomAudioFile(m: ZoomMeeting): ZoomFile | null {
  const files = (m.recording_files ?? []).filter((f) => f.id && f.download_url);
  const m4a = files.filter((f) => f.file_type === "M4A").sort((a, b) => (a.file_size ?? Infinity) - (b.file_size ?? Infinity))[0];
  if (m4a) return m4a;
  return files.filter((f) => f.file_type === "MP4").sort((a, b) => (a.file_size ?? Infinity) - (b.file_size ?? Infinity))[0] ?? null;
}

/** Why an audio file cannot go through the transcription path, or null. M4A/MP4 are converted to WAV and split, so only the recording limit applies. */
export function zoomAudioBlocker(f: ZoomFile): string | null {
  if (f.status && f.status !== "completed") return "Zoom is still processing this file";
  const size = f.file_size ?? null;
  if (size !== null && size > MAX_RECORDING_BYTES) return `${(size / 1024 / 1024).toFixed(0)} MB exceeds the ${MAX_RECORDING_BYTES / 1024 / 1024} MB recording limit`;
  return null;
}

export function zoomTranscriptBlocker(f: ZoomFile): string | null {
  if (f.status && f.status !== "completed") return "Zoom is still processing the transcript";
  if ((f.file_size ?? 0) > MAX_TRANSCRIPT_FILE_BYTES) return "transcript file exceeds 2 MB";
  return null;
}

/** Calendar date of the meeting in its own time zone (Zoom reports start_time in UTC). */
export function zoomLocalDate(m: ZoomMeeting): string {
  const t = m.start_time ? new Date(m.start_time) : null;
  if (!t || Number.isNaN(t.getTime())) return new Date().toISOString().slice(0, 10);
  try {
    if (m.timezone) return new Intl.DateTimeFormat("en-CA", { timeZone: m.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
  } catch {
    // unknown time zone id: fall through to UTC
  }
  return t.toISOString().slice(0, 10);
}

/** Re-list around the meeting's start and resolve the file server-side (the browser never supplies a download URL). */
export async function resolveZoomFile(token: string, meetingUuid: string, fileId: string, startHint: string | null): Promise<{ meeting: ZoomMeeting; file: ZoomFile }> {
  const t = startHint ? Date.parse(startHint) : NaN;
  const center = Number.isFinite(t) ? t : Date.now();
  const day = 864e5;
  const from = new Date(center - day).toISOString().slice(0, 10);
  const to = new Date(center + day).toISOString().slice(0, 10);
  const meetings = await listZoomRecordings(token, from, to);
  const meeting = meetings.find((m) => m.uuid === meetingUuid);
  if (!meeting) throw new IntegrationError("NOT_FOUND", "This Zoom recording is no longer available (deleted, moved to trash, or not yours).");
  const file = (meeting.recording_files ?? []).find((f) => f.id === fileId);
  if (!file || !file.download_url) throw new IntegrationError("NOT_FOUND", "This Zoom recording file is no longer available.");
  return { meeting, file };
}

export async function downloadZoomTranscript(token: string, file: ZoomFile): Promise<string> {
  const blocker = zoomTranscriptBlocker(file);
  if (blocker) throw new IntegrationError("INVALID", `Zoom transcript cannot be imported: ${blocker}.`);
  const { data } = await download("Zoom", file.download_url!, { token, max: MAX_TRANSCRIPT_FILE_BYTES, what: "Zoom transcript", trusted: zoomTrusted, timeoutMs: 60_000 });
  const text = data.toString("utf8").replace(/^﻿/, "");
  if (!/^WEBVTT/.test(text.trimStart())) throw new IntegrationError("UPSTREAM", "Zoom returned a transcript that is not WebVTT.");
  return text;
}

export async function downloadZoomAudio(token: string, file: ZoomFile): Promise<Buffer> {
  const blocker = zoomAudioBlocker(file);
  if (blocker) throw new IntegrationError("TOO_LARGE", `Zoom audio cannot be transcribed: ${blocker}.`);
  const { data } = await download("Zoom", file.download_url!, { token, max: MAX_RECORDING_BYTES, what: "Zoom audio", trusted: zoomTrusted });
  return data;
}
