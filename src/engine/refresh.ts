/**
 * REFRESH ONLY STALE DATA — deterministic selection (no model, no I/O).
 *
 * Given a canonical deal and a reference date, which items need newer evidence?
 *
 *   CLAIM   material claim whose effective freshness is STALE or AGING (a company-reported
 *           figure with no web trace ranks last: search rarely has it). Its date is
 *           the latest of: the claim's period, the publication date of a retrieved web
 *           source that confirms / updates it, and — for undated deck statements — the
 *           date the material was read (the document source's retrieval date).
 *   SOURCE  web source older than 18 months, or undated and last retrieved more than
 *           `undatedRecheckMonths` ago, backing a material claim that has no fresher
 *           dated, retrieved external evidence (and is not already a CLAIM item).
 *   METRIC  primary reported metric flagged STALE, or older than the dictionary's
 *           freshness limit at the reference date (its claim, if any, carries the research).
 *   GAP     open question researchable on the public web, last researched more than
 *           `gapRecheckMonths` ago (or never).
 *
 * Items re-checked by a refresh less than `cooldownDays` ago are deferred (said, not
 * hidden), so an item for which nothing newer exists is not re-bought every day.
 * At most `maxItems` items per refresh, in a fixed priority order; ties by key.
 */
import type { CanonicalDeal, Claim, Source } from "@/domain/canonical";
import type { Freshness } from "@/domain/enums";
import { parsePeriodDate } from "@/engine/metrics/normalize";
import { metricDef } from "@/engine/metrics/dictionary";
import { researchPriorityIndex } from "@/engine/derive";
import { STALE_SOURCE_MONTHS } from "@/engine/integrity/sources";

export const REFRESH_POLICY = {
  version: "refresh_policy_v1",
  staleMonths: STALE_SOURCE_MONTHS,
  agingMonths: 9,
  undatedRecheckMonths: 9,
  gapRecheckMonths: 3,
  cooldownDays: 30,
  maxItems: 12,
} as const;
export type RefreshPolicy = { -readonly [K in keyof typeof REFRESH_POLICY]: (typeof REFRESH_POLICY)[K] extends number ? number : string };

export type StaleKind = "CLAIM" | "SOURCE" | "METRIC" | "GAP";

export interface StaleItem {
  key: string;
  kind: StaleKind;
  ref: string;
  /** Claims the research attaches to (CLAIM: itself; SOURCE: the material claims it backs; METRIC: its claim). */
  claimIds: string[];
  metricId: string | null;
  gapRef: string | null;
  label: string;
  reason: string;
  freshness: Freshness | null;
  currentEvidence: { sourceId: string; url: string | null; publishedDate: string | null; retrievedAt: string }[];
  suggestedQueries: string[];
  priority: number;
}

export interface StalePlan {
  asOf: string;
  policy: string;
  items: StaleItem[];
  /** Due but not in this refresh: recently re-checked (cooldown) or over the per-refresh cap. */
  deferred: { key: string; kind: StaleKind; ref: string; label: string; reason: string }[];
  counts: Record<StaleKind, number>;
  /** Material claims / web sources considered — so "nothing stale" is a statement about something. */
  considered: { materialClaims: number; webSources: number; primaryMetrics: number; openWebGaps: number };
}

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const months = (from: Date, to: Date) => (to.getTime() - from.getTime()) / MS_PER_MONTH;
const ym = (d: Date) => d.toISOString().slice(0, 7);

export function freshnessOf(date: Date | null, asOf: Date, p: Pick<RefreshPolicy, "staleMonths" | "agingMonths"> = REFRESH_POLICY): Freshness | null {
  if (!date) return null;
  const m = months(date, asOf);
  return m > p.staleMonths ? "STALE" : m > p.agingMonths ? "AGING" : "CURRENT";
}

const parseDate = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const d = parsePeriodDate(s);
  if (d && !Number.isNaN(d.getTime())) return d;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t;
};

const SUPPORTING = new Set(["CONFIRMS", "PARTIALLY_CONFIRMS", "NEW_INFORMATION"]);
const isExternalWeb = (s: Source | undefined): s is Source => !!s && s.kind === "WEB" && s.citationVerified && s.origin !== "COMPANY" && s.independenceGroup !== "COMPANY";

/**
 * The date a claim's evidence speaks for, and where it comes from: the latest of
 * the claim's own date and the publication dates of retrieved external sources that
 * confirm or update it. A claim without a period speaks as of its origin — the date
 * the company's material (deck, transcript) was read — so an undated statement in a
 * recent deck is not made stale by an old article that happens to confirm it.
 * Null when nothing is dated (freshness then stays what extraction recorded).
 */
export function claimEvidenceDate(claim: Claim, deal: Pick<CanonicalDeal, "sources">): { date: Date | null; basis: string } {
  const byId = new Map(deal.sources.map((s) => [s.id, s]));
  let best: { date: Date; basis: string } | null = null;
  const consider = (d: Date | null, basis: string) => {
    if (d && (!best || d.getTime() > best.date.getTime())) best = { date: d, basis };
  };
  const period = parseDate(claim.period);
  if (period) consider(period, `period ${claim.period}`);
  else
    for (const e of claim.evidence) {
      const s = byId.get(e.sourceId);
      if (e.effect === "ORIGIN" && s && (s.kind === "DOCUMENT" || s.kind === "TRANSCRIPT")) consider(parseDate(s.publishedDate) ?? parseDate(s.retrievedAt), `undated statement in ${s.id} (${s.kind.toLowerCase()}) read ${(s.publishedDate ?? s.retrievedAt).slice(0, 10)}`);
    }
  for (const e of claim.evidence) {
    const s = byId.get(e.sourceId);
    if (SUPPORTING.has(e.effect) && isExternalWeb(s)) consider(parseDate(s.publishedDate), `${s.id} published ${s.publishedDate}`);
  }
  return best ?? { date: null, basis: "undated" };
}

/** Effective freshness of a claim at `asOf` (falls back to the stored value when nothing is dated). */
export function claimFreshness(claim: Claim, deal: Pick<CanonicalDeal, "sources">, asOf: Date, p: Pick<RefreshPolicy, "staleMonths" | "agingMonths"> = REFRESH_POLICY): Freshness {
  return freshnessOf(claimEvidenceDate(claim, deal).date, asOf, p) ?? claim.freshness;
}

/** Latest refresh that re-checked each item key (from the version's own refresh log), incl. claims it created. */
export function lastRefreshed(deal: CanonicalDeal): Map<string, { at: string; outcome: string }> {
  const out = new Map<string, { at: string; outcome: string }>();
  const put = (key: string, at: string, outcome: string) => {
    const prev = out.get(key);
    if (!prev || prev.at < at) out.set(key, { at, outcome });
  };
  for (const r of deal.analysis.refreshes ?? [])
    for (const it of r.items) {
      put(it.key, r.at, it.outcome);
      // A claim a refresh just created carries the newest evidence that search found: it was checked then too.
      for (const id of it.newClaimIds) put(`CLAIM:${id}`, r.at, "CREATED_BY_REFRESH");
    }
  return out;
}

const CATEGORY_WEIGHT: Partial<Record<Claim["category"], number>> = { METRIC: 12, FINANCIAL: 12, CUSTOMER: 10, FUNDING: 9, PARTNERSHIP: 8, TEAM: 7, MARKET: 6, COMPETITION: 6, PRODUCT: 5, REGULATORY: 5, TECHNOLOGY: 4, IP: 4, OTHER: 2 };
const short = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function selectStaleItems(deal: CanonicalDeal, opts: { asOf: Date; policy?: Partial<RefreshPolicy> }): StalePlan {
  const p: RefreshPolicy = { ...REFRESH_POLICY, ...(opts.policy ?? {}) };
  const asOf = opts.asOf;
  const byId = new Map(deal.sources.map((s) => [s.id, s]));
  const claimById = new Map(deal.claims.map((c) => [c.id, c]));
  const evidenceOf = (c: Claim) =>
    c.evidence
      .map((e) => byId.get(e.sourceId))
      .filter((s): s is Source => !!s)
      .map((s) => ({ sourceId: s.id, url: s.url, publishedDate: s.publishedDate, retrievedAt: s.retrievedAt }));
  const candidates: StaleItem[] = [];
  const material = deal.claims.filter((c) => c.material);

  /* CLAIM */
  const claimItems = new Set<string>();
  for (const c of material) {
    const { date, basis } = claimEvidenceDate(c, deal);
    const f = freshnessOf(date, asOf, p) ?? c.freshness;
    if (f !== "STALE" && f !== "AGING") continue;
    claimItems.add(c.id);
    // A company-reported figure with no web trace is rarely public: still a candidate, ranked after what search can refresh.
    const privateFigure = c.origin === "COMPANY" && (c.category === "METRIC" || c.category === "FINANCIAL") && !c.evidence.some((e) => byId.get(e.sourceId)?.kind === "WEB");
    candidates.push({
      key: `CLAIM:${c.id}`,
      kind: "CLAIM",
      ref: c.id,
      claimIds: [c.id],
      metricId: deal.metrics.find((m) => m.claimId === c.id && m.isPrimary)?.id ?? null,
      gapRef: null,
      label: short(c.statement),
      reason:
        (date ? `${f === "STALE" ? "Stale" : "Aging"}: evidence dated ${ym(date)} (${basis}), ${Math.round(months(date, asOf))} months before ${ym(asOf)}` : `Recorded as ${f.toLowerCase()} at extraction; no date to recompute`) +
        (privateFigure ? " — company-reported figure: public sources rarely carry it, the founder is the reliable source" : ""),
      freshness: f,
      currentEvidence: evidenceOf(c),
      suggestedQueries: [],
      priority: privateFigure ? (f === "STALE" ? 50 : 30) + c.unusualness : (f === "STALE" ? 200 : 100) + c.unusualness * 5 + (CATEGORY_WEIGHT[c.category] ?? 0),
    });
  }

  /* SOURCE */
  const web = deal.sources.filter((s) => s.kind === "WEB");
  for (const s of web) {
    const pub = parseDate(s.publishedDate);
    const retrieved = parseDate(s.retrievedAt);
    const old = pub ? months(pub, asOf) > p.staleMonths : retrieved ? months(retrieved, asOf) > p.undatedRecheckMonths : true;
    if (!old) continue;
    const backed = material.filter((c) => !claimItems.has(c.id) && c.evidence.some((e) => e.sourceId === s.id && e.effect !== "CONTRADICTS"));
    // A claim with fresher dated, retrieved external evidence no longer depends on this source.
    const dependent = backed.filter((c) =>
      !c.evidence.some((e) => {
        const o = byId.get(e.sourceId);
        const d = o && o.id !== s.id && SUPPORTING.has(e.effect) && isExternalWeb(o) ? parseDate(o.publishedDate) : null;
        return d !== null && months(d, asOf) <= p.staleMonths;
      }),
    );
    if (!dependent.length) continue;
    candidates.push({
      key: `SOURCE:${s.id}`,
      kind: "SOURCE",
      ref: s.id,
      claimIds: dependent.map((c) => c.id),
      metricId: null,
      gapRef: null,
      label: short(`${s.title}${s.url ? ` — ${s.url}` : ""}`),
      reason: pub
        ? `Source published ${ym(pub)}, ${Math.round(months(pub, asOf))} months before ${ym(asOf)} (stale above ${p.staleMonths}); backs ${dependent.length} material claim(s)`
        : `Undated source last retrieved ${retrieved ? ym(retrieved) : "never"}${retrieved ? ` (${Math.round(months(retrieved, asOf))} months ago)` : ""}; backs ${dependent.length} material claim(s)`,
      freshness: pub ? "STALE" : null,
      currentEvidence: [{ sourceId: s.id, url: s.url, publishedDate: s.publishedDate, retrievedAt: s.retrievedAt }],
      suggestedQueries: [],
      priority: 80 + dependent.length * 5 + (pub ? 10 : 0),
    });
  }

  /* METRIC */
  const primary = deal.metrics.filter((m) => m.isPrimary && m.calculationMethod === "REPORTED");
  for (const m of primary) {
    if (m.claimId && claimItems.has(m.claimId)) continue;
    const end = parseDate(m.periodEnd);
    const max = metricDef(m.metricKey)?.quality.maxAgeMonths ?? null;
    const age = end ? months(end, asOf) : null;
    const flagged = m.state === "STALE" || m.qualityFlags.some((f) => f.startsWith("STALE"));
    const aged = age !== null && max !== null && m.state === "OBSERVED" && age > max;
    if (!flagged && !aged) continue;
    const claim = m.claimId ? claimById.get(m.claimId) : undefined;
    candidates.push({
      key: `METRIC:${m.id}`,
      kind: "METRIC",
      ref: m.id,
      claimIds: claim ? [claim.id] : [],
      metricId: m.id,
      gapRef: null,
      label: short(`${m.label}: ${m.rawValue}${m.periodEnd ? ` (as of ${m.periodEnd})` : ""}`),
      reason: age !== null ? `Metric as of ${m.periodEnd}, ${Math.round(age)} months before ${ym(asOf)}${max !== null ? ` (dictionary limit ${max})` : ""}` : "Flagged STALE at extraction",
      freshness: "STALE",
      currentEvidence: claim ? evidenceOf(claim) : m.sourceId && byId.get(m.sourceId) ? [{ sourceId: m.sourceId, url: byId.get(m.sourceId)!.url, publishedDate: byId.get(m.sourceId)!.publishedDate, retrievedAt: byId.get(m.sourceId)!.retrievedAt }] : [],
      suggestedQueries: [],
      priority: 60,
    });
  }

  /* GAP */
  const refreshed = lastRefreshed(deal);
  const initial = parseDate(deal.analysis.provenance?.startedAt ?? null);
  const webGaps = deal.informationGaps.filter((g) => (g.status === "OPEN" || g.status === "RESEARCHED") && g.researchability === "PUBLIC_WEB");
  for (const g of webGaps) {
    const last = parseDate(refreshed.get(`GAP:${g.id}`)?.at ?? null) ?? initial;
    if (last && months(last, asOf) <= p.gapRecheckMonths) continue;
    candidates.push({
      key: `GAP:${g.id}`,
      kind: "GAP",
      ref: g.id,
      claimIds: [],
      metricId: null,
      gapRef: g.id,
      label: short(g.question),
      reason: last ? `Open question last researched ${ym(last)} (${Math.round(months(last, asOf))} months ago)` : "Open question never researched",
      freshness: null,
      currentEvidence: [],
      suggestedQueries: g.suggestedQueries.slice(0, 3),
      priority: 90 + researchPriorityIndex(g) / 2,
    });
  }

  /* cooldown, order, cap */
  const deferred: StalePlan["deferred"] = [];
  const due: StaleItem[] = [];
  for (const it of candidates) {
    const r = refreshed.get(it.key);
    const at = parseDate(r?.at ?? null);
    if (r && at && (asOf.getTime() - at.getTime()) / 86_400_000 < p.cooldownDays) {
      const next = new Date(at.getTime() + p.cooldownDays * 86_400_000);
      deferred.push({ key: it.key, kind: it.kind, ref: it.ref, label: it.label, reason: `Re-checked ${r.at.slice(0, 10)} (${r.outcome.toLowerCase().replace(/_/g, " ")}); next check after ${next.toISOString().slice(0, 10)}` });
    } else due.push(it);
  }
  due.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  const items = due.slice(0, p.maxItems);
  for (const it of due.slice(p.maxItems)) deferred.push({ key: it.key, kind: it.kind, ref: it.ref, label: it.label, reason: `Over the per-refresh cap of ${p.maxItems} items — next refresh` });
  const counts: Record<StaleKind, number> = { CLAIM: 0, SOURCE: 0, METRIC: 0, GAP: 0 };
  for (const it of items) counts[it.kind]++;
  return {
    asOf: asOf.toISOString(),
    policy: p.version,
    items,
    deferred,
    counts,
    considered: { materialClaims: material.length, webSources: web.length, primaryMetrics: primary.length, openWebGaps: webGaps.length },
  };
}
