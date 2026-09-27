/**
 * 9. CHRONOLOGY TABLE.
 *
 * Every metric observation is placed on a timeline with its basis; current
 * (ACTUAL / CURRENT / LTM), contracted (SIGNED / BOOKED) and forward-looking
 * (FORECAST / TARGET / PIPELINE) values are kept in separate groups so a
 * forecast can never be read as an actual. Flags:
 *   BASE_NOT_DISCLOSED — a forecast for a metric with no current value;
 *   HOCKEY_STICK       — forecast CAGR > 3× trailing growth (or > 50% on flat/declining history);
 *   ACTUAL_IN_FUTURE   — a value labelled actual/current dated after the analysis date.
 */
import type { MetricObservation } from "@/domain/sections";
import { metricDef } from "../metrics/dictionary";
import { toUsd } from "../metrics/normalize";
import { CONTRACTED_BASES, CURRENT_BASES, type IntegrityContext, type SeriesPoint } from "./context";
import type { ChronologyGroup, ChronologyRow, ChronologyTable, IntegrityFinding, IntegritySeverity } from "./types";
import { finding, fmtNum, isNum, monthsBetween, parseDate, round, uniqSorted } from "./util";

export const HOCKEY_STICK_MULTIPLE = 3;
const REVENUE_GROUP = ["arr", "mrr", "revenue_ttm"];

function groupOf(basis: string): ChronologyGroup {
  if ((CURRENT_BASES as readonly string[]).includes(basis)) return "CURRENT";
  if ((CONTRACTED_BASES as readonly string[]).includes(basis)) return "CONTRACTED";
  return "FORWARD";
}

/** Annual-revenue-equivalent USD for revenue keys, raw value otherwise. */
function comparable(o: { metricKey: string; value: number | null; currency: string | null; periodType: string }): number | null {
  if (!isNum(o.value)) return null;
  const def = metricDef(o.metricKey);
  let v = o.value;
  if (def?.unit === "USD") {
    const fx = toUsd(v, o.currency);
    if (!fx) return null;
    v = fx.usd;
  }
  if (o.metricKey === "mrr" || (o.metricKey === "arr" && o.periodType === "MONTHLY")) v *= 12;
  return v;
}

const baseKeys = (key: string) => (REVENUE_GROUP.includes(key) ? REVENUE_GROUP : [key]);

export function chronology(ctx: IntegrityContext): { table: ChronologyTable; findings: IntegrityFinding[] } {
  const findings: IntegrityFinding[] = [];
  const asOf = ctx.asOf;
  const rows: (ChronologyRow & { _t: number | null })[] = ctx.observations.map((o: MetricObservation) => {
    const d = parseDate(o.periodEnd) ?? parseDate(o.periodStart);
    const flags: string[] = [];
    const group = groupOf(o.basis);
    if (group === "FORWARD" && !o.periodEnd) flags.push("UNDATED_FORECAST");
    if (group === "CURRENT" && d && asOf && d.getTime() > asOf.getTime() + 31 * 864e5) flags.push("ACTUAL_IN_FUTURE");
    return {
      metricKey: o.metricKey,
      label: o.label,
      basis: o.basis,
      group,
      periodType: o.periodType,
      periodStart: o.periodStart,
      periodEnd: o.periodEnd,
      value: isNum(o.value) ? o.value : null,
      unit: o.unit,
      currency: o.currency,
      page: o.page,
      rawText: o.rawText,
      flags,
      _t: d ? d.getTime() : null,
    };
  });
  rows.sort((a, b) => {
    if (a._t !== b._t) return a._t === null ? 1 : b._t === null ? -1 : a._t - b._t;
    if (a.metricKey !== b.metricKey) return a.metricKey < b.metricKey ? -1 : 1;
    if ((a.page ?? 1e9) !== (b.page ?? 1e9)) return (a.page ?? 1e9) - (b.page ?? 1e9);
    return a.rawText < b.rawText ? -1 : a.rawText > b.rawText ? 1 : 0;
  });

  // Current base per key (instances or current observations).
  const hasCurrent = (key: string) => baseKeys(key).some((k) => !!ctx.primary(k) || ctx.currentObs(k).some((o) => isNum(o.value)));
  const hockeySticks: ChronologyTable["hockeySticks"] = [];
  const forwardByKey = new Map<string, typeof rows>();
  for (const r of rows) {
    if (r.group !== "FORWARD" || r.metricKey === "OTHER") continue;
    const k = REVENUE_GROUP.includes(r.metricKey) ? "revenue" : r.metricKey;
    const l = forwardByKey.get(k) ?? [];
    l.push(r);
    forwardByKey.set(k, l);
  }
  for (const [k, list] of forwardByKey) {
    const key = k === "revenue" ? list[0]!.metricKey : k;
    if (!hasCurrent(key)) {
      for (const r of list) r.flags.push("BASE_NOT_DISCLOSED");
      const sev: IntegritySeverity = REVENUE_GROUP.includes(key) && ctx.stageBand !== "EARLY" ? "MODERATE" : "LOW";
      findings.push(
        finding({
          kind: "FORECAST_BASE_NOT_DISCLOSED",
          module: "CHRONOLOGY",
          severity: sev,
          title: `Forecast of ${k === "revenue" ? "revenue" : (metricDef(key)?.shortName ?? key)} with no disclosed current value`,
          detail: `${list.length} forward-looking figure(s) (${[...new Set(list.map((r) => r.basis.toLowerCase()))].join(", ")}) are shown without the current actual they start from, so the implied growth cannot be checked.`,
          pages: list.map((r) => r.page),
          key: k,
        }),
      );
      continue;
    }
    // Starting point: latest current value in the key group.
    let start: SeriesPoint | null = null;
    for (const bk of baseKeys(key)) {
      for (const p of ctx.series(bk)) {
        const v = bk === "mrr" ? p.value * 12 : p.value;
        if (!start || p.date.getTime() > start.date.getTime()) start = { ...p, value: v };
      }
    }
    if (!start || start.value <= 0) continue;
    let trailing: number | null = null;
    for (const bk of baseKeys(key)) {
      const g = ctx.seriesGrowth(bk);
      if (g) {
        trailing = (Math.pow(1 + g.growthPct / 100, 12 / g.months) - 1) * 100;
        break;
      }
    }
    if (trailing === null) {
      const growthKey = REVENUE_GROUP.includes(key) ? (ctx.primary("arr_growth_yoy") ?? ctx.primary("revenue_growth_yoy")) : null;
      if (growthKey && isNum(growthKey.normalizedValue)) trailing = growthKey.normalizedValue;
    }
    let worst: { cagr: number; row: (typeof rows)[number] } | null = null;
    for (const r of list) {
      if (r._t === null) continue;
      const v = comparable({ metricKey: r.metricKey, value: r.value, currency: r.currency, periodType: r.periodType });
      if (!isNum(v) || v <= 0) continue;
      const months = monthsBetween(start.date, new Date(r._t));
      if (months < 3) continue;
      const cagr = (Math.pow(v / start.value, 12 / months) - 1) * 100;
      if (!worst || cagr > worst.cagr) worst = { cagr, row: r };
    }
    if (!worst || trailing === null) continue;
    const isStick = trailing > 0 ? worst.cagr > HOCKEY_STICK_MULTIPLE * trailing : worst.cagr > 50;
    if (!isStick) continue;
    const ratio = trailing > 0 ? worst.cagr / trailing : null;
    worst.row.flags.push("HOCKEY_STICK");
    hockeySticks.push({ metricKey: key, forecastCagrPct: round(worst.cagr, 1), trailingGrowthPct: round(trailing, 1), ratio: ratio !== null ? round(ratio, 2) : null, pages: uniqSorted([worst.row.page, start.page]) });
    findings.push(
      finding({
        kind: "HOCKEY_STICK_FORECAST",
        module: "CHRONOLOGY",
        severity: ratio === null || ratio > 6 ? "HIGH" : "MODERATE",
        title: `Forecast implies ${fmtNum(worst.cagr, 0)}%/yr vs ${fmtNum(trailing, 0)}% trailing growth`,
        detail: `${worst.row.rawText} (${worst.row.basis.toLowerCase()}, ${worst.row.periodEnd}) requires ${fmtNum(worst.cagr, 0)}% annualized growth from the latest actual ${fmtNum(start.value, 0)}; trailing growth is ${fmtNum(trailing, 0)}%${ratio !== null ? ` (${fmtNum(ratio, 1)}×)` : ""}. Ask what changes to bend the curve.`,
        pages: [worst.row.page, start.page],
        key,
      }),
    );
  }

  const future = rows.filter((r) => r.flags.includes("ACTUAL_IN_FUTURE"));
  if (future.length)
    findings.push(
      finding({
        kind: "ACTUAL_DATED_IN_FUTURE",
        module: "CHRONOLOGY",
        severity: "MODERATE",
        title: "Figures labelled actual/current are dated in the future",
        detail: `${future.map((r) => `${r.rawText} (${r.periodEnd})`).join("; ")}: a value dated after the analysis date is a forecast, whatever its label.`,
        pages: future.map((r) => r.page),
      }),
    );

  const strip = ({ _t, ...r }: (typeof rows)[number]): ChronologyRow => {
    void _t;
    return r;
  };
  return {
    table: {
      current: rows.filter((r) => r.group === "CURRENT").map(strip),
      contracted: rows.filter((r) => r.group === "CONTRACTED").map(strip),
      forward: rows.filter((r) => r.group === "FORWARD").map(strip),
      hockeySticks,
    },
    findings,
  };
}
