/**
 * Shared building blocks for the read-mostly deal tabs (Product, Founders,
 * Market, Competition, Traction, GTM, Economics). Server-safe: no hooks.
 *
 * Typography and hairlines do the work; containers are used sparingly.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import type { Claim, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { Badge, cx } from "@/components/ui";
import { DimensionList } from "@/components/deal/dimension-list";
import { RichText } from "@/components/deal/rich-text";
import { EVIDENCE_LABEL_TEXT, evidenceLabelTone, titleCase, type Tone } from "@/lib/format";

/* ---------------------------------------------------------------- */
/* Page scaffolding                                                   */
/* ---------------------------------------------------------------- */

export function TabMain({ children }: { children: ReactNode }) {
  return <main className="mx-auto max-w-[1180px] space-y-12 px-8 py-8">{children}</main>;
}

/** A quiet one-line empty state. Never a card. */
export function Quiet({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("text-[13px] text-ink-3", className)}>{children}</p>;
}

/** Model-written prose, with evidence refs linkified. Falls back to an em dash. */
export function Prose({ text, slug, className }: { text: string | null | undefined; slug: string; className?: string }) {
  if (!text) return <span className="text-ink-3">—</span>;
  return <RichText text={text} slug={slug} className={className} />;
}

/** Label / value rows on hairlines. */
export function Fields({ rows, labelWidth = 180 }: { rows: { k: ReactNode; v: ReactNode }[]; labelWidth?: number }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-6 py-2.5" style={{ gridTemplateColumns: `${labelWidth}px 1fr` }}>
          <dt className="text-[12.5px] text-ink-3">{r.k}</dt>
          <dd className="text-ink-2">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

const LAYER_LABEL = { fact: "Fact", interpretation: "Interpretation", implication: "Implication" } as const;

/**
 * FACT / INTERPRETATION / IMPLICATION — separates what was observed from what
 * the analysis reads into it. Omitted layers are simply not rendered.
 */
export function Layers({ fact, interpretation, implication }: { fact?: ReactNode; interpretation?: ReactNode; implication?: ReactNode }) {
  const layers = (["fact", "interpretation", "implication"] as const).filter((k) => ({ fact, interpretation, implication })[k]);
  if (!layers.length) return null;
  return (
    <div className={cx("grid gap-6", layers.length === 3 ? "md:grid-cols-3" : layers.length === 2 ? "md:grid-cols-2" : "")}>
      {layers.map((k) => (
        <div key={k} className="border-l border-line pl-4">
          <div className="t-eyebrow mb-1">{LAYER_LABEL[k]}</div>
          <div className="text-ink-2">{{ fact, interpretation, implication }[k]}</div>
        </div>
      ))}
    </div>
  );
}

/** Wrapper that gives a table hairline framing and horizontal overflow on narrow screens. */
export function TableFrame({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  return (
    <div className="overflow-x-auto border-b border-line">
      <table className="w-full border-collapse text-[13px]" style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Formatting                                                         */
/* ---------------------------------------------------------------- */

/** USD with three significant digits and no padded zeros: $4.2B, $6.94B, $38B, $775M, $4.1k. */
export function compactUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  const f = (x: number) => String(parseFloat(x.toPrecision(3)));
  if (a >= 1e12) return `${sign}$${f(a / 1e12)}T`;
  if (a >= 1e9) return `${sign}$${f(a / 1e9)}B`;
  if (a >= 1e6) return `${sign}$${f(a / 1e6)}M`;
  if (a >= 1e3) return `${sign}$${f(a / 1e3)}k`;
  return `${sign}$${a.toFixed(0)}`;
}

/** titleCase for enum values, keeping acronyms upper-case (AI_AGENT → "AI agent", TTM → "TTM"). */
export function enumLabel(s: string | null | undefined): string {
  if (!s) return "—";
  if (/^(TTM|LOI|IP|AI|API|GTM|PMF|SMB|PLG)$/.test(s)) return s;
  return titleCase(s).replace(/\bAi\b/g, "AI").replace(/\bIp\b/g, "IP");
}

/* ---------------------------------------------------------------- */
/* Tones for controlled vocabularies                                  */
/* ---------------------------------------------------------------- */

export function ratingTone(r: string | null | undefined): Tone {
  switch (r) {
    case "EXCEPTIONAL":
    case "STRONG":
      return "ok";
    case "ADEQUATE":
      return "neutral";
    case "BELOW_BAR":
      return "warn";
    case "WEAK":
      return "risk";
    default:
      return "unknown";
  }
}

export function ratingLabel(r: string): string {
  return r === "INSUFFICIENT_EVIDENCE" ? "Insufficient evidence" : titleCase(r);
}

/* ---------------------------------------------------------------- */
/* Claims                                                             */
/* ---------------------------------------------------------------- */

export function ClaimRow({ claim, slug }: { claim: Claim; slug: string }) {
  const label = evidenceLabel(claim);
  return (
    <li className="grid grid-cols-[76px_128px_1fr] items-baseline gap-3 border-t border-line py-2 first:border-t-0">
      <Link href={`/deals/${slug}/evidence?claim=${claim.id}`} className="font-mono text-[11px] text-ink-3 hover:text-accent-text">
        {claim.id}
      </Link>
      <span>
        <Badge tone={evidenceLabelTone(label)}>{EVIDENCE_LABEL_TEXT[label] ?? titleCase(label)}</Badge>
      </span>
      <span className="text-ink-2">
        {claim.statement}
        {claim.limitations && <span className="mt-0.5 block text-[12px] text-ink-3">Limitation: {claim.limitations}</span>}
      </span>
    </li>
  );
}

export function ClaimList({ claims, slug }: { claims: Claim[]; slug: string }) {
  return (
    <ul className="border-y border-line">
      {claims.map((c) => (
        <ClaimRow key={c.id} claim={c} slug={slug} />
      ))}
    </ul>
  );
}

/* ---------------------------------------------------------------- */
/* Metrics                                                            */
/* ---------------------------------------------------------------- */

/** All instances of a metric key, oldest first (undated last). */
export function instancesOf(metrics: MetricInstance[], key: string): MetricInstance[] {
  return metrics
    .filter((m) => m.metricKey === key)
    .sort((a, b) => (a.periodEnd ?? "9999").localeCompare(b.periodEnd ?? "9999"));
}

/** The primary (scored) instance of a metric key, if any. */
export function primaryOf(metrics: MetricInstance[], key: string): MetricInstance | undefined {
  return metrics.find((m) => m.metricKey === key && m.isPrimary) ?? metrics.find((m) => m.metricKey === key);
}

/** Human text for engine quality flags (normalize.ts / metrics/derive.ts). */
export function flagText(flag: string): { text: string; tone: Tone } {
  const code = flag.match(/^[A-Z0-9_]+/)?.[0] ?? flag;
  let rest = flag.slice(code.length).replace(/^[:\s]+/, "").trim();
  if (rest.startsWith("(") && rest.endsWith(")")) rest = rest.slice(1, -1);
  switch (code) {
    case "DEFINITION_NOT_STATED":
      return { text: "Definition not stated by the company", tone: "warn" };
    case "NO_AS_OF_DATE":
      return { text: "No as-of date disclosed", tone: "warn" };
    case "STALE":
      return { text: `Stale — ${rest.replace(/\(max (\d+)\)/, "(dictionary maximum $1)")}`, tone: "warn" };
    case "SAMPLE_SIZE_UNKNOWN":
      return { text: `Sample size not disclosed${rest ? ` — ${rest.replace("min", "minimum")} required` : ""}`, tone: "warn" };
    case "SMALL_SAMPLE":
      return { text: `Small sample — ${rest.replace("<", "below minimum")}`, tone: "warn" };
    case "CAC_LOADING_UNVERIFIED":
      return { text: "CAC loading unverified — not shown to be fully loaded (salaries, commissions, founder selling time)", tone: "warn" };
    case "COGS_COMPOSITION_UNVERIFIED":
      return { text: "COGS composition unverified — hosting, inference, support and delivery costs not confirmed", tone: "warn" };
    case "EXTRACTION_MISMATCH":
      return { text: `Extraction mismatch — ${rest}`, tone: "risk" };
    case "VALUE_FROM_RAW_TEXT":
      return { text: "Value parsed deterministically from the raw text", tone: "neutral" };
    case "FRACTION_CONVERTED_TO_PERCENT":
      return { text: "Fraction converted to percent", tone: "neutral" };
    case "UNSUPPORTED_CURRENCY":
      return { text: `Unsupported currency — ${rest}; value not normalized`, tone: "risk" };
    case "MONTHLY_FIGURE_LABELLED_ARR":
      return { text: "Monthly figure labelled ARR — annualized ×12; treat as run-rate", tone: "warn" };
    case "INCONSISTENT_WITH_INPUTS":
      return { text: `Inconsistent with its own inputs — ${rest}`, tone: "risk" };
    case "BURN_ASSUMED_CONSTANT_OVER_PERIOD":
      return { text: "Burn assumed constant over the period", tone: "neutral" };
    case "RUN_RATE_FROM_MRR":
      return { text: "Run-rate derived from MRR × 12", tone: "neutral" };
    case "MEAN_NOT_MEDIAN":
      return { text: "Mean, not median — skewed by large accounts", tone: "neutral" };
    default:
      if (code === "FX_CONVERTED") return { text: `Currency converted: ${rest}`, tone: "neutral" };
      return { text: titleCase(code) + (rest ? ` — ${rest}` : ""), tone: "warn" };
  }
}

export function FlagList({ flags, className }: { flags: string[]; className?: string }) {
  if (!flags.length) return null;
  return (
    <ul className={cx("space-y-0.5 text-[12px]", className)}>
      {flags.map((f) => {
        const t = flagText(f);
        return (
          <li key={f} className={cx("flex gap-1.5", t.tone === "risk" ? "text-risk" : t.tone === "warn" ? "text-warn" : "text-ink-3")}>
            <span aria-hidden>{t.tone === "neutral" ? "·" : "!"}</span>
            <span>{t.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Period text for a metric instance: "2025-08 → 2026-08", "as of 2026-08", or "undated". */
export function periodText(m: MetricInstance): string {
  if (m.periodStart && m.periodEnd) return `${m.periodStart} → ${m.periodEnd}`;
  if (m.periodEnd) return m.periodEnd;
  return "undated";
}

/* ---------------------------------------------------------------- */
/* Dimension detail                                                   */
/* ---------------------------------------------------------------- */

/** One operating-quality dimension, reusing the Overview's DimensionList (click to expand the calculation). */
export function DimensionDetail({ d, id, slug }: { d: DerivedAnalysis; id: string; slug: string }) {
  const dims = d.dimensions.filter((x) => x.id === id);
  if (!dims.length) return <Quiet>This dimension was not scored in this analysis.</Quiet>;
  return <DimensionList dims={dims} slug={slug} peerGroup={d.peerGroup.name} weights={d.operatingQuality.weights} />;
}
