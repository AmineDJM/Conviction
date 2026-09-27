import { requireSession } from "@/server/session";
import { qualityReport, type Stat } from "@/server/quality";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Callout, Section, Td, Th } from "@/components/ui";
import { relative } from "@/lib/format";

export const metadata = { title: "Quality & Reliability" };
export const dynamic = "force-dynamic";

type Fmt = "pct" | "usd" | "sec" | "ms" | "num";

function fmt(v: number | null, f: Fmt) {
  if (v === null || !Number.isFinite(v)) return null;
  switch (f) {
    case "pct":
      return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    case "usd":
      return `$${v.toFixed(3)}`;
    case "sec":
      return `${v.toFixed(0)} s`;
    case "ms":
      return v < 1000 ? `${v.toFixed(0)} ms` : `${(v / 1000).toFixed(1)} s`;
    default:
      return v.toFixed(1);
  }
}

/** Targets are goals the product is measured against, not claims. */
function Metric({ label, stat, f, target, better }: { label: string; stat: Stat; f: Fmt; target?: string; better?: (v: number) => boolean }) {
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
                {e.suites.map((x) => (
                  <Metric key={x.suite} label={`Suite: ${x.suite}`} stat={{ value: x.total ? x.passed / x.total : null, n: x.total, basis: `${x.passed}/${x.total} checks passed` }} f="pct" better={(v) => v === 1} />
                ))}
              </div>
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
            <Metric label="Deals with instruction-like text detected" stat={q.data.securityFlaggedDeals} f="pct" />
          </div>
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
