/**
 * Deck forensics (model-reported, "what is the deck trying to make me
 * believe?"), perfect slides and alternative explanations. These are model
 * readings of the materials — labelled as such and never scored by code.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { IntegrityReport } from "@/engine/integrity";
import { Badge, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { RichText } from "@/components/deal/rich-text";
import { Origin, Pages, Rule, Sev, SubHead } from "@/components/deal/v2/kit";

const PROOF_TONE: Record<string, Tone> = { MARKETING_SCREENSHOT: "risk", PROTOTYPE: "warn", DEMO: "warn", PRODUCTION_USAGE: "ok", REAL_INTEGRATIONS: "ok", UNKNOWN: "unknown" };
const PROOF_ORDER = ["MARKETING_SCREENSHOT", "PROTOTYPE", "DEMO", "PRODUCTION_USAGE", "REAL_INTEGRATIONS"];

function Block({ title, aside, children, className }: { title: string; aside?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx("min-w-0", className)}>
      <SubHead aside={aside}>{title}</SubHead>
      {children}
    </div>
  );
}

export function DeckForensics({ c, slug, docId }: { c: CanonicalDeal; slug: string; docId: string | null }) {
  const f = c.forensics;
  if (!f)
    return <p className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-3">The forensic pass did not run for this version. Narrative, chart, product-proof and slide readings are unknown — not assumed clean.</p>;
  const na = f.narrativeArchitecture;
  const proofIdx = PROOF_ORDER.indexOf(f.productProof.level);
  return (
    <div className="space-y-10">
      <div className="rounded-lg border border-line bg-surface px-4 py-4 sm:px-5">
        <div className="t-eyebrow mb-1">What the deck is trying to make me believe</div>
        <p className="text-[16px] font-medium leading-snug text-ink">{na.beliefTheDeckWantsMeToHold}</p>
        <dl className="mt-3 grid gap-x-8 gap-y-3 text-[12.5px] md:grid-cols-2">
          <div>
            <dt className="text-ink-3">Central argument</dt>
            <dd className="text-ink-2">{na.centralArgument}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Why the slides are in this order</dt>
            <dd className="text-ink-2">{na.slideOrderRationale}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Emphasized</dt>
            <dd className="text-ink-2">
              {na.emphasized.length ? (
                <ul className="space-y-0.5">
                  {na.emphasized.map((e, i) => (
                    <li key={i}>
                      {e.what} <Pages pages={[e.page]} slug={slug} docId={docId} />
                    </li>
                  ))}
                </ul>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Weaknesses the narrative routes around (hypotheses)</dt>
            <dd className="text-ink-2">{na.routedAroundWeaknesses.length ? <ul className="list-disc space-y-0.5 pl-4">{na.routedAroundWeaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul> : "None noted"}</dd>
          </div>
        </dl>
        {na.absentDecisiveInformation.length > 0 && (
          <div className="mt-3 border-t border-line pt-3">
            <div className="t-eyebrow mb-1 !text-warn">Decisive information absent from the deck</div>
            <ul className="space-y-1 text-[12.5px]">
              {na.absentDecisiveInformation.map((a, i) => (
                <li key={i}>
                  <span className="font-medium text-ink">{a.what}</span> <span className="text-ink-3">— {a.whyItMatters}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
        <Block title="Chart forensics" aside="model-read visuals">
          {f.chartForensics.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {f.chartForensics.map((x, i) => (
                <li key={i} className="py-1.5 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Sev s={x.severity} />
                    <span className="font-medium text-ink">{titleCase(x.issue)}</span>
                    <Pages pages={[x.page]} slug={slug} docId={docId} />
                  </div>
                  <p className="text-ink-2">{x.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">No chart issue noticed{f.visualElements.length ? ` in ${f.visualElements.length} visual element${f.visualElements.length === 1 ? "" : "s"} read` : ""}.</p>
          )}
          {f.visualElements.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-ink-3 hover:text-ink">What the visuals actually show ({f.visualElements.length})</summary>
              <ul className="mt-1 space-y-1">
                {f.visualElements.map((v, i) => (
                  <li key={i} className="text-ink-2">
                    <Badge tone="neutral">{titleCase(v.kind)}</Badge> {v.readout} <Pages pages={[v.page]} slug={slug} docId={docId} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Block>

        <Block title="Product proof" aside="how far the product is shown to work">
          <div className="flex flex-wrap items-center gap-1">
            {PROOF_ORDER.map((p, i) => (
              <span key={p} className={cx("rounded px-1.5 py-[1px] text-[11px]", i === proofIdx ? "bg-ink font-medium text-bg" : i < proofIdx ? "bg-surface-3 text-ink-2" : "bg-surface-2 text-ink-3")}>
                {titleCase(p)}
              </span>
            ))}
            {proofIdx < 0 && <Badge tone={PROOF_TONE.UNKNOWN}>Unknown</Badge>}
          </div>
          <p className="mt-2 text-[12.5px] text-ink-2">{f.productProof.evidence}</p>
        </Block>

        <Block title="Founder slide, read skeptically">
          {f.founderSlideSkepticism.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {f.founderSlideSkepticism.map((x, i) => (
                <li key={i} className="py-1.5 text-[12.5px]">
                  <div className="font-medium text-ink">
                    {x.founder}: “{x.statement}”
                  </div>
                  <div className="text-ink-2">Actually shows: {x.whatItActuallyShows}</div>
                  <div className="text-warn">Gap: {x.gap}</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">Nothing noted.</p>
          )}
        </Block>

        <Block title="Competitive slide, reverse-engineered">
          {f.competitiveSlide ? (
            <dl className="space-y-1.5 text-[12.5px]">
              <div>
                <dt className="text-ink-3">Axes chosen</dt>
                <dd className="text-ink-2">{f.competitiveSlide.axesChosen}</dd>
              </div>
              <div>
                <dt className="text-ink-3">Why they favor the company</dt>
                <dd className="text-ink-2">{f.competitiveSlide.whyTheyFavorTheCompany}</dd>
              </div>
              <div>
                <dt className="text-ink-3">An honest comparison</dt>
                <dd className="font-medium text-ink">{f.competitiveSlide.honestComparison}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-[12.5px] text-ink-3">No competitive slide in the deck.</p>
          )}
        </Block>

        <Block title="Market slide consistency">
          <p className="text-[12.5px] text-ink-2">{f.marketSlide.coherence}</p>
          {f.marketSlide.issues.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-warn">
              {f.marketSlide.issues.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Narrative vs. evidence">
          {f.narrativeInconsistencies.length ? (
            <ul className="divide-y divide-line border-y border-line">
              {f.narrativeInconsistencies.map((x, i) => (
                <li key={i} className="py-1.5 text-[12.5px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Sev s={x.severity} />
                    <span className="text-ink">
                      Presented as <b className="font-medium">{x.presentedAs}</b>; evidence suggests <b className="font-medium">{x.evidenceSuggests}</b>
                    </span>
                  </div>
                  <p className="text-ink-3">{x.detail}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-ink-3">No mismatch noticed between how the company is presented and what the evidence suggests.</p>
          )}
        </Block>
      </div>

      {f.claimChecks.length > 0 && (
        <Block title="Marketing claims turned into testable propositions">
          <div className="grid gap-3 md:grid-cols-2">
            {f.claimChecks.map((x, i) => (
              <div key={i} className="border-l-2 border-line-strong pl-3 text-[12.5px]">
                <div className="font-medium text-ink">“{x.claim}”</div>
                <div className="text-ink-2">{x.proposition}</div>
                <div className="mt-0.5 text-ok">Verifies: {x.wouldVerify}</div>
                <div className="text-risk">Falsifies: {x.wouldFalsify}</div>
              </div>
            ))}
          </div>
        </Block>
      )}

      <Block title="Reasoning quality in the deck" aside="secondary signals — never about visual polish">
        <dl className="grid gap-x-8 gap-y-2 text-[12.5px] md:grid-cols-3">
          <div>
            <dt className="text-ink-3">Precision</dt>
            <dd className="text-ink-2">{f.deckQualitySignals.precision}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Number mastery</dt>
            <dd className="text-ink-2">{f.deckQualitySignals.numberMastery}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Customer understanding</dt>
            <dd className="text-ink-2">{f.deckQualitySignals.customerUnderstanding}</dd>
          </div>
        </dl>
      </Block>
    </div>
  );
}

export function PerfectSlides({ c, r }: { c: CanonicalDeal; r: IntegrityReport | null }) {
  const computed = r?.expectedEvidence.perfectSlides ?? [];
  const model = c.perfectSlides;
  if (!computed.length && !model.length) return <p className="text-[13px] text-ink-3">No missing evidence produced a perfect-slide request.</p>;
  return (
    <div className="space-y-3">
      <Rule>The exact slide that would close each evidence gap — a ready-made data request for the founder.</Rule>
      <ol className="grid gap-3 md:grid-cols-2">
        {model.map((p, i) => (
          <li key={`m${i}`} className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Origin o="MODEL" />
              <span className="text-[12.5px] font-medium text-ink">Missing: {p.missing}</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-2">{p.slide}</p>
          </li>
        ))}
        {computed.map((p) => (
          <li key={p.itemId} className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Origin o="COMPUTED" />
              <span className="text-[12.5px] font-medium text-ink">Missing: {p.label}</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-ink-2">{p.slide}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AlternativeExplanations({ c, slug }: { c: CanonicalDeal; slug: string }) {
  if (!c.alternativeExplanations.length) return <p className="text-[13px] text-ink-3">No alternative explanations were produced for this version.</p>;
  return (
    <div className="space-y-2">
      <Rule>Every positive signal has a non-bullish reading. The discriminating test says which data tells them apart.</Rule>
      <ul className="divide-y divide-line border-y border-line">
        {c.alternativeExplanations.map((x, i) => (
          <li key={i} className="grid gap-x-6 gap-y-1 py-2.5 text-[12.5px] md:grid-cols-[1fr_1fr_1fr_1.1fr]">
            <div className="font-medium text-ink">
              <RichText text={x.signal} slug={slug} />
            </div>
            <div>
              <span className="text-ok">Bullish · </span>
              <span className="text-ink-2">{x.bullishReading}</span>
            </div>
            <div>
              <span className="text-warn">Alternative · </span>
              <span className="text-ink-2">{x.alternativeReading}</span>
            </div>
            <div>
              <span className="text-ink-3">Test · </span>
              <span className="text-ink">{x.discriminatingTest}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
