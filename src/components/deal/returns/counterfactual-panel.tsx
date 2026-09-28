"use client";

import { useMemo, useState } from "react";
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { BackwardsResult, ReturnModel } from "@/engine/returns";
import type { MarketReconstruction } from "@/engine/market";
import { getRegistry } from "@/engine/benchmarks";
import { runCounterfactual, type CounterfactualResult, type CounterfactualSummary, type CustomShock } from "@/engine/economics";
import { Badge, Button, cx } from "@/components/ui";
import { multiple, pct, titleCase } from "@/lib/format";
import { PLAUS_TONE, RISK_TONE, outputValue } from "./economics-format";

type Outputs = CounterfactualSummary["base"];

export interface CounterfactualPanelProps {
  builtIns: CounterfactualSummary[];
  /** Slim deal: only what the economics engine reads. */
  deal: CanonicalDeal;
  registryId: string;
  fund: FundProfile;
  returns: ReturnModel;
  backwards: BackwardsResult | null;
  market: MarketReconstruction;
}

const th = "px-2 py-1.5 text-left text-[11px] font-medium text-ink-3 first:pl-0";
const td = "border-t border-line px-2 py-1.5 align-top first:pl-0";

function Row({ label, o, base, cross, sub }: { label: React.ReactNode; o: Outputs; base: Outputs | null; cross?: string[]; sub?: React.ReactNode }) {
  const d = (a: number | null, b: number | null | undefined, higherBetter: boolean) => (base && a !== null && b !== null && b !== undefined && Math.abs(a - b) > 1e-9 ? ((a > b) === higherBetter ? "text-ok" : "text-risk") : "");
  return (
    <tr>
      <td className={td}>
        <div className="font-medium text-ink">{label}</div>
        {sub}
      </td>
      <td className={cx(td, "num text-right", d(o.moic.BASE, base?.moic.BASE, true))}>{multiple(o.moic.BASE, 2)}</td>
      <td className={cx(td, "num text-right", d(o.moic.OUTLIER, base?.moic.OUTLIER, true))}>{multiple(o.moic.OUTLIER, 2)}</td>
      <td className={cx(td, "num text-right", d(o.requiredCagrPct, base?.requiredCagrPct, false))}>{o.requiredCagrPct !== null ? pct(o.requiredCagrPct, 0) : "—"}</td>
      <td className={td}>
        <Badge tone={PLAUS_TONE[o.trajectoryPlausibility] ?? "neutral"}>{titleCase(o.trajectoryPlausibility)}</Badge>
      </td>
      <td className={td}>
        <Badge tone={RISK_TONE[o.financingRisk] ?? "neutral"}>{titleCase(o.financingRisk)}</Badge>
      </td>
      <td className={cx(td, "num text-right", d(o.runwayMonths, base?.runwayMonths, true))}>{o.runwayMonths !== null ? `${o.runwayMonths.toFixed(1)} mo` : "—"}</td>
      <td className={cx(td, "text-[11.5px]", cross?.length ? "text-risk" : "text-ink-3")}>{cross ? (cross.length ? cross.join(", ") : "none") : ""}</td>
    </tr>
  );
}

const FACTORS: { k: keyof CustomShock; label: string; hint: string; kind: "factor" | "months" | "pts" }[] = [
  { k: "valuationFactor", label: "Entry price", hint: "× post-money / cap", kind: "factor" },
  { k: "exitMultipleFactor", label: "Exit multiple", hint: "× every exit value", kind: "factor" },
  { k: "growthFactor", label: "Growth", hint: "× current growth", kind: "factor" },
  { k: "cacFactor", label: "CAC", hint: "× CAC", kind: "factor" },
  { k: "priceFactor", label: "Price (ACV)", hint: "× on new business", kind: "factor" },
  { k: "winRateFactor", label: "Win rate", hint: "× win rate", kind: "factor" },
  { k: "burnFactor", label: "Burn", hint: "× monthly burn", kind: "factor" },
  { k: "delayMonths", label: "Next round delay", hint: "months", kind: "months" },
  { k: "grossMarginDeltaPts", label: "Gross margin", hint: "± points", kind: "pts" },
];

export function CounterfactualPanel(p: CounterfactualPanelProps) {
  const base = p.builtIns[0]?.base ?? null;
  const [shock, setShock] = useState<Record<string, string>>({});
  const [label, setLabel] = useState("");
  const [result, setResult] = useState<{ r: CounterfactualResult; ms: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const registry = useMemo(() => getRegistry(p.registryId), [p.registryId]);
  const ctx = useMemo(() => ({ deal: p.deal, registry, fund: p.fund, returns: p.returns, backwards: p.backwards, market: p.market }), [p.deal, registry, p.fund, p.returns, p.backwards, p.market]);

  const run = () => {
    setError(null);
    const s: CustomShock = { label: label.trim() || "Custom scenario" };
    for (const f of FACTORS) {
      const raw = shock[f.k];
      if (raw === undefined || raw.trim() === "") continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || (f.kind === "factor" && v < 0) || (f.kind === "months" && v < 0)) {
        setError(`${f.label}: enter a ${f.kind === "factor" ? "non-negative multiplier" : f.kind === "months" ? "number of months ≥ 0" : "number of points"}`);
        return;
      }
      (s as Record<string, unknown>)[f.k] = v;
    }
    if (Object.keys(s).length === 1) {
      setError("Set at least one shock.");
      return;
    }
    try {
      const t0 = performance.now();
      const r = runCounterfactual(ctx, { id: "custom", shock: s });
      setResult({ r, ms: performance.now() - t0 });
    } catch (e) {
      setError(`The model could not evaluate this scenario: ${(e as Error).message}`);
    }
  };

  const changed = result?.r.changes.filter((c) => c.direction !== "UNCHANGED") ?? [];

  return (
    <div className="space-y-6">
      {p.builtIns.length > 0 && base ? (
        <div>
          <div className="mb-1.5 text-[12px] text-ink-3">Five built-in shocks, pre-computed with the stored analysis (every constant is a stated model assumption). Green / red = better / worse than the stored case.</div>
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[820px] border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className={th}>Scenario</th>
                  <th className={cx(th, "text-right")}>Base MOIC</th>
                  <th className={cx(th, "text-right")}>Outlier MOIC</th>
                  <th className={cx(th, "text-right")}>Req. CAGR</th>
                  <th className={th}>Trajectory</th>
                  <th className={th}>Financing</th>
                  <th className={cx(th, "text-right")}>Runway</th>
                  <th className={th}>Breakpoints crossed</th>
                </tr>
              </thead>
              <tbody>
                <Row label="Stored analysis" o={base} base={null} sub={<div className="text-[11px] text-ink-3">no shock</div>} />
                {p.builtIns.map((b) => (
                  <Row
                    key={b.id}
                    label={b.label}
                    o={b.scenario}
                    base={base}
                    cross={b.crossedBreakpoints.map((c) => c.variable)}
                    sub={
                      <details className="text-[11px] text-ink-3">
                        <summary className="cursor-pointer hover:text-ink">assumptions</summary>
                        <div className="max-w-[320px]">{b.description}</div>
                        {b.worse.length > 0 && <div className="text-risk">Worse: {b.worse.join(", ")}</div>}
                        {b.better.length > 0 && <div className="text-ok">Better: {b.better.join(", ")}</div>}
                      </details>
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-[13px] text-ink-3">Built-in counterfactuals are not available for this version.</p>
      )}

      <div className="rounded-lg border border-accent/25 bg-accent-soft/30 px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="accent">Scenario</Badge>
          <span className="text-[13px] font-medium text-ink">Custom shock — runs the same engine in your browser</span>
          <span className="text-[11.5px] text-ink-3">Not saved; does not change the analysis.</span>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
          {FACTORS.map((f) => (
            <label key={f.k} className="flex flex-col text-[11.5px] text-ink-3">
              {f.label} <span className="text-ink-3/80">({f.hint})</span>
              <input
                inputMode="decimal"
                className="mt-auto h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink"
                placeholder={f.kind === "factor" ? "1.0" : "0"}
                value={shock[f.k] ?? ""}
                onChange={(e) => setShock((s) => ({ ...s, [f.k]: e.target.value }))}
              />
            </label>
          ))}
          <label className="col-span-2 flex flex-col text-[11.5px] text-ink-3 sm:col-span-1">
            Label
            <input className="mt-0.5 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-ink" placeholder="e.g. Downturn" value={label} onChange={(e) => setLabel(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={run}>
            Run scenario
          </Button>
          {Object.keys(shock).length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setShock({});
                setResult(null);
                setLabel("");
              }}
            >
              Reset
            </Button>
          )}
          {error && <span className="text-[12.5px] text-risk">{error}</span>}
        </div>

        {result && (
          <div className="mt-4 space-y-3">
            <div className="text-[12px] text-ink-3">
              {result.r.label} · computed in {result.ms.toFixed(0)} ms · applied: {result.r.applied.join("; ") || "no applicable shock (inputs missing)"}
            </div>
            {result.r.crossedBreakpoints.length > 0 ? (
              <div className="text-[12.5px] text-risk">
                Crosses {result.r.crossedBreakpoints.length} breakpoint{result.r.crossedBreakpoints.length === 1 ? "" : "s"}: {result.r.crossedBreakpoints.map((c) => `${c.variable} (margin ${c.baseMargin.toFixed(0)}% → ${c.scenarioMargin.toFixed(0)}%)`).join("; ")}
              </div>
            ) : (
              <div className="text-[12.5px] text-ink-2">No sensitivity breakpoint crossed.</div>
            )}
            {changed.length ? (
              <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                  <thead>
                    <tr>
                      <th className={th}>Output</th>
                      <th className={cx(th, "text-right")}>Stored</th>
                      <th className={cx(th, "text-right")}>Scenario</th>
                      <th className={th}>Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changed.map((c) => (
                      <tr key={c.output}>
                        <td className={td}>{c.output}</td>
                        <td className={cx(td, "num text-right text-ink-2")}>{outputValue(c.output, c.base)}</td>
                        <td className={cx(td, "num text-right font-medium")}>{outputValue(c.output, c.scenario)}</td>
                        <td className={td}>
                          <Badge tone={c.direction === "WORSE" ? "risk" : c.direction === "BETTER" ? "ok" : "unknown"}>{c.direction === "N/A" ? "Not comparable" : titleCase(c.direction)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-3">No output changed — the shocked inputs are not used by this deal&apos;s model (e.g. CAC unknown).</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
