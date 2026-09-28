"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { titleCase } from "@/lib/format";

const sel = "h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] outline-none focus:border-accent disabled:opacity-60";

export function DecisionControls({ companyId, icDecision, executionStatus, canWrite }: { companyId: string; icDecision: string; executionStatus: string; canWrite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function update(body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${companyId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `Update failed (${res.status})`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select className={sel} value={icDecision} disabled={!canWrite || busy} onChange={(e) => update({ icDecision: e.target.value })} aria-label="IC decision">
        {["PENDING", "APPROVED", "REJECTED"].map((v) => (
          <option key={v} value={v}>
            IC: {titleCase(v)}
          </option>
        ))}
      </select>
      <select className={sel} value={executionStatus} disabled={!canWrite || busy} onChange={(e) => update({ executionStatus: e.target.value })} aria-label="Execution status">
        {["NOT_STARTED", "TERM_SHEET", "SIGNED", "FUNDED"].map((v) => (
          <option key={v} value={v}>
            {titleCase(v)}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-[12px] text-risk">
          {error}
        </span>
      )}
    </div>
  );
}
