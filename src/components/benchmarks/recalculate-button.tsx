"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function RecalculateButton({ registryId }: { registryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState(false);
  return (
    <div className="flex items-center gap-3">
      {msg && (
        <span role={error ? "alert" : "status"} className={error ? "text-[12.5px] text-risk" : "text-[12.5px] text-ink-3"}>
          {msg}
        </span>
      )}
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          setError(false);
          try {
            const res = await fetch("/api/benchmarks/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registryId }) });
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json.error ?? `Recalculation failed (${res.status})`);
            const rows = (json.rows ?? []) as { changed: boolean }[];
            setMsg(`${rows.length} companies checked · ${rows.filter((r) => r.changed).length} re-scored as new versions (history preserved)`);
            router.refresh();
          } catch (e) {
            setError(true);
            setMsg((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Recalculating…" : "Recalculate portfolio"}
      </Button>
    </div>
  );
}
