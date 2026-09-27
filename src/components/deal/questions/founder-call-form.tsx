"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, cx } from "@/components/ui";

type Step = { step: string; label: string; status: string; detail?: string };
interface RunState {
  status: string;
  progress: Step[];
  spentUsd: number;
  budgetUsd: number;
  error: string | null;
}

const MIN = 200;
const MAX = 200_000;

/** §65: paste or upload a call transcript; the analysis is updated in the background, not restarted. */
export function FounderCallForm({ companyId, canWrite, activeRunId }: { companyId: string; canWrite: boolean; activeRunId: string | null }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [runId, setRunId] = useState<string | null>(activeRunId);
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!runId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await fetch(`/api/runs/${runId}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      if (!alive) return;
      if (r) {
        setRun(r);
        if (r.status !== "RUNNING" && r.status !== "QUEUED") {
          router.refresh();
          return;
        }
      }
      timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 600);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [runId, router]);

  const onFile = async (f: File | undefined) => {
    setError(null);
    if (!f) return;
    if (!/\.(txt|md|vtt|srt)$/i.test(f.name) && !f.type.startsWith("text/")) return setError("Upload a plain-text transcript (.txt).");
    if (f.size > 2 * 1024 * 1024) return setError("Transcript file exceeds 2 MB.");
    setText(await f.text());
    setFilename(f.name);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const t = text.trim();
    if (t.length < MIN) return setError(`The transcript looks too short (${t.length} characters; minimum ${MIN}).`);
    if (t.length > MAX) return setError(`The transcript exceeds ${MAX.toLocaleString("en-US")} characters.`);
    setSubmitting(true);
    try {
      const r = await fetch(`/api/deals/${companyId}/founder-call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transcript: t, filename, callDate }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setRun(null);
      setRunId(j.runId);
      setText("");
      setFilename(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const running = !!runId && (!run || run.status === "RUNNING" || run.status === "QUEUED");
  const finished = run && !running;

  if (!canWrite) return <p className="text-[13px] text-ink-3">Your role is read-only; a partner or analyst can add a call transcript.</p>;

  return (
    <div>
      {runId && (
        <div className="mb-4 rounded-lg border border-line bg-surface px-4 py-3" aria-live="polite">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-ink">
              {running ? "Updating the analysis from the call" : run?.status === "FAILED" ? "Founder call update failed" : "Analysis updated from the call"}
            </span>
            {run && (
              <span className="num text-[12px] text-ink-3">
                ${run.spentUsd.toFixed(4)} of ${run.budgetUsd.toFixed(2)} cap
              </span>
            )}
          </div>
          <ol className="space-y-1">
            {(run?.progress ?? [{ step: "CALL", label: "Reading call transcript", status: "PENDING" }]).map((s) => (
              <li key={s.step} className="flex items-start gap-2 text-[12.5px]">
                <span
                  className={cx(
                    "mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full",
                    s.status === "DONE" && "bg-ok",
                    s.status === "RUNNING" && "pulse-dot bg-accent",
                    s.status === "PENDING" && "bg-line-strong",
                    s.status === "SKIPPED" && "bg-warn",
                    s.status === "FAILED" && "bg-risk",
                  )}
                />
                <span className={s.status === "PENDING" ? "text-ink-3" : "text-ink"}>
                  {s.label}
                  <span className="text-ink-3"> — {s.status === "PENDING" ? "waiting" : s.status.toLowerCase()}</span>
                  {s.detail && <span className="text-ink-3">: {s.detail}</span>}
                </span>
              </li>
            ))}
          </ol>
          {run?.error && <p className="mt-2 text-[12.5px] text-risk">{run.error}</p>}
          {finished && run?.status !== "FAILED" && <p className="mt-2 text-[12.5px] text-ink-3">See “What changed” above. Scores were recomputed; nothing was re-analyzed from scratch.</p>}
        </div>
      )}

      {!running && (
        <form onSubmit={submit} className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFilename(null);
            }}
            rows={9}
            placeholder={"Paste the call transcript or notes here.\n\nMaya (CEO): Our ARR is $3.84M as of August…"}
            aria-label="Founder call transcript"
            className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-2">
              <span className="rounded-md border border-line bg-surface px-2.5 py-1 hover:bg-surface-2">Upload .txt</span>
              <input ref={fileRef} type="file" accept=".txt,.md,.vtt,.srt,text/plain" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
              {filename && <span className="text-ink-3">{filename}</span>}
            </label>
            <label className="inline-flex items-center gap-2 text-[12.5px] text-ink-3">
              Call date
              <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink outline-none focus-visible:border-accent" />
            </label>
            <span className="num text-[12px] text-ink-3">{text.trim().length.toLocaleString("en-US")} characters</span>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-[11.5px] text-ink-3">One model pass · hard cap $0.10 · updates, does not restart</span>
              <Button type="submit" variant="primary" disabled={submitting || text.trim().length < MIN}>
                {submitting ? "Starting…" : "Update analysis from call"}
              </Button>
            </div>
          </div>
          {error && <p className="text-[12.5px] text-risk">{error}</p>}
        </form>
      )}
    </div>
  );
}
