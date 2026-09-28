"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/shell-context";
import { Badge, Button } from "@/components/ui";
import { DECISION_LABEL, STAGE_LABEL, decisionTone, relative, titleCase, usd } from "@/lib/format";

export function DealHeader(p: {
  slug: string;
  name: string;
  oneLiner: string | null;
  stage: string | null;
  country: string | null;
  roundUsd: number | null;
  postMoneyUsd: number | null;
  instrument: string | null;
  decision: string | null;
  icDecision: string;
  executionStatus: string;
  registryId: string | null;
  versionNo: number | null;
  updatedAt: string;
  depth: string | null;
  mode: string | null;
  /** Meetings workflow stage of the current version (PRE_MEETING_ANALYSIS, POST_MEETING_ANALYSIS_Vn, DECK_REANALYSIS). */
  versionStage?: { stage: string; label: string; code: string } | null;
}) {
  const { ask } = useShell();
  const router = useRouter();
  async function remove() {
    if (!confirm(`Permanently delete ${p.name}? Documents, analyses, versions and deal memory are removed. This cannot be undone.`)) return;
    const res = await fetch(`/api/deals/${encodeURIComponent(p.slug)}`, { method: "DELETE" });
    if (res.ok) router.push("/");
    else alert((await res.json().catch(() => ({}))).error ?? "Delete failed");
  }
  return (
    <header className="no-print px-4 pb-3 pt-5 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="t-display">{p.name}</h1>
            {p.decision && (
              <Badge tone={decisionTone(p.decision)} dot>
                {DECISION_LABEL[p.decision]}
              </Badge>
            )}
            {p.depth === "PARTIAL" && (
              <Badge tone="warn" title="Some steps were skipped or limited by budget. Not full diligence.">
                Partial analysis
              </Badge>
            )}
            {p.mode === "FAST_SCREEN" && <Badge tone="neutral">Fast screen</Badge>}
            {p.icDecision !== "PENDING" && <Badge tone={p.icDecision === "APPROVED" ? "ok" : "unknown"}>IC {titleCase(p.icDecision)}</Badge>}
            {p.executionStatus !== "NOT_STARTED" && <Badge tone="accent">{titleCase(p.executionStatus)}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-3">
            <span>{STAGE_LABEL[p.stage ?? ""] ?? "Stage unknown"}</span>
            {p.country && <span>{p.country}</span>}
            {p.roundUsd !== null && (
              <span className="num">
                Raising {usd(p.roundUsd)}
                {p.postMoneyUsd !== null && ` · ${usd(p.postMoneyUsd)} ${p.instrument === "SAFE" ? "cap" : "post"}`}
              </span>
            )}
            {p.registryId && <span className="font-mono text-[11px]">{p.registryId}</span>}
            {p.versionNo !== null && <span>v{p.versionNo}</span>}
            {p.versionStage && (
              <Link href={`/deals/${p.slug}/meetings`} title={`${p.versionStage.code} — see the Meetings tab`} className="hover:opacity-80">
                <Badge tone={p.versionStage.stage === "POST_MEETING_ANALYSIS" ? "accent" : p.versionStage.stage === "DECK_REANALYSIS" ? "warn" : "neutral"}>{p.versionStage.label}</Badge>
              </Link>
            )}
            <span>Updated {relative(p.updatedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={remove} title="Delete this company and all its data">
            Delete
          </Button>
          <Button size="sm" variant="ghost" onClick={() => ask(`Challenge the investment thesis for ${p.name}.`)}>
            Challenge thesis
          </Button>
          <Button size="sm" href={`/deals/${p.slug}/quick`}>
            Quick Memo
          </Button>
          <Button size="sm" href={`/deals/${p.slug}/memo`}>
            Investment Memo
          </Button>
        </div>
      </div>
    </header>
  );
}
