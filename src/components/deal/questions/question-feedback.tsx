"use client";

import { useState } from "react";
import { cx } from "@/components/ui";

export type QuestionVerdict = "USEFUL" | "NOT_USEFUL" | "ALREADY_KNOWN";
export interface GivenFeedback {
  verdict: QuestionVerdict;
  note: string | null;
}

const OPTIONS: { v: QuestionVerdict; label: string }[] = [
  { v: "USEFUL", label: "Useful" },
  { v: "NOT_USEFUL", label: "Not useful" },
  { v: "ALREADY_KNOWN", label: "Already known" },
];

/**
 * "Was this question useful?" — one judgement per user, stored against the
 * analysis version on screen. After a founder meeting it is recorded with the
 * meeting id (source AFTER_MEETING). Feeds the useful-question rate on /quality.
 */
export function QuestionFeedback({ companyId, versionId, questionId, meetingId, initial }: { companyId: string; versionId: string; questionId: string; meetingId: string | null; initial: GivenFeedback | null }) {
  const [given, setGiven] = useState<GivenFeedback | null>(initial);
  const [note, setNote] = useState(initial?.note ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (verdict: QuestionVerdict, withNote: string | null) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/deals/${companyId}/question-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, versionId, verdict, note: withNote, meetingId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setGiven({ verdict, note: j.feedback?.note ?? null });
      setNoteOpen(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
      <span className="text-ink-3">{meetingId ? "Useful in the meeting?" : "Was this question useful?"}</span>
      <div role="group" aria-label="Question usefulness" className="inline-flex overflow-hidden rounded-md border border-line">
        {OPTIONS.map((o, i) => (
          <button
            key={o.v}
            type="button"
            disabled={busy}
            aria-pressed={given?.verdict === o.v}
            onClick={() => send(o.v, note.trim() || null)}
            className={cx(
              "h-6 px-2 text-[12px] transition-colors disabled:opacity-50",
              i > 0 && "border-l border-line",
              given?.verdict === o.v ? "bg-ink text-bg" : "bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      {given && !noteOpen && (
        <button type="button" className="text-ink-3 underline-offset-2 hover:text-ink hover:underline" onClick={() => setNoteOpen(true)}>
          {given.note ? "Edit note" : "Add note"}
        </button>
      )}
      {noteOpen && given && (
        <span className="flex items-center gap-1.5">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            autoFocus
            placeholder="Optional: why"
            className="h-6 w-[260px] rounded-md border border-line bg-bg px-2 text-[12px] outline-none focus-visible:border-accent"
          />
          <button type="button" disabled={busy} className="text-ink-2 hover:text-ink" onClick={() => send(given.verdict, note.trim() || null)}>
            Save
          </button>
        </span>
      )}
      {given?.note && !noteOpen && <span className="max-w-[420px] truncate text-ink-3" title={given.note}>“{given.note}”</span>}
      {error && <span className="text-risk">{error}</span>}
    </div>
  );
}
