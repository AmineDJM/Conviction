"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import { RETURN_SCENARIOS, type ReturnScenarioName } from "@/domain/enums";
import { backwardsReturn, buildReturnInputs, entryTermsFromDeal, priceSensitivity, runReturnModel, type ReturnInputs } from "@/engine/returns";
import { getRegistry } from "@/engine/benchmarks";
import { arpaFor } from "@/engine/derive";
import { unifiedReturnModel } from "@/engine/unified-returns";
import { Badge, Button, Callout, Section, Td, Th, cx } from "@/components/ui";
import { multiple, pct, titleCase, usd, type Tone } from "@/lib/format";

type ExitMode = "EQUITY" | "REV_MULT";
interface ExitOverride {
  mode: ExitMode;
  equityUsd: number;
  revenueUsd: number | null;
  multiple: number | null;
  years: number;
}

const SCENARIO_LABEL: Record<ReturnScenarioName, string> = { FAILURE: "Failure", LOW: "Low", BASE: "Base", BULL: "Bull", OUTLIER: "Outlier" };

const PLAUSIBILITY_TONE: Record<string, Tone> = { PLAUSIBLE: "ok", DEMANDING: "warn", HEROIC: "risk", IMPLAUSIBLE: "risk", UNKNOWN: "unknown" };

export interface ReturnModelProps {
  deal: CanonicalDeal;
  fund: FundProfile;
  registryId: string;
  /** Stored inputs of the analysis version — the model starts exactly there. */
  stored: ReturnInputs;
  samHighUsd: number | null;
  samMethod: string | null;
  versionNo: number;
  fundChanged: boolean;
}

export function ReturnModelView({ deal, fund, registryId, stored, samHighUsd, samMethod, versionNo, fundChanged }: ReturnModelProps) {
  const registry = useMemo(() => getRegistry(registryId), [registryId]);
  const deckEntry = useMemo(() => entryTermsFromDeal(deal, registry), [deal, registry]);
  const arpa = useMemo(() => arpaFor(deal), [deal]);

  const [checkUsd, setCheckUsd] = useState(stored.checkUsd);
  const [postUsd, setPostUsd] = useState<number | null>(stored.entry.postMoneyUsd);
  const [followOn, setFollowOn] = useState(stored.followOn);
  const [dilution, setDilution] = useState<number[]>(stored.futureRounds.map((r) => r.dilutionPct));
  const [exitOv, setExitOv] = useState<Partial<Record<ReturnScenarioName, ExitOverride>>>({});
  const [targetUsd, setTargetUsd] = useState(fund.targetDealReturnUsd);

  const dirty =
    checkUsd !== stored.checkUsd ||
    postUsd !== stored.entry.postMoneyUsd ||
    followOn !== stored.followOn ||
    dilution.some((d, i) => d !== stored.futureRounds[i]?.dilutionPct) ||
    Object.keys(exitOv).length > 0 ||
    targetUsd !== fund.targetDealReturnUsd;

  const reset = () => {
    setCheckUsd(stored.checkUsd);
    setPostUsd(stored.entry.postMoneyUsd);
    setFollowOn(stored.followOn);
    setDilution(stored.futureRounds.map((r) => r.dilutionPct));
    setExitOv({});
    setTargetUsd(fund.targetDealReturnUsd);
  };

  const inputs = useMemo(() => {
    const exits: Partial<ReturnInputs["exits"]> = {};
    for (const [s, o] of Object.entries(exitOv) as [ReturnScenarioName, ExitOverride][]) {
      const eq = o.mode === "REV_MULT" && o.revenueUsd !== null && o.multiple !== null ? o.revenueUsd * o.multiple : o.equityUsd;
      exits[s] = {
        exitEquityUsd: Math.max(0, eq),
        years: o.years,
        basis: o.mode === "REV_MULT" ? `User input: ${usd(o.revenueUsd)} revenue × ${o.multiple}×` : `User input: ${usd(eq)} exit equity value`,
      };
    }
    return buildReturnInputs(deal, registry, fund, {
      checkUsd,
      followOn,
      postMoneyUsd: postUsd !== null && postUsd !== deckEntry.postMoneyUsd ? postUsd : undefined,
      futureRounds: stored.futureRounds.map((r, i) => ({ ...r, dilutionPct: dilution[i] ?? r.dilutionPct })),
      exits,
    });
  }, [deal, registry, fund, checkUsd, followOn, postUsd, deckEntry.postMoneyUsd, stored.futureRounds, dilution, exitOv]);

  // Same engine as the stored analysis: headline scenarios come from the pro-forma cap table.
  const model = useMemo(
    () => unifiedReturnModel(runReturnModel(inputs, registry, fund), { deal, registry, fund, market: { primary: samHighUsd ? ({ highUsd: samHighUsd } as never) : null } }).model,
    [inputs, registry, fund, deal, samHighUsd],
  );
  const base = model.scenarios.find((s) => s.scenario === "BASE");
  // Same convention as the stored analysis: a fund-returning outcome follows the outlier path.
  const outcome = model.scenarios.find((s) => s.scenario === "OUTLIER") ?? base;
  const backwards = useMemo(
    () => (outcome ? backwardsReturn(targetUsd, outcome.exitOwnershipPct, registry, arpa, samHighUsd) : null),
    [outcome, targetUsd, registry, arpa, samHighUsd],
  );
  const sensitivity = useMemo(() => priceSensitivity(inputs, registry), [inputs, registry]);
  const midIdx = Math.floor(registry.returns.backwardsRevenueMultiples.length / 2);
  const isSafe = inputs.entry.instrument === "SAFE" || inputs.entry.instrument === "CONVERTIBLE_NOTE";

  const exitRow = (s: ReturnScenarioName): ExitOverride => {
    const cur = inputs.exits[s];
    const a = deal.exitAssumptions.find((x) => x.scenario === s);
    const ov = exitOv[s];
    if (ov) return ov;
    const hasRm = a?.exitRevenueUsd != null && a?.revenueMultiple != null;
    return { mode: hasRm ? "REV_MULT" : "EQUITY", equityUsd: cur.exitEquityUsd, revenueUsd: a?.exitRevenueUsd ?? null, multiple: a?.revenueMultiple ?? null, years: cur.years };
  };
  const patchExit = (s: ReturnScenarioName, patch: Partial<ExitOverride>) => {
    const cur = exitRow(s);
    let next = { ...cur, ...patch };
    if (patch.mode === "REV_MULT" && (next.revenueUsd === null || next.multiple === null)) {
      const m = next.multiple ?? 5;
      next = { ...next, multiple: m, revenueUsd: cur.equityUsd / m };
    }
    if (patch.mode === "EQUITY") next.equityUsd = inputs.exits[s].exitEquityUsd;
    setExitOv((o) => ({ ...o, [s]: next }));
  };

  return (
    <div className="space-y-10">
      {/* Controls */}
      <Section
        eyebrow="Return model · deterministic engine running in your browser"
        title="Deal terms and path assumptions"
        action={
          <div className="flex items-center gap-2">
            {dirty ? <Badge tone="warn">Modified — not saved</Badge> : <Badge tone="neutral">Analysis defaults · v{versionNo}</Badge>}
            <Button size="sm" variant="ghost" onClick={reset} disabled={!dirty}>
              Reset
            </Button>
          </div>
        }
      >
        <div className="grid gap-x-8 gap-y-5 border-y border-line py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Control label="Initial check" hint={`Fund default ${usd(fund.initialCheckDefaultUsd)} · round ${usd(inputs.entry.raiseUsd)}`}>
            <NumField value={checkUsd} onChange={setCheckUsd} scale={1e6} prefix="$" suffix="M" step={0.25} min={0.01} ariaLabel="Initial check in millions" />
          </Control>
          <Control
            label={isSafe ? "Entry valuation cap" : "Entry post-money"}
            hint={
              deckEntry.postMoneyUsd ? (
                <>
                  Deck {usd(deckEntry.postMoneyUsd)} {isSafe ? "cap" : "post"}
                  {postUsd !== deckEntry.postMoneyUsd && (
                    <button className="ml-1.5 text-accent-text hover:underline" onClick={() => setPostUsd(deckEntry.postMoneyUsd)}>
                      use
                    </button>
                  )}
                </>
              ) : (
                "Not disclosed in deck — enter a price to model"
              )
            }
          >
            <NumField value={postUsd} onChange={setPostUsd} scale={1e6} prefix="$" suffix="M" step={1} min={0.1} ariaLabel="Entry post-money in millions" />
          </Control>
          <Control label="Follow-on" hint={followOn ? `Pro rata next round, reserves ${usd(inputs.reserveUsd)} (${fund.reserveRatio}× check)` : "Initial check only"}>
            <Segmented
              value={followOn ? "on" : "off"}
              options={[
                { v: "on", label: "Pro rata" },
                { v: "off", label: "None" },
              ]}
              onChange={(v) => setFollowOn(v === "on")}
            />
          </Control>
          <Control label="Target fund contribution" hint={`For backwards analysis · fund ${usd(fund.fundSizeUsd)}`}>
            <NumField value={targetUsd} onChange={setTargetUsd} scale={1e6} prefix="$" suffix="M" step={5} min={1} ariaLabel="Target contribution in millions" />
          </Control>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <div className="t-eyebrow w-full sm:w-auto sm:pb-1.5">Dilution per future round</div>
          {inputs.futureRounds.map((r, i) => (
            <label key={r.name} className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <span className="whitespace-nowrap">{r.name}</span>
              <span className="w-[76px]">
                <NumField
                  value={dilution[i] ?? r.dilutionPct}
                  onChange={(v) => setDilution((d) => d.map((x, j) => (j === i ? Math.min(90, v) : x)))}
                  suffix="%"
                  step={1}
                  min={0}
                  ariaLabel={`${r.name} dilution percent`}
                />
              </span>
              <span className="num text-[11.5px] text-ink-3">{r.stepUp}× step-up</span>
            </label>
          ))}
        </div>
      </Section>

      {/* Exit assumptions */}
      <Section eyebrow="Exit assumptions" title="Company value at exit, per scenario">
        <div className="-mx-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-[13px]">
            <thead>
              <tr>
                <Th className="w-[92px]">Scenario</Th>
                <Th className="w-[150px]">Basis</Th>
                <Th align="right" className="w-[112px]">Exit revenue</Th>
                <Th align="right" className="w-[92px]">Multiple</Th>
                <Th align="right" className="w-[124px]">Exit equity</Th>
                <Th align="right" className="w-[84px]">Years</Th>
                <Th>Rationale</Th>
              </tr>
            </thead>
            <tbody>
              {RETURN_SCENARIOS.map((s) => {
                const r = exitRow(s);
                const cur = inputs.exits[s];
                return (
                  <tr key={s} className={cx(exitOv[s] && "bg-accent-soft/30")}>
                    <Td className="font-medium">{SCENARIO_LABEL[s]}</Td>
                    <Td>
                      <Segmented
                        small
                        value={r.mode}
                        options={[
                          { v: "EQUITY", label: "Equity" },
                          { v: "REV_MULT", label: "Rev × mult" },
                        ]}
                        onChange={(v) => patchExit(s, { mode: v as ExitMode })}
                      />
                    </Td>
                    <Td align="right">
                      {r.mode === "REV_MULT" ? (
                        <NumField value={r.revenueUsd} onChange={(v) => patchExit(s, { revenueUsd: v })} scale={1e6} prefix="$" suffix="M" step={5} min={0} ariaLabel={`${s} exit revenue`} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.mode === "REV_MULT" ? (
                        <NumField value={r.multiple} onChange={(v) => patchExit(s, { multiple: v })} suffix="×" step={0.5} min={0} ariaLabel={`${s} revenue multiple`} />
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </Td>
                    <Td align="right">
                      {r.mode === "EQUITY" ? (
                        <NumField value={cur.exitEquityUsd} onChange={(v) => patchExit(s, { equityUsd: v })} scale={1e6} prefix="$" suffix="M" step={10} min={0} ariaLabel={`${s} exit equity`} />
                      ) : (
                        <span className="num font-medium">{usd(cur.exitEquityUsd)}</span>
                      )}
                    </Td>
                    <Td align="right">
                      <NumField value={cur.years} onChange={(v) => patchExit(s, { years: Math.max(0.5, v) })} suffix="y" step={0.5} min={0.5} ariaLabel={`${s} years to exit`} />
                    </Td>
                    <Td className="text-[12px] leading-snug text-ink-3">
                      <span className="line-clamp-2" title={cur.basis}>
                        {cur.basis}
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Outcomes */}
      <Section
        eyebrow="Scenario outcomes"
        title="What we invest, own and get back"
        action={<span className="text-[12px] text-ink-3">Scenarios are not probability-weighted. Gross, before fees and carry.</span>}
      >
        {model.warnings.length > 0 && (
          <div className="mb-3">
            <Callout tone="warn" title="Model warnings">
              <ul className="list-disc space-y-0.5 pl-4">
                {model.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        {model.modelable ? (
          <div className="-mx-3 overflow-x-auto">
            <table className="w-full min-w-[980px] text-[13px]">
              <thead>
                <tr>
                  <Th>Scenario</Th>
                  <Th align="right">Exit equity</Th>
                  <Th align="right">Invested</Th>
                  <Th align="right">of which follow-on</Th>
                  <Th align="right">Entry own.</Th>
                  <Th align="right">Exit own.</Th>
                  <Th align="right">Proceeds</Th>
                  <Th align="right">Gross MOIC</Th>
                  <Th align="right">Gross IRR</Th>
                  <Th>Preference</Th>
                  <Th align="right">% of fund</Th>
                </tr>
              </thead>
              <tbody>
                {model.scenarios.map((r) => (
                  <tr key={r.scenario} className={cx(r.scenario === "BASE" && "bg-surface-2/60")}>
                    <Td>
                      <div className="font-medium">{SCENARIO_LABEL[r.scenario]}</div>
                      <div className="num text-[11.5px] text-ink-3">
                        {r.years} yrs · {r.roundsRaised} round{r.roundsRaised === 1 ? "" : "s"} before exit
                      </div>
                    </Td>
                    <Td align="right">{usd(r.exitEquityUsd)}</Td>
                    <Td align="right">{usd(r.investedUsd, 2)}</Td>
                    <Td align="right" className="text-ink-3">
                      {r.followOnUsd > 0 ? usd(r.followOnUsd, 2) : "—"}
                    </Td>
                    <Td align="right">{pct(r.entryOwnershipPct, 2)}</Td>
                    <Td align="right">{pct(r.exitOwnershipPct, 2)}</Td>
                    <Td align="right" className="font-medium">
                      {usd(r.proceedsUsd, 2)}
                    </Td>
                    <Td align="right" className={cx("font-semibold", (r.grossMoic ?? 0) >= 10 ? "text-ok" : (r.grossMoic ?? 0) < 1 ? "text-risk" : "text-ink")}>
                      {multiple(r.grossMoic, 1)}
                    </Td>
                    <Td align="right">{irrText(r.grossIrr)}</Td>
                    <Td>
                      {r.preferenceBinding ? (
                        <Badge tone="warn" title={`Liquidation preference pays more than converting (${usd(r.proceedsUsd, 2)} vs ${usd(r.proceedsIfConvertedUsd, 2)} as common).`}>
                          Binding
                        </Badge>
                      ) : (
                        <span className="text-[12px] text-ink-3">Converts</span>
                      )}
                    </Td>
                    <Td align="right">{r.fundContributionPctOfFund !== null ? pct(r.fundContributionPctOfFund, r.fundContributionPctOfFund < 10 ? 1 : 0) : "—"}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-ink-3">Enter an entry valuation above to run the scenarios.</p>
        )}
        <p className="mt-3 max-w-[900px] text-[12px] leading-relaxed text-ink-3">
          Ownership = check ÷ {isSafe ? "valuation cap (SAFE / note converts at the cap; a discount could only increase ownership)" : "post-money valuation"}. No cap table is modelled:
          existing option pool, pool top-ups{deal.financing?.optionPoolIncreasePct ? ` (${deal.financing.optionPoolIncreasePct}% stated)` : ""} and other holders are captured only through the
          post-money figure. Dilution then follows the future-round path above; follow-on buys pro rata in the next round only.
        </p>
      </Section>

      {/* Backwards + price sensitivity */}
      <div className="grid gap-10 xl:grid-cols-2">
        <Section eyebrow="Backwards return analysis" title={backwards ? `What must be true to return ${usd(backwards.targetContributionUsd, 0)}` : "Backwards return analysis"}>
          {backwards && base ? (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-y border-line py-3 sm:grid-cols-3">
                <Stat k="Base-case exit ownership" v={pct(backwards.exitOwnershipPct, 2)} />
                <Stat k="Required exit equity" v={usd(backwards.requiredExitEquityUsd, 2)} />
                <div>
                  <div className="text-[12px] text-ink-3">Plausibility</div>
                  <div className="mt-1">
                    <Badge tone={PLAUSIBILITY_TONE[backwards.plausibility]} dot>
                      {titleCase(backwards.plausibility)}
                    </Badge>
                  </div>
                </div>
              </div>
              <table className="mt-2 w-full text-[13px]">
                <thead>
                  <tr>
                    <Th className="!px-0">Revenue multiple</Th>
                    <Th align="right">Required revenue</Th>
                    <Th align="right">Required customers</Th>
                    <Th align="right" className="!pr-0">
                      Share of SAM
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {backwards.byMultiple.map((b, i) => (
                    <tr key={b.revenueMultiple} className={cx(i === midIdx && "font-medium")}>
                      <Td className="!px-0">
                        <span className="num">{b.revenueMultiple}×</span>
                        {i === midIdx && <span className="ml-2 text-[11px] font-normal text-ink-3">sets the label</span>}
                      </Td>
                      <Td align="right">{usd(b.requiredRevenueUsd, 0)}</Td>
                      <Td align="right">{b.requiredCustomers !== null ? b.requiredCustomers.toLocaleString("en-US") : "—"}</Td>
                      <Td align="right" className="!pr-0">
                        {b.samSharePct !== null ? pct(b.samSharePct, 1) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 space-y-1 text-[12px] text-ink-3">
                <div>
                  <dt className="inline">Revenue per customer: </dt>
                  <dd className="inline text-ink-2">
                    {backwards.arpaUsd !== null ? `${usd(backwards.arpaUsd)} / yr` : "unavailable"} — source: {backwards.arpaSource}
                  </dd>
                </div>
                <div>
                  <dt className="inline">Reconstructed SAM (upper bound): </dt>
                  <dd className="inline text-ink-2">
                    {samHighUsd !== null ? usd(samHighUsd) : "unavailable"}
                    {samMethod && ` · ${titleCase(samMethod)} method`}
                  </dd>
                </div>
                <div>
                  Label thresholds (share of SAM at {registry.returns.backwardsRevenueMultiples[midIdx]}×): plausible ≤ {registry.returns.samSharePlausibility.PLAUSIBLE}%, demanding ≤{" "}
                  {registry.returns.samSharePlausibility.DEMANDING}%, heroic ≤ {registry.returns.samSharePlausibility.HEROIC}%, above that implausible.
                </div>
              </dl>
              <p className="mt-3 text-[13px] text-ink-2">{backwards.explanation}</p>
            </>
          ) : (
            <p className="text-ink-3">Needs a modelable base case (entry valuation) to run.</p>
          )}
        </Section>

        <Section eyebrow="Price sensitivity" title="Maximum entry valuation for a target multiple">
          <table className="w-full text-[13px]">
            <thead>
              <tr>
                <Th className="!px-0">Scenario</Th>
                {registry.returns.priceSensitivityTargets.map((t) => (
                  <Th key={t} align="right">
                    {t}× gross
                  </Th>
                ))}
                <Th align="right" className="!pr-0">
                  At current
                </Th>
              </tr>
            </thead>
            <tbody>
              {sensitivity.map((row) => (
                <tr key={row.scenario}>
                  <Td className="!px-0">
                    <div className="font-medium">{SCENARIO_LABEL[row.scenario]}</div>
                    <div className="num text-[11.5px] text-ink-3">
                      {usd(row.exitEquityUsd)} exit · {pct(row.cumulativeDilutionPct, 0)} dilution
                    </div>
                  </Td>
                  {row.maxPostMoneyByTarget.map((m) => {
                    const clears = inputs.entry.postMoneyUsd !== null && inputs.entry.postMoneyUsd <= m.maxPostMoneyUsd;
                    return (
                      <Td key={m.targetMoic} align="right" className={cx(clears ? "text-ok" : "text-ink-2")}>
                        <span title={clears ? "Current entry price is at or below this maximum" : "Current entry price is above this maximum"}>
                          {clears && <span aria-label="clears">✓ </span>}
                          {usd(m.maxPostMoneyUsd)}
                        </span>
                      </Td>
                    );
                  })}
                  <Td align="right" className="!pr-0 font-semibold">
                    {multiple(row.currentImpliedMoic, 1)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
          <PriceBars rows={sensitivity} current={inputs.entry.postMoneyUsd} isSafe={isSafe} />
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Current {isSafe ? "cap" : "post-money"}: <span className="num text-ink-2">{usd(inputs.entry.postMoneyUsd)}</span>. ✓ marks targets the current price clears. Initial check only, ignoring
            preferences (valid when the exit is large relative to the preference stack): max post = (1 − dilution) × exit ÷ target.
          </p>
        </Section>
      </div>

      {/* Assumptions */}
      <Section eyebrow="Model assumptions" title="Everything the numbers depend on">
        <ul className="grid gap-x-10 gap-y-1.5 text-[13px] text-ink-2 md:grid-cols-2">
          {model.assumptions.map((a) => (
            <li key={a} className="flex gap-2.5">
              <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
              <span>{a}</span>
            </li>
          ))}
          <li className="flex gap-2.5">
            <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
            <span>
              Entry terms source: {inputs.entry.source === "USER" ? "user override (this session)" : inputs.entry.source === "DECK" ? "deck" : "missing"}; liquidation preference{" "}
              {deal.financing?.terms.liquidationPreferenceMultiple != null ? "as disclosed" : `not disclosed — registry default ${registry.returns.defaultLiquidationPrefMultiple}×`}.
            </span>
          </li>
          <li className="flex gap-2.5">
            <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
            <span>
              Benchmark registry <span className="font-mono text-[11.5px]">{registry.id}</span>; fund profile “{fund.name}”{fundChanged && " (changed since this analysis was computed)"}.
            </span>
          </li>
        </ul>
      </Section>
    </div>
  );
}

/** Horizontal comparison: current price vs the 10× ceiling per scenario, on a shared log scale. */
function PriceBars({ rows, current, isSafe }: { rows: ReturnType<typeof priceSensitivity>; current: number | null; isSafe: boolean }) {
  if (!current || rows.length === 0) return null;
  const vals = rows.flatMap((r) => r.maxPostMoneyByTarget.map((m) => m.maxPostMoneyUsd)).concat(current).filter((v) => v > 0);
  const lo = Math.log10(Math.min(...vals) / 1.5);
  const hi = Math.log10(Math.max(...vals) * 1.5);
  const x = (v: number) => `${Math.min(96, Math.max(4, ((Math.log10(Math.max(v, 1)) - lo) / (hi - lo)) * 100))}%`;
  return (
    <div className="mt-4" aria-label="Price sensitivity chart">
      <div className="relative space-y-2.5 py-1">
        {rows.map((r) => (
          <div key={r.scenario} className="grid grid-cols-[60px_1fr] items-center gap-2">
            <span className="text-[11.5px] text-ink-3">{SCENARIO_LABEL[r.scenario]}</span>
            <div className="relative h-4">
              <div className="absolute inset-y-[7px] left-0 right-0 bg-line" />
              {r.maxPostMoneyByTarget.map((m) => (
                <div
                  key={m.targetMoic}
                  className="absolute top-0 flex h-4 -translate-x-1/2 items-center"
                  style={{ left: x(m.maxPostMoneyUsd) }}
                  title={`${m.targetMoic}× requires entry ≤ ${usd(m.maxPostMoneyUsd)}`}
                >
                  <span className="rounded-[3px] bg-surface-3 px-1 text-[10px] font-medium text-ink-2 ring-1 ring-line-strong">{m.targetMoic}×</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="pointer-events-none absolute inset-y-0 left-[68px] right-0">
          <div className="absolute inset-y-0 w-[2px] -translate-x-1/2 bg-accent" style={{ left: x(current) }} title={`Current ${usd(current)}`} />
        </div>
      </div>
      <div className="ml-[68px] mt-1 flex justify-between text-[10.5px] text-ink-3">
        <span className="num">{usd(10 ** lo)}</span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-[2px] translate-y-[1px] bg-accent" />
          current {isSafe ? "cap" : "post"} {usd(current)} · log scale
        </span>
        <span className="num">{usd(10 ** hi)}</span>
      </div>
    </div>
  );
}

function irrText(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  if (Math.abs(p) < 0.05) return "0.0%";
  return `${p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[12px] text-ink-3">{k}</div>
      <div className="num text-[17px] font-semibold tracking-tight">{v}</div>
    </div>
  );
}

function Control({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-medium text-ink-2">{label}</div>
      <div className="max-w-[200px]">{children}</div>
      {hint && <div className="mt-1 text-[11.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

function Segmented({ value, options, onChange, small }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void; small?: boolean }) {
  return (
    <div role="radiogroup" className={cx("inline-flex rounded-md border border-line bg-surface-2 p-[2px]", small ? "text-[11.5px]" : "text-[12.5px]")}>
      {options.map((o) => (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={value === o.v}
          onClick={() => onChange(o.v)}
          className={cx(
            "whitespace-nowrap rounded-[4px] px-2 transition-colors",
            small ? "h-6" : "h-7",
            value === o.v ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--line)]" : "text-ink-3 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Controlled numeric input in display units (value / scale). Keeps the last valid value while typing. */
function NumField({
  value,
  onChange,
  scale = 1,
  prefix,
  suffix,
  step = 1,
  min,
  ariaLabel,
}: {
  value: number | null;
  onChange: (v: number) => void;
  scale?: number;
  prefix?: string;
  suffix?: string;
  step?: number;
  min?: number;
  ariaLabel: string;
}) {
  const fmt = (v: number | null) => (v === null ? "" : String(Math.round((v / scale) * 100) / 100));
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  // Adopt external changes (reset, mode switch) during render — not in an effect.
  if (seen !== value) {
    setSeen(value);
    const parsed = parseFloat(text);
    if (value === null ? text !== "" : !(Number.isFinite(parsed) && Math.abs(parsed * scale - value) < scale * 0.005)) setText(fmt(value));
  }
  return (
    <div className="flex h-7 items-center rounded-md border border-line bg-surface px-2 text-[13px] focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/15">
      {prefix && <span className="mr-0.5 text-ink-3">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        step={step}
        min={min}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n) && (min === undefined || n >= min)) onChange(n * scale);
        }}
        onBlur={() => setText(fmt(value))}
        className="num w-full min-w-0 bg-transparent text-right text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {suffix && <span className="ml-0.5 text-ink-3">{suffix}</span>}
    </div>
  );
}
