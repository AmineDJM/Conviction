import { loadDeal } from "@/server/deal";
import { DealHeader } from "@/components/deal/deal-header";
import { DealTabs } from "@/components/deal/deal-tabs";
import { RunProgress } from "@/components/deal/run-progress";

export default async function DealLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version, run } = await loadDeal(slug);
  const running = run && (run.status === "RUNNING" || run.status === "QUEUED");
  return (
    <div>
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
      />
      {version && <DealTabs slug={company.slug} />}
      {running && <RunProgress runId={run.id} initial={run.progress} hasVersion={!!version} />}
      {!running && run?.status === "FAILED" && !version && (
        <div className="px-8 py-10">
          <div className="max-w-xl rounded-lg border border-risk/30 bg-risk-soft/50 px-4 py-3">
            <div className="font-medium text-risk">Analysis failed</div>
            <div className="mt-1 text-ink-2">{run.error}</div>
            <div className="mt-2 text-[12.5px] text-ink-3">No results were fabricated. Spent ${run.spentUsd.toFixed(4)}. Re-upload the deck to retry.</div>
          </div>
        </div>
      )}
      {version && children}
    </div>
  );
}
