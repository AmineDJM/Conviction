import type { CanonicalDeal } from "@/domain/canonical";
import { loadDeal } from "@/server/deal";
import { ReturnModelView } from "@/components/deal/returns/return-model";
import { FinancingPath } from "@/components/deal/returns/financing-path";
import { Callout, Section } from "@/components/ui";
import { CapTableReturnsView, SensitivityView, TrajectoryView } from "@/components/deal/returns/economics-views";
import { CounterfactualPanel } from "@/components/deal/returns/counterfactual-panel";
import { InPageNav, NotComputed } from "@/components/deal/v2/kit";

export default async function ReturnsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version, fund, registry } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
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

  const e = d.economics ?? null;
  // The economics engine also reads the primary operating metrics and the model's sensitivity drivers.
  const econDeal: CanonicalDeal = { ...slim, metrics: c.metrics.filter((m) => m.isPrimary) };

  return (
    <main className="mx-auto max-w-[1180px] space-y-14 px-4 py-8 sm:px-8">
      <InPageNav
        items={[
          { href: "#model", label: "Return model" },
          { href: "#cap-table", label: "Cap-table returns" },
          { href: "#trajectory", label: "Required trajectory" },
          { href: "#sensitivity", label: "Sensitivity map" },
          { href: "#counterfactuals", label: "Counterfactuals" },
          { href: "#financing", label: "Financing path" },
        ]}
      />
      {c.analysis.depth === "PARTIAL" && (
        <Callout tone="warn" title="Partial analysis">
          Some inputs to the return model may be missing. Numbers below are computed only from what was extracted.
        </Callout>
      )}
      <div id="model" className="scroll-mt-32 space-y-14">
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
      </div>
      <div className="h-px bg-line" />
      {e ? (
        <>
          <Section id="cap-table" eyebrow="Cap-table returns · stored analysis" title="Ownership path, preference stack and the full waterfall">
            <CapTableReturnsView ct={e.capTableReturns} />
          </Section>
          <Section id="trajectory" eyebrow="Required trajectory" title="The minimal operating path this price requires">
            <TrajectoryView e={e} />
          </Section>
          <Section id="sensitivity" eyebrow="Sensitivity map" title="Where the case breaks — most fragile assumption first">
            <SensitivityView s={e.sensitivity} />
          </Section>
          <Section id="counterfactuals" eyebrow="Counterfactuals · scenarios, not forecasts" title="What changes if one thing goes wrong">
            <CounterfactualPanel builtIns={e.counterfactuals} deal={econDeal} registryId={registry.id} fund={fund} returns={d.returns} backwards={d.backwards} market={d.market} />
          </Section>
          {e.assumptions.length > 0 && (
            <details className="text-[12.5px]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink">Economics engine v{e.version} assumptions ({e.assumptions.length})</summary>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {e.assumptions.map((a) => (
                  <li key={a.id} className="grid gap-x-4 py-1.5 sm:grid-cols-[1fr_1.2fr_140px]">
                    <span className="text-ink-2">{a.label}</span>
                    <span className="text-ink">{a.value}</span>
                    <span className="font-mono text-[10.5px] text-ink-3">{a.kind}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <NotComputed what="The institutional economics report (cap-table returns, trajectory, sensitivity, counterfactuals)" />
      )}
      <div className="h-px bg-line" />
      <div id="financing" className="scroll-mt-32">
        <FinancingPath c={c} f={d.financing} slug={company.slug} leadMonths={registry.returns.fundraisingLeadMonths} />
      </div>
    </main>
  );
}
