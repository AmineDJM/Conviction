/**
 * Factor-specific detail views of the Divergence tab: the cap-table path,
 * the dependency register, the loop chains, the structural dimensions, the
 * syndicate's stated behaviour, the slowdown arithmetic, the expansion ladder
 * and the focus count. Each one shows the numbers code computed.
 */
import type {
  AmbitionFactor,
  CapTableFactor,
  DependencyFactor,
  DivergenceFactor,
  ExpansionFactor,
  FocusFactor,
  LoopsFactor,
  MarketStructureFactor,
  ScalabilityFactor,
  SurvivabilityFactor,
  SyndicateFactor,
} from "@/engine/divergence";
import { Badge, Td, Th, cx } from "@/components/ui";
import type { Tone } from "@/lib/format";
import { compactUsd } from "@/components/deal/tabs/shared";
import { PageLinks, ScrollTable, SubLabel, label } from "./primitives";

type P<T> = { f: T; slug: string; docId: string | null };
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${+n.toFixed(1)}%`);

function readingTone(r: string): Tone {
  if (/FAVORABLE|DEMONSTRATED|SCALES|EXPANSIVE/.test(r) && !/UNFAVORABLE/.test(r)) return "ok";
  if (/UNFAVORABLE|ABSENT|FRAGILE|CONTAINED/.test(r)) return "risk";
  if (/ASSERTED|NEUTRAL|PLAUSIBLE/.test(r)) return r === "PLAUSIBLE" ? "neutral" : "warn";
  return "unknown";
}

function AmbitionDetail({ f, slug, docId }: P<AmbitionFactor>) {
  if (!f.signals?.length) return null;
  return (
    <div>
      <SubLabel>Observable scope signals</SubLabel>
      <ul className="divide-y divide-line border-y border-line">
        {f.signals.map((s, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-[12.5px]">
            <Badge tone={s.direction === "EXPANSIVE" ? "accent" : "neutral"}>{label(s.direction)}</Badge>
            <span className="w-[120px] shrink-0 text-ink-3">{label(s.kind)}</span>
            <span className="min-w-0 flex-1 text-ink-2">{s.evidence}</span>
            <PageLinks pages={s.page !== null ? [s.page] : []} slug={slug} docId={docId} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CapTableDetail({ f }: P<CapTableFactor>) {
  const path = f.path ?? [];
  return (
    <div className="space-y-4">
      {path.length > 0 && (
        <div>
          <SubLabel aside="Pro-forma cap table (economics engine) on the stated pre-round table · benchmarks are a versioned MODEL_ASSUMPTION">Founder ownership path</SubLabel>
          <ScrollTable minWidth={620}>
            <thead>
              <tr>
                <Th>Step</Th>
                <Th align="right">Month</Th>
                <Th align="right">Active founders</Th>
                <Th align="right">Stage typical / floor</Th>
                <Th align="right">Departed founders</Th>
                <Th align="right">Option pool</Th>
              </tr>
            </thead>
            <tbody>
              {path.map((r) => (
                <tr key={r.label}>
                  <Td>{r.label}</Td>
                  <Td align="right">{r.month}</Td>
                  <Td align="right" className={cx("font-medium", r.belowFloor ? "text-risk" : "text-ink")}>
                    {pct(r.activeFounderPct)}
                  </Td>
                  <Td align="right" className="text-ink-3">
                    {r.benchmark ? `${r.benchmark.typicalPct}% / ${r.benchmark.floorPct}%` : "—"}
                  </Td>
                  <Td align="right">{r.departedFounderPct > 0 ? pct(r.departedFounderPct) : "—"}</Td>
                  <Td align="right">{pct(r.poolPct)}</Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>
      )}
      {(f.pathNotes ?? []).length > 0 && (
        <ul className="space-y-0.5 text-[11.5px] leading-relaxed text-ink-3">
          {f.pathNotes.map((n, i) => (
            <li key={i}>· {n}</li>
          ))}
        </ul>
      )}
      {(f.issues ?? []).filter((i) => i.points !== 0).length > 0 && (
        <div>
          <SubLabel>Misalignment points</SubLabel>
          <ul className="divide-y divide-line border-y border-line text-[12.5px]">
            {f.issues
              .filter((i) => i.points !== 0)
              .map((i, k) => (
                <li key={k} className="flex items-baseline gap-3 py-1.5">
                  <span className={cx("num w-7 shrink-0 font-semibold", i.points >= 2 ? "text-risk" : "text-warn")}>+{i.points}</span>
                  <span className="text-ink-2">{i.issue}</span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function SyndicateDetail({ f, slug, docId }: P<SyndicateFactor>) {
  const inv = f.investors ?? [];
  if (!inv.length) return null;
  return (
    <div className="space-y-4">
      <div>
        <SubLabel aside="Only stated behaviour counts. Names, fame and investor type never raise the level.">Investors and what they are stated to do</SubLabel>
        <ScrollTable minWidth={620}>
          <thead>
            <tr>
              <Th>Investor</Th>
              <Th>Role</Th>
              <Th>Counted behaviour</Th>
              <Th>Evidence</Th>
            </tr>
          </thead>
          <tbody>
            {inv.map((i) => (
              <tr key={i.name}>
                <Td className="font-medium text-ink">{i.name}</Td>
                <Td className="text-ink-3">{label(i.roundRole)}</Td>
                <Td>
                  {i.counted.length ? (
                    <span className="flex flex-wrap gap-1">
                      {i.counted.map((b) => (
                        <Badge key={b} tone={b === "NOT_FOLLOWING_ON" || b === "CONFLICT_OF_INTEREST" ? "risk" : "ok"}>
                          {label(b)}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    <span className="italic text-unknown">Name only</span>
                  )}
                  {i.researchRefs.length > 0 && <span className="ml-1 text-[11px] text-accent-text">+ research</span>}
                </Td>
                <Td className="text-ink-2">
                  {i.evidence || "—"} <PageLinks pages={i.page !== null ? [i.page] : []} slug={slug} docId={docId} />
                </Td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(f.capabilities ?? []).map((c) => (
          <div key={c.capability} className="border-l border-line pl-3">
            <div className="text-[11.5px] text-ink-3">{label(c.capability)}</div>
            <div className={cx("num text-[15px] font-semibold", c.net > 0 ? "text-ok" : c.net < 0 ? "text-risk" : "text-unknown")}>{c.net > 0 ? `+${c.net}` : c.net === 0 ? "no evidence" : c.net}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SurvivabilityDetail({ f, slug, docId }: P<SurvivabilityFactor>) {
  const a = f.arithmetic;
  return (
    <div className="space-y-4">
      {a && a.status !== "UNKNOWN" && (
        <div>
          <SubLabel aside="Revenue held flat; opex cut capped by assumption">Default-alive under a 24-month slowdown</SubLabel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 border-y border-line py-3 text-[12.5px] sm:grid-cols-4">
            <div>
              <div className="text-ink-3">Cash after round</div>
              <div className="num font-medium text-ink">{compactUsd(a.cashAfterRoundUsd)}</div>
            </div>
            <div>
              <div className="text-ink-3">Net burn / month ({a.burnSource.toLowerCase()})</div>
              <div className="num font-medium text-ink">{compactUsd(a.monthlyBurnUsd)}</div>
            </div>
            <div>
              <div className="text-ink-3">Gross profit / month</div>
              <div className={cx("num font-medium", a.monthlyGrossProfitUsd === null ? "italic text-unknown" : "text-ink")}>{a.monthlyGrossProfitUsd === null ? "Unknown" : compactUsd(a.monthlyGrossProfitUsd)}</div>
            </div>
            <div>
              <div className="text-ink-3">Status</div>
              <div className={cx("font-medium", a.status === "DOES_NOT_SURVIVE" ? "text-risk" : a.status === "SURVIVES_WITH_CUTS" ? "text-warn" : "text-ok")}>{label(a.status)}</div>
            </div>
          </div>
        </div>
      )}
      {(f.options ?? []).length > 0 && (
        <div>
          <SubLabel aside={`${f.realOptions} real option${f.realOptions === 1 ? "" : "s"}${f.assertedOnly ? ` · ${f.assertedOnly} only asserted (not counted)` : ""}`}>Paths if the plan slips</SubLabel>
          <ul className="divide-y divide-line border-y border-line">
            {f.options.map((o, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1.5 text-[12.5px]">
                <Badge tone={o.status === "DEMONSTRATED" ? "ok" : o.status === "PLAUSIBLE" ? "neutral" : "warn"}>{label(o.status)}</Badge>
                <span className="w-[160px] shrink-0 text-ink-3">{label(o.option.replace(/_COMPUTED$/, ""))}{o.basis === "COMPUTED" ? " (computed)" : ""}</span>
                <span className="min-w-0 flex-1 text-ink-2">{o.evidence}</span>
                <PageLinks pages={o.page !== null ? [o.page] : []} slug={slug} docId={docId} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {(f.rigidities ?? []).length > 0 && (
        <p className="text-[12px] text-ink-3">
          Rigidities: {f.rigidities.map((r) => `${label(r.kind)} — ${r.evidence}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

function MarketStructureDetail({ f, slug, docId }: P<MarketStructureFactor>) {
  const dims = f.dimensions ?? [];
  return (
    <div className="space-y-3">
      {dims.length > 0 && (
        <ScrollTable minWidth={560}>
          <thead>
            <tr>
              <Th>Dimension</Th>
              <Th align="right">Weight</Th>
              <Th>Reading</Th>
              <Th>Why</Th>
            </tr>
          </thead>
          <tbody>
            {dims.map((d) => (
              <tr key={d.dimension}>
                <Td className="text-ink">{label(d.dimension)}</Td>
                <Td align="right">{d.weight}</Td>
                <Td>
                  <Badge tone={readingTone(d.reading)}>{label(d.reading)}</Badge> {d.basis === "COMPUTED" && <span className="text-[11px] text-ink-3">computed</span>}
                </Td>
                <Td className="text-ink-2">
                  {d.evidence} <PageLinks pages={d.pages} slug={slug} docId={docId} />
                </Td>
              </tr>
            ))}
          </tbody>
        </ScrollTable>
      )}
      <p className="text-[12px] text-ink-3">
        Market size, for contrast only (never an input): reconstructed {compactUsd(f.marketSize?.reconstructedHighUsd ?? null)} · deck TAM {compactUsd(f.marketSize?.deckTamUsd ?? null)}.
      </p>
    </div>
  );
}

function DependencyDetail({ f, slug, docId }: P<DependencyFactor>) {
  const deps = f.dependencies ?? [];
  return (
    <div className="space-y-4">
      {deps.length > 0 && (
        <div>
          <SubLabel aside="Danger = criticality × substitutability × switching time (× 0.75 with a stated mitigation)">What it does not control</SubLabel>
          <ScrollTable minWidth={680}>
            <thead>
              <tr>
                <Th>Dependency</Th>
                <Th>Provides</Th>
                <Th>Criticality</Th>
                <Th>Substitutability</Th>
                <Th align="right">Switch (mo)</Th>
                <Th align="right">Danger</Th>
              </tr>
            </thead>
            <tbody>
              {deps.map((d, i) => (
                <tr key={i} className={cx(f.mostDangerous && i === 0 && d.critical && "bg-risk-soft/40")}>
                  <Td>
                    <div className="font-medium text-ink">{d.provider}</div>
                    <div className="text-[11px] text-ink-3">
                      {label(d.kind)} {d.basis === "COMPUTED" && "· computed"} <PageLinks pages={d.page !== null ? [d.page] : []} slug={slug} docId={docId} />
                    </div>
                  </Td>
                  <Td className="text-ink-2">{d.whatItProvides}</Td>
                  <Td>{label(d.criticality)}</Td>
                  <Td>{label(d.substitutability)}</Td>
                  <Td align="right">{d.switchingTimeMonths ?? "—"}</Td>
                  <Td align="right" className={cx("font-semibold", d.danger >= 9 ? "text-risk" : d.critical ? "text-warn" : "text-ink")}>
                    {d.danger}
                  </Td>
                </tr>
              ))}
            </tbody>
          </ScrollTable>
        </div>
      )}
      {(f.owned ?? []).length > 0 && (
        <div>
          <SubLabel>What it owns</SubLabel>
          <ul className="space-y-1 text-[12.5px]">
            {f.owned.map((o, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <Badge tone="ok">{label(o.asset)}</Badge>
                <span className="text-ink-2">{o.evidence}</span>
                <PageLinks pages={o.page !== null ? [o.page] : []} slug={slug} docId={docId} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExpansionDetail({ f, slug, docId }: P<ExpansionFactor>) {
  if (f.wedgeAcvUsd === null || f.wedgeAcvUsd === undefined) return null;
  const steps = [
    { k: "Wedge today", v: f.wedgeAcvUsd, sub: f.wedgeSource },
    { k: "Demonstrated ceiling", v: f.demonstratedCeilingUsd, sub: f.demonstratedMultiple !== null ? `${f.demonstratedMultiple}× wedge` : null },
    { k: "Platform ceiling (incl. roadmap)", v: f.platformCeilingUsd, sub: f.platformMultiple !== null ? `${f.platformMultiple}× wedge` : null },
  ];
  const max = Math.max(...steps.map((s) => s.v ?? 0), 1);
  return (
    <div className="space-y-4">
      <div>
        <SubLabel aside="Per customer per year, 5-year horizon">Land → expand → platform</SubLabel>
        <div className="space-y-2">
          {steps.map((s) => (
            <div key={s.k} className="grid grid-cols-[150px_1fr_90px] items-center gap-3 text-[12.5px] sm:grid-cols-[210px_1fr_110px]">
              <div className="text-ink-3">
                {s.k}
                {s.sub && <div className="text-[11px]">{s.sub}</div>}
              </div>
              <div className="h-2 rounded-full bg-surface-3">
                <div className="h-2 rounded-full bg-ink/70" style={{ width: `${Math.max(2, ((s.v ?? 0) / max) * 100)}%` }} />
              </div>
              <div className="num text-right font-semibold text-ink">{compactUsd(s.v)}</div>
            </div>
          ))}
        </div>
      </div>
      {(f.modules ?? []).length > 0 && (
        <ul className="divide-y divide-line border-y border-line text-[12.5px]">
          {f.modules.map((m, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
              <Badge tone={m.status === "LIVE" || m.status === "BETA" ? "ok" : "neutral"}>{label(m.status)}</Badge>
              <span className="min-w-0 flex-1 text-ink">{m.name}</span>
              <span className="num text-ink-2">{m.priceUsd !== null ? `${compactUsd(m.priceUsd)}/yr` : <span className="italic text-unknown">unpriced</span>}</span>
              <PageLinks pages={m.page !== null ? [m.page] : []} slug={slug} docId={docId} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FocusDetail({ f }: P<FocusFactor>) {
  const axes = f.axes ?? [];
  if (!axes.some((a) => a.counted.length || a.excluded.length)) return null;
  return (
    <div>
      <SubLabel aside={`${f.priorities} priorities · ${f.excessPriorities} beyond one per axis · ${f.fte ?? "unknown"} FTE`}>Simultaneous priorities</SubLabel>
      <div className="grid gap-4 border-y border-line py-3 sm:grid-cols-4">
        {axes.map((a) => (
          <div key={a.axis}>
            <div className="flex items-baseline justify-between">
              <span className="text-[11.5px] text-ink-3">{label(a.axis)}</span>
              <span className={cx("num text-[17px] font-semibold", a.counted.length > 2 ? "text-warn" : "text-ink")}>{a.counted.length}</span>
            </div>
            <ul className="mt-1 space-y-0.5 text-[12px] text-ink-2">
              {a.counted.map((x) => (
                <li key={x}>{x}</li>
              ))}
              {a.excluded.map((x) => (
                <li key={x} className="text-ink-3 line-through decoration-line-strong">
                  {x}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoopsDetail({ f, slug, docId }: P<LoopsFactor>) {
  const loops = f.loops ?? [];
  if (!loops.length) return null;
  return (
    <div className="space-y-4">
      {loops.map((lp, k) => (
        <div key={k}>
          <SubLabel aside={lp.note ?? undefined}>
            {label(lp.kind)} loop · {label(lp.status)}
          </SubLabel>
          {lp.description && <p className="mb-2 text-[12.5px] text-ink-2">{lp.description}</p>}
          <ol className="space-y-1.5">
            {lp.links.map((l, i) => {
              const weakest = lp.weakestLink && l.from === lp.weakestLink.from && l.to === lp.weakestLink.to;
              return (
                <li key={i} className={cx("grid gap-2 rounded-md border px-3 py-2 text-[12.5px] sm:grid-cols-[minmax(0,1fr)_110px]", weakest && l.status !== "DEMONSTRATED" ? "border-warn/40 bg-warn-soft/40" : "border-line")}>
                  <div className="min-w-0">
                    <div className="text-ink">
                      {l.from} <span className="text-ink-3">→</span> {l.to}
                      {weakest && l.status !== "DEMONSTRATED" && <span className="ml-2 text-[11px] font-medium text-warn">weakest link</span>}
                    </div>
                    {l.evidence && <div className="mt-0.5 text-ink-3">{l.evidence}</div>}
                    {l.adjustment && <div className="mt-0.5 text-[11px] text-warn">Code: {l.adjustment} (reported {label(l.reported).toLowerCase()})</div>}
                  </div>
                  <div className="flex items-start justify-between gap-2 sm:flex-col sm:items-end">
                    <Badge tone={readingTone(l.status)}>{label(l.status)}</Badge>
                    <PageLinks pages={l.page !== null ? [l.page] : []} slug={slug} docId={docId} />
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function ScalabilityDetail({ f }: P<ScalabilityFactor>) {
  const issues = f.issues ?? [];
  if (!issues.length) return null;
  return (
    <div>
      <SubLabel aside="Slope, not level: current gross margin is not an input">Fragility points</SubLabel>
      <ul className="divide-y divide-line border-y border-line text-[12.5px]">
        {issues.map((i, k) => (
          <li key={k} className="flex items-baseline gap-3 py-1.5">
            <span className={cx("num w-7 shrink-0 font-semibold", i.points >= 2 ? "text-risk" : i.points > 0 ? "text-warn" : i.points < 0 ? "text-ok" : "text-ink-3")}>{i.points > 0 ? `+${i.points}` : i.points}</span>
            <span className="text-ink-2">{i.issue}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FactorDetail({ f, slug, docId }: { f: DivergenceFactor; slug: string; docId: string | null }) {
  if (f.reading === "MODULE_ERROR") return null;
  switch (f.id) {
    case "AMBITION_CEILING":
      return <AmbitionDetail f={f} slug={slug} docId={docId} />;
    case "CAP_TABLE_ALIGNMENT":
      return <CapTableDetail f={f} slug={slug} docId={docId} />;
    case "SYNDICATE_QUALITY":
      return <SyndicateDetail f={f} slug={slug} docId={docId} />;
    case "STRATEGIC_SURVIVABILITY":
      return <SurvivabilityDetail f={f} slug={slug} docId={docId} />;
    case "MARKET_STRUCTURE":
      return <MarketStructureDetail f={f} slug={slug} docId={docId} />;
    case "DEPENDENCY_SURFACE":
      return <DependencyDetail f={f} slug={slug} docId={docId} />;
    case "LAND_EXPAND_PLATFORM":
      return <ExpansionDetail f={f} slug={slug} docId={docId} />;
    case "ORGANIZATIONAL_FOCUS":
      return <FocusDetail f={f} slug={slug} docId={docId} />;
    case "COMPOUNDING_LOOPS":
      return <LoopsDetail f={f} slug={slug} docId={docId} />;
    case "SCALABILITY_ARCHITECTURE":
      return <ScalabilityDetail f={f} slug={slug} docId={docId} />;
    default:
      return null;
  }
}
