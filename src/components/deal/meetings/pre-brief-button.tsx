"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";

/** Builds the PRE_MEETING_BRIEF for the current version (deterministic + one small cached model step). */
export function PreBriefButton({ companyId, slug, label = "Prepare pre-meeting brief" }: { companyId: string; slug: string; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/deals/${companyId}/meetings/pre-brief`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      router.push(`/deals/${slug}/meetings/pre-brief/${j.briefId}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button variant="primary" onClick={go} disabled={busy}>
        {busy ? "Preparing…" : label}
      </Button>
      {error && <span className="text-[12px] text-risk">{error}</span>}
    </span>
  );
}
