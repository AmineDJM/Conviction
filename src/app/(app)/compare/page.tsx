import Link from "next/link";
import { requireSession } from "@/server/session";
import { getCurrentVersion, listCompanies } from "@/server/repo";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Callout, Empty, IndexBar } from "@/components/ui";
import { CompanyPicker } from "@/components/compare/company-picker";
import { DECISION_LABEL, decisionTone, evidenceTone, levelTone, metricValue, multiple, titleCase, usd } from "@/lib/format";
import { metricDef } from "@/engine/metrics/dictionary";
import type { ReactNode } from "react";

export const metadata = { title: "Compare" };

const KEY_METRICS = ["arr", "revenue_ttm", "gmv", "arr_growth_yoy", "revenue_growth_yoy", "mom_growth", "nrr", "gross_margin", "cac_payback_months", "burn_multiple", "runway_months", "paying_customers"];

export default async function ComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const s = await requireSession();
  const { ids } = await searchParams;
  const all = listCompanies(s.workspaceId).filter((c) => c.currentVersionId);
  const selectedSlugs = (ids ?? "").split(",").filter(Boolean).slice(0, 10);
  const selected = selectedSlugs.map((slug) => all.find((c) => c.slug === slug)).filter((c): c is NonNullable<typeof c> => !!c);
  const rows = selected.map((c) => ({ c, v: getCurrentVersion(c)! }));
  const peerGroups = new Set(rows.map((r) => r.v.derived.peerGroup.id));
  const registries = new Set(rows.map((r) => r.v.derived.registryId));

  const Row = ({ label, children, hint }: { label: string; hint?: string; children: (r: (typeof rows)[number]) => ReactNode }) => (
    <tr className="border-t border-line align-top">
      <th className="sticky left-0 z-10 w-[190px] bg-bg py-2.5 pr-4 text-left text-[12.5px] font-normal text-ink-3">
        {label}
        {hint && <div className="text-[11px]">{hint}</div>}
      </th>
      {rows.map((r) => (
        <td key={r.c.id} className="min-w-[220px] py-2.5 pr-6 text-[13px]">
          {children(r)}
        </td>
      ))}
    </tr>
  );
  const Group = ({ title }: { title: string }) => (
    <tr>
      <td colSpan={rows.length + 1} className="t-eyebrow pb-1 pt-6">
        {title}
      </td>
    </tr>
  );

  return (
    <main className="pb-16">
      <PageHeader title="Compare" meta="Comparable dimensions only. Operating indices are relative to each company's peer group; fund economics are the common denominator." />
      <div className="space-y-6 px-8">
        <CompanyPicker companies={all.map((c) => ({ slug: c.slug, name: c.name }))} selected={selectedSlugs} />
        {rows.length < 2 ? (
          <Empty title="Select 2 to 10 companies">Pick companies above to compare quality, evidence, exceptional strength, power-law potential, return cases, risk and key metrics.</Empty>
        ) : (
          <>
            {peerGroups.size > 1 && (
              <Callout tone="warn" title="Different peer groups">
                Operating Quality indices below come from different peer groups ({[...new Set(rows.map((r) => r.v.derived.peerGroup.name))].join(" vs ")}). An 82 in one group is not economically equivalent to an 82 in another — compare fund economics (returns, ownership, backwards analysis) across groups instead.
              </Callout>
            )}
            {registries.size > 1 && (
              <Callout tone="warn" title="Different benchmark versions">
                Some companies were scored under different registry versions. Recalculate the portfolio for a like-for-like comparison.
              </Callout>
            )}
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-bg" />
                    {rows.map((r) => (
                      <th key={r.c.id} className="pb-2 pr-6 text-left align-bottom">
                        <Link href={`/deals/${r.c.slug}`} className="t-section hover:text-accent-text">
                          {r.c.name}
                        </Link>
                        <div className="text-[12px] font-normal text-ink-3">{r.v.derived.peerGroup.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Group title="Decision" />
                  <Row label="Current view">
                    {(r) => (
                      <Badge tone={decisionTone(r.v.derived.recommendation.status)} dot>
                        {DECISION_LABEL[r.v.derived.recommendation.status]}
                      </Badge>
                    )}
                  </Row>
                  <Row label="Analysis">{(r) => `${titleCase(r.v.canonical.analysis.mode)} · ${titleCase(r.v.canonical.analysis.depth)}`}</Row>

                  <Group title="Quality (peer-relative)" />
                  <Row label="Operating quality" hint="value · bounds · coverage">
                    {(r) => {
                      const o = r.v.derived.operatingQuality;
                      return (
                        <div className="flex items-center gap-2.5">
                          <span className="num w-7 font-semibold">{o.value !== null ? Math.round(o.value) : "—"}</span>
                          <IndexBar value={o.value} lower={o.lower} upper={o.upper} width={80} />
                          <span className="num text-[11.5px] text-ink-3">{Math.round(o.coverage * 100)}%</span>
                        </div>
                      );
                    }}
                  </Row>
                  {rows[0]!.v.derived.dimensions.map((d) => (
                    <Row key={d.id} label={d.name}>
                      {(r) => {
                        const x = r.v.derived.dimensions.find((y) => y.id === d.id)!;
                        return (
                          <span className="num">
                            {x.value !== null ? Math.round(x.value) : "—"} <span className="text-[11.5px] text-ink-3">({Math.round(x.coverage * 100)}%)</span>
                          </span>
                        );
                      }}
                    </Row>
                  ))}
                  <Row label="Evidence">{(r) => <Badge tone={evidenceTone(r.v.derived.evidence.category)}>{titleCase(r.v.derived.evidence.category)}</Badge>}</Row>

                  <Group title="Exceptionality" />
                  <Row label="Exceptional strength">{(r) => <span className="line-clamp-4 text-ink-2">{r.v.canonical.exceptionalStrengths[0]?.claim ?? "None identified"}</span>}</Row>
                  <Row label="Power-law potential" hint="anchored index">{(r) => <span className="num">{r.v.derived.powerLaw.value !== null ? Math.round(r.v.derived.powerLaw.value) : "—"}</span>}</Row>

                  <Group title="Fund economics (common denominator)" />
                  <Row label="Entry">{(r) => `${usd(r.v.derived.returns.inputs.entry.raiseUsd)} at ${usd(r.v.derived.returns.inputs.entry.postMoneyUsd)} ${r.v.derived.returns.inputs.entry.instrument === "SAFE" ? "cap" : "post"}`}</Row>
                  {(["LOW", "BASE", "BULL", "OUTLIER"] as const).map((sc) => (
                    <Row key={sc} label={`${titleCase(sc)} case`} hint="gross MOIC · exit ownership">
                      {(r) => {
                        const x = r.v.derived.returns.scenarios.find((y) => y.scenario === sc);
                        return x ? (
                          <span className="num">
                            {multiple(x.grossMoic)} <span className="text-[11.5px] text-ink-3">· {x.exitOwnershipPct.toFixed(1)}% · exit {usd(x.exitEquityUsd)}</span>
                          </span>
                        ) : (
                          "—"
                        );
                      }}
                    </Row>
                  ))}
                  <Row label="To return the target" hint="backwards analysis">
                    {(r) => (r.v.derived.backwards ? `${usd(r.v.derived.backwards.requiredExitEquityUsd)} exit · ${titleCase(r.v.derived.backwards.plausibility)}` : "—")}
                  </Row>
                  <Row label="Fund fit">{(r) => `${r.v.derived.fundFit.index ?? "—"} · mandate ${titleCase(r.v.derived.fundFit.mandate)}`}</Row>

                  <Group title="Risk" />
                  <Row label="Headline risk">{(r) => (r.v.derived.risk.headline ? <Badge tone={levelTone(r.v.derived.risk.headline)}>{titleCase(r.v.derived.risk.headline)}</Badge> : "—")}</Row>
                  <Row label="Thesis killers">{(r) => <span className="text-ink-2">{r.v.derived.risk.thesisKillers.map((k) => k.title).join("; ") || "None"}</span>}</Row>
                  <Row label="Financing path">{(r) => titleCase(r.v.derived.financing.risk)}</Row>

                  <Group title="Key metrics (raw, as reported)" />
                  {KEY_METRICS.filter((k) => rows.some((r) => r.v.canonical.metrics.some((m) => m.metricKey === k && m.isPrimary && m.normalizedValue !== null))).map((k) => (
                    <Row key={k} label={metricDef(k)?.shortName ?? k}>
                      {(r) => {
                        const m = r.v.canonical.metrics.find((x) => x.metricKey === k && x.isPrimary);
                        return m && m.normalizedValue !== null ? (
                          <span className="num">
                            {metricValue(m.unit, m.normalizedValue)}
                            <span className="ml-1.5 text-[11px] text-ink-3">{m.verification === "VERIFIED" ? "verified" : m.calculationMethod === "DERIVED" ? "derived" : "reported"}</span>
                          </span>
                        ) : (
                          <span className="text-ink-3">not disclosed</span>
                        );
                      }}
                    </Row>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
