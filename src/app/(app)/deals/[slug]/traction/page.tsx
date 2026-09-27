import Link from "next/link";
import { Fragment } from "react";
import type { MetricInstance } from "@/domain/canonical";
import { metricDef, type MetricFamily } from "@/engine/metrics/dictionary";
import { loadDeal } from "@/server/deal";
import { Badge, Callout, Section, Td, Th, cx } from "@/components/ui";
import { metricValue, titleCase, type Tone } from "@/lib/format";
import { CORE_METRIC_ORDER, MetricCell, metricEvidence } from "@/components/deal/metric";
import { SeriesChart } from "@/components/deal/tabs/chart";
import { DimensionDetail, FlagList, Layers, Prose, Quiet, TabMain, TableFrame, enumLabel, flagText, instancesOf, periodText } from "@/components/deal/tabs/shared";

const TRACTION_FAMILIES: MetricFamily[] = ["REVENUE", "MARKETPLACE", "CONSUMER", "FINTECH", "HARDWARE", "RETENTION", "CUSTOMERS", "DEEPTECH"];

const FAMILY_LABEL: Record<string, string> = {
  REVENUE: "Revenue & growth",
  RETENTION: "Retention",
  CUSTOMERS: "Customers & adoption",
  CONSUMER: "Consumer engagement",
  MARKETPLACE: "Marketplace liquidity",
  FINTECH: "Financial volume & credit",
  HARDWARE: "Hardware delivery",
  DEEPTECH: "Milestones",
};

/** The product type decides which family leads — traction means different things for different businesses. */
const LEAD_FAMILY: Record<string, MetricFamily> = {
  MARKETPLACE: "MARKETPLACE",
  CONSUMER_APP: "CONSUMER",
  FINTECH_PRODUCT: "FINTECH",
  HARDWARE: "HARDWARE",
  ROBOTICS: "HARDWARE",
  MEDICAL_DEVICE: "HARDWARE",
  THERAPEUTIC: "DEEPTECH",
  DIAGNOSTIC: "DEEPTECH",
};

/** Metrics that say the same thing — only the first of each group is a headline. */
const HEADLINE_GROUPS: string[][] = [
  ["arr", "revenue_ttm", "mrr"],
  ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"],
  ["nrr", "grr"],
];

function monthsBetween(a: string, b: string): number | null {
  const pa = a.match(/^(\d{4})-(\d{2})/);
  const pb = b.match(/^(\d{4})-(\d{2})/);
  if (!pa || !pb) return null;
  return (Number(pb[1]) - Number(pa[1])) * 12 + (Number(pb[2]) - Number(pa[2]));
}

const DIRECTION: Record<string, { text: string; tone: Tone; order: number }> = {
  SUPPORTS: { text: "Supports", tone: "ok", order: 0 },
  UNDERMINES: { text: "Undermines", tone: "risk", order: 1 },
  NEUTRAL: { text: "Neutral", tone: "neutral", order: 2 },
  UNKNOWN: { text: "Unknown", tone: "unknown", order: 3 },
};

export default async function TractionTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const pmf = c.pmf;

  const lead = c.classification.productType.map((t) => LEAD_FAMILY[t]).find(Boolean);
  const families = lead ? [lead, ...TRACTION_FAMILIES.filter((f) => f !== lead)] : TRACTION_FAMILIES;
  const familyOf = (m: MetricInstance) => metricDef(m.metricKey)?.family;
  const grouped = families
    .map((f) => ({
      family: f,
      metrics: c.metrics
        .filter((m) => familyOf(m) === f)
        .sort((a, b) => a.metricKey.localeCompare(b.metricKey) || Number(b.isPrimary) - Number(a.isPrimary) || (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")),
    }))
    .filter((g) => g.metrics.length > 0);
  const rank = (k: string) => {
    const i = CORE_METRIC_ORDER.indexOf(k);
    return i < 0 ? 99 : i;
  };
  const usedGroups = new Set<number>();
  const headline = grouped
    .flatMap((g) => g.metrics.filter((m) => m.isPrimary && m.normalizedValue !== null).sort((a, b) => rank(a.metricKey) - rank(b.metricKey)))
    .filter((m) => {
      const g = HEADLINE_GROUPS.findIndex((grp) => grp.includes(m.metricKey));
      if (g < 0) return true;
      if (usedGroups.has(g)) return false;
      usedGroups.add(g);
      return true;
    })
    .slice(0, 5);

  // Time series: any traction metric with ≥2 dated observations at distinct periods.
  const keys = [...new Set(grouped.flatMap((g) => g.metrics.map((m) => m.metricKey)))];
  const series = keys
    .map((k) => {
      const pts = instancesOf(c.metrics, k).filter((m) => m.periodEnd && m.normalizedValue !== null && m.calculationMethod !== "DERIVED");
      const byPeriod = new Map<string, MetricInstance>();
      for (const m of pts) if (!byPeriod.has(m.periodEnd!) || m.isPrimary) byPeriod.set(m.periodEnd!, m);
      return { key: k, pts: [...byPeriod.values()].sort((a, b) => a.periodEnd!.localeCompare(b.periodEnd!)) };
    })
    .filter((s) => s.pts.length >= 2);

  const signals = pmf ? [...pmf.signals].sort((a, b) => (DIRECTION[a.direction]?.order ?? 9) - (DIRECTION[b.direction]?.order ?? 9)) : [];
  const count = (dir: string) => signals.filter((s) => s.direction === dir).length;

  return (
    <TabMain>
      {/* Small-sample warnings — prominent */}
      {d.smallSampleWarnings.length > 0 && (
        <Callout tone="warn" title={`${d.smallSampleWarnings.length} metric${d.smallSampleWarnings.length === 1 ? "" : "s"} rest on a small or undisclosed sample`}>
          <ul className="mt-1 space-y-1 text-[12.5px]">
            {d.smallSampleWarnings.map((w) => (
              <li key={w.metricId} className="grid grid-cols-[210px_1fr] gap-3">
                <Link href={`/deals/${slug}/evidence?metric=${w.metricId}`} className="font-medium text-ink hover:text-accent-text">
                  {w.label} <span className="font-mono text-[10.5px] text-ink-3">{w.metricId}</span>
                </Link>
                <span>{flagText(w.detail).text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">These values receive reduced coverage credit in scoring. Read them as directional until the underlying counts are confirmed.</p>
        </Callout>
      )}

      {/* Headline metrics */}
      <Section
        eyebrow="Traction"
        title={lead ? `${FAMILY_LABEL[lead]} first — the metrics that matter for a ${titleCase(c.classification.productType[0])} business` : "Business-specific traction metrics"}
        action={
          <Link href={`/deals/${slug}/evidence`} className="text-[12.5px] text-ink-3 hover:text-ink">
            All metrics and claims →
          </Link>
        }
      >
        {headline.length ? (
          <div className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
            {headline.map((m) => (
              <MetricCell key={m.id} m={m} slug={company.slug} />
            ))}
          </div>
        ) : (
          <Quiet>No traction metrics were disclosed.</Quiet>
        )}
      </Section>

      {/* Time series */}
      {series.length > 0 && (
        <Section eyebrow="Over time" title="Metrics with more than one dated observation">
          <div className="space-y-10">
            {series.map((s) => {
              const def = metricDef(s.key);
              const a = s.pts[0]!;
              const b = s.pts[s.pts.length - 1]!;
              const first = a.normalizedValue!;
              const last = b.normalizedValue!;
              const months = monthsBetween(a.periodEnd!, b.periodEnd!);
              const isPct = a.unit === "PERCENT";
              const change = first !== 0 && !isPct ? (last / first - 1) * 100 : null;
              const monthly = change !== null && months && months > 0 && first > 0 && last > 0 ? (Math.pow(last / first, 1 / months) - 1) * 100 : null;
              const derived = c.metrics.filter((m) => m.calculationMethod === "DERIVED" && m.derivation && m.derivation.toLowerCase().includes((def?.shortName ?? s.key).toLowerCase()));
              return (
                <div key={s.key} className="grid items-start gap-10 md:grid-cols-[1.3fr_1fr]">
                  <SeriesChart
                    title={def?.name ?? s.key}
                    points={s.pts.map((m) => ({
                      period: m.periodEnd!,
                      value: m.normalizedValue!,
                      display: metricValue(m.unit, m.normalizedValue),
                      raw: m.rawValue,
                      n: m.sampleSize,
                      weak: m.state === "INFERRED" || m.state === "CONTRADICTED" || m.verification === "CONTRADICTED",
                    }))}
                  />
                  <div className="space-y-4 pt-6">
                    <div>
                      <div className="t-eyebrow mb-1.5">Change over the window</div>
                      <dl className="divide-y divide-line border-y border-line text-[13px]">
                        <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                          <dt className="text-ink-3">From → to</dt>
                          <dd className="num text-ink">
                            {metricValue(a.unit, first)} → {metricValue(b.unit, last)}
                          </dd>
                        </div>
                        <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                          <dt className="text-ink-3">Elapsed</dt>
                          <dd className="num text-ink">{months !== null ? `${months} months (${a.periodEnd} → ${b.periodEnd})` : "Periods not comparable"}</dd>
                        </div>
                        <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                          <dt className="text-ink-3">{isPct ? "Change" : "Growth"}</dt>
                          <dd className="num text-ink">
                            {isPct ? `${(last - first >= 0 ? "+" : "−") + Math.abs(last - first).toFixed(1)} pts` : change !== null ? `${change >= 0 ? "+" : "−"}${Math.abs(change).toFixed(0)}%` : "—"}
                          </dd>
                        </div>
                        {monthly !== null && (
                          <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                            <dt className="text-ink-3">Implied monthly rate</dt>
                            <dd className="num text-ink">{monthly.toFixed(1)}% compounded</dd>
                          </div>
                        )}
                        <div className="grid grid-cols-[150px_1fr] gap-3 py-1.5">
                          <dt className="text-ink-3">Observations</dt>
                          <dd className="text-ink-2">
                            {s.pts.map((m, i) => (
                              <span key={m.id}>
                                {i > 0 && ", "}
                                <Link href={`/deals/${slug}/evidence?metric=${m.id}`} className="font-mono text-[11px] hover:text-accent-text">
                                  {m.id}
                                </Link>
                              </span>
                            ))}
                          </dd>
                        </div>
                      </dl>
                    </div>
                    {derived.length > 0 && (
                      <p className="text-[12px] text-ink-3">
                        Used by code to derive:{" "}
                        {derived.map((m, i) => (
                          <span key={m.id}>
                            {i > 0 && ", "}
                            <Link href={`/deals/${slug}/evidence?metric=${m.id}`} className="text-ink-2 hover:text-accent-text">
                              {metricDef(m.metricKey)?.shortName ?? m.label}
                            </Link>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] text-ink-3">Reported observations only; derived values are excluded from charts. Two points show a change, not a trend.</p>
        </Section>
      )}

      {/* All traction metrics */}
      <Section eyebrow="Measured" title="Every traction metric, with raw value, period and sample">
        {grouped.length ? (
          <TableFrame minWidth={1000}>
            <thead>
              <tr>
                <Th className="w-[190px]">Metric</Th>
                <Th className="w-[100px]" align="right">
                  Value
                </Th>
                <Th className="w-[170px]">Raw as disclosed</Th>
                <Th className="w-[140px]">Period</Th>
                <Th className="w-[60px]" align="right">
                  n
                </Th>
                <Th className="w-[140px]">Evidence</Th>
                <Th>Quality flags</Th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((g) => (
                <Fragment key={g.family}>
                  <tr>
                    <td colSpan={7} className="border-t border-line bg-surface-2/60 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                      {FAMILY_LABEL[g.family] ?? titleCase(g.family)}
                    </td>
                  </tr>
                  {g.metrics.map((m) => {
                    const def = metricDef(m.metricKey);
                    const ev = metricEvidence(m);
                    const small = m.qualityFlags.some((f) => f.startsWith("SMALL_SAMPLE") || f.startsWith("SAMPLE_SIZE_UNKNOWN"));
                    return (
                      <tr key={m.id} className={cx(!m.isPrimary && "text-ink-3")}>
                        <Td>
                          <Link href={`/deals/${slug}/evidence?metric=${m.id}`} className={cx("hover:text-accent-text", m.isPrimary ? "text-ink" : "text-ink-3")}>
                            {def?.shortName ?? m.label}
                          </Link>
                          <div className="font-mono text-[10.5px] text-ink-3">
                            {m.id}
                            {!m.isPrimary && " · earlier / secondary"}
                          </div>
                        </Td>
                        <Td align="right" className={cx("font-medium", m.isPrimary ? "text-ink" : "text-ink-3")}>
                          {metricValue(m.unit, m.normalizedValue)}
                        </Td>
                        <Td className="text-[12px] text-ink-2">{m.calculationMethod === "DERIVED" ? <span className="text-ink-3">Computed — see method</span> : `“${m.rawValue}”`}</Td>
                        <Td className="num text-[12px] text-ink-2">
                          {periodText(m)}
                          {m.periodType && m.periodType !== "POINT_IN_TIME" && <div className="text-[11px] text-ink-3">{enumLabel(m.periodType)}</div>}
                        </Td>
                        <Td align="right" className={cx("text-[12px]", small ? "text-warn" : "text-ink-2")}>
                          {m.sampleSize ?? "—"}
                        </Td>
                        <Td>
                          <Badge tone={ev.tone}>{ev.text}</Badge>
                          {m.calculationMethod === "DERIVED" && m.derivation && <div className="mt-1 font-mono text-[10.5px] text-ink-3">{m.derivation}</div>}
                        </Td>
                        <Td>{m.qualityFlags.length ? <FlagList flags={m.qualityFlags} /> : <span className="text-[12px] text-ink-3">None</span>}</Td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </TableFrame>
        ) : (
          <Quiet>No traction metrics were disclosed.</Quiet>
        )}
      </Section>

      {/* PMF */}
      <Section eyebrow="Product-market fit" title={pmf ? "Signals for and against, with evidence" : "PMF not yet analyzed"}>
        {pmf ? (
          <div className="space-y-6">
            <Layers
              fact={
                <span className="num">
                  {signals.length} signals examined: {count("SUPPORTS")} support, {count("UNDERMINES")} undermine, {count("NEUTRAL")} neutral, {count("UNKNOWN")} unknown.
                </span>
              }
              interpretation={<Prose text={pmf.assessment} slug={slug} />}
            />
            {signals.length ? (
              <TableFrame minWidth={760}>
                <thead>
                  <tr>
                    <Th className="w-[210px]">Signal</Th>
                    <Th className="w-[130px]">Direction</Th>
                    <Th>Evidence</Th>
                  </tr>
                </thead>
                <tbody>
                  {signals.map((s, i) => {
                    const dir = DIRECTION[s.direction] ?? { text: titleCase(s.direction), tone: "unknown" as Tone };
                    return (
                      <tr key={i}>
                        <Td className={s.direction === "UNKNOWN" ? "text-ink-2" : "text-ink"}>{titleCase(s.signal)}</Td>
                        <Td>
                          <Badge tone={dir.tone} dot={s.direction !== "UNKNOWN"}>
                            {dir.text}
                          </Badge>
                        </Td>
                        <Td className="text-[12.5px] text-ink-2">
                          <Prose text={s.evidence} slug={slug} />
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableFrame>
            ) : (
              <Quiet>No PMF signals were assessed.</Quiet>
            )}
            <div className="grid gap-6 md:grid-cols-[180px_1fr]">
              <div className="t-eyebrow pt-0.5">Older-cohort evidence</div>
              <p className="text-ink-2">{pmf.olderCohortEvidence ? <Prose text={pmf.olderCohortEvidence} slug={slug} /> : <span className="text-ink-3">No evidence from customers older than 12 months.</span>}</p>
            </div>
          </div>
        ) : (
          <Quiet>The PMF section was not produced in this analysis.</Quiet>
        )}
      </Section>

      <Section eyebrow="Operating quality" title="Traction / PMF dimension">
        <DimensionDetail d={d} id="TRACTION_PMF" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
