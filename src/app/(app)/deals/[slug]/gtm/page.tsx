import { metricDef } from "@/engine/metrics/dictionary";
import { loadDeal } from "@/server/deal";
import { Badge, Section } from "@/components/ui";
import { STAGE_LABEL, titleCase } from "@/lib/format";
import { MetricCell } from "@/components/deal/metric";
import { DimensionDetail, Fields, Layers, Prose, Quiet, TabMain, primaryOf } from "@/components/deal/tabs/shared";

const GTM_METRICS = ["sales_cycle_days", "win_rate", "pipeline_value", "founder_led_revenue_share", "organic_acquisition_share", "cac"];

export default async function GtmTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const g = c.gtm;
  const stage = STAGE_LABEL[c.classification.financingStage] ?? titleCase(c.classification.financingStage);

  return (
    <TabMain>
      <Section eyebrow="Go-to-market" title={g ? "Who uses it, who buys it, and how it is sold" : "GTM not yet analyzed"}>
        {g ? (
          <div className="grid gap-10 md:grid-cols-[1.5fr_1fr]">
            <Fields
              labelWidth={150}
              rows={[
                { k: "User", v: <Prose text={g.user} slug={slug} /> },
                { k: "Buyer", v: <Prose text={g.buyer} slug={slug} /> },
                { k: "Economic buyer", v: <Prose text={g.economicBuyer} slug={slug} /> },
                { k: "ICP", v: <Prose text={g.icp} slug={slug} /> },
                { k: "Sales motion", v: <Prose text={g.salesMotion} slug={slug} /> },
                { k: "Sales cycle", v: g.salesCycle ? <Prose text={g.salesCycle} slug={slug} /> : <span className="text-ink-3">Not disclosed</span> },
              ]}
            />
            <div className="space-y-5">
              <div>
                <div className="t-eyebrow mb-1.5">Classified motion</div>
                {c.classification.gtm.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.classification.gtm.map((x) => (
                      <Badge key={x}>{titleCase(x)}</Badge>
                    ))}
                  </div>
                ) : (
                  <Quiet>Not classified.</Quiet>
                )}
              </div>
              <div>
                <div className="t-eyebrow mb-1.5">Channels</div>
                {g.channels.length ? (
                  <ol className="divide-y divide-line border-y border-line">
                    {g.channels.map((ch, i) => (
                      <li key={ch} className="grid grid-cols-[22px_1fr] gap-2 py-1.5 text-ink-2">
                        <span className="num text-[11.5px] text-ink-3">{i + 1}</span>
                        <span>{ch}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <Quiet>No channels identified.</Quiet>
                )}
              </div>
            </div>
          </div>
        ) : (
          <Quiet>The GTM section was not produced in this analysis{c.analysis.mode === "FAST_SCREEN" ? " (fast screen)" : ""}.</Quiet>
        )}
      </Section>

      {g && (
        <Section eyebrow="Founder-led sales" title={`Read relative to stage: ${stage}`}>
          <Layers
            fact={(() => {
              const fl = primaryOf(c.metrics, "founder_led_revenue_share");
              return fl?.normalizedValue != null ? (
                <span>
                  Founder involvement reported at <span className="num font-medium text-ink">{Math.round(fl.normalizedValue)}%</span>
                  {fl.definitionUsed ? <span className="text-ink-3"> — {fl.definitionUsed}</span> : null}
                </span>
              ) : (
                <span className="text-ink-3">Founder share of sales not disclosed.</span>
              );
            })()}
            interpretation={<Prose text={g.founderLedAssessment} slug={slug} />}
            implication={<Prose text={g.assessment} slug={slug} />}
          />
        </Section>
      )}

      <Section eyebrow="GTM metrics" title="Measured, with evidence status">
        <div className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-line py-4 sm:grid-cols-3 lg:grid-cols-6">
          {GTM_METRICS.map((k) => {
            const m = primaryOf(c.metrics, k);
            const def = metricDef(k);
            if (m) return <MetricCell key={k} m={m} slug={company.slug} />;
            return (
              <div key={k} className="py-1" title={def?.definition}>
                <div className="text-[12px] text-ink-3">{def?.shortName ?? k}</div>
                <div className="text-[17px] font-semibold tracking-tight text-ink-3">—</div>
                <div className="mt-0.5 text-[11px] text-ink-3">Not disclosed</div>
              </div>
            );
          })}
        </div>
        {d.smallSampleWarnings.some((w) => GTM_METRICS.includes(w.metricKey)) && (
          <p className="mt-3 text-[12px] text-warn">
            Small-sample caution:{" "}
            {d.smallSampleWarnings
              .filter((w) => GTM_METRICS.includes(w.metricKey))
              .map((w) => w.label)
              .join(", ")}{" "}
            — sample size not disclosed or below the dictionary minimum.
          </p>
        )}
      </Section>

      <Section eyebrow="Operating quality" title="Go-to-market dimension">
        <DimensionDetail d={d} id="GTM" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
