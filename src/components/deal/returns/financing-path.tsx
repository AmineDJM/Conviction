import type { ReactNode } from "react";
import type { CanonicalDeal } from "@/domain/canonical";
import type { FinancingMap } from "@/engine/financing";
import type { Money } from "@/domain/money";
import { Badge, Section, Td, Th, cx } from "@/components/ui";
import { RichText } from "@/components/deal/rich-text";
import { levelTone, titleCase, usd } from "@/lib/format";
import { enumLabel } from "@/reports/text";

const nd = <span className="text-ink-3">Not disclosed</span>;

function money(m: Money | null | undefined) {
  if (!m || m.amount === null) return m?.rawText ? <span className="text-ink-2">{m.rawText}</span> : nd;
  return (
    <span className="num">
      {m.currency === "USD" ? usd(m.amount, 2) : `${m.currency} ${(m.amount / 1e6).toFixed(2)}M`}
      {m.rawText && <span className="ml-1.5 text-[11.5px] text-ink-3">“{m.rawText}”</span>}
    </span>
  );
}

const mo = (n: number | null) => (n === null ? "—" : `${n.toFixed(n < 10 ? 1 : 0)} mo`);

/**
 * §43–44 Financing path: capital-to-milestone timeline, runway, delay
 * scenarios, proof purchased and the round's terms. All numbers from
 * derived.financing; narrative from canonical.financingPath.
 */
export function FinancingPath({ c, f, slug, leadMonths }: { c: CanonicalDeal; f: FinancingMap; slug: string; leadMonths: number }) {
  const fin = c.financing;
  const path = c.financingPath;
  const t = fin?.terms;
  const isSafe = fin?.instrument === "SAFE" || fin?.instrument === "CONVERTIBLE_NOTE";

  return (
    <div className="space-y-10">
      <Section
        eyebrow="Financing path"
        title="Can the company finance the journey to its next proof?"
        action={
          <Badge tone={f.risk === "UNKNOWN" ? "unknown" : levelTone(f.risk)} dot>
            Financing risk: {titleCase(f.risk)}
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-y border-line py-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fig k="Cash today" v={usd(f.cashUsd, 2)} />
          <Fig k="This round" v={usd(f.raiseUsd, 2)} />
          <Fig k="Monthly burn" v={f.monthlyBurnUsd ? usd(f.monthlyBurnUsd) : "—"} sub={f.burnSource === "UNKNOWN" ? "unknown" : `${f.burnSource.toLowerCase()} burn`} />
          <Fig k="Runway after round" v={mo(f.runwayAfterRoundMonths)} />
          <Fig k="Needed to next close" v={mo(f.requiredMonths)} sub={f.milestoneMonths !== null ? `${f.milestoneMonths} mo milestone + ${leadMonths} mo raise` : "milestone timing unknown"} />
          <Fig
            k="Buffer"
            v={f.bufferMonths === null ? "—" : `${f.bufferMonths >= 0 ? "" : "−"}${Math.abs(f.bufferMonths).toFixed(1)} mo`}
            tone={f.bufferMonths === null ? undefined : f.bufferMonths < 0 ? "risk" : f.bufferMonths < 6 ? "warn" : "ok"}
          />
        </div>
        <p className="mt-3 max-w-[900px] text-[13px] text-ink-2">{f.explanation}</p>

        {f.runwayAfterRoundMonths !== null ? <Timeline f={f} leadMonths={leadMonths} /> : null}

        {f.requiredMonths !== null && f.runwayAfterRoundMonths !== null && (
          <div className="-mx-3 mt-6 overflow-x-auto">
            <table className="w-full min-w-[640px] text-[13px]">
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th align="right">Next round closes</Th>
                  <Th align="right">Cash out</Th>
                  <Th align="right">Shortfall</Th>
                  <Th align="right">Bridge needed</Th>
                  <Th>Outcome</Th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <Td className="font-medium">On plan</Td>
                  <Td align="right">month {f.requiredMonths.toFixed(0)}</Td>
                  <Td align="right">month {f.runwayAfterRoundMonths.toFixed(1)}</Td>
                  <Td align="right">{f.bufferMonths !== null && f.bufferMonths < 0 ? mo(-f.bufferMonths) : "—"}</Td>
                  <Td align="right">—</Td>
                  <Td>{f.bufferMonths !== null && f.bufferMonths < 0 ? <Badge tone="risk">Cash out before raise</Badge> : <span className="text-ink-2">Funded to the raise</span>}</Td>
                </tr>
                {f.delays.map((d) => (
                  <tr key={d.delayMonths}>
                    <Td className="font-medium">Milestone slips {d.delayMonths} months</Td>
                    <Td align="right">month {(f.requiredMonths! + d.delayMonths).toFixed(0)}</Td>
                    <Td align="right">month {f.runwayAfterRoundMonths!.toFixed(1)}</Td>
                    <Td align="right" className={cx(d.shortfallMonths > 0 && "text-risk")}>
                      {d.shortfallMonths > 0 ? mo(d.shortfallMonths) : "—"}
                    </Td>
                    <Td align="right" className={cx(d.bridgeNeededUsd > 0 && "font-medium")}>
                      {d.bridgeNeededUsd > 0 ? usd(d.bridgeNeededUsd, 1) : "—"}
                    </Td>
                    <Td>{d.cashOutBeforeRaise ? <Badge tone="risk">Cash out before raise</Badge> : <Badge tone="ok">Still funded</Badge>}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 px-3 text-[12px] text-ink-3">Bridge = shortfall months × monthly burn. Assumes burn stays at the {f.burnSource.toLowerCase()} rate and no revenue upside.</p>
          </div>
        )}
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section eyebrow="Proof purchased" title="What this round's capital should buy">
          {path ? (
            <div className="space-y-4 text-ink-2">
              <p className="text-ink">
                <RichText text={path.proofPurchased} slug={slug} />
              </p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-ink-3">
                <span>
                  Milestone in <span className="num text-ink-2">{path.milestoneMonths ?? "—"}</span> months
                </span>
                <span>
                  Capital intensity <Badge tone={levelTone(path.capitalIntensity)}>{titleCase(path.capitalIntensity)}</Badge>
                </span>
                {path.plannedMonthlyBurnUsd !== null && (
                  <span>
                    Planned burn <span className="num text-ink-2">{usd(path.plannedMonthlyBurnUsd)}</span>/mo
                  </span>
                )}
              </div>
              <div>
                <div className="t-eyebrow mb-1">Could it die while directionally right?</div>
                <p>
                  <RichText text={path.financingRiskAssessment} slug={slug} />
                </p>
              </div>
              {fin && fin.milestonesClaimed.length > 0 && (
                <div>
                  <div className="t-eyebrow mb-1">Milestones claimed by the company</div>
                  <ul className="space-y-0.5 text-[13px]">
                    {fin.milestonesClaimed.map((m, i) => (
                      <li key={i}>
                        {m.milestone}
                        {m.monthsFromNow !== null && <span className="num text-ink-3"> · {m.monthsFromNow} mo</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-ink-3">No financing path analysis in this version.</p>
          )}
        </Section>
        <Section eyebrow="Next round" title="Conditions and fallback">
          {path ? (
            <div className="space-y-4 text-ink-2">
              <div>
                <div className="t-eyebrow mb-1">Next-round conditions</div>
                <p>
                  <RichText text={path.nextRoundConditions} slug={slug} />
                </p>
              </div>
              <div>
                <div className="t-eyebrow mb-1">Fallback plans</div>
                <p>
                  <RichText text={path.fallbackPlans} slug={slug} />
                </p>
              </div>
            </div>
          ) : (
            <p className="text-ink-3">—</p>
          )}
        </Section>
      </div>

      <Section eyebrow="The round" title="Terms as disclosed">
        {fin ? (
          <div className="grid gap-x-12 md:grid-cols-2">
            <dl className="divide-y divide-line border-y border-line text-[13px]">
              <Row k="Instrument" v={enumLabel(fin.instrument)} />
              <Row k="Raise" v={money(fin.raiseAmount)} />
              <Row k="Pre-money" v={money(fin.preMoney)} />
              <Row k="Post-money" v={money(fin.postMoney)} />
              <Row k="Valuation cap" v={money(fin.valuationCap)} />
              <Row k="Discount" v={fin.discountPct !== null ? `${fin.discountPct}%` : nd} />
              <Row k="Option pool top-up" v={fin.optionPoolIncreasePct !== null ? `${fin.optionPoolIncreasePct}% of post` : nd} />
              <Row k="Lead investor" v={fin.leadInvestor ?? nd} />
              <Row k="Existing investors" v={fin.existingInvestors.length ? fin.existingInvestors.join(", ") : nd} />
              <Row k="Raised to date" v={money(fin.totalRaisedToDate)} />
              <Row k="Runway claimed" v={fin.runwayClaimMonths !== null ? `${fin.runwayClaimMonths} months (company claim)` : nd} />
            </dl>
            <dl className="divide-y divide-line border-y border-line text-[13px] max-md:mt-6 max-md:border-t-0">
              <Row k="Liquidation preference" v={t?.liquidationPreferenceMultiple != null ? `${t.liquidationPreferenceMultiple}×` : nd} />
              <Row k="Participation" v={t?.participating != null ? (t.participating ? "Participating" : "Non-participating") : nd} />
              <Row k="Anti-dilution" v={t?.antiDilution ?? nd} />
              <Row k="Board" v={t?.boardRights ?? nd} />
              <Row k="Information rights" v={t?.informationRights ?? nd} />
              <Row k="Pro rata" v={t?.proRata ?? nd} />
              <Row k="Protective provisions" v={t?.protectiveProvisions ?? nd} />
              <Row k="Drag / tag" v={t?.dragTag ?? nd} />
              <Row k="Redemption" v={t?.redemption ?? nd} />
              <Row k="Use of funds" v={fin.useOfFunds.length ? fin.useOfFunds.join(" · ") : nd} />
            </dl>
          </div>
        ) : (
          <p className="text-ink-3">No financing terms were extracted.</p>
        )}
        <p className="mt-3 max-w-[900px] text-[12px] text-ink-3">
          Ownership in the return model uses the {isSafe ? "valuation cap (the SAFE converts at the cap; any discount could only add ownership)" : "post-money valuation"}. Undisclosed preference
          terms are modelled as 1× non-participating, pari passu — an explicit model assumption, not a disclosed term.
        </p>
      </Section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="grid grid-cols-[160px_1fr] gap-3 py-1.5">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

function Fig({ k, v, sub, tone }: { k: string; v: string; sub?: string; tone?: "ok" | "warn" | "risk" }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{k}</div>
      <div className={cx("num text-[17px] font-semibold tracking-tight", tone === "risk" ? "text-risk" : tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink")}>{v}</div>
      {sub && <div className="text-[11.5px] text-ink-3">{sub}</div>}
    </div>
  );
}

/**
 * Month axis with the runway bar, the plan (build → raise) and the two
 * delay scenarios. Positions are months; labels carry the meaning.
 */
function Timeline({ f, leadMonths }: { f: FinancingMap; leadMonths: number }) {
  const runway = f.runwayAfterRoundMonths!;
  const req = f.requiredMonths;
  const maxDelay = Math.max(0, ...f.delays.map((d) => d.delayMonths));
  const span = Math.ceil(Math.max(runway, (req ?? 0) + maxDelay, 12) / 6) * 6 + 3;
  const x = (m: number) => `${(Math.max(0, Math.min(span, m)) / span) * 100}%`;
  const w = (a: number, b: number) => `${((Math.min(span, b) - Math.max(0, a)) / span) * 100}%`;
  const ticks = Array.from({ length: Math.floor(span / 6) + 1 }, (_, i) => i * 6);
  const milestone = f.milestoneMonths;

  return (
    <figure className="mt-6" aria-label="Capital-to-milestone timeline">
      <div className="relative space-y-3">
        {/* Events */}
        <Lane label="Events">
          {groupEvents(f.events.filter((e) => e.kind !== "ROUND")).map((g) => (
            <div key={g.month} className="absolute top-0 flex h-5 -translate-x-1/2 items-center gap-[3px]" style={{ left: x(g.month) }}>
              {g.items.map((e, i) => (
                <span
                  key={i}
                  title={`${e.label} · month ${e.month.toFixed(1)}`}
                  className={cx(
                    "h-2.5 w-2.5 rotate-45 ring-2 ring-bg",
                    e.kind === "CASH_OUT" ? "bg-risk" : e.kind === "MILESTONE" ? "bg-accent" : e.kind === "RAISE_START" ? "bg-ink-3" : "bg-ink",
                  )}
                />
              ))}
            </div>
          ))}
        </Lane>
        <Lane label="Cash runway" sub={`${usd((f.cashUsd ?? 0) + (f.raiseUsd ?? 0))} ÷ ${usd(f.monthlyBurnUsd)}/mo = ${runway.toFixed(1)} mo`}>
          <div className="absolute inset-y-[5px] rounded-[3px] bg-ink/75" style={{ left: 0, width: w(0, runway) }} />
          <EndLabel at={runway} span={span}>
            cash out · {runway.toFixed(1)} mo
          </EndLabel>
        </Lane>
        {milestone !== null && req !== null && (
          <Lane label="Plan" sub={`${milestone} mo build + ${leadMonths} mo raise`}>
            <div className="absolute inset-y-[5px] rounded-l-[3px] bg-accent/70" style={{ left: 0, width: w(0, milestone) }} title="Build to milestone" />
            <div
              className="absolute inset-y-[5px] rounded-r-[3px] border border-accent/60 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--accent-soft)_3px_6px)]"
              style={{ left: `calc(${x(milestone)} + 2px)`, width: `calc(${w(milestone, req)} - 2px)` }}
              title="Fundraising window"
            />
            <EndLabel at={req} span={span}>
              closes · {req} mo
            </EndLabel>
          </Lane>
        )}
        {milestone !== null &&
          req !== null &&
          f.delays.map((d) => {
            const end = req + d.delayMonths;
            return (
              <Lane
                key={d.delayMonths}
                label={`Slips ${d.delayMonths} months`}
                sub={d.cashOutBeforeRaise ? `${d.shortfallMonths.toFixed(1)} mo unfunded · bridge ${usd(d.bridgeNeededUsd)}` : "still funded"}
                subTone={d.cashOutBeforeRaise ? "risk" : undefined}
              >
                <div className="absolute inset-y-[5px] rounded-l-[3px] bg-line-strong" style={{ left: 0, width: w(0, Math.min(end, runway)) }} />
                {end > runway && (
                  <div
                    className="absolute inset-y-[5px] rounded-r-[3px] border border-risk/60 bg-[repeating-linear-gradient(135deg,transparent_0_3px,var(--risk-soft)_3px_6px)]"
                    style={{ left: `calc(${x(runway)} + 2px)`, width: `calc(${w(runway, end)} - 2px)` }}
                    title={`Unfunded: ${d.shortfallMonths.toFixed(1)} months`}
                  />
                )}

              </Lane>
            );
          })}

        {/* Cash-out rule */}
        <div className="pointer-events-none absolute inset-y-0 left-[124px] right-0 sm:left-[202px]">
          <div className="absolute inset-y-0 border-l border-dashed border-risk/60" style={{ left: x(runway) }} />
        </div>
      </div>

      {/* Axis */}
      <div className="mt-2 grid grid-cols-[112px_1fr] gap-3 sm:grid-cols-[190px_1fr]">
        <span className="text-[11px] text-ink-3">Months from today</span>
        <div className="relative h-4 border-t border-line">
          {ticks.map((m) => (
            <span key={m} className="num absolute top-0.5 -translate-x-1/2 text-[10.5px] text-ink-3" style={{ left: x(m) }}>
              {m}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11.5px] text-ink-3">
        <Legend cls="bg-ink rotate-45" label="Today — round closes" />
        <Legend cls="bg-accent rotate-45" label={`Milestone · month ${milestone ?? "—"}`} />
        <Legend cls="bg-ink-3 rotate-45" label="Start next raise" />
        <Legend cls="bg-risk rotate-45" label={`Cash out · month ${runway.toFixed(1)}`} />
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-4 border border-risk/60 bg-[repeating-linear-gradient(135deg,transparent_0_2px,var(--risk-soft)_2px_4px)]" />
          unfunded months
        </span>
      </figcaption>
    </figure>
  );
}

function Lane({ label, children, sub, subTone }: { label: string; sub?: string; subTone?: "risk"; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_1fr] items-center gap-3 sm:grid-cols-[190px_1fr]">
      <div className="leading-tight">
        <div className="text-[12px] text-ink-2">{label}</div>
        {sub && <div className={cx("num text-[11px]", subTone === "risk" ? "text-risk" : "text-ink-3")}>{sub}</div>}
      </div>
      <div className="relative h-5">{children}</div>
    </div>
  );
}

/** Label at the end of a bar; flips inside (right-anchored) near the right edge so it never overflows. */
function EndLabel({ at, span, tone, children }: { at: number; span: number; tone?: "risk"; children: ReactNode }) {
  const p = (Math.max(0, Math.min(span, at)) / span) * 100;
  const flip = p > 80;
  return (
    <span
      className={cx(
        "num absolute top-0 hidden whitespace-nowrap text-[11px] leading-5 sm:inline",
        flip ? "mr-1 rounded bg-bg/90 px-1" : "ml-1.5",
        tone === "risk" ? "text-risk" : "text-ink-2",
      )}
      style={flip ? { right: `${100 - p}%` } : { left: `${p}%` }}
    >
      {children}
    </span>
  );
}

function groupEvents(events: FinancingMap["events"]) {
  const out: { month: number; items: FinancingMap["events"] }[] = [];
  for (const e of events) {
    const g = out.find((x) => Math.abs(x.month - e.month) < 0.5);
    if (g) g.items.push(e);
    else out.push({ month: e.month, items: [e] });
  }
  return out;
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("inline-block h-2 w-2", cls)} />
      {label}
    </span>
  );
}
