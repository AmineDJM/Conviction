/**
 * Google Meet REST API v2 (+ Drive export fallback).
 *
 *   GET meet/v2/conferenceRecords?filter=start_time>="…" AND start_time<="…"&pageSize=100
 *       → conferenceRecords[] { name, startTime, endTime, expireTime, space }
 *   GET meet/v2/{space}                               → { meetingCode, meetingUri }
 *   GET meet/v2/{conferenceRecord}/transcripts        → transcripts[] { name, state (STARTED | ENDED | FILE_GENERATED),
 *                                                        startTime, endTime, docsDestination { document, exportUri } }
 *   GET meet/v2/{transcript}/entries?pageSize=100     → transcriptEntries[] { participant, text, languageCode, startTime, endTime }
 *   GET meet/v2/{conferenceRecord}/participants       → participants[] { name, signedinUser | anonymousUser | phoneUser { displayName } }
 *   GET drive/v3/files/{document}/export?mimeType=text/plain   (fallback)
 *
 * Approach: transcript ENTRIES are the primary source — structured per
 * utterance with the participant and exact start/end times, needing only
 * meetings.space.readonly. Speaker names come from resolving each entry's
 * participant. Google keeps entries for 30 days after the conference; after
 * that (or when the list is empty) the transcript Google Doc is exported as
 * plain text through Drive (drive.meet.readonly), which keeps speaker names
 * but only Meet's periodic timestamps. Entries can also differ from the Doc
 * if the Doc was edited after generation — the entries are the unedited record.
 */
import { apiJson, download, endpoints, IntegrationError, UpstreamUnauthorized } from "./http";
import { GOOGLE_SCOPES } from "./providers";

const MAX_RECORD_PAGES = 5;
const MAX_ENTRY_PAGES = 300; // 30,000 utterances
const MAX_DOC_BYTES = 2 * 1024 * 1024;
/** Records enriched with space + transcripts (+ Doc title) per listing. */
export const MAX_LISTED_RECORDS = 50;

/** One resource-id path segment; dot-only segments ("..") are refused so a name can never walk the URL path. */
const SEG = "(?!\\.+(?:/|$))[A-Za-z0-9_.~-]+";
export const RECORD_NAME_RE = new RegExp(`^conferenceRecords/${SEG}$`);
export const TRANSCRIPT_NAME_RE = new RegExp(`^conferenceRecords/${SEG}/transcripts/${SEG}$`);
const SPACE_NAME_RE = new RegExp(`^spaces/${SEG}$`);
const DOC_ID_RE = /^[A-Za-z0-9_-]{10,200}$/;

export interface ConferenceRecord {
  name: string;
  startTime?: string;
  endTime?: string;
  expireTime?: string;
  space?: string;
}
export interface MeetTranscript {
  name: string;
  state?: "STATE_UNSPECIFIED" | "STARTED" | "ENDED" | "FILE_GENERATED";
  startTime?: string;
  endTime?: string;
  docsDestination?: { document?: string; exportUri?: string };
}
export interface TranscriptEntry {
  name?: string;
  participant?: string;
  text?: string;
  languageCode?: string;
  startTime?: string;
  endTime?: string;
}
interface Participant {
  name: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
}

const api = () => endpoints().meetApi;

async function paged<T>(url: (pageToken: string) => string, key: string, token: string, maxPages: number): Promise<T[]> {
  const out: T[] = [];
  let next = "";
  for (let page = 0; page < maxPages; page++) {
    const r = await apiJson<Record<string, unknown>>("Google Meet", url(next), { token });
    out.push(...(((r[key] as T[] | undefined) ?? []) as T[]));
    next = typeof r.nextPageToken === "string" ? r.nextPageToken : "";
    if (!next) break;
  }
  return out;
}

export async function listConferenceRecords(token: string, fromIso: string, toIso: string): Promise<ConferenceRecord[]> {
  const filter = `start_time>="${fromIso}" AND start_time<="${toIso}"`;
  const records = await paged<ConferenceRecord>((pt) => `${api()}/conferenceRecords?${new URLSearchParams({ filter, pageSize: "100", ...(pt ? { pageToken: pt } : {}) })}`, "conferenceRecords", token, MAX_RECORD_PAGES);
  return records.filter((r) => RECORD_NAME_RE.test(r.name));
}

export async function listTranscripts(token: string, record: string): Promise<MeetTranscript[]> {
  if (!RECORD_NAME_RE.test(record)) throw new IntegrationError("INVALID", "Invalid conference record");
  const list = await paged<MeetTranscript>((pt) => `${api()}/${record}/transcripts?${new URLSearchParams({ pageSize: "100", ...(pt ? { pageToken: pt } : {}) })}`, "transcripts", token, 2);
  return list.filter((t) => TRANSCRIPT_NAME_RE.test(t.name) && t.name.startsWith(`${record}/`));
}

export async function getTranscript(token: string, name: string): Promise<MeetTranscript> {
  if (!TRANSCRIPT_NAME_RE.test(name)) throw new IntegrationError("INVALID", "Invalid transcript name");
  return apiJson<MeetTranscript>("Google Meet", `${api()}/${name}`, { token });
}

export async function getMeetingCode(token: string, space: string | undefined): Promise<string | null> {
  if (!space || !SPACE_NAME_RE.test(space)) return null;
  try {
    const r = await apiJson<{ meetingCode?: string }>("Google Meet", `${api()}/${space}`, { token });
    return r.meetingCode ?? null;
  } catch (e) {
    if (e instanceof UpstreamUnauthorized) throw e;
    return null; // space details are cosmetic
  }
}

export async function listEntries(token: string, transcript: string): Promise<TranscriptEntry[]> {
  if (!TRANSCRIPT_NAME_RE.test(transcript)) throw new IntegrationError("INVALID", "Invalid transcript name");
  return paged<TranscriptEntry>((pt) => `${api()}/${transcript}/entries?${new URLSearchParams({ pageSize: "100", ...(pt ? { pageToken: pt } : {}) })}`, "transcriptEntries", token, MAX_ENTRY_PAGES);
}

/** participant resource name → display name (signed-in, anonymous or phone user). */
export async function participantNames(token: string, record: string): Promise<Map<string, string>> {
  if (!RECORD_NAME_RE.test(record)) throw new IntegrationError("INVALID", "Invalid conference record");
  const list = await paged<Participant>((pt) => `${api()}/${record}/participants?${new URLSearchParams({ pageSize: "100", ...(pt ? { pageToken: pt } : {}) })}`, "participants", token, 20);
  const out = new Map<string, string>();
  for (const p of list) {
    const n = p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName;
    if (p.name && n?.trim()) out.set(p.name, n.trim());
  }
  return out;
}

export const hasDriveScope = (scopes: string[]) => scopes.includes(GOOGLE_SCOPES.driveMeet) || scopes.includes("https://www.googleapis.com/auth/drive.readonly");

/** Title of the transcript Doc ("<event title> (<date>) - Transcript" → "<event title> (<date>)"). Cosmetic; null on any failure. */
export async function docTitle(token: string, docId: string | undefined): Promise<string | null> {
  if (!docId || !DOC_ID_RE.test(docId)) return null;
  try {
    const r = await apiJson<{ name?: string }>("Google Drive", `${endpoints().driveApi}/files/${docId}?fields=name&supportsAllDrives=true`, { token });
    return r.name ? r.name.replace(/\s*[-–]\s*Transcript\s*$/i, "").trim() || null : null;
  } catch (e) {
    if (e instanceof UpstreamUnauthorized) throw e;
    return null;
  }
}

const driveTrusted = (u: URL) => {
  const mock = endpoints().mock;
  if (mock && u.origin === new URL(mock).origin) return true;
  return u.protocol === "https:" && u.hostname === "www.googleapis.com";
};

export async function exportTranscriptDoc(token: string, docId: string): Promise<string> {
  if (!DOC_ID_RE.test(docId)) throw new IntegrationError("INVALID", "Invalid transcript document id");
  const { data } = await download("Google Drive", `${endpoints().driveApi}/files/${docId}/export?mimeType=text%2Fplain`, { token, max: MAX_DOC_BYTES, what: "Transcript document", trusted: driveTrusted, timeoutMs: 60_000 });
  return data.toString("utf8").replace(/^﻿/, "");
}

/* ------------------------------ Mapping ------------------------------ */

function vttTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export interface MappedEntry {
  speaker: string;
  startSec: number | null;
  endSec: number | null;
  text: string;
}

/**
 * Transcript entries → speaker turns. Times are seconds from the transcript's
 * start (else the first entry). Unresolvable participants become
 * "Participant 1", "Participant 2", … in order of appearance (never merged).
 */
export function mapEntries(entries: TranscriptEntry[], names: Map<string, string>, transcriptStart?: string | null): MappedEntry[] {
  const valid = entries.filter((e) => (e.text ?? "").trim());
  const t0 = Date.parse(transcriptStart ?? "") || Date.parse(valid.find((e) => e.startTime)?.startTime ?? "") || null;
  const unknown = new Map<string, string>();
  return valid.map((e) => {
    let speaker = e.participant ? names.get(e.participant) : undefined;
    if (!speaker) {
      const key = e.participant ?? "?";
      if (!unknown.has(key)) unknown.set(key, `Participant ${unknown.size + 1}`);
      speaker = unknown.get(key)!;
    }
    const rel = (iso?: string) => {
      const t = Date.parse(iso ?? "");
      return Number.isFinite(t) && t0 !== null ? Math.max(0, (t - t0) / 1000) : null;
    };
    return { speaker, startSec: rel(e.startTime), endSec: rel(e.endTime), text: e.text!.replace(/\s+/g, " ").trim() };
  });
}

/**
 * Render mapped entries as WebVTT with voice spans (`<v Name>`), the format the
 * transcript parser reads with any display name (lowercase, emoji, redacted
 * phone numbers) and exact cue times. Angle brackets in speech are replaced
 * with ‹ › so they cannot be read as markup.
 */
export function entriesToVtt(rows: MappedEntry[]): string {
  const cues = rows.map((r) => {
    const start = r.startSec ?? 0;
    const end = Math.max(start, r.endSec ?? start);
    const who = r.speaker.replace(/[<>\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Unknown";
    return `${vttTime(start)} --> ${vttTime(end)}\n<v ${who}>${r.text.replace(/</g, "‹").replace(/>/g, "›")}</v>`;
  });
  return `WEBVTT\n\n${cues.join("\n\n")}\n`;
}

/**
 * Meet's transcript Doc as plain text puts a bare timestamp line ("00:05:00")
 * before blocks of "Name: text" paragraphs. Attach each timestamp to the next
 * paragraph so the parser keeps it ("[00:05:00] Name: text").
 */
export function normalizeDocTranscript(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let pending: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/ /g, " ").trimEnd();
    const bare = line.trim().match(/^(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})$/);
    if (bare) {
      pending = bare[1]!;
      continue;
    }
    if (pending && line.trim()) {
      out.push(`[${pending}] ${line.trim()}`);
      pending = null;
    } else out.push(line);
  }
  return out.join("\n");
}

export function describeDuration(startIso?: string, endIso?: string): number | null {
  const a = Date.parse(startIso ?? "");
  const b = Date.parse(endIso ?? "");
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 1000) : null;
}
