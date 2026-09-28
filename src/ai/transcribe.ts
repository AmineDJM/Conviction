/**
 * Meeting recording transcription (OpenAI audio API, fetch-based like ./openai).
 *
 * Model: gpt-4o-transcribe-diarize — speaker labels + segment timestamps
 * (`response_format: diarized_json`). If the diarizing model rejects a file,
 * whisper-1 (`verbose_json`, segment timestamps, no speakers) is used and the
 * meeting is labelled "not diarized". The API accepts ≤ 25 MB and ≤ 1,400 s per
 * request, so WAV and MP3 recordings are split deterministically (PCM frames /
 * MPEG frame boundaries) into ≤ 20-minute parts; for WAV, speaker reference
 * clips from part 1 keep speaker labels consistent across parts. Other
 * containers (m4a, mp4, webm, ogg) are sent whole and must fit one request.
 *
 * Every request is authorized by the CostController with a worst-case estimate
 * and recorded with its actual cost (token usage when reported, else minutes).
 */
import type { CostController } from "./cost";
import { OPENAI_BASE_URL, authHeaders, fetchWithRetry } from "./openai";
import { transcriptionCost, worstCaseTranscriptionCost } from "./pricing";
import { providerError } from "./errors";
import { segmentRef, type TranscriptSegment } from "@/domain/meetings";

export const TRANSCRIBE_MODEL = process.env.CONVICTION_TRANSCRIBE_MODEL ?? "gpt-4o-transcribe-diarize";
export const FALLBACK_TRANSCRIBE_MODEL = "whisper-1";
/** Per-request API limits (25 MB; 1,400 s for the diarizing model) with margin. */
export const MAX_PART_BYTES = 24 * 1024 * 1024;
export const MAX_PART_SECONDS = 1200;
/** Upload limit for a whole recording (split into parts when WAV/MP3). */
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;
/** Assumed minimum bitrate when the duration of a container cannot be read (conservative worst case): 16 kbit/s. */
const MIN_BYTES_PER_SECOND = 2000;

export const AUDIO_EXTENSIONS = /\.(wav|mp3|m4a|mp4|mpeg|mpga|webm|ogg|oga|flac)$/i;

export class TranscriptionError extends Error {
  constructor(
    message: string,
    /** HTTP status of a provider rejection (the message is then the user-safe provider message). */
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/* ---------------------------------------------------------------- */
/* Container probing and splitting                                    */
/* ---------------------------------------------------------------- */

export interface AudioPart {
  data: Buffer;
  filename: string;
  mime: string;
  offsetSec: number;
  durationSec: number | null;
}

interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
}

export function parseWav(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") return null;
  let off = 12;
  let fmt: Omit<WavInfo, "dataOffset" | "dataBytes"> | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === "fmt ") {
      const format = buf.readUInt16LE(off + 8);
      if (format !== 1 && format !== 0xfffe) return null; // PCM only
      fmt = { channels: buf.readUInt16LE(off + 10), sampleRate: buf.readUInt32LE(off + 12), blockAlign: buf.readUInt16LE(off + 20), bitsPerSample: buf.readUInt16LE(off + 22) };
    } else if (id === "data") {
      if (!fmt) return null;
      // Streaming writers leave the size at 0 / 0xFFFFFFFF: the data runs to the end of the file.
      if (size === 0 || size === 0xffffffff || off + 8 + size > buf.length) size = buf.length - off - 8;
      size -= size % fmt.blockAlign;
      return { ...fmt, dataOffset: off + 8, dataBytes: size };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

function wavHeader(info: Omit<WavInfo, "dataOffset" | "dataBytes">, dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(info.channels, 22);
  h.writeUInt32LE(info.sampleRate, 24);
  h.writeUInt32LE(info.sampleRate * info.blockAlign, 28);
  h.writeUInt16LE(info.blockAlign, 32);
  h.writeUInt16LE(info.bitsPerSample, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

/** A WAV clip [fromSec, toSec) of a PCM recording (used for speaker reference samples). */
export function wavClip(buf: Buffer, info: WavInfo, fromSec: number, toSec: number): Buffer {
  const a = Math.max(0, Math.floor(fromSec * info.sampleRate) * info.blockAlign);
  const b = Math.min(info.dataBytes, Math.floor(toSec * info.sampleRate) * info.blockAlign);
  const len = Math.max(0, b - a);
  return Buffer.concat([wavHeader(info, len), buf.subarray(info.dataOffset + a, info.dataOffset + a + len)]);
}

const MP3_BITRATES: Record<string, number[]> = {
  "1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const MP3_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Walk MPEG-1/2/2.5 Layer III frames: exact duration and frame boundaries (CBR or VBR). */
export function mp3Frames(buf: Buffer): { offset: number; seconds: number }[] | null {
  let off = 0;
  if (buf.toString("ascii", 0, 3) === "ID3" && buf.length > 10) {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    off = 10 + size + (buf[5]! & 0x10 ? 10 : 0);
  }
  const frames: { offset: number; seconds: number }[] = [];
  let misses = 0;
  while (off + 4 <= buf.length) {
    const b1 = buf[off + 1]!;
    const b2 = buf[off + 2]!;
    if (buf[off] !== 0xff || (b1 & 0xe0) !== 0xe0) {
      off++;
      if (++misses > 65536 && frames.length === 0) return null;
      continue;
    }
    const version = (b1 >> 3) & 3; // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5
    const layer = (b1 >> 1) & 3; // 1 = Layer III
    const brIdx = (b2 >> 4) & 15;
    const srIdx = (b2 >> 2) & 3;
    if (version === 1 || layer !== 1 || brIdx === 0 || brIdx === 15 || srIdx === 3) {
      off++;
      continue;
    }
    const bitrate = MP3_BITRATES[version === 3 ? "1" : "2"]![brIdx]! * 1000;
    const rate = MP3_RATES[version]![srIdx]!;
    const samples = version === 3 ? 1152 : 576;
    const len = Math.floor(((samples / 8) * bitrate) / rate) + ((b2 >> 1) & 1);
    if (len < 24) {
      off++;
      continue;
    }
    frames.push({ offset: off, seconds: samples / rate });
    off += len;
  }
  return frames.length > 10 ? frames : null;
}

export function mimeFor(filename: string, fallback: string): string {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", mpga: "audio/mpeg", mpeg: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", webm: "audio/webm", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac" };
  return map[ext] ?? (fallback || "application/octet-stream");
}

/** Split a recording into API-sized parts at deterministic boundaries. */
export function splitRecording(buf: Buffer, filename: string, mime: string): { parts: AudioPart[]; durationSec: number | null; kind: "wav" | "mp3" | "other" } {
  const base = filename.replace(/\.[^.]+$/, "");
  const wav = parseWav(buf);
  if (wav) {
    const bps = wav.sampleRate * wav.blockAlign;
    const duration = wav.dataBytes / bps;
    const perPart = Math.max(wav.blockAlign, Math.min(MAX_PART_SECONDS * bps, MAX_PART_BYTES - 44));
    const step = perPart - (perPart % wav.blockAlign);
    const parts: AudioPart[] = [];
    for (let a = 0, i = 0; a < wav.dataBytes; a += step, i++) {
      const len = Math.min(step, wav.dataBytes - a);
      parts.push({ data: Buffer.concat([wavHeader(wav, len), buf.subarray(wav.dataOffset + a, wav.dataOffset + a + len)]), filename: `${base}.part${i + 1}.wav`, mime: "audio/wav", offsetSec: a / bps, durationSec: len / bps });
    }
    return { parts, durationSec: duration, kind: "wav" };
  }
  const frames = /\.(mp3|mpga|mpeg)$/i.test(filename) || mime === "audio/mpeg" ? mp3Frames(buf) : null;
  if (frames) {
    const duration = frames.reduce((a, f) => a + f.seconds, 0);
    const parts: AudioPart[] = [];
    let startIdx = 0;
    let t0 = 0;
    let acc = 0;
    for (let i = 0; i <= frames.length; i++) {
      const end = i === frames.length;
      const bytes = (end ? buf.length : frames[i]!.offset) - frames[startIdx]!.offset;
      if (end || acc >= MAX_PART_SECONDS || bytes >= MAX_PART_BYTES - 8192) {
        const from = frames[startIdx]!.offset;
        const to = end ? buf.length : frames[i]!.offset;
        parts.push({ data: buf.subarray(from, to), filename: `${base}.part${parts.length + 1}.mp3`, mime: "audio/mpeg", offsetSec: t0, durationSec: acc });
        if (end) break;
        startIdx = i;
        t0 += acc;
        acc = 0;
      }
      acc += frames[i]!.seconds;
    }
    return { parts, durationSec: duration, kind: "mp3" };
  }
  if (buf.length > MAX_PART_BYTES) throw new TranscriptionError(`Recordings in this format must be ≤ ${Math.floor(MAX_PART_BYTES / 1024 / 1024)} MB and ≤ 23 minutes. Upload WAV or MP3 (split automatically), or paste the transcript.`);
  return { parts: [{ data: buf, filename, mime: mimeFor(filename, mime), offsetSec: 0, durationSec: null }], durationSec: null, kind: "other" };
}

/* ---------------------------------------------------------------- */
/* API                                                                */
/* ---------------------------------------------------------------- */

interface ApiSegment {
  text?: string;
  speaker?: string;
  start?: number;
  end?: number;
}
interface ApiResponse {
  text?: string;
  duration?: number;
  segments?: ApiSegment[];
  usage?: { type?: string; seconds?: number; input_tokens?: number; output_tokens?: number; input_token_details?: { audio_tokens?: number; text_tokens?: number } };
  error?: { message?: string; code?: string | null };
}

async function requestPart(
  part: AudioPart,
  model: string,
  known: { name: string; ref: string }[],
  cost: CostController,
  signal?: AbortSignal,
): Promise<{ segments: ApiSegment[]; seconds: number | null; costUsd: number }> {
  const seconds = part.durationSec ?? part.data.length / MIN_BYTES_PER_SECOND;
  const estimated = cost.authorizeAmount("TRANSCRIBE", worstCaseTranscriptionCost(model, seconds));
  const form = new FormData();
  form.set("model", model);
  form.set("file", new Blob([new Uint8Array(part.data)], { type: part.mime }), part.filename);
  if (model === FALLBACK_TRANSCRIBE_MODEL) {
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  } else {
    form.set("response_format", "diarized_json");
    form.set("chunking_strategy", "auto");
    for (const k of known) {
      form.append("known_speaker_names[]", k.name);
      form.append("known_speaker_references[]", k.ref);
    }
  }
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetchWithRetry(`${OPENAI_BASE_URL}/audio/transcriptions`, { method: "POST", headers: authHeaders(), body: form, signal }, 2);
  } catch (e) {
    await cost.record({ step: "TRANSCRIBE", model, promptVersion: null, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, estimatedUsd: estimated, actualUsd: 0, latencyMs: Date.now() - t0, toolCalls: 0 });
    if (signal?.aborted || (e as Error).name === "AbortError") throw e;
    throw providerError("audio/transcriptions", null, (e as Error).message);
  }
  const json = (await res.json().catch(() => ({}))) as ApiResponse;
  const u = json.usage;
  const usd = res.ok
    ? transcriptionCost(model, {
        seconds: u?.seconds ?? json.duration ?? part.durationSec,
        audioTokens: u?.type === "tokens" ? (u.input_token_details?.audio_tokens ?? u.input_tokens ?? 0) : null,
        textInputTokens: u?.type === "tokens" ? (u.input_token_details?.text_tokens ?? 0) : null,
        outputTokens: u?.type === "tokens" ? (u.output_tokens ?? 0) : null,
      })
    : 0;
  await cost.record({
    step: "TRANSCRIBE",
    model,
    promptVersion: null,
    usage: { inputTokens: u?.input_tokens ?? 0, cachedTokens: 0, outputTokens: u?.output_tokens ?? 0, reasoningTokens: 0, webSearches: 0 },
    estimatedUsd: estimated,
    actualUsd: usd,
    latencyMs: Date.now() - t0,
    toolCalls: 0,
  });
  if (!res.ok) throw new TranscriptionError(providerError("audio/transcriptions", res.status, json.error?.message ?? res.statusText, { code: json.error?.code }).message, res.status);
  const segments = json.segments?.length ? json.segments : json.text ? [{ text: json.text, start: 0, end: json.duration ?? part.durationSec ?? undefined }] : [];
  return { segments, seconds: json.duration ?? part.durationSec, costUsd: usd };
}

export interface TranscriptionResult {
  segments: TranscriptSegment[];
  model: string;
  diarized: boolean;
  chunks: number;
  durationSec: number | null;
  costUsd: number;
}

/**
 * Transcribe a whole recording. Parts are sent sequentially (each authorized
 * against the remaining budget); timestamps are offset to the full recording.
 */
export async function transcribeRecording(v: { data: Buffer; filename: string; mime: string; cost: CostController; signal?: AbortSignal; onPart?: (i: number, n: number) => void }): Promise<TranscriptionResult> {
  const { parts, durationSec, kind } = splitRecording(v.data, v.filename, v.mime);
  const wav = kind === "wav" ? parseWav(v.data) : null;
  let model = TRANSCRIBE_MODEL;
  let costUsd = 0;
  let known: { name: string; ref: string }[] = [];
  const out: { speaker: string | null; startSec: number | null; endSec: number | null; text: string }[] = [];
  for (const [i, part] of parts.entries()) {
    v.onPart?.(i + 1, parts.length);
    let r: Awaited<ReturnType<typeof requestPart>>;
    try {
      r = await requestPart(part, model, known, v.cost, v.signal);
    } catch (e) {
      // The diarizing model rejected the file (format, duration): fall back to timestamps only, once, for the whole recording.
      if (!(e instanceof TranscriptionError) || model === FALLBACK_TRANSCRIBE_MODEL || i > 0 || e.status !== 400) throw e;
      model = FALLBACK_TRANSCRIBE_MODEL;
      r = await requestPart(part, model, [], v.cost, v.signal);
    }
    costUsd += r.costUsd;
    const diarized = model !== FALLBACK_TRANSCRIBE_MODEL;
    for (const s of r.segments) {
      const text = (s.text ?? "").trim();
      if (!text) continue;
      let speaker = diarized && s.speaker ? s.speaker : null;
      // Without reference clips (non-WAV), labels restart per part and cannot be reconciled: keep them distinct.
      if (speaker && i > 0 && !wav) speaker = `P${i + 1}·${speaker}`;
      out.push({ speaker, startSec: s.start !== undefined ? part.offsetSec + s.start : null, endSec: s.end !== undefined ? part.offsetSec + s.end : null, text });
    }
    if (i === 0 && wav && diarized && parts.length > 1) known = speakerReferences(v.data, wav, r.segments);
  }
  // Merge consecutive turns of the same speaker separated by < 1.5 s (the API splits at pauses).
  const merged: typeof out = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (last && s.speaker && last.speaker === s.speaker && last.endSec !== null && s.startSec !== null && s.startSec - last.endSec < 1.5 && last.text.length < 1200) {
      last.text = `${last.text} ${s.text}`;
      last.endSec = s.endSec;
    } else merged.push({ ...s });
  }
  return {
    segments: merged.map((s, idx) => ({ ref: segmentRef(idx), idx, ...s })),
    model,
    diarized: model !== FALLBACK_TRANSCRIBE_MODEL,
    chunks: parts.length,
    durationSec,
    costUsd,
  };
}

/** Up to four 3–10 s reference clips (one per speaker label) from part 1, as data URLs. */
function speakerReferences(buf: Buffer, wav: WavInfo, segs: ApiSegment[]): { name: string; ref: string }[] {
  const best = new Map<string, ApiSegment>();
  for (const s of segs) {
    if (!s.speaker || s.start === undefined || s.end === undefined) continue;
    const cur = best.get(s.speaker);
    if (!cur || s.end - s.start > cur.end! - cur.start!) best.set(s.speaker, s);
  }
  return [...best.entries()]
    .filter(([, s]) => s.end! - s.start! >= 2)
    .slice(0, 4)
    .map(([name, s]) => ({ name, ref: `data:audio/wav;base64,${wavClip(buf, wav, s.start!, Math.min(s.end!, s.start! + 10)).toString("base64")}` }));
}
