/**
 * Synthetic CanonicalDeal builders for the integrity and adversarial suites.
 * Everything uses explicit ids so two independently-built deals are comparable.
 */
import type { CanonicalDeal, Claim, EvidenceLink, MetricInstance, Source } from "@/domain/canonical";
import type { MetricObservation } from "@/domain/sections";
import type { FinancingStage } from "@/domain/enums";
import { getRegistry } from "@/engine/benchmarks";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import { integrityReport, type IntegrityFinding, type IntegrityReport } from "@/engine/integrity";
import { makeDeal, metric } from "../../fixtures";

export const REG = getRegistry();
export const AS_OF = "2026-09-27T00:00:00.000Z";

export function run(deal: CanonicalDeal): IntegrityReport {
  return integrityReport(deal, REG, resolvePeerGroup(deal.classification));
}

/** Metric instance with an explicit id (fixtures.metric() numbers ids globally). */
export function m(id: string, key: string, value: number | null, extra: Partial<MetricInstance> = {}): MetricInstance {
  return metric(key, value, { id, qualityFlags: [], ...extra });
}

export function obs(key: MetricObservation["metricKey"], value: number | null, extra: Partial<MetricObservation> = {}): MetricObservation {
  return {
    metricKey: key,
    label: key,
    rawText: String(value),
    value,
    unit: "USD_OR_CURRENCY",
    currency: "USD",
    periodType: "POINT_IN_TIME",
    periodStart: null,
    periodEnd: "2026-08",
    definitionAsStated: null,
    components: [],
    sampleSize: null,
    cohortDefinition: null,
    state: "OBSERVED",
    basis: "CURRENT",
    sourceKind: "TEXT",
    page: 3,
    excerpt: `${key} ${value}`,
    ...extra,
  };
}

export function link(sourceId: string, effect: EvidenceLink["effect"], extra: Partial<EvidenceLink> = {}): EvidenceLink {
  return { sourceId, effect, excerpt: "excerpt", location: null, note: null, ...extra };
}

export function claim(id: string, extra: Partial<Claim> & { page?: number | null } = {}): Claim {
  const { page = 4, ...rest } = extra;
  return {
    id,
    category: "METRIC",
    statement: `Statement ${id}`,
    valueText: null,
    entity: "company",
    period: null,
    material: true,
    unusualness: 2,
    proposition: null,
    evidenceNeeded: null,
    origin: "COMPANY",
    verification: "UNVERIFIED",
    freshness: "CURRENT",
    independence: "COMPANY_DERIVED",
    verificationMethod: "Stated in company materials",
    limitations: null,
    contradictions: [],
    evidence: [link("SRC-001", "ORIGIN", { location: page !== null ? `p. ${page}` : null, excerpt: `excerpt ${id}` })],
    history: [],
    ...rest,
  };
}

export function docSource(id = "SRC-001"): Source {
  return { id, kind: "DOCUMENT", title: "deck.pdf", url: null, documentId: "doc-1", publisher: "Acme AI", publishedDate: null, retrievedAt: AS_OF, origin: "COMPANY", independenceGroup: "COMPANY", citationVerified: true };
}

export function webSource(id: string, url: string, extra: Partial<Source> = {}): Source {
  let group = "unknown";
  try {
    group = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    /* keep */
  }
  return { id, kind: "WEB", title: `Article ${id}`, url, documentId: null, publisher: null, publishedDate: "2026-06-01", retrievedAt: AS_OF, origin: "INDEPENDENT_SECONDARY", independenceGroup: group, citationVerified: true, ...extra };
}

export function transcriptSource(id = "SRC-900"): Source {
  return { id, kind: "TRANSCRIPT", title: "Founder call", url: null, documentId: null, publisher: null, publishedDate: "2026-09-20", retrievedAt: AS_OF, origin: "COMPANY", independenceGroup: "COMPANY", citationVerified: true };
}

/**
 * A Series A enterprise SaaS deck where every equation between slides holds
 * and every expected evidence item is present: the integrity engine must
 * report zero findings on it.
 */
export function cleanDeal(): CanonicalDeal {
  const d = makeDeal();
  d.identity.website = "https://acme.example";
  d.analysis.provenance = { model: "test", promptVersions: {}, engineVersion: "test", dictionaryVersion: "1.1", schemaVersion: "1.1", inputHash: null, startedAt: AS_OF, durationMs: null };
  d.documents = [{ id: "doc-1", filename: "deck.pdf", kind: "DECK", pages: 12 }];
  d.sources = [docSource()];
  d.metrics = [
    m("MET-001", "arr", 3_840_000, { location: "p. 3" }),
    m("MET-002", "arr", 1_240_000, { periodEnd: "2025-08", isPrimary: false, location: "p. 3", state: "STALE" }),
    m("MET-003", "arr_growth_yoy", 210, { unit: "PERCENT", location: "p. 3" }),
    m("MET-004", "nrr", 118, { unit: "PERCENT", sampleSize: 45, cohortDefinition: "trailing 12-month revenue cohorts", location: "p. 5" }),
    m("MET-005", "gross_margin", 76, { unit: "PERCENT", definitionUsed: "revenue minus hosting, inference, support and implementation", location: "p. 6" }),
    m("MET-006", "cac_payback_months", 14, { unit: "MONTHS", location: "p. 6" }),
    m("MET-007", "burn_multiple", 1.6, { unit: "MULTIPLE", location: "p. 7" }),
    m("MET-008", "runway_months", 8.6, { unit: "MONTHS", location: "p. 7" }),
    m("MET-009", "customer_concentration_top1", 12, { unit: "PERCENT", location: "p. 4" }),
    m("MET-010", "customer_concentration_top5", 35, { unit: "PERCENT", location: "p. 4" }),
    m("MET-011", "paying_customers", 92, { unit: "COUNT", location: "p. 4" }),
    m("MET-012", "paying_customers", 32, { unit: "COUNT", periodEnd: "2025-08", isPrimary: false, location: "p. 4", state: "STALE" }),
    m("MET-013", "acv", 41_700, { location: "p. 4" }),
    m("MET-014", "sales_cycle_days", 75, { unit: "DAYS", location: "p. 8", sampleSize: 20 }),
    m("MET-015", "headcount", 30, { unit: "COUNT", location: "p. 10" }),
  ];
  d.metricObservations = [
    obs("arr", 3_840_000, { page: 3, rawText: "$3.84M ARR" }),
    obs("arr", 3_840_000, { page: 9, rawText: "$3.84M ARR" }),
    obs("arr", 9_000_000, { basis: "FORECAST", periodEnd: "2027-12", page: 11, rawText: "$9M ARR plan" }),
  ];
  d.claims = [
    claim("CLM-001", { category: "METRIC", statement: "ARR reached $3.84M in August 2026", page: 3 }),
    claim("CLM-002", { category: "CUSTOMER", statement: "92 paying mid-market customers in production", page: 4 }),
    claim("CLM-003", { category: "PRODUCT", statement: "Invoices are posted to the ERP without manual keying", page: 2 }),
    claim("CLM-004", { category: "TEAM", statement: "The CTO previously led the invoice extraction team at a payables company", page: 10, material: false }),
  ];
  d.foundersFromDeck = [
    { name: "Ada Founder", role: "CEO", backgroundFromDeck: "Previously ran finance operations", priorOrganizations: ["Midsize Corp"], publicProfileUrls: [] },
    { name: "Bo Builder", role: "CTO", backgroundFromDeck: "Built document pipelines", priorOrganizations: ["Other Corp"], publicProfileUrls: [] },
  ];
  d.customers = {
    icp: "Mid-market finance teams",
    segments: ["mid-market"],
    namedCustomers: [
      { name: "Globex", relationship: "PAYING", evidenceLevel: "PAYING", note: null },
      { name: "Initech", relationship: "PAYING", evidenceLevel: "RECURRING", note: null },
    ],
    concentrationNote: "Top customer 12% of ARR",
    referencesNote: "Three customer references offered, one independent",
  };
  d.businessModel = { howItMakesMoney: "Annual subscription", pricing: "Per-entity annual subscription, median $40k" };
  d.gtm = { user: "AP clerk", buyer: "Controller", economicBuyer: "CFO", icp: "Mid-market", salesMotion: "Inside sales to mid-market finance teams", channels: ["outbound"], salesCycle: "2-3 months", founderLedAssessment: "", assessment: "" };
  d.deckMarket = { tam: { amount: 5_000_000_000, currency: "USD", rawText: "$5B" }, sam: { amount: 1_500_000_000, currency: "USD", rawText: "$1.5B" }, som: { amount: 150_000_000, currency: "USD", rawText: "$150M" }, description: null };
  d.market!.bottomUp = { customerDefinition: "mid-market companies", customerCountLow: 150_000, customerCountHigh: 200_000, annualSpendLowUsd: 15_000, annualSpendHighUsd: 25_000, spendBasis: "test" };
  d.financing!.postMoney = { amount: 60_000_000, currency: "USD", rawText: "$60M post" };
  d.financing!.useOfFunds = ["60% engineering", "40% go-to-market"];
  d.financingPath = { proofPurchased: "$10M ARR", milestoneMonths: 20, plannedMonthlyBurnUsd: 550_000, nextRoundConditions: "", capitalIntensity: "MODERATE", fallbackPlans: "", financingRiskAssessment: "" };
  return d;
}

export function withStage(d: CanonicalDeal, stage: FinancingStage): CanonicalDeal {
  d.classification = { ...d.classification, financingStage: stage };
  return d;
}

export function kinds(r: IntegrityReport): string[] {
  return r.findings.map((f) => f.kind);
}

export function findingsOf(r: IntegrityReport, kind: string): IntegrityFinding[] {
  return r.findings.filter((f) => f.kind === kind);
}

export function one(r: IntegrityReport, kind: string): IntegrityFinding {
  const f = findingsOf(r, kind);
  if (f.length !== 1) throw new Error(`expected exactly one ${kind}, got ${f.length}: ${kinds(r).join(", ")}`);
  return f[0]!;
}

export function implied(r: IntegrityReport, name: string) {
  const row = r.impliedMetrics.find((x) => x.name === name);
  if (!row) throw new Error(`no implied row ${name}`);
  return row;
}

/** Replace (or add) the metric with the given key; the replacement keeps a stable id per key. */
export function setMetric(d: CanonicalDeal, key: string, value: number | null, extra: Partial<MetricInstance> = {}): CanonicalDeal {
  const existing = d.metrics.find((x) => x.metricKey === key && x.isPrimary);
  const id = existing?.id ?? `MET-${key.toUpperCase()}`;
  d.metrics = [...d.metrics.filter((x) => !(x.metricKey === key && x.isPrimary)), m(id, key, value, { unit: existing?.unit ?? "USD", location: existing?.location ?? "p. 5", ...extra })];
  return d;
}

export function removeMetric(d: CanonicalDeal, key: string): CanonicalDeal {
  d.metrics = d.metrics.filter((x) => x.metricKey !== key);
  return d;
}

/** Report without free text: ids, kinds, severities, numbers — for invariance tests. */
export function skeleton(r: IntegrityReport) {
  return {
    findings: r.findings.map((f) => [f.kind, f.severity, f.metricIds, f.claimIds, f.pages]),
    implied: r.impliedMetrics.map((x) => [x.name, x.verdict, x.severity, x.impliedValue, x.statedValue]),
    expected: r.expectedEvidence.items.map((i) => [i.itemId, i.level, i.presence]),
    debt: [r.evidenceDebt.overall, r.evidenceDebt.areas.map((a) => [a.area, a.level, a.items])],
    summary: [r.summary.critical, r.summary.high, r.summary.moderate, r.summary.low, r.summary.evidenceDebtOverall, r.summary.missingExpectedCount],
  };
}
