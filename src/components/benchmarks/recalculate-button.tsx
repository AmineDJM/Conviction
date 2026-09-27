"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

export function RecalculateButton({ registryId }: { registryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-[12.5px] text-ink-3">{msg}</span>}
      <Button
        variant="primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/benchmarks/recalculate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registryId }) });
          const json = await res.json().catch(() => ({}));
          setBusy(false);
          if (!res.ok) return setMsg(json.error ?? "Failed");
          const changed = (json.rows as { changed: boolean }[]).filter((r) => r.changed).length;
          setMsg(`${json.rows.length} companies checked · ${changed} re-scored as new versions (history preserved)`);
          router.refresh();
        }}
      >
        {busy ? "Recalculating…" : "Recalculate portfolio"}
      </Button>
    </div>
  );
}
