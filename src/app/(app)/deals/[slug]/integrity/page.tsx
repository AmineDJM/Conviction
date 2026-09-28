import { loadDeal } from "@/server/deal";
import { canWrite } from "@/server/session";
import { Section } from "@/components/ui";
import { InPageNav, NotComputed } from "@/components/deal/v2/kit";
import {
  Chronology,
  Confidence,
  Density,
  ExpectedEvidence,
  FindingsList,
  ImpliedTable,
  Inconsistencies,
  IntegritySummaryStrip,
  SourceReliabilityTable,
} from "@/components/deal/integrity/sections";
import { AlternativeExplanations, DeckForensics, PerfectSlides } from "@/components/deal/integrity/forensics";
import { OverridesPanel } from "@/components/deal/overrides/overrides-panel";
import { overrideRows } from "@/components/deal/overrides/rows";

export const metadata = { title: "Integrity" };

export default async function IntegrityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { session, company, version } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version.canonical;
  const r = version.derived.integrity ?? null;
  const docId = c.documents[0]?.id ?? null;
  const rows = overrideRows(version.rawCanonical);

  return (
    <main className="mx-auto max-w-[1180px] space-y-12 px-4 py-8 sm:px-8">
      <InPageNav
        items={[
          { href: "#findings", label: "Findings", count: r?.findings.length ?? null },
          { href: "#implied", label: "Implied metrics", count: r?.impliedMetrics.length ?? null },
          { href: "#inconsistencies", label: "Inconsistencies", count: r ? r.crossSlide.length + r.contradictions.length : null },
          { href: "#chronology", label: "Chronology" },
          { href: "#expected", label: "Expected evidence & debt" },
          { href: "#confidence", label: "Confidence" },
          { href: "#sources", label: "Sources", count: c.sources.length },
          { href: "#forensics", label: "Deck forensics" },
          { href: "#perfect", label: "Perfect slides" },
          { href: "#alternatives", label: "Alternative explanations", count: c.alternativeExplanations.length },
          { href: "#overrides", label: "Overrides", count: rows.length },
        ]}
      />

      {r ? (
        <>
          <Section id="summary" eyebrow="Deck integrity · computed by code from the canonical object">
            <IntegritySummaryStrip r={r} />
          </Section>

          <Section id="findings" eyebrow="Findings, ranked" title="Severity first; computed rules before model readings">
            <FindingsList r={r} slug={slug} docId={docId} />
          </Section>

          <Section id="implied" eyebrow="Implied metrics" title="What the deck's own numbers imply, against what it states">
            <ImpliedTable r={r} slug={slug} />
          </Section>

          <Section id="inconsistencies" eyebrow="Cross-slide consistency" title="The same fact, told differently on different pages">
            <Inconsistencies r={r} c={c} slug={slug} docId={docId} />
          </Section>

          <Section id="chronology" eyebrow="Chronology" title="Actual, contracted and forward figures kept apart">
            <Chronology r={r} slug={slug} docId={docId} />
          </Section>

          <Section id="expected" eyebrow="Expected evidence by stage" title="Evidence debt and what to verify first">
            <ExpectedEvidence r={r} slug={slug} />
          </Section>

          <div className="grid gap-12 lg:grid-cols-2 [&>*]:min-w-0">
            <Section id="confidence" eyebrow="Confidence by field" title="How far each number can be relied on">
              <Confidence r={r} slug={slug} />
            </Section>
            <Section id="density" eyebrow="Information density" title="Communication signal, not company quality">
              <Density r={r} slug={slug} docId={docId} />
            </Section>
          </div>

          <Section id="sources" eyebrow="Source reliability & freshness" title="Tier, age and flags of every source">
            <SourceReliabilityTable r={r} c={c} slug={slug} />
          </Section>
        </>
      ) : (
        <NotComputed what="The deck integrity report" />
      )}

      <Section id="forensics" eyebrow="Deck forensics · model reading, labelled" title="What the deck is trying to make me believe">
        <DeckForensics c={c} slug={slug} docId={docId} />
      </Section>

      <Section id="perfect" eyebrow="Perfect slides" title="The slide that would settle each gap">
        <PerfectSlides c={c} r={r} />
      </Section>

      <Section id="alternatives" eyebrow="Alternative explanations" title="Non-bullish readings of the positive signals">
        <AlternativeExplanations c={c} slug={slug} />
      </Section>

      <Section id="overrides" eyebrow="Analyst overrides" title="Human judgement, recorded next to the raw data">
        <OverridesPanel
          companyId={company.id}
          versionId={version.row.id}
          canWrite={canWrite(session)}
          rows={rows}
          claims={c.claims.map((x) => ({ id: x.id, statement: x.statement, verification: x.verification, material: x.material }))}
          classification={c.classification as unknown as Record<string, unknown>}
          identity={c.identity as unknown as Record<string, unknown>}
        />
      </Section>
    </main>
  );
}
