import { requireSession } from "@/server/session";
import { qualityReport, type Stat } from "@/server/quality";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Callout, Section, Td, Th } from "@/components/ui";
import { relative } from "@/lib/format";

export const metadata = { title: "Quality & Reliability" };
export const dynamic = "force-dynamic";

type Fmt = "pct" | "usd" | "sec" | "ms" | "num" | "min";

function fmt(v: number | null, f: Fmt) {
  if (v === null || !Number.isFinite(v)) return null;
  switch (f) {
    case "pct":
      return `${(v * 100).toFixed(v < 0.1 || (v > 0.9 && v < 1) ? 1 : 0)}%`;
    case "usd":
      return `$${v.toFixed(3)}`;
    case "sec":
      return `${v.toFixed(0)} s`;
    case "ms":
      return v < 1000 ? `${v.toFixed(0)} ms` : `${(v / 1000).toFixed(1)} s`;
    case "min":
      return `${v.toFixed(0)} min`;
    default:
      return v.toFixed(1);
  }
}

/** Targets are goals the product is measured against, not claims. */
function Metric({ label, stat, f, target, better, extra }: { label: string; stat: Stat; f: Fmt; target?: string; better?: (v: number) => boolean; extra?: string }) {
  const shown = fmt(stat.value, f);
  const tone = stat.value === null || !better ? "neutral" : better(stat.value) ? "ok" : "warn";
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="text-[12px] text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {shown ? <span className="num text-[22px] font-semibold tracking-tight">{shown}</span> : <span className="text-[14px] text-ink-3">Not measured yet</span>}
        {shown && tone !== "neutral" && <Badge tone={tone}>{tone === "ok" ? "on target" : "below target"}</Badge>}
      </div>
      <div className="mt-2 text-[11.5px] leading-snug text-ink-3">
        {stat.basis} · n = {stat.n}
        {extra && <> · {extra}</>}
        {target && <> · target {target}</>}
      </div>
    </div>
  );
}

export default async function QualityPage() {
  const s = await requireSession();
  const q = qualityReport(s.workspaceId);
  const a = q.analyses;
  const e = q.evals;
  return (
    <main className="pb-16">
      <PageHeader
        title="Quality & Reliability"
        meta="Measured on this workspace and on the latest evaluation run. Nothing here is self-reported by the model; unmeasured values say so."
      />
      <div className="max-w-[1180px] space-y-12 px-4 sm:px-8">
        <Section eyebrow="Accuracy (evaluation on fictional ground-truth decks)">
          {e.file ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
                <span>
                  Latest run {e.at ? relative(e.at) : ""} · {e.passed} passed · {e.failed} failed · {e.warnings} warnings
                  {e.spentUsd !== null && <> · model spend ${e.spentUsd.toFixed(3)}</>}
                </span>
                <span className="font-mono text-[11px]">{e.file}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="Metric extraction accuracy" stat={e.extractionAccuracy} f="pct" target="≥ 98.7%" better={(v) => v >= 0.987} />
                <Metric label="Deck traps detected" stat={e.trapDetection} f="pct" target="100%" better={(v) => v >= 0.999} />
                <Metric
                  label="Citation support (semantic)"
                  stat={e.citationSupport ?? { value: null, n: 0, basis: "sampled citations whose cited text supports the statement (LLM judge)" }}
                  f="pct"
                  target="≥ 99.5%"
                  better={(v) => v >= 0.995}
                  extra={e.citationSupport?.ci95 ? `95% CI ${fmt(e.citationSupport.ci95.low, "pct")}–${fmt(e.citationSupport.ci95.high, "pct")}` : undefined}
                />
                <Metric label="Retrieval: relevant passage in top 5" stat={e.retrieval?.hit5 ?? { value: null, n: 0, basis: "labelled questions over the evaluation corpus" }} f="pct" target="≥ 85%" better={(v) => v >= 0.85} />
              </div>
              {e.retrieval && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Retrieval precision@5" stat={e.retrieval.precision5} f="pct" />
                  <Metric label="Retrieval recall@5" stat={e.retrieval.recall5} f="pct" />
                  <Metric label="Retrieval recall@10" stat={e.retrieval.recall10} f="pct" />
                  <Metric label="Whole-fund search: relevant in top 10" stat={e.retrieval.unscopedHit10} f="pct" target="≥ 75%" better={(v) => v >= 0.75} />
                </div>
              )}
              {e.citationSupport && e.citationSupport.byOrigin.length > 0 && (
                <p className="mt-3 text-[12px] text-ink-3">
                  Citation support by origin: {e.citationSupport.byOrigin.map((o) => `${o.origin.toLowerCase()} ${fmt(o.value, "pct") ?? "—"} (n = ${o.n})`).join(" · ")} · as judged before the verbatim check{" "}
                  {fmt(e.citationSupport.judged.value, "pct") ?? "—"}.
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {e.suites.map((x) => (
                  <Metric key={x.suite} label={`Suite: ${x.suite}`} stat={{ value: x.total ? x.passed / x.total : null, n: x.total, basis: `${x.passed}/${x.total} checks passed` }} f="pct" better={(v) => v === 1} />
                ))}
              </div>
              {e.extractionPerDeck.length > 0 && (
                <details className="mt-5 text-[12.5px]">
                  <summary className="cursor-pointer text-ink-3 hover:text-ink">Extraction accuracy per deck ({e.extractionPerDeck.length} fictional decks)</summary>
                  <div className="mt-2 overflow-x-auto">
                    <table className="w-full min-w-[480px]">
                      <thead>
                        <tr>
                          <Th>Deck</Th>
                          <Th>Archetype</Th>
                          <Th align="right">Metrics exact</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.extractionPerDeck.map((d) => (
                          <tr key={d.deck} className="border-t border-line">
                            <Td className="font-mono text-[11.5px]">{d.deck}</Td>
                            <Td className="text-ink-2">{d.archetype ?? "—"}</Td>
                            <Td align="right" className="num">
                              {d.ok}/{d.total}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {e.failures.length > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-[12.5px]">
                    <thead>
                      <tr>
                        <Th>Suite</Th>
                        <Th>Check not passed</Th>
                        <Th>Detail</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.failures.map((f, i) => (
                        <tr key={i} className="border-t border-line">
                          <Td className="text-ink-3">{f.suite}</Td>
                          <Td>{f.check}</Td>
                          <Td className="text-ink-2">{f.detail}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <Callout title="No evaluation run found">
              Run <code className="font-mono">NODE_USE_ENV_PROXY=1 npx tsx evals/run.ts</code> to measure extraction, adversarial robustness, stability, pedigree
              neutrality, missing-data behaviour, citations and chat hallucination traps.
            </Callout>
          )}
        </Section>

        <Section eyebrow="Evidence integrity (current versions)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Verified claims with an independent retrieved source" stat={q.data.verifiedClaimsWithIndependentSource} f="pct" target="100%" better={(v) => v >= 0.995} />
            <Metric label="Web citations actually retrieved" stat={q.data.webCitationRetrievedRate} f="pct" target="≥ 99.5%" better={(v) => v >= 0.995} />
            <Metric label="Metric verification rate" stat={q.data.metricVerificationRate} f="pct" />
            <Metric label="Unknown rate (open information gaps)" stat={q.data.unknownRate} f="pct" />
            <Metric label="Contradicted material claims" stat={q.data.contradictionRate} f="pct" />
            <Metric label="Integrity findings per deal" stat={q.data.integrityFindingsPerDeal} f="num" />
            <Metric label="Human correction rate" stat={q.data.humanCorrectionRate} f="pct" />
            <Metric label="Other analyst overrides per deal" stat={q.data.otherOverridesPerDeal} f="num" />
            <Metric label="Deals with instruction-like text detected" stat={q.data.securityFlaggedDeals} f="pct" />
          </div>
        </Section>

        <Section eyebrow="Human utility (feedback from the team)">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Useful founder questions" stat={q.feedback.usefulQuestionRate} f="pct" target="≥ 91%" better={(v) => v >= 0.91} />
            <Metric label="Useful, judged after a meeting" stat={q.feedback.usefulAfterMeetingRate} f="pct" target="≥ 91%" better={(v) => v >= 0.91} />
            <Metric label="Questions already known" stat={q.feedback.alreadyKnownRate} f="pct" />
            <Metric label="Questions answered in founder meetings" stat={q.feedback.meetingAnsweredRate} f="pct" />
            <Metric label="Analyses with reported value" stat={q.feedback.analysisAnyValue} f="pct" />
            <Metric label="Surfaced better questions" stat={q.feedback.analysisBetterQuestions} f="pct" />
            <Metric label="Surfaced important risks" stat={q.feedback.analysisImportantRisks} f="pct" />
            <Metric label="Showed missing evidence" stat={q.feedback.analysisMissingEvidence} f="pct" />
            <Metric label="Gave market insight" stat={q.feedback.analysisMarketInsight} f="pct" />
            <Metric label="Preparation time saved (median)" stat={q.feedback.minutesSavedMedian} f="min" />
          </div>
          <p className="mt-3 text-[12px] text-ink-3">Recorded on each deal&apos;s Questions tab. Feedback never feeds any score.</p>
        </Section>

        <Section eyebrow="Analysis runs">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Average cost per analysis" stat={a.avgCostUsd} f="usd" target="≤ $0.25 standard" better={(v) => v <= 0.25} />
            <Metric label="Latency P50" stat={a.p50LatencySec} f="sec" target="60–90 s standard" better={(v) => v <= 90} />
            <Metric label="Latency P95" stat={a.p95LatencySec} f="sec" />
            <Metric label="Failure rate" stat={a.failureRate} f="pct" target="< 2%" better={(v) => v < 0.02} />
          </div>
          {a.byMode.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[420px] text-[12.5px]">
                <thead>
                  <tr>
                    <Th>Mode</Th>
                    <Th align="right">Completed</Th>
                    <Th align="right">Avg cost</Th>
                    <Th align="right">P50 latency</Th>
                  </tr>
                </thead>
                <tbody>
                  {a.byMode.map((m) => (
                    <tr key={m.mode} className="border-t border-line">
                      <Td>{m.mode.replace("_", " ").toLowerCase()}</Td>
                      <Td align="right" className="num">{m.runs}</Td>
                      <Td align="right" className="num">{fmt(m.avgCostUsd, "usd") ?? "—"}</Td>
                      <Td align="right" className="num">{fmt(m.p50LatencySec, "sec") ?? "—"}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 text-[12px] text-ink-3">
            {a.runs} deck analyses · {Object.entries(a.byStatus).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(" · ") || "none yet"} · partial rate {fmt(a.partialRate.value, "pct") ?? "—"}
          </div>
        </Section>

        <Section eyebrow="Fund Brain">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Time to first token, P50" stat={q.chat.p50FirstTokenMs} f="ms" target="< 1 s facts · < 2 s single deal · < 4 s complex" />
            <Metric label="Time to first token, P95" stat={q.chat.p95FirstTokenMs} f="ms" />
            <Metric label="Answered without a model call" stat={q.chat.fastPathShare} f="pct" />
            <Metric label="Average cost per answer" stat={q.chat.avgCostUsd} f="usd" />
          </div>
        </Section>
      </div>
    </main>
  );
}
