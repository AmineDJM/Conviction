"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Name diarized speakers. Display only: verbatim segments, briefs and versions are not rewritten. */
export function SpeakerNames({ companyId, meetingId, labels, initial, canWrite }: { companyId: string; meetingId: string; labels: string[]; initial: Record<string, string>; canWrite: boolean }) {
  const router = useRouter();
  const [names, setNames] = useState<Record<string, string>>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  if (!labels.length) return null;
  const save = async () => {
    setState("saving");
    const r = await fetch(`/api/deals/${companyId}/meetings/${meetingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speakerNames: names }) });
    setState(r.ok ? "saved" : "error");
    if (r.ok) router.refresh();
  };
  return (
    <div className="no-print rounded-lg border border-line bg-surface px-4 py-3">
      <div className="mb-2 text-[12.5px] font-medium text-ink">Speakers</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {labels.map((l) => (
          <label key={l} className="flex items-center gap-2 text-[12.5px]">
            <span className="w-24 shrink-0 truncate font-mono text-[11.5px] text-ink-3" title={l}>
              {l}
            </span>
            <input
              disabled={!canWrite}
              value={names[l] ?? ""}
              onChange={(e) => {
                setNames({ ...names, [l]: e.target.value });
                setState("idle");
              }}
              placeholder="Name, role"
              maxLength={80}
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink outline-none focus-visible:border-accent disabled:opacity-60"
            />
          </label>
        ))}
      </div>
      {canWrite && (
        <div className="mt-2 flex items-center gap-3">
          <Button size="sm" onClick={save} disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : "Save names"}
          </Button>
          <span className="text-[11.5px] text-ink-3">{state === "saved" ? "Saved." : state === "error" ? "Could not save." : "Labels in the verbatim transcript are kept; names are shown alongside."}</span>
        </div>
      )}
    </div>
  );
}
