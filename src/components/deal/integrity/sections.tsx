/**
 * Integrity tab sections (server components). Everything here is rendered
 * from the stored `derived.integrity` report (computed by code) and, where
 * labelled "Model", from the model-reported deck forensics kept for comparison.
 */
import Link from "next/link";
import type { CanonicalDeal } from "@/domain/canonical";
import type { ChronologyRow, IntegrityReport, ImpliedMetric } from "@/engine/integrity";
import { Badge, cx } from "@/components/ui";
import { metricValue, multiple, pct, titleCase, usd, type Tone } from "@/lib/format";
import { RichText } from "@/components/deal/rich-text";
import { LevelBadge, Origin, Pages, Refs, Rule, Sev, Stat, SubHead, Table, Unknown } from "@/components/deal/v2/kit";
import { FreshnessBadge } from "@/components/deal/freshness";

export function impliedValue(unit: ImpliedMetric["unit"], v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  switch (unit) {
    case "USD":
      return usd(v, Math.abs(v) >= 1e6 ? 2 : 1);
    case "PERCENT":
      return pct(v, Math.abs(v) < 10 ? 1 : 0);
    case "MONTHS":
      return `${v.toFixed(v < 10 ? 1 : 0)} mo`;
    case "MULTIPLE":
    case "RATIO":
      return multiple(v, 2);
    default:
      return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
  }
}

const th = "px-2 py-1.5 text-left text-[11px] font-medium text-ink-3 first:pl-0";
const td = "border-t border-line px-2 py-2 align-top first:pl-0";

/* ---------------------------------------------------------------- */

export function IntegritySummaryStrip({ r }: { r: IntegrityReport }) {
  const s = r.summary;
  return (
    <div className="space-y-3">
      <p className="text-[15px] font-medium leading-snug text-ink">{s.headline}</p>
      <div className="grid grid-cols-3 gap-x-6 gap-y-3 sm:grid-cols-6">
        <Stat k="Critical" v={s.critical} tone={s.critical ? "risk" : undefined} />
        <Stat k="High" v={s.high} tone={s.high ? "risk" : undefined} />
        <Stat k="Moderate" v={s.moderate} tone={s.moderate ? "warn" : undefined} />
        <Stat k="Contradictions" v={s.contradictionCount} tone={s.contradictionCount ? "warn" : undefined} />
        <Stat k="Implied ≠ stated" v={s.inconsistentImpliedCount} tone={s.inconsistentImpliedCount ? "warn" : undefined} />
        <Stat k="Expected evidence missing" v={s.missingExpectedCount} tone={s.missingExpectedCount ? "warn" : undefined} />
      </div>
      <Rule>
        Integrity engine v{r.version} · expected-evidence {r.expectedEvidenceVersion} · peer group {titleCase(r.peerGroup.profile)} · {titleCase(r.peerGroup.stageBand)} · reference date {r.asOf ? r.asOf.slice(0, 10) : "unknown (no dated evidence)"} — taken from the deal, never the wall clock.
      </Rule>
      {r.diagnostics.length > 0 && (
        <p className="text-[12px] text-warn">
          {r.diagnostics.length} module{r.diagnostics.length === 1 ? "" : "s"} could not run on this input and returned empty results: {r.diagnostics.join("; ")}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

export function FindingsList({ r, slug, docId }: { r: IntegrityReport; slug: string; docId: string | null }) {
  if (!r.findings.length) return <p className="text-[13px] text-ink-3">No integrity findings. The deterministic rules found nothing to flag on the extracted data — which is only as complete as the extraction.</p>;
  return (
    <ol className="divide-y divide-line border-y border-line">
      {r.findings.map((f, i) => (
        <li key={f.id} id={f.id} className="scroll-mt-32 py-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="num w-6 text-[11px] text-ink-3">{i + 1}</span>
            <Sev s={f.severity} />
            <Origin o={f.origin} />
            <span className="font-mono text-[10.5px] text-ink-3">{f.kind}</span>
            <span className="text-[11px] text-ink-3">· {titleCase(f.module)}</span>
          </div>
          <div className="mt-1 pl-8">
            <div className="text-[13.5px] font-medium text-ink">{f.title}</div>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
              <RichText text={f.detail} slug={slug} />
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Refs refs={[...f.metricIds, ...f.claimIds, ...f.sourceIds]} slug={slug} />
              <Pages pages={f.pages} slug={slug} docId={docId} />
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ---------------------------------------------------------------- */

const VERDICT: Record<string, { text: string; tone: Tone }> = {
  CONSISTENT: { text: "Consistent", tone: "ok" },
  INCONSISTENT: { text: "Inconsistent", tone: "risk" },
  UNVERIFIABLE: { text: "Unverifiable", tone: "unknown" },
};

export function ImpliedTable({ r, slug }: { r: IntegrityReport; slug: string }) {
  if (!r.impliedMetrics.length) return <p className="text-[13px] text-ink-3">No implied metric could be formed from the extracted inputs.</p>;
  const rows = [...r.impliedMetrics].sort((a, b) => (a.verdict === "INCONSISTENT" ? 0 : a.verdict === "UNVERIFIABLE" ? 2 : 1) - (b.verdict === "INCONSISTENT" ? 0 : b.verdict === "UNVERIFIABLE" ? 2 : 1));
  return (
    <Table minWidth={760}>
      <thead>
        <tr>
          <th className={th}>Implied metric · formula</th>
          <th className={cx(th, "text-right")}>Stated</th>
          <th className={cx(th, "text-right")}>Implied</th>
          <th className={cx(th, "text-right")}>Δ</th>
          <th className={th}>Verdict</th>
          <th className={th}>Inputs</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m) => {
          const v = VERDICT[m.verdict]!;
          return (
            <tr key={m.id}>
              <td className={cx(td, "max-w-[320px]")}>
                <div className="font-medium text-ink">{m.name}</div>
                <div className="mt-0.5 sm:hidden">
                  <Badge tone={v.tone}>{v.text}</Badge>
                  {m.deltaPct !== null && <span className={cx("num ml-1.5 text-[11.5px]", m.verdict === "INCONSISTENT" ? "text-risk" : "text-ink-3")}>Δ {m.deltaPct.toFixed(0)}%</span>}
                </div>
                <div className="font-mono text-[11px] text-ink-3">{m.formula}</div>
                {m.note && <div className="mt-0.5 text-[11.5px] text-ink-3">{m.note}</div>}
              </td>
              <td className={cx(td, "num text-right")}>{m.statedValue !== null ? impliedValue(m.unit, m.statedValue) : <Unknown>not stated</Unknown>}</td>
              <td className={cx(td, "num text-right")}>{m.impliedValue !== null ? impliedValue(m.unit, m.impliedValue) : <Unknown>—</Unknown>}</td>
              <td className={cx(td, "num text-right", m.verdict === "INCONSISTENT" && "text-risk")}>{m.deltaPct !== null ? `${m.deltaPct.toFixed(0)}%` : "—"}</td>
              <td className={td}>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={v.tone}>{v.text}</Badge>
                  {m.severity && m.verdict === "INCONSISTENT" && <Sev s={m.severity} />}
                </div>
              </td>
              <td className={td}>
                <Refs refs={m.inputs.filter((x) => /^(MET|CLM|SRC)-/.test(x))} slug={slug} />
                {m.inputs.filter((x) => !/^(MET|CLM|SRC)-/.test(x)).length > 0 && <div className="font-mono text-[10.5px] text-ink-3">{m.inputs.filter((x) => !/^(MET|CLM|SRC)-/.test(x)).join(", ")}</div>}
                {m.missingInputs.length > 0 && <div className="text-[11px] text-unknown">missing: {m.missingInputs.join(", ")}</div>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

/* ---------------------------------------------------------------- */

export function Inconsistencies({ r, c, slug, docId }: { r: IntegrityReport; c: CanonicalDeal; slug: string; docId: string | null }) {
  const model = c.forensics?.crossSlideInconsistencies ?? [];
  const computedIds = new Set(r.crossSlide.map((x) => x.id));
  const contra = r.contradictions.filter((x) => !computedIds.has(x.id));
  if (!r.crossSlide.length && !contra.length && !model.length) return <p className="text-[13px] text-ink-3">No cross-slide inconsistency or contradiction detected.</p>;
  return (
    <div className="space-y-5">
      {r.crossSlide.length > 0 && (
        <Table minWidth={680}>
          <thead>
            <tr>
              <th className={th}>Topic</th>
              <th className={th}>Values as shown</th>
              <th className={th}>Class</th>
              <th className={cx(th, "text-right")}>Rel. diff.</th>
              <th className={th}>Pages</th>
            </tr>
          </thead>
          <tbody>
            {r.crossSlide.map((x) => (
              <tr key={x.id}>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">{x.topic}</span>
                    <Origin o={x.origin} />
                    {x.severity && <Sev s={x.severity} />}
                  </div>
                  <div className="text-[11.5px] text-ink-3">{x.detail}</div>
                </td>
                <td className={td}>{x.values.join(" vs ")}</td>
                <td className={td}>{titleCase(x.class)}</td>
                <td className={cx(td, "num text-right")}>{x.relativeDifferencePct !== null ? `${x.relativeDifferencePct.toFixed(1)}%` : "—"}</td>
                <td className={td}>
                  <Pages pages={x.pages} slug={slug} docId={docId} />
                  <Refs refs={x.claimIds} slug={slug} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {contra.length > 0 && (
        <div>
          <SubHead aside="ranked by severity">Contradictions</SubHead>
          <ul className="divide-y divide-line border-y border-line">
            {contra.map((x) => (
              <li key={x.id} className="py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Sev s={x.severity} />
                  <Origin o={x.origin} />
                  <Badge tone="neutral">{titleCase(x.class)}</Badge>
                  <span className="font-medium text-ink">{x.title}</span>
                </div>
                <p className="mt-0.5 text-ink-2">
                  <RichText text={x.detail} slug={slug} />
                </p>
                <div className="mt-0.5 flex flex-wrap gap-2">
                  <Refs refs={[...x.claimIds, ...x.metricIds, ...x.sourceIds]} slug={slug} />
                  <Pages pages={x.pages} slug={slug} docId={docId} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {model.length > 0 && (
        <div>
          <SubHead aside="model-reported, kept for comparison with the computed checks">Cross-slide inconsistencies noticed by the model</SubHead>
          <ul className="divide-y divide-line border-y border-line">
            {model.map((x, i) => (
              <li key={i} className="py-2 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Sev s={x.severity} />
                  <Origin o="MODEL" />
                  <span className="font-medium text-ink">{x.topic}</span>
                  <span className="text-ink-2">{x.values.join(" vs ")}</span>
                  <Pages pages={x.pages} slug={slug} docId={docId} />
                </div>
                <p className="mt-0.5 text-ink-3">{x.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const BASIS_TONE: Record<string, Tone> = { ACTUAL: "ok", CURRENT: "ok", LTM: "ok", SIGNED: "accent", BOOKED: "accent", DEPLOYED: "accent", FORECAST: "warn", TARGET: "warn", PIPELINE: "warn" };

function ChronoRows({ rows, slug, docId }: { rows: ChronologyRow[]; slug: string; docId: string | null }) {
  if (!rows.length) return <p className="py-1 text-[12.5px] text-ink-3">None.</p>;
  return (
    <Table minWidth={620}>
      <thead>
        <tr>
          <th className={th}>Metric</th>
          <th className={th}>Basis</th>
          <th className={cx(th, "text-right")}>Value</th>
          <th className={th}>Period</th>
          <th className={th}>As written</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x, i) => (
          <tr key={`${x.metricKey}-${i}`}>
            <td className={td}>
              <span className="text-ink">{x.label}</span>
              {x.flags.length > 0 && <div className="font-mono text-[10.5px] text-warn">{x.flags.join(" · ")}</div>}
            </td>
            <td className={td}>
              <Badge tone={BASIS_TONE[x.basis] ?? "neutral"}>{titleCase(x.basis)}</Badge>
            </td>
            <td className={cx(td, "num text-right")}>{metricValue(x.unit, x.value)}</td>
            <td className={cx(td, "num text-ink-2")}>{x.periodStart && x.periodEnd ? `${x.periodStart} → ${x.periodEnd}` : (x.periodEnd ?? <Unknown>undated</Unknown>)}</td>
            <td className={cx(td, "text-ink-3")}>
              “{x.rawText}” <Pages pages={[x.page]} slug={slug} docId={docId} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export function Chronology({ r, slug, docId }: { r: IntegrityReport; slug: string; docId: string | null }) {
  const ch = r.chronology;
  return (
    <div className="space-y-5">
      <Rule>Only actual, LTM and current figures are scored. Signed, booked and deployed figures are contracted but not yet live; forecasts, targets and pipeline are never current metrics.</Rule>
      <div>
        <SubHead aside="scored">Actual · LTM · current</SubHead>
        <ChronoRows rows={ch.current} slug={slug} docId={docId} />
      </div>
      <div>
        <SubHead aside="contracted, not yet recognized">Signed · booked · deployed</SubHead>
        <ChronoRows rows={ch.contracted} slug={slug} docId={docId} />
      </div>
      <div>
        <SubHead aside="never scored">Forecast · target · pipeline</SubHead>
        <ChronoRows rows={ch.forward} slug={slug} docId={docId} />
      </div>
      {ch.hockeySticks.length > 0 && (
        <div>
          <SubHead>Hockey sticks: forecast growth vs. trailing growth</SubHead>
          <ul className="divide-y divide-line border-y border-line text-[12.5px]">
            {ch.hockeySticks.map((h) => (
              <li key={h.metricKey} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <span className="font-mono text-[11px] text-ink-3">{h.metricKey}</span>
                <span className="num text-ink">forecast CAGR {h.forecastCagrPct.toFixed(0)}%</span>
                <span className="num text-ink-2">vs trailing {h.trailingGrowthPct !== null ? `${h.trailingGrowthPct.toFixed(0)}%` : "unknown"}</span>
                {h.ratio !== null && <span className={cx("num", h.ratio > 2 ? "text-risk" : "text-ink-3")}>× {h.ratio.toFixed(1)}</span>}
                <Pages pages={h.pages} slug={slug} docId={docId} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const PRESENCE: Record<string, { text: string; tone: Tone }> = {
  PRESENT: { text: "Present", tone: "ok" },
  MISSING: { text: "Missing", tone: "warn" },
  WITHHELD: { text: "Withheld", tone: "risk" },
};

export function ExpectedEvidence({ r, slug }: { r: IntegrityReport; slug: string }) {
  const ex = r.expectedEvidence;
  const order = { EXPECTED: 0, NICE_TO_HAVE: 1, NOT_YET_EXPECTED: 2 } as const;
  const items = [...ex.items].sort((a, b) => order[a.level] - order[b.level] || (a.presence === "PRESENT" ? 1 : 0) - (b.presence === "PRESENT" ? 1 : 0));
  const debt = r.evidenceDebt;
  const vp = r.verificationPriority;
  return (
    <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
      <div className="min-w-0">
        <SubHead aside={`${titleCase(ex.profile)} · ${titleCase(ex.stageBand)} · ${ex.version}`}>What a deck at this stage should show</SubHead>
        {items.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {items.map((it) => {
              const p = PRESENCE[it.presence]!;
              return (
                <li key={it.itemId} className="grid grid-cols-[1fr_auto] gap-x-3 py-1.5 text-[12.5px]">
                  <div className="min-w-0">
                    <span className={cx(it.level === "NOT_YET_EXPECTED" ? "text-ink-3" : "text-ink")}>{it.label}</span>
                    <span className="ml-1.5 text-[11px] text-ink-3">{it.level === "EXPECTED" ? "expected" : it.level === "NICE_TO_HAVE" ? "nice to have" : "not yet expected"}</span>
                    {it.refs.length > 0 && (
                      <div className="mt-0.5">
                        <Refs refs={it.refs.filter((x) => /^(MET|CLM|SRC)-/.test(x))} slug={slug} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-start gap-1">
                    {it.presence !== "PRESENT" && it.severity && <Sev s={it.severity} />}
                    <Badge tone={it.level === "NOT_YET_EXPECTED" && it.presence !== "PRESENT" ? "neutral" : p.tone}>{p.text}</Badge>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-3">No expected-evidence items resolved for this peer group.</p>
        )}
      </div>
      <div className="min-w-0 space-y-8">
        <div>
          <SubHead aside={debt.overall ? undefined : "no material items"}>
            Evidence debt {debt.overall && <LevelBadge level={debt.overall} kind="risk" />}
          </SubHead>
          <Table minWidth={420}>
            <thead>
              <tr>
                <th className={th}>Area</th>
                <th className={cx(th, "text-right")}>Items</th>
                <th className={cx(th, "text-right")}>Verified</th>
                <th className={cx(th, "text-right")}>Company-only</th>
                <th className={cx(th, "text-right")}>Contra.</th>
                <th className={th}>Debt</th>
              </tr>
            </thead>
            <tbody>
              {debt.areas.map((a) => (
                <tr key={a.area}>
                  <td className={td}>{titleCase(a.area)}</td>
                  <td className={cx(td, "num text-right")}>{a.items}</td>
                  <td className={cx(td, "num text-right")}>{a.verified + a.independentlySupported}</td>
                  <td className={cx(td, "num text-right")}>{a.companyOnly}</td>
                  <td className={cx(td, "num text-right", a.contradicted > 0 && "text-risk")}>{a.contradicted}</td>
                  <td className={td}>{a.level ? <LevelBadge level={a.level} kind="risk" /> : <span className="text-[11.5px] text-ink-3">n/a</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Rule className="mt-1.5">{debt.rule}</Rule>
        </div>
        <div>
          <SubHead aside={vp.label}>Verify first</SubHead>
          {vp.items.length ? (
            <ol className="divide-y divide-line border-y border-line">
              {vp.items.slice(0, 8).map((x, i) => (
                <li key={x.claimId} className="grid grid-cols-[20px_1fr_auto] gap-2 py-1.5 text-[12.5px]">
                  <span className="num text-ink-3">{i + 1}</span>
                  <span className="min-w-0 text-ink-2">
                    <Refs refs={[x.claimId]} slug={slug} /> {x.statement}
                  </span>
                  <span className="num text-ink" title={`materiality ${x.materiality} · unusualness ${x.unusualness} · uncertainty ${x.uncertainty}`}>
                    {x.index}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[12.5px] text-ink-3">No unverified material claims.</p>
          )}
          {vp.formula && <Rule className="mt-1.5">{vp.formula}</Rule>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

const CONF_TONE: Record<string, Tone> = { HIGH: "ok", MEDIUM: "neutral", LOW: "warn", NONE: "unknown" };

export function Confidence({ r, slug }: { r: IntegrityReport; slug: string }) {
  const rows = [...r.confidence.fields, ...r.confidence.metrics];
  if (!rows.length) return <p className="text-[13px] text-ink-3">No field could be assessed.</p>;
  return (
    <div>
      <ul className="grid gap-x-8 sm:grid-cols-2">
        {rows.map((f) => (
          <li key={f.field + (f.ref ?? "")} className="flex items-start justify-between gap-3 border-t border-line py-1.5 text-[12.5px]">
            <div className="min-w-0">
              <div className="text-ink">
                {f.label} {f.ref && /^(MET|CLM)-/.test(f.ref) && <Refs refs={[f.ref]} slug={slug} />}
              </div>
              {f.reasons.length > 0 && <div className="text-[11.5px] text-ink-3">{f.reasons.join("; ")}</div>}
            </div>
            <Badge tone={CONF_TONE[f.confidence] ?? "neutral"}>{f.confidence === "NONE" ? "No confidence" : titleCase(f.confidence)}</Badge>
          </li>
        ))}
      </ul>
      <Rule className="mt-2">Confidence is a conventional label from verification, freshness, sample size, definition and consistency checks — not a probability that the number is right.</Rule>
    </div>
  );
}

export function Density({ r, docId, slug }: { r: IntegrityReport; docId: string | null; slug: string }) {
  const x = r.density;
  const n = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
  return (
    <div>
      <div className="mb-2">
        <Badge tone="neutral">{x.label}</Badge>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat k="Pages" v={x.pages ?? "—"} />
        <Stat k="Material claims / page" v={n(x.materialClaimsPerPage, 2)} sub={`${x.materialClaims} material claims`} />
        <Stat k="Numbers / page" v={n(x.quantitativeObservationsPerPage, 2)} sub={`${x.quantitativeObservations} observations`} />
        <Stat k="Unsupported claim ratio" v={x.unsupportedClaimRatio === null ? "—" : `${Math.round(x.unsupportedClaimRatio * 100)}%`} />
        <Stat k="Redundancy ratio" v={x.redundancyRatio === null ? "—" : `${Math.round(x.redundancyRatio * 100)}%`} sub={`${x.redundantClaimPairs.length} near-duplicate claim pairs`} />
        <Stat k="Pages without a decision fact" v={x.pagesWithoutDecisionFacts.length} sub={x.shareOfPagesWithoutDecisionFacts !== null ? `${Math.round(x.shareOfPagesWithoutDecisionFacts * 100)}% of pages` : undefined} />
      </div>
      {x.pagesWithoutDecisionFacts.length > 0 && (
        <div className="mt-2 text-[12px] text-ink-3">
          Pages without decision facts: <Pages pages={x.pagesWithoutDecisionFacts} slug={slug} docId={docId} />
        </div>
      )}
      <Rule className="mt-2">How much decision-relevant information the deck carries per page. It describes the communication, not the company: a sparse deck can hide a strong business and a dense one a weak business.</Rule>
    </div>
  );
}

/* ---------------------------------------------------------------- */

const TIER_TONE: Record<string, Tone> = { PRIMARY_RECORD: "ok", SECONDARY: "neutral", SELF_AUTHORED_PROFILE: "warn", COMPANY_DERIVED: "warn", COMMERCIAL_ESTIMATE: "neutral", LOW_QUALITY: "risk", UNKNOWN: "unknown" };

export function SourceReliabilityTable({ r, c, slug }: { r: IntegrityReport; c: CanonicalDeal; slug: string }) {
  if (!r.sourceReliability.length) return <p className="text-[13px] text-ink-3">No sources.</p>;
  const byId = new Map(c.sources.map((s) => [s.id, s]));
  return (
    <Table minWidth={720}>
      <thead>
        <tr>
          <th className={th}>Source</th>
          <th className={th}>Tier</th>
          <th className={th}>Published · retrieved</th>
          <th className={th}>Freshness</th>
          <th className={th}>Flags</th>
        </tr>
      </thead>
      <tbody>
        {r.sourceReliability.map((x) => {
          const s = byId.get(x.sourceId);
          return (
            <tr key={x.sourceId}>
              <td className={cx(td, "max-w-[280px]")}>
                <Refs refs={[x.sourceId]} slug={slug} /> <span className="text-ink">{s?.title ?? x.domain ?? "—"}</span>
                {x.domain && <div className="truncate text-[11px] text-ink-3">{x.domain}</div>}
              </td>
              <td className={td}>
                <Badge tone={TIER_TONE[x.tier] ?? "neutral"}>{titleCase(x.tier)}</Badge>
              </td>
              <td className={cx(td, "num text-[12px] text-ink-2")}>
                {s?.publishedDate ?? <Unknown>undated</Unknown>}
                <div className="text-[11px] text-ink-3">retrieved {s?.retrievedAt?.slice(0, 10) ?? "—"}</div>
              </td>
              <td className={td}>
                <FreshnessBadge ageMonths={x.ageMonths} flags={x.flags} />
              </td>
              <td className={cx(td, "font-mono text-[10.5px] text-ink-3")}>{x.flags.filter((f) => f !== "STALE" && f !== "UNKNOWN_DATE").join(" · ") || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function IntegrityLinkHint({ slug }: { slug: string }) {
  return (
    <p className="text-[12px] text-ink-3">
      Every id opens its evidence: <Link href={`/deals/${slug}/evidence`} className="hover:text-ink">claims, metrics and sources →</Link>
    </p>
  );
}
