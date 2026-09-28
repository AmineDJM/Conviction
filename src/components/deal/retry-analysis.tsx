"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Re-runs the analysis on the documents already on record (no re-upload). */
export function RetryAnalysis({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function retry() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(companyId)}/reanalyze`, { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return setError(body.error ?? "Could not start the analysis");
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <Button size="sm" onClick={retry} disabled={busy}>
        {busy ? "Starting…" : "Retry analysis"}
      </Button>
      {error && <span className="text-[12.5px] text-risk">{error}</span>}
    </div>
  );
}
