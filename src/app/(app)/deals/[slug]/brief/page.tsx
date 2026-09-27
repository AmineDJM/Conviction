import type { ReactNode } from "react";
import Link from "next/link";
import { loadDeal } from "@/server/deal";
import type { FounderQuestion } from "@/domain/canonical";
import type { QuestionTier } from "@/domain/enums";
import { buildQuickMemo } from "@/reports/quick-memo";
import { enumLabel } from "@/reports/text";
import { coreMetrics, metricEvidence } from "@/components/deal/metric";
import { metricDef } from "@/engine/metrics/dictionary";
import { FocusFrame } from "@/components/deal/reports/focus-frame";
import { RichText } from "@/components/deal/rich-text";
import { Badge, cx } from "@/components/ui";
import { date, decisionTone, metricValue, type Tone } from "@/lib/format";

const TIERS: { tier: QuestionTier; title: string; tone: Tone }[] = [
  { tier: "MUST_ASK", title: "Must ask", tone: "risk" },
  { tier: "IMPORTANT", title: "Important", tone: "warn" },
  { tier: "OPTIONAL", title: "If time allows", tone: "neutral" },
];

const STATUS_TONE: Record<string, Tone> = { OPEN: "neutral", ASKED: "accent", RESOLVED: "ok", NOT_FULLY_RESOLVED: "warn" };

const PRINT_CSS = `
@media print {
  .brief-doc { font-size: 9pt; }
  .brief-q { break-inside: avoid; }
  @page { margin: 12mm 13mm; }
}
`;

export default async function FounderBriefPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const s = company.slug;
  const q = buildQuickMemo(c, d, { country: company.country });
  const metrics = coreMetrics(c.metrics, 6);
  const open = c.questions.filter((x) => x.status !== "RESOLVED");
  const resolved = c.questions.filter((x) => x.status === "RESOLVED");
  const founderGaps = d.researchPriority.filter((g) => g.channel === "FOUNDER").slice(0, 4);
  let n = 0;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <style>{PRINT_CSS}</style>
      <FocusFrame
        label="Founder call brief"
        meta={
          <Link href={`/deals/${s}/questions`} className="hover:text-ink">
            Manage questions →
          </Link>
        }
      >
        <article className="brief-doc print-page text-[13.5px] leading-[1.5] text-ink">
          {/* One-screen context */}
          <header className="border-b border-line-strong pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="t-eyebrow">Founder call brief</div>
                <h1 className="mt-0.5 text-[1.75em] font-semibold leading-tight tracking-tight">{q.name}</h1>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.9em]">
                  {q.facts.map((f) => (
                    <div key={f.label} className="flex gap-1">
                      <dt className="text-ink-3">{f.label}</dt>
                      <dd className="num text-ink-2">{f.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Badge tone={decisionTone(q.view.status)} dot>
                  {q.view.label}
                </Badge>
                <span className="text-[0.85em] text-ink-3">
                  v{version!.row.versionNo} · {date(version!.row.createdAt)}
                </span>
              </div>
            </div>
            <p className="mt-2 text-[1.08em] text-ink">{q.oneLiner}</p>
          </header>

          <div className="grid gap-x-8 gap-y-4 border-b border-line py-4 md:grid-cols-3 print:grid-cols-3">
            <Ctx title="The bet">{c.thesis ? <RichText text={c.thesis.bet} slug={s} /> : <Muted />}</Ctx>
            <Ctx title="Fatal question" tone="risk">
              {c.thesis ? <RichText text={c.thesis.fatalQuestion} slug={s} /> : <Muted />}
            </Ctx>
            <Ctx title="The call should establish">
              {c.nextBestAction ? <RichText text={c.nextBestAction.action} slug={s} /> : <Muted />}
            </Ctx>
          </div>

          <div className="grid gap-x-8 gap-y-4 border-b border-line py-4 md:grid-cols-[1.3fr_1fr_1fr] print:grid-cols-[1.3fr_1fr_1fr]">
            <Ctx title="Numbers they told us">
              {metrics.length ? (
                <table className="w-full">
                  <tbody>
                    {metrics.map((m) => {
                      const ev = metricEvidence(m);
                      return (
                        <tr key={m.id} className="border-t border-line first:border-t-0">
                          <td className="py-[0.2em] pr-2 text-ink-2">{metricDef(m.metricKey)?.shortName ?? m.label}</td>
                          <td className="num py-[0.2em] pr-2 text-right font-semibold">{metricValue(m.unit, m.normalizedValue)}</td>
                          <td className="py-[0.2em] text-right text-[0.85em] text-ink-3">{ev.text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <Muted />
              )}
            </Ctx>
            <Ctx title="On the call">
              {q.founders.length ? (
                <ul className="space-y-1">
                  {q.founders.map((f) => (
                    <li key={f.name}>
                      <span className="font-medium">{f.name}</span> <span className="text-ink-3">· {f.role}</span>
                      <div className="text-[0.9em] text-ink-3">{f.background}</div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Muted />
              )}
            </Ctx>
            <Ctx title="Only the founder can answer">
              {founderGaps.length ? (
                <ul className="space-y-1 text-ink-2">
                  {founderGaps.map((g) => (
                    <li key={g.gapId} className="flex gap-1.5">
                      <span className="whitespace-nowrap font-mono text-[0.78em] leading-[1.9] text-ink-3">{g.gapId}</span>
                      <span>{g.question}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3">No founder-only gaps recorded.</p>
              )}
              {d.risk.thesisKillers.length > 0 && (
                <p className="mt-2 text-[0.92em] text-risk">
                  Thesis killer to probe: {d.risk.thesisKillers.map((r) => r.title).join("; ")}
                </p>
              )}
            </Ctx>
          </div>

          {/* Questions */}
          {open.length === 0 && <p className="py-6 text-ink-3">No open questions for the founder in this version.</p>}
          {TIERS.map(({ tier, title, tone }) => {
            const qs = open.filter((x) => x.tier === tier);
            if (!qs.length) return null;
            return (
              <section key={tier} className="pt-5">
                <h2 className="mb-1 flex items-center gap-2">
                  <Badge tone={tone}>{title}</Badge>
                  <span className="text-[0.85em] text-ink-3">
                    {qs.length} question{qs.length > 1 ? "s" : ""}
                  </span>
                </h2>
                <ol className="divide-y divide-line">
                  {qs.map((x) => (
                    <QuestionItem key={x.id} x={x} n={++n} slug={s} />
                  ))}
                </ol>
              </section>
            );
          })}

          {resolved.length > 0 && (
            <details className="mt-6 border-t border-line pt-3 text-[0.92em] print:hidden">
              <summary className="cursor-pointer text-ink-3 hover:text-ink">Resolved questions ({resolved.length})</summary>
              <ul className="mt-2 space-y-2">
                {resolved.map((x) => (
                  <li key={x.id}>
                    <div className="text-ink">
                      <span className="mr-1.5 font-mono text-[0.8em] text-ink-3">{x.id}</span>
                      {x.question}
                    </div>
                    {x.answer && <div className="text-ink-2">Answer: {x.answer}</div>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <footer className="mt-6 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-[0.8em] text-ink-3">
            <span>
              {company.name} · Founder call brief · v{version!.row.versionNo} · <span className="font-mono">{version!.row.registryId}</span>
            </span>
            <span>Answers change the analysis only after they are recorded on the Questions tab.</span>
          </footer>
        </article>
      </FocusFrame>
    </main>
  );
}

function QuestionItem({ x, n, slug }: { x: FounderQuestion; n: number; slug: string }) {
  return (
    <li id={x.id} className="brief-q scroll-mt-32 py-4">
      <div className="flex gap-3">
        <span className="num w-5 shrink-0 pt-[0.1em] text-right text-[1.05em] font-semibold text-ink-3">{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[0.85em]">
            <span className="font-mono text-ink-3">{x.id}</span>
            {x.status !== "OPEN" && <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{enumLabel(x.status)}</Badge>}
            {x.affects.map((a) => (
              <span key={a} className="rounded-[4px] border border-line px-1 text-[0.92em] text-ink-3">
                {enumLabel(a)}
              </span>
            ))}
          </div>
          <p className="mt-1 text-[1.08em] font-medium leading-snug text-ink">{x.question}</p>
          <div className="mt-2 grid gap-x-6 gap-y-2 text-[0.93em] md:grid-cols-2 print:grid-cols-2">
            <Field k="Why it matters">
              <RichText text={x.whyItMatters} slug={slug} />
            </Field>
            <Field k="What we know">
              <RichText text={x.knownContext} slug={slug} />
            </Field>
            <Field k="If answer A" accent="ok">
              <RichText text={x.ifAnswerA} slug={slug} />
            </Field>
            <Field k="If answer B" accent="warn">
              <RichText text={x.ifAnswerB} slug={slug} />
            </Field>
          </div>
          {x.answer && (
            <p className="mt-2 text-[0.93em] text-ink-2">
              <span className="font-medium text-ink">Recorded answer:</span> {x.answer}
            </p>
          )}
          <div aria-hidden className="mt-2 hidden h-[3.2em] border-b border-dashed border-line-strong print:block" />
        </div>
      </div>
    </li>
  );
}

function Field({ k, children, accent }: { k: string; children: ReactNode; accent?: "ok" | "warn" }) {
  return (
    <div className={cx(accent && "border-l-2 pl-2.5", accent === "ok" && "border-ok/50", accent === "warn" && "border-warn/60")}>
      <div className="text-[0.82em] font-semibold uppercase tracking-wide text-ink-3">{k}</div>
      <div className="text-ink-2">{children}</div>
    </div>
  );
}

function Ctx({ title, children, tone }: { title: string; children: ReactNode; tone?: "risk" }) {
  return (
    <section className="min-w-0">
      <h2 className={cx("t-eyebrow mb-1 !text-[0.8em]", tone === "risk" && "!text-risk")}>{title}</h2>
      <div className="text-ink">{children}</div>
    </section>
  );
}

function Muted() {
  return <span className="text-ink-3">Not analysed in this version.</span>;
}
