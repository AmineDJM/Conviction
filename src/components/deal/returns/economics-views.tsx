/**
 * Institutional economics (stored derived.economics): pro-forma cap-table
 * returns, required operating trajectory and the decision sensitivity map.
 * Rendered from the stored report — the headline numbers match the rest of
 * the app because they come from the same cap-table engine.
 */
import type { CapTableReturns, CapTableScenario, EconomicsReport, SensitivityMap, TrajectoryResult } from "@/engine/economics";
import { Badge, cx } from "@/components/ui";
import { multiple, pct, titleCase, usd } from "@/lib/format";
import { Rule, Stat, SubHead, Table, Unknown } from "@/components/deal/v2/kit";
import { PLAUS_TONE, irrText, sensValue } from "./economics-format";

const th = "px-2 py-1.5 text-left text-[11px] font-medium text-ink-3 first:pl-0";
const td = "border-t border-line px-2 py-1.5 align-top first:pl-0";
const tdr = cx(td, "num text-right");

function Plaus({ p }: { p: string }) {
  return <Badge tone={PLAUS_TONE[p] ?? "neutral"}>{p === "UNKNOWN" ? "Unknown" : titleCase(p)}</Badge>;
}

/* ---------------------------------------------------------------- */
/* Cap-table returns                                                  */
/* ---------------------------------------------------------------- */

function OwnershipChart({ scenarios }: { scenarios: CapTableScenario[] }) {
  const shown = scenarios.filter((s) => s.scenario === "BASE" || s.scenario === "BULL" || s.scenario === "OUTLIER");
  const pts = shown.flatMap((s) => s.ownershipPath);
  if (!pts.length) return null;
  const maxM = Math.max(12, ...pts.map((p) => p.month));
  const maxP = Math.max(...pts.map((p) => p.pct)) * 1.1;
  const W = 560;
  const H = 150;
  const L = 36;
  const B = 20;
  const x = (m: number) => L + (m / maxM) * (W - L - 70);
  const y = (p: number) => 8 + (1 - p / maxP) * (H - B - 8);
  const stroke: Record<string, string> = { BASE: "var(--text)", BULL: "var(--accent)", OUTLIER: "var(--ok)" };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[640px]" role="img" aria-label="Our fully diluted ownership by month, per scenario">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={L} x2={W - 70} y1={y(maxP * f)} y2={y(maxP * f)} stroke="var(--line)" />
          <text x={L - 4} y={y(maxP * f) + 3} textAnchor="end" fontSize="10" fill="var(--text-3)">
            {(maxP * f).toFixed(1)}%
          </text>
        </g>
      ))}
      <text x={L} y={H - 4} fontSize="10" fill="var(--text-3)">
        month 0
      </text>
      <text x={W - 70} y={H - 4} fontSize="10" fill="var(--text-3)" textAnchor="end">
        month {maxM}
      </text>
      {shown.map((s) => {
        const path = s.ownershipPath;
        if (!path.length) return null;
        // Step line: ownership holds until the next round.
        let d = `M ${x(path[0]!.month)} ${y(path[0]!.pct)}`;
        for (let i = 1; i < path.length; i++) d += ` H ${x(path[i]!.month)} V ${y(path[i]!.pct)}`;
        const last = path[path.length - 1]!;
        return (
          <g key={s.scenario}>
            <path d={d} fill="none" stroke={stroke[s.scenario]} strokeWidth="1.5" />
            {path.map((p, i) => (
              <circle key={i} cx={x(p.month)} cy={y(p.pct)} r="2.2" fill={stroke[s.scenario]}>
                <title>{`${s.scenario} · ${p.label} · month ${p.month}: ${p.pct.toFixed(2)}%`}</title>
              </circle>
            ))}
            <text x={x(last.month) + 6} y={y(last.pct) + 3} fontSize="10" fill={stroke[s.scenario]}>
              {titleCase(s.scenario)} {last.pct.toFixed(1)}%
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function CapTableReturnsView({ ct }: { ct: CapTableReturns }) {
  if (!ct.modelable)
    return (
      <div className="rounded-md border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-3">
        Cap-table returns are not modelable for this deal: {ct.reasons.join("; ") || "entry terms unknown"}. Nothing is estimated in their place.
      </div>
    );
  const richest = [...ct.scenarios].sort((a, b) => b.rounds.length - a.rounds.length)[0];
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Stat k="Instrument" v={titleCase(ct.instrument)} />
        <Stat k="Entry ownership (FD, as-converted)" v={ct.entryOwnershipPct !== null ? pct(ct.entryOwnershipPct, 2) : <Unknown />} />
        <Stat k="Scenarios where our preference binds" v={ct.scenarios.filter((s) => s.preferenceBinding).map((s) => titleCase(s.scenario)).join(", ") || "none"} />
        <Stat k="Preference stack at exit (outlier path)" v={usd(ct.scenarios.find((s) => s.scenario === "OUTLIER")?.preferenceStackUsd ?? null)} />
      </div>

      <div>
        <SubHead aside="step line; hover a point for the round">Ownership path</SubHead>
        <OwnershipChart scenarios={ct.scenarios} />
      </div>

      {richest && richest.rounds.length > 0 && (
        <div>
          <SubHead aside={`${titleCase(richest.scenario)} path — the scenario with the most rounds`}>Rounds, dilution and preference stack</SubHead>
          <Table minWidth={820}>
            <thead>
              <tr>
                <th className={th}>Round</th>
                <th className={cx(th, "text-right")}>Month</th>
                <th className={cx(th, "text-right")}>Pre</th>
                <th className={cx(th, "text-right")}>Post</th>
                <th className={cx(th, "text-right")}>New money</th>
                <th className={cx(th, "text-right")}>Pool top-up</th>
                <th className={cx(th, "text-right")}>Our cash</th>
                <th className={cx(th, "text-right")}>Our FD %</th>
                <th className={cx(th, "text-right")}>Pref. stack</th>
              </tr>
            </thead>
            <tbody>
              {richest.rounds.map((r, i) => (
                <tr key={i}>
                  <td className={td}>
                    <span className="text-ink">{r.label}</span> <span className="text-[11px] text-ink-3">{titleCase(r.kind)}</span>
                    {r.convertedUsd > 0 && <div className="text-[11px] text-ink-3">converts {usd(r.convertedUsd)} of SAFEs/notes</div>}
                    {r.note && <div className="text-[11px] text-ink-3">{r.note}</div>}
                  </td>
                  <td className={tdr}>{r.month}</td>
                  <td className={tdr}>{usd(r.preMoneyUsd)}</td>
                  <td className={tdr}>{usd(r.postMoneyUsd)}</td>
                  <td className={tdr}>{usd(r.newMoneyUsd)}</td>
                  <td className={tdr}>{r.poolTopUpPctOfPost ? pct(r.poolTopUpPctOfPost, 1) : "—"}</td>
                  <td className={tdr}>{r.ourInvestmentUsd ? usd(r.ourInvestmentUsd) : "—"}</td>
                  <td className={tdr}>{pct(r.ourOwnershipPct, 2)}</td>
                  <td className={tdr}>{usd(r.preferenceStackUsd)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <div>
        <SubHead aside="every scenario through the full liquidation waterfall">Scenario outcomes</SubHead>
        <Table minWidth={820}>
          <thead>
            <tr>
              <th className={th}>Scenario</th>
              <th className={cx(th, "text-right")}>Exit equity</th>
              <th className={cx(th, "text-right")}>Rounds</th>
              <th className={cx(th, "text-right")}>Invested</th>
              <th className={cx(th, "text-right")}>Exit FD %</th>
              <th className={cx(th, "text-right")}>Proceeds</th>
              <th className={cx(th, "text-right")}>If converted</th>
              <th className={cx(th, "text-right")}>MOIC</th>
              <th className={cx(th, "text-right")}>IRR</th>
              <th className={cx(th, "text-right")}>% of fund</th>
            </tr>
          </thead>
          <tbody>
            {ct.scenarios.map((s) => (
              <tr key={s.scenario}>
                <td className={td}>
                  <span className="font-medium text-ink">{titleCase(s.scenario)}</span>
                  {s.preferenceBinding && (
                    <Badge tone="warn" className="ml-1.5" title="Our liquidation preference pays more than converting to common at this exit value">
                      Pref. binds
                    </Badge>
                  )}
                  <div className="line-clamp-1 text-[11px] text-ink-3" title={s.basis}>
                    {s.basis}
                  </div>
                </td>
                <td className={tdr}>{usd(s.exitEquityUsd)}</td>
                <td className={tdr}>{s.roundsRaised}</td>
                <td className={tdr}>{usd(s.investedUsd)}</td>
                <td className={tdr}>{pct(s.exitOwnershipPct, 2)}</td>
                <td className={tdr}>{usd(s.proceedsUsd, 2)}</td>
                <td className={cx(tdr, "text-ink-3")}>{usd(s.proceedsIfConvertedUsd, 2)}</td>
                <td className={cx(tdr, "font-medium")}>{multiple(s.grossMoic, 2)}</td>
                <td className={tdr}>{irrText(s.grossIrr)}</td>
                <td className={tdr}>{s.fundContributionPctOfFund !== null ? pct(s.fundContributionPctOfFund, 1) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {ct.comparison.length > 0 && (
        <div>
          <SubHead aside="the simplified model is kept for comparison only">Cap table vs. simplified model</SubHead>
          <Table minWidth={640}>
            <thead>
              <tr>
                <th className={th}>Scenario</th>
                <th className={cx(th, "text-right")}>Simplified MOIC</th>
                <th className={cx(th, "text-right")}>Cap-table MOIC</th>
                <th className={cx(th, "text-right")}>Δ</th>
                <th className={cx(th, "text-right")}>Exit % simpl. → cap table</th>
                <th className={cx(th, "text-right")}>Follow-on simpl. → cap table</th>
              </tr>
            </thead>
            <tbody>
              {ct.comparison.map((r) => (
                <tr key={r.scenario}>
                  <td className={td}>{titleCase(r.scenario)}</td>
                  <td className={tdr}>{multiple(r.simplifiedMoic, 2)}</td>
                  <td className={cx(tdr, "font-medium")}>{multiple(r.capTableMoic, 2)}</td>
                  <td className={cx(tdr, r.moicDeltaPct !== null && Math.abs(r.moicDeltaPct) >= 10 && "text-warn")}>{r.moicDeltaPct !== null ? `${r.moicDeltaPct > 0 ? "+" : ""}${r.moicDeltaPct.toFixed(0)}%` : "—"}</td>
                  <td className={tdr}>
                    {pct(r.simplifiedExitOwnershipPct, 2)} → {pct(r.capTableExitOwnershipPct, 2)}
                  </td>
                  <td className={tdr}>
                    {usd(r.simplifiedFollowOnUsd)} → {usd(r.capTableFollowOnUsd)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          {ct.differences.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
              {ct.differences.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {ct.notes.length > 0 && <Rule>{ct.notes.join(" ")}</Rule>}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Required trajectory                                                */
/* ---------------------------------------------------------------- */

function TrajectoryCard({ t, title }: { t: TrajectoryResult; title: string }) {
  if (!t.modelable)
    return (
      <div className="min-w-0">
        <SubHead>{title}</SubHead>
        <p className="text-[12.5px] text-ink-3">Not modelable: {t.reasons.join("; ") || "inputs missing"}.</p>
      </div>
    );
  const gp = t.growthPersistence;
  return (
    <div className="min-w-0 space-y-4">
      <div>
        <SubHead aside={<Plaus p={t.plausibility} />}>{title}</SubHead>
        <p className="text-[13px] text-ink-2">{t.question}</p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Stat k="Required exit equity" v={usd(t.requiredExitEquityUsd)} sub={t.naiveExitEquityUsd !== null ? `${usd(t.naiveExitEquityUsd)} ignoring preferences` : undefined} />
        <Stat k="Exit ownership" v={t.exitOwnershipPct !== null ? pct(t.exitOwnershipPct, 2) : <Unknown />} sub={`after ${t.roundsBeforeExit} rounds, ${t.yearsToExit} yrs`} />
        <Stat k="Invested (incl. follow-on)" v={usd(t.investedUsd)} sub={t.target.kind === "MULTIPLE" ? `target ${t.target.multiple}× = ${usd(t.target.requiredProceedsUsd)}` : `target ${usd(t.target.contributionUsd)}`} />
      </div>
      <Table minWidth={520}>
        <thead>
          <tr>
            <th className={th}>Exit multiple</th>
            <th className={cx(th, "text-right")}>Required revenue</th>
            <th className={cx(th, "text-right")}>CAGR</th>
            <th className={cx(th, "text-right")}>Customers</th>
            <th className={cx(th, "text-right")}>SAM share</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {t.byMultiple.map((r) => (
            <tr key={r.revenueMultiple} className={cx(r.revenueMultiple === t.referenceMultiple && "bg-surface-2")}>
              <td className={td}>
                {r.revenueMultiple}× <span className="text-[11px] text-ink-3">{r.source.toLowerCase()}</span>
              </td>
              <td className={tdr}>{usd(r.requiredRevenueUsd)}</td>
              <td className={tdr}>{r.requiredCagrPct !== null ? pct(r.requiredCagrPct, 0) : "—"}</td>
              <td className={tdr}>{r.requiredCustomers !== null ? Math.round(r.requiredCustomers).toLocaleString("en-US") : "—"}</td>
              <td className={tdr}>{r.samSharePct !== null ? pct(r.samSharePct, 1) : "—"}</td>
              <td className={td}>
                <Plaus p={r.samPlausibility} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {t.path.length > 0 && (
        <div>
          <div className="mb-1 text-[11.5px] text-ink-3">
            Minimum path at the reference {t.referenceMultiple}× multiple (ARPA {usd(t.current.arpaUsd)} · {t.current.arpaSource})
          </div>
          <Table minWidth={420}>
            <thead>
              <tr>
                <th className={th}>Year</th>
                <th className={cx(th, "text-right")}>Min. revenue</th>
                <th className={cx(th, "text-right")}>Customers</th>
                <th className={cx(th, "text-right")}>New logos / yr</th>
              </tr>
            </thead>
            <tbody>
              {t.path.map((y) => (
                <tr key={y.year}>
                  <td className={td}>{y.year}</td>
                  <td className={tdr}>{usd(y.minRevenueUsd)}</td>
                  <td className={tdr}>{y.customers !== null ? Math.round(y.customers).toLocaleString("en-US") : "—"}</td>
                  <td className={tdr}>{y.newLogos !== null ? Math.round(y.newLogos).toLocaleString("en-US") : <span className="text-unknown">needs NRR</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <div className="rounded-md bg-surface-2 px-3 py-2 text-[12.5px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">Growth persistence</span> <Plaus p={gp.plausibility} /> <Badge tone="unknown">{gp.label === "MODEL_ASSUMPTION" ? "Model assumption" : gp.label}</Badge>
        </div>
        <div className="mt-1 text-ink-2">
          Requires starting growth of {gp.requiredStartingGrowthPct !== null ? pct(gp.requiredStartingGrowthPct, 0) : "—"} decaying {Math.round(gp.decayPerYear * 100)}%/yr; current {gp.currentGrowthPct !== null ? pct(gp.currentGrowthPct, 0) : "unknown"} ({gp.currentGrowthSource}). {gp.coveragePct !== null && `Current growth decaying covers ${gp.coveragePct.toFixed(0)}% of the requirement.`}
        </div>
        <div className="mt-0.5 text-[11.5px] text-ink-3">{gp.explanation}</div>
      </div>
      <div className="text-[12.5px] text-ink-2">
        SAM share at the reference multiple: {t.samShare.sharePct !== null ? pct(t.samShare.sharePct, 1) : "unknown"} of {usd(t.samShare.samHighUsd)} <Plaus p={t.samShare.plausibility} />
      </div>
      {t.summary.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-ink-3">
          {t.summary.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TrajectoryView({ e }: { e: EconomicsReport }) {
  return (
    <div className="space-y-4">
      <Rule>Solved backwards through the cap-table model (dilution, pool refreshes, follow-on and preferences), then arithmetic on revenue. Plausibility labels are conventional thresholds — not probabilities.</Rule>
      <div className="grid gap-10 lg:grid-cols-2 [&>*]:min-w-0">
        <TrajectoryCard t={e.trajectory.fundTarget} title="Return the fund's target contribution" />
        <TrajectoryCard t={e.trajectory.capitalMultiple} title={`Return ${e.trajectory.capitalMultiple.target.multiple ?? 20}× our capital`} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Sensitivity map                                                    */
/* ---------------------------------------------------------------- */

function MarginBar({ m }: { m: number | null }) {
  if (m === null) return <span className="text-[11px] text-unknown">n/a</span>;
  const w = Math.min(100, Math.abs(m));
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="relative inline-block h-1.5 w-16 rounded-full bg-surface-3" aria-hidden>
        <span className={cx("absolute inset-y-0 left-0 rounded-full", m < 0 ? "bg-risk" : m < 25 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(4, w)}%` }} />
      </span>
      <span className={cx("num text-[12px]", m < 0 ? "text-risk" : m < 25 ? "text-warn" : "text-ink-2")}>
        {m > 0 ? "+" : ""}
        {m.toFixed(0)}%
      </span>
    </span>
  );
}

export function SensitivityView({ s }: { s: SensitivityMap }) {
  const rows = [...s.rows].sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity));
  if (!rows.length) return <p className="text-[13px] text-ink-3">No breakpoint could be computed.</p>;
  return (
    <div className="space-y-4">
      {s.verifyFirst.length > 0 && (
        <div className="rounded-lg border border-warn/30 bg-warn-soft/40 px-4 py-2.5">
          <div className="t-eyebrow mb-1 !text-warn">Verify first</div>
          <ol className="list-decimal space-y-0.5 pl-4 text-[12.5px] text-ink">
            {s.verifyFirst.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ol>
        </div>
      )}
      <Table minWidth={760}>
        <thead>
          <tr>
            <th className={th}>Variable</th>
            <th className={cx(th, "text-right")}>Current</th>
            <th className={cx(th, "text-right")}>Breaks at</th>
            <th className={th}>Margin to break</th>
            <th className={th}>Why it breaks the case</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>
                <div className="font-medium text-ink">{r.variable}</div>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={r.method === "COMPUTED" ? "neutral" : "unknown"}>{r.method === "COMPUTED" ? "Computed" : "Model"}</Badge>
                  {r.broken && <Badge tone="risk">Already broken</Badge>}
                  <span className="text-[11px] text-ink-3">{r.direction === "BREAKS_ABOVE" ? "breaks if it rises" : r.direction === "BREAKS_BELOW" ? "breaks if it falls" : ""}</span>
                </div>
              </td>
              <td className={tdr}>{r.current === null ? <Unknown /> : sensValue(r.unit, r.current)}</td>
              <td className={tdr}>{r.breaksAt === null ? <Unknown /> : sensValue(r.unit, r.breaksAt)}</td>
              <td className={td}>
                <MarginBar m={r.margin} />
              </td>
              <td className={cx(td, "text-[12px] text-ink-2")}>
                {r.why}
                {r.modelViews.map((v, i) => (
                  <div key={i} className="mt-0.5 text-[11.5px] text-ink-3">
                    Model view: {v.variable} — now {v.currentAssumption}, breaks at {v.breaksAt}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      {s.notes.length > 0 && <Rule>{s.notes.join(" ")}</Rule>}
      <Rule>Margin = distance from the current value to the breakpoint in the breaking direction, as % of the current value. Most fragile first.</Rule>
    </div>
  );
}
