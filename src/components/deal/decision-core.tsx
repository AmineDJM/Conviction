/**
 * DECISION CORE — out of everything in the deck, the few facts that decide.
 * Model-authored compression (canonical.decisionCore), rendered with the
 * status of each determinant so unknowns stay visible at first glance.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { Badge, cx } from "@/components/ui";
import { RichText } from "@/components/deal/rich-text";
import { Refs } from "@/components/deal/v2/kit";
import type { Tone } from "@/lib/format";

const DETERMINANT: Record<string, { text: string; tone: Tone }> = {
  VERIFIED: { text: "Verified", tone: "ok" },
  COMPANY_REPORTED: { text: "Company-reported", tone: "neutral" },
  INFERRED: { text: "Inferred", tone: "warn" },
  UNKNOWN: { text: "Unknown", tone: "unknown" },
  CONTRADICTED: { text: "Contradicted", tone: "risk" },
};

export function RealityCheck({ text }: { text: string | null }) {
  return (
    <section aria-label="Reality check" className="border-l-2 border-ink pl-4">
      <div className="t-eyebrow mb-1">Reality check · ignoring the founder&apos;s narrative</div>
      {text ? (
        <p className="text-[16px] leading-snug text-ink sm:text-[17px]">{text}</p>
      ) : (
        <p className="text-[13px] text-ink-3">No reality check was produced for this version. Nothing is written in its place.</p>
      )}
    </section>
  );
}

function Cell({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "risk" | "accent" }) {
  return (
    <div className={cx("min-w-0 border-t-2 pt-2", tone === "risk" ? "border-risk/60" : tone === "accent" ? "border-accent/60" : "border-line-strong")}>
      <div className="t-eyebrow mb-1">{label}</div>
      <div className="text-[13.5px] leading-snug text-ink">{children}</div>
    </div>
  );
}

export function DecisionCore({ c, slug }: { c: CanonicalDeal; slug: string }) {
  const dc = c.decisionCore;
  if (!dc)
    return (
      <section aria-label="Decision core">
        <div className="t-eyebrow mb-2">Decision core</div>
        <p className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-3">
          The decision-core pass did not run for this version (partial analysis or earlier engine). The bet, determinants and reversing question are not inferred in its place — see the thesis below.
        </p>
      </section>
    );
  const counts = dc.determinants.reduce<Record<string, number>>((a, d) => ((a[d.status] = (a[d.status] ?? 0) + 1), a), {});
  const outliers = dc.outlierSignals.slice(0, 2);
  return (
    <section aria-label="Decision core" className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="t-eyebrow">Decision core · model-authored compression, statuses from the evidence ledger</div>
        <div className="flex flex-wrap gap-1.5 text-[11.5px]">
          {(["VERIFIED", "COMPANY_REPORTED", "INFERRED", "UNKNOWN", "CONTRADICTED"] as const)
            .filter((k) => counts[k])
            .map((k) => (
              <Badge key={k} tone={DETERMINANT[k]!.tone}>
                {counts[k]} {DETERMINANT[k]!.text.toLowerCase()}
              </Badge>
            ))}
        </div>
      </div>

      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label="The bet" tone="accent">
          <RichText text={dc.compression.bet} slug={slug} />
        </Cell>
        <Cell label="Exceptional strength">
          <RichText text={dc.compression.exceptionalStrength} slug={slug} />
        </Cell>
        <Cell label="Breaking point" tone="risk">
          <RichText text={dc.compression.breakingPoint} slug={slug} />
        </Cell>
        <Cell label="Return path">
          <RichText text={dc.compression.returnPath} slug={slug} />
          <div className="mt-1 text-[11px] text-ink-3">Model narrative — the computed returns are on the Returns tab.</div>
        </Cell>
      </div>

      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-semibold text-ink">The {dc.determinants.length === 5 ? "five" : dc.determinants.length} determinants</h3>
          <span className="text-[11.5px] text-ink-3">facts or unknowns that decide the outcome</span>
        </div>
        <ol className="divide-y divide-line border-y border-line">
          {dc.determinants.map((d, i) => {
            const st = DETERMINANT[d.status] ?? { text: d.status, tone: "neutral" as Tone };
            return (
              <li key={i} className="grid grid-cols-[18px_1fr] gap-x-2 py-2 sm:grid-cols-[18px_minmax(0,1.1fr)_120px_minmax(0,1.4fr)] sm:gap-x-4">
                <span className="num pt-[1px] text-[11.5px] text-ink-3">{i + 1}</span>
                <span className="min-w-0 text-[13px] font-medium text-ink">
                  <RichText text={d.fact} slug={slug} />
                </span>
                <span className="col-start-2 mt-1 sm:col-start-auto sm:mt-0">
                  <Badge tone={st.tone} dot={d.status === "UNKNOWN" || d.status === "CONTRADICTED"}>
                    {st.text}
                  </Badge>
                </span>
                <span className="col-start-2 mt-1 min-w-0 text-[12.5px] text-ink-2 sm:col-start-auto sm:mt-0">
                  <RichText text={d.whyDecisive} slug={slug} /> <Refs refs={d.refs} slug={slug} />
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        <div className="rounded-lg border border-warn/30 bg-warn-soft/40 px-4 py-3 md:col-span-1">
          <div className="t-eyebrow mb-1 !text-warn">The one question that could reverse the decision</div>
          <p className="text-[13.5px] font-medium leading-snug text-ink">
            <RichText text={dc.reversingQuestion.question} slug={slug} />
          </p>
          <dl className="mt-2 space-y-1 text-[12.5px]">
            <div>
              <dt className="inline text-ok">If favorable · </dt>
              <dd className="inline text-ink-2">{dc.reversingQuestion.ifFavorable}</dd>
            </div>
            <div>
              <dt className="inline text-risk">If unfavorable · </dt>
              <dd className="inline text-ink-2">{dc.reversingQuestion.ifUnfavorable}</dd>
            </div>
          </dl>
        </div>
        <div>
          <div className="t-eyebrow mb-1.5">Outlier signals {outliers.length ? `(${outliers.length})` : ""}</div>
          {outliers.length ? (
            <ul className="space-y-2.5">
              {outliers.map((o, i) => (
                <li key={i} className="text-[12.5px]">
                  <div className="font-medium text-ink">{o.signal}</div>
                  <div className="text-ink-2">Why rare: {o.rarity}</div>
                  <div className="text-ink-3">Would confirm: {o.whatWouldConfirm}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">None identified. No outlier signal is manufactured when the evidence does not show one.</p>
          )}
        </div>
        <div>
          <div className="t-eyebrow mb-1.5">Asymmetric conviction</div>
          <dl className="space-y-1.5 text-[12.5px]">
            <div>
              <dt className="text-ink-3">What the market sees</dt>
              <dd className="text-ink-2">{dc.asymmetricConviction.whatTheMarketSees}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Repairable weaknesses</dt>
              <dd className="text-ink-2">{dc.asymmetricConviction.repairableWeaknesses}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Exceptional and hard to copy</dt>
              <dd className={/^nothing identified/i.test(dc.asymmetricConviction.exceptionalAndHardToCopy.trim()) ? "text-unknown italic" : "font-medium text-ink"}>{dc.asymmetricConviction.exceptionalAndHardToCopy}</dd>
            </div>
          </dl>
        </div>
      </div>

      {dc.secondOrder.length > 0 && (
        <details className="group text-[12.5px]">
          <summary className="cursor-pointer list-none text-ink-3 hover:text-ink">
            <span className="t-eyebrow">Second-order effects</span> <span className="ml-1 group-open:hidden">· {dc.secondOrder.length} questions — show</span>
          </summary>
          <dl className="mt-2 grid gap-x-8 gap-y-2 md:grid-cols-2">
            {dc.secondOrder.map((q, i) => (
              <div key={i}>
                <dt className="font-medium text-ink">{q.question}</dt>
                <dd className="text-ink-2">{q.answer}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
