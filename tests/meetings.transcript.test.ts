import { describe, expect, it } from "vitest";
import { anchorExcerpt, parseTranscript, renderTranscript, resolveRefs, transcriptForModel } from "@/ingestion/transcript";
import { parseWav, splitRecording, MAX_PART_SECONDS } from "@/ai/transcribe";
import { formatTimestamp, resolveStages } from "@/domain/meetings";

describe("transcript parsing preserves speakers, timestamps and verbatim text", () => {
  it("bracketed timestamps + speaker labels", () => {
    const t = `[00:00:05] Partner (Fund): Walk me through CAC.
[00:00:12] Maya Chen (CEO): The $18k in the deck excludes founder time and sales engineering.
Fully loaded it is closer to $26k.
[00:01:03] Partner (Fund): Who closes enterprise deals today?`;
    const s = parseTranscript(t);
    expect(s).toHaveLength(3);
    expect(s[1]).toMatchObject({ ref: "T-2", speaker: "Maya Chen (CEO)", startSec: 12 });
    expect(s[1]!.text).toBe("The $18k in the deck excludes founder time and sales engineering.\nFully loaded it is closer to $26k.");
    expect(s[0]!.endSec).toBe(12);
    expect(formatTimestamp(s[2]!.startSec)).toBe("01:03");
  });

  it("WebVTT with voice tags, merged per speaker", () => {
    const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.500
<v Sam Ortiz>Thanks for joining.</v>

2
00:00:05.000 --> 00:00:09.250
<v Maya Chen>Happy to. Our ARR is $3.8M.</v>

3
00:00:09.500 --> 00:01:10.000
<v Maya Chen>Net retention is 118% on 45 customers.</v>`;
    const s = parseTranscript(vtt);
    expect(s.map((x) => x.speaker)).toEqual(["Sam Ortiz", "Maya Chen"]);
    expect(s[1]).toMatchObject({ startSec: 5, endSec: 70 });
    expect(s[1]!.text).toContain("Net retention is 118% on 45 customers.");
  });

  it("SRT with 'Name:' prefixes and hour timestamps", () => {
    const srt = `1
01:02:03,500 --> 01:02:07,000
Maya: We lost two logos in Q2.

2
01:02:08,000 --> 01:02:10,000
Sam: Which ones?`;
    const s = parseTranscript(srt);
    expect(s[0]).toMatchObject({ speaker: "Maya", startSec: 3723.5, endSec: 3727 });
    expect(formatTimestamp(s[0]!.startSec)).toBe("1:02:03");
  });

  it("Otter-style headers and plain notes without timestamps", () => {
    const otter = `Maya Chen  0:04\nWe started selling in 2023.\n\nSam Ortiz  0:31\nAnd pricing?`;
    expect(parseTranscript(otter).map((x) => [x.speaker, x.startSec])).toEqual([
      ["Maya Chen", 4],
      ["Sam Ortiz", 31],
    ]);
    const notes = `Founder said churn was low.\nNo cohort data yet.\n\nARR: $3.8M per founder.`;
    const s = parseTranscript(notes);
    expect(s.every((x) => x.startSec === null)).toBe(true);
    expect(s[1]!.speaker).toBeNull(); // "ARR:" is not a speaker
    expect(renderTranscript(s)).toContain("ARR: $3.8M per founder.");
  });

  it("anchors verbatim excerpts to the exact turn; unknown refs are dropped", () => {
    const s = parseTranscript(`[00:10] A: Our CAC of $18,000 excludes founder time.\n[00:20] B: Okay.\n[00:31] A: I still close every enterprise deal myself.`);
    expect(anchorExcerpt("I still close every enterprise deal myself", s).map((x) => x.ref)).toEqual(["T-3"]);
    expect(anchorExcerpt("something never said in the meeting at all", s)).toEqual([]);
    const refs = resolveRefs(s, ["T-1", "T-99"], null);
    expect(refs).toEqual([expect.objectContaining({ ref: "T-1", startSec: 10, speaker: "A" })]);
    expect(transcriptForModel(s, { A: "Maya" })).toContain("[T-3 | 00:31 | Maya [A]] I still close every enterprise deal myself.");
  });
});

describe("recording splitting (WAV) keeps absolute timestamps", () => {
  function wav(seconds: number, rate = 8000) {
    const bytes = seconds * rate * 2;
    const h = Buffer.alloc(44);
    h.write("RIFF", 0, "ascii");
    h.writeUInt32LE(36 + bytes, 4);
    h.write("WAVEfmt ", 8, "ascii");
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2, 28);
    h.writeUInt16LE(2, 32);
    h.writeUInt16LE(16, 34);
    h.write("data", 36, "ascii");
    h.writeUInt32LE(bytes, 40);
    return Buffer.concat([h, Buffer.alloc(bytes)]);
  }
  it("splits a 45-minute recording into ≤ 20-minute parts with offsets", () => {
    const buf = wav(45 * 60);
    expect(parseWav(buf)).toMatchObject({ sampleRate: 8000, channels: 1 });
    const { parts, durationSec, kind } = splitRecording(buf, "meeting.wav", "audio/wav");
    expect(kind).toBe("wav");
    expect(durationSec).toBe(2700);
    expect(parts.map((p) => p.offsetSec)).toEqual([0, MAX_PART_SECONDS, 2 * MAX_PART_SECONDS]);
    expect(parts.every((p) => (p.durationSec ?? 0) <= MAX_PART_SECONDS && parseWav(p.data) !== null)).toBe(true);
  });
});

describe("version stage resolution", () => {
  it("legacy rows: deck → PRE, founder calls → V1, V2; edits inherit; deck after a meeting is separate", () => {
    const rows = [
      { id: "v1", versionNo: 1, reason: "DECK_ANALYSIS", stage: null, stageSeq: null },
      { id: "v2", versionNo: 2, reason: "DECK_ANALYSIS", stage: null, stageSeq: null },
      { id: "v3", versionNo: 3, reason: "FOUNDER_CALL", stage: null, stageSeq: null },
      { id: "v4", versionNo: 4, reason: "METRIC_CORRECTION", stage: null, stageSeq: null },
      { id: "v5", versionNo: 5, reason: "FOUNDER_CALL", stage: null, stageSeq: null },
      { id: "v6", versionNo: 6, reason: "DECK_ANALYSIS", stage: null, stageSeq: null },
    ];
    const st = resolveStages(rows);
    expect(["v1", "v2", "v3", "v4", "v5", "v6"].map((id) => st.get(id)!.code)).toEqual([
      "PRE_MEETING_ANALYSIS",
      "PRE_MEETING_ANALYSIS",
      "POST_MEETING_ANALYSIS_V1",
      "POST_MEETING_ANALYSIS_V1",
      "POST_MEETING_ANALYSIS_V2",
      "DECK_REANALYSIS",
    ]);
  });
});
