import { requireSession } from "@/server/session";
import { listCompanies, latestRun } from "@/server/repo";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui";
import { PipelineTable, type PipelineRow } from "@/components/deals/pipeline-table";

export const metadata = { title: "Deals" };

export default async function DealsPage() {
  const s = await requireSession();
  const rows: PipelineRow[] = listCompanies(s.workspaceId).map((c) => {
    const run = c.status === "PROCESSING" ? latestRun(c.id) : undefined;
    return {
      id: c.id,
      slug: c.slug,
      name: c.name,
      oneLiner: c.oneLiner,
      stage: c.stage,
      sector: c.sector,
      country: c.country,
      decisionStatus: c.decisionStatus,
      icDecision: c.icDecision,
      executionStatus: c.executionStatus,
      exceptionalStrength: c.exceptionalStrength,
      oqi: c.oqi,
      oqiLower: c.oqiLower,
      oqiUpper: c.oqiUpper,
      oqiCoverage: c.oqiCoverage,
      evidence: c.evidence,
      powerLaw: c.powerLaw,
      riskHeadline: c.riskHeadline,
      riskIndex: c.riskIndex,
      roundUsd: c.roundUsd,
      postMoneyUsd: c.postMoneyUsd,
      baseMoic: c.baseMoic,
      peerGroup: c.peerGroup,
      analysisDepth: c.analysisDepth,
      status: c.status,
      progress: run ? run.progress.filter((p) => p.status === "DONE" || p.status === "SKIPPED").length / Math.max(1, run.progress.length) : null,
      progressLabel: run ? (run.progress.find((p) => p.status === "RUNNING")?.label ?? null) : null,
      updatedAt: c.updatedAt,
    };
  });
  return (
    <main>
      <PageHeader
        title="Deals"
        meta={`${rows.length} ${rows.length === 1 ? "company" : "companies"} · indices are conventional scores within a peer group, never probabilities`}
        actions={
          <Button href="/analyze" variant="primary">
            Analyze company
          </Button>
        }
      />
      <PipelineTable rows={rows} />
    </main>
  );
}
