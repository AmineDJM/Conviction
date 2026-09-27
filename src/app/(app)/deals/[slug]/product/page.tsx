import { loadDeal } from "@/server/deal";
import { Badge, Section, Td, Th } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { DimensionDetail, Fields, Layers, Prose, Quiet, TabMain, TableFrame, enumLabel } from "@/components/deal/tabs/shared";

const VALUE_STATUS: Record<string, { text: string; tone: Tone }> = {
  MEASURED: { text: "Measured", tone: "ok" },
  COMPANY_CLAIMED: { text: "Company-claimed", tone: "neutral" },
  ESTIMATED: { text: "Estimated", tone: "warn" },
  UNSUPPORTED: { text: "Unsupported", tone: "risk" },
};

const RELATIONSHIP: Record<string, { text: string; tone: Tone }> = {
  PAYING: { text: "Paying", tone: "ok" },
  PILOT: { text: "Pilot", tone: "accent" },
  LOI: { text: "LOI", tone: "warn" },
  LOGO_ONLY: { text: "Logo only", tone: "unknown" },
  PARTNER: { text: "Partner", tone: "neutral" },
  UNKNOWN: { text: "Unconfirmed", tone: "unknown" },
};

const DEMAND: Record<string, string> = {
  HAIR_ON_FIRE: "Hair on fire",
  HARD_FACT: "Hard fact",
  FUTURE_VISION: "Future vision",
  CONSUMER_DESIRE: "Consumer desire",
};

export default async function ProductTab({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { company, version } = await loadDeal(slug);
  const c = version!.canonical;
  const d = version!.derived;
  const p = c.product;
  const pain = c.pain;
  const cust = c.customers;
  const bm = c.businessModel;
  const steps = p ? Math.max(p.before.length, p.after.length) : 0;
  const consumer = pain && (pain.demandType === "CONSUMER_DESIRE" || pain.consumerDrivers.length > 0);

  return (
    <TabMain>
      {/* What it is */}
      <Section eyebrow="What the product is" title={p?.whatItIs ?? "Product not yet analyzed"}>
        {p ? (
          <div className="grid gap-10 md:grid-cols-[1.25fr_1fr]">
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {c.classification.productType.map((t) => (
                  <Badge key={t}>{enumLabel(t)}</Badge>
                ))}
                {c.classification.technology
                  .filter((t) => t !== "NONE_TRADITIONAL")
                  .map((t) => (
                    <Badge key={t} tone="unknown">
                      {enumLabel(t)}
                    </Badge>
                  ))}
              </div>
              <p className="max-w-[640px] text-[15px] leading-relaxed text-ink">
                <Prose text={p.whatItDoes} slug={slug} />
              </p>
              <p className="max-w-[640px] leading-relaxed text-ink-2">
                <Prose text={p.plainExplanation} slug={slug} />
              </p>
            </div>
            <Fields
              labelWidth={120}
              rows={[
                { k: "User", v: <Prose text={p.user} slug={slug} /> },
                { k: "Buyer", v: <Prose text={p.buyer} slug={slug} /> },
                ...(c.gtm?.economicBuyer ? [{ k: "Economic buyer", v: <Prose text={c.gtm.economicBuyer} slug={slug} /> }] : []),
              ]}
            />
          </div>
        ) : (
          <Quiet>The product section was not produced in this analysis{c.analysis.mode === "FAST_SCREEN" ? " (fast screen)" : ""}.</Quiet>
        )}
      </Section>

      {/* Workflow before → after */}
      {p && (
        <Section eyebrow="Workflow change" title="Before → after">
          {steps > 0 ? (
            <div className="border-y border-line">
              <div className="grid grid-cols-[28px_1fr_40px_1fr] gap-3 py-2 text-[11.5px] font-medium text-ink-3">
                <span />
                <span>Before — today&apos;s workflow</span>
                <span />
                <span>After — with {c.identity.name}</span>
              </div>
              {Array.from({ length: steps }, (_, i) => (
                <div key={i} className="grid grid-cols-[28px_1fr_40px_1fr] items-baseline gap-3 border-t border-line py-2">
                  <span className="num text-[11.5px] text-ink-3">{i + 1}</span>
                  <span className={p.before[i] ? "text-ink-2" : "text-ink-3"}>{p.before[i] ?? ""}</span>
                  <span className="text-center text-ink-3" aria-hidden>
                    {p.before[i] && p.after[i] ? "→" : ""}
                  </span>
                  <span className={p.after[i] ? "text-ink" : "text-ink-3"}>{p.after[i] ?? ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <Quiet>No workflow steps were described.</Quiet>
          )}
          <div className="mt-5">
            <Layers interpretation={<Prose text={p.workflowChange} slug={slug} />} />
          </div>
        </Section>
      )}

      {/* Value quantification */}
      {p && (
        <Section eyebrow="Value quantification" title="What the product is claimed to change, and how it was measured">
          {p.valueQuantification.length ? (
            <TableFrame minWidth={980}>
              <thead>
                <tr>
                  <Th className="w-[120px]">Kind</Th>
                  <Th>Statement</Th>
                  <Th className="w-[150px]">Baseline</Th>
                  <Th className="w-[100px]">Period</Th>
                  <Th className="w-[150px]">Source</Th>
                  <Th className="w-[200px]">Method</Th>
                  <Th className="w-[130px]">Evidence</Th>
                </tr>
              </thead>
              <tbody>
                {p.valueQuantification.map((v, i) => {
                  const st = VALUE_STATUS[v.evidenceStatus] ?? { text: titleCase(v.evidenceStatus), tone: "unknown" as Tone };
                  return (
                    <tr key={i}>
                      <Td className="text-[12.5px] text-ink-3">{titleCase(v.kind)}</Td>
                      <Td className="text-ink">
                        <Prose text={v.statement} slug={slug} />
                      </Td>
                      <Td className="text-[12.5px] text-ink-2">{v.baseline ?? <span className="text-ink-3">None stated</span>}</Td>
                      <Td className="text-[12.5px] text-ink-2">{v.measurementPeriod ?? <span className="text-ink-3">—</span>}</Td>
                      <Td className="text-[12.5px] text-ink-2">{v.source ? <Prose text={v.source} slug={slug} /> : <span className="text-ink-3">—</span>}</Td>
                      <Td className="text-[12.5px] text-ink-3">
                        <Prose text={v.method} slug={slug} />
                      </Td>
                      <Td>
                        <Badge tone={st.tone}>{st.text}</Badge>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableFrame>
          ) : (
            <Quiet>No quantified value claims were found. Value delivered is unmeasured.</Quiet>
          )}
        </Section>
      )}

      {/* Pain */}
      <Section
        eyebrow="Pain analysis"
        title={pain ? `Demand type: ${DEMAND[pain.demandType] ?? titleCase(pain.demandType)}` : "Pain not yet analyzed"}
      >
        {pain ? (
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr]">
            <Fields
              labelWidth={150}
              rows={[
                { k: "Frequency", v: <Prose text={pain.frequency} slug={slug} /> },
                { k: "Severity", v: <Prose text={pain.severity} slug={slug} /> },
                { k: "Economic cost", v: <Prose text={pain.economicCost} slug={slug} /> },
                { k: "Urgency", v: <Prose text={pain.urgency} slug={slug} /> },
                { k: "Existing budget", v: <Prose text={pain.existingBudget} slug={slug} /> },
                { k: "Alternative behavior", v: <Prose text={pain.alternativeBehavior} slug={slug} /> },
                ...(consumer
                  ? [
                      {
                        k: "Consumer drivers",
                        v: pain.consumerDrivers.length ? (
                          <span className="flex flex-wrap gap-1.5">
                            {pain.consumerDrivers.map((x) => (
                              <Badge key={x}>{titleCase(x)}</Badge>
                            ))}
                          </span>
                        ) : (
                          <span className="text-ink-3">None identified</span>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <div className="border-l border-line pl-4">
              <div className="t-eyebrow mb-1">Interpretation</div>
              <p className="leading-relaxed text-ink-2">
                <Prose text={pain.assessment} slug={slug} />
              </p>
            </div>
          </div>
        ) : (
          <Quiet>The pain section was not produced in this analysis.</Quiet>
        )}
      </Section>

      {/* Business model + customers */}
      <div className="grid gap-10 md:grid-cols-[1fr_1.6fr]">
        <Section eyebrow="Business model" title="How it makes money">
          {bm ? (
            <div className="space-y-4">
              <p className="leading-relaxed text-ink-2">
                <Prose text={bm.howItMakesMoney} slug={slug} />
              </p>
              <Fields
                labelWidth={110}
                rows={[
                  {
                    k: "Revenue model",
                    v: c.classification.revenueModel.length ? (
                      <span className="flex flex-wrap gap-1.5">
                        {c.classification.revenueModel.map((r) => (
                          <Badge key={r}>{titleCase(r)}</Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-ink-3">Not classified</span>
                    ),
                  },
                  { k: "Pricing", v: bm.pricing ? <Prose text={bm.pricing} slug={slug} /> : <span className="text-ink-3">Not disclosed</span> },
                ]}
              />
            </div>
          ) : (
            <Quiet>Business model not yet analyzed.</Quiet>
          )}
        </Section>

        <Section eyebrow="Customers" title={cust ? "Who buys, and how well it is evidenced" : "Customers not yet analyzed"}>
          {cust ? (
            <div className="space-y-5">
              <Fields
                labelWidth={110}
                rows={[
                  { k: "ICP", v: <Prose text={cust.icp} slug={slug} /> },
                  {
                    k: "Segments",
                    v: cust.segments.length ? (
                      <ul className="space-y-0.5">
                        {cust.segments.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="text-ink-3">None stated</span>
                    ),
                  },
                  { k: "Concentration", v: cust.concentrationNote ? <Prose text={cust.concentrationNote} slug={slug} /> : <span className="text-ink-3">Not disclosed</span> },
                  { k: "References", v: <Prose text={cust.referencesNote} slug={slug} /> },
                ]}
              />
              <div>
                <div className="t-eyebrow mb-1.5">Named customers</div>
                {cust.namedCustomers.length ? (
                  <TableFrame>
                    <thead>
                      <tr>
                        <Th className="w-[200px]">Customer</Th>
                        <Th className="w-[120px]">Relationship</Th>
                        <Th>Note</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {cust.namedCustomers.map((n) => {
                        const r = RELATIONSHIP[n.relationship] ?? { text: titleCase(n.relationship), tone: "unknown" as Tone };
                        return (
                          <tr key={n.name}>
                            <Td className="font-medium text-ink">{n.name}</Td>
                            <Td>
                              <Badge tone={r.tone}>{r.text}</Badge>
                            </Td>
                            <Td className="text-[12.5px] text-ink-2">{n.note ? <Prose text={n.note} slug={slug} /> : <span className="text-ink-3">—</span>}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </TableFrame>
                ) : (
                  <Quiet>No customers were named in the materials.</Quiet>
                )}
              </div>
            </div>
          ) : (
            <Quiet>The customer section was not produced in this analysis.</Quiet>
          )}
        </Section>
      </div>

      <Section eyebrow="Operating quality" title="Product & pain dimension">
        <DimensionDetail d={d} id="PRODUCT_PAIN" slug={company.slug} />
      </Section>
    </TabMain>
  );
}
