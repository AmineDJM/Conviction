/**
 * DECK INTEGRITY ENGINE (deterministic). "AI extracts, code judges."
 *
 * Aggregates the integrity modules of this folder into one report stored on
 * every analysis version:
 *   1. metric integrity rules            (metric-rules.ts)
 *   2. implied metrics                    (implied.ts)
 *   3. cross-slide numeric consistency    (cross-slide.ts)
 *   4. expected evidence by stage         (expected-evidence.ts, EXPECTED_EVIDENCE_VERSION)
 *   5. evidence debt / 6. verification priority (evidence-debt.ts)
 *   7. confidence by field                (confidence.ts)
 *   8. information density                (density.ts — communication signal only)
 *   9. chronology                         (chronology.ts)
 *  10. contradiction severity             (contradictions.ts)
 *  11. source reliability                 (sources.ts)
 *
 * Pure and deterministic: no wall clock (the reference date comes from the
 * deal), no randomness, stable ordering and ids. Never throws: a module that
 * fails on malformed partial input is recorded in `diagnostics` and replaced
 * by its empty result.
 */
import { dedupeSecurityFlags } from "@/engine/security-flags";
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "../benchmarks/types";
import type { PeerGroupRef } from "../scoring/peer";
import { buildContext, type IntegrityContext } from "./context";
import { metricRules } from "./metric-rules";
import { impliedMetrics } from "./implied";
import { crossSlide } from "./cross-slide";
import { EXPECTED_EVIDENCE_VERSION, expectedEvidence } from "./expected-evidence";
import { evidenceDebt, EVIDENCE_AREAS, EVIDENCE_DEBT_RULE, verificationPriority, VERIFICATION_PRIORITY_LABEL } from "./evidence-debt";
import { confidenceByField } from "./confidence";
import { DENSITY_LABEL, informationDensity } from "./density";
import { chronology } from "./chronology";
import { contradictions } from "./contradictions";
import { sourceReliability } from "./sources";
import type {
  ChronologyTable,
  ConfidenceResult,
  CrossSlideInconsistency,
  EvidenceDebtResult,
  ExpectedEvidenceResult,
  ImpliedMetric,
  InformationDensity,
  IntegrityFinding,
  IntegrityModule,
  IntegrityReport,
  IntegritySummary,
  RankedContradiction,
  SourceReliability,
  VerificationPriorityResult,
} from "./types";
import { arr, finding, pageOf, sevRank, str } from "./util";

export type * from "./types";
export { EXPECTED_EVIDENCE_VERSION } from "./expected-evidence";
export { VERIFICATION_PRIORITY_LABEL } from "./evidence-debt";
export { DENSITY_LABEL } from "./density";

/** Bump on any behavioural change of the integrity engine. Stored in every report. */
export const INTEGRITY_ENGINE_VERSION = "1.0";

const MODULE_PRIORITY: Record<IntegrityModule, number> = {
  CONTRADICTIONS: 0,
  IMPLIED_METRICS: 1,
  CROSS_SLIDE: 2,
  METRIC_RULES: 3,
  SECURITY: 4,
  SOURCES: 5,
  CHRONOLOGY: 6,
  MODEL_FORENSICS: 7,
  EXPECTED_EVIDENCE: 8,
};

export function sortFindings(fs: IntegrityFinding[]): IntegrityFinding[] {
  return [...fs].sort(
    (a, b) =>
      sevRank(b.severity) - sevRank(a.severity) ||
      Number(a.origin === "MODEL") - Number(b.origin === "MODEL") ||
      MODULE_PRIORITY[a.module] - MODULE_PRIORITY[b.module] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function securityFindings(ctx: IntegrityContext): IntegrityFinding[] {
  const flags = dedupeSecurityFlags(arr(ctx.deal.analysis?.securityFlags).filter((f) => f && typeof f.excerpt === "string" && typeof f.location === "string"));
  const suspected = arr(ctx.deal.forensics?.suspectedInstructions);
  if (!flags.length && !suspected.length) return [];
  const pages = [...flags.map((f) => pageOf(f?.location)), ...suspected.map((s) => s?.page ?? null)];
  return [
    finding({
      kind: "INSTRUCTION_TEXT_IN_MATERIALS",
      module: "SECURITY",
      severity: "HIGH",
      title: "The materials contain text addressed to an AI system",
      detail: `${flags.length + suspected.length} passage(s) look like instructions to an AI evaluator (e.g. to ignore instructions or rate the company highly). They were treated as data and have no effect on any computed result; their presence is itself a diligence fact.`,
      pages,
    }),
  ];
}

function modelForensicsFindings(ctx: IntegrityContext): IntegrityFinding[] {
  const fz = ctx.deal.forensics;
  if (!fz) return [];
  const cap = (s: string) => (s === "CRITICAL" ? "HIGH" : s === "HIGH" || s === "MODERATE" || s === "LOW" ? s : "LOW") as IntegrityFinding["severity"];
  const out: IntegrityFinding[] = [];
  for (const c of arr(fz.chartForensics)) {
    if (!c) continue;
    out.push(finding({ kind: `CHART_${c.issue}`, module: "MODEL_FORENSICS", origin: "MODEL", severity: cap(c.severity), title: `Chart issue (model): ${str(c.issue).toLowerCase().replace(/_/g, " ")}`, detail: str(c.detail), pages: [c.page], key: str(c.detail) }));
  }
  for (const n of arr(fz.narrativeInconsistencies)) {
    if (!n) continue;
    out.push(finding({ kind: "NARRATIVE_INCONSISTENCY", module: "MODEL_FORENSICS", origin: "MODEL", severity: cap(n.severity), title: `Presented as ${str(n.presentedAs)}; evidence suggests ${str(n.evidenceSuggests)} (model)`, detail: str(n.detail), key: `${str(n.presentedAs)}|${str(n.evidenceSuggests)}` }));
  }
  return out;
}

function emptyExpected(ctx: IntegrityContext): ExpectedEvidenceResult {
  return { version: EXPECTED_EVIDENCE_VERSION, profile: ctx.profile, stageBand: ctx.stageBand, items: [], missingExpected: [], withheldExpected: [], missingNiceToHave: [], perfectSlides: [] };
}
const EMPTY_DEBT: EvidenceDebtResult = {
  rule: EVIDENCE_DEBT_RULE,
  overall: null,
  overallCompanyOnlyWeightedShare: null,
  areas: EVIDENCE_AREAS.map((area) => ({ area, items: 0, verified: 0, independentlySupported: 0, companyOnly: 0, contradicted: 0, companyOnlyWeightedShare: null, level: null, rule: EVIDENCE_DEBT_RULE })),
  topDebt: [],
};
const EMPTY_DENSITY: InformationDensity = {
  label: DENSITY_LABEL,
  pages: null,
  materialClaims: 0,
  materialClaimsPerPage: null,
  quantitativeObservations: 0,
  quantitativeObservationsPerPage: null,
  unsupportedClaimRatio: null,
  redundantClaimPairs: [],
  redundancyRatio: null,
  pagesWithoutDecisionFacts: [],
  shareOfPagesWithoutDecisionFacts: null,
};

function summarize(findings: IntegrityFinding[], debt: EvidenceDebtResult, expected: ExpectedEvidenceResult, contra: RankedContradiction[], implied: ImpliedMetric[]): IntegritySummary {
  const count = (s: IntegrityFinding["severity"]) => findings.filter((f) => f.severity === s).length;
  const critical = count("CRITICAL");
  const high = count("HIGH");
  const moderate = count("MODERATE");
  const low = count("LOW");
  const missingExpectedCount = expected.missingExpected.length + expected.withheldExpected.length;
  const parts: string[] = [];
  if (critical || high) parts.push([critical ? `${critical} critical` : null, high ? `${high} high` : null].filter(Boolean).join(" and ") + ` integrity finding${critical + high === 1 ? "" : "s"}`);
  else if (moderate || low) parts.push(`no critical or high integrity findings (${moderate} moderate, ${low} low)`);
  else parts.push("no integrity findings");
  if (debt.overall) parts.push(`evidence debt ${debt.overall.toLowerCase().replace("_", " ")}`);
  if (missingExpectedCount) parts.push(`${missingExpectedCount} expected evidence item${missingExpectedCount === 1 ? "" : "s"} missing`);
  return {
    critical,
    high,
    moderate,
    low,
    top: findings.slice(0, 5).map((f) => ({ id: f.id, kind: f.kind, severity: f.severity, title: f.title })),
    evidenceDebtOverall: debt.overall,
    missingExpectedCount,
    contradictionCount: contra.length,
    inconsistentImpliedCount: implied.filter((r) => r.verdict === "INCONSISTENT").length,
    headline: `${parts.join("; ")}.`.replace(/^./, (c) => c.toUpperCase()),
  };
}

export function integrityReport(deal: CanonicalDeal, registry: BenchmarkRegistry, peer: PeerGroupRef): IntegrityReport {
  const diagnostics: string[] = [];
  const safe = <T>(name: string, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (e) {
      diagnostics.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      return fallback;
    }
  };
  const ctx = buildContext(deal ?? ({} as CanonicalDeal), registry, peer);

  const rules = safe("metricRules", () => metricRules(ctx), [] as IntegrityFinding[]);
  const implied = safe("impliedMetrics", () => impliedMetrics(ctx), { rows: [] as ImpliedMetric[], findings: [] as IntegrityFinding[] });
  const cross = safe("crossSlide", () => crossSlide(ctx), { items: [] as CrossSlideInconsistency[], findings: [] as IntegrityFinding[] });
  const expected = safe("expectedEvidence", () => expectedEvidence(ctx), { result: emptyExpected(ctx), findings: [] as IntegrityFinding[] });
  const debt = safe("evidenceDebt", () => evidenceDebt(ctx), EMPTY_DEBT);
  const priority = safe("verificationPriority", () => verificationPriority(ctx), { label: VERIFICATION_PRIORITY_LABEL, formula: "", items: [] } as VerificationPriorityResult);
  const confidence = safe("confidence", () => confidenceByField(ctx, implied.rows, cross.items), { metrics: [], fields: [] } as ConfidenceResult);
  const density = safe("density", () => informationDensity(ctx), EMPTY_DENSITY);
  const chrono = safe("chronology", () => chronology(ctx), { table: { current: [], contracted: [], forward: [], hockeySticks: [] } as ChronologyTable, findings: [] as IntegrityFinding[] });
  const contra = safe("contradictions", () => contradictions(ctx, implied.rows, cross.items), { list: [] as RankedContradiction[], findings: [] as IntegrityFinding[] });
  const sources = safe("sources", () => sourceReliability(ctx), { sources: [] as SourceReliability[], findings: [] as IntegrityFinding[] });
  const security = safe("security", () => securityFindings(ctx), [] as IntegrityFinding[]);
  const model = safe("modelForensics", () => modelForensicsFindings(ctx), [] as IntegrityFinding[]);

  // A reported metric that disagrees with its inputs is reported once: by the implied-metric table when it covers it.
  const impliedMetricIds = new Set(implied.findings.flatMap((f) => f.metricIds));
  const ruleFindings = rules.filter((f) => !(f.kind === "DERIVED_VS_REPORTED" && f.metricIds.some((id) => impliedMetricIds.has(id))));

  const all = [...ruleFindings, ...implied.findings, ...cross.findings, ...expected.findings, ...chrono.findings, ...contra.findings, ...sources.findings, ...security, ...model];
  const byId = new Map<string, IntegrityFinding>();
  for (const f of all) {
    const prev = byId.get(f.id);
    if (!prev || sevRank(f.severity) > sevRank(prev.severity)) byId.set(f.id, f);
  }
  const findings = sortFindings([...byId.values()]);

  return {
    version: INTEGRITY_ENGINE_VERSION,
    expectedEvidenceVersion: EXPECTED_EVIDENCE_VERSION,
    asOf: ctx.asOf ? ctx.asOf.toISOString() : null,
    peerGroup: { profile: ctx.profile, stageBand: ctx.stageBand },
    findings,
    impliedMetrics: implied.rows,
    crossSlide: cross.items,
    expectedEvidence: expected.result,
    evidenceDebt: debt,
    verificationPriority: priority,
    confidence,
    density,
    chronology: chrono.table,
    contradictions: contra.list,
    sourceReliability: sources.sources,
    summary: summarize(findings, debt, expected.result, contra.list, implied.rows),
    diagnostics,
  };
}
