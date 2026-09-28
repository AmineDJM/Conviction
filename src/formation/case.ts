/**
 * TRAINING CASE — a real deal version seen through two lenses:
 *
 *  - `facts`: what the deck showed (company-reported metrics, financing terms,
 *    deck market sizing, founders as presented, named customers, company
 *    claims). No verification status, no quality flags, no model judgment.
 *  - the full canonical object + derived analysis, used only to build answer
 *    keys (revealed after the answer).
 *
 * Pure: no DB, no network, no wall clock.
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { toUsd } from "@/engine/metrics/normalize";
import { usd } from "@/lib/format";
import { formatMetric } from "./format";
import type { CaseRef, DeckFact, Skill } from "./types";
import { casePatterns, type PatternReading } from "./patterns";
import { rankConcerns, type Concern } from "./concerns";

export interface TrainingCase {
  ref: CaseRef;
  deal: CanonicalDeal;
  derived: DerivedAnalysis;
  /** Business-model skill this case exercises (SaaS metrics, marketplace economics …). */
  domainSkill: Skill | null;
  facts: DeckFact[];
  /** Deck-reported primary metrics by key (company documents only). */
  deckMetrics: Record<string, MetricInstance>;
  concerns: Concern[];
  patterns: PatternReading[];
}

export function dealHref(slug: string, ref?: { kind: "claim" | "metric"; id: string } | null): string {
  if (!ref) return `/deals/${slug}`;
  return `/deals/${slug}/evidence?${ref.kind}=${encodeURIComponent(ref.id)}`;
}

export function domainSkillOf(deal: CanonicalDeal): Skill | null {
  const pt = new Set(deal.classification.productType);
  const tech = new Set(deal.classification.technology);
  const rm = new Set(deal.classification.revenueModel);
  if (pt.has("THERAPEUTIC") || pt.has("DIAGNOSTIC") || pt.has("MEDICAL_DEVICE") || tech.has("BIOLOGY") || tech.has("GENE_EDITING") || rm.has("DRUG_ECONOMICS")) return "BIOTECH";
  if (pt.has("HARDWARE") || pt.has("ROBOTICS") || ["SEMICONDUCTORS", "QUANTUM", "MATERIALS", "ENERGY_STORAGE", "ROBOTICS"].some((t) => tech.has(t as never))) return "DEEPTECH";
  if (pt.has("MARKETPLACE") || rm.has("TAKE_RATE")) return "MARKETPLACE_ECONOMICS";
  if (pt.has("CONSUMER_APP") || deal.classification.industry.includes("CONSUMER")) return "CONSUMER_METRICS";
  if (pt.has("SAAS") || pt.has("AI_AGENT") || pt.has("API_PLATFORM") || pt.has("SOFTWARE_INFRASTRUCTURE") || rm.has("SUBSCRIPTION")) return "SAAS_METRICS";
  return null;
}

/** Sources that are the company's own documents (deck, data room). */
function documentSourceIds(deal: CanonicalDeal): Set<string> {
  return new Set(deal.sources.filter((s) => s.kind === "DOCUMENT").map((s) => s.id));
}

function pageOf(location: string | null | undefined): number | null {
  const m = location ? /p\.?\s*(\d+)/i.exec(location) : null;
  return m ? Number(m[1]) : null;
}

/** Metrics the deck itself reported (not derived by code, not corrected by an analyst, not from calls or the web). */
export function deckReportedMetrics(deal: CanonicalDeal): MetricInstance[] {
  const docs = documentSourceIds(deal);
  return deal.metrics.filter(
    (m) =>
      m.calculationMethod === "REPORTED" &&
      m.normalizedValue !== null &&
      Number.isFinite(m.normalizedValue) &&
      (m.sourceId === null ? m.location !== null : docs.has(m.sourceId)),
  );
}

const moneyUsd = (m: { amount: number | null; currency: string } | null | undefined) => (m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null);

const METRIC_GROUP: Record<string, DeckFact["group"]> = {
  REVENUE: "Traction",
  RETENTION: "Traction",
  CUSTOMERS: "Customers",
  UNIT_ECONOMICS: "Economics",
  CASH: "Financing",
  GTM: "Economics",
  CONSUMER: "Traction",
  MARKETPLACE: "Traction",
  FINTECH: "Traction",
  HARDWARE: "Traction",
  DEEPTECH: "Traction",
};

const COMMENTARY = /not (stated|disclosed|specified|defined|provided|clear)|does not|doesn't|unclear|unknown|ambiguous|unverified|appears to|analyst|model|we assume|assum/i;

/** Every fact the deck showed, in a stable order. */
export function deckFacts(deal: CanonicalDeal): DeckFact[] {
  const facts: DeckFact[] = [];
  facts.push({ id: "F-ONELINER", group: "Company", label: "What it does", value: deal.identity.oneLiner || "—", detail: null, page: null, ref: null });
  if (deal.classification.declaredStage) facts.push({ id: "F-STAGE", group: "Company", label: "Round", value: deal.classification.declaredStage, detail: null, page: null, ref: null });
  if (deal.businessModel?.pricing) facts.push({ id: "F-PRICING", group: "Company", label: "Pricing (as stated)", value: deal.businessModel.pricing, detail: null, page: null, ref: null });

  const metrics = [...deckReportedMetrics(deal)].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.id < b.id ? -1 : 1));
  for (const m of metrics) {
    const def = metricDef(m.metricKey);
    // Definitions are shown only when they read as the deck's own words — extraction commentary ("not stated", "unclear") would hint at the answer.
    const definition = m.definitionUsed && !COMMENTARY.test(m.definitionUsed) ? m.definitionUsed : null;
    const bits = [m.periodEnd ? `as of ${m.periodEnd}` : null, m.sampleSize ? `n = ${m.sampleSize}` : null, definition && !m.components.length ? `defined as “${definition}”` : null, m.components.length ? m.components.join("; ") : null].filter(Boolean);
    facts.push({
      id: `F-${m.id}`,
      group: METRIC_GROUP[def?.family ?? ""] ?? "Traction",
      label: m.label || def?.shortName || m.metricKey,
      value: m.rawValue && m.rawValue.length <= 90 ? m.rawValue : formatMetric(m),
      detail: bits.length ? bits.join(" · ") : null,
      page: pageOf(m.location),
      ref: { kind: "metric", id: m.id },
    });
  }

  const f = deal.financing;
  const reportedKeys = new Set(metrics.map((m) => m.metricKey));
  if (f) {
    const money = (id: string, label: string, v: { amount: number | null; currency: string; rawText: string } | null) => {
      if (!v || v.amount === null) return;
      facts.push({ id, group: "Financing", label, value: v.rawText || usd(moneyUsd(v)), detail: null, page: null, ref: null });
    };
    if (f.instrument !== "UNKNOWN") facts.push({ id: "F-INSTRUMENT", group: "Financing", label: "Instrument", value: f.instrument.replace(/_/g, " ").toLowerCase(), detail: null, page: null, ref: null });
    money("F-RAISE", "Raising", f.raiseAmount);
    money("F-PRE", "Pre-money", f.preMoney);
    money("F-POST", "Post-money", f.postMoney);
    money("F-CAP", "Valuation cap", f.valuationCap);
    // Cash, burn and runway appear once: as the deck metric when the deck reported one.
    if (!reportedKeys.has("cash_balance")) money("F-CASH", "Cash (as stated)", f.cashBalance);
    if (!reportedKeys.has("monthly_net_burn")) money("F-BURN", "Monthly burn (as stated)", f.monthlyBurn);
    money("F-RAISED", "Raised to date", f.totalRaisedToDate);
    if (f.runwayClaimMonths !== null && !reportedKeys.has("runway_months")) facts.push({ id: "F-RUNWAY-CLAIM", group: "Financing", label: "Runway (as stated)", value: `${f.runwayClaimMonths} months`, detail: null, page: null, ref: null });
    if (f.useOfFunds.length) facts.push({ id: "F-USE", group: "Financing", label: "Use of funds", value: f.useOfFunds.join(" · "), detail: null, page: null, ref: null });
    f.milestonesClaimed.forEach((m, i) =>
      facts.push({ id: `F-MILESTONE-${i + 1}`, group: "Financing", label: "Milestone claimed", value: m.milestone, detail: m.monthsFromNow !== null ? `in ${m.monthsFromNow} months` : null, page: null, ref: null }),
    );
  }

  const dm = deal.deckMarket;
  for (const [k, label] of [["tam", "TAM (deck)"], ["sam", "SAM (deck)"], ["som", "SOM (deck)"]] as const) {
    const v = dm[k];
    if (v && v.amount !== null) facts.push({ id: `F-${k.toUpperCase()}`, group: "Market", label, value: v.rawText || usd(moneyUsd(v)), detail: null, page: null, ref: null });
  }

  deal.foundersFromDeck.forEach((p, i) =>
    facts.push({
      id: `F-FOUNDER-${i + 1}`,
      group: "Team",
      label: `${p.name}, ${p.role}`,
      value: p.backgroundFromDeck || "—",
      detail: p.priorOrganizations.length ? `Prior: ${p.priorOrganizations.join(", ")}` : null,
      page: null,
      ref: null,
    }),
  );

  for (const c of deal.customers?.namedCustomers ?? [])
    facts.push({ id: `F-CUST-${c.name.replace(/[^A-Za-z0-9]+/g, "").slice(0, 24)}`, group: "Customers", label: "Named on the deck", value: c.name, detail: null, page: null, ref: null });

  const docs = documentSourceIds(deal);
  for (const cl of deal.claims) {
    const origin = cl.evidence.find((e) => e.effect === "ORIGIN" && docs.has(e.sourceId));
    if (!origin || cl.origin !== "COMPANY" || !cl.material) continue;
    facts.push({ id: `F-${cl.id}`, group: "Claims", label: cl.category.charAt(0) + cl.category.slice(1).toLowerCase(), value: cl.statement, detail: null, page: pageOf(origin.location), ref: { kind: "claim", id: cl.id } });
  }
  return facts;
}

export interface BuildCaseInput {
  ref: CaseRef;
  deal: CanonicalDeal;
  derived: DerivedAnalysis;
}

export function buildCase(input: BuildCaseInput): TrainingCase {
  const { deal, derived } = input;
  const deckMetrics: Record<string, MetricInstance> = {};
  for (const m of deckReportedMetrics(deal)) if (m.isPrimary && !deckMetrics[m.metricKey]) deckMetrics[m.metricKey] = m;
  const concerns = rankConcerns(deal, derived, deckMetrics);
  return {
    ref: input.ref,
    deal,
    derived,
    domainSkill: domainSkillOf(deal),
    facts: deckFacts(deal),
    deckMetrics,
    concerns,
    patterns: casePatterns(deal, derived, deckMetrics, concerns),
  };
}

/** Facts selected by id, in the given order; unknown ids are skipped. */
export function pickFacts(c: TrainingCase, ids: string[]): DeckFact[] {
  const byId = new Map(c.facts.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)).filter((f): f is DeckFact => !!f);
}

export function metricFactId(m: MetricInstance): string {
  return `F-${m.id}`;
}
