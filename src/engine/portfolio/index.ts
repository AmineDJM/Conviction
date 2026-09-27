/**
 * PORTFOLIO INTELLIGENCE (pure, deterministic).
 *
 * Input: the current version of every deal (canonical + derived) and the fund
 * profile. Output: redundancy between deals, sector/stage/geography exposure,
 * correlated-risk clusters, asymmetric-upside screen and a transparent
 * ranking of where the next $1M creates the most fund-return capacity.
 *
 * Every rule and constant is stated in the output. Rankings and indices are
 * conventional — never probabilities.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { DecisionStatus, EvidenceQuality, RiskCategory } from "@/domain/enums";
import type { PriceSensitivityRow, ReturnModel } from "../returns";
import type { FinancingMap } from "../financing";
import type { EconomicsReport } from "../economics";

/* ---------------------------------------------------------------- */
/* Inputs                                                             */
/* ---------------------------------------------------------------- */

/** The slice of DerivedAnalysis the portfolio layer reads (DerivedAnalysis is assignable to it). */
export interface PortfolioDerived {
  returns: ReturnModel;
  priceSensitivity: PriceSensitivityRow[];
  powerLaw: { value: number | null };
  evidence: { category: EvidenceQuality; index: number };
  recommendation: { status: DecisionStatus };
  fundFit: { mandate: "PASS" | "FAIL" | "INCOMPLETE" };
  financing: Pick<FinancingMap, "risk">;
  economics?: EconomicsReport | null;
}

export interface PortfolioDeal {
  companyId: string;
  name: string;
  canonical: CanonicalDeal;
  derived: PortfolioDerived;
}

export interface PortfolioOptions {
  /** Include deals whose financing risk is CRITICAL in the allocation ranking. */
  allowCriticalFinancing?: boolean;
  /** Share of a view's capital above which a sector/stage/geography bucket is flagged (INTERNAL_POLICY). */
  bucketLimitPct?: number;
  /** Size of the marginal allocation, USD. */
  allocationUnitUsd?: number;
}

/* ---------------------------------------------------------------- */
/* Constants (explicit)                                               */
/* ---------------------------------------------------------------- */

/** Evidence discount factors — conventional haircuts by evidence category, not probabilities. */
export const EVIDENCE_FACTORS: Record<EvidenceQuality, number> = { VERY_HIGH: 1, HIGH: 0.85, MODERATE: 0.65, LOW: 0.4 };
export const REDUNDANCY_WEIGHTS = { classification: 0.4, competitors: 0.35, segments: 0.25 } as const;
export const REDUNDANCY_THRESHOLDS = { OVERLAPPING: 0.3, REDUNDANT: 0.5 } as const;
export const ASYMMETRY = { minOutlierMoic: 20, minAdjustedPowerLaw: 60 } as const;
export const DEFAULT_BUCKET_LIMIT_PCT = 40;
const EXCLUDED_STATUSES: DecisionStatus[] = ["SCREEN_OUT", "ANALYTICAL_RECOMMEND_PASS"];

/** Platform dependencies detected in risk / competition / market text. */
export const PLATFORM_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "OpenAI", re: /\bopen\s?ai\b|\bchatgpt\b|\bgpt-?\d/i },
  { label: "Anthropic", re: /\banthropic\b|\bclaude\b/i },
  { label: "Foundation-model / inference provider", re: /model provider|foundation model|\bllm (provider|api|vendor)|\binference\b/i },
  { label: "Google", re: /\bgoogle\b|\bgemini\b/i },
  { label: "Microsoft", re: /\bmicrosoft\b|\bazure\b|\bcopilot\b/i },
  { label: "AWS", re: /\baws\b|amazon web services/i },
  { label: "Salesforce", re: /\bsalesforce\b/i },
  { label: "Shopify", re: /\bshopify\b/i },
  { label: "App stores", re: /app store|google play/i },
];

/** Regulatory regimes detected in REGULATORY risk text. */
export const REGULATORY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "HIPAA", re: /\bhipaa\b/i },
  { label: "GDPR", re: /\bgdpr\b/i },
  { label: "FDA", re: /\bfda\b/i },
  { label: "EU AI Act", re: /\bai act\b/i },
  { label: "SEC / FINRA", re: /\bsec\b|\bfinra\b/i },
  { label: "KYC / AML", re: /\bkyc\b|\baml\b|anti-money/i },
  { label: "PSD2 / open banking", re: /\bpsd2\b|open banking/i },
  { label: "CFPB / consumer lending", re: /\bcfpb\b|consumer lending/i },
];

/* ---------------------------------------------------------------- */
/* Helpers                                                            */
/* ---------------------------------------------------------------- */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const isCommitted = (d: PortfolioDeal) => d.canonical.executionStatus === "SIGNED" || d.canonical.executionStatus === "FUNDED";

/** Admissible: not screened out or passed, mandate not failed, IC not rejected. */
export function isAdmissible(d: PortfolioDeal): boolean {
  return !EXCLUDED_STATUSES.includes(d.derived.recommendation.status) && d.derived.fundFit.mandate !== "FAIL" && d.canonical.icDecision !== "REJECTED";
}

/** Default check + reserves (the capital a deal commits the fund to). */
export function capitalFor(d: PortfolioDeal): number {
  return d.derived.returns.inputs.checkUsd + d.derived.returns.inputs.reserveUsd;
}

const pct = (n: number) => `${n.toFixed(1)}%`;
const usd = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${(n / 1e3).toFixed(0)}k`);

/* ---------------------------------------------------------------- */
/* Redundancy                                                         */
/* ---------------------------------------------------------------- */

export interface RedundancyPair {
  a: { companyId: string; name: string };
  b: { companyId: string; name: string };
  score: number;
  level: "REDUNDANT" | "OVERLAPPING";
  components: { classification: number; competitors: number | null; segments: number | null };
  shared: { classification: string[]; competitors: string[]; segments: string[] };
  reason: string;
}

function classificationSet(d: CanonicalDeal): Set<string> {
  const c = d.classification;
  return new Set([...c.industry.map((x) => `industry:${x}`), ...c.productType.map((x) => `product:${x}`), ...c.gtm.map((x) => `gtm:${x}`)]);
}

function competitorSet(d: CanonicalDeal): Set<string> {
  return new Set(
    (d.competition?.competitors ?? []).filter((c) => c.type !== "DO_NOTHING" && c.type !== "INTERNAL_SOLUTION").map((c) => norm(c.name)).filter(Boolean),
  );
}

function segmentSet(d: CanonicalDeal): Set<string> {
  return new Set((d.customers?.segments ?? []).map(norm).filter(Boolean));
}

export function redundancyScore(x: CanonicalDeal, y: CanonicalDeal): Omit<RedundancyPair, "a" | "b" | "level" | "reason"> {
  const cx = classificationSet(x);
  const cy = classificationSet(y);
  const kx = competitorSet(x);
  const ky = competitorSet(y);
  const sx = segmentSet(x);
  const sy = segmentSet(y);
  const cls = jaccard(cx, cy);
  const comp = kx.size || ky.size ? jaccard(kx, ky) : null;
  const seg = sx.size || sy.size ? jaccard(sx, sy) : null;
  // Components with no data on either side are left out and the weights renormalized (stated in `components`).
  const w = REDUNDANCY_WEIGHTS;
  let num = w.classification * cls;
  let den = w.classification;
  if (comp !== null) {
    num += w.competitors * comp;
    den += w.competitors;
  }
  if (seg !== null) {
    num += w.segments * seg;
    den += w.segments;
  }
  const inter = <T>(a: Set<T>, b: Set<T>) => [...a].filter((v) => b.has(v)).map(String).sort();
  return {
    score: num / den,
    components: { classification: cls, competitors: comp, segments: seg },
    shared: { classification: inter(cx, cy), competitors: inter(kx, ky), segments: inter(sx, sy) },
  };
}

/* ---------------------------------------------------------------- */
/* Exposure                                                           */
/* ---------------------------------------------------------------- */

export interface ExposureBucket {
  key: string;
  count: number;
  capitalUsd: number;
  pctOfFund: number;
  pctOfViewCapital: number;
  overLimit: boolean;
}

export interface ExposureView {
  view: "COMMITTED" | "PIPELINE";
  description: string;
  deals: number;
  capitalUsd: number;
  pctOfFund: number;
  sector: ExposureBucket[];
  stage: ExposureBucket[];
  geography: ExposureBucket[];
}

function exposureView(view: ExposureView["view"], deals: PortfolioDeal[], fund: FundProfile, limit: number): ExposureView {
  const total = deals.reduce((a, d) => a + capitalFor(d), 0);
  const bucket = (keyOf: (d: PortfolioDeal) => string): ExposureBucket[] => {
    const m = new Map<string, { count: number; cap: number }>();
    for (const d of deals) {
      const k = keyOf(d);
      const e = m.get(k) ?? { count: 0, cap: 0 };
      e.count++;
      e.cap += capitalFor(d);
      m.set(k, e);
    }
    return [...m.entries()]
      .map(([key, e]) => {
        const share = total > 0 ? (e.cap / total) * 100 : 0;
        return { key, count: e.count, capitalUsd: e.cap, pctOfFund: (e.cap / fund.fundSizeUsd) * 100, pctOfViewCapital: share, overLimit: deals.length > 1 && share > limit };
      })
      .sort((a, b) => b.capitalUsd - a.capitalUsd || a.key.localeCompare(b.key));
  };
  return {
    view,
    description:
      view === "COMMITTED"
        ? "Deals with execution status SIGNED or FUNDED, each weighted by default check + reserves."
        : "Committed deals plus every admissible deal (not screened out/passed, mandate not failed), as if all were done.",
    deals: deals.length,
    capitalUsd: total,
    pctOfFund: (total / fund.fundSizeUsd) * 100,
    sector: bucket((d) => d.canonical.classification.industry[0] ?? "UNCLASSIFIED"),
    stage: bucket((d) => d.canonical.classification.financingStage),
    geography: bucket((d) => d.canonical.identity.hqCountry ?? "Unknown"),
  };
}

export interface CompanyConcentration {
  companyId: string;
  name: string;
  capitalUsd: number;
  pctOfFund: number;
  limitPct: number;
  ok: boolean;
}

/* ---------------------------------------------------------------- */
/* Correlated risks                                                   */
/* ---------------------------------------------------------------- */

export interface RiskDriver {
  key: string;
  kind: "INCUMBENT" | "PLATFORM" | "SEGMENT" | "REGULATORY";
  label: string;
}

export function riskDrivers(d: CanonicalDeal): RiskDriver[] {
  const out = new Map<string, RiskDriver>();
  const add = (x: RiskDriver) => out.set(x.key, x);
  for (const c of d.competition?.competitors ?? [])
    if (c.type === "INCUMBENT" && norm(c.name)) add({ key: `incumbent:${norm(c.name)}`, kind: "INCUMBENT", label: c.name });
  const corpus = [
    ...d.risks.map((r) => `${r.title} ${r.description} ${r.mitigation} ${r.evidence}`),
    ...(d.competition?.competitors ?? []).map((c) => `${c.name} ${c.description}`),
    ...(d.competition?.adversarialTests ?? []).map((t) => `${t.scenario} ${t.outcome}`),
    d.market?.valueCaptureAnalysis.commoditizationRisk ?? "",
    ...d.whatWorriesMe,
  ].join(" \n ");
  for (const p of PLATFORM_PATTERNS) if (p.re.test(corpus)) add({ key: `platform:${norm(p.label)}`, kind: "PLATFORM", label: p.label });
  for (const s of d.customers?.segments ?? []) if (norm(s)) add({ key: `segment:${norm(s)}`, kind: "SEGMENT", label: s });
  const reg = d.risks.filter((r) => r.category === "REGULATORY");
  if (reg.length) {
    const text = reg.map((r) => `${r.title} ${r.description}`).join(" ");
    const hits = REGULATORY_PATTERNS.filter((p) => p.re.test(text));
    if (hits.length) for (const h of hits) add({ key: `regulatory:${norm(h.label)}`, kind: "REGULATORY", label: h.label });
    else {
      const ind = d.classification.industry[0] ?? "OTHER";
      add({ key: `regulatory:${ind.toLowerCase()}`, kind: "REGULATORY", label: `${ind} regulation` });
    }
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface RiskCluster {
  driver: RiskDriver;
  companies: { companyId: string; name: string }[];
  sharedRiskCategories: RiskCategory[];
  capitalUsd: number;
  explanation: string;
}

/* ---------------------------------------------------------------- */
/* Asymmetric upside & allocation                                     */
/* ---------------------------------------------------------------- */

export interface AsymmetricUpside {
  companyId: string;
  name: string;
  qualifies: boolean;
  outlierMoic: number | null;
  outlierMoicSource: "CAP_TABLE" | "SIMPLIFIED" | "NONE";
  entryPostMoneyUsd: number | null;
  maxPostFor20xUsd: number | null;
  /** How far below the 20× price ceiling the entry price is (% of the ceiling). */
  priceHeadroomPct: number | null;
  powerLawIndex: number | null;
  evidenceCategory: EvidenceQuality;
  evidenceFactor: number;
  adjustedPowerLaw: number | null;
  checks: { outlierMoic: boolean; price: boolean; powerLaw: boolean };
  reason: string;
}

function outlierMoic(d: PortfolioDeal): { v: number | null; src: AsymmetricUpside["outlierMoicSource"] } {
  const ct = d.derived.economics?.capTableReturns;
  const c = ct?.modelable ? ct.scenarios.find((s) => s.scenario === "OUTLIER")?.grossMoic : undefined;
  if (c !== undefined && c !== null) return { v: c, src: "CAP_TABLE" };
  const s = d.derived.returns.scenarios.find((x) => x.scenario === "OUTLIER")?.grossMoic;
  if (s !== undefined && s !== null) return { v: s, src: "SIMPLIFIED" };
  return { v: null, src: "NONE" };
}

function maxPostFor(d: PortfolioDeal, scenario: "OUTLIER" | "BULL", target: number): number | null {
  const row = d.derived.priceSensitivity.find((r) => r.scenario === scenario);
  if (!row) return null;
  const hit = row.maxPostMoneyByTarget.find((m) => m.targetMoic === target);
  if (hit) return hit.maxPostMoneyUsd;
  const keep = 1 - row.cumulativeDilutionPct / 100;
  return (keep * row.exitEquityUsd) / target;
}

export function asymmetricUpside(d: PortfolioDeal): AsymmetricUpside {
  const o = outlierMoic(d);
  const post = d.derived.returns.inputs.entry.postMoneyUsd;
  const ceiling = maxPostFor(d, "OUTLIER", 20);
  const pl = d.derived.powerLaw.value;
  const cat = d.derived.evidence.category;
  const factor = EVIDENCE_FACTORS[cat];
  const adj = pl === null ? null : pl * factor;
  const checks = {
    outlierMoic: o.v !== null && o.v >= ASYMMETRY.minOutlierMoic,
    price: post !== null && ceiling !== null && post <= ceiling,
    powerLaw: adj !== null && adj >= ASYMMETRY.minAdjustedPowerLaw,
  };
  const qualifies = checks.outlierMoic && checks.price && checks.powerLaw;
  const parts = [
    `OUTLIER ${o.v !== null ? `${o.v.toFixed(1)}×` : "n/a"} (${checks.outlierMoic ? "≥" : "<"} ${ASYMMETRY.minOutlierMoic}×)`,
    `entry ${post ? usd(post) : "n/a"} vs 20× ceiling ${ceiling !== null ? usd(ceiling) : "n/a"}`,
    `Power-Law ${pl !== null ? pl.toFixed(0) : "n/a"} × ${factor} (${cat} evidence) = ${adj !== null ? adj.toFixed(0) : "n/a"} (${checks.powerLaw ? "≥" : "<"} ${ASYMMETRY.minAdjustedPowerLaw})`,
  ];
  return {
    companyId: d.companyId,
    name: d.name,
    qualifies,
    outlierMoic: o.v,
    outlierMoicSource: o.src,
    entryPostMoneyUsd: post,
    maxPostFor20xUsd: ceiling,
    priceHeadroomPct: post !== null && ceiling ? ((ceiling - post) / ceiling) * 100 : null,
    powerLawIndex: pl,
    evidenceCategory: cat,
    evidenceFactor: factor,
    adjustedPowerLaw: adj,
    checks,
    reason: parts.join("; "),
  };
}

export interface AllocationRow {
  rank: number;
  companyId: string;
  name: string;
  /** Bull-case proceeds per $1 invested at the current price. */
  bullProceedsPerDollar: number;
  source: "PRICE_SENSITIVITY" | "CAP_TABLE" | "SIMPLIFIED";
  evidenceCategory: EvidenceQuality;
  evidenceFactor: number;
  /** Marginal fund-return capacity per allocation unit (USD). */
  capacityPerUnitUsd: number;
  powerLawIndex: number | null;
  concentrationAfterPct: number;
  concentrationBreach: boolean;
  explanation: string;
}

function bullPerDollar(d: PortfolioDeal): { v: number; src: AllocationRow["source"] } | null {
  const row = d.derived.priceSensitivity.find((r) => r.scenario === "BULL");
  if (row?.currentImpliedMoic !== null && row?.currentImpliedMoic !== undefined) return { v: row.currentImpliedMoic, src: "PRICE_SENSITIVITY" };
  const ct = d.derived.economics?.capTableReturns;
  const c = ct?.modelable ? ct.scenarios.find((s) => s.scenario === "BULL")?.grossMoic : null;
  if (c !== null && c !== undefined) return { v: c, src: "CAP_TABLE" };
  const s = d.derived.returns.scenarios.find((x) => x.scenario === "BULL")?.grossMoic;
  if (s !== null && s !== undefined) return { v: s, src: "SIMPLIFIED" };
  return null;
}

/* ---------------------------------------------------------------- */
/* Report                                                             */
/* ---------------------------------------------------------------- */

export interface PortfolioReport {
  deals: number;
  redundancy: RedundancyPair[];
  exposure: { committed: ExposureView; pipeline: ExposureView; companyConcentration: CompanyConcentration[]; bucketLimitPct: number; maxConcentrationPct: number };
  correlatedRisks: RiskCluster[];
  asymmetricUpside: AsymmetricUpside[];
  allocation: {
    unitUsd: number;
    formula: string;
    evidenceFactors: Record<EvidenceQuality, number>;
    ranking: AllocationRow[];
    excluded: { companyId: string; name: string; reason: string }[];
  };
  rules: string[];
}

export function portfolioIntelligence(deals: PortfolioDeal[], fund: FundProfile, opts: PortfolioOptions = {}): PortfolioReport {
  const limit = opts.bucketLimitPct ?? DEFAULT_BUCKET_LIMIT_PCT;
  const unit = opts.allocationUnitUsd ?? 1_000_000;
  const sorted = [...deals].sort((a, b) => a.companyId.localeCompare(b.companyId));

  // Redundancy.
  const redundancy: RedundancyPair[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      const x = sorted[i]!;
      const y = sorted[j]!;
      const r = redundancyScore(x.canonical, y.canonical);
      if (r.score < REDUNDANCY_THRESHOLDS.OVERLAPPING) continue;
      const level = r.score >= REDUNDANCY_THRESHOLDS.REDUNDANT ? "REDUNDANT" : "OVERLAPPING";
      const bits = [
        r.shared.classification.length ? `classification ${r.shared.classification.join(", ")}` : null,
        r.shared.competitors.length ? `competitors ${r.shared.competitors.join(", ")}` : null,
        r.shared.segments.length ? `segments ${r.shared.segments.join(", ")}` : null,
      ].filter(Boolean);
      redundancy.push({
        a: { companyId: x.companyId, name: x.name },
        b: { companyId: y.companyId, name: y.name },
        ...r,
        level,
        reason: `${x.name} and ${y.name} score ${r.score.toFixed(2)} (${level}); shared ${bits.join("; ") || "nothing specific"}.`,
      });
    }
  redundancy.sort((p, q) => q.score - p.score || p.a.companyId.localeCompare(q.a.companyId) || p.b.companyId.localeCompare(q.b.companyId));

  // Exposure.
  const committed = sorted.filter(isCommitted);
  const pipeline = sorted.filter((d) => isCommitted(d) || isAdmissible(d));
  const companyConcentration: CompanyConcentration[] = pipeline.map((d) => {
    const cap = capitalFor(d);
    const p = (cap / fund.fundSizeUsd) * 100;
    return { companyId: d.companyId, name: d.name, capitalUsd: cap, pctOfFund: p, limitPct: fund.maxConcentrationPct, ok: p <= fund.maxConcentrationPct + 1e-9 };
  });

  // Correlated risks.
  const byDriver = new Map<string, { driver: RiskDriver; deals: PortfolioDeal[] }>();
  for (const d of sorted)
    for (const drv of riskDrivers(d.canonical)) {
      const e = byDriver.get(drv.key) ?? { driver: drv, deals: [] };
      e.deals.push(d);
      byDriver.set(drv.key, e);
    }
  const correlatedRisks: RiskCluster[] = [...byDriver.values()]
    .filter((e) => e.deals.length >= 2)
    .map((e) => {
      const cats = e.deals.map((d) => new Set(d.canonical.risks.map((r) => r.category)));
      const shared = [...(cats[0] ?? new Set<RiskCategory>())].filter((c) => cats.every((s) => s.has(c))).sort();
      const capital = e.deals.filter((d) => isCommitted(d) || isAdmissible(d)).reduce((a, d) => a + capitalFor(d), 0);
      return {
        driver: e.driver,
        companies: e.deals.map((d) => ({ companyId: d.companyId, name: d.name })),
        sharedRiskCategories: shared,
        capitalUsd: capital,
        explanation: `${e.driver.kind.toLowerCase()} driver "${e.driver.label}" is shared by ${e.deals.map((d) => d.name).join(", ")}${shared.length ? `; common risk categories: ${shared.join(", ")}` : ""}. One adverse move hits all of them together.`,
      };
    })
    .sort((a, b) => b.companies.length - a.companies.length || b.capitalUsd - a.capitalUsd || a.driver.key.localeCompare(b.driver.key));

  // Asymmetric upside.
  const asym = sorted.map(asymmetricUpside).sort((a, b) => Number(b.qualifies) - Number(a.qualifies) || (b.adjustedPowerLaw ?? -1) - (a.adjustedPowerLaw ?? -1) || a.companyId.localeCompare(b.companyId));

  // Allocation.
  const excluded: { companyId: string; name: string; reason: string }[] = [];
  const candidates: AllocationRow[] = [];
  for (const d of sorted) {
    if (EXCLUDED_STATUSES.includes(d.derived.recommendation.status)) {
      excluded.push({ companyId: d.companyId, name: d.name, reason: `Recommendation ${d.derived.recommendation.status}` });
      continue;
    }
    if (d.derived.fundFit.mandate === "FAIL") {
      excluded.push({ companyId: d.companyId, name: d.name, reason: "Fails a fund mandate gate" });
      continue;
    }
    if (d.canonical.icDecision === "REJECTED") {
      excluded.push({ companyId: d.companyId, name: d.name, reason: "Rejected by IC" });
      continue;
    }
    if (d.derived.financing.risk === "CRITICAL" && !opts.allowCriticalFinancing) {
      excluded.push({ companyId: d.companyId, name: d.name, reason: "Financing risk CRITICAL (cash runs out before the next raise)" });
      continue;
    }
    const b = bullPerDollar(d);
    if (!b) {
      excluded.push({ companyId: d.companyId, name: d.name, reason: "Returns not modelable (entry valuation unknown)" });
      continue;
    }
    const cat = d.derived.evidence.category;
    const factor = EVIDENCE_FACTORS[cat];
    const capacity = b.v * unit * factor;
    const base = isCommitted(d) ? capitalFor(d) : 0;
    const after = ((base + unit) / fund.fundSizeUsd) * 100;
    candidates.push({
      rank: 0,
      companyId: d.companyId,
      name: d.name,
      bullProceedsPerDollar: b.v,
      source: b.src,
      evidenceCategory: cat,
      evidenceFactor: factor,
      capacityPerUnitUsd: capacity,
      powerLawIndex: d.derived.powerLaw.value,
      concentrationAfterPct: after,
      concentrationBreach: after > fund.maxConcentrationPct + 1e-9,
      explanation: `${b.v.toFixed(2)} bull proceeds per $ × ${usd(unit)} × ${factor} (${cat} evidence) = ${usd(capacity)}`,
    });
  }
  candidates.sort(
    (a, b) => b.capacityPerUnitUsd - a.capacityPerUnitUsd || (b.powerLawIndex ?? -1) - (a.powerLawIndex ?? -1) || a.companyId.localeCompare(b.companyId),
  );
  candidates.forEach((c, i) => (c.rank = i + 1));

  return {
    deals: sorted.length,
    redundancy,
    exposure: {
      committed: exposureView("COMMITTED", committed, fund, limit),
      pipeline: exposureView("PIPELINE", pipeline, fund, limit),
      companyConcentration,
      bucketLimitPct: limit,
      maxConcentrationPct: fund.maxConcentrationPct,
    },
    correlatedRisks,
    asymmetricUpside: asym,
    allocation: {
      unitUsd: unit,
      formula: `Marginal fund-return capacity per ${usd(unit)} = BULL-case proceeds per $ at the current price (initial check, as-converted, registry dilution) × ${usd(unit)} × evidence factor (VERY_HIGH ${EVIDENCE_FACTORS.VERY_HIGH}, HIGH ${EVIDENCE_FACTORS.HIGH}, MODERATE ${EVIDENCE_FACTORS.MODERATE}, LOW ${EVIDENCE_FACTORS.LOW}); ties broken by Power-Law index. Excludes screened-out/passed deals, mandate failures, IC rejections${opts.allowCriticalFinancing ? "" : " and CRITICAL financing risk"}. A conventional ranking, not a probability.`,
      evidenceFactors: EVIDENCE_FACTORS,
      ranking: candidates,
      excluded,
    },
    rules: [
      `Redundancy = ${REDUNDANCY_WEIGHTS.classification}·J(industry, product type, GTM) + ${REDUNDANCY_WEIGHTS.competitors}·J(competitor names) + ${REDUNDANCY_WEIGHTS.segments}·J(customer segments), renormalized over components with data; OVERLAPPING ≥ ${REDUNDANCY_THRESHOLDS.OVERLAPPING}, REDUNDANT ≥ ${REDUNDANCY_THRESHOLDS.REDUNDANT}.`,
      `Exposure buckets use the first-listed industry, the financing stage and the HQ country; flagged above ${limit}% of a view's capital (INTERNAL_POLICY). Company concentration is checked against the fund's ${fund.maxConcentrationPct}% limit.`,
      "Correlated risks cluster deals that share an incumbent competitor, a platform dependency, a customer segment or a regulatory regime.",
      `Asymmetric upside: OUTLIER MOIC ≥ ${ASYMMETRY.minOutlierMoic}×, entry price ≤ the OUTLIER 20× price ceiling, and Power-Law index × evidence factor ≥ ${ASYMMETRY.minAdjustedPowerLaw}.`,
    ],
  };
}

/** Deterministic text summary of the portfolio for the Fund Brain. */
export function portfolioBrief(report: PortfolioReport, fund: FundProfile): string {
  const s: string[] = [];
  const c = report.exposure.committed;
  const p = report.exposure.pipeline;
  s.push(
    `${report.deals} deal${report.deals === 1 ? "" : "s"} analyzed. ${c.deals} committed (${usd(c.capitalUsd)} with reserves, ${pct(c.pctOfFund)} of the ${usd(fund.fundSizeUsd)} fund); ${p.deals} in the admissible pipeline (${pct(p.pctOfFund)} of the fund if all were done).`,
  );
  const top = (v: ExposureView, dim: "sector" | "stage" | "geography") => v[dim][0];
  for (const v of [c, p]) {
    if (!v.deals) continue;
    const t = top(v, "sector")!;
    s.push(`Largest ${v.view.toLowerCase()} sector exposure: ${t.key} at ${pct(t.pctOfViewCapital)} of ${v.view.toLowerCase()} capital${t.overLimit ? ` — above the ${report.exposure.bucketLimitPct}% policy limit` : ""}.`);
  }
  const breaches = report.exposure.companyConcentration.filter((x) => !x.ok);
  if (breaches.length) s.push(`Concentration: ${breaches.map((b) => `${b.name} ${pct(b.pctOfFund)}`).join(", ")} exceed the ${fund.maxConcentrationPct}% per-company limit.`);
  const red = report.redundancy.filter((r) => r.level === "REDUNDANT");
  if (red.length) s.push(`Redundant pairs: ${red.map((r) => `${r.a.name}–${r.b.name} (${r.score.toFixed(2)})`).join(", ")}.`);
  else if (report.redundancy.length) s.push(`Overlapping pairs: ${report.redundancy.map((r) => `${r.a.name}–${r.b.name} (${r.score.toFixed(2)})`).join(", ")}.`);
  else s.push("No redundant or overlapping deals.");
  for (const cl of report.correlatedRisks.slice(0, 3)) s.push(`Correlated: ${cl.explanation}`);
  const asym = report.asymmetricUpside.filter((a) => a.qualifies);
  s.push(asym.length ? `Asymmetric upside: ${asym.map((a) => `${a.name} (${a.reason})`).join("; ")}.` : "No deal passes the asymmetric-upside screen.");
  const r = report.allocation.ranking.slice(0, 3);
  s.push(
    r.length
      ? `Next ${usd(report.allocation.unitUsd)}: ${r.map((x) => `${x.rank}. ${x.name} (${usd(x.capacityPerUnitUsd)} capacity${x.concentrationBreach ? ", breaches concentration" : ""})`).join(", ")}.`
      : "No deal is eligible for the next allocation.",
  );
  if (report.allocation.excluded.length) s.push(`Excluded from allocation: ${report.allocation.excluded.map((e) => `${e.name} (${e.reason})`).join("; ")}.`);
  return s.join(" ");
}
