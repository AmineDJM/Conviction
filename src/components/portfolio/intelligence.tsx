/**
 * PORTFOLIO INTELLIGENCE views (server). Rendered from portfolioIntelligence()
 * over the current version of every deal — deterministic, every rule stated,
 * rankings and indices conventional (never probabilities).
 */
import Link from "next/link";
import type { ExposureBucket, ExposureView, PortfolioReport } from "@/engine/portfolio";
import { Badge, cx } from "@/components/ui";
import { STAGE_LABEL, evidenceTone, multiple, pct, titleCase, usd } from "@/lib/format";
import { enumLabel } from "@/components/deal/tabs/shared";
import { Rule, Stat, SubHead, Table } from "@/components/deal/v2/kit";

const th = "px-2 py-1.5 text-left text-[11px] font-medium text-ink-3 first:pl-0";
const td = "border-t border-line px-2 py-1.5 align-top first:pl-0";
const tdr = cx(td, "num text-right");

type Slugs = Record<string, string>;

function Co({ id, name, slugs }: { id: string; name: string; slugs: Slugs }) {
  const slug = slugs[id];
  return slug ? (
    <Link href={`/deals/${slug}`} className="font-medium text-ink hover:text-accent-text" title={name}>
      {name}
    </Link>
  ) : (
    <span className="font-medium text-ink">{name}</span>
  );
}

export function IntelligenceSummary({ r, fundSizeUsd }: { r: PortfolioReport; fundSizeUsd: number }) {
  const c = r.exposure.committed;
  const p = r.exposure.pipeline;
  const breaches = r.exposure.companyConcentration.filter((x) => !x.ok).length;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
      <Stat k="Deals analyzed" v={r.deals} />
      <Stat k="Committed" v={`${c.deals} · ${pct(c.pctOfFund, 1)}`} sub={`${usd(c.capitalUsd)} incl. reserves`} />
      <Stat k="Admissible pipeline" v={`${p.deals} · ${pct(p.pctOfFund, 1)}`} sub="of fund if all were done" tone={p.pctOfFund > 100 ? "warn" : undefined} />
      <Stat k="Redundant pairs" v={r.redundancy.filter((x) => x.level === "REDUNDANT").length} sub={`${r.redundancy.length} overlapping or redundant`} />
      <Stat k="Correlated-risk clusters" v={r.correlatedRisks.length} />
      <Stat k="Concentration breaches" v={breaches} tone={breaches ? "risk" : undefined} sub={`limit ${r.exposure.maxConcentrationPct}% of ${usd(fundSizeUsd)}`} />
    </div>
  );
}

export function AllocationRanking({ r, slugs }: { r: PortfolioReport; slugs: Slugs }) {
  const a = r.allocation;
  return (
    <div className="space-y-4">
      <div className="rounded-md bg-surface-2 px-3 py-2 text-[12px] leading-relaxed text-ink-2">
        <span className="font-medium text-ink">Formula · </span>
        {a.formula}
      </div>
      {a.ranking.length ? (
        <Table minWidth={760}>
          <thead>
            <tr>
              <th className={th}>#</th>
              <th className={th}>Company</th>
              <th className={cx(th, "text-right")}>Bull proceeds / $</th>
              <th className={th}>Evidence × factor</th>
              <th className={cx(th, "text-right")}>Capacity per {usd(a.unitUsd)}</th>
              <th className={cx(th, "text-right")}>Power-law</th>
              <th className={cx(th, "text-right")}>Concentration after</th>
            </tr>
          </thead>
          <tbody>
            {a.ranking.map((x) => (
              <tr key={x.companyId}>
                <td className={cx(td, "num text-ink-3")}>{x.rank}</td>
                <td className={cx(td, "max-w-[240px]")}>
                  <Co id={x.companyId} name={x.name} slugs={slugs} />
                  <div className="num text-[12px] font-medium text-ink sm:hidden">
                    {usd(x.capacityPerUnitUsd)} capacity{x.concentrationBreach ? " · breaches concentration" : ""}
                  </div>
                  <div className="text-[11px] text-ink-3">{x.explanation}</div>
                </td>
                <td className={tdr}>
                  {multiple(x.bullProceedsPerDollar, 2)}
                  <div className="text-[10.5px] text-ink-3">{titleCase(x.source)}</div>
                </td>
                <td className={td}>
                  <Badge tone={evidenceTone(x.evidenceCategory)}>{titleCase(x.evidenceCategory)}</Badge> <span className="num text-ink-2">× {x.evidenceFactor}</span>
                </td>
                <td className={cx(tdr, "font-medium")}>{usd(x.capacityPerUnitUsd)}</td>
                <td className={tdr}>{x.powerLawIndex !== null ? Math.round(x.powerLawIndex) : "—"}</td>
                <td className={cx(tdr, x.concentrationBreach && "text-risk")}>
                  {pct(x.concentrationAfterPct, 1)}
                  {x.concentrationBreach && <div className="text-[10.5px]">breaches limit</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : (
        <p className="text-[13px] text-ink-3">No deal is eligible for the next allocation.</p>
      )}
      <div className="grid gap-8 md:grid-cols-[260px_1fr] [&>*]:min-w-0">
        <div>
          <SubHead>Evidence factors</SubHead>
          <table className="w-full text-[12.5px]">
            <tbody>
              {Object.entries(a.evidenceFactors).map(([k, v]) => (
                <tr key={k} className="border-t border-line">
                  <td className="py-1">
                    <Badge tone={evidenceTone(k)}>{titleCase(k)}</Badge>
                  </td>
                  <td className="num py-1 text-right text-ink">× {v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Rule className="mt-1">Conventional haircuts by evidence category — not probabilities.</Rule>
        </div>
        <div>
          <SubHead aside={`${a.excluded.length} deals`}>Excluded from the ranking</SubHead>
          {a.excluded.length ? (
            <ul className="grid gap-x-6 text-[12.5px] sm:grid-cols-2">
              {a.excluded.map((e) => (
                <li key={e.companyId} className="min-w-0 border-t border-line py-1">
                  <Co id={e.companyId} name={e.name} slugs={slugs} />
                  <div className="text-[11.5px] text-ink-3">{e.reason.replace(/Recommendation ([A-Z_]+)/, (_, x: string) => `Recommendation: ${titleCase(x)}`)}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">None.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Buckets({ title, rows, limit, label = titleCase }: { title: string; rows: ExposureBucket[]; limit: number; label?: (k: string) => string }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11.5px] font-medium text-ink-3">{title}</div>
      {rows.length ? (
        <ul className="space-y-1">
          {rows.map((b) => (
            <li key={b.key} className="text-[12px]">
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-ink-2" title={b.key}>
                  {label(b.key)} <span className="text-ink-3">· {b.count}</span>
                </span>
                <span className={cx("num shrink-0", b.overLimit ? "font-medium text-risk" : "text-ink")}>{pct(b.pctOfViewCapital, 0)}</span>
              </div>
              <div className="relative mt-0.5 h-1.5 rounded-full bg-surface-3" aria-hidden>
                <div className={cx("absolute inset-y-0 left-0 rounded-full", b.overLimit ? "bg-risk" : "bg-ink-3")} style={{ width: `${Math.min(100, b.pctOfViewCapital)}%` }} />
                <div className="absolute -top-0.5 h-2.5 w-px bg-warn" style={{ left: `${limit}%` }} title={`${limit}% policy limit`} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-3">No deals.</p>
      )}
    </div>
  );
}

function ExposureCol({ v, limit }: { v: ExposureView; limit: number }) {
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold text-ink">{v.view === "COMMITTED" ? "Committed" : "Committed + admissible pipeline"}</h3>
          <span className="num text-[12px] text-ink-3">
            {v.deals} deals · {usd(v.capitalUsd)} · {pct(v.pctOfFund, 1)} of fund
          </span>
        </div>
        <Rule>{v.description}</Rule>
      </div>
      <div className="grid gap-5 sm:grid-cols-3">
        <Buckets title="Sector" rows={v.sector} limit={limit} />
        <Buckets title="Stage" rows={v.stage} limit={limit} label={(k) => STAGE_LABEL[k] ?? k} />
        <Buckets title="Geography" rows={v.geography} limit={limit} label={(k) => k} />
      </div>
    </div>
  );
}

export function ExposureViews({ r }: { r: PortfolioReport }) {
  const limit = r.exposure.bucketLimitPct;
  return (
    <div className="space-y-3">
      <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
        <ExposureCol v={r.exposure.committed} limit={limit} />
        <ExposureCol v={r.exposure.pipeline} limit={limit} />
      </div>
      <Rule>Share of each view&apos;s capital (default check + reserves). The amber tick marks the {limit}% bucket limit (INTERNAL_POLICY); buckets above it are flagged in red.</Rule>
    </div>
  );
}

export function CorrelatedRisks({ r, slugs }: { r: PortfolioReport; slugs: Slugs }) {
  if (!r.correlatedRisks.length) return <p className="text-[13px] text-ink-3">No risk driver is shared by two or more deals.</p>;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {r.correlatedRisks.map((c) => (
        <li key={c.driver.key} className="grid gap-x-6 gap-y-1 py-2 text-[12.5px] md:grid-cols-[220px_1fr_120px]">
          <div>
            <Badge tone={c.driver.kind === "REGULATORY" ? "warn" : c.driver.kind === "PLATFORM" ? "accent" : "neutral"}>{titleCase(c.driver.kind)}</Badge> <span className="font-medium text-ink">{c.driver.label}</span>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-x-2 gap-y-0.5">
              {c.companies.map((x, i) => (
                <span key={x.companyId}>
                  <Co id={x.companyId} name={x.name} slugs={slugs} />
                  {i < c.companies.length - 1 ? "," : ""}
                </span>
              ))}
            </div>
            {c.sharedRiskCategories.length > 0 && <div className="text-[11.5px] text-ink-3">Common risk categories: {c.sharedRiskCategories.map((x) => enumLabel(x)).join(", ")}</div>}
          </div>
          <div className="num text-right text-ink-2 md:text-right">{usd(c.capitalUsd)} exposed</div>
        </li>
      ))}
    </ul>
  );
}

export function Redundancy({ r, slugs }: { r: PortfolioReport; slugs: Slugs }) {
  if (!r.redundancy.length) return <p className="text-[13px] text-ink-3">No redundant or overlapping deals.</p>;
  return (
    <Table minWidth={680}>
      <thead>
        <tr>
          <th className={th}>Pair</th>
          <th className={cx(th, "text-right")}>Score</th>
          <th className={cx(th, "text-right")}>Classification</th>
          <th className={cx(th, "text-right")}>Competitors</th>
          <th className={cx(th, "text-right")}>Segments</th>
          <th className={th}>Shared</th>
        </tr>
      </thead>
      <tbody>
        {r.redundancy.slice(0, 25).map((p) => (
          <tr key={`${p.a.companyId}-${p.b.companyId}`}>
            <td className={cx(td, "max-w-[260px]")}>
              <Co id={p.a.companyId} name={p.a.name} slugs={slugs} /> <span className="text-ink-3">↔</span> <Co id={p.b.companyId} name={p.b.name} slugs={slugs} />
              <div>
                <Badge tone={p.level === "REDUNDANT" ? "risk" : "warn"}>{titleCase(p.level)}</Badge>
              </div>
            </td>
            <td className={cx(tdr, "font-medium")}>{p.score.toFixed(2)}</td>
            <td className={tdr}>{p.components.classification.toFixed(2)}</td>
            <td className={tdr}>{p.components.competitors !== null ? p.components.competitors.toFixed(2) : <span className="text-unknown">no data</span>}</td>
            <td className={tdr}>{p.components.segments !== null ? p.components.segments.toFixed(2) : <span className="text-unknown">no data</span>}</td>
            <td className={cx(td, "text-[11.5px] text-ink-3")}>{[...p.shared.competitors, ...p.shared.segments, ...p.shared.classification.map((x) => titleCase(x.split(":")[1] ?? x))].slice(0, 6).join(", ")}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function Check({ ok }: { ok: boolean }) {
  return <span className={cx("font-semibold", ok ? "text-ok" : "text-ink-3")}>{ok ? "✓" : "✕"}</span>;
}

export function AsymmetricScreen({ r, slugs }: { r: PortfolioReport; slugs: Slugs }) {
  const rows = r.asymmetricUpside;
  if (!rows.length) return <p className="text-[13px] text-ink-3">No deals.</p>;
  const pass = rows.filter((x) => x.qualifies).length;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-ink-2">{pass ? `${pass} deal${pass === 1 ? "" : "s"} pass all three checks.` : "No deal passes all three checks."}</p>
      <Table minWidth={760}>
        <thead>
          <tr>
            <th className={th}>Company</th>
            <th className={cx(th, "text-right")}>Outlier MOIC</th>
            <th className={cx(th, "text-right")}>Entry vs 20× ceiling</th>
            <th className={cx(th, "text-right")}>Power-law × evidence</th>
            <th className={th}>Checks</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.companyId} className={cx(x.qualifies && "bg-ok-soft/40")}>
              <td className={cx(td, "max-w-[240px]")}>
                <Co id={x.companyId} name={x.name} slugs={slugs} />
                {x.qualifies && (
                  <Badge tone="ok" className="ml-1.5">
                    Passes
                  </Badge>
                )}
              </td>
              <td className={tdr}>
                {x.outlierMoic !== null ? multiple(x.outlierMoic, 1) : <span className="text-unknown">n/a</span>}
                <div className="text-[10.5px] text-ink-3">{titleCase(x.outlierMoicSource)}</div>
              </td>
              <td className={tdr}>
                {usd(x.entryPostMoneyUsd)} / {usd(x.maxPostFor20xUsd)}
                {x.priceHeadroomPct !== null && <div className={cx("text-[10.5px]", x.priceHeadroomPct >= 0 ? "text-ok" : "text-risk")}>{x.priceHeadroomPct >= 0 ? `${x.priceHeadroomPct.toFixed(0)}% headroom` : `${Math.abs(x.priceHeadroomPct).toFixed(0)}% above ceiling`}</div>}
              </td>
              <td className={tdr}>
                {x.powerLawIndex !== null ? Math.round(x.powerLawIndex) : "—"} × {x.evidenceFactor} = <b className="font-medium">{x.adjustedPowerLaw !== null ? Math.round(x.adjustedPowerLaw) : "—"}</b>
              </td>
              <td className={cx(td, "whitespace-nowrap text-[11.5px] text-ink-3")}>
                <Check ok={x.checks.outlierMoic} /> MOIC <Check ok={x.checks.price} /> price <Check ok={x.checks.powerLaw} /> power-law
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
