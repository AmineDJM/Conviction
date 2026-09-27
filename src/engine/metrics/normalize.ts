/**
 * Deterministic normalization of extracted metric observations into
 * canonical MetricInstances. The model extracts; code decides the number.
 */
import type { MetricInstance } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { DataState } from "@/domain/enums";
import { metricDef, type MetricUnit } from "./dictionary";
import { FX_TABLE } from "../config/fx";

const SCALE: Record<string, number> = {
  k: 1e3,
  thousand: 1e3,
  m: 1e6,
  mm: 1e6,
  mn: 1e6,
  million: 1e6,
  b: 1e9,
  bn: 1e9,
  billion: 1e9,
  t: 1e12,
  trillion: 1e12,
};

/**
 * Parse the single numeric quantity in a raw text like "$4.2M", "€850k",
 * "1,250 customers", "120%". Returns null when there is not exactly one
 * number (ambiguous) — callers then keep the model's value and flag it.
 */
export function parseScaledNumber(raw: string): number | null {
  const text = raw.replace(/ /g, " ");
  const re = /(-?\d{1,3}(?:[,\s]\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(thousand|million|billion|trillion|bn|mn|mm|k|m|b|t)?\b/gi;
  const matches = [...text.matchAll(re)];
  // Ignore bare years (e.g. "ARR 2025: $4.2M") when another number is present.
  const meaningful = matches.filter((m) => !/^(19|20)\d{2}$/.test(m[1]!.replace(/[,\s]/g, "")) || matches.length === 1);
  if (meaningful.length !== 1) return null;
  const m = meaningful[0]!;
  const n = Number(m[1]!.replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  const scale = m[2] ? (SCALE[m[2].toLowerCase()] ?? 1) : 1;
  return n * scale;
}

export function toUsd(amount: number, currency: string | null | undefined): { usd: number; converted: boolean; rate: number } | null {
  const cur = (currency ?? "USD").toUpperCase().trim();
  if (cur === "USD" || cur === "$") return { usd: amount, converted: false, rate: 1 };
  const rate = FX_TABLE.rates[cur];
  if (!rate) return null;
  return { usd: amount * rate, converted: true, rate };
}

function monthsBetween(a: Date, b: Date) {
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

export function parsePeriodDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) - 1 : 11;
  const d = m[3] ? Number(m[3]) : 28;
  const date = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(date.getTime()) ? null : date;
}

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
export function normalizeObservation(obs: MetricObservation, ctx: NormalizeContext): MetricInstance | null {
  if (obs.metricKey === "OTHER") return null;
  const def = metricDef(obs.metricKey);
  if (!def) return null;
  // Plans, forecasts and targets are not metrics. They stay in the raw audit trail only.
  if (obs.isProjection) return null;
  const endDate = parsePeriodDate(obs.periodEnd);
  if (endDate && endDate.getTime() > ctx.asOf.getTime() + 31 * 864e5) return null;

  const flags: string[] = [];
  let value = obs.value;
  let currency = obs.currency;

  // 1. Cross-check model value against deterministic parse of the raw text.
  if (def.unit !== "PERCENT" && def.unit !== "MULTIPLE" && def.unit !== "RATIO") {
    const parsed = parseScaledNumber(obs.rawText);
    if (parsed !== null && value !== null && parsed !== 0) {
      const rel = Math.abs(value - parsed) / Math.abs(parsed);
      if (rel > 0.02) {
        flags.push(`EXTRACTION_MISMATCH: model=${value} parsed=${parsed}; parsed value used`);
        value = parsed;
      }
    } else if (parsed !== null && value === null && obs.state === "OBSERVED") {
      value = parsed;
      flags.push("VALUE_FROM_RAW_TEXT");
    }
  }

  // 2. Percent sanity: a retention/margin given as 0.92 is almost certainly 92%.
  if (def.unit === "PERCENT" && value !== null && Math.abs(value) <= 1.5 && /%|percent/i.test(obs.rawText) === false) {
    const pct = parseScaledNumber(obs.rawText);
    if (pct === null || Math.abs(pct) <= 1.5) {
      value = value * 100;
      flags.push("FRACTION_CONVERTED_TO_PERCENT");
    }
  }

  // 3. Currency → USD.
  if (def.unit === "USD" && value !== null) {
    const fx = toUsd(value, currency);
    if (!fx) {
      flags.push(`UNSUPPORTED_CURRENCY: ${currency}`);
      value = null;
    } else {
      if (fx.converted) flags.push(`FX_CONVERTED ${currency}→USD @ ${fx.rate} (${FX_TABLE.asOf}, model assumption)`);
      value = fx.usd;
      currency = "USD";
    }
  }

  // 4. Period handling: MRR stays monthly; ARR must be annualized. A monthly revenue figure labelled ARR is flagged.
  if (obs.metricKey === "arr" && obs.periodType === "MONTHLY") {
    flags.push("MONTHLY_FIGURE_LABELLED_ARR: annualized ×12, treat as run-rate");
    if (value !== null) value = value * 12;
  }

  // 5. State and quality.
  let state: DataState = obs.state === "UNKNOWN" ? "UNKNOWN" : obs.state;
  if (state === "OBSERVED" && value === null) state = "UNKNOWN";

  const end = parsePeriodDate(obs.periodEnd);
  if (end && state === "OBSERVED") {
    const age = monthsBetween(end, ctx.asOf);
    if (age > def.quality.maxAgeMonths) {
      state = "STALE";
      flags.push(`STALE: ${age} months old (max ${def.quality.maxAgeMonths})`);
    }
  } else if (!end && state === "OBSERVED") {
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
  if (def.key === "cac") {
    const text = (obs.components.join(" ") + " " + (obs.definitionAsStated ?? "")).toLowerCase();
    if (!/fully|loaded|salar|commission|founder/.test(text)) flags.push("CAC_LOADING_UNVERIFIED");
  }
  if (def.key === "gross_margin") {
    const text = (obs.components.join(" ") + " " + (obs.definitionAsStated ?? "")).toLowerCase();
    if (!/inference|cloud|hosting|support|delivery|labor|ops/.test(text)) flags.push("COGS_COMPOSITION_UNVERIFIED");
  }

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
  };
}

/** Mark one primary instance per metric key: freshest observed value wins. */
export function selectPrimary(metrics: MetricInstance[]): MetricInstance[] {
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
    sorted.forEach((m, i) => out.push({ ...m, isPrimary: i === 0 }));
  }
  return out;
}

export { dictUnitToObsUnit };
