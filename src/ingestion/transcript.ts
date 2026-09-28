/**
 * Transcript parsing and anchoring (deterministic).
 *
 * Turns a pasted or uploaded transcript (WebVTT, SRT, "[00:12:03] Name: text",
 * "Name (CEO): text", Otter-style "Name  0:04" headers, or plain notes) into
 * speaker turns with timestamps, preserving the verbatim text. Model outputs
 * cite turns by ref ("T-12"); `anchorExcerpt` re-locates a quoted excerpt in
 * the verbatim transcript so every important claim links back to the exact
 * turn and timestamp — or is flagged as unanchored.
 */
import { formatTimestamp, segmentRef, type TranscriptRefView, type TranscriptSegment } from "@/domain/meetings";

const TS = String.raw`(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?`;
const CUE_RE = new RegExp(String.raw`^\s*${TS}\s*-->\s*${TS}`);
const LEADING_TS_RE = new RegExp(String.raw`^\s*[\[(]?${TS}[\])]?\s*[-–—|]?\s*`);
/** "Maya Chen (CEO): text" — label of at most 6 words, optional parenthetical role. */
const SPEAKER_RE = /^([A-Z][\p{L}\p{M}.'’-]*(?:\s+[\p{L}\p{M}.'’-]+){0,5}(?:\s*\([^)]{1,40}\))?)\s*(?:[\[(]\s*((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[\])])?\s*:\s+(.*)$/u;
/** Otter / Zoom-notes style header line: "Maya Chen  0:04" or "Speaker 1 00:12:03". */
const HEADER_RE = /^([A-Z][\p{L}\p{M}.'’-]*(?:\s+[\p{L}\p{M}\d.'’-]+){0,5})\s+((?:\d{1,2}:)?\d{1,2}:\d{2})\s*$/u;
const NOT_SPEAKERS = new Set(["note", "notes", "action", "actions", "todo", "summary", "agenda", "re", "arr", "mrr", "cac", "ltv", "nrr", "grr", "http", "https"]);

function tsToSec(h: string | undefined, m: string, s: string, ms?: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s) + (ms ? Number(ms.padEnd(3, "0")) / 1000 : 0);
}

function parseClock(t: string): number | null {
  const m = t.match(new RegExp(`^${TS}$`));
  return m ? tsToSec(m[1], m[2]!, m[3]!, m[4]) : null;
}

function cleanSpeaker(label: string): string | null {
  const l = label.trim();
  const bare = l.replace(/\s*\(.*\)$/, "").trim().toLowerCase();
  if (!l || NOT_SPEAKERS.has(bare)) return null;
  return l;
}

interface Draft {
  speaker: string | null;
  startSec: number | null;
  endSec: number | null;
  lines: string[];
}

function finalize(drafts: Draft[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const d of drafts) {
    const text = d.lines.join("\n").trim();
    if (!text) continue;
    const idx = out.length;
    out.push({ ref: segmentRef(idx), idx, speaker: d.speaker, startSec: d.startSec, endSec: d.endSec, text });
  }
  return out;
}

function parseCues(lines: string[]): TranscriptSegment[] {
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  for (const raw of lines) {
    const line = raw.replace(/﻿/g, "");
    const cue = line.match(CUE_RE);
    if (cue) {
      cur = { speaker: null, startSec: tsToSec(cue[1], cue[2]!, cue[3]!, cue[4]), endSec: tsToSec(cue[5], cue[6]!, cue[7]!, cue[8]), lines: [] };
      drafts.push(cur);
      continue;
    }
    if (!cur) continue; // WEBVTT header, NOTE blocks before the first cue
    if (!line.trim()) continue;
    if (/^\d+$/.test(line.trim())) continue; // SRT index / VTT numeric id
    let text = line.trim();
    const voice = text.match(/^<v(?:\.[^\s>]+)?\s+([^>]+)>(.*?)(?:<\/v>)?$/);
    if (voice) {
      if (cur.lines.length === 0) cur.speaker = voice[1]!.trim();
      text = voice[2]!.trim();
    } else if (cur.lines.length === 0) {
      const sp = text.match(SPEAKER_RE);
      const who = sp ? cleanSpeaker(sp[1]!) : null;
      if (sp && who) {
        cur.speaker = who;
        text = sp[3]!;
      }
    }
    cur.lines.push(text.replace(/<[^>]+>/g, ""));
  }
  // Merge consecutive cues of the same speaker (VTT exports split sentences across cues).
  const merged: Draft[] = [];
  for (const d of drafts) {
    const last = merged[merged.length - 1];
    if (last && d.speaker && last.speaker === d.speaker && d.startSec !== null && last.endSec !== null && d.startSec - last.endSec < 2) {
      last.lines.push(...d.lines);
      last.endSec = d.endSec;
    } else merged.push({ ...d, lines: [...d.lines] });
  }
  return finalize(merged);
}

function parsePlain(lines: string[]): TranscriptSegment[] {
  const drafts: Draft[] = [];
  let cur: Draft | null = null;
  let blank = false;
  const start = (speaker: string | null, startSec: number | null, first: string) => {
    if (cur && cur.endSec === null && startSec !== null && cur.startSec !== null) cur.endSec = startSec;
    cur = { speaker, startSec, endSec: null, lines: first ? [first] : [] };
    drafts.push(cur);
  };
  for (const raw of lines) {
    const line = raw.replace(/﻿/g, "").trimEnd();
    if (!line.trim()) {
      blank = true;
      continue;
    }
    let rest = line.trim();
    let sec: number | null = null;
    const lead = rest.match(LEADING_TS_RE);
    if (lead && lead[0].trim()) {
      sec = tsToSec(lead[1], lead[2]!, lead[3]!, lead[4]);
      rest = rest.slice(lead[0].length);
    }
    const header = rest.match(HEADER_RE);
    if (header && sec === null) {
      const who = cleanSpeaker(header[1]!);
      if (who) {
        start(who, parseClock(header[2]!), "");
        blank = false;
        continue;
      }
    }
    const sp = rest.match(SPEAKER_RE);
    const who = sp ? cleanSpeaker(sp[1]!) : null;
    if (sp && who) {
      start(who, sec ?? (sp[2] ? parseClock(sp[2]) : null), sp[3]!);
    } else if (!cur || sec !== null || blank) {
      const prev = cur as Draft | null;
      // A new paragraph keeps the previous speaker unless it opens with its own timestamp.
      start(prev?.speaker ?? null, sec, rest);
    } else {
      (cur as Draft).lines.push(rest);
    }
    blank = false;
  }
  return finalize(drafts);
}

/** Parse any supported transcript text into speaker turns. Never drops text. */
export function parseTranscript(text: string): TranscriptSegment[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const cueCount = lines.filter((l) => CUE_RE.test(l)).length;
  return cueCount >= 2 ? parseCues(lines) : parsePlain(lines);
}

/** Render segments as a plain verbatim transcript ("[00:07] Speaker B: text"). */
export function renderTranscript(segments: TranscriptSegment[], speakerNames: Record<string, string> = {}): string {
  return segments
    .map((s) => {
      const ts = formatTimestamp(s.startSec);
      const who = s.speaker ? (speakerNames[s.speaker] ?? s.speaker) : null;
      return `${ts ? `[${ts}] ` : ""}${who ? `${who}: ` : ""}${s.text}`;
    })
    .join("\n\n");
}

/** Transcript as the model sees it: every turn carries its ref so outputs can cite it. */
export function transcriptForModel(segments: TranscriptSegment[], speakerNames: Record<string, string> = {}): string {
  return segments
    .map((s) => {
      const ts = formatTimestamp(s.startSec);
      const who = s.speaker ? (speakerNames[s.speaker] ? `${speakerNames[s.speaker]} [${s.speaker}]` : s.speaker) : "Unknown speaker";
      return `[${s.ref}${ts ? ` | ${ts}` : ""} | ${who}] ${s.text}`;
    })
    .join("\n");
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, "")
    .replace(/[^\p{L}\p{N}$%.\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Locate a quoted excerpt in the transcript. Exact (normalized) containment
 * first, then a strict token-overlap fallback (≥ 80 % of the excerpt's words
 * in one turn, in a window of adjacent turns). Returns [] when the excerpt
 * cannot be found — callers then flag the item as unanchored.
 */
export function anchorExcerpt(excerpt: string | null | undefined, segments: TranscriptSegment[]): TranscriptSegment[] {
  const e = norm(excerpt ?? "");
  if (e.length < 6) return [];
  const direct = segments.filter((s) => norm(s.text).includes(e));
  if (direct.length) return direct.slice(0, 2);
  // Excerpt spanning two consecutive turns.
  for (let i = 0; i + 1 < segments.length; i++) {
    if (norm(`${segments[i]!.text} ${segments[i + 1]!.text}`).includes(e)) return [segments[i]!, segments[i + 1]!];
  }
  const words = e.split(" ").filter((w) => w.length > 2);
  if (words.length < 4) return [];
  let best: { s: TranscriptSegment; score: number } | null = null;
  for (const s of segments) {
    const bag = new Set(norm(s.text).split(" "));
    const score = words.filter((w) => bag.has(w)).length / words.length;
    if (!best || score > best.score) best = { s, score };
  }
  return best && best.score >= 0.8 ? [best.s] : [];
}

/**
 * Resolve refs cited by the model plus refs found by anchoring the excerpt.
 * Unknown refs are dropped (the model cannot invent a transcript location).
 */
export function resolveRefs(segments: TranscriptSegment[], cited: string[] | null | undefined, excerpt?: string | null): TranscriptRefView[] {
  const byRef = new Map(segments.map((s) => [s.ref, s]));
  const picked: TranscriptSegment[] = [];
  for (const r of anchorExcerpt(excerpt, segments)) if (!picked.includes(r)) picked.push(r);
  for (const raw of cited ?? []) {
    const ref = raw.trim().toUpperCase().replace(/^T(\d)/, "T-$1");
    const s = byRef.get(ref);
    if (s && !picked.includes(s)) picked.push(s);
  }
  return picked
    .sort((a, b) => a.idx - b.idx)
    .slice(0, 4)
    .map((s) => ({ ref: s.ref, speaker: s.speaker, startSec: s.startSec, excerpt: excerptOf(s.text, excerpt) }));
}

function excerptOf(text: string, want?: string | null): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (want) {
    const i = clean.toLowerCase().indexOf(want.trim().toLowerCase().slice(0, 40));
    if (i >= 0) return clean.slice(Math.max(0, i - 20), i + Math.min(260, want.length + 60)).trim();
  }
  return clean.length > 240 ? `${clean.slice(0, 239)}…` : clean;
}
