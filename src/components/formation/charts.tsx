/**
 * Formation charts — dependency-free SVG, single series each (the title names
 * it, so no legend). Recessive grid, one axis, native <title> tooltips on every
 * mark; the values are always also available as text next to the chart.
 */
import { cx } from "@/components/ui";

/** Score over attempts: individual scores as small dots, rolling mean (5) as the line. */
export function ScoreTrend({ series, className }: { series: { i: number; at: string; score: number; rolling: number }[]; className?: string }) {
  const W = 560;
  const H = 168;
  const P = { t: 12, r: 12, b: 24, l: 34 };
  if (series.length < 2)
    return <div className={cx("grid h-[168px] place-items-center rounded-lg border border-dashed border-line text-[12.5px] text-ink-3", className)}>The trend appears after a few graded exercises.</div>;
  const n = series.length;
  const x = (i: number) => P.l + ((i - 1) / Math.max(1, n - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v) * (H - P.t - P.b);
  const line = series.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)},${y(p.rolling).toFixed(1)}`).join(" ");
  const last = series[n - 1]!;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={cx("h-auto w-full", className)} role="img" aria-label={`Score over ${n} graded exercises; rolling mean now ${Math.round(last.rolling * 100)} of 100`}>
      {[0, 0.5, 1].map((v) => (
        <g key={v}>
          <line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} className="stroke-line" strokeWidth={1} />
          <text x={P.l - 8} y={y(v) + 3.5} textAnchor="end" className="fill-ink-3 text-[10px]">
            {Math.round(v * 100)}
          </text>
        </g>
      ))}
      <line x1={P.l} x2={W - P.r} y1={y(0.7)} y2={y(0.7)} className="stroke-line-strong" strokeWidth={1} strokeDasharray="3 3">
        <title>Correct threshold (70)</title>
      </line>
      {series.map((p) => (
        <circle key={p.i} cx={x(p.i)} cy={y(p.score)} r={3} className="fill-surface stroke-ink-3" strokeWidth={1.25}>
          <title>{`#${p.i} · ${p.at.slice(0, 10)} · score ${Math.round(p.score * 100)} · rolling ${Math.round(p.rolling * 100)}`}</title>
        </circle>
      ))}
      <path d={line} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.rolling)} r={4} className="fill-accent stroke-surface" strokeWidth={2} />
      <text x={P.l} y={H - 6} className="fill-ink-3 text-[10px]">
        #1
      </text>
      <text x={W - P.r} y={H - 6} textAnchor="end" className="fill-ink-3 text-[10px]">
        #{n}
      </text>
    </svg>
  );
}

/** Reliability curve: stated confidence (x) against observed hit rate (y); the diagonal is perfect calibration. */
export function ReliabilityChart({ bins, className }: { bins: { lo: number; hi: number; n: number; meanConfidence: number | null; hitRate: number | null }[]; className?: string }) {
  const S = 200;
  const P = 26;
  const pos = (v: number) => P + v * (S - 2 * P);
  const inv = (v: number) => S - P - v * (S - 2 * P);
  const pts = bins.filter((b) => b.n > 0 && b.meanConfidence !== null && b.hitRate !== null);
  const path = pts.map((b, k) => `${k ? "L" : "M"}${pos(b.meanConfidence!).toFixed(1)},${inv(b.hitRate!).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className={cx("h-auto w-full max-w-[240px]", className)} role="img" aria-label="Reliability curve: stated confidence versus observed hit rate">
      <rect x={P} y={P} width={S - 2 * P} height={S - 2 * P} className="fill-none stroke-line" />
      <line x1={pos(0)} y1={inv(0)} x2={pos(1)} y2={inv(1)} className="stroke-line-strong" strokeDasharray="3 3">
        <title>Perfect calibration</title>
      </line>
      {path && <path d={path} fill="none" className="stroke-accent" strokeWidth={2} strokeLinejoin="round" />}
      {pts.map((b) => (
        <circle key={b.lo} cx={pos(b.meanConfidence!)} cy={inv(b.hitRate!)} r={Math.min(8, 3.5 + Math.sqrt(b.n))} className="fill-accent stroke-surface" strokeWidth={2}>
          <title>{`Confidence ${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%: said ${Math.round(b.meanConfidence! * 100)}%, right ${Math.round(b.hitRate! * 100)}% (n = ${b.n})`}</title>
        </circle>
      ))}
      <text x={S / 2} y={S - 6} textAnchor="middle" className="fill-ink-3 text-[9.5px]">
        Stated confidence
      </text>
      <text x={9} y={S / 2} textAnchor="middle" transform={`rotate(-90 9 ${S / 2})`} className="fill-ink-3 text-[9.5px]">
        Hit rate
      </text>
      <text x={P} y={S - P + 11} textAnchor="middle" className="fill-ink-3 text-[9px]">
        0
      </text>
      <text x={S - P} y={S - P + 11} textAnchor="middle" className="fill-ink-3 text-[9px]">
        100
      </text>
    </svg>
  );
}

/** Skill estimate on a fixed 900–1800 scale: the band is ±2 RD, the tick is the estimate. */
export function RatingBar({ rating, rd, assessed, width = 160 }: { rating: number; rd: number; assessed: boolean; width?: number }) {
  const lo = 900;
  const hi = 1800;
  const p = (v: number) => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
  return (
    <div className="relative h-1.5 rounded-full bg-surface-3" style={{ width }} title={assessed ? `Estimate ${Math.round(rating)} ± ${Math.round(2 * rd)}` : "Not assessed yet"}>
      {assessed && <div className="absolute inset-y-0 rounded-full bg-accent/25" style={{ left: `${p(rating - 2 * rd)}%`, width: `${Math.max(1, p(rating + 2 * rd) - p(rating - 2 * rd))}%` }} />}
      {assessed && <div className="absolute -top-[2px] h-2.5 w-[3px] rounded-full bg-ink" style={{ left: `calc(${p(rating)}% - 1.5px)` }} />}
    </div>
  );
}
