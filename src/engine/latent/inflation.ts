/**
 * §4 NARRATIVE INFLATION RISK — presentation choices that raise the
 * impression of performance. Not accusations: each item states the technique,
 * the evidence, the page, whether the model observed it or code computed it,
 * and its weight.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { LatentSignalsDraft } from "@/domain/sections";
import type { PeerGroupRef } from "../scoring/peer";
import type { MarketReconstruction } from "../market";
import type { LatentBasis, LatentModule, RiskLevel } from "./types";
import { forecastSeparation } from "./precision";
import {
  CONTRACTED_BASES,
  CURRENT_BASES,
  FORWARD_BASES_SET,
  REVENUE_KEYS,
  VOLUME_KEYS,
  bases,
  coverage,
  currentValue,
  dedupeObservations,
  fmtUsd,
  lower,
  obsHeadline,
  obsText,
  obsUsd,
  pageFromLocation,
  pagesOf,
  round,
} from "./util";

export type Technique = LatentSignalsDraft["presentationTechniques"][number]["technique"];

export const TECHNIQUE_WEIGHT: Record<Technique, number> = {
  PIPELINE_AS_BOOKED: 3,
  FORECAST_DRAWN_AS_ACTUAL: 3,
  GMV_INSTEAD_OF_NET_REVENUE: 3,
  FREE_USERS_AS_CUSTOMERS: 2,
  PILOTS_MIXED_WITH_CUSTOMERS: 2,
  LOIS_MIXED_WITH_CONTRACTS: 2,
  CUMULATIVE_INSTEAD_OF_PERIOD: 2,
  CAGR_FROM_TINY_BASE: 2,
  ADJACENT_TAM_AS_ADDRESSABLE: 2,
  LOGOS_WITHOUT_STATUS: 1,
  OTHER: 1,
};

export const TECHNIQUE_LABEL: Record<Technique, string> = {
  CUMULATIVE_INSTEAD_OF_PERIOD: "Cumulative figure instead of period figure",
  GMV_INSTEAD_OF_NET_REVENUE: "GMV presented instead of net revenue",
  PIPELINE_AS_BOOKED: "Pipeline / signed / booked presented as ARR",
  PILOTS_MIXED_WITH_CUSTOMERS: "Pilots mixed with customers",
  LOIS_MIXED_WITH_CONTRACTS: "LOIs mixed with contracts",
  FORECAST_DRAWN_AS_ACTUAL: "Forecast drawn as actual",
  FREE_USERS_AS_CUSTOMERS: "Free users counted as customers",
  CAGR_FROM_TINY_BASE: "Growth rate from a tiny base",
  LOGOS_WITHOUT_STATUS: "Logos without relationship status",
  ADJACENT_TAM_AS_ADDRESSABLE: "Adjacent TAM presented as addressable",
  OTHER: "Other presentation technique",
};

export interface InflationItem {
  technique: Technique;
  label: string;
  evidence: string;
  page: number | null;
  source: "MODEL" | "COMPUTED";
  weight: number;
}

export interface NarrativeInflation extends LatentModule {
  level: RiskLevel;
  score: number;
  items: InflationItem[];
  /** One line per distinct technique with the sources that detected it. */
  techniques: { technique: Technique; label: string; weight: number; sources: ("MODEL" | "COMPUTED")[]; pages: number[] }[];
  why: string[];
}

const CUMULATIVE_RE = /\bcumulative\b|\bsince (inception|launch|founding|day one)\b|\bto date\b|\ball[- ]time\b|\blifetime (gmv|revenue|sales|volume|users|customers|bookings)\b/;
const FLOW_KEYS = new Set(["arr", "mrr", "revenue_ttm", "gmv", "tpv", "units_shipped", "paying_customers", "OTHER"]);

function relClose(a: number, b: number, tol: number) {
  return Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b));
}

export function computedInflation(deal: CanonicalDeal, peer: PeerGroupRef, market: MarketReconstruction | null, asOf: Date): InflationItem[] {
  const out: InflationItem[] = [];
  const add = (technique: Technique, evidence: string, page: number | null, weight = TECHNIQUE_WEIGHT[technique]) =>
    out.push({ technique, label: TECHNIQUE_LABEL[technique], evidence, page, source: "COMPUTED", weight });
  const obs = dedupeObservations(deal.metricObservations ?? []).filter((o) => o.state !== "WITHHELD");
  const metrics = deal.metrics ?? [];

  // Cumulative instead of period.
  for (const o of obs) {
    if (!FLOW_KEYS.has(o.metricKey)) continue;
    if (o.periodType === "CUMULATIVE" || CUMULATIVE_RE.test(obsHeadline(o)))
      add("CUMULATIVE_INSTEAD_OF_PERIOD", `"${o.rawText}" (${o.label}) is a cumulative / since-inception figure, not a period or run-rate figure`, o.page);
  }
  for (const m of metrics)
    if (m.qualityFlags.some((f) => f.startsWith("CUMULATIVE_NOT_RUN_RATE")) && !out.some((i) => i.technique === "CUMULATIVE_INSTEAD_OF_PERIOD" && i.evidence.includes(m.rawValue)))
      add("CUMULATIVE_INSTEAD_OF_PERIOD", `${m.metricKey} "${m.rawValue}" flagged CUMULATIVE_NOT_RUN_RATE`, pageFromLocation(m.location));
  for (const c of deal.forensics?.chartForensics ?? [])
    if (c.issue === "CUMULATIVE_AS_RUN_RATE") add("CUMULATIVE_INSTEAD_OF_PERIOD", `Chart forensics: ${c.detail}`, c.page);

  // GMV instead of net revenue.
  const volumes = obs.filter((o) => VOLUME_KEYS.has(o.metricKey) && CURRENT_BASES.has(o.basis) && obsUsd(o) !== null);
  const revenues = obs.filter((o) => REVENUE_KEYS.has(o.metricKey) && CURRENT_BASES.has(o.basis) && obsUsd(o) !== null);
  for (const r of revenues) {
    const rv = obsUsd(r)!;
    const twin = volumes.find((v) => relClose(obsUsd(v)!, rv, 0.1) && (!v.periodEnd || !r.periodEnd || v.periodEnd.slice(0, 7) === r.periodEnd.slice(0, 7)));
    if (twin) add("GMV_INSTEAD_OF_NET_REVENUE", `Revenue "${r.rawText}" ≈ ${twin.metricKey.toUpperCase()} "${twin.rawText}" — revenue appears to be gross volume, not net revenue`, r.page);
    else if (/\bgmv\b|gross merchandise|transaction volume|\bgross bookings\b|\btpv\b/.test(obsHeadline(r)))
      add("GMV_INSTEAD_OF_NET_REVENUE", `Revenue metric "${r.label}: ${r.rawText}" is labelled as gross volume`, r.page);
  }
  const isMarketplaceLike = peer.profile === "MARKETPLACE" || peer.profile === "FINTECH";
  const hasTake = obs.some((o) => o.metricKey === "take_rate" && CURRENT_BASES.has(o.basis)) || metrics.some((m) => m.metricKey === "take_rate");
  if (isMarketplaceLike && volumes.length && !revenues.length && !hasTake && !out.some((i) => i.technique === "GMV_INSTEAD_OF_NET_REVENUE"))
    add("GMV_INSTEAD_OF_NET_REVENUE", `Gross volume "${volumes[0]!.rawText}" is shown without net revenue or take rate`, volumes[0]!.page, 2);

  // Pipeline / signed / booked presented as ARR.
  for (const o of obs) {
    if (!REVENUE_KEYS.has(o.metricKey)) continue;
    if (o.basis === "PIPELINE" || CONTRACTED_BASES.has(o.basis))
      add("PIPELINE_AS_BOOKED", `"${o.rawText}" is labelled ${o.label} but its basis is ${o.basis.toLowerCase()} (not live recurring revenue)`, o.page);
    else if (/\bpipeline\b|\bsigned\b|\bbooked\b|\bbookings\b|\bcontracted\b|\bcommitted\b/.test(obsHeadline(o)) && !/\bexclud/.test(obsText(o)))
      add("PIPELINE_AS_BOOKED", `"${o.label}: ${o.rawText}" mixes signed / pipeline wording into a revenue figure`, o.page);
  }
  for (const m of metrics) {
    const f = m.qualityFlags.find((x) => x.startsWith("SIGNED_NOT_DEPLOYED") || x.startsWith("ARR_MAY_INCLUDE_NON_RECURRING"));
    if (f && !out.some((i) => i.technique === "PIPELINE_AS_BOOKED" && i.page === pageFromLocation(m.location)))
      add("PIPELINE_AS_BOOKED", `${m.metricKey} "${m.rawValue}": ${f}`, pageFromLocation(m.location));
  }

  // Pilots / LOIs mixed with customers.
  const customerClaims = (deal.claims ?? []).filter((c) => (c.category === "CUSTOMER" || c.category === "METRIC") && /\b(customers?|clients?|contracts?)\b/i.test(c.statement));
  for (const m of metrics) {
    const f = m.qualityFlags.find((x) => x.startsWith("CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING"));
    if (!f) continue;
    const t = lower(`${m.definitionUsed ?? ""} ${m.components.join(" ")} ${m.rawValue}`);
    if (/\bloi|letter of intent|\bmou\b/.test(t)) add("LOIS_MIXED_WITH_CONTRACTS", `Customer count "${m.rawValue}" includes LOIs (${f})`, pageFromLocation(m.location));
    else if (/\bfree|freemium|registered|sign[- ]?up/.test(t)) add("FREE_USERS_AS_CUSTOMERS", `Customer count "${m.rawValue}" includes free users (${f})`, pageFromLocation(m.location));
    else add("PILOTS_MIXED_WITH_CUSTOMERS", `Customer count "${m.rawValue}" may include pilots or trials (${f})`, pageFromLocation(m.location));
  }
  const customerObs = obs.filter((o) => o.metricKey === "paying_customers" || (o.metricKey === "OTHER" && /\b(customers?|clients?)\b/.test(lower(o.label))));
  for (const o of customerObs) {
    const t = obsText(o);
    if (out.some((i) => i.page === o.page && ["PILOTS_MIXED_WITH_CUSTOMERS", "LOIS_MIXED_WITH_CONTRACTS", "FREE_USERS_AS_CUSTOMERS"].includes(i.technique))) continue;
    if (/\bincl\w*\b[^|]*\b(pilots?|trials?|pocs?|design partners?)\b|\b(pilots?|trials?|pocs?)\b/.test(t) && !/\bexcl\w*\b[^|]*\b(pilots?|trials?)/.test(t))
      add("PILOTS_MIXED_WITH_CUSTOMERS", `"${o.label}: ${o.rawText}" counts pilots / trials among customers`, o.page);
    else if (/\blo[i1]s?\b|letters? of intent|\bmous?\b/.test(t) && !/\bexcl\w*\b[^|]*\blo[i1]/.test(t))
      add("LOIS_MIXED_WITH_CONTRACTS", `"${o.label}: ${o.rawText}" counts LOIs among customers / contracts`, o.page);
    else if (/\bfree\b|\bfreemium\b|\bregistered\b|\bsign[- ]?ups?\b|\busers?\b/.test(t) && !/\bexcl\w*\b[^|]*\bfree/.test(t) && !/\bpaying\b/.test(lower(o.label)))
      add("FREE_USERS_AS_CUSTOMERS", `"${o.label}: ${o.rawText}" counts free or registered users as customers`, o.page);
  }
  const named = deal.customers?.namedCustomers ?? [];
  if (customerClaims.length) {
    const pilots = named.filter((c) => c.relationship === "PILOT" || c.evidenceLevel === "PILOT");
    const lois = named.filter((c) => c.relationship === "LOI");
    const page = pageFromLocation(customerClaims[0]!.evidence[0]?.location ?? null);
    if (pilots.length && !out.some((i) => i.technique === "PILOTS_MIXED_WITH_CUSTOMERS"))
      add("PILOTS_MIXED_WITH_CUSTOMERS", `Named "customers" include pilots: ${pilots.map((c) => c.name).join(", ")}`, page);
    if (lois.length && !out.some((i) => i.technique === "LOIS_MIXED_WITH_CONTRACTS"))
      add("LOIS_MIXED_WITH_CONTRACTS", `Named "customers" include LOIs: ${lois.map((c) => c.name).join(", ")}`, page);
  }

  // Forecast drawn as actual.
  const fs = forecastSeparation(deal, obs, asOf);
  for (const i of fs.issues) if (/drawn on the same chart|after the analysis date/.test(i.text)) add("FORECAST_DRAWN_AS_ACTUAL", i.text, i.page);
  const forwardChartPages = new Set(obs.filter((o) => o.sourceKind === "CHART" && FORWARD_BASES_SET.has(o.basis) && o.page !== null).map((o) => o.page!));
  for (const c of deal.forensics?.chartForensics ?? [])
    if (c.page !== null && forwardChartPages.has(c.page) && ["HIDDEN_PERIOD", "INCONSISTENT_SCALE", "TRUNCATED_OR_UNLABELLED", "OTHER", "MISLEADING_CAGR"].includes(c.issue) && !out.some((i) => i.technique === "FORECAST_DRAWN_AS_ACTUAL" && i.page === c.page))
      add("FORECAST_DRAWN_AS_ACTUAL", `Chart on p. ${c.page} mixes forecast values and is flagged ${c.issue}: ${c.detail}`, c.page);

  // Growth rate from a tiny base.
  const revenueNow = currentValue(deal, "arr") ?? currentValue(deal, "revenue_ttm") ?? (() => {
    const mrr = currentValue(deal, "mrr");
    return mrr ? { ...mrr, value: mrr.value * 12 } : null;
  })();
  const customersNow = currentValue(deal, "paying_customers");
  const growthObs = obs.filter(
    (o) => (["arr_growth_yoy", "revenue_growth_yoy"].includes(o.metricKey) || (o.metricKey === "OTHER" && /\bcagr\b|\bgrowth\b|\byoy\b/.test(obsHeadline(o)))) && o.unit === "PERCENT" && o.value !== null && CURRENT_BASES.has(o.basis),
  );
  const growthMetrics = metrics.filter((m) => ["arr_growth_yoy", "revenue_growth_yoy"].includes(m.metricKey) && m.normalizedValue !== null);
  const growth = growthObs[0]
    ? { g: growthObs[0].value!, text: growthObs[0].rawText, page: growthObs[0].page }
    : growthMetrics[0]
      ? { g: growthMetrics[0].normalizedValue!, text: growthMetrics[0].rawValue, page: pageFromLocation(growthMetrics[0].location) }
      : null;
  if (growth && growth.g > 0) {
    const base = revenueNow ? revenueNow.value / (1 + growth.g / 100) : null;
    if (base !== null && base < 100_000) add("CAGR_FROM_TINY_BASE", `Growth "${growth.text}" implies a starting base of ~${fmtUsd(base)} (current ${fmtUsd(revenueNow!.value)}) — below $100k`, growth.page);
    else if (customersNow && customersNow.value < 10) add("CAGR_FROM_TINY_BASE", `Growth "${growth.text}" is computed on fewer than 10 paying customers (${customersNow.value})`, growth.page);
  }
  for (const c of deal.forensics?.chartForensics ?? [])
    if (c.issue === "MISLEADING_CAGR" && !out.some((i) => i.technique === "CAGR_FROM_TINY_BASE")) add("CAGR_FROM_TINY_BASE", `Chart forensics: ${c.detail}`, c.page);

  // Logos without status.
  const unknownLogos = named.filter((c) => c.evidenceLevel === "UNKNOWN" || c.evidenceLevel === "LOGO_ONLY");
  if (unknownLogos.length) {
    const share = unknownLogos.length / named.length;
    const logoWall = deal.forensics?.visualElements.find((v) => v.kind === "LOGO_WALL");
    add(
      "LOGOS_WITHOUT_STATUS",
      `${unknownLogos.length} of ${named.length} named customers have no stated relationship status (logo only / unknown): ${unknownLogos.slice(0, 6).map((c) => c.name).join(", ")}`,
      logoWall?.page ?? null,
      unknownLogos.length >= 3 || share >= 0.5 ? TECHNIQUE_WEIGHT.LOGOS_WITHOUT_STATUS + 1 : TECHNIQUE_WEIGHT.LOGOS_WITHOUT_STATUS,
    );
  }

  // Adjacent TAM presented as addressable.
  if (market?.deckInflation && market.deckInflation > 3)
    add(
      "ADJACENT_TAM_AS_ADDRESSABLE",
      `Deck TAM ${fmtUsd(market.deckTamUsd)} is ${round(market.deckInflation, 1)}× the reconstructed market (${fmtUsd(market.primary?.highUsd)}, ${market.primary?.method.toLowerCase().replace("_", "-")})`,
      null,
      market.deckInflation > 10 ? 3 : 2,
    );
  const marketIssues = deal.forensics?.marketSlide.issues ?? [];
  const tamIssue = marketIssues.find((i) => /adjacent|entire|whole|global|total|inflat|top[- ]down|not addressable|unaddressable|broader/i.test(i));
  if (tamIssue && !out.some((i) => i.technique === "ADJACENT_TAM_AS_ADDRESSABLE")) add("ADJACENT_TAM_AS_ADDRESSABLE", `Market-slide forensics: ${tamIssue}`, null);
  return out;
}

export function narrativeInflation(deal: CanonicalDeal, peer: PeerGroupRef, market: MarketReconstruction | null, asOf: Date): NarrativeInflation {
  const computed = computedInflation(deal, peer, market, asOf);
  const model: InflationItem[] = (deal.latentSignals?.presentationTechniques ?? []).map((t) => ({
    technique: t.technique,
    label: TECHNIQUE_LABEL[t.technique] ?? t.technique,
    evidence: t.detail,
    page: t.page,
    source: "MODEL" as const,
    weight: TECHNIQUE_WEIGHT[t.technique] ?? 1,
  }));
  const items = [...computed, ...model];
  const byTech = new Map<Technique, NarrativeInflation["techniques"][number]>();
  for (const i of items) {
    const e = byTech.get(i.technique);
    if (!e) byTech.set(i.technique, { technique: i.technique, label: i.label, weight: i.weight, sources: [i.source], pages: pagesOf([i.page]) });
    else {
      e.weight = Math.max(e.weight, i.weight);
      e.sources = [...new Set([...e.sources, i.source])].sort();
      e.pages = pagesOf([...e.pages, i.page]);
    }
  }
  const techniques = [...byTech.values()].sort((a, b) => b.weight - a.weight || a.technique.localeCompare(b.technique));
  const score = techniques.reduce((a, t) => a + t.weight, 0);
  const hasInputs = (deal.metricObservations?.length ?? 0) > 0 || (deal.metrics?.length ?? 0) > 0 || !!deal.latentSignals || !!deal.customers;
  const level: RiskLevel = !hasInputs ? "INSUFFICIENT_EVIDENCE" : score >= 6 ? "HIGH" : score >= 3 ? "MODERATE" : "LOW";
  const basis: LatentBasis[] = bases(computed.length > 0 && "COMPUTED", model.length > 0 && "MODEL_OBSERVED");
  return {
    basis: basis.length ? basis : ["COMPUTED"],
    pages: pagesOf(items.map((i) => i.page)),
    coverage: coverage(
      [deal.metricObservations?.length ? "metric observations" : null, deal.latentSignals ? "model presentation techniques" : null, deal.forensics ? "deck forensics" : null, deal.customers ? "named customers" : null, market?.primary ? "reconstructed market" : null].filter((x): x is string => !!x),
      [deal.metricObservations?.length ? null : "metric observations", deal.latentSignals ? null : "model presentation techniques", deal.forensics ? null : "deck forensics", deal.customers ? null : "named customers", market?.primary ? null : "reconstructed market"].filter((x): x is string => !!x),
      "Presentation choices that raise the impression of performance — not accusations of misstatement.",
    ),
    rule: "Score = Σ over distinct techniques of the highest weight found (model or computed; weights: pipeline-as-booked, forecast-as-actual, GMV-as-revenue 3; pilots/LOIs/free users mixed with customers, cumulative, tiny-base growth, adjacent TAM 2 (3 when deck TAM >10× reconstruction); logos without status 1 (2 when ≥3 or ≥50% of logos)). HIGH ≥6, MODERATE ≥3, else LOW.",
    level,
    score,
    items,
    techniques,
    why: techniques.map((t) => `${t.label} (${t.sources.join(" + ").toLowerCase()}${t.pages.length ? `, p. ${t.pages.join(", ")}` : ""}; weight ${t.weight})`),
  };
}
