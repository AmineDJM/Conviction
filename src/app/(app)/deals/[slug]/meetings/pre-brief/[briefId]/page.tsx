import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { loadDeal } from "@/server/deal";
import * as meetings from "@/server/meetings";
import { PreMeetingBrief } from "@/domain/meetings";
import { FocusFrame } from "@/components/deal/reports/focus-frame";
import { RichText } from "@/components/deal/rich-text";
import { Badge, cx } from "@/components/ui";
import { date, decisionTone } from "@/lib/format";
import { enumLabel } from "@/reports/text";
import { BRIEF_PRINT_CSS, SheetSection } from "@/components/deal/meetings/shared";

const TIER_TONE = { MUST_ASK: "risk", IMPORTANT: "warn", OPTIONAL: "neutral" } as const;
const TIER_TEXT = { MUST_ASK: "Must ask", IMPORTANT: "Important", OPTIONAL: "If time allows" } as const;
const UNKNOWN_SOURCE = { DETERMINANT: "Decisive fact", GAP: "Information gap", SENSITIVITY: "Sensitivity driver", QUESTION: "Open question" } as const;

export default async function PreMeetingBriefPage({ params }: { params: Promise<{ slug: string; briefId: string }> }) {
  const { slug, briefId } = await params;
  const { company, version } = await loadDeal(slug);
  if (!version) return null;
  const row = meetings.getBrief(company.id, briefId);
  if (!row || row.kind !== "PRE_MEETING_BRIEF") notFound();
  const parsed = PreMeetingBrief.safeParse(row.content);
  if (!parsed.success) notFound();
  const b = parsed.data;
  const s = company.slug;
  const q = b.quickMemo;
  const heldAgainst = meetings.listMeetings(company.id).filter((m) => m.preBriefId === row.id);

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <style>{BRIEF_PRINT_CSS}</style>
      <FocusFrame
        label="Pre-meeting brief"
        meta={
          <Link href={`/deals/${s}/meetings`} className="hover:text-ink">
            ← Meetings
          </Link>
        }
      >
        <article className="brief-doc print-page text-[13.5px] leading-[1.5] text-ink">
          <header className="border-b border-line-strong pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="t-eyebrow">Pre-meeting brief</div>
                <h1 className="mt-0.5 text-[1.75em] font-semibold leading-tight tracking-tight">{b.company.name}</h1>
                <p className="mt-1 max-w-[760px] text-[1.05em] text-ink-2">{b.company.oneLiner}</p>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <Badge tone={decisionTone(q.investmentView.status)} dot>
                  {q.investmentView.label}
                </Badge>
                <span className="text-[0.85em] text-ink-3">
                  From v{b.analysis.versionNo} · {b.analysis.stageLabel.toLowerCase()} · {date(b.analysis.createdAt)}
                </span>
                {b.analysis.depth === "PARTIAL" && <Badge tone="warn">Partial analysis</Badge>}
              </div>
            </div>
          </header>

          <SheetSection n={1} title="Quick memo" className="!border-t-0">
            <dl className="grid gap-x-8 gap-y-1.5 md:grid-cols-2 print:grid-cols-2">
              <Row k="What it does" v={q.whatItDoes} />
              <Row k="Product type" v={q.productType} />
              <Row k="User · buyer" v={[q.user, q.buyer].filter(Boolean).join(" · ") || null} />
              <Row k="Business model" v={q.businessModel} />
              <Row k="GTM" v={q.gtm} />
              <Row k="Founders" v={q.founders.length ? q.founders.map((f) => `${f.name} (${f.role})`).join(" · ") : null} />
              <Row
                k="Key traction"
                v={
                  q.keyTraction.length ? (
                    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {q.keyTraction.map((m) => (
                        <Link key={m.metricId} href={`/deals/${s}/evidence?metric=${m.metricId}`} className="whitespace-nowrap hover:text-accent-text">
                          <span className="text-ink-3">{m.label}</span> <span className="num font-semibold">{m.value}</span> <span className="text-[0.82em] text-ink-3">{m.evidence.toLowerCase()}</span>
                        </Link>
                      ))}
                    </span>
                  ) : null
                }
              />
              <Row k="Market" v={q.market} />
              <Row k="Round" v={q.round} />
              <Row k="Competitors" v={q.competitors.length ? q.competitors.join(", ") : null} />
            </dl>
            <p className="mt-2 text-[0.95em]">
              <span className="font-medium">Current investment view — {q.investmentView.label}.</span> <span className="text-ink-2">{q.investmentView.rationale}</span>
            </p>
          </SheetSection>

          <SheetSection n={2} title="What matters most">
            <div className="grid gap-x-6 gap-y-3 md:grid-cols-3 print:grid-cols-3">
              <Cell title="Exceptional strength" tone="ok" item={b.whatMattersMost.exceptionalStrength} slug={s} />
              <Cell title="Biggest concern" tone="warn" item={b.whatMattersMost.biggestConcern} slug={s} />
              <Cell title="Thesis killer" tone="risk" item={b.whatMattersMost.thesisKiller} slug={s} />
            </div>
            <div className="mt-3">
              <div className="mb-1 text-[0.8em] font-semibold uppercase tracking-[0.06em] text-ink-3">Key unknowns</div>
              <ol className="space-y-0.5">
                {b.whatMattersMost.keyUnknowns.map((u, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="num w-4 shrink-0 text-right text-ink-3">{i + 1}</span>
                    <span>
                      <RichText text={u.text} slug={s} /> <span className="text-[0.82em] text-ink-3">· {UNKNOWN_SOURCE[u.source].toLowerCase()}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </SheetSection>

          <SheetSection n={3} title="Meeting objectives" note={b.objectives.some((o) => o.origin === "MODEL") ? "phrased by the model from the analysis" : "rendered from the analysis"}>
            <ol className="space-y-1.5">
              {b.objectives.map((o, i) => (
                <li key={i} className="brief-item flex gap-2.5">
                  <span className="num w-4 shrink-0 text-right font-semibold text-ink-3">{i + 1}</span>
                  <div>
                    <div className="font-medium leading-snug">{o.objective}</div>
                    <div className="text-[0.92em] text-ink-2">
                      {o.why}
                      {o.refs.length > 0 && <span className="ml-1 font-mono text-[0.8em] text-ink-3">{o.refs.join(" · ")}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </SheetSection>

          <SheetSection n={4} title="Questions we need answered" note={`${b.questions.length} highest-value question${b.questions.length === 1 ? "" : "s"}`}>
            <ol className="divide-y divide-line">
              {b.questions.map((x, i) => (
                <li key={x.id} className="brief-q py-2.5 first:pt-0">
                  <div className="flex gap-2.5">
                    <span className="num w-4 shrink-0 pt-[0.1em] text-right font-semibold text-ink-3">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[0.82em]">
                        <span className="font-mono text-ink-3">{x.id}</span>
                        <Badge tone={TIER_TONE[x.tier]}>{TIER_TEXT[x.tier]}</Badge>
                        {x.affects.map((a) => (
                          <span key={a} className="rounded-[4px] border border-line px-1 text-ink-3">
                            {enumLabel(a)}
                          </span>
                        ))}
                      </div>
                      <p className="mt-0.5 text-[1.06em] font-medium leading-snug">{x.question}</p>
                      <div className="mt-1.5 grid gap-x-6 gap-y-1.5 text-[0.93em] md:grid-cols-2 print:grid-cols-2">
                        <Field k="What we already know">
                          <RichText text={x.alreadyKnow} slug={s} />
                        </Field>
                        <Field k="Why the answer matters">
                          <RichText text={x.whyItMatters} slug={s} />
                        </Field>
                        <Field k={x.orientationKnown ? "A strong answer implies" : "If answer A"} accent="ok">
                          <RichText text={x.strongAnswer} slug={s} />
                        </Field>
                        <Field k={x.orientationKnown ? "A weak answer implies" : "If answer B"} accent="warn">
                          <RichText text={x.weakAnswer} slug={s} />
                        </Field>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </SheetSection>

          <footer className="mt-4 space-y-1 border-t border-line pt-2 text-[0.8em] text-ink-3">
            {b.caveats.map((c, i) => (
              <p key={i}>{c}</p>
            ))}
            <p className="flex flex-wrap justify-between gap-2">
              <span>
                {b.company.name} · Pre-meeting brief · {row.id} · built {date(row.createdAt)} from v{b.analysis.versionNo} ({b.analysis.stageCode}) · immutable
              </span>
              <span>
                {row.generation.mode === "DETERMINISTIC_PLUS_MODEL" ? `Deterministic + ${row.generation.promptVersion} (${row.generation.cached ? "cached" : `$${row.generation.costUsd.toFixed(4)}`})` : "Deterministic"}
                {row.generation.fallbackReason && ` · ${row.generation.fallbackReason}`}
                {heldAgainst.length > 0 && ` · used for meeting ${heldAgainst.map((m) => `#${m.seq}`).join(", ")}`}
              </span>
            </p>
          </footer>
        </article>
      </FocusFrame>
    </main>
  );
}

function Row({ k, v }: { k: string; v: ReactNode | null }) {
  return (
    <div className="grid grid-cols-[112px_1fr] gap-2">
      <dt className="text-[0.9em] text-ink-3">{k}</dt>
      <dd className={cx("min-w-0", !v && "text-ink-3")}>{v ?? "Not analysed"}</dd>
    </div>
  );
}

function Cell({ title, tone, item, slug }: { title: string; tone: "ok" | "warn" | "risk"; item: { text: string; refs: string[] } | null; slug: string }) {
  return (
    <div className={cx("border-l-2 pl-3", tone === "ok" && "border-ok/60", tone === "warn" && "border-warn/60", tone === "risk" && "border-risk/60")}>
      <div className={cx("text-[0.8em] font-semibold uppercase tracking-[0.06em]", tone === "risk" ? "text-risk" : "text-ink-3")}>{title}</div>
      {item ? (
        <div className="leading-snug">
          <RichText text={item.text} slug={slug} />
        </div>
      ) : (
        <div className="text-ink-3">None identified — not manufactured.</div>
      )}
    </div>
  );
}

function Field({ k, children, accent }: { k: string; children: ReactNode; accent?: "ok" | "warn" }) {
  return (
    <div className={cx(accent && "border-l-2 pl-2.5", accent === "ok" && "border-ok/50", accent === "warn" && "border-warn/60")}>
      <div className="text-[0.8em] font-semibold uppercase tracking-wide text-ink-3">{k}</div>
      <div className="text-ink-2">{children}</div>
    </div>
  );
}
