import Link from "next/link";
import type { DerivedAnalysis } from "@/engine/derive";
import { Badge } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { LevelBadge, Origin, Sev } from "@/components/deal/v2/kit";

/** Overview strip: deck integrity and latent signals at a glance, linking to the full tabs. */
export function IntegrityGlance({ d, slug }: { d: DerivedAnalysis; slug: string }) {
  const ig = d.integrity;
  const lt = d.latent;
  if (!ig && !lt) return null;
  const top = ig?.findings.slice(0, 3) ?? [];
  return (
    <section aria-label="Integrity at a glance" className="grid gap-6 md:grid-cols-[1.4fr_1fr] [&>*]:min-w-0">
      {ig && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <div className="t-eyebrow">Deck integrity · computed by code</div>
            <Link href={`/deals/${slug}/integrity`} className="text-[12.5px] text-ink-3 hover:text-ink">
              All findings →
            </Link>
          </div>
          <p className="text-[13.5px] text-ink">{ig.summary.headline}</p>
          {top.length > 0 && (
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {top.map((f) => (
                <li key={f.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1.5 text-[12.5px]">
                  <Sev s={f.severity} />
                  <Origin o={f.origin} />
                  <Link href={`/deals/${slug}/integrity#${f.id}`} className="min-w-0 flex-1 text-ink-2 hover:text-ink">
                    {f.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {(ig || lt) && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <div className="t-eyebrow">Beyond the pitch · secondary signals</div>
            <Link href={`/deals/${slug}/signals`} className="text-[12.5px] text-ink-3 hover:text-ink">
              Signals →
            </Link>
          </div>
          <dl className="divide-y divide-line border-y border-line text-[12.5px]">
            {ig && (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Evidence debt</dt>
                <dd>{ig.evidenceDebt.overall ? <LevelBadge level={ig.evidenceDebt.overall} kind="risk" /> : <Badge tone="unknown">No material items</Badge>}</dd>
              </div>
            )}
            {ig && (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Expected evidence missing</dt>
                <dd className="num text-ink">{ig.summary.missingExpectedCount}</dd>
              </div>
            )}
            {lt && (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Narrative inflation risk</dt>
                <dd>
                  <LevelBadge level={lt.narrativeInflation.level} kind="risk" />
                </dd>
              </div>
            )}
            {lt && (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Operating maturity</dt>
                <dd>
                  <LevelBadge level={lt.operatingMaturity.level} />
                </dd>
              </div>
            )}
            {lt && (
              <div className="flex items-center justify-between gap-3 py-1.5">
                <dt className="text-ink-3">Decision-metric coverage</dt>
                <dd className="num text-ink">{lt.metricSelection.decisionCoveragePct !== null ? `${Math.round(lt.metricSelection.decisionCoveragePct)}% of expected` : <span className="text-unknown italic">Unknown</span>}</dd>
              </div>
            )}
          </dl>
          <p className="mt-1.5 text-[11px] text-ink-3">Never folded into Operating Quality. {ig ? `Peer group ${titleCase(ig.peerGroup.profile)} · ${titleCase(ig.peerGroup.stageBand)}.` : ""}</p>
        </div>
      )}
    </section>
  );
}
