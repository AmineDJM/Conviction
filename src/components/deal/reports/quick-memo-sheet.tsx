import type { ReactNode } from "react";
import type { MetricInstance } from "@/domain/canonical";
import type { QuickMemo } from "@/reports/quick-memo";
import { metricDef } from "@/engine/metrics/dictionary";
import { metricEvidence } from "@/components/deal/metric";
import { Badge, cx } from "@/components/ui";
import { decisionTone, metricValue } from "@/lib/format";

/**
 * One-page decision cockpit. Font sizes are em-relative so the whole sheet
 * scales down for print (one A4 / Letter page) from a single base size.
 */
export function QuickMemoSheet({ q, metrics, footer }: { q: QuickMemo; metrics: MetricInstance[]; footer: ReactNode }) {
  return (
    <article className="print-page text-[13px] leading-[1.45] text-ink print:text-[8.9px] print:leading-[1.36]">
      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 border-b border-line-strong pb-3 print:pb-[0.8em]">
        <div className="min-w-0">
          <h1 className="text-[1.7em] font-semibold leading-tight tracking-tight">{q.name}</h1>
          <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.92em]">
            {q.facts.map((f) => (
              <div key={f.label} className="flex gap-1">
                <dt className="text-ink-3">{f.label}</dt>
                <dd className="num text-ink-2">{f.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="flex flex-col items-start gap-1 sm:items-end print:items-end">
          <div className="t-eyebrow !text-[0.78em]">Current view</div>
          <div className="flex items-center gap-1.5">
            <Badge tone={decisionTone(q.view.status)} dot className="!text-[0.95em]">
              {q.view.label}
            </Badge>
            {q.analysis.depth === "PARTIAL" && (
              <Badge tone="warn" className="!text-[0.9em]">
                Partial analysis
              </Badge>
            )}
          </div>
        </div>
      </header>
      <p className="mt-2.5 text-[1.12em] leading-snug text-ink print:mt-[0.6em]">{q.oneLiner}</p>

      {/* Three columns */}
      <div className="mt-4 grid gap-x-6 gap-y-5 md:grid-cols-3 print:mt-[1em] print:grid-cols-3 print:gap-x-[2.2em] print:gap-y-[1em]">
        <div className="space-y-4 print:space-y-[1em]">
          <Block title="Product">
            {q.product ? (
              <Lines
                rows={[
                  ["Type", q.product.type],
                  ["Does", q.product.whatItDoes],
                  ["User", q.product.user],
                  ["Buyer", q.product.buyer],
                ]}
              />
            ) : (
              <Missing />
            )}
          </Block>
          <Block title="Business model">
            {q.businessModel ? (
              <Lines
                rows={[
                  ["Model", q.businessModel.revenueModel],
                  ["How", q.businessModel.how],
                  ["Pricing", q.businessModel.pricing ?? "Not disclosed"],
                ]}
              />
            ) : (
              <Missing />
            )}
          </Block>
          <Block title="Go-to-market">
            {q.gtm ? (
              <Lines
                rows={[
                  ["Motion", q.gtm.motion],
                  ["Channels", q.gtm.channels],
                  ...(q.gtm.cycle ? ([["Cycle", q.gtm.cycle]] as [string, string][]) : []),
                ]}
              />
            ) : (
              <Missing />
            )}
          </Block>
        </div>

        <div className="space-y-4 print:space-y-[1em]">
          <Block title="Core numbers">
            {metrics.length ? (
              <table className="w-full">
                <tbody>
                  {metrics.map((m) => {
                    const ev = metricEvidence(m);
                    return (
                      <tr key={m.id} className="border-t border-line first:border-t-0">
                        <td className="py-[0.28em] pr-2 text-ink-2">{metricDef(m.metricKey)?.shortName ?? m.label}</td>
                        <td className="num py-[0.28em] pr-2 text-right font-semibold">{metricValue(m.unit, m.normalizedValue)}</td>
                        <td className={cx("py-[0.28em] text-right text-[0.86em]", ev.tone === "ok" ? "text-ok" : ev.tone === "risk" ? "text-risk" : ev.tone === "warn" ? "text-warn" : "text-ink-3")}>
                          {ev.text}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <p className="text-ink-3">No quantitative metrics disclosed.</p>
            )}
          </Block>
          <Block title="Market">
            {q.market ? (
              <Lines
                rows={[
                  ["Size", q.market.range ? `${q.market.range} (${q.market.method?.toLowerCase()})` : "Not reconstructed"],
                  ["Deck TAM", q.market.deckTam ? `${q.market.deckTam}${q.market.inflation ? ` · ${q.market.inflation} reconstructed high` : ""}` : "—"],
                  ["Wedge", q.market.wedge ?? "—"],
                ]}
              />
            ) : (
              <Missing />
            )}
          </Block>
          <Block title="Competition">
            {q.competitors.length ? (
              <ul className="space-y-[0.15em]">
                {q.competitors.map((x) => (
                  <li key={x.name} className="flex justify-between gap-2">
                    <span className="truncate">{x.name}</span>
                    <span className="shrink-0 text-[0.88em] text-ink-3">{x.type}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Missing />
            )}
          </Block>
        </div>

        <div className="space-y-4 print:space-y-[1em]">
          <Block title="Founders">
            {q.founders.length ? (
              <ul className="space-y-[0.6em]">
                {q.founders.map((f) => (
                  <li key={f.name}>
                    <div>
                      <span className="font-semibold">{f.name}</span> <span className="text-ink-3">· {f.role}</span>
                    </div>
                    <div className="text-ink-2">{f.background}</div>
                    <div className="text-[0.92em] text-ink-3">
                      <span className="font-medium text-ink-2">FMF:</span> {f.fmf}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Missing />
            )}
          </Block>
          <Block title="Current view">
            <div className="flex items-center gap-1.5">
              <Badge tone={decisionTone(q.view.status)} dot className="!text-[0.92em]">
                {q.view.label}
              </Badge>
              {q.view.exceptionalOverride && <Badge tone="accent">Exceptional override</Badge>}
            </div>
            <p className="mt-1 text-ink-2">{q.view.rationale}</p>
            {q.view.nextAction && (
              <p className="mt-1 text-ink-2">
                <span className="font-medium text-ink">Next:</span> {q.view.nextAction}
              </p>
            )}
          </Block>
        </div>
      </div>

      {/* Strength / fatal question */}
      <div className="mt-5 grid gap-x-6 gap-y-3 border-t border-line pt-4 md:grid-cols-2 print:mt-[1.1em] print:grid-cols-2 print:gap-x-[2.2em] print:pt-[0.9em]">
        <Block title="Exceptional strength" accent="ok">
          {q.strength ? (
            <>
              <p className="text-ink">{q.strength.claim}</p>
              <p className="mt-0.5 text-[0.9em] text-ink-3">Rated {q.strength.rating.toLowerCase()}</p>
            </>
          ) : (
            <p className="text-ink-3">None evidenced — itself a finding.</p>
          )}
        </Block>
        <Block title="Fatal question" accent="risk">
          <p className="text-ink">{q.fatalQuestion ?? "—"}</p>
        </Block>
      </div>

      {/* Likes / worries */}
      <div className="mt-4 grid gap-x-6 gap-y-3 md:grid-cols-2 print:mt-[0.9em] print:grid-cols-2 print:gap-x-[2.2em]">
        <Block title="What I like">
          <Numbered items={q.likes} tone="ok" />
        </Block>
        <Block title="What worries me">
          <Numbered items={q.worries} tone="warn" />
        </Block>
      </div>

      {/* Questions */}
      <div className="mt-4 border-t border-line pt-4 print:mt-[0.9em] print:pt-[0.9em]">
        <Block title="Top questions for the founder">
          {q.questions.length ? (
            <ol className="grid gap-x-6 gap-y-[0.35em] md:grid-cols-2 print:grid-cols-2 print:gap-x-[2.2em]">
              {q.questions.map((x, i) => (
                <li key={x.id} className="flex gap-2">
                  <span className="num w-[1.3em] shrink-0 text-right text-ink-3">{i + 1}</span>
                  <span>
                    {x.tier === "MUST_ASK" && <span className="mr-1 text-[0.82em] font-semibold uppercase tracking-wide text-risk">Must</span>}
                    {x.text}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <Missing />
          )}
        </Block>
      </div>

      <footer className="mt-4 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-[0.82em] text-ink-3 print:mt-[0.9em]">{footer}</footer>
    </article>
  );
}

function Block({ title, children, accent }: { title: string; children: ReactNode; accent?: "ok" | "risk" }) {
  return (
    <section className="min-w-0 break-inside-avoid">
      <h2 className={cx("t-eyebrow mb-1.5 !text-[0.8em] print:mb-[0.4em]", accent === "ok" && "!text-ok", accent === "risk" && "!text-risk")}>{title}</h2>
      {children}
    </section>
  );
}

function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-[0.25em]">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[4.6em_1fr] gap-2">
          <dt className="text-ink-3">{k}</dt>
          <dd className="text-ink-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Numbered({ items, tone }: { items: string[]; tone: "ok" | "warn" }) {
  if (!items.length) return <Missing />;
  return (
    <ul className="space-y-[0.3em]">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className={cx("shrink-0 leading-[1.45]", tone === "ok" ? "text-ok" : "text-warn")}>•</span>
          <span className="text-ink-2">{t}</span>
        </li>
      ))}
    </ul>
  );
}

function Missing() {
  return <p className="text-ink-3">Not analysed in this version.</p>;
}
