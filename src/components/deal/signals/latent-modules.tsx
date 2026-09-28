/**
 * "Beyond the pitch": what the deck reveals beyond what it claims, and the
 * latent signal modules (derived.latent). Observable signals only — no
 * psychology, never an honesty judgement. Every module shows its level, its
 * basis (model-observed vs computed), the deterministic rule, coverage and
 * the pages it rests on. Secondary signals: never folded into Operating Quality.
 */
import type { ReactNode } from "react";
import type { CanonicalDeal } from "@/domain/canonical";
import type { LatentReport } from "@/engine/latent";
import type { LatentModule } from "@/engine/latent/types";
import { Badge, cx } from "@/components/ui";
import { titleCase, usd, type Tone } from "@/lib/format";
import { RichText } from "@/components/deal/rich-text";
import { BasisBadge, LevelBadge, Pages, Rule, Stat, Unknown } from "@/components/deal/v2/kit";

const moduleName = (m: string) => {
  const t = m.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

const DIR: Record<string, { text: string; tone: Tone }> = {
  POSITIVE: { text: "Positive", tone: "ok" },
  NEGATIVE: { text: "Negative", tone: "risk" },
  NEUTRAL: { text: "Neutral", tone: "neutral" },
};

export function RevealedBeyondPitch({ c, lt, slug, docId }: { c: CanonicalDeal; lt: LatentReport | null; slug: string; docId: string | null }) {
  const model = c.revealedBeyondPitch;
  const computed = lt?.signalsForSynthesis ?? [];
  if (!model.length && !computed.length)
    return <p className="text-[13px] text-ink-3">Nothing was synthesized for this version. The absence of a reading is not a clean bill of health.</p>;
  return (
    <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] [&>*]:min-w-0">
      <div>
        <div className="t-eyebrow mb-2">Insights · model synthesis of observable signals</div>
        {model.length ? (
          <ol className="space-y-3">
            {model.map((x, i) => (
              <li key={i} className="border-l-2 pl-3" style={{ borderColor: `var(--${x.direction === "NEGATIVE" ? "risk" : x.direction === "POSITIVE" ? "ok" : "line-strong"})` }}>
                <div className="text-[14px] font-medium leading-snug text-ink">
                  <RichText text={x.insight} slug={slug} />
                </div>
                <p className="mt-0.5 text-[12.5px] text-ink-2">
                  <RichText text={x.evidence} slug={slug} />
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <BasisBadge b={x.basis} />
                  <Badge tone={DIR[x.direction]!.tone}>{DIR[x.direction]!.text}</Badge>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12.5px] text-ink-3">No model synthesis for this version.</p>
        )}
      </div>
      <div>
        <div className="t-eyebrow mb-2">Most informative latent signals · ranked by code</div>
        {computed.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {computed.slice(0, 10).map((s) => (
              <li key={s.id} className="py-1.5 text-[12.5px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={DIR[s.direction]!.tone}>{DIR[s.direction]!.text}</Badge>
                  <span className="text-[11px] text-ink-3">{moduleName(s.module)}</span>
                  {s.basis.map((b) => (
                    <BasisBadge key={b} b={b} />
                  ))}
                  <Pages pages={s.pages} slug={slug} docId={docId} />
                </div>
                <div className="mt-0.5 text-ink">{s.signal}</div>
                {s.evidence && <div className="text-ink-3">{s.evidence}</div>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-ink-3">No latent signals computed.</p>
        )}
      </div>
    </div>
  );
}

function Coverage({ m }: { m: LatentModule }) {
  const pct = Math.round(m.coverage.ratio * 100);
  return (
    <div className="text-[11.5px] text-ink-3">
      <span className="inline-flex items-center gap-1.5">
        Coverage
        <span className="relative inline-block h-1 w-12 rounded-full bg-surface-3" aria-hidden>
          <span className="absolute inset-y-0 left-0 rounded-full bg-ink-3" style={{ width: `${pct}%` }} />
        </span>
        <span className="num">{pct}%</span>
      </span>
      {m.coverage.missing.length > 0 && <span> · missing {m.coverage.missing.join(", ")}</span>}
      {m.coverage.note && <span> · {m.coverage.note}</span>}
    </div>
  );
}

function ModuleCard({ id, title, level, m, children, slug, docId, className }: { id: string; title: string; level: ReactNode; m: LatentModule; children: ReactNode; slug: string; docId: string | null; className?: string }) {
  return (
    <section id={id} className={cx("min-w-0 scroll-mt-32 break-words rounded-lg border border-line bg-surface px-4 py-3.5", className)}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
        <div className="flex flex-wrap items-center gap-1.5">{level}</div>
      </div>
      <div className="space-y-2 text-[12.5px] text-ink-2">{children}</div>
      <div className="mt-3 space-y-1 border-t border-line pt-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {m.basis.length ? m.basis.map((b) => <BasisBadge key={b} b={b} />) : <Badge tone="unknown">No basis</Badge>}
          <Pages pages={m.pages} slug={slug} docId={docId} />
        </div>
        <Coverage m={m} />
        <Rule>Rule: {m.rule}</Rule>
      </div>
    </section>
  );
}

const pctOrUnknown = (v: number | null) => (v === null ? <Unknown /> : `${Math.round(v)}%`);

const STATUS_TONE: Record<string, Tone> = { DEMONSTRATED: "ok", PARTIAL: "warn", NOT_SHOWN: "unknown", CONTRADICTED: "risk", NOT_ASSESSED: "unknown" };

export function LatentModules({ lt, slug, docId }: { lt: LatentReport; slug: string; docId: string | null }) {
  const om = lt.operatingMaturity;
  const qt = lt.qualityOfThinking;
  const ms = lt.metricSelection;
  const ni = lt.narrativeInflation;
  const mi = lt.missingAsSignal;
  const pd = lt.precisionDiscipline;
  const cu = lt.causalUnderstanding;
  const am = lt.ambition;
  const re = lt.resourceEfficiency;
  const dq = lt.disclosureQuality;
  const p = { slug, docId };
  return (
    <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
      <ModuleCard id="maturity" title="Operating maturity" level={<LevelBadge level={om.level} />} m={om} {...p}>
        <ul className="divide-y divide-line">
          {om.signals.map((s) => (
            <li key={s.signal} className="flex items-start justify-between gap-3 py-1">
              <div className="min-w-0">
                <div className="text-ink">{s.label}</div>
                {s.evidence[0] && <div className="text-[11.5px] text-ink-3">{s.evidence[0].text}</div>}
                {s.conflictNote && <div className="text-[11.5px] text-warn">{s.conflictNote}</div>}
              </div>
              <Badge tone={STATUS_TONE[s.status] ?? "neutral"}>{titleCase(s.status)}</Badge>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] text-ink-3">{om.performanceIndependence}</p>
        {om.understandsWeakNumbers && <p className="text-ok">Shows weak numbers together with an explanation of why.</p>}
      </ModuleCard>

      <ModuleCard id="thinking" title="Quality of thinking" level={<LevelBadge level={qt.level} />} m={qt} {...p}>
        <div className="grid grid-cols-3 gap-3">
          <Stat k="Evidence + reasoning" v={pctOrUnknown(qt.supportedPct)} />
          <Stat k="Evidence only" v={pctOrUnknown(qt.evidenceOnlyPct)} />
          <Stat k="Assertion only" v={pctOrUnknown(qt.assertionOnlyPct)} tone={qt.assertionOnlyPct && qt.assertionOnlyPct > 30 ? "warn" : undefined} />
        </div>
        <div>
          Market sizing: <b className="font-medium text-ink">{titleCase(qt.marketSizing.style)}</b> · movements explained: {pctOrUnknown(qt.explainedMovementsPct)} · {qt.conclusions} key conclusions read
        </div>
        {qt.unsupportedConclusions.length > 0 && (
          <div>
            <div className="text-[11.5px] text-ink-3">Asserted without evidence</div>
            <ul className="list-disc pl-4">
              {qt.unsupportedConclusions.slice(0, 4).map((u, i) => (
                <li key={i}>
                  {u.conclusion} <Pages pages={[u.page]} {...p} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModuleCard>

      <ModuleCard
        id="metric-selection"
        title="Metric selection & vanity dependence"
        level={
          <>
            <span className="text-[11px] text-ink-3">vanity dependence</span>
            <LevelBadge level={ms.vanityDependence} kind="risk" />
          </>
        }
        m={ms}
        {...p}
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat k="Decision-metric coverage" v={pctOrUnknown(ms.decisionCoveragePct)} sub={`${ms.presentCount} of ${ms.expectedCount} expected`} />
          <Stat k="Vanity share" v={pctOrUnknown(ms.vanitySharePct)} sub={`${ms.quantitativeObservations} numbers shown`} />
          <Stat k="Vanity metrics" v={ms.vanityMetrics.length} />
        </div>
        {ms.absentDecisionMetrics.length > 0 && (
          <div>
            <span className="text-ink-3">Absent decision metrics: </span>
            {ms.absentDecisionMetrics.join(", ")}
          </div>
        )}
        {ms.vanityInPlaceOfDecision.length > 0 && (
          <ul className="list-disc pl-4 text-warn">
            {ms.vanityInPlaceOfDecision.map((v, i) => (
              <li key={i}>
                {v.vanity} shown in place of {v.absentDecisionMetric} <Pages pages={[v.page]} {...p} />
              </li>
            ))}
          </ul>
        )}
      </ModuleCard>

      <ModuleCard id="inflation" title="Narrative inflation risk" level={<LevelBadge level={ni.level} kind="risk" />} m={ni} {...p}>
        <p className="text-[11.5px] text-ink-3">Presentation choices that raise the impression of performance — not accusations of lying. Weighted score {ni.score} (conventional, not a probability).</p>
        {ni.techniques.length ? (
          <ul className="divide-y divide-line">
            {ni.techniques.map((t) => (
              <li key={t.technique} className="flex flex-wrap items-baseline justify-between gap-2 py-1">
                <span className="text-ink">{t.label}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
                  {t.sources.map((s) => (s === "COMPUTED" ? "computed" : "model")).join(" + ")} · w{t.weight}
                  <Pages pages={t.pages} {...p} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>No inflating technique detected.</p>
        )}
      </ModuleCard>

      <ModuleCard id="missing" title="Missing information as signal" level={<Badge tone={mi.highCount ? "risk" : mi.material.length ? "warn" : "ok"}>{mi.material.length} material omission{mi.material.length === 1 ? "" : "s"}</Badge>} m={mi} {...p}>
        {mi.omissions.filter((o) => o.kind !== "NOT_YET_EXPECTED").length ? (
          <ul className="divide-y divide-line">
            {mi.omissions
              .filter((o) => o.kind !== "NOT_YET_EXPECTED")
              .slice(0, 8)
              .map((o) => (
                <li key={o.slotId} className="py-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={o.kind === "WITHHELD" ? "risk" : o.kind === "STALE" || o.kind === "FORWARD_ONLY" ? "warn" : "unknown"}>{titleCase(o.kind)}</Badge>
                    <span className={cx("text-[11px]", o.severity === "HIGH" ? "text-risk" : "text-ink-3")}>{titleCase(o.severity)}</span>
                  </div>
                  <div className="text-ink">{o.sentence}</div>
                  {o.flatteringSubstitute && <div className="text-[11.5px] text-warn">Shown instead: {o.flatteringSubstitute}</div>}
                </li>
              ))}
          </ul>
        ) : (
          <p>Nothing expected at this stage is missing.</p>
        )}
        {mi.notYetExpected.length > 0 && <p className="text-[11.5px] text-ink-3">Not yet expected at this stage: {mi.notYetExpected.map((o) => o.metric).join(", ")}.</p>}
      </ModuleCard>

      <ModuleCard id="precision" title="Precision discipline" level={<LevelBadge level={pd.level} />} m={pd} {...p}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat k="Definitions" v={pctOrUnknown(pd.definitionQuality.pct)} sub={`${pd.definitionQuality.numerator}/${pd.definitionQuality.denominator}`} />
          <Stat k="Dated precisely" v={pctOrUnknown(pd.temporalPrecision.pct)} sub={`${pd.temporalPrecision.none} undated`} />
          <Stat k="Scope stated" v={pctOrUnknown(pd.scopePrecision.pct)} />
          <Stat k="Forecast separated" v={pctOrUnknown(pd.forecastSeparation.pct)} />
        </div>
        {pd.impreciseExamples.length > 0 && <div className="text-[11.5px] text-ink-3">Imprecise: {pd.impreciseExamples.slice(0, 3).join("; ")}</div>}
      </ModuleCard>

      <ModuleCard id="causal" title="Causal understanding" level={<LevelBadge level={cu.level} />} m={cu} {...p}>
        <div>
          ARR bridge: <Badge tone={cu.bridge.status === "RECONCILES" ? "ok" : cu.bridge.status === "DOES_NOT_RECONCILE" ? "risk" : "unknown"}>{titleCase(cu.bridge.status)}</Badge> <span className="text-ink-3">{cu.bridge.detail}</span>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <div>
            <span className="text-ink-3">Cohorts disclosed: </span>
            {cu.cohortsDisclosed ? "yes" : "no"}
          </div>
          <div>
            <span className="text-ink-3">Movements explained: </span>
            {pctOrUnknown(cu.explainedPct)}
          </div>
          <div>
            <span className="text-ink-3">Churn reasons: </span>
            {cu.churnReasons}
          </div>
          <div>
            <span className="text-ink-3">Win / loss: </span>
            {cu.winLoss}
          </div>
        </div>
      </ModuleCard>

      <ModuleCard id="ambition" title="Ambition vs. operational roadmap" level={<LevelBadge level={am.consistency} />} m={am} {...p}>
        <div className="grid grid-cols-3 gap-3">
          <Stat k="Deck TAM" v={am.deckTamUsd !== null ? usd(am.deckTamUsd) : <Unknown />} />
          <Stat k="TAM ÷ raise" v={am.tamToRaise !== null ? `${Math.round(am.tamToRaise).toLocaleString("en-US")}×` : <Unknown />} />
          <Stat k="TAM ÷ reconstructed" v={am.deckTamToReconstructed !== null ? `${am.deckTamToReconstructed.toFixed(1)}×` : <Unknown />} />
        </div>
        <div>
          <span className="text-ink-3">Funded geography: </span>
          {titleCase(am.fundedGeography.scope)}
          {am.fundedGeography.places.length ? ` (${am.fundedGeography.places.join(", ")})` : ""} · headline scope {titleCase(am.headlineScope)}
          {am.bridgeStated === false && <span className="text-warn"> · no bridge from wedge to headline</span>}
        </div>
        <p className="font-medium text-ink">{am.question}</p>
      </ModuleCard>

      <ModuleCard id="efficiency" title="Resource efficiency" level={<Badge tone="neutral">{re.label}</Badge>} m={re} {...p}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat k="ARR per $ raised" v={re.ratios.arrPerDollarRaised !== null ? `$${re.ratios.arrPerDollarRaised.toFixed(2)}` : <Unknown />} />
          <Stat k="ARR per FTE" v={re.ratios.arrPerFte !== null ? usd(re.ratios.arrPerFte) : <Unknown />} />
          <Stat k="ARR per month alive" v={re.ratios.arrPerMonth !== null ? usd(re.ratios.arrPerMonth) : <Unknown />} />
        </div>
        {re.readings.length > 0 && (
          <ul className="list-disc pl-4">
            {re.readings.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        )}
        <div className="text-[11.5px] text-ink-3">
          Inputs: ARR {re.inputs.arrUsd !== null ? usd(re.inputs.arrUsd) : "unknown"} ({re.inputs.arrSource ?? "—"}) · capital {re.inputs.capitalRaisedUsd !== null ? usd(re.inputs.capitalRaisedUsd) : "unknown"} ({re.inputs.capitalSource ?? "—"}) · FTE {re.inputs.fte ?? "unknown"} · founded {re.inputs.foundedYear ?? "unknown"}
        </div>
      </ModuleCard>

      <ModuleCard id="disclosure" title="Disclosure quality" level={<LevelBadge level={dq.level} />} m={dq} {...p}>
        <p className="text-[11.5px] text-ink-3">What the founder volunteers that a purely promotional deck would hide. A description of the materials — not a judgement of any person.</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(dq.disclosuresByKind)
            .filter(([, n]) => n > 0)
            .map(([k, n]) => (
              <Badge key={k} tone="neutral">
                {titleCase(k)} · {n}
              </Badge>
            ))}
          {Object.values(dq.disclosuresByKind).every((n) => !n) && <span className="text-ink-3">No voluntary disclosures observed.</span>}
        </div>
        {dq.unflatteringTrends.length > 0 && (
          <ul className="list-disc pl-4">
            {dq.unflatteringTrends.map((t, i) => (
              <li key={i}>
                {t.metricKey}: {t.changePct.toFixed(0)}% ({t.from.period} → {t.to.period}) — {t.explained ? `explained: ${t.explained}` : <span className="text-warn">not explained</span>}
              </li>
            ))}
          </ul>
        )}
        <div className="text-[11.5px] text-ink-3">
          {dq.withheldCount} withheld · {dq.materialOmissions} material omission{dq.materialOmissions === 1 ? "" : "s"}.
        </div>
      </ModuleCard>
    </div>
  );
}
