/**
 * 3. CROSS-SLIDE NUMERIC CONSISTENCY.
 *
 * Current-basis observations (ACTUAL / CURRENT / LTM) are grouped by metric
 * key + period; when the same metric for the same period appears on different
 * pages with different values, the difference is classified:
 *   ≤ 1% rounding (ignored) · digit transposition → TYPO (LOW) · scale slip
 *   (×10ⁿ) → TYPO (MODERATE) · differing definitions → DEFINITION (one level
 *   below the value severity) · otherwise MATERIAL_VALUE:
 *   1–5% LOW · 5–15% MODERATE · 15–40% HIGH · > 40% CRITICAL.
 * Market size, funding, founder count and headcount mentioned in claims are
 * compared with the structured fields. Model-reported inconsistencies
 * (deck forensics) are kept alongside, marked origin MODEL.
 */
import type { Claim } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import { metricDef } from "../metrics/dictionary";
import { parseScaledNumber, toUsd } from "../metrics/normalize";
import { CURRENT_BASES, type IntegrityContext } from "./context";
import type { ContradictionClass, CrossSlideInconsistency, IntegrityFinding, IntegritySeverity } from "./types";
import { arr, finding, fmtNum, hash, isNum, isoMonth, moneyUsd, parseDate, round, shiftSeverity, str, uniqSorted } from "./util";

export function valueConflictSeverity(relPct: number): IntegritySeverity | null {
  if (relPct <= 1) return null;
  if (relPct <= 5) return "LOW";
  if (relPct <= 15) return "MODERATE";
  if (relPct <= 40) return "HIGH";
  return "CRITICAL";
}

function digits(v: number): string {
  return Math.abs(v).toString().replace(".", "").replace(/^0+/, "").replace(/0+$/, "");
}

/** Same significant digits in a different order (4.25 vs 4.52). */
export function isTransposition(a: number, b: number): boolean {
  const da = digits(a);
  const db = digits(b);
  if (da === db || da.length !== db.length || da.length < 2) return false;
  return [...da].sort().join("") === [...db].sort().join("");
}

/** Ratio is a power of ten (unit slip: $4.2k vs $4.2M). */
export function isScaleSlip(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  const r = Math.max(a, b) / Math.min(a, b);
  const k = Math.round(Math.log10(r));
  return k >= 1 && Math.abs(r / 10 ** k - 1) < 0.02;
}

function comparable(o: MetricObservation): number | null {
  if (!isNum(o.value)) return null;
  const def = metricDef(o.metricKey);
  if (def?.unit === "USD" || o.unit === "USD_OR_CURRENCY") {
    const fx = toUsd(o.value, o.currency);
    if (!fx) return null;
    return o.metricKey === "arr" && o.periodType === "MONTHLY" ? fx.usd * 12 : fx.usd;
  }
  return o.value;
}

const normDef = (o: MetricObservation) => `${str(o.definitionAsStated).toLowerCase().trim()}|${arr(o.components).map((c) => c.toLowerCase().trim()).sort().join(",")}`;

function classify(values: number[], defsDiffer: boolean): { cls: ContradictionClass; severity: IntegritySeverity | null; rel: number } {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const rel = max !== 0 ? ((max - min) / Math.abs(max)) * 100 : 0;
  if (rel <= 1) return { cls: "ROUNDING", severity: null, rel };
  if (values.length === 2 && isTransposition(values[0]!, values[1]!)) return { cls: "TYPO", severity: "LOW", rel };
  if (values.length === 2 && isScaleSlip(values[0]!, values[1]!)) return { cls: "TYPO", severity: "MODERATE", rel };
  const sev = valueConflictSeverity(rel);
  if (defsDiffer) return { cls: "DEFINITION", severity: sev ? (shiftSeverity(sev, -1) ?? "LOW") : null, rel };
  return { cls: "MATERIAL_VALUE", severity: sev, rel };
}

function claimNumber(c: Claim): number | null {
  const fromValue = c.valueText ? parseScaledNumber(c.valueText) : null;
  return fromValue ?? parseScaledNumber(c.statement);
}

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

export function crossSlide(ctx: IntegrityContext): { items: CrossSlideInconsistency[]; findings: IntegrityFinding[] } {
  const items: CrossSlideInconsistency[] = [];

  /* Observations: same metric + period on different pages ------------------- */
  const groups = new Map<string, MetricObservation[]>();
  for (const o of ctx.observations) {
    if (!(CURRENT_BASES as readonly string[]).includes(o.basis) || o.state === "WITHHELD" || !isNum(o.value)) continue;
    const keyPart = o.metricKey === "OTHER" ? `OTHER:${str(o.label).toLowerCase().replace(/\s+/g, " ").trim()}` : o.metricKey;
    const period = isoMonth(parseDate(o.periodEnd)) ?? "undated";
    const k = `${keyPart}|${period}`;
    const l = groups.get(k) ?? [];
    l.push(o);
    groups.set(k, l);
  }
  for (const [k, list] of [...groups.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const pages = new Set(list.map((o) => o.page ?? -1));
    if (pages.size < 2) continue;
    const vals = list.map((o) => ({ o, v: comparable(o) })).filter((x): x is { o: MetricObservation; v: number } => x.v !== null);
    const distinct = [...new Set(vals.map((x) => round(x.v, 6)))];
    if (distinct.length < 2) continue;
    // Only values that actually sit on different pages count as cross-slide.
    const byPage = new Map<number, number>();
    for (const x of vals) if (!byPage.has(x.o.page ?? -1)) byPage.set(x.o.page ?? -1, x.v);
    const pageValues = [...new Set([...byPage.values()].map((v) => round(v, 6)))];
    if (pageValues.length < 2) continue;
    const defsDiffer = new Set(list.map(normDef)).size > 1 || new Set(list.map((o) => o.periodType)).size > 1;
    const { cls, severity, rel } = classify(pageValues, defsDiffer);
    if (!severity) continue;
    const [keyPart, period] = k.split("|") as [string, string];
    const name = keyPart.startsWith("OTHER:") ? keyPart.slice(6) : (metricDef(keyPart)?.shortName ?? keyPart);
    items.push({
      id: `XS-${hash(k)}`,
      origin: "COMPUTED",
      topic: name,
      metricKey: keyPart.startsWith("OTHER:") ? null : keyPart,
      periodEnd: period === "undated" ? null : period,
      pages: uniqSorted(list.map((o) => o.page)),
      claimIds: [],
      values: list.map((o) => `${o.rawText}${o.page !== null ? ` (p. ${o.page})` : ""}`),
      relativeDifferencePct: round(rel, 2),
      class: cls,
      severity,
      detail:
        cls === "TYPO"
          ? `${name} for ${period} differs between pages by what looks like a ${isScaleSlip(pageValues[0]!, pageValues[1]!) ? "unit/scale slip" : "digit transposition"}; confirm which figure is right.`
          : cls === "DEFINITION"
            ? `${name} for ${period} differs by ${fmtNum(rel, 1)}% between pages and is defined differently on each (definition, components or period type).`
            : `${name} for ${period} is stated with values ${fmtNum(rel, 1)}% apart on different pages.`,
    });
  }

  /* Claims vs structured fields --------------------------------------------- */
  const dm = ctx.deal.deckMarket;
  const f = ctx.deal.financing;
  const compareField = (topic: string, claims: Claim[], fieldValue: number | null, fieldLabel: string, relTolerance = 2) => {
    if (fieldValue === null || fieldValue <= 0) return;
    for (const c of claims) {
      const n = claimNumber(c);
      if (!isNum(n) || n <= 0) continue;
      const rel = (Math.abs(n - fieldValue) / Math.max(n, fieldValue)) * 100;
      if (rel <= relTolerance) continue;
      const scale = isScaleSlip(n, fieldValue);
      const sev: IntegritySeverity | null = scale ? "MODERATE" : valueConflictSeverity(rel);
      if (!sev) continue;
      items.push({
        id: `XS-${hash(`${topic}|${c.id}`)}`,
        origin: "COMPUTED",
        topic,
        metricKey: null,
        periodEnd: null,
        pages: ctx.claimPages(c),
        claimIds: [c.id],
        values: [`${c.valueText ?? c.statement}${ctx.claimPages(c).length ? ` (p. ${ctx.claimPages(c).join(", ")})` : ""}`, `${fieldLabel}: ${fieldValue.toLocaleString("en-US")}`],
        relativeDifferencePct: round(rel, 2),
        class: scale ? "TYPO" : "MATERIAL_VALUE",
        severity: sev,
        detail: `${topic} in claim ${c.id} (${fmtNum(n, 0)}) differs from ${fieldLabel} (${fmtNum(fieldValue, 0)}) by ${fmtNum(rel, 1)}%.`,
      });
    }
  };
  const marketClaims = (re: RegExp) => ctx.claims.filter((c) => (c.category === "MARKET" || re.test(c.statement)) && re.test(`${c.statement} ${c.valueText ?? ""}`));
  compareField("TAM", marketClaims(/\b(TAM|total addressable)\b/i), moneyUsd(dm?.tam), "deck TAM");
  compareField("SAM", marketClaims(/\b(SAM|serviceable (addressable|available))\b/i), moneyUsd(dm?.sam), "deck SAM");
  compareField("SOM", marketClaims(/\b(SOM|serviceable obtainable|obtainable)\b/i), moneyUsd(dm?.som), "deck SOM");
  const fundingClaims = ctx.claims.filter((c) => c.category === "FUNDING");
  compareField("Total raised to date", fundingClaims.filter((c) => /\b(raised|to date|total funding|funded with)\b/i.test(c.statement) && !/\braising\b/i.test(c.statement)), moneyUsd(f?.totalRaisedToDate), "financing.totalRaisedToDate");
  compareField("Round size", fundingClaims.filter((c) => /\b(raising|round of|seeking|this round)\b/i.test(c.statement)), moneyUsd(f?.raiseAmount), "financing.raiseAmount");

  const foundersCount = arr(ctx.deal.foundersFromDeck).length;
  if (foundersCount > 0)
    for (const c of ctx.claims.filter((x) => x.category === "TEAM")) {
      const m = /\b(\d+|one|two|three|four|five|six|seven|eight)\s+(?:co-?founders|founders)\b/i.exec(c.statement);
      if (!m) continue;
      const n = /\d/.test(m[1]!) ? Number(m[1]) : (WORD_NUM[m[1]!.toLowerCase()] ?? null);
      if (n === null || n === foundersCount) continue;
      items.push({
        id: `XS-${hash(`founders|${c.id}`)}`,
        origin: "COMPUTED",
        topic: "Founders",
        metricKey: null,
        periodEnd: null,
        pages: ctx.claimPages(c),
        claimIds: [c.id],
        values: [c.statement, `founders listed on the team slide: ${foundersCount}`],
        relativeDifferencePct: null,
        class: "MATERIAL_VALUE",
        severity: "MODERATE",
        detail: `Claim ${c.id} mentions ${n} founders; the team slide lists ${foundersCount}.`,
      });
    }

  const hc = ctx.primary("headcount");
  if (hc && isNum(hc.normalizedValue))
    compareField(
      "Headcount",
      ctx.claims.filter((c) => /\b\d{1,5}\s+(?:employees|ftes?|people|team members|staff)\b/i.test(c.statement) && ["TEAM", "OTHER", "METRIC"].includes(c.category)),
      hc.normalizedValue,
      `headcount metric ${hc.id}`,
      10,
    );

  /* Model-reported (deck forensics) ------------------------------------------- */
  for (const x of arr(ctx.deal.forensics?.crossSlideInconsistencies)) {
    const lvl = x.severity === "CRITICAL" ? "HIGH" : x.severity;
    items.push({
      id: `XS-M-${hash(`${x.topic}|${arr(x.pages).join(",")}|${arr(x.values).join("|")}`)}`,
      origin: "MODEL",
      topic: str(x.topic),
      metricKey: null,
      periodEnd: null,
      pages: uniqSorted(arr(x.pages)),
      claimIds: [],
      values: arr(x.values),
      relativeDifferencePct: null,
      class: "MATERIAL_VALUE",
      severity: lvl ?? "LOW",
      detail: str(x.detail),
    });
  }

  const findings: IntegrityFinding[] = items
    .filter((i) => i.severity)
    .map((i) => {
      const obsMetricIds = i.metricKey ? ctx.metrics.filter((m) => m.metricKey === i.metricKey && i.pages.includes(ctx.metricPage(m) ?? -1)).map((m) => m.id) : [];
      return finding({
        kind: i.origin === "MODEL" ? "CROSS_SLIDE_MODEL" : i.class === "TYPO" ? "CROSS_SLIDE_TYPO" : i.class === "DEFINITION" ? "CROSS_SLIDE_DEFINITION" : "CROSS_SLIDE_VALUE_CONFLICT",
        module: "CROSS_SLIDE",
        origin: i.origin,
        severity: i.severity!,
        title: `${i.topic}: ${i.values.slice(0, 3).join(" vs ")}`,
        detail: i.detail,
        metricIds: obsMetricIds,
        claimIds: i.claimIds,
        pages: i.pages,
        key: i.id,
      });
    });
  return { items, findings };
}
