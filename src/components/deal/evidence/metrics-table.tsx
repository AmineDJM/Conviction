"use client";

import { useMemo, useState } from "react";
import type { MetricInstance } from "@/domain/canonical";
import { Badge, cx } from "@/components/ui";
import { metricValue } from "@/lib/format";
import { PlainTh, SearchInput, SortTh, TableFrame, Toggle, useSort } from "./table-kit";
import { STATE_TEXT, VERIFICATION_TEXT, methodText, stateTone, verificationTone, type MetricDefLite, type Selection } from "./labels";
import { isAnalystCorrected } from "@/engine/override-marks";

type Key = "metric" | "normalized" | "period" | "state" | "verification" | "method";

export function MetricsTable({ metrics, defs, selectedId, onOpen }: { metrics: MetricInstance[]; defs: Record<string, MetricDefLite>; selectedId: string | null; onOpen: (s: Selection) => void }) {
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [q, setQ] = useState("");
  const name = (m: MetricInstance) => defs[m.metricKey]?.shortName ?? m.label ?? m.metricKey;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return metrics
      .filter((m) => (!primaryOnly || m.isPrimary) && (!needle || `${m.id} ${m.metricKey} ${m.label} ${defs[m.metricKey]?.name ?? ""} ${m.rawValue}`.toLowerCase().includes(needle)))
      .sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? "")); // stable base order: newest period first
  }, [metrics, primaryOnly, q, defs]);
  // Default order: metric name, primary instance first, newest period first.
  const { sorted, sort, toggle } = useSort<MetricInstance, Key>(filtered, { key: "metric", dir: "asc" }, {
    metric: (m) => `${name(m)}|${m.isPrimary ? 0 : 1}`,
    normalized: (m) => m.normalizedValue,
    period: (m) => m.periodEnd,
    state: (m) => m.state,
    verification: (m) => m.verification,
    method: (m) => m.calculationMethod,
  });
  const primaries = metrics.filter((m) => m.isPrimary).length;

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchInput value={q} onChange={setQ} placeholder="Search metrics" />
        <Toggle checked={primaryOnly} onChange={setPrimaryOnly} label="Primary instances only" />
        <span className="num ml-auto text-[12px] text-ink-3">
          {metrics.length} instances · {primaries} primary (used for scoring)
        </span>
      </div>
      <TableFrame maxH="max-h-[60vh]">
        <table className="w-full min-w-[1120px] border-separate border-spacing-0 text-[13px]">
          <thead>
            <tr>
              <SortTh k="metric" sort={sort} onSort={toggle}>
                Metric
              </SortTh>
              <PlainTh>Raw value</PlainTh>
              <SortTh k="normalized" sort={sort} onSort={toggle} align="right">
                Normalized
              </SortTh>
              <SortTh k="period" sort={sort} onSort={toggle}>
                Period
              </SortTh>
              <SortTh k="state" sort={sort} onSort={toggle}>
                State
              </SortTh>
              <SortTh k="verification" sort={sort} onSort={toggle}>
                Verification
              </SortTh>
              <SortTh k="method" sort={sort} onSort={toggle}>
                Method
              </SortTh>
              <PlainTh>Flags</PlainTh>
              <PlainTh>Source</PlainTh>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => {
              const active = selectedId === m.id;
              return (
                <tr
                  key={m.id}
                  id={`row-${m.id}`}
                  tabIndex={0}
                  aria-selected={active}
                  onClick={() => onOpen({ kind: "metric", id: m.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen({ kind: "metric", id: m.id });
                    }
                  }}
                  className={cx("cursor-pointer outline-none transition-colors focus-visible:bg-accent-soft/50", active ? "bg-accent-soft/60" : "hover:bg-surface-2", !m.isPrimary && "text-ink-3")}
                >
                  <td className={cx("border-t border-line px-3 py-2 align-top", active && "shadow-[inset_2px_0_0_var(--accent)]")}>
                    <div className="flex items-baseline gap-2">
                      <span className="num shrink-0 font-mono text-[11px] text-ink-3">{m.id}</span>
                      <span className={cx("font-medium", m.isPrimary ? "text-ink" : "text-ink-2")}>{name(m)}</span>
                      {m.isPrimary ? (
                        <span className="text-[10.5px] font-medium uppercase tracking-wide text-accent-text" title="Primary instance — used for scoring">
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <div className="pl-[54px] font-mono text-[10.5px] text-ink-3">{m.metricKey}</div>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <span className="line-clamp-2 max-w-[180px] text-ink-2" title={m.rawValue}>
                      {m.rawValue}
                    </span>
                  </td>
                  <td className="num border-t border-line px-3 py-2 text-right align-top">
                    <span className={m.isPrimary ? "font-medium text-ink" : "text-ink-2"}>{metricValue(m.unit, m.normalizedValue)}</span>
                    <div className="text-[10.5px] text-ink-3">{m.unit.toLowerCase()}</div>
                  </td>
                  <td className="num border-t border-line px-3 py-2 align-top text-ink-2">
                    {m.periodEnd ?? "—"}
                    <div className="text-[10.5px] text-ink-3">{m.periodType.toLowerCase().replace(/_/g, " ")}</div>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <Badge tone={stateTone(m.state)}>{STATE_TEXT[m.state]}</Badge>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <Badge tone={verificationTone(m.verification)}>{VERIFICATION_TEXT[m.verification]}</Badge>
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    <span className={cx("text-[12.5px]", isAnalystCorrected(m) ? "font-medium text-accent-text" : "text-ink-2")}>{methodText(m)}</span>
                    {m.derivation && (
                      <div className="max-w-[160px] truncate text-[11px] text-ink-3" title={m.derivation}>
                        {m.derivation}
                      </div>
                    )}
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top">
                    {m.qualityFlags.length ? (
                      <span className="block max-w-[200px] truncate text-[11.5px] text-warn" title={m.qualityFlags.join("\n")}>
                        {m.qualityFlags.length > 1 ? `${m.qualityFlags.length} flags · ` : ""}
                        {m.qualityFlags[0]!.split(":")[0]!.replace(/_/g, " ").toLowerCase()}
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </td>
                  <td className="border-t border-line px-3 py-2 align-top text-[12px] text-ink-2">
                    {m.sourceId ? (
                      <span className="whitespace-nowrap">
                        <span className="font-mono text-[11px]">{m.sourceId}</span>
                        {m.location && !/^https?:/.test(m.location) && <span className="text-ink-3"> · {m.location}</span>}
                      </span>
                    ) : (
                      <span className="text-ink-3">{m.calculationMethod === "DERIVED" ? "Computed" : "—"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={9} className="border-t border-line px-3 py-8 text-center text-ink-3">
                  {metrics.length ? "No metrics match." : "No quantitative metrics were disclosed."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableFrame>
    </div>
  );
}
