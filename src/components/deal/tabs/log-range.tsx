/**
 * Market ranges on a shared LOG scale (§32). Low–high bars per method, with an
 * optional single-value marker (the deck TAM) drawn separately and dashed so
 * it is never read as one of the reconstructed ranges.
 */
import { cx } from "@/components/ui";
import { compactUsd as usd } from "./shared";

export interface LogRow {
  label: string;
  sub?: string;
  low: number;
  high: number;
  primary?: boolean;
  /** Point marker (low === high) rendered as a dashed tick, e.g. the deck TAM. */
  marker?: boolean;
  caution?: boolean;
}

function decadeLabel(p: number): string {
  const units: [number, string][] = [
    [12, "T"],
    [9, "B"],
    [6, "M"],
    [3, "k"],
    [0, ""],
  ];
  const [e, s] = units.find(([e]) => p >= e) ?? [0, ""];
  return `$${Math.pow(10, p - e)}${s}`;
}

export function LogRangeChart({ rows }: { rows: LogRow[] }) {
  const vals = rows.flatMap((r) => [r.low, r.high]).filter((v) => v > 0);
  if (!vals.length) return null;
  const lo = Math.floor(Math.log10(Math.min(...vals)));
  const hi = Math.ceil(Math.log10(Math.max(...vals)));
  const span = Math.max(1, hi - lo);
  const pos = (v: number) => ((Math.log10(Math.max(v, Math.pow(10, lo))) - lo) / span) * 100;
  const ticks = Array.from({ length: span + 1 }, (_, i) => lo + i);

  return (
    <div className="text-[12.5px]">
      <div className="divide-y divide-line border-y border-line">
        {rows.map((r) => (
          <div key={r.label} className={cx("grid grid-cols-[180px_1fr_150px] items-center gap-4 py-2.5", r.primary && "bg-accent-soft/40")}>
            <div className={cx("pl-2", r.primary && "border-l-2 border-accent")}>
              <div className={cx("font-medium", r.marker ? "text-ink-2" : "text-ink")}>{r.label}</div>
              {r.sub && <div className="text-[11.5px] text-ink-3">{r.sub}</div>}
            </div>
            <div className="relative h-5" aria-hidden>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${((t - lo) / span) * 100}%` }} />
              ))}
              {r.marker ? (
                <div className="absolute inset-y-0 border-l-2 border-dashed border-risk" style={{ left: `${pos(r.low)}%` }} />
              ) : (
                <div
                  className={cx("absolute top-1/2 h-2 -translate-y-1/2 rounded-full", r.primary ? "bg-accent" : r.caution ? "bg-warn/60" : "bg-ink-3/70")}
                  style={{ left: `${pos(r.low)}%`, width: `max(4px, ${pos(r.high) - pos(r.low)}%)` }}
                />
              )}
            </div>
            <div className="num text-right text-ink">
              {r.marker ? usd(r.low) : `${usd(r.low)} – ${usd(r.high)}`}
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[180px_1fr_150px] gap-4 pt-1.5">
        <div className="pl-2 text-[11px] text-ink-3">Log scale, USD / year</div>
        <div className="relative h-4">
          {ticks.map((t, i) => (
            <span
              key={t}
              className={cx("num absolute text-[10.5px] text-ink-3", i === 0 ? "" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2")}
              style={{ left: `${((t - lo) / span) * 100}%` }}
            >
              {decadeLabel(t)}
            </span>
          ))}
        </div>
        <div />
      </div>
    </div>
  );
}
