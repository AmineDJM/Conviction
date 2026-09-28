"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

export interface AnalysisFeedbackValue {
  betterQuestions: boolean;
  importantRisks: boolean;
  missingEvidence: boolean;
  marketInsight: boolean;
  minutesSaved: number | null;
  note: string | null;
}

const ITEMS: { key: keyof Pick<AnalysisFeedbackValue, "betterQuestions" | "importantRisks" | "missingEvidence" | "marketInsight">; label: string }[] = [
  { key: "betterQuestions", label: "Surfaced better questions" },
  { key: "importantRisks", label: "Surfaced important risks" },
  { key: "missingEvidence", label: "Showed missing evidence" },
  { key: "marketInsight", label: "Gave useful market insight" },
];

/** Per-analysis human utility (§129). Stored per user per version; summarized on /quality. */
export function AnalysisFeedback({ companyId, versionId, versionNo, initial, canWrite }: { companyId: string; versionId: string; versionNo: number; initial: AnalysisFeedbackValue | null; canWrite: boolean }) {
  const [v, setV] = useState<AnalysisFeedbackValue>(initial ?? { betterQuestions: false, importantRisks: false, missingEvidence: false, marketInsight: false, minutesSaved: null, note: null });
  const [minutes, setMinutes] = useState(initial?.minutesSaved?.toString() ?? "");
  const [saved, setSaved] = useState(!!initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const m = minutes.trim() === "" ? null : Math.round(Number(minutes));
      if (m !== null && !Number.isFinite(m)) throw new Error("Minutes saved must be a number");
      const r = await fetch(`/api/deals/${companyId}/analysis-feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId, betterQuestions: v.betterQuestions, importantRisks: v.importantRisks, missingEvidence: v.missingEvidence, marketInsight: v.marketInsight, minutesSaved: m, note: v.note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<AnalysisFeedbackValue>) => {
    setV((x) => ({ ...x, ...patch }));
    setSaved(false);
  };

  return (
    <div className="max-w-[820px] rounded-lg border border-line bg-surface px-4 py-3 text-[13px]">
      <p className="mb-2 text-ink-2">
        For version {versionNo}: what did this analysis do for your preparation? Leave boxes unticked when it did not.
      </p>
      <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {ITEMS.map((it) => (
          <label key={it.key} className="flex items-center gap-2 text-ink">
            <input type="checkbox" disabled={!canWrite} checked={v[it.key]} onChange={(e) => set({ [it.key]: e.target.checked })} className="accent-[var(--accent)]" />
            {it.label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-ink-2">
          Preparation time saved
          <input
            inputMode="numeric"
            disabled={!canWrite}
            value={minutes}
            onChange={(e) => {
              setMinutes(e.target.value);
              setSaved(false);
            }}
            placeholder="min"
            className="h-7 w-[72px] rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus-visible:border-accent"
          />
          <span className="text-ink-3">minutes (negative if it cost time)</span>
        </label>
      </div>
      <input
        disabled={!canWrite}
        value={v.note ?? ""}
        maxLength={1000}
        onChange={(e) => set({ note: e.target.value || null })}
        placeholder="Optional note"
        className="mt-2 h-7 w-full rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus-visible:border-accent"
      />
      {canWrite && (
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={busy || saved} onClick={save}>
            {busy ? "Saving…" : saved ? "Saved" : "Save feedback"}
          </Button>
          {error && <span className="text-[12px] text-risk">{error}</span>}
        </div>
      )}
    </div>
  );
}
