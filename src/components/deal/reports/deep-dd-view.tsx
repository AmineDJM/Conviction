import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { CALC_VIEWS, type DdBlock, type DdSection, type EvidenceStatus } from "@/reports/deep-dd";
import { ANSWERER_LABEL, DRIVER_LABEL, type WorkItem, type WorkPlan } from "@/reports/deep-dd-workplan";
import { Badge, cx } from "@/components/ui";
import { decisionTone, type Tone } from "@/lib/format";
import { RefChip } from "./evidence-drawer";

/**
 * Deep DD report reader. Server component; claim / source chips are client
 * islands that open the evidence drawer. Everything rendered here comes from
 * the structured report (src/reports/deep-dd.ts) — no number is formatted or
 * computed in this file.
 */

const CHIP = "rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:bg-accent-soft hover:text-accent-text print:bg-transparent print:px-0 print:text-ink-3";
const REF_SPLIT = /(\b(?:CLM|SRC|MET)-[A-Z0-9_]+\b|\bRSK-\d{2}\b|\bQ-\d{2}\b|\bGAP-\d{2}\b)/g;

function refHref(id: string, slug: string): string | null {
  if (id.startsWith("MET-")) return `/deals/${slug}/evidence?metric=${id}`;
  if (id.startsWith("RSK-")) return `/deals/${slug}/risks#${id}`;
  if (id.startsWith("Q-") || id.startsWith("GAP-")) return `/deals/${slug}/questions#${id}`;
  const calc = CALC_VIEWS[id];
  if (calc) return `/deals/${slug}${calc.seg ? `/${calc.seg}` : ""}`;
  return null;
}

export function DdRef({ id, slug }: { id: string; slug: string }) {
  if (id.startsWith("CLM-") || id.startsWith("SRC-")) return <RefChip id={id} slug={slug} />;
  const href = refHref(id, slug);
  const calc = CALC_VIEWS[id];
  const text = calc ? `calc · ${calc.seg || "overview"}` : id;
  if (!href) return <span className={CHIP}>{id}</span>;
  return (
    <Link href={href} className={cx(CHIP, calc && "italic")} title={calc ? `Computed by the ${calc.label.toLowerCase()} — open the view` : undefined}>
      {text}
    </Link>
  );
}

export function DdRefs({ refs, slug, className }: { refs: string[]; slug: string; className?: string }) {
  if (!refs.length) return null;
  return (
    <span className={cx("inline-flex flex-wrap gap-1 align-baseline", className)}>
      {refs.map((r) => (
        <DdRef key={r} id={r} slug={slug} />
      ))}
    </span>
  );
}

/** Prose with inline record refs turned into chips. */
export function DdText({ text, slug }: { text: string | null | undefined; slug: string }) {
  if (!text) return null;
  return (
    <>
      {/* split() with one capturing group puts every match at an odd index. */}
      {text.split(REF_SPLIT).map((p, i) => (i % 2 === 1 ? <DdRef key={i} id={p} slug={slug} /> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

const STATUS_TONE: Record<EvidenceStatus, Tone> = {
  VERIFIED: "ok",
  PARTIALLY_VERIFIED: "ok",
  COMPANY_REPORTED: "neutral",
  CONTRADICTED: "risk",
  COMPUTED: "accent",
  INTERPRETATION: "neutral",
  NOT_ANALYSED: "unknown",
  NOT_COMPUTED: "unknown",
  METADATA: "neutral",
};

export function DdSectionView({ section, index, slug }: { section: DdSection; index: number; slug: string }) {
  const ev = section.evidence;
  return (
    <section id={section.id} className="dd-section scroll-mt-[132px]">
      <h2 className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="num text-[13px] font-medium text-ink-3">{index + 1}</span>
        {section.title}
        {section.missing && <span className="text-[12px] font-normal text-ink-3">· {ev.status === "NOT_COMPUTED" ? "not computed" : "not analysed"}</span>}
      </h2>
      <div className="dd-status my-2 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-[12.5px] leading-snug print:rounded-none print:border-x-0 print:bg-transparent print:px-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ink-3">Evidence</span>
          <Badge tone={STATUS_TONE[ev.status]}>{ev.label}</Badge>
          <span className="min-w-0 text-ink-3">{ev.detail}</span>
        </div>
        <div className="mt-1 text-ink-3">
          <span className={cx("font-medium", ev.unknowns.length ? "text-unknown" : "text-ink-3")}>Unknown:</span>{" "}
          {ev.unknowns.length ? (
            ev.unknowns.map((u, i) => (
              <Fragment key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                <DdText text={u} slug={slug} />
              </Fragment>
            ))
          ) : (
            <span>nothing recorded for this section.</span>
          )}
        </div>
      </div>
      {section.blocks.map((b, i) => (
        <Block key={i} b={b} slug={slug} />
      ))}
    </section>
  );
}

function Block({ b, slug }: { b: DdBlock; slug: string }) {
  switch (b.kind) {
    case "lead":
      return (
        <p className="!mt-1 text-[1.04em] text-ink">
          <DdText text={b.text} slug={slug} />
        </p>
      );
    case "p":
      return (
        <p className="text-ink-2">
          <DdText text={b.text} slug={slug} />
        </p>
      );
    case "h3":
      return <h3>{b.text}</h3>;
    case "bullets":
      return (
        <ul className={cx(b.tone === "risk" && "marker:text-risk", b.tone === "ok" && "marker:text-ok", b.tone === "warn" && "marker:text-warn", "text-ink-2")}>
          {b.items.map((t, i) => (
            <li key={i}>
              <DdText text={t.text} slug={slug} /> <DdRefs refs={t.refs.filter((r) => !t.text.includes(r))} slug={slug} />
            </li>
          ))}
        </ul>
      );
    case "facts":
      return (
        <dl className="dd-kv my-3 divide-y divide-line border-y border-line text-[0.88em]">
          {b.rows.map((r, i) => (
            <div key={`${r.k}-${i}`} className="grid gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[170px_minmax(0,1fr)]">
              <dt className="text-ink-3">{r.k}</dt>
              <dd className="min-w-0 break-words text-ink-2">
                <DdText text={r.v} slug={slug} /> <DdRefs refs={r.refs.filter((x) => !r.v.includes(x))} slug={slug} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <figure className="my-3">
          <div className="overflow-x-auto">
            <table className="dd-table w-full min-w-[560px] border-collapse text-[0.84em] leading-snug">
              {b.widths && (
                <colgroup>
                  {b.widths.map((w, i) => (
                    <col key={i} style={w ? { width: w } : undefined} />
                  ))}
                  <col style={{ width: "96px" }} />
                </colgroup>
              )}
              <thead>
                <tr>
                  {b.head.map((h, i) => (
                    <th key={i} className={cx("border-b border-line-strong py-1.5 pr-3 align-bottom text-[0.92em] font-medium text-ink-3", b.align?.[i] === "right" ? "text-right" : "text-left")}>
                      {h}
                    </th>
                  ))}
                  <th className="border-b border-line-strong py-1.5 text-left align-bottom text-[0.92em] font-medium text-ink-3">Refs</th>
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, i) => (
                  <tr key={i} className="break-inside-avoid">
                    {row.cells.map((cell, j) => (
                      <td key={j} className={cx("border-b border-line py-1.5 pr-3 align-top", j === 0 ? "text-ink" : "text-ink-2", b.align?.[j] === "right" && "num text-right")}>
                        <DdText text={cell} slug={slug} />
                      </td>
                    ))}
                    <td className="border-b border-line py-1.5 align-top">
                      <DdRefs refs={row.refs.filter((r) => !row.cells.some((c) => c === r))} slug={slug} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {b.caption && <figcaption className="mt-1.5 text-[0.8em] leading-snug text-ink-3">{b.caption}</figcaption>}
        </figure>
      );
    case "note": {
      const border = { neutral: "border-line-strong", warn: "border-warn", risk: "border-risk", ok: "border-ok" }[b.tone];
      return (
        <div className={cx("my-3 border-l-2 py-0.5 pl-3 text-[0.9em]", border)}>
          {b.title && <div className="font-medium text-ink">{b.title}</div>}
          <div className="break-words text-ink-2">
            <DdText text={b.text} slug={slug} /> {b.refs && <DdRefs refs={b.refs.filter((r) => !b.text.includes(r))} slug={slug} />}
          </div>
        </div>
      );
    }
    case "decision":
      return (
        <div className="my-3 rounded-lg border border-line bg-surface px-4 py-3 print:rounded-none print:border-x-0 print:px-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-eyebrow">Analytical recommendation</span>
            <Badge tone={decisionTone(b.status)} dot>
              {b.label}
            </Badge>
          </div>
          <p className="!mb-0 !mt-1.5 text-[0.93em] text-ink-2">
            <DdText text={b.detail} slug={slug} />
          </p>
        </div>
      );
    case "links":
      return (
        <p className="no-print flex flex-wrap gap-x-4 gap-y-1 text-[0.88em]">
          {b.items.map((l) => (
            <Link key={l.path} href={`/deals/${slug}/${l.path}`} className="text-accent-text hover:underline">
              {l.label} →
            </Link>
          ))}
        </p>
      );
    case "workplan":
      return <WorkPlanView plan={b.plan} slug={slug} />;
  }
}

/* ---------------------------------------------------------------- */
/* Work plan                                                          */
/* ---------------------------------------------------------------- */

const PRIORITY_TONE: Record<WorkItem["priority"], Tone> = { P1: "risk", P2: "warn", P3: "neutral" };

function WorkPlanView({ plan, slug }: { plan: WorkPlan; slug: string }) {
  return (
    <div className="dd-plan my-4 space-y-7">
      <div>
        <h3 className="!mt-0">Kill criteria — what would make us stop</h3>
        {plan.killCriteria.length ? (
          <ol className="dd-kill list-decimal space-y-1.5 pl-5 text-[0.9em] text-ink-2 marker:text-risk">
            {plan.killCriteria.map((k, i) => (
              <li key={i} className="break-words pl-1">
                <DdText text={k.text} slug={slug} /> <DdRefs refs={k.refs.filter((r) => !k.text.includes(r))} slug={slug} />
                <span className="ml-1 text-[0.9em] text-ink-3">
                  · {k.origin === "MODEL" ? "analysis" : "computed"}
                  {k.testedBy ? (
                    <>
                      {" "}
                      · tested by{" "}
                      <a href={`#${k.testedBy}`} className="font-mono text-ink-2 hover:text-accent-text">
                        {k.testedBy}
                      </a>
                    </>
                  ) : (
                    " · no request tests it yet"
                  )}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[0.9em] text-ink-3">No kill criterion is recorded: no thesis killer, failed gate, near breakpoint or breaking point in this version.</p>
        )}
      </div>

      {plan.workstreams.map((w) => (
        <div key={w.id} className="dd-stream">
          <h3 className="!mb-1 flex flex-wrap items-baseline gap-x-2">
            {w.label}
            <span className="text-[12px] font-normal text-ink-3">
              {w.items.length} request{w.items.length > 1 ? "s" : ""}
              {w.p1 > 0 && ` · ${w.p1} P1`}
            </span>
          </h3>
          <ol className="divide-y divide-line border-y border-line">
            {w.items.map((it) => (
              <WorkItemView key={it.id} it={it} slug={slug} />
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function WorkItemView({ it, slug }: { it: WorkItem; slug: string }) {
  return (
    <li id={it.id} className="dd-item scroll-mt-[132px] break-inside-avoid py-3 text-[0.9em]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[11px] text-ink-3">{it.id}</span>
        <Badge tone={PRIORITY_TONE[it.priority]}>{it.priority}</Badge>
        {it.binding && <Badge tone="risk">Binding</Badge>}
        <span className="text-[11.5px] text-ink-3">{DRIVER_LABEL[it.driver.kind]}</span>
      </div>
      <p className="!my-1 break-words font-medium leading-snug text-ink">
        <DdText text={it.requests[0]} slug={slug} />
      </p>
      {it.requests.length > 1 && (
        <ul className="!my-1 !pl-4 text-ink-2">
          {it.requests.slice(1).map((r, i) => (
            <li key={i} className="break-words">
              <span className="text-ink-3">Also: </span>
              <DdText text={r} slug={slug} />
            </li>
          ))}
        </ul>
      )}
      {it.perfectSlides.map((s, i) => (
        <div key={i} className="my-1.5 break-words rounded-md border border-dashed border-line-strong px-2.5 py-1.5 text-ink-2 print:rounded-none">
          <span className="text-[0.88em] font-semibold uppercase tracking-wide text-ink-3">Perfect slide </span>
          <DdText text={s} slug={slug} />
        </div>
      ))}
      <dl className="mt-1.5 grid gap-x-4 gap-y-1 sm:grid-cols-[120px_minmax(0,1fr)]">
        <Row k="Who can answer">{it.answerers.map((a) => ANSWERER_LABEL[a]).join(" · ")}</Row>
        <Row k="Why it matters">
          <DdText text={it.why} slug={slug} />
        </Row>
        <Row k="Driver">
          <DdText text={it.driver.label} slug={slug} /> <DdRefs refs={it.driver.refs} slug={slug} />
          {it.mergedFrom.length > 0 && (
            <span className="mt-0.5 block text-[0.92em] text-ink-3">
              Also covers:
              {it.mergedFrom.map((m, i) => (
                <span key={`${m.key}-${i}`} className="block pl-2">
                  {DRIVER_LABEL[m.kind]} — {m.label.length > 110 ? `${m.label.slice(0, 109)}…` : m.label} <DdRefs refs={m.refs.filter((r) => !r.startsWith("calc:"))} slug={slug} />
                </span>
              ))}
            </span>
          )}
        </Row>
        {it.breakpoints.length > 0 && <Row k="Breakpoints">{it.breakpoints.map((b) => `${b.variable} (${b.status})`).join("; ")}</Row>}
        <Row k="Unlocks">
          <DdText text={it.unlocks.join("; ")} slug={slug} />
        </Row>
        <Row k="Priority">
          {it.leverageBasis}
          {it.binding && " · binding"}
        </Row>
      </dl>
    </li>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{k}</dt>
      <dd className="min-w-0 break-words text-ink-2">{children}</dd>
    </>
  );
}
