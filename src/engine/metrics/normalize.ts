/**
 * Deterministic normalization of extracted metric observations into
 * canonical MetricInstances. The model extracts; code decides the number.
 */
import type { MetricInstance } from "@/domain/canonical";
import { FORWARD_BASES, type MetricObservation } from "@/domain/sections";
import type { DataState } from "@/domain/enums";
import { metricDef, type MetricUnit } from "./dictionary";
import { FX_TABLE } from "../config/fx";

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  mio: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  md: 1e9,
  mds: 1e9,
  mrd: 1e9,
  milliard: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};
const scaleOf = (w: string) => SCALE[w.toLowerCase().replace(/s$/, "")] ?? SCALE[w.toLowerCase()] ?? 1;

/**
 * Parse the single numeric quantity in a raw text like "$4.2M", "€850k",
 * "1,250 customers", "120%". Returns null when there is not exactly one
 * number (ambiguous) — callers then keep the model's value and flag it.
 */
export function parseScaledNumber(raw: string): number | null {
  return parseScaledDetail(raw)?.value ?? null;
}

/**
 * The parse with what it relied on: `scaled` when a scale word was recognised ("M", "millions",
 * "Md", "k€"…), `commaGroup` when the number used a comma group that a French deck could mean as
 * a decimal ("1,250 M€"). A currency glued to the scale ("MEUR", "k€", "M$") is accepted.
 */
export function parseScaledDetail(raw: string): { value: number; scaled: boolean; commaGroup: boolean } | null {
  const text = raw.replace(/\u00a0|\u202f/g, " ");
  const re = /(-?\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|-?\d+,\d{1,2}(?!\d)|-?\d+(?:\.\d+)?)\s*(thousands?|millions?|milliards?|billions?|trillions?|mds?|mrd|mio|bn|mn|mm|md|k|m|b|t)?(?:\s*(?:eur|usd|gbp|chf|€|\$|£))?(?![a-z])/gi;
  const matches = [...text.matchAll(re)];
  // Ignore bare years (e.g. "ARR 2025: $4.2M") when another number is present.
  const meaningful = matches.filter((m) => !/^(19|20)\d{2}$/.test(m[1]!.replace(/[,\s]/g, "")) || matches.length === 1);
  if (meaningful.length !== 1) return null;
  const m = meaningful[0]!;
  const tok = m[1]!;
  const decimalComma = /^-?\d+,\d{1,2}$/.test(tok);
  const n = Number(decimalComma ? tok.replace(",", ".") : tok.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const scale = m[2] ? scaleOf(m[2]) : 1;
  return { value: n * scale, scaled: !!m[2], commaGroup: /\d,\d{3}/.test(tok) };
}

/** Conversion factor from the unit named in raw text to the dictionary's time unit. */
const TIME_UNITS: [RegExp, number][] = [
  [/^(minutes?|mins?)$/, 1 / 1440],
  [/^(hours?|hrs?|h)$/, 1 / 24],
  [/^(days?|d)$/, 1],
  [/^(weeks?|wks?|wk|w)$/, 7],
  [/^(months?|mos?|mths?)$/, 30.44],
  [/^(years?|yrs?|yr|y)$/, 365.25],
];

function unitDays(u: string): number | null {
  const x = u.toLowerCase();
  for (const [re, d] of TIME_UNITS) if (re.test(x)) return d;
  return null;
}

/**
 * Conversion factor from the unit named in raw text to the dictionary's time unit.
 * The unit attached to the first number wins ("90 days (about 3 months)" is days);
 * abbreviations (mo, wks, hrs) are recognised.
 */
export function timeFactor(raw: string, target: "DAYS" | "MONTHS"): number {
  const t = raw.toLowerCase();
  const attached = /\d(?:[\d.,]*)\s*-?\s*(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|wk|months?|mos?|mths?|years?|yrs?|yr)\b/.exec(t);
  let inDays = attached ? unitDays(attached[1]!) : null;
  if (inDays === null) {
    const loose = /\b(minutes?|mins?|hours?|hrs?|days?|weeks?|wks?|months?|mos?|years?|yrs?)\b/.exec(t);
    inDays = loose ? unitDays(loose[1]!) : null;
  }
  if (inDays === null) return 1;
  return target === "DAYS" ? inDays : inDays / 30.44;
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", US$: "USD", "US $": "USD", "€": "EUR", EURO: "EUR", EUROS: "EUR", "£": "GBP", "¥": "JPY", "CHF.": "CHF", "C$": "CAD", CA$: "CAD", A$: "AUD", AU$: "AUD", "₹": "INR" };

export function toUsd(amount: number, currency: string | null | undefined): { usd: number; converted: boolean; rate: number } | null {
  const raw = (currency ?? "USD").toUpperCase().trim();
  const cur = CURRENCY_SYMBOLS[raw] ?? raw;
  if (cur === "USD") return { usd: amount, converted: false, rate: 1 };
  const rate = FX_TABLE.rates[cur];
  if (!rate) return null;
  return { usd: amount * rate, converted: true, rate };
}

/** Whole months between two instants, in UTC (independent of the server time zone). */
function monthsBetween(a: Date, b: Date) {
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

export interface PeriodBounds {
  start: Date;
  end: Date;
  precision: "DAY" | "MONTH" | "QUARTER" | "YEAR";
}

/** Parse "2026-06-30", "2026-06", "2026-Q2", "Q2 2026", "FY2026", "2026". */
const MONTHS: [RegExp, number][] = [
  [/^(jan|janv|janvier|january)$/, 0],
  [/^(feb|fev|fév|févr|fevr|février|fevrier|february)$/, 1],
  [/^(mar|mars|march)$/, 2],
  [/^(apr|avr|avril|april)$/, 3],
  [/^(may|mai)$/, 4],
  [/^(jun|juin|june)$/, 5],
  [/^(jul|juil|juillet|july)$/, 6],
  [/^(aug|aou|aoû|août|aout|august)$/, 7],
  [/^(sep|sept|septembre|september)$/, 8],
  [/^(oct|octobre|october)$/, 9],
  [/^(nov|novembre|november)$/, 10],
  [/^(dec|déc|decembre|décembre|december)$/, 11],
];
function monthIndex(w: string): number | null {
  const x = w.toLowerCase();
  return MONTHS.find(([re]) => re.test(x))?.[1] ?? null;
}

export function parsePeriodBounds(s: string | null | undefined): PeriodBounds | null {
  if (!s) return null;
  const t = s.trim();
  const q = /^(?:(\d{4})\s*-?\s*Q([1-4])|Q([1-4])\s*-?\s*(\d{4}))/i.exec(t);
  if (q) {
    const y = Number(q[1] ?? q[4]);
    const qi = Number(q[2] ?? q[3]);
    return { start: new Date(Date.UTC(y, (qi - 1) * 3, 1)), end: new Date(Date.UTC(y, qi * 3, 0)), precision: "QUARTER" };
  }
  // "Jun 2025", "June 2025", "juin 2025", "Aug-26".
  const named = /^([a-zéû]{3,9})\.?[\s-]+(\d{4}|\d{2})$/i.exec(t);
  if (named) {
    const mo = monthIndex(named[1]!);
    if (mo === null) return null;
    const y = named[2]!.length === 2 ? 2000 + Number(named[2]) : Number(named[2]);
    return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo, 28)), precision: "MONTH" };
  }
  // "FY24" (two-digit fiscal year).
  const fy2 = /^FY\s*'?(\d{2})$/i.exec(t);
  if (fy2) {
    const y = 2000 + Number(fy2[1]);
    return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 28)), precision: "YEAR" };
  }
  const m = /^(?:FY\s*)?(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/i.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  if (m[2] && m[3]) {
    const mo = Number(m[2]) - 1;
    const day = Number(m[3]);
    const d = new Date(Date.UTC(y, mo, day));
    // Reject impossible dates ("2026-02-30") instead of rolling them into the next month.
    return Number.isNaN(d.getTime()) || d.getUTCMonth() !== mo || d.getUTCDate() !== day ? null : { start: d, end: d, precision: "DAY" };
  }
  if (m[2]) {
    const mo = Number(m[2]) - 1;
    if (mo < 0 || mo > 11) return null;
    return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo, 28)), precision: "MONTH" };
  }
  return { start: new Date(Date.UTC(y, 0, 1)), end: new Date(Date.UTC(y, 11, 28)), precision: "YEAR" };
}

/** Period end date (conventional day 28 for month precision, last day for quarters). */
export function parsePeriodDate(s: string | null | undefined): Date | null {
  return parsePeriodBounds(s)?.end ?? null;
}

const SUB_TEAM = /\b(aes?|account executives?|sales ?reps?|sdrs?|bdrs?|salespeople|sales (team|force|people)|engineers?|developers?|devs|csms?|customer success (managers?|team)|support (agents?|staff)|designers?|data scientists?|researchers?|sales engineers?)\b/i;
const WHOLE_COMPANY = /\b(total|company|employees|ftes?|full[- ]time|team of \d+\s*(people|employees)?\s*[.,;]?$|headcount|staff of)\b/i;

/** "7 AEs" or "sales team of 12" describes a function, not the company's headcount. */
const MONTHLY_MARKER = /\b(mrr|monthly|per month|a month|each month|every month|par mois|mensuel(?:le)?s?)\b|\/\s*mo(?:nth)?\b/i;

/**
 * True when the figure's own words state a monthly amount (never inferred from the period type alone).
 * The excerpt is not read: a slide often states other monthly figures ("net burn $480k / month").
 */
export function statesMonthly(o: { label?: string | null; rawText?: string | null; definitionAsStated?: string | null }): boolean {
  const t = [o.label, o.rawText, o.definitionAsStated].filter(Boolean).join(" ");
  // "ARR (MRR × 12)", "annualized", "run-rate": the figure is already annual.
  if (/(?:×|\bx)\s*12\b|annuali[sz]ed|run[- ]?rate/i.test(t)) return false;
  return MONTHLY_MARKER.test(t);
}

export function isSubTeamCount(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!SUB_TEAM.test(t)) return false;
  // "38 employees including 7 AEs" is a whole-company count that mentions a sub-team.
  const num = /\d[\d,]*\s*(employees|ftes?|people|staff)\b/i.test(t);
  return !(num && WHOLE_COMPANY.test(t));
}

const SMALL_RATE_KEYS = new Set(["default_rate", "loss_rate", "defect_rate"]);

function dictUnitToObsUnit(u: MetricUnit): MetricObservation["unit"] {
  switch (u) {
    case "USD":
      return "USD_OR_CURRENCY";
    default:
      return u;
  }
}

export interface NormalizeContext {
  asOf: Date;
  nextId: () => string;
  sourceIdForPage: (page: number | null) => string | null;
  claimIdForExcerpt?: (excerpt: string) => string | null;
}

/** Normalize one observation. Returns null for OTHER metrics (kept only in the raw audit trail). */
/**
 * Deterministic key corrections from the figure's own label (label_key_rules_v1). Extraction
 * sometimes files a figure under a neighbouring key; these rules only fire on unambiguous
 * wording and never read the surrounding excerpt. Returns the corrected key, null to keep the
 * figure only in the raw audit trail, or undefined when no rule applies.
 */
export function keyFromLabel(o: Pick<MetricObservation, "metricKey" | "label" | "rawText" | "unit" | "value">): { key: string | null; reason: string } | undefined {
  const label = `${o.label ?? ""}`.toLowerCase();
  const text = `${o.label ?? ""} ${o.rawText ?? ""}`.toLowerCase();
  const k = o.metricKey as string;
  if ((k === "grr" || k === "nrr") && /\blogo\b.*\bretention\b|\bretention\b.*\blogos?\b/.test(label)) return { key: "logo_retention", reason: `"${o.label}" is logo retention, not ${k.toUpperCase()}` };
  if (k === "paying_customers" && /\bpilots?\b/.test(text) && !/\b(customers?|clients?|logos?|accounts?)\b/.test(label)) return { key: "pilots", reason: `"${o.label}" counts pilots, not paying customers` };
  if (k === "pilots" && /\b(completed|past|finished|concluded|ended|converted|to date|since)\b/.test(label)) return { key: null, reason: `"${o.label}" is a historical pilot count, not active pilots` };
  if (k === "founder_led_revenue_share" && /\b(partners?|channels?|resellers?|marketplaces?|alliances?)\b/.test(label) && !/\bfounders?\b/.test(label)) return { key: null, reason: `"${o.label}" is a channel share, not founder-led revenue` };
  if (k === "OTHER" && o.unit === "COUNT" && /^(company|total|current|full[- ]time)?\s*(headcount|employees|team size|team|ftes?|staff|people)$/.test(label.replace(/\(.*?\)/g, "").trim())) return { key: "headcount", reason: `"${o.label}" is the company headcount` };
  if (k === "OTHER" && o.unit === "PERCENT" && /\bfill rate\b|\bsell[- ]through\b|\bliquidity\b|\blistings?\b.*\b(sold|sell|sells|filled|transact(ed)?)\b/.test(label)) return { key: "fill_rate", reason: `"${o.label}" is a marketplace fill rate` };
  return undefined;
}

export function normalizeObservation(input: MetricObservation, ctx: NormalizeContext): MetricInstance | null {
  const corrected = keyFromLabel(input);
  if (corrected && corrected.key === null) return null;
  const obs: MetricObservation = corrected ? { ...input, metricKey: corrected.key as MetricObservation["metricKey"] } : input;
  if (obs.metricKey === "OTHER") return null;
  // Chronology: forecasts, targets and pipeline are never current metrics (kept in the raw audit trail).
  if ((FORWARD_BASES as readonly string[]).includes(obs.basis)) return null;
  const bounds = parsePeriodBounds(obs.periodEnd);
  // Future-dated "actuals" are dropped; a coarse period (a year, a quarter) that has started is not in the future.
  if (bounds && bounds.start.getTime() > ctx.asOf.getTime() + 31 * 864e5) return null;
  if (bounds && bounds.precision !== "YEAR" && bounds.precision !== "QUARTER" && bounds.end.getTime() > ctx.asOf.getTime() + 31 * 864e5) return null;
  // Staleness is measured from the period end, capped at the analysis date for periods still running.
  const endDate = bounds ? new Date(Math.min(bounds.end.getTime(), ctx.asOf.getTime())) : null;

  const flags: string[] = [];
  const lineage: { step: string; detail: string }[] = [
    { step: "EXTRACTED", detail: `"${obs.rawText}"${obs.page !== null ? ` on p. ${obs.page}` : ""} (${obs.sourceKind.toLowerCase()}, basis ${obs.basis.toLowerCase()}) → model value ${obs.value ?? "null"} ${obs.unit.toLowerCase()}${obs.currency ? ` ${obs.currency}` : ""}` },
  ];

  if (corrected) {
    flags.push(`KEY_FROM_LABEL: ${corrected.reason} (extracted as ${input.metricKey})`);
    lineage.push({ step: "RECLASSIFIED", detail: `${input.metricKey} → ${obs.metricKey}: ${corrected.reason}` });
  }
  // Signed / booked revenue is not ARR: reclassify to contracted ARR.
  let key: string = obs.metricKey;
  if ((obs.basis === "SIGNED" || obs.basis === "BOOKED") && (key === "arr" || key === "mrr" || key === "revenue_ttm")) {
    flags.push(`SIGNED_NOT_DEPLOYED: reported as ${key.toUpperCase()} but basis is ${obs.basis.toLowerCase()} — reclassified as contracted ARR`);
    lineage.push({ step: "RECLASSIFIED", detail: `${key} → contracted_arr (basis ${obs.basis.toLowerCase()})` });
    key = "contracted_arr";
  } else if (obs.basis === "SIGNED" || obs.basis === "BOOKED") {
    flags.push(`SIGNED_NOT_DEPLOYED: basis is ${obs.basis.toLowerCase()} — signed or booked, not necessarily live or paying`);
  }
  // A sub-team count ("7 AEs", "12 engineers") is not company headcount: kept only in the raw audit trail.
  if (key === "headcount" && isSubTeamCount(`${obs.rawText} ${obs.label} ${obs.definitionAsStated ?? ""} ${obs.excerpt}`)) return null;
  const def = metricDef(key);
  if (!def) return null;

  let value = obs.value;
  let currency = obs.currency;

  // 1. Cross-check model value against deterministic parse of the raw text.
  if (def.unit !== "PERCENT" && def.unit !== "MULTIPLE" && def.unit !== "RATIO") {
    const detail = parseScaledDetail(obs.rawText);
    const parsed = detail?.value ?? null;
    // A 1000× disagreement is a scale question: the parse wins only when it read a scale word
    // unambiguously; "15 millions d'euros" parsed without its scale, or "1,250 M€" (decimal comma?), keep the model's value.
    const ratio = parsed !== null && value !== null && parsed !== 0 ? value / parsed : null;
    const powerOf1000 = ratio !== null && ratio !== 0 && [1e3, 1e6, 1e9, 1e-3, 1e-6, 1e-9].some((f) => Math.abs(ratio / f - 1) < 0.02);
    if (powerOf1000 && (!detail!.scaled || detail!.commaGroup)) {
      flags.push(`SCALE_AMBIGUOUS: model=${value} parsed=${parsed}; model value kept`);
      lineage.push({ step: "PARSE_CHECK", detail: `parse of raw text (${parsed}) differs by a power of 1000 and its scale is not unambiguous; model value kept` });
    } else if (parsed !== null && value !== null && parsed !== 0) {
      const rel = Math.abs(value - parsed) / Math.abs(parsed);
      if (rel > 0.02) {
        flags.push(`EXTRACTION_MISMATCH: model=${value} parsed=${parsed}; parsed value used`);
        lineage.push({ step: "PARSE_OVERRIDE", detail: `model value ${value} disagreed with deterministic parse of raw text (${parsed}); parsed value used` });
        value = parsed;
      } else lineage.push({ step: "PARSE_CHECK", detail: `deterministic parse of raw text agrees (${parsed})` });
    } else if (parsed !== null && value === null && obs.state === "OBSERVED") {
      value = parsed;
      flags.push("VALUE_FROM_RAW_TEXT");
      lineage.push({ step: "PARSED", detail: `value read from raw text: ${parsed}` });
    }
  }

  // 1b. Time units: "5 minutes" is not 5 days; "6 weeks" is not 6 months.
  // The model is asked for the dictionary unit; the raw unit is applied only when the value is still in raw units
  // (it lies within the numbers written in the raw text), so "2 to 3 months" given as 75 days is not converted twice.
  if ((def.unit === "DAYS" || def.unit === "MONTHS") && value !== null) {
    const rawNums = [...obs.rawText.matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => Number(x[0].replace(",", "."))).filter((x) => Number.isFinite(x) && !(x >= 1900 && x <= 2100));
    const inRawUnits = !rawNums.length || (value >= Math.min(...rawNums) * 0.98 && value <= Math.max(...rawNums) * 1.02);
    const factor = inRawUnits ? timeFactor(obs.rawText, def.unit) : 1;
    if (!inRawUnits) lineage.push({ step: "TIME_UNIT", detail: `value ${value} is not in the raw text's units (${rawNums.join(", ")}); already in ${def.unit.toLowerCase()}` });
    if (factor !== 1) {
      flags.push(`TIME_UNIT_CONVERTED ×${+factor.toFixed(6)} from raw text`);
      lineage.push({ step: "TIME_UNIT", detail: `${value} × ${+factor.toFixed(6)} → ${def.unit.toLowerCase()}` });
      value = value * factor;
    }
  }

  // 2a. The raw text says "92%" but the value came as a fraction (0.92): the raw text wins.
  if (def.unit === "PERCENT" && value !== null && Math.abs(value) <= 1.5 && /%|percent/i.test(obs.rawText)) {
    const pct = parseScaledNumber(obs.rawText);
    if (pct !== null && Math.abs(pct) > 1.5 && Math.abs(pct - value * 100) <= Math.max(0.5, Math.abs(pct) * 0.01)) {
      lineage.push({ step: "PERCENT_SCALE", detail: `${value} given as a fraction of "${obs.rawText}" → ${pct}%` });
      value = pct;
      flags.push("FRACTION_CONVERTED_TO_PERCENT");
    }
  }
  // 2. Percent sanity: a retention/margin given as 0.92 is almost certainly 92%.
  //    Rates that are genuinely small (default, loss, defect) are never rescaled.
  if (def.unit === "PERCENT" && SMALL_RATE_KEYS.has(def.key) && value !== null && Math.abs(value) <= 1.5 && !/%|percent/i.test(obs.rawText)) {
    flags.push("PERCENT_SCALE_AMBIGUOUS: small value without a % sign kept as percent units");
  } else if (def.unit === "PERCENT" && value !== null && Math.abs(value) <= 1.5 && /%|percent/i.test(obs.rawText) === false) {
    const pct = parseScaledNumber(obs.rawText);
    if (pct === null || Math.abs(pct) <= 1.5) {
      lineage.push({ step: "PERCENT_SCALE", detail: `${value} read as a fraction → ${value * 100}%` });
      value = value * 100;
      flags.push("FRACTION_CONVERTED_TO_PERCENT");
    }
  }

  // 3. Currency → USD.
  if (def.unit === "USD" && value !== null) {
    const fx = toUsd(value, currency);
    if (!fx) {
      flags.push(`UNSUPPORTED_CURRENCY: ${currency}`);
      lineage.push({ step: "FX_FAILED", detail: `no rate for ${currency}; value withheld from comparison` });
      value = null;
    } else {
      if (fx.converted) {
        flags.push(`FX_CONVERTED ${currency}→USD @ ${fx.rate} (${FX_TABLE.asOf}, model assumption)`);
        lineage.push({ step: "FX", detail: `${value} ${currency} × ${fx.rate} (${FX_TABLE.asOf}) = ${fx.usd} USD` });
      }
      value = fx.usd;
      currency = "USD";
    }
  }

  // 4. Periodization: ARR must be annualized; cumulative figures are not run-rates.
  // A monthly period type is trusted only when the materials themselves state a monthly figure
  // ("$400k/month", "MRR"); "ARR (Aug 2026) $5.6M" tagged MONTHLY by extraction is not multiplied.
  if (key === "arr" && obs.periodType === "MONTHLY" && value !== null) {
    if (statesMonthly(obs)) {
      flags.push("MONTHLY_FIGURE_LABELLED_ARR: annualized ×12, treat as run-rate");
      lineage.push({ step: "ANNUALIZED", detail: `monthly ${value} × 12 = ${value * 12}` });
      value = value * 12;
    } else {
      flags.push("PERIOD_TYPE_NOT_STATED_MONTHLY: extraction marked the figure monthly but the materials state it as ARR; not annualized");
    }
  }
  // A total since inception is never a current run-rate: it stays in the raw audit trail (the integrity engine reports it).
  if ((key === "arr" || key === "mrr" || key === "revenue_ttm" || key === "gmv" || key === "tpv") && obs.periodType === "CUMULATIVE") return null;

  // 5. State and quality.
  let state: DataState = obs.state === "UNKNOWN" ? "UNKNOWN" : obs.state;
  if (state === "OBSERVED" && value === null) state = "UNKNOWN";

  if (endDate && state === "OBSERVED") {
    const age = monthsBetween(endDate, ctx.asOf);
    if (age > def.quality.maxAgeMonths) {
      state = "STALE";
      flags.push(`STALE: ${age} months old (max ${def.quality.maxAgeMonths})`);
      lineage.push({ step: "STALENESS", detail: `as of ${obs.periodEnd}: ${age} months old, max ${def.quality.maxAgeMonths}` });
    }
  } else if (!endDate && state === "OBSERVED") {
    flags.push("NO_AS_OF_DATE");
  }

  if (def.quality.minSampleSize) {
    if (obs.sampleSize === null) {
      flags.push(`SAMPLE_SIZE_UNKNOWN (min ${def.quality.minSampleSize})`);
    } else if (obs.sampleSize < def.quality.minSampleSize) {
      flags.push(`SMALL_SAMPLE: n=${obs.sampleSize} < ${def.quality.minSampleSize}`);
    }
  }
  if (def.disambiguation.length > 0 && obs.components.length === 0 && !obs.definitionAsStated) {
    flags.push("DEFINITION_NOT_STATED");
  }
  const defText = (obs.components.join(" ") + " " + (obs.definitionAsStated ?? "") + " " + obs.rawText).toLowerCase();
  if (def.key === "cac") {
    const excluded = [...defText.matchAll(/exclud\w*\s+([a-z ,&-]{3,60})/g)].map((m) => m[1]!.trim());
    if (excluded.length) flags.push(`CAC_NOT_FULLY_LOADED: excludes ${excluded.join("; ")}`);
    else if (!/fully|loaded|salar|commission/.test(defText)) flags.push("CAC_LOADING_UNVERIFIED");
  }
  if (def.key === "gross_margin") {
    const excluded = [...defText.matchAll(/\b(?:exclud\w*|before|ex\.?)\s+([a-z ,&/-]{3,60})/g)].map((m) => m[1]!.trim());
    if (excluded.some((x) => /inference|cloud|hosting|support|human|ops|operation|delivery|labor|annotat|review/.test(x)))
      flags.push(`GROSS_MARGIN_EXCLUDES_COGS: ${excluded.join("; ")}`);
    else if (!/inference|cloud|hosting|support|delivery|labor|ops/.test(defText)) flags.push("COGS_COMPOSITION_UNVERIFIED");
  }
  // What a figure says it excludes ("excluding signed contracts not yet deployed") is not what it includes.
  const inclText = defText.replace(/\b(exclud\w*|without|net of|not including|hors|sans)\b[^.;]*/g, " ");
  if (def.key === "paying_customers" && /\b(pilots?|trials?|pocs?|proofs? of concept|lois?|letters? of intent|free|freemium|design partners?|logos?)\b/.test(inclText)) {
    flags.push("CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING: definition mentions pilots, trials, LOIs, free users or logos");
  }
  if (
    def.key === "arr" &&
    /\b(pilots?|one[- ]time|non[- ]recurring|implementation|setup|set-up|bookings?|signed|contracted|pipeline|(professional|consulting|onboarding|implementation)\s+services|services\s+(revenue|fees|income))\b/.test(inclText)
  ) {
    flags.push("ARR_MAY_INCLUDE_NON_RECURRING: definition mentions pilots, one-time, services, bookings or signed-not-live revenue");
  }
  if (def.unit === "PERCENT" && ["nrr", "grr", "logo_retention", "pilot_to_production_rate", "win_rate", "d30_retention", "d7_retention", "d1_retention", "repeat_rate"].includes(def.key)) {
    if (obs.sampleSize === null && !/\b\d[\d,]*\s+(?:[a-z][a-z-]*\s+){0,2}(customers?|accounts?|users?|clients?|cohorts?|pilots?|deals?|logos?|companies|merchants?|buyers?)\b/.test(defText))
      flags.push("NO_DENOMINATOR: rate stated without the population it is measured on");
    if (["nrr", "grr", "logo_retention"].includes(def.key) && !obs.cohortDefinition && !/cohort|trailing|ttm|12[- ]month/.test(defText))
      flags.push("NO_COHORT_DEFINITION: aggregate retention without cohort or measurement window");
  }
  if (flags.length) lineage.push({ step: "QUALITY_CHECKS", detail: flags.join("; ") });

  return {
    id: ctx.nextId(),
    metricKey: def.key,
    label: obs.label,
    rawValue: obs.rawText,
    normalizedValue: value,
    unit: def.unit,
    currency: def.unit === "USD" ? currency : null,
    periodType: obs.periodType,
    periodStart: obs.periodStart,
    periodEnd: obs.periodEnd,
    definitionUsed: obs.definitionAsStated,
    components: obs.components,
    entityScope: "company",
    sampleSize: obs.sampleSize,
    cohortDefinition: obs.cohortDefinition,
    state,
    sourceId: ctx.sourceIdForPage(obs.page),
    claimId: ctx.claimIdForExcerpt?.(obs.excerpt) ?? null,
    location: obs.page !== null ? `p. ${obs.page}` : null,
    excerpt: obs.excerpt,
    verification: "UNVERIFIED",
    calculationMethod: "REPORTED",
    derivation: null,
    isPrimary: false,
    qualityFlags: flags,
    notes: null,
    basis: obs.basis,
    lineage,
    inputs: [],
  };
}

/** Remove exact duplicates (same key, value, period and method) produced by repeated extraction. */
export function dedupeMetrics(metrics: MetricInstance[]): MetricInstance[] {
  const seen = new Set<string>();
  return metrics.filter((m) => {
    const k = `${m.metricKey}|${m.normalizedValue}|${m.periodEnd}|${m.calculationMethod}|${m.state}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Mark one primary instance per metric key: freshest observed value wins. */
export function selectPrimary(input: MetricInstance[]): MetricInstance[] {
  const metrics = dedupeMetrics(input);
  const byKey = new Map<string, MetricInstance[]>();
  for (const m of metrics) {
    const list = byKey.get(m.metricKey) ?? [];
    list.push(m);
    byKey.set(m.metricKey, list);
  }
  const rank = (s: DataState) =>
    ({ OBSERVED: 0, INFERRED: 1, STALE: 2, CONTRADICTED: 5, WITHHELD: 6, UNKNOWN: 7, NOT_APPLICABLE: 8, NOT_YET_MEANINGFUL: 8 })[s];
  const out: MetricInstance[] = [];
  for (const list of byKey.values()) {
    const sorted = [...list].sort((a, b) => {
      // User corrections always win.
      const uc = Number(b.calculationMethod === "USER_CORRECTED") - Number(a.calculationMethod === "USER_CORRECTED");
      if (uc !== 0) return uc;
      const r = rank(a.state) - rank(b.state);
      if (r !== 0) return r;
      const da = parsePeriodDate(a.periodEnd)?.getTime() ?? 0;
      const db = parsePeriodDate(b.periodEnd)?.getTime() ?? 0;
      if (db !== da) return db - da;
      // Reported beats derived at equal freshness.
      return Number(a.calculationMethod === "DERIVED") - Number(b.calculationMethod === "DERIVED");
    });
    // Fresh arrays: callers' instances are never mutated by later flagging.
    sorted.forEach((m, i) => out.push({ ...m, qualityFlags: [...m.qualityFlags], lineage: [...m.lineage], inputs: [...m.inputs], isPrimary: i === 0 }));
  }
  return out;
}

export { dictUnitToObsUnit };
