/**
 * §11 DECK-TO-DECK REVEAL — what changed between two analyses of different
 * deck versions of the same company: restated and updated numbers, metrics
 * that disappeared, market and fundraising changes, logos that vanished,
 * milestones hit or missed, and what the founder stopped talking about.
 * Pure and deterministic; never throws on missing data.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { Money } from "@/domain/money";
import { metricDef } from "../metrics/dictionary";
import {
  amountInText,
  CURRENT_BASES,
  fmtUsd,
  jaccard,
  lower,
  monthKey,
  moneyUsd,
  norm,
  obsUsd,
  pageFromLocation,
  parseDate,
  parseScaled,
  round,
  tokens,
} from "./util";

export interface NumberPoint {
  value: number;
  rawText: string;
  period: string | null;
  page: number | null;
}

export interface MetricValueChange {
  metricKey: string;
  label: string;
  /** RESTATED = same period, different number; UPDATED = newer period reported. */
  kind: "RESTATED" | "UPDATED";
  previous: NumberPoint;
  current: NumberPoint;
  changePct: number | null;
}

export interface MetricPresenceChange {
  metricKey: string;
  label: string;
  value: string;
  page: number | null;
  materiality: number;
}

export interface FieldChange {
  field: string;
  previous: string | null;
  current: string | null;
  changePct: number | null;
}

export interface LogoChange {
  name: string;
  previousLevel: string | null;
  currentLevel: string | null;
}

export type MilestoneStatus = "HIT" | "MISSED" | "NOT_REPORTED" | "NOT_DUE";

export interface MilestoneCheck {
  source: "FORECAST" | "TARGET" | "MILESTONE_CLAIMED";
  description: string;
  metricKey: string | null;
  target: number | null;
  dueDate: string | null;
  actual: NumberPoint | null;
  status: MilestoneStatus;
  gapPct: number | null;
  previousPage: number | null;
}

export interface StoppedTopic {
  kind: "METRIC" | "CLAIM" | "LOGO";
  topic: string;
  lastSeen: string;
  page: number | null;
  weight: number;
}

export interface DeckDiff {
  version: string;
  basis: ["COMPUTED"];
  previousAsOf: string | null;
  currentAsOf: string | null;
  changedNumbers: MetricValueChange[];
  metricsRemoved: MetricPresenceChange[];
  metricsAdded: MetricPresenceChange[];
  marketChanges: FieldChange[];
  logosRemoved: LogoChange[];
  logosAdded: LogoChange[];
  logoStatusChanges: LogoChange[];
  termChanges: FieldChange[];
  milestones: MilestoneCheck[];
  stoppedTalkingAbout: StoppedTopic[];
  headlines: string[];
}

export interface DeckDiffOptions {
  /** Date of the previous deck (defaults to its analysis start, else its latest as-of date). */
  previousAsOf?: Date;
  /** Date of the current deck (defaults to its analysis start, else its latest as-of date). */
  currentAsOf?: Date;
  /** Relative change below which two numbers are considered equal (default 0.5%). */
  tolerance?: number;
}

const FAMILY_WEIGHT: Record<string, number> = {
  RETENTION: 5,
  REVENUE: 4,
  UNIT_ECONOMICS: 4,
  MARKETPLACE: 4,
  FINTECH: 4,
  DEEPTECH: 4,
  CUSTOMERS: 3,
  CASH: 3,
  GTM: 3,
  CONSUMER: 3,
  HARDWARE: 3,
};

const LEVEL_RANK: Record<string, number> = { UNKNOWN: 0, LOGO_ONLY: 1, PILOT: 2, CONTRACT_SIGNED: 3, DEPLOYED: 4, PAYING: 5, RECURRING: 6, REFERENCEABLE: 7 };

function identity(o: { metricKey: string; label: string }): string {
  return o.metricKey !== "OTHER" ? o.metricKey : `OTHER:${norm(o.label)}`;
}

function materiality(key: string): number {
  if (key.startsWith("OTHER:")) return 1;
  return FAMILY_WEIGHT[metricDef(key)?.family ?? ""] ?? 2;
}

function fmtValue(key: string, v: number): string {
  const unit = metricDef(key)?.unit;
  if (unit === "USD") return fmtUsd(v);
  if (unit === "PERCENT") return `${round(v, 1)}%`;
  if (unit === "MONTHS") return `${round(v, 1)} months`;
  if (unit === "DAYS") return `${round(v, 0)} days`;
  if (unit === "MULTIPLE") return `${round(v, 2)}×`;
  return `${round(v, 2).toLocaleString("en-US")}`;
}

type Pt = NumberPoint & { key: string; label: string };

/** Current-basis numbers of a deck (raw observations; normalized metrics when no observations were stored). */
function actuals(d: CanonicalDeal): Pt[] {
  const obs = (d.metricObservations ?? []).filter((o) => CURRENT_BASES.has(o.basis) && o.value !== null && o.state !== "WITHHELD");
  if (obs.length)
    return obs
      // obsUsd is null when a currency amount cannot be converted: drop the point rather than compare raw euros to dollars.
      .map((o) => ({ key: identity(o), label: o.label, value: obsUsd(o), rawText: o.rawText, period: o.periodEnd, page: o.page }))
      .filter((p): p is Pt => p.value !== null && Number.isFinite(p.value));
  return (d.metrics ?? [])
    .filter((m) => m.normalizedValue !== null && CURRENT_BASES.has(m.basis) && m.calculationMethod !== "DERIVED" && (m.state === "OBSERVED" || m.state === "INFERRED" || m.state === "STALE"))
    .map((m) => ({ key: identity(m), label: m.label, value: m.normalizedValue!, rawText: m.rawValue, period: m.periodEnd, page: pageFromLocation(m.location) }));
}

const LABEL_FILLER = /\b(company|total|overall|current|our|the|reported|of|de|la|le|les|du|des|nombre|number)\b/g;
const labelKey = (s: string) => norm(s).replace(LABEL_FILLER, " ").replace(/\s+/g, " ").trim();

/**
 * One metric can be keyed from the dictionary in one deck and as OTHER:<label> in the other
 * (extraction is per deck). Remap such OTHER keys onto the dictionary key when the labels agree,
 * so the metric is compared instead of being reported as both "no longer reported" and "newly reported".
 */
function reconcileKeys(a: Pt[], b: Pt[]): void {
  const byLabel = new Map<string, string>();
  for (const p of [...a, ...b]) {
    if (p.key.startsWith("OTHER:")) continue;
    byLabel.set(labelKey(p.label), p.key);
    const d = metricDef(p.key);
    if (d) {
      byLabel.set(labelKey(d.name), p.key);
      byLabel.set(labelKey(d.shortName), p.key);
    }
  }
  for (const p of [...a, ...b]) {
    if (!p.key.startsWith("OTHER:")) continue;
    const k = byLabel.get(labelKey(p.label));
    if (k) p.key = k;
  }
  // Two OTHER labels that differ only by filler words ("Company headcount" / "Headcount (total)").
  const others = new Map<string, string>();
  for (const p of [...a, ...b]) {
    if (!p.key.startsWith("OTHER:")) continue;
    const lk = labelKey(p.label);
    const first = others.get(lk);
    if (first) p.key = first;
    else others.set(lk, p.key);
  }
}

function forwards(d: CanonicalDeal): (MetricObservation & { key: string })[] {
  return (d.metricObservations ?? []).filter((o) => (o.basis === "FORECAST" || o.basis === "TARGET") && o.value !== null).map((o) => ({ ...o, key: identity(o) }));
}

function latestByKey(pts: Pt[]): Map<string, Pt> {
  const m = new Map<string, Pt>();
  for (const p of pts) {
    const cur = m.get(p.key);
    const t = parseDate(p.period)?.getTime() ?? -1;
    const ct = cur ? (parseDate(cur.period)?.getTime() ?? -1) : -2;
    if (!cur || t > ct) m.set(p.key, p);
  }
  return m;
}

function deckDate(d: CanonicalDeal, explicit?: Date): Date | null {
  if (explicit && !Number.isNaN(explicit.getTime())) return explicit;
  const p = d.analysis?.provenance?.startedAt;
  if (p && !Number.isNaN(new Date(p).getTime())) return new Date(p);
  const dates = actuals(d)
    .map((a) => parseDate(a.period)?.getTime())
    .filter((t): t is number => t !== undefined);
  return dates.length ? new Date(Math.max(...dates)) : null;
}

const rel = (a: number, b: number) => (a === 0 ? (b === 0 ? 0 : null) : round(((b - a) / Math.abs(a)) * 100, 1));

function moneyChange(field: string, a: Money | null | undefined, b: Money | null | undefined, tol: number): FieldChange | null {
  const ua = moneyUsd(a);
  const ub = moneyUsd(b);
  if (ua === null && ub === null) return null;
  if (ua !== null && ub !== null && Math.abs(ub - ua) <= tol * Math.max(Math.abs(ua), Math.abs(ub))) return null;
  return { field, previous: a ? (a.rawText || fmtUsd(ua)) : null, current: b ? (b.rawText || fmtUsd(ub)) : null, changePct: ua !== null && ub !== null ? rel(ua, ub) : null };
}

const MILESTONE_KEYS: [RegExp, string][] = [
  [/\bnrr\b|net (revenue|dollar) retention/, "nrr"],
  [/\bgrr\b|gross (revenue )?retention/, "grr"],
  [/\bmrr\b/, "mrr"],
  [/\barr\b|annual recurring/, "arr"],
  [/\bgmv\b|gross merchandise/, "gmv"],
  [/gross margin/, "gross_margin"],
  [/\bmau\b|monthly active/, "mau"],
  // Not bare "sales": "Hire 5 sales reps" is a hiring milestone, not a revenue target.
  [/\brevenues?\b|chiffre d.affaires/, "revenue_ttm"],
  [/customers?|clients?|logos?/, "paying_customers"],
  [/headcount|employees|\bfte\b|hires/, "headcount"],
];

/**
 * Metric key and target (dictionary unit, USD for money) of a claimed milestone, or a null key when the target's unit
 * does not fit the metric: a USD metric needs a money amount ("€5M", "$2M", "5M"), converted to USD with the shared
 * FX table; a count / percent metric refuses a money amount.
 */
function milestoneTarget(text: string): { key: string | null; target: number | null } {
  const t = lower(text);
  const key = MILESTONE_KEYS.find(([re]) => re.test(t))?.[1] ?? null;
  const amt = amountInText(text);
  if (!key) return { key: null, target: amt?.value ?? null };
  if (metricDef(key)?.unit === "USD") return amt?.money ? { key, target: amt.usd } : { key: null, target: null };
  if (amt?.currency) return { key: null, target: null };
  return { key, target: amt?.value ?? null };
}

function judge(key: string | null, target: number | null, actual: number): { status: MilestoneStatus; gapPct: number | null } {
  if (target === null) return { status: "NOT_REPORTED", gapPct: null };
  const dir = key && !key.startsWith("OTHER:") ? (metricDef(key)?.direction ?? "HIGHER_IS_BETTER") : "HIGHER_IS_BETTER";
  const gapPct = rel(target, actual);
  const hit = dir === "LOWER_IS_BETTER" ? actual <= target * 1.02 : actual >= target * 0.98;
  return { status: hit ? "HIT" : "MISSED", gapPct };
}

/** The current deck's actual for a key at (or first after) a due date. */
function actualFor(curPts: Pt[], key: string, due: Date | null, currentAsOf: Date | null): Pt | null {
  const list = curPts.filter((p) => p.key === key);
  if (!list.length) return null;
  if (!due) return latestByKey(list).get(key) ?? null;
  const dueMonth = `${due.getUTCFullYear()}-${String(due.getUTCMonth() + 1).padStart(2, "0")}`;
  const exact = list.find((p) => monthKey(p.period) === dueMonth);
  if (exact) return exact;
  const after = list
    .filter((p) => (parseDate(p.period)?.getTime() ?? -1) >= due.getTime())
    .sort((a, b) => (parseDate(a.period)?.getTime() ?? 0) - (parseDate(b.period)?.getTime() ?? 0));
  if (after[0]) return after[0];
  const undated = list.find((p) => !p.period);
  if (undated && currentAsOf && currentAsOf.getTime() >= due.getTime()) return undated;
  return null;
}

function normName(s: string): string {
  return norm(s)
    .replace(/\b(inc|ltd|llc|gmbh|sa|sas|plc|corp|corporation|co|ag|bv|nv|oy|ab|group|holding|holdings)\b\.?/g, "")
    .replace(/[.\s]+/g, " ")
    .trim();
}

export function deckDiff(previous: CanonicalDeal, current: CanonicalDeal, opts: DeckDiffOptions = {}): DeckDiff {
  const tol = opts.tolerance ?? 0.005;
  const prevAsOf = deckDate(previous, opts.previousAsOf);
  const curAsOf = deckDate(current, opts.currentAsOf);
  const prevPts = actuals(previous);
  const curPts = actuals(current);
  reconcileKeys(prevPts, curPts);

  /* Changed numbers ------------------------------------------------ */
  const changedNumbers: MetricValueChange[] = [];
  const restatedKeys = new Set<string>();
  for (const p of prevPts) {
    if (!p.period) continue;
    const mk = monthKey(p.period);
    const c = curPts.find((x) => x.key === p.key && x.period && monthKey(x.period) === mk);
    if (c && Math.abs(c.value - p.value) > tol * Math.max(Math.abs(p.value), Math.abs(c.value)) && !changedNumbers.some((x) => x.metricKey === p.key && x.previous.period === p.period)) {
      changedNumbers.push({ metricKey: p.key, label: c.label, kind: "RESTATED", previous: strip(p), current: strip(c), changePct: rel(p.value, c.value) });
      restatedKeys.add(p.key);
    }
  }
  const prevLatest = latestByKey(prevPts);
  const curLatest = latestByKey(curPts);
  for (const [key, p] of [...prevLatest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const c = curLatest.get(key);
    if (!c || restatedKeys.has(key)) continue;
    const samePeriod = (p.period && c.period && monthKey(p.period) === monthKey(c.period)) || (!p.period && !c.period);
    if (Math.abs(c.value - p.value) <= tol * Math.max(Math.abs(p.value), Math.abs(c.value))) continue;
    changedNumbers.push({ metricKey: key, label: c.label, kind: samePeriod && p.period ? "RESTATED" : "UPDATED", previous: strip(p), current: strip(c), changePct: rel(p.value, c.value) });
  }

  /* Metrics removed / added --------------------------------------- */
  // Presence is judged on actual (current-basis) values: a metric only shown as a forecast is not reported.
  const metricsRemoved: MetricPresenceChange[] = [...prevLatest.values()]
    .filter((p) => !curLatest.has(p.key))
    .map((p) => ({ metricKey: p.key, label: p.label, value: p.rawText, page: p.page, materiality: materiality(p.key) }))
    .sort((a, b) => b.materiality - a.materiality || a.metricKey.localeCompare(b.metricKey));
  const metricsAdded: MetricPresenceChange[] = [...curLatest.values()]
    .filter((p) => !prevLatest.has(p.key))
    .map((p) => ({ metricKey: p.key, label: p.label, value: p.rawText, page: p.page, materiality: materiality(p.key) }))
    .sort((a, b) => b.materiality - a.materiality || a.metricKey.localeCompare(b.metricKey));

  /* Market ---------------------------------------------------------- */
  const marketChanges: FieldChange[] = [];
  for (const f of ["tam", "sam", "som"] as const) {
    const ch = moneyChange(f.toUpperCase(), previous.deckMarket?.[f], current.deckMarket?.[f], tol);
    if (ch) marketChanges.push(ch);
  }
  const pd = previous.deckMarket?.description ?? null;
  const cd = current.deckMarket?.description ?? null;
  if ((pd || cd) && norm(pd) !== norm(cd) && jaccard(tokens(pd ?? ""), tokens(cd ?? "")) < 0.8) marketChanges.push({ field: "DESCRIPTION", previous: pd, current: cd, changePct: null });
  const prevMarketClaims = (previous.claims ?? []).filter((c) => c.category === "MARKET");
  const curMarketClaims = (current.claims ?? []).filter((c) => c.category === "MARKET");
  for (const c of prevMarketClaims)
    if (!curMarketClaims.some((x) => jaccard(tokens(x.statement), tokens(c.statement)) >= 0.5)) marketChanges.push({ field: "MARKET_CLAIM_REMOVED", previous: c.statement, current: null, changePct: null });
  for (const c of curMarketClaims)
    if (!prevMarketClaims.some((x) => jaccard(tokens(x.statement), tokens(c.statement)) >= 0.5)) marketChanges.push({ field: "MARKET_CLAIM_ADDED", previous: null, current: c.statement, changePct: null });

  /* Logos ----------------------------------------------------------- */
  const prevNamed = previous.customers?.namedCustomers ?? [];
  const curNamed = current.customers?.namedCustomers ?? [];
  const curByName = new Map(curNamed.map((c) => [normName(c.name), c]));
  const prevByName = new Map(prevNamed.map((c) => [normName(c.name), c]));
  const logosRemoved: LogoChange[] = prevNamed.filter((c) => !curByName.has(normName(c.name))).map((c) => ({ name: c.name, previousLevel: c.evidenceLevel, currentLevel: null }));
  const logosAdded: LogoChange[] = curNamed.filter((c) => !prevByName.has(normName(c.name))).map((c) => ({ name: c.name, previousLevel: null, currentLevel: c.evidenceLevel }));
  const logoStatusChanges: LogoChange[] = prevNamed
    .filter((c) => {
      const n = curByName.get(normName(c.name));
      return n && n.evidenceLevel !== c.evidenceLevel;
    })
    .map((c) => ({ name: c.name, previousLevel: c.evidenceLevel, currentLevel: curByName.get(normName(c.name))!.evidenceLevel }));

  /* Fundraising terms ----------------------------------------------- */
  const termChanges: FieldChange[] = [];
  const pf = previous.financing;
  const cf = current.financing;
  if (pf || cf) {
    for (const f of ["raiseAmount", "preMoney", "postMoney", "valuationCap"] as const) {
      const ch = moneyChange(f, pf?.[f], cf?.[f], tol);
      if (ch) termChanges.push(ch);
    }
    if ((pf?.instrument ?? "UNKNOWN") !== (cf?.instrument ?? "UNKNOWN")) termChanges.push({ field: "instrument", previous: pf?.instrument ?? null, current: cf?.instrument ?? null, changePct: null });
    if ((pf?.discountPct ?? null) !== (cf?.discountPct ?? null)) termChanges.push({ field: "discountPct", previous: pf?.discountPct?.toString() ?? null, current: cf?.discountPct?.toString() ?? null, changePct: null });
  }

  /* Milestones ------------------------------------------------------ */
  const milestones: MilestoneCheck[] = [];
  for (const f of forwards(previous)) {
    const due = parseDate(f.periodEnd);
    const target = obsUsd(f);
    const isDue = due ? (curAsOf ? due.getTime() <= curAsOf.getTime() + 31 * 864e5 : curPts.some((p) => p.key === f.key && (parseDate(p.period)?.getTime() ?? -1) >= due.getTime())) : false;
    const base = { source: f.basis as "FORECAST" | "TARGET", description: `${f.label}: ${f.rawText}`, metricKey: f.key, target, dueDate: f.periodEnd, previousPage: f.page };
    if (!isDue) {
      milestones.push({ ...base, actual: null, status: "NOT_DUE", gapPct: null });
      continue;
    }
    const a = actualFor(curPts, f.key, due, curAsOf);
    if (!a) milestones.push({ ...base, actual: null, status: "NOT_REPORTED", gapPct: null });
    else milestones.push({ ...base, actual: strip(a), ...judge(f.key, target, a.value) });
  }
  for (const m of pf?.milestonesClaimed ?? []) {
    const { key, target } = milestoneTarget(m.milestone);
    const due = prevAsOf && m.monthsFromNow !== null ? new Date(Date.UTC(prevAsOf.getUTCFullYear(), prevAsOf.getUTCMonth() + Math.round(m.monthsFromNow), 28)) : null;
    const dueDate = due ? due.toISOString().slice(0, 7) : null;
    const base = { source: "MILESTONE_CLAIMED" as const, description: m.milestone, metricKey: key, target, dueDate, previousPage: null };
    if (!due || !curAsOf || due.getTime() > curAsOf.getTime() + 31 * 864e5) {
      milestones.push({ ...base, actual: null, status: "NOT_DUE", gapPct: null });
      continue;
    }
    const a = key ? actualFor(curPts, key, due, curAsOf) ?? latestByKey(curPts.filter((p) => p.key === key)).get(key) ?? null : null;
    if (!a || target === null) milestones.push({ ...base, actual: a ? strip(a) : null, status: "NOT_REPORTED", gapPct: null });
    else milestones.push({ ...base, actual: strip(a), ...judge(key, target, a.value) });
  }

  /* What the founder stopped talking about ------------------------- */
  const stopped: StoppedTopic[] = metricsRemoved.map((m) => ({ kind: "METRIC" as const, topic: m.label, lastSeen: m.value, page: m.page, weight: m.materiality }));
  const curClaims = current.claims ?? [];
  for (const c of previous.claims ?? []) {
    if (c.category === "MARKET") continue; // reported under market changes
    const t = tokens(c.statement);
    if (curClaims.some((x) => jaccard(tokens(x.statement), t) >= 0.5)) continue;
    stopped.push({ kind: "CLAIM", topic: c.statement, lastSeen: c.valueText ?? c.statement, page: pageFromLocation(c.evidence[0]?.location), weight: round((c.material ? 3 : 1) + (Math.max(1, c.unusualness) - 1) / 2, 2) });
  }
  for (const l of logosRemoved) stopped.push({ kind: "LOGO", topic: l.name, lastSeen: l.previousLevel ?? "UNKNOWN", page: null, weight: (LEVEL_RANK[l.previousLevel ?? "UNKNOWN"] ?? 0) >= 5 ? 3 : 2 });
  stopped.sort((a, b) => b.weight - a.weight || a.kind.localeCompare(b.kind) || a.topic.localeCompare(b.topic));

  /* Headlines ------------------------------------------------------- */
  const headlines: string[] = [];
  const pg = (p: number | null) => (p !== null ? ` (p. ${p})` : "");
  for (const c of changedNumbers.filter((x) => x.kind === "RESTATED"))
    headlines.push(`${c.label} for ${c.previous.period} was restated from ${fmtValue(c.metricKey, c.previous.value)}${pg(c.previous.page)} to ${fmtValue(c.metricKey, c.current.value)}${pg(c.current.page)} (${signed(c.changePct)}).`);
  for (const m of milestones.filter((x) => x.status === "MISSED"))
    headlines.push(`Missed: "${m.description}" due ${m.dueDate} — actual ${m.actual ? fmtValue(m.metricKey ?? "", m.actual.value) : "n/a"}${m.actual ? pg(m.actual.page) : ""} (${signed(m.gapPct)} vs target).`);
  for (const m of milestones.filter((x) => x.status === "NOT_REPORTED"))
    headlines.push(`Not reported: "${m.description}" was due ${m.dueDate ?? "by now"}; the new deck does not report the outcome.`);
  for (const m of milestones.filter((x) => x.status === "HIT"))
    headlines.push(`Hit: "${m.description}" — actual ${fmtValue(m.metricKey ?? "", m.actual!.value)}${pg(m.actual!.page)}.`);
  if (metricsRemoved.length) headlines.push(`No longer reported: ${metricsRemoved.map((m) => `${m.label} (last ${m.value}${pg(m.page)})`).join(", ")}.`);
  if (logosRemoved.length) headlines.push(`Customer logos no longer shown: ${logosRemoved.map((l) => l.name).join(", ")}.`);
  for (const l of logoStatusChanges)
    headlines.push(`${l.name}: evidence level ${(LEVEL_RANK[l.currentLevel ?? ""] ?? 0) < (LEVEL_RANK[l.previousLevel ?? ""] ?? 0) ? "downgraded" : "upgraded"} from ${l.previousLevel} to ${l.currentLevel}.`);
  for (const t of termChanges) headlines.push(`Fundraising ${t.field} changed from ${t.previous ?? "not stated"} to ${t.current ?? "not stated"}${t.changePct !== null ? ` (${signed(t.changePct)})` : ""}.`);
  for (const m of marketChanges.filter((x) => ["TAM", "SAM", "SOM"].includes(x.field)))
    headlines.push(`${m.field} changed from ${m.previous ?? "not stated"} to ${m.current ?? "not stated"}${m.changePct !== null ? ` (${signed(m.changePct)})` : ""}.`);
  for (const c of changedNumbers.filter((x) => x.kind === "UPDATED"))
    headlines.push(`${c.label}: ${fmtValue(c.metricKey, c.previous.value)}${c.previous.period ? ` (${c.previous.period})` : ""}${pg(c.previous.page)} → ${fmtValue(c.metricKey, c.current.value)}${c.current.period ? ` (${c.current.period})` : ""}${pg(c.current.page)} (${signed(c.changePct)}).`);
  const claimsStopped = stopped.filter((s) => s.kind === "CLAIM" && s.weight >= 3);
  if (claimsStopped.length) headlines.push(`Stopped talking about: ${claimsStopped.slice(0, 3).map((s) => `"${s.topic}"`).join("; ")}.`);
  if (logosAdded.length) headlines.push(`New customer logos: ${logosAdded.map((l) => l.name).join(", ")}.`);
  if (metricsAdded.length) headlines.push(`Newly reported: ${metricsAdded.map((m) => m.label).join(", ")}.`);

  return {
    version: "deck-diff-1.0",
    basis: ["COMPUTED"],
    previousAsOf: prevAsOf ? prevAsOf.toISOString().slice(0, 10) : null,
    currentAsOf: curAsOf ? curAsOf.toISOString().slice(0, 10) : null,
    changedNumbers,
    metricsRemoved,
    metricsAdded,
    marketChanges,
    logosRemoved,
    logosAdded,
    logoStatusChanges,
    termChanges,
    milestones,
    stoppedTalkingAbout: stopped,
    headlines,
  };
}

function strip(p: Pt): NumberPoint {
  return { value: p.value, rawText: p.rawText, period: p.period, page: p.page };
}

function signed(p: number | null): string {
  if (p === null) return "n/a";
  return `${p > 0 ? "+" : ""}${p}%`;
}
