/**
 * Long audio and video recordings: the bundled ffmpeg converts any container to 16 kHz mono WAV,
 * which is then split into API-sized parts (no model call in this test).
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpeg from "ffmpeg-static";
import { MAX_PART_BYTES, MAX_PART_SECONDS, parseWav, splitRecording, toSpeechWav } from "@/ai/transcribe";

function media(ext: string, seconds: number, video: boolean): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-test-"));
  const out = path.join(dir, `m.${ext}`);
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`];
  if (video) args.push("-f", "lavfi", "-i", `color=c=black:s=64x64:d=${seconds}:r=1`, "-shortest", "-c:v", "libx264", "-preset", "ultrafast");
  args.push("-c:a", ext === "mkv" || ext === "mov" || ext === "mp4" || ext === "m4a" ? "aac" : "libopus", "-b:a", "24k", out);
  execFileSync(ffmpeg as unknown as string, args);
  const buf = fs.readFileSync(out);
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}

describe("recordings of any container and length are converted and split", () => {
  it("a 25-minute .mov video becomes 16 kHz mono WAV and is split into parts with correct offsets", async () => {
    const mov = media("mov", 25 * 60, true);
    const wav = await toSpeechWav(mov, "board-call.mov");
    expect(wav).not.toBeNull();
    const info = parseWav(wav!)!;
    expect(info).toMatchObject({ sampleRate: 16000, channels: 1 });
    const { parts, durationSec, kind } = splitRecording(wav!, "board-call.wav", "audio/wav");
    expect(kind).toBe("wav");
    expect(durationSec).toBeGreaterThan(25 * 60 - 2);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.data.length).toBeLessThanOrEqual(MAX_PART_BYTES);
      expect(p.durationSec!).toBeLessThanOrEqual(MAX_PART_SECONDS + 0.01);
    }
    expect(parts[1]!.offsetSec).toBeCloseTo(parts[0]!.durationSec!, 3);
  }, 120_000);

  it.each(["m4a", "mkv", "webm"])("a .%s recording converts too", async (ext) => {
    const wav = await toSpeechWav(media(ext, 5, false), `call.${ext}`);
    expect(parseWav(wav!)).toMatchObject({ sampleRate: 16000, channels: 1 });
  }, 60_000);

  it("an undecodable file is refused with a clear message, never silently transcribed", async () => {
    await expect(toSpeechWav(Buffer.from("not a recording at all"), "notes.mov")).rejects.toThrow(/could not be decoded/);
  });
});
