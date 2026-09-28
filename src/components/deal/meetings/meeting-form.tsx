"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

const MIN = 200;
const MAX = 200_000;
const AUDIO = /\.(wav|mp3|m4a|mp4|m4v|mov|mkv|avi|mpeg|mpga|webm|ogg|oga|opus|flac|aac|wma|3gp|amr)$/i;
const TEXT = /\.(txt|md|vtt|srt)$/i;

type Participant = { name: string; role: string; side: "FUND" | "COMPANY" | "OTHER" };

/**
 * Founder meeting ingestion: paste a transcript, upload a transcript file
 * (.txt .md .vtt .srt) or upload the recording (transcribed with speakers and
 * timestamps). Starts the post-meeting run and returns to the timeline.
 */
export function MeetingForm({ companyId, canWrite, busy }: { companyId: string; canWrite: boolean; busy: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "file">("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [people, setPeople] = useState<Participant[]>([{ name: "", role: "", side: "COMPANY" }]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!canWrite) return <p className="text-[13px] text-ink-3">Your role is read-only; a partner or analyst can add a founder meeting.</p>;

  const isAudio = !!file && (AUDIO.test(file.name) || file.type.startsWith("audio/") || file.type.startsWith("video/"));

  const onFile = (f: File | undefined) => {
    setError(null);
    setFile(null);
    if (!f) return;
    if (!AUDIO.test(f.name) && !TEXT.test(f.name) && !f.type.startsWith("audio/") && !f.type.startsWith("video/") && !f.type.startsWith("text/")) return setError("Upload a transcript (.txt, .md, .vtt, .srt) or a recording (audio or video: wav, mp3, m4a, mp4, mov, mkv, webm, ogg, flac, aac…).");
    if (TEXT.test(f.name) && f.size > 2 * 1024 * 1024) return setError("Transcript file exceeds 2 MB.");
    if (f.size > 200 * 1024 * 1024) return setError("Recording exceeds 200 MB.");
    setFile(f);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const participants = people.filter((p) => p.name.trim()).map((p) => ({ name: p.name.trim(), role: p.role.trim() || null, side: p.side }));
    const form = new FormData();
    if (mode === "paste") {
      const t = text.trim();
      if (t.length < MIN) return setError(`The transcript looks too short (${t.length} characters; minimum ${MIN}).`);
      if (t.length > MAX) return setError(`The transcript exceeds ${MAX.toLocaleString("en-US")} characters.`);
      form.set("transcript", t);
    } else {
      if (!file) return setError("Choose a file.");
      form.set("file", file);
    }
    if (title.trim()) form.set("title", title.trim());
    form.set("callDate", date);
    form.set("participants", JSON.stringify(participants));
    setSubmitting(true);
    try {
      const r = await fetch(`/api/deals/${companyId}/meetings`, { method: "POST", body: form });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setText("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const input = "h-8 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent";

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <label className="flex flex-col gap-1 text-[12px] text-ink-3">
          Meeting
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. First partner call with Maya Chen" className={input} maxLength={200} />
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-ink-3">
          Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </label>
      </div>

      <fieldset>
        <legend className="mb-1 text-[12px] text-ink-3">Participants (optional — keeps speaker identity explicit)</legend>
        <div className="space-y-1.5">
          {people.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_120px_auto] gap-2">
              <input aria-label="Name" value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className={input} maxLength={120} />
              <input aria-label="Role" value={p.role} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} placeholder="Role (CEO, partner…)" className={input} maxLength={120} />
              <select aria-label="Side" value={p.side} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, side: e.target.value as Participant["side"] } : x)))} className={input}>
                <option value="COMPANY">Company</option>
                <option value="FUND">Fund</option>
                <option value="OTHER">Other</option>
              </select>
              <button type="button" onClick={() => setPeople(people.length > 1 ? people.filter((_, j) => j !== i) : people)} className="px-1 text-[12px] text-ink-3 hover:text-ink" aria-label="Remove participant">
                ✕
              </button>
            </div>
          ))}
        </div>
        {people.length < 12 && (
          <button type="button" onClick={() => setPeople([...people, { name: "", role: "", side: "FUND" }])} className="mt-1.5 text-[12px] text-ink-3 hover:text-ink">
            + Add participant
          </button>
        )}
      </fieldset>

      <div>
        <div className="mb-2 flex gap-1 text-[12.5px]" role="tablist">
          {(
            [
              ["paste", "Paste transcript"],
              ["file", "Upload transcript or recording"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cx("rounded-md px-2.5 py-1", mode === k ? "bg-surface-3 font-medium text-ink" : "text-ink-3 hover:text-ink")}>
              {l}
            </button>
          ))}
        </div>
        {mode === "paste" ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            placeholder={"[00:01:12] Maya Chen (CEO): Our ARR is $3.84M as of August…\n\nTimestamps and speaker labels are kept; WebVTT / SRT exports from Zoom or Meet work as they are."}
            aria-label="Meeting transcript"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent"
          />
        ) : (
          <label className="flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-5 text-[12.5px] text-ink-2 hover:bg-surface-2">
            <span className="rounded-md border border-line bg-surface px-2.5 py-1">Choose file</span>
            <input ref={fileRef} type="file" accept=".txt,.md,.vtt,.srt,text/plain,audio/*,video/mp4,video/webm,.wav,.mp3,.m4a,.mp4,.webm,.ogg,.flac" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
            {file ? (
              <span className="text-ink">
                {file.name} <span className="num text-ink-3">· {(file.size / 1024 / 1024).toFixed(1)} MB · {isAudio ? "recording — will be transcribed with speakers and timestamps" : "transcript"}</span>
              </span>
            ) : (
              <span className="text-ink-3">Transcript (.txt .md .vtt .srt) or recording — audio or video (wav, mp3, m4a, mp4, mov, mkv, webm, ogg, flac, aac…), up to 200 MB. Any length: recordings are converted and split automatically.</span>
            )}
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[11.5px] leading-snug text-ink-3">
          Freezes the current version as the pre-meeting analysis · one model pass (cap $0.10){isAudio ? " + transcription (≈ $0.02–0.03 / min, cap $3)" : ""} · produces the post-meeting brief and a new post-meeting analysis version
        </span>
        <Button type="submit" variant="primary" disabled={submitting || busy} className="ml-auto">
          {submitting ? "Uploading…" : busy ? "A run is in progress" : "Process meeting"}
        </Button>
      </div>
      {error && <p className="text-[12.5px] text-risk">{error}</p>}
    </form>
  );
}
