/**
 * Dependency-free SVG charts for metric time series (traction tab).
 *
 * Single series only — the title names it, so no legend. One axis, zero
 * baseline for bars, recessive grid, selective direct labels. Every mark
 * carries a native <title> tooltip, and the raw values are always listed
 * beneath the plot (the table view), so nothing is encoded in color alone.
 */
import { cx } from "@/components/ui";

export interface SeriesPoint {
  /** Period label, e.g. "2025-08". Used on the x axis. */
  period: string;
  value: number;
  /** Display string for the normalized value, e.g. "$3.84M". */
  display: string;
  /** Raw value as disclosed, e.g. "$3.84M ARR". */
  raw?: string;
  /** Sample size behind the value, if any. */
  n?: number | null;
  /** Marks a point whose evidence is weaker (stale, inferred...). Rendered hollow. */
  weak?: boolean;
}

const W = 520;
const H = 190;
const PAD = { top: 26, right: 16, bottom: 30, left: 16 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return step * p;
}

function toTime(period: string): number | null {
  const m = period.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
  if (!m) return null;
  return Date.UTC(Number(m[1]), m[2] ? Number(m[2]) - 1 : 0, m[3] ? Number(m[3]) : 1);
}

export function SeriesChart({
  title,
  points,
  kind,
  caption,
  className,
}: {
  title: string;
  points: SeriesPoint[];
  kind?: "bar" | "line";
  caption?: string;
  className?: string;
}) {
  if (points.length < 2) return null;
  const mode = kind ?? (points.length <= 4 ? "bar" : "line");
  const values = points.map((p) => p.value);
  const hasNeg = values.some((v) => v < 0);
  const max = niceMax(Math.max(...values.map(Math.abs)));
  const min = hasNeg ? -max : 0;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

  // x positions: proportional to time when every period parses; otherwise even spacing.
  const times = points.map((p) => toTime(p.period));
  const timed = times.every((t) => t !== null) && new Set(times).size === times.length;
  const slot = innerW / points.length;
  const x = (i: number) => {
    if (mode === "bar" || !timed) return PAD.left + slot * i + slot / 2;
    const t0 = times[0]!;
    const t1 = times[times.length - 1]!;
    return PAD.left + 12 + ((times[i]! - t0) / Math.max(1, t1 - t0)) * (innerW - 24);
  };
  const barW = Math.min(56, slot * 0.46);
  const zeroY = y(0);

  // Selective direct labels: all when few points, otherwise first, last and extremes.
  const maxI = values.indexOf(Math.max(...values));
  const minI = values.indexOf(Math.min(...values));
  const labelled = (i: number) => points.length <= 6 || i === 0 || i === points.length - 1 || i === maxI || i === minI;

  return (
    <figure className={cx("min-w-0", className)}>
      <figcaption className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-medium text-ink">{title}</span>
        {caption && <span className="text-[11.5px] text-ink-3">{caption}</span>}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`${title}: ${points.map((p) => `${p.period} ${p.display}`).join(", ")}`}>
        {/* recessive grid: baseline, midline, top */}
        {[min, (min + max) / 2, max].map((g, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} className={g === 0 ? "stroke-line-strong" : "stroke-line"} strokeWidth={1} strokeDasharray={g === 0 ? undefined : "2 3"} />
          </g>
        ))}

        {mode === "bar" &&
          points.map((p, i) => {
            const top = Math.min(y(p.value), zeroY);
            const h = Math.max(1, Math.abs(zeroY - y(p.value)));
            return (
              <g key={i}>
                <title>{`${p.period}: ${p.display}${p.raw ? ` (raw: ${p.raw})` : ""}${p.n != null ? ` · n=${p.n}` : ""}`}</title>
                <rect
                  x={x(i) - barW / 2}
                  y={top}
                  width={barW}
                  height={h}
                  rx={4}
                  className={p.weak ? "fill-surface-3 stroke-ink-3" : "fill-accent"}
                  strokeWidth={p.weak ? 1.5 : 0}
                  strokeDasharray={p.weak ? "3 2" : undefined}
                />
                {/* square the baseline end so the rounded end reads as the data end */}
                {!p.weak && h > 6 && <rect x={x(i) - barW / 2} y={p.value >= 0 ? zeroY - 4 : zeroY} width={barW} height={4} className="fill-accent" />}
              </g>
            );
          })}

        {mode === "line" && (
          <>
            <polyline
              points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
              fill="none"
              className="stroke-accent"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {points.map((p, i) => (
              <g key={i}>
                <title>{`${p.period}: ${p.display}${p.raw ? ` (raw: ${p.raw})` : ""}${p.n != null ? ` · n=${p.n}` : ""}`}</title>
                <circle cx={x(i)} cy={y(p.value)} r={12} fill="transparent" />
                <circle cx={x(i)} cy={y(p.value)} r={4} className={p.weak ? "fill-bg stroke-ink-3" : "fill-accent stroke-bg"} strokeWidth={2} />
              </g>
            ))}
          </>
        )}

        {/* direct value labels (text tokens, never the series color) */}
        {points.map((p, i) =>
          labelled(i) ? (
            <text key={`v${i}`} x={x(i)} y={Math.min(y(p.value), zeroY) - 7} textAnchor="middle" className="num fill-ink" style={{ fontSize: 12, fontWeight: 600 }}>
              {p.display}
            </text>
          ) : null,
        )}
        {/* period labels */}
        {points.map((p, i) => (
          <text key={`p${i}`} x={x(i)} y={H - 10} textAnchor="middle" className="num fill-ink-3" style={{ fontSize: 11 }}>
            {p.period}
          </text>
        ))}
      </svg>
      {/* table view: raw values, periods and sample sizes, always visible */}
      <table className="mt-1 w-full text-[11.5px]">
        <tbody>
          {points.map((p, i) => (
            <tr key={i} className="border-t border-line">
              <td className="num py-1 pr-3 text-ink-3">{p.period}</td>
              <td className="num py-1 pr-3 text-right text-ink">{p.display}</td>
              <td className="py-1 pr-3 text-ink-3">{p.raw ? `raw “${p.raw}”` : ""}</td>
              <td className="num py-1 text-right text-ink-3">{p.n != null ? `n=${p.n}` : ""}</td>
              <td className="py-1 pl-2 text-right text-[11px] text-warn">{p.weak ? "weaker evidence" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
