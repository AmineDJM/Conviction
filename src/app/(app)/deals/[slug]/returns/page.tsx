import type { CanonicalDeal } from "@/domain/canonical";
import { loadDeal } from "@/server/deal";
import { ReturnModelView } from "@/components/deal/returns/return-model";
import { FinancingPath } from "@/components/deal/returns/financing-path";
import { Callout } from "@/components/ui";

export default async function ReturnsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version, fund, registry } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;

  // Only what the return engine reads crosses to the browser (financing, exits,
  // classification, ARPA inputs) — the evidence ledger stays on the server.
  const slim: CanonicalDeal = {
    ...c,
    documents: [],
    sources: [],
    claims: [],
    metricObservations: [],
    metrics: c.metrics.filter((m) => m.isPrimary && (m.metricKey === "acv" || m.metricKey === "arpu_monthly")),
    founders: [],
    foundersFromDeck: [],
    product: null,
    pain: null,
    customers: null,
    pmf: null,
    market: null,
    competition: null,
    moat: [],
    gtm: null,
    risks: [],
    rubric: [],
    nonlinear: null,
    thesis: null,
    falsification: [],
    redTeam: null,
    informationGaps: [],
    questions: [],
  };

  return (
    <main className="mx-auto max-w-[1180px] space-y-14 px-4 py-8 sm:px-8">
      {c.analysis.depth === "PARTIAL" && (
        <Callout tone="warn" title="Partial analysis">
          Some inputs to the return model may be missing. Numbers below are computed only from what was extracted.
        </Callout>
      )}
      <ReturnModelView
        deal={slim}
        fund={fund}
        registryId={registry.id}
        stored={d.returns.inputs}
        samHighUsd={d.market.primary?.highUsd ?? null}
        samMethod={d.market.primary?.method ?? null}
        versionNo={version!.row.versionNo}
        fundChanged={d.fundProfileId !== fund.id}
      />
      <div className="h-px bg-line" />
      <FinancingPath c={c} f={d.financing} slug={company.slug} leadMonths={registry.returns.fundraisingLeadMonths} />
    </main>
  );
}
