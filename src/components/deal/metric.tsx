import Link from "next/link";
import type { MetricInstance } from "@/domain/canonical";
import { metricDef } from "@/engine/metrics/dictionary";
import { Badge, cx } from "@/components/ui";
import { metricValue } from "@/lib/format";

/** The evidence status of a metric, as a quiet label (§86). */
export function metricEvidence(m: MetricInstance): { text: string; tone: "ok" | "neutral" | "warn" | "risk" | "unknown" } {
  if (m.state === "CONTRADICTED" || m.verification === "CONTRADICTED") return { text: "Contradicted", tone: "risk" };
  if (m.verification === "VERIFIED") return { text: "Verified", tone: "ok" };
  if (m.state === "WITHHELD") return { text: "Withheld", tone: "unknown" };
  if (m.state === "UNKNOWN") return { text: "Unknown", tone: "unknown" };
  if (m.state === "STALE") return { text: "Stale", tone: "warn" };
  if (m.calculationMethod === "DERIVED") return { text: "Derived", tone: "neutral" };
  if (m.state === "INFERRED") return { text: "Inferred", tone: "warn" };
  if (m.calculationMethod === "USER_CORRECTED") return { text: "Corrected", tone: "neutral" };
  return { text: "Company-reported", tone: "neutral" };
}

export const CORE_METRIC_ORDER = [
  "arr",
  "revenue_ttm",
  "gmv",
  "tpv",
  "mau",
  "arr_growth_yoy",
  "revenue_growth_yoy",
  "mom_growth",
  "nrr",
  "grr",
  "logo_retention",
  "d30_retention",
  "gross_margin",
  "cac_payback_months",
  "burn_multiple",
  "monthly_net_burn",
  "runway_months",
  "paying_customers",
  "customer_concentration_top1",
  "take_rate",
  "repeat_rate",
];

const GROUPS: string[][] = [
  ["arr", "revenue_ttm"],
  ["arr_growth_yoy", "revenue_growth_yoy", "mom_growth"],
  ["nrr", "grr"],
];

export function coreMetrics(metrics: MetricInstance[], max = 8): MetricInstance[] {
  const primary = metrics.filter((m) => m.isPrimary && m.normalizedValue !== null);
  const picked: MetricInstance[] = [];
  const usedGroups = new Set<number>();
  for (const k of CORE_METRIC_ORDER) {
    const m = primary.find((x) => x.metricKey === k);
    const g = GROUPS.findIndex((grp) => grp.includes(k));
    if (m && g >= 0 && usedGroups.has(g)) continue;
    if (m && g >= 0) usedGroups.add(g);
    if (m) picked.push(m);
    if (picked.length >= max) break;
  }
  return picked;
}

/** Compact metric cell used in strips and grids. */
export function MetricCell({ m, slug, className }: { m: MetricInstance; slug: string; className?: string }) {
  const def = metricDef(m.metricKey);
  const ev = metricEvidence(m);
  const small = m.qualityFlags.find((f) => f.startsWith("SMALL_SAMPLE"));
  return (
    <Link
      href={`/deals/${slug}/evidence?metric=${m.id}`}
      className={cx("group block rounded-md px-0 py-1 transition-colors", className)}
      title={`${def?.name ?? m.metricKey}\n${def?.definition ?? ""}\nRaw: ${m.rawValue}${m.periodEnd ? `\nAs of ${m.periodEnd}` : ""}${m.qualityFlags.length ? `\nFlags: ${m.qualityFlags.join("; ")}` : ""}`}
    >
      <div className="text-[12px] text-ink-3 group-hover:text-ink-2">{def?.shortName ?? m.label}</div>
      <div className="num text-[17px] font-semibold tracking-tight text-ink">{metricValue(m.unit, m.normalizedValue)}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
        <Badge tone={ev.tone} className="!text-[10.5px]">
          {ev.text}
        </Badge>
        {m.periodEnd && <span className="num">{m.periodEnd}</span>}
        {m.sampleSize !== null && <span className={cx("num", small && "text-warn")}>n={m.sampleSize}</span>}
      </div>
    </Link>
  );
}
