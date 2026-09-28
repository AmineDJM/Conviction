"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useShell } from "@/components/shell/shell-context";
import { Ago, Badge, Button } from "@/components/ui";
import { DECISION_LABEL, STAGE_LABEL, decisionTone, titleCase, usd } from "@/lib/format";
import { DeckUpload } from "@/components/deal/deck/deck-upload";

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
  /** Entity resolution: former names stated about the company and dossiers linked to it (src/brain/retrieval.ts#companyAliases). */
  aliases?: { formerNames: { name: string; evidence: string }[]; linked: { slug: string; name: string; type: "ALIAS_OF" | "POSSIBLY_SAME_AS"; reasons: string }[] } | null;
  /** Deck lineage: the deck the current version read (v1, v2…) and how many deck versions exist. */
  companyId?: string;
  deck?: { seq: number; filename: string; total: number } | null;
  canWrite?: boolean;
  /** Deleting a company is reserved to owners and partners (the API refuses anyone else). */
  canDelete?: boolean;
  running?: boolean;
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
            {p.deck && (
              <Link href={`/deals/${p.slug}/history#decks`} title={`Current analysis read deck v${p.deck.seq}: ${p.deck.filename}`} className="hover:opacity-80">
                <Badge tone={p.deck.seq > 1 ? "accent" : "neutral"}>
                  Deck v{p.deck.seq}
                  {p.deck.total > p.deck.seq ? ` of ${p.deck.total}` : ""}
                </Badge>
              </Link>
            )}
            <span>
              Updated <Ago at={p.updatedAt} />
            </span>
          </div>
          {p.aliases && (p.aliases.formerNames.length > 0 || p.aliases.linked.length > 0) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
              {p.aliases.formerNames.length > 0 && (
                <span title={p.aliases.formerNames.map((f) => f.evidence).join("\n")}>
                  Formerly {p.aliases.formerNames.map((f) => f.name).join(", ")}
                </span>
              )}
              {p.aliases.linked.filter((l) => l.type === "ALIAS_OF").length > 0 && (
                <span>
                  Also known as{" "}
                  {p.aliases.linked
                    .filter((l) => l.type === "ALIAS_OF")
                    .map((l, i) => (
                      <span key={l.slug}>
                        {i > 0 && ", "}
                        <Link href={`/deals/${l.slug}`} title={l.reasons} className="text-ink-2 underline-offset-2 hover:underline">
                          {l.name}
                        </Link>
                      </span>
                    ))}
                </span>
              )}
              {p.aliases.linked
                .filter((l) => l.type === "POSSIBLY_SAME_AS")
                .map((l) => (
                  <Link key={l.slug} href={`/deals/${l.slug}`} title={`${l.reasons}. Not confirmed — never used to answer questions about either company.`} className="hover:text-ink">
                    Possibly the same company as {l.name} (unconfirmed)
                  </Link>
                ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {p.canDelete && (
            <Button size="sm" variant="ghost" onClick={remove} title="Delete this company and all its data">
              Delete
            </Button>
          )}
          {p.canWrite && p.companyId && <DeckUpload companyId={p.companyId} slug={p.slug} nextDeck={(p.deck?.total ?? 0) + 1} defaultMode={p.mode ?? "STANDARD"} disabled={p.running} />}
          {p.versionNo !== null && (
            <Button size="sm" variant="ghost" onClick={() => ask(`Challenge the investment thesis for ${p.name}.`)}>
              Challenge thesis
            </Button>
          )}
          {/* The memos render from a stored version: nothing to open while the first analysis is running. */}
          {p.versionNo !== null && (
            <>
              <Button size="sm" href={`/deals/${p.slug}/quick`}>
                Quick Memo
              </Button>
              <Button size="sm" href={`/deals/${p.slug}/memo`}>
                Investment Memo
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
