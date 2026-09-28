import Link from "next/link";
import { loadDeal } from "@/server/deal";
import { Badge, Bullets, Callout, Section } from "@/components/ui";
import { ScoreStrip } from "@/components/deal/score-strip";
import { DimensionList } from "@/components/deal/dimension-list";
import { coreMetrics, MetricCell } from "@/components/deal/metric";
import { DECISION_LABEL, decisionTone, titleCase } from "@/lib/format";
import { RichText } from "@/components/deal/rich-text";
import { DecisionCore, RealityCheck } from "@/components/deal/decision-core";
import { DecisionFocusPanel } from "@/components/deal/decision-focus";
import { IntegrityGlance } from "@/components/deal/integrity/glance";

export default async function DealOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version!.canonical;
  const d = version!.derived;
  const metrics = coreMetrics(c.metrics, 10);
  const rec = d.recommendation;

  return (
    <main className="mx-auto max-w-[1180px] space-y-10 px-4 py-8 sm:px-8">
      {(c.analysis.depth === "PARTIAL" || c.analysis.securityFlags.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {c.analysis.depth === "PARTIAL" && (
            <Callout tone="warn" title="Partial analysis — not full institutional diligence">
              <ul className="list-disc space-y-0.5 pl-4">
                {c.analysis.partialReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              {c.analysis.researchNotCompleted.length > 0 && <div className="mt-2 text-[12.5px]">Research not completed: {c.analysis.researchNotCompleted.slice(0, 4).join("; ")}</div>}
            </Callout>
          )}
          {c.analysis.securityFlags.length > 0 && (
            <Callout tone="risk" title={`${c.analysis.securityFlags.length} instruction-like passage(s) found in materials — ignored`}>
              {c.analysis.securityFlags.slice(0, 3).map((f, i) => (
                <div key={i} className="mt-1 text-[12.5px]">
                  <span className="text-ink-3">{f.location}:</span> “{f.excerpt.slice(0, 160)}”
                </div>
              ))}
            </Callout>
          )}
        </div>
      )}
      {version.rawCanonical.overrides.length > 0 && (
        <p className="rounded-md border border-accent/25 bg-accent-soft/40 px-3 py-2 text-[12.5px] text-ink-2">
          <span className="font-medium text-accent-text">{version.rawCanonical.overrides.length} analyst override{version.rawCanonical.overrides.length === 1 ? "" : "s"} active</span> —{" "}
          {version.rawCanonical.overrides.map((o) => `${o.target === "METRIC" || o.target === "CLAIM" ? o.ref : o.target.toLowerCase()}.${o.field}`).join(", ")}. Scores use the overridden values; the raw extraction is kept.{" "}
          <Link href={`/deals/${slug}/integrity#overrides`} className="text-accent-text hover:underline">
            Review →
          </Link>
        </p>
      )}
      {/* 30-second read: what it is, what it actually is, what decides it. */}
      <section className="max-w-[860px] space-y-5">
        <div>
          <p className="text-[16px] leading-relaxed text-ink sm:text-[17px]">{c.identity.oneLiner}</p>
          {c.product?.plainExplanation && <p className="mt-2 leading-relaxed text-ink-2"><RichText text={c.product.plainExplanation} slug={slug} /></p>}
        </div>
        <RealityCheck text={c.realityCheck} />
      </section>

      <DecisionCore c={c} slug={slug} />

      <DecisionFocusPanel focus={d.focus} slug={slug} />

      <ScoreStrip d={d} />

      <IntegrityGlance d={d} slug={slug} />

      {/* Core metrics */}
      <Section
        eyebrow="Core metrics"
        title="Measured, with evidence status"
        action={
          <Link href={`/deals/${slug}/evidence`} className="text-[12.5px] text-ink-3 hover:text-ink">
            All metrics and claims →
          </Link>
        }
      >
        {metrics.length ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {metrics.map((m) => (
              <MetricCell key={m.id} m={m} slug={company.slug} />
            ))}
          </div>
        ) : (
          <p className="text-ink-3">No quantitative metrics were disclosed.</p>
        )}
        {d.smallSampleWarnings.length > 0 && (
          <p className="mt-3 text-[12px] text-warn">
            Small-sample caution: {d.smallSampleWarnings.map((w) => `${w.label} (${w.detail.replace(/_/g, " ").toLowerCase()})`).join("; ")}
          </p>
        )}
      </Section>

      {/* Next best action + recommendation */}
      <div className="grid gap-10 md:grid-cols-[1.2fr_1fr]">
        <Section eyebrow="Next best action" title={c.nextBestAction?.action ?? "—"}>
          {c.nextBestAction && <p className="text-ink-2"><RichText text={c.nextBestAction.rationale} slug={slug} /></p>}
          {c.whatILike.length > 0 && (
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <div>
                <div className="t-eyebrow mb-2">What I like</div>
                <Bullets items={c.whatILike.map((t, i) => <RichText key={i} text={t} slug={slug} />)} tone="ok" />
              </div>
              <div>
                <div className="t-eyebrow mb-2">What worries me</div>
                <Bullets items={c.whatWorriesMe.map((t, i) => <RichText key={i} text={t} slug={slug} />)} tone="warn" />
              </div>
            </div>
          )}
        </Section>
        <Section eyebrow="Current view">
          <div className="flex items-center gap-2">
            <Badge tone={decisionTone(rec.status)} dot>
              {DECISION_LABEL[rec.status]}
            </Badge>
            {rec.exceptionalOverride && <Badge tone="accent">Exceptional override</Badge>}
          </div>
          <p className="mt-2 text-ink-2"><RichText text={rec.rationale} slug={slug} /></p>
          {rec.watch && (
            <p className="mt-2 text-[12.5px] text-ink-3">
              Watch trigger: {rec.watch.trigger} · {rec.watch.expectedDate ?? "date n/a"} · awaiting {rec.watch.informationAwaited}
            </p>
          )}
          <details className="mt-3 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink">Recommendation gates</summary>
            <ul className="mt-2 space-y-1">
              {rec.trace.map((t) => (
                <li key={t.gate} className="grid grid-cols-[130px_60px_1fr] gap-2">
                  <span className="font-mono text-[11px] text-ink-3">{t.gate}</span>
                  <span className={t.outcome === "BLOCK" ? "text-risk" : t.outcome === "APPLIED" ? "text-warn" : "text-ink-3"}>{t.outcome}</span>
                  <span className="text-ink-2">{t.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-ink-3">Analytical recommendation only. IC decision and execution status are recorded separately.</p>
          </details>
        </Section>
      </div>

      {/* Exceptional strength — detail behind the decision core */}
      <Section eyebrow="What is exceptional here?" title={c.exceptionalStrengths[0]?.claim ?? "Nothing exceptional identified yet"}>
        {c.exceptionalStrengths.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-[1fr_1fr_1fr]">
            {c.exceptionalStrengths.slice(0, 1).map((x) => (
              <div key={x.id} className="contents">
                <div>
                  <div className="t-eyebrow mb-1">Evidence</div>
                  <p className="text-ink-2"><RichText text={x.evidence} slug={slug} /></p>
                  <div className="mt-2">
                    <Badge tone={x.rating === "EXCEPTIONAL" || x.rating === "STRONG" ? "ok" : x.rating === "INSUFFICIENT_EVIDENCE" ? "unknown" : "warn"}>{titleCase(x.rating)}</Badge>
                  </div>
                </div>
                <div>
                  <div className="t-eyebrow mb-1">Why it matters · durability</div>
                  <p className="text-ink-2"><RichText text={x.whyItMatters} slug={slug} /></p>
                  <p className="mt-1 text-[12.5px] text-ink-3">{x.durability}</p>
                </div>
                <div>
                  <div className="t-eyebrow mb-1">What would invalidate it</div>
                  <p className="text-ink-2"><RichText text={x.invalidation} slug={slug} /></p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-ink-3">The analysis did not find a precise, evidenced exceptional strength. That is itself a finding.</p>
        )}
      </Section>

      {/* The bet, thesis, what could break */}
      {c.thesis && (
        <div className="grid gap-10 md:grid-cols-2">
          <Section eyebrow="The bet" title={c.thesis.bet}>
            <div className="t-eyebrow mb-2 mt-4">Investment thesis</div>
            <Bullets items={c.thesis.thesisPoints.map((t, i) => <RichText key={i} text={t} slug={slug} />)} tone="accent" />
          </Section>
          <Section eyebrow="What could break it" title={c.thesis.fatalWeakness}>
            <div className="t-eyebrow mb-2 mt-4">Failure modes</div>
            <Bullets items={c.thesis.whatCouldBreak.map((t, i) => <RichText key={i} text={t} slug={slug} />)} tone="risk" />
            <Callout tone="warn" title="Fatal question">
              {c.thesis.fatalQuestion}
            </Callout>
          </Section>
        </div>
      )}

      {/* Operating quality detail */}
      <Section eyebrow="Operating quality by dimension" title={`Peer group: ${d.peerGroup.name}`}>
        <DimensionList dims={d.dimensions} slug={company.slug} peerGroup={d.peerGroup.name} weights={d.operatingQuality.weights} />
      </Section>

    </main>
  );
}
