import { loadDeal } from "@/server/deal";
import { Badge, Callout, Section, Td, Th, cx } from "@/components/ui";
import { DimensionDetail, Fields, Prose, Quiet, TabMain, TableFrame, compactUsd as usd } from "@/components/deal/tabs/shared";
import { LogRangeChart, type LogRow } from "@/components/deal/tabs/log-range";

const METHOD_LABEL: Record<string, string> = {
  BOTTOM_UP: "Bottom-up",
  VALUE_CAPTURE: "Value capture",
  TOP_DOWN: "Top-down",
};

/** Display-only sanity check: a "market" below this is almost certainly a per-customer figure. */
const IMPLAUSIBLY_SMALL_USD = 10_000_000;

function ratio(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return ">1,000×";
  return `${n.toFixed(n < 10 ? 1 : 0)}×`;
}

function moneyOf(m: { amount: number | null; currency: string; rawText?: string | null } | null): string {
  if (!m || m.amount === null) return "—";
  return m.currency === "USD" ? usd(m.amount) : `${m.amount.toLocaleString("en-US")} ${m.currency}`;
}

export default async function MarketTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const m = c.market;
  const rec = d.market;
  const primary = rec.primary;
  const inflated = rec.deckInflation !== null && rec.deckInflation > 3;
  const divergent = rec.methodDivergence !== null && rec.methodDivergence > 10;

  const rows: LogRow[] = rec.ranges.map((r) => ({
    label: METHOD_LABEL[r.method] ?? r.method,
    sub: primary && r.method === primary.method ? "Primary method" : r.highUsd < IMPLAUSIBLY_SMALL_USD ? "Implausibly small" : undefined,
    low: r.lowUsd,
    high: r.highUsd,
    primary: !!primary && r.method === primary.method,
    caution: r.highUsd < IMPLAUSIBLY_SMALL_USD,
  }));
  if (rec.deckTamUsd) rows.push({ label: "Deck TAM", sub: "Not accepted", low: rec.deckTamUsd, high: rec.deckTamUsd, marker: true });

  return (
    <TabMain>
      {/* Current market + wedge */}
      <div className="grid gap-10 md:grid-cols-2">
        <Section eyebrow="Current market" title="What the company actually sells into today">
          {m ? (
            <p className="leading-relaxed text-ink-2">
              <Prose text={m.currentMarket} slug={slug} />
            </p>
          ) : (
            <Quiet>Market not yet analyzed.</Quiet>
          )}
        </Section>
        <Section eyebrow="Initial wedge" title="Where it enters">
          {m ? (
            <p className="leading-relaxed text-ink-2">
              <Prose text={m.wedge} slug={slug} />
            </p>
          ) : (
            <Quiet>Wedge not yet analyzed.</Quiet>
          )}
        </Section>
      </div>

      {/* Reconstructed market */}
      <Section eyebrow="Reconstructed market" title="Independent ranges, computed by code from stated assumptions">
        {rec.ranges.length ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 md:grid-cols-4">
              <div>
                <div className="t-eyebrow mb-1">Primary range</div>
                <div className="num text-[17px] font-semibold tracking-tight">{primary ? `${usd(primary.lowUsd)} – ${usd(primary.highUsd)}` : "—"}</div>
                <div className="text-[11.5px] text-ink-3">{primary ? `${METHOD_LABEL[primary.method]} · midpoint ${usd(rec.midpointUsd)} (geometric)` : "No primary method"}</div>
              </div>
              <div>
                <div className="t-eyebrow mb-1">Deck TAM</div>
                <div className="num text-[17px] font-semibold tracking-tight text-ink-3 line-through decoration-1">{usd(rec.deckTamUsd)}</div>
                <div className="mt-0.5">
                  <Badge tone="unknown">Not accepted</Badge>
                </div>
              </div>
              <div>
                <div className="t-eyebrow mb-1">Deck inflation</div>
                <div className={cx("num text-[17px] font-semibold tracking-tight", inflated && "text-risk")}>{ratio(rec.deckInflation)}</div>
                <div className="text-[11.5px] text-ink-3">Deck TAM ÷ primary high{inflated ? " — above 3×, likely inflated" : ""}</div>
              </div>
              <div>
                <div className="t-eyebrow mb-1">Method divergence</div>
                <div className={cx("num text-[17px] font-semibold tracking-tight", divergent && "text-warn")}>{ratio(rec.methodDivergence)}</div>
                <div className="text-[11.5px] text-ink-3">Max high ÷ min low{divergent ? " — above 10×, methods disagree" : ""}</div>
              </div>
            </div>

            <LogRangeChart rows={rows} />

            <TableFrame minWidth={900}>
              <thead>
                <tr>
                  <Th className="w-[130px]">Method</Th>
                  <Th className="w-[160px]" align="right">
                    Range (USD / yr)
                  </Th>
                  <Th>Formula</Th>
                  <Th>Basis</Th>
                </tr>
              </thead>
              <tbody>
                {rec.ranges.map((r) => {
                  const isPrimary = primary?.method === r.method;
                  const small = r.highUsd < IMPLAUSIBLY_SMALL_USD;
                  return (
                    <tr key={r.method} className={cx(isPrimary && "bg-accent-soft/40")}>
                      <Td className={cx(isPrimary && "border-l-2 border-l-accent")}>
                        <div className="font-medium text-ink">{METHOD_LABEL[r.method]}</div>
                        {isPrimary && (
                          <Badge tone="accent" className="mt-1">
                            Primary
                          </Badge>
                        )}
                      </Td>
                      <Td align="right" className="whitespace-nowrap text-ink">
                        {usd(r.lowUsd)} – {usd(r.highUsd)}
                        {small && <div className="mt-1 text-[11px] font-normal text-warn">Implausibly small for a market total</div>}
                      </Td>
                      <Td className="font-mono text-[11.5px] leading-relaxed text-ink-2">{r.formula}</Td>
                      <Td className="text-[12.5px] text-ink-2">
                        <Prose text={r.basis} slug={slug} />
                        {small && (
                          <div className="mt-1 text-[11.5px] text-warn">
                            Below {usd(IMPLAUSIBLY_SMALL_USD)} per year — the inputs are likely per-customer rather than market-level. Read this range with caution; it also
                            drives the method-divergence figure.
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
            <p className="text-[11.5px] text-ink-3">
              The model supplies assumptions; code computes the ranges. The primary method is bottom-up where available, then value capture, then top-down. The deck TAM is
              never used as the market size.
            </p>
          </div>
        ) : (
          <Quiet>No market range could be reconstructed — the analysis did not supply bottom-up, value-capture or top-down assumptions.</Quiet>
        )}
      </Section>

      {/* Deck TAM, separately */}
      <Section eyebrow="Deck market claim" title="Shown for reference — not accepted">
        <div className="grid gap-10 md:grid-cols-[1fr_1.4fr]">
          <Fields
            labelWidth={90}
            rows={[
              { k: "TAM", v: <span className="num">{moneyOf(c.deckMarket.tam)}{c.deckMarket.tam?.rawText ? <span className="text-ink-3"> · “{c.deckMarket.tam.rawText}”</span> : null}</span> },
              { k: "SAM", v: <span className="num">{moneyOf(c.deckMarket.sam)}</span> },
              { k: "SOM", v: <span className="num">{moneyOf(c.deckMarket.som)}</span> },
            ]}
          />
          <div className="space-y-3">
            {c.deckMarket.description && (
              <div>
                <div className="t-eyebrow mb-1">What the deck says</div>
                <p className="text-ink-2">{c.deckMarket.description}</p>
              </div>
            )}
            {m?.deckTamAssessment && (
              <div className="border-l border-line pl-4">
                <div className="t-eyebrow mb-1">Assessment</div>
                <p className="text-ink-2">
                  <Prose text={m.deckTamAssessment} slug={slug} />
                </p>
              </div>
            )}
            {!c.deckMarket.description && !m?.deckTamAssessment && <Quiet>The deck made no market-size claim.</Quiet>}
          </div>
        </div>
      </Section>

      {/* Value capture */}
      <Section eyebrow="Value capture" title="Can the company keep the value it creates?">
        {m ? (
          <div className="grid gap-10 md:grid-cols-[1.5fr_1fr]">
            <Fields
              labelWidth={170}
              rows={[
                { k: "Willingness to pay", v: <Prose text={m.valueCaptureAnalysis.willingnessToPay} slug={slug} /> },
                { k: "Pricing power", v: <Prose text={m.valueCaptureAnalysis.pricingPower} slug={slug} /> },
                { k: "Substitute pricing", v: <Prose text={m.valueCaptureAnalysis.substitutePricing} slug={slug} /> },
                { k: "Switching cost", v: <Prose text={m.valueCaptureAnalysis.switchingCost} slug={slug} /> },
                { k: "Buyer concentration", v: <Prose text={m.valueCaptureAnalysis.buyerConcentration} slug={slug} /> },
                { k: "Commoditization risk", v: <Prose text={m.valueCaptureAnalysis.commoditizationRisk} slug={slug} /> },
              ]}
            />
            <div className="border-l border-line pl-4">
              <div className="t-eyebrow mb-1">Conclusion · implication</div>
              <p className="leading-relaxed text-ink">
                <Prose text={m.valueCaptureAnalysis.conclusion} slug={slug} />
              </p>
            </div>
          </div>
        ) : (
          <Quiet>Value capture not yet analyzed.</Quiet>
        )}
      </Section>

      {/* Expansion */}
      <Section
        eyebrow="Expansion markets"
        title="Adjacent markets the company could enter later"
        action={<Badge tone="warn">Not included in TAM</Badge>}
      >
        {m && m.expansion.length ? (
          <TableFrame minWidth={1100}>
            <thead>
              <tr>
                <Th className="w-[170px]">Market</Th>
                <Th>Customer adjacency</Th>
                <Th>Product adjacency</Th>
                <Th>Distribution adjacency</Th>
                <Th>Technical requirements</Th>
                <Th className="w-[130px]">Timeline</Th>
                <Th className="w-[140px]">Capital</Th>
              </tr>
            </thead>
            <tbody className="text-[12.5px]">
              {m.expansion.map((x) => (
                <tr key={x.market}>
                  <Td className="text-[13px] font-medium text-ink">{x.market}</Td>
                  <Td className="text-ink-2">
                    <Prose text={x.customerAdjacency} slug={slug} />
                  </Td>
                  <Td className="text-ink-2">
                    <Prose text={x.productAdjacency} slug={slug} />
                  </Td>
                  <Td className="text-ink-2">
                    <Prose text={x.distributionAdjacency} slug={slug} />
                  </Td>
                  <Td className="text-ink-2">
                    <Prose text={x.technicalRequirements} slug={slug} />
                  </Td>
                  <Td className="text-ink-2">
                    <Prose text={x.timeline} slug={slug} />
                  </Td>
                  <Td className="text-ink-2">
                    <Prose text={x.capitalRequired} slug={slug} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        ) : (
          <Quiet>No expansion markets were identified.</Quiet>
        )}
      </Section>

      {/* Why now */}
      <Section eyebrow="Why now" title="What changed that makes this possible today">
        {m?.whyNow ? (
          <p className="max-w-[860px] leading-relaxed text-ink-2">
            <Prose text={m.whyNow} slug={slug} />
          </p>
        ) : (
          <Quiet>No timing catalyst was identified.</Quiet>
        )}
      </Section>

      {inflated && (
        <Callout tone="warn" title={`The deck market is ${ratio(rec.deckInflation)} the reconstructed primary range`}>
          Return and power-law calculations use the reconstructed range, never the deck figure.
        </Callout>
      )}

      <div className="grid gap-10 md:grid-cols-1">
        <Section eyebrow="Operating quality" title="Market dimension">
          <DimensionDetail d={d} id="MARKET" slug={company.slug} />
        </Section>
        <Section eyebrow="Operating quality" title="Why-now dimension">
          <DimensionDetail d={d} id="WHY_NOW" slug={company.slug} />
        </Section>
      </div>
    </TabMain>
  );
}
