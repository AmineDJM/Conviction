import type { MemoBlock, MemoSection } from "@/reports/investment-memo";
import { Badge, cx } from "@/components/ui";
import { decisionTone } from "@/lib/format";
import { MemoText } from "./memo-text";

/** Renders one deterministic memo section. Server component; chips are client islands. */
export function MemoSectionView({ section, index, slug }: { section: MemoSection; index: number; slug: string }) {
  return (
    <section id={section.id} className="memo-section scroll-mt-[132px]">
      <h2 className="flex items-baseline gap-2.5">
        <span className="num text-[13px] font-medium text-ink-3">{index + 1}</span>
        {section.title}
        {section.missing && <span className="text-[12px] font-normal text-ink-3">· not analysed</span>}
      </h2>
      {section.blocks.map((b, i) => (
        <Block key={i} b={b} slug={slug} />
      ))}
    </section>
  );
}

function Block({ b, slug }: { b: MemoBlock; slug: string }) {
  switch (b.kind) {
    case "lead":
      return (
        <p className="!mt-1 text-[1.04em] text-ink">
          <MemoText text={b.text} slug={slug} />
        </p>
      );
    case "p":
      return (
        <p className="text-ink-2">
          <MemoText text={b.text} slug={slug} />
        </p>
      );
    case "h3":
      return <h3>{b.text}</h3>;
    case "bullets":
      return (
        <ul className={cx(b.tone === "risk" && "marker:text-risk", b.tone === "ok" && "marker:text-ok", b.tone === "warn" && "marker:text-warn", "text-ink-2")}>
          {b.items.map((t, i) => (
            <li key={i}>
              <MemoText text={t} slug={slug} />
            </li>
          ))}
        </ul>
      );
    case "kv":
      return (
        <dl className="memo-kv my-3 divide-y divide-line border-y border-line text-[0.88em]">
          {b.rows.map((r) => (
            <div key={r.k} className="grid gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[170px_1fr]">
              <dt className="text-ink-3">{r.k}</dt>
              <dd className="text-ink-2">
                <MemoText text={r.v} slug={slug} />
              </dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <figure className="my-3">
          <div className="overflow-x-auto">
            <table className="memo-table w-full min-w-[520px] border-collapse text-[0.84em] leading-snug">
              {b.widths && (
                <colgroup>
                  {b.widths.map((w, i) => (
                    <col key={i} style={w ? { width: w } : undefined} />
                  ))}
                </colgroup>
              )}
              <thead>
                <tr>
                  {b.head.map((h, i) => (
                    <th key={i} className={cx("border-b border-line-strong py-1.5 pr-3 align-bottom text-[0.92em] font-medium text-ink-3", b.align?.[i] === "right" ? "text-right" : "text-left")}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((row, i) => (
                  <tr key={i} className="break-inside-avoid">
                    {row.map((cell, j) => (
                      <td key={j} className={cx("border-b border-line py-1.5 pr-3 align-top", j === 0 ? "text-ink" : "text-ink-2", b.align?.[j] === "right" && "num text-right")}>
                        <MemoText text={cell} slug={slug} />
                      </td>
                    ))}
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
          <div className="text-ink-2">
            <MemoText text={b.text} slug={slug} />
          </div>
        </div>
      );
    }
    case "decision":
      return (
        <div className="my-3 rounded-lg border border-line bg-surface px-4 py-3 print:rounded-none print:border-x-0 print:px-0">
          <div className="flex items-center gap-2">
            <span className="t-eyebrow">Analytical recommendation</span>
            <Badge tone={decisionTone(b.status)} dot>
              {b.label}
            </Badge>
          </div>
          <p className="!mb-0 !mt-1.5 text-[0.93em] text-ink-2">
            <MemoText text={b.detail} slug={slug} />
          </p>
        </div>
      );
  }
}
