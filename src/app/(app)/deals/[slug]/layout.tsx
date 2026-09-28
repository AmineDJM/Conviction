import { loadDeal } from "@/server/deal";
import { DealHeader } from "@/components/deal/deal-header";
import { DealTabs } from "@/components/deal/deal-tabs";
import { RunProgress } from "@/components/deal/run-progress";
import { stageOfVersion } from "@/server/meetings";
import { LineageProvider } from "@/components/deal/lineage/lineage-provider";
import { lineageData } from "@/components/deal/lineage/data";
import { canWrite } from "@/server/session";
import { deckLineage } from "@/server/deck-versions";
import { deckOfDocuments } from "@/engine/deck-lineage";
import { distinctFrom, duplicateSuggestions, sameCompanySignals } from "@/server/company-merge";
import { DuplicateBanner } from "@/components/deal/deck/duplicate-banner";
import { RetryAnalysis } from "@/components/deal/retry-analysis";
import { companyAliases } from "@/brain/retrieval";

export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadDeal(slug);
  const { company, version, run } = loaded;
  const lineage = lineageData(loaded);
  const running = run && (run.status === "RUNNING" || run.status === "QUEUED");
  const stage = version ? stageOfVersion(company.id, version.row.id) : null;
  const decks = deckLineage(company.id);
  const deck = version ? deckOfDocuments(decks, version.canonical.documents.map((d) => d.id)) : null;
  // After triage (identity known): does this dossier duplicate an older one? Asked, never merged silently.
  const duplicates = version ? duplicateSuggestions(loaded.session.workspaceId, company.id) : [];
  const aliases = sameCompanySignals(companyAliases(loaded.session.workspaceId, company.id), duplicates, distinctFrom(company.id));
  const writer = canWrite(loaded.session);
  // Deleting and merging dossiers are reserved to owners and partners (the API enforces the same rule).
  const manager = loaded.session.role === "OWNER" || loaded.session.role === "PARTNER";
  return (
    <div>
      <div className="no-print sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur-md">
      <DealHeader
        slug={company.slug}
        name={company.name}
        oneLiner={version?.canonical.identity.oneLiner ?? company.oneLiner}
        stage={company.stage}
        country={company.country}
        roundUsd={company.roundUsd}
        postMoneyUsd={company.postMoneyUsd}
        instrument={version?.canonical.financing?.instrument ?? null}
        decision={running && !company.decisionStatus ? null : company.decisionStatus}
        icDecision={company.icDecision}
        executionStatus={company.executionStatus}
        registryId={version?.row.registryId ?? null}
        versionNo={version?.row.versionNo ?? null}
        updatedAt={company.updatedAt}
        depth={version?.canonical.analysis.depth ?? null}
        mode={version?.canonical.analysis.mode ?? null}
        versionStage={stage ? { stage: stage.stage, label: stage.label, code: stage.code } : null}
        companyId={company.id}
        deck={deck ? { seq: deck.seq, filename: deck.filename, total: decks.at(-1)?.seq ?? deck.seq } : null}
        canWrite={writer}
        canDelete={manager}
        running={!!running}
        aliases={aliases}
      />
      {version && <DealTabs slug={company.slug} />}
      </div>
      {duplicates.length > 0 && (
        <div className="px-4 pt-4 sm:px-8">
          <DuplicateBanner companyId={company.id} name={company.name} matches={duplicates.map((m) => ({ companyId: m.companyId, name: m.name, slug: m.slug, verdict: m.verdict, reasons: m.reasons }))} canWrite={writer} canMerge={manager} running={!!running} />
        </div>
      )}
      {running && <RunProgress runId={run.id} initial={run.progress} hasVersion={!!version} title={run.kind === "RESEARCH" ? "Refreshing stale data — the current version stays in place until the refresh is applied" : undefined} canStop={writer} />}
      {!running && run?.status === "FAILED" && !version && (
        <div className="px-8 py-10">
          <div className="max-w-xl rounded-lg border border-risk/30 bg-risk-soft/50 px-4 py-3">
            <div className="font-medium text-risk">Analysis failed</div>
            <div className="mt-1 text-ink-2">{run.error}</div>
            <div className="mt-2 text-[12.5px] text-ink-3">No results were fabricated. Spent ${run.spentUsd.toFixed(4)}.{writer ? " The documents are on record: retry without re-uploading." : ""}</div>
            {writer && <RetryAnalysis companyId={company.id} />}
          </div>
        </div>
      )}
      {!running && run?.status === "FAILED" && version && (
        <div className="px-4 pt-4 sm:px-8">
          <div className="rounded-lg border border-risk/30 bg-risk-soft/40 px-4 py-3 text-[13px]">
            <span className="font-medium text-risk">The latest analysis failed</span> <span className="text-ink-2">— {run.error}</span>
            <div className="mt-1 text-[12.5px] text-ink-3">The previous version is shown unchanged. No results were fabricated.</div>
            {writer && <RetryAnalysis companyId={company.id} />}
          </div>
        </div>
      )}
      {version && (lineage ? <LineageProvider data={lineage}>{children}</LineageProvider> : children)}
    </div>
  );
}
