/**
 * The Divergence tab's header ("Why could this company diverge from
 * lookalikes?") and one section per factor: level, the one-line why, the
 * numbers code computed, the evidence with page links, what is missing, the
 * rule, and what it means for the investment.
 */
import type { DivergenceFactor, DivergenceReport } from "@/engine/divergence";
import { cx } from "@/components/ui";
import { FactorDetail } from "./details";
import { BasisChip, LevelChip, Numbers, PageLinks, RefChips, SubLabel, label, levelTone } from "./primitives";

const TONE_BAR: Record<string, string> = { ok: "bg-ok", neutral: "bg-ink-3", risk: "bg-risk", unknown: "bg-line-strong", warn: "bg-warn", accent: "bg-accent" };

export function DivergenceHeader({ r, computedOnView }: { r: DivergenceReport; computedOnView: boolean }) {
  return (
    <section className="space-y-5">
      <div className="max-w-[860px]">
        <div className="t-eyebrow mb-1.5">Divergence factors · ten ordinal readings, no blended score</div>
        <h1 className="t-display text-ink">{r.headline.question}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{r.headline.sentence}</p>
      </div>
      <ol className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
        {r.factors.map((f) => (
          <li key={f.id} className="bg-bg">
            <a href={`#${f.id}`} className="group flex h-full flex-col gap-1.5 px-3.5 py-3 transition-colors hover:bg-surface-2/70">
              <div className="flex items-baseline gap-2">
                <span className="num text-[11px] text-ink-3">{String(f.n).padStart(2, "0")}</span>
                <span className="text-[12.5px] font-medium leading-snug text-ink group-hover:underline">{f.name}</span>
              </div>
              <div className="mt-auto flex items-center gap-2">
                <span className={cx("h-1 w-8 rounded-full", TONE_BAR[levelTone(f.level)])} aria-hidden />
                <LevelChip level={f.level} />
              </div>
            </a>
          </li>
        ))}
      </ol>
      <p className="text-[11.5px] leading-relaxed text-ink-3">
        {r.coverage.assessed} of {r.coverage.total} factors readable · deck divergence pass {r.draftAvailable ? "available" : "not available"} · engine {r.version}, assumptions {r.assumptionsVersion}, peer group {r.peerGroup}.
        {computedOnView && " Computed on view from the stored record — this version predates the engine."} Levels are ordinal (Strong / Adequate / Weak / Insufficient evidence), never probabilities, and are never folded into the Operating Quality Index.
        {r.diagnostics.length > 0 && ` Diagnostics: ${r.diagnostics.join("; ")}.`}
      </p>
    </section>
  );
}

export function FactorSection({ f, slug, docId }: { f: DivergenceFactor; slug: string; docId: string | null }) {
  const missing = f.coverage.missing;
  return (
    <section id={f.id} className="scroll-mt-28 border-t border-line pt-6">
      <div className="grid gap-x-10 gap-y-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left rail: identity and level */}
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="num text-[12px] text-ink-3">{String(f.n).padStart(2, "0")}</span>
            <h2 className="t-section text-ink">{f.name}</h2>
          </div>
          <p className="text-[12.5px] leading-snug text-ink-3">{f.question}</p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <LevelChip level={f.level} />
            {f.reading && f.reading !== "UNREAD" && <span className="text-[11.5px] text-ink-3">{label(f.reading.split(" · ")[0]!)}</span>}
          </div>
          <div className="flex flex-wrap gap-1 pt-0.5">
            {f.basis.map((b) => (
              <BasisChip key={b} b={b} />
            ))}
          </div>
          {f.pages.length > 0 && <PageLinks pages={f.pages} slug={slug} docId={docId} />}
        </div>

        {/* Body */}
        <div className="min-w-0 space-y-5">
          <p className="text-[14px] leading-relaxed text-ink">{f.why}</p>
          <Numbers values={f.computed} />
          <FactorDetail f={f} slug={slug} docId={docId} />
          {f.implications.length > 0 && (
            <div>
              <SubLabel>What it means for the investment</SubLabel>
              <ul className="space-y-1 text-[13px] text-ink-2">
                {f.implications.map((x, i) => (
                  <li key={i} className="flex gap-2.5">
                    <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
                    <span>{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {f.evidence.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer list-none text-[12px] text-ink-3 hover:text-ink">
                <span className="group-open:hidden">Show evidence ({f.evidence.length}) →</span>
                <span className="hidden group-open:inline">Hide evidence</span>
              </summary>
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {f.evidence.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 py-1.5 text-[12.5px]">
                    <BasisChip b={e.basis} />
                    <span className="min-w-0 flex-1 text-ink-2">{e.text}</span>
                    <PageLinks pages={e.pages} slug={slug} docId={docId} />
                    <RefChips refs={e.refs} slug={slug} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="grid gap-4 border-t border-line pt-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <div>
              <div className="t-eyebrow mb-1">What is missing</div>
              {missing.length ? (
                <ul className="space-y-0.5 text-[12px] text-ink-2">
                  {missing.map((m) => (
                    <li key={m}>· {m}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-ink-3">Every input this factor uses was available.</p>
              )}
              {f.coverage.note && <p className="mt-1 text-[11.5px] text-ink-3">{f.coverage.note}</p>}
            </div>
            <div>
              <div className="t-eyebrow mb-1">Rule</div>
              <p className="text-[11.5px] leading-relaxed text-ink-3">{f.rule}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
