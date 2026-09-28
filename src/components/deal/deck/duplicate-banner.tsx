"use client";

/**
 * "Possible duplicate of X — merge into X as a new deck version?" Shown on a
 * newly analysed company once its identity is known (name, website, founders).
 * Never merges silently: one click merges (re-analyses these documents on X as
 * its next deck version, this dossier then redirects there), the other records
 * "different company" so the question is not asked again.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button } from "@/components/ui";

export interface DuplicateView {
  companyId: string;
  name: string;
  slug: string;
  verdict: "SAME_LIKELY" | "POSSIBLE" | "DIFFERENT_LIKELY";
  reasons: string[];
}

const VERDICT: Record<DuplicateView["verdict"], { text: string; tone: "warn" | "neutral" | "unknown" }> = {
  SAME_LIKELY: { text: "Likely the same company", tone: "warn" },
  POSSIBLE: { text: "Possibly the same company", tone: "neutral" },
  DIFFERENT_LIKELY: { text: "Same name — likely a different company", tone: "unknown" },
};

export function DuplicateBanner({ companyId, name, matches, canWrite, running }: { companyId: string; name: string; matches: DuplicateView[]; canWrite: boolean; running: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!matches.length) return null;
  const strong = matches.filter((m) => m.verdict !== "DIFFERENT_LIKELY");

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch(`/api/deals/${encodeURIComponent(companyId)}/duplicates`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      if (body.action === "merge") router.push(`/deals/${json.slug}?run=${json.runId}`);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={strong.length ? "rounded-lg border border-warn/30 bg-warn-soft/40 px-4 py-3" : "rounded-lg border border-line bg-surface-2 px-4 py-3"}>
      <div className="font-medium text-ink">{strong.length ? `Possible duplicate: ${name} may already be in the pipeline` : `Another company named ${name} exists`}</div>
      <ul className="mt-2 space-y-2">
        {matches.map((m) => (
          <li key={m.companyId} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
            <div className="min-w-0">
              <a href={`/deals/${m.slug}`} className="font-medium text-accent-text hover:underline">
                {m.name}
              </a>{" "}
              <Badge tone={VERDICT[m.verdict].tone}>{VERDICT[m.verdict].text}</Badge>
              <div className="text-ink-3">{m.reasons.join(" · ")}</div>
            </div>
            {canWrite && (
              <div className="flex gap-1.5">
                <Button size="sm" variant={m.verdict === "DIFFERENT_LIKELY" ? "ghost" : "primary"} disabled={busy !== null} onClick={() => act({ action: "merge", targetId: m.companyId }, `m${m.companyId}`)} title={`Re-analyse these documents on ${m.name} as its next deck version; this dossier then redirects there`}>
                  {busy === `m${m.companyId}` ? "Merging…" : `Merge into ${m.name} as new deck version`}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => act({ action: "dismiss", otherId: m.companyId }, `d${m.companyId}`)}>
                  {busy === `d${m.companyId}` ? "Saving…" : "Different company"}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {running && <p className="mt-2 text-[12px] text-ink-3">Merging now cancels this analysis; the documents are re-analysed on the other company (identical model calls are served from cache).</p>}
      {error && <p className="mt-2 text-[12.5px] text-risk">{error}</p>}
    </div>
  );
}
