"use client";

import { useState } from "react";
import Link from "next/link";
import type { DimensionScore } from "@/engine/scoring/dimensions";
import { Badge, cx, IndexBar } from "@/components/ui";
import { metricValue, titleCase } from "@/lib/format";

/** §85 restrained score UI: small indicators, peer context, coverage; click to see the calculation. */
export function DimensionList({ dims, slug, peerGroup, weights }: { dims: DimensionScore[]; slug: string; peerGroup: string; weights: Record<string, number> }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="divide-y divide-line border-y border-line">
      {dims.map((d) => (
        <div key={d.id}>
          <button onClick={() => setOpen(open === d.id ? null : d.id)} className="grid w-full grid-cols-[150px_44px_140px_1fr_auto] items-center gap-4 py-2.5 text-left hover:bg-surface-2/60">
            <span className="font-medium">{d.name}</span>
            <span className="num text-right text-[15px] font-semibold">{d.value !== null ? Math.round(d.value) : "—"}</span>
            <IndexBar value={d.value} lower={d.lower} upper={d.upper} width={130} />
            <span className="num text-[12px] text-ink-3">
              coverage {Math.round(d.coverage * 100)}% · bounds {Math.round(d.lower)}–{Math.round(d.upper)} · weight {Math.round((weights[d.id] ?? 0) * 100)}%
            </span>
            <span className="flex items-center gap-2">
              {d.status !== "SCORED" && <Badge tone={d.status === "PARTIAL" ? "warn" : "unknown"}>{d.status === "PARTIAL" ? "Partial" : "Not scorable"}</Badge>}
              <span className="text-[11px] text-ink-3">{open === d.id ? "Hide" : "Detail"}</span>
            </span>
          </button>
          {open === d.id && (
            <div className="anim-in pb-4 pl-[150px] pr-2">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11px] text-ink-3">
                    <th className="py-1 pr-3 font-medium">Component</th>
                    <th className="py-1 pr-3 font-medium">Input</th>
                    <th className="py-1 pr-3 text-right font-medium">Score</th>
                    <th className="py-1 pr-3 text-right font-medium">Weight</th>
                    <th className="py-1 pr-3 text-right font-medium">Coverage</th>
                    <th className="py-1 font-medium">Benchmark</th>
                  </tr>
                </thead>
                <tbody>
                  {d.components.map((c) => (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="py-1.5 pr-3">{c.label}</td>
                      <td className="py-1.5 pr-3 text-ink-2">
                        {c.kind === "METRIC" || c.kind === "MARKET_SIZE" ? (
                          c.normalizedValue !== null ? (
                            c.metricId ? (
                              <Link href={`/deals/${slug}/evidence?metric=${c.metricId}`} className="num hover:text-accent-text">
                                {metricValue(c.unit ?? "", c.normalizedValue)}
                              </Link>
                            ) : (
                              <span className="num">{metricValue(c.unit ?? "", c.normalizedValue)}</span>
                            )
                          ) : (
                            <span className="text-ink-3">{c.excludedReason ?? titleCase(c.state)}</span>
                          )
                        ) : (
                          <span title={c.rationale ?? ""}>
                            {c.rating ? titleCase(c.rating) : "Insufficient evidence"}
                            {c.rationale && <span className="block max-w-[420px] text-[11.5px] text-ink-3">{c.rationale}</span>}
                          </span>
                        )}
                        {c.flags.length > 0 && <span className="block text-[11px] text-warn">{c.flags.slice(0, 2).join(" · ")}</span>}
                      </td>
                      <td className="num py-1.5 pr-3 text-right">{c.score !== null ? Math.round(c.score) : "—"}</td>
                      <td className={cx("num py-1.5 pr-3 text-right", c.weight === 0 && "text-ink-3")}>{Math.round(c.weight * 100)}%</td>
                      <td className="num py-1.5 pr-3 text-right">{Math.round(c.credit * 100)}%</td>
                      <td className="py-1.5 text-[11.5px] text-ink-3">
                        {c.benchmarkId ? (
                          <Link href={`/benchmarks#${c.benchmarkId}`} className="hover:text-accent-text">
                            {c.benchmarkId}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {c.benchmarkType && <div>{titleCase(c.benchmarkType)}</div>}
                        {c.percentile !== null && <div>P{Math.round(c.percentile)} in {peerGroup}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11.5px] text-ink-3">
                Value = weighted score over evidenced components. Lower bound scores missing evidence at 0, upper bound at 100 — weights are never silently redistributed. No percentile is shown unless an observed distribution exists.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
