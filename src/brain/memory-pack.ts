/**
 * Deal Memory Pack — a compact, pre-computed, deterministic summary of
 * everything the fund knows about a company. Built at ingestion, it is the
 * Fund Brain's first stop for any company question (no deck re-reading).
 */
import { dedupeSecurityFlags } from "@/engine/security-flags";
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { estimateTokens } from "@/ai/pricing";

export const fmtUsd = (n: number | null | undefined) =>
  n === null || n === undefined ? "n/a" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;

export function fmtMetric(unit: string, v: number | null): string {
  if (v === null) return "n/a";
  switch (unit) {
    case "USD":
      return fmtUsd(v);
    case "PERCENT":
      return `${v.toFixed(v < 10 ? 1 : 0)}%`;
    case "MONTHS":
      return `${v.toFixed(1)} mo`;
    case "DAYS":
      return `${v.toFixed(0)} d`;
    case "MULTIPLE":
    case "RATIO":
      return `${v.toFixed(2)}x`;
    default:
      return v.toLocaleString("en-US");
  }
}

const STATE_LABEL: Record<string, string> = {
  OBSERVED: "company-reported",
  INFERRED: "inferred",
  STALE: "stale",
  WITHHELD: "withheld",
  CONTRADICTED: "contradicted",
  UNKNOWN: "unknown",
};

export interface MemoryPack {
  companyId: string;
  slug: string;
  name: string;
  versionId: string;
  updatedAt: string;
  text: string;
}

export function buildMemoryPack(
  company: { id: string; slug: string },
  versionId: string,
  c: CanonicalDeal,
  d: DerivedAnalysis,
  /** deckChanges: "what changed since the last deck" lines (server/deck-versions.ts#deckChangeLines), code-computed. */
  extras: { deckChanges?: string[] } = {},
): { pack: MemoryPack; tokens: number } {
  const L: string[] = [];
  const base = d.returns.scenarios.find((s) => s.scenario === "BASE");
  L.push(`# ${c.identity.name} (/deals/${company.slug})`);
  L.push(`${c.identity.oneLiner}`);
  L.push(
    `HQ ${c.identity.hqCountry ?? "unknown"} · founded ${c.identity.foundedYear ?? "?"} · ${c.classification.financingStage} (declared: ${c.classification.declaredStage ?? "n/a"}) · maturity ${d.maturity?.effective ?? c.classification.operationalMaturity}${d.maturity && d.maturity.effective !== c.classification.operationalMaturity ? ` (anchored on measured revenue; model classified ${c.classification.operationalMaturity})` : ""} · peer group ${d.peerGroup.name}`,
  );
  L.push(`Industry ${c.classification.industry.join(", ")} · product ${c.classification.productType.join(", ")} · tech ${c.classification.technology.join(", ")} · revenue ${c.classification.revenueModel.join(", ")} · GTM ${c.classification.gtm.join(", ")}`);
  L.push(
    `STATUS: recommendation ${d.recommendation.status}${d.recommendation.exceptionalOverride ? " (exceptional override)" : ""} · IC ${c.icDecision} · execution ${c.executionStatus} · analysis ${c.analysis.mode} ${c.analysis.depth}`,
  );
  if (d.recommendation.rationale) L.push(`Rationale: ${d.recommendation.rationale}`);
  L.push(
    `INDICES (conventional, not probabilities): Operating Quality ${d.operatingQuality.value ?? "n/a"} [${d.operatingQuality.lower}–${d.operatingQuality.upper}], coverage ${(d.operatingQuality.coverage * 100).toFixed(0)}% ${d.operatingQuality.status} · Evidence ${d.evidence.category} (${d.evidence.index}) · Power-Law ${d.powerLaw.value ?? "n/a"} · Fund Fit ${d.fundFit.index ?? "n/a"} (mandate ${d.fundFit.mandate}) · Risk ${d.risk.headline ?? "n/a"}`,
  );
  L.push(`Dimensions: ${d.dimensions.map((x) => `${x.name} ${x.value ?? "n/s"} (${Math.round(x.coverage * 100)}%)`).join(" · ")}`);

  L.push(`## Metrics (primary)`);
  for (const m of c.metrics.filter((x) => x.isPrimary && x.normalizedValue !== null)) {
    const def = metricDef(m.metricKey);
    const ver = m.verification === "VERIFIED" ? "verified" : m.calculationMethod === "DERIVED" ? "derived" : STATE_LABEL[m.state] ?? m.state;
    L.push(`- ${def?.shortName ?? m.metricKey}: ${fmtMetric(m.unit, m.normalizedValue)} (${ver}${m.periodEnd ? `, as of ${m.periodEnd}` : ""}${m.sampleSize ? `, n=${m.sampleSize}` : ""}) [${m.id}]${m.qualityFlags.length ? ` flags: ${m.qualityFlags.slice(0, 2).join("; ")}` : ""}`);
  }
  const withheld = c.metrics.filter((x) => x.isPrimary && (x.state === "WITHHELD" || x.state === "UNKNOWN")).map((x) => metricDef(x.metricKey)?.shortName ?? x.metricKey);
  if (withheld.length) L.push(`Not disclosed / unknown: ${withheld.join(", ")}`);

  if (c.financing) {
    L.push(
      `## Round: ${c.financing.instrument} · raise ${c.financing.raiseAmount?.rawText ?? "n/a"} · pre ${c.financing.preMoney?.rawText ?? "n/a"} · post ${c.financing.postMoney?.rawText ?? "n/a"} · cap ${c.financing.valuationCap?.rawText ?? "n/a"} · lead ${c.financing.leadInvestor ?? "n/a"} · investors ${c.financing.existingInvestors.join(", ") || "n/a"}`,
    );
  }
  if (extras.deckChanges?.length) {
    L.push(`## Since the last deck (computed from the stored analyses of both decks)`);
    for (const x of extras.deckChanges) L.push(`- ${x}`);
  }
  const notApplied = (c.overrides ?? []).filter((o) => o.carry?.status === "UNANCHORED");
  if (notApplied.length) L.push(`Analyst overrides NOT re-applied after re-analysis (kept for review, not used): ${notApplied.map((o) => `${o.id} ${o.carry!.note.replace(/^not re-applied: /, "")}`).join(" | ")}`);
  if (d.returns.modelable) {
    L.push(
      `Returns (gross, check ${fmtUsd(d.returns.inputs.checkUsd)}): ${d.returns.scenarios.map((s) => `${s.scenario} ${s.grossMoic?.toFixed(1) ?? "n/a"}x`).join(" · ")}; base exit ownership ${base?.exitOwnershipPct.toFixed(2)}%`,
    );
  }
  if (d.backwards) L.push(`Backwards: ${d.backwards.explanation} Plausibility ${d.backwards.plausibility}.`);
  if (d.market.primary) L.push(`Market (reconstructed ${d.market.primary.method}): ${fmtUsd(d.market.primary.lowUsd)}–${fmtUsd(d.market.primary.highUsd)}; deck TAM ${fmtUsd(d.market.deckTamUsd)}`);
  L.push(`Financing path: ${d.financing.explanation} Risk ${d.financing.risk}.`);
  // Divergence factors: why this company could diverge from lookalikes (ordinal levels, not a score). Absent on older versions.
  if (d.divergence) {
    const dv = d.divergence.summary;
    L.push(`## Divergence factors (ordinal, not a score): ${dv.headline}`);
    const read = dv.factors.filter((f) => f.level !== "INSUFFICIENT_EVIDENCE");
    if (read.length) L.push(read.map((f) => `${f.name} ${f.level}: ${f.why}`).join(" | "));
    if (dv.unread.length) L.push(`Divergence factors not readable yet: ${dv.unread.join(", ")}`);
  }

  // Decision focus: the few items that decide the case, ranked by code (attention, not a probability). Absent on older versions.
  if (d.focus?.determinants.length) {
    L.push(`## What decides this investment (code-ranked): ${d.focus.determinants.map((x) => `${x.label} [${x.status.toLowerCase().replace("_", " ")}]`).join(" | ")}`);
    if (d.focus.outlierCandidates.length) L.push(`Outlier candidates: ${d.focus.outlierCandidates.map((o) => `${o.label} (${o.basis})`).join(" | ")}`);
    else L.push("Outlier candidates: none evidenced.");
    if (d.focus.reversingQuestion) L.push(`Question that could reverse the decision: ${d.focus.reversingQuestion.question}`);
  }

  if (c.founders.length || c.foundersFromDeck.length) {
    L.push(`## Founders`);
    for (const f of c.founders.length ? c.founders : c.foundersFromDeck.map((x) => ({ name: x.name, role: x.role, summary: x.backgroundFromDeck, founderMarketFit: "" }))) {
      L.push(`- ${f.name}, ${f.role}: ${f.summary}${f.founderMarketFit ? ` — FMF: ${f.founderMarketFit}` : ""}`);
    }
  }
  if (c.product) L.push(`## Product: ${c.product.whatItIs}. ${c.product.plainExplanation} User: ${c.product.user}. Buyer: ${c.product.buyer}.`);
  if (c.competition?.competitors.length) L.push(`Competitors: ${c.competition.competitors.map((x) => `${x.name} (${x.type.toLowerCase()})`).join(", ")}`);
  if (c.exceptionalStrengths.length) L.push(`## Exceptional strength: ${c.exceptionalStrengths.map((x) => `${x.claim} [${x.rating}]`).join(" | ")}`);
  if (c.thesis) {
    L.push(`## Bet: ${c.thesis.bet}`);
    L.push(`Thesis: ${c.thesis.thesisPoints.join(" | ")}`);
    L.push(`Could break: ${c.thesis.whatCouldBreak.join(" | ")}`);
    L.push(`Fatal weakness: ${c.thesis.fatalWeakness}. Fatal question: ${c.thesis.fatalQuestion}`);
  }
  if (c.whatILike.length) L.push(`Like: ${c.whatILike.join(" | ")}`);
  if (c.whatWorriesMe.length) L.push(`Worries: ${c.whatWorriesMe.join(" | ")}`);
  const killers = c.risks.filter((r) => r.weaknessClass === "THESIS_KILLING" || r.severity === "CRITICAL" || r.severity === "HIGH");
  if (killers.length) L.push(`Key risks: ${killers.slice(0, 6).map((r) => `${r.title} (${r.severity}/${r.likelihood}, ${r.weaknessClass.toLowerCase()})`).join(" | ")}`);
  const contradicted = c.claims.filter((x) => x.verification === "CONTRADICTED");
  if (contradicted.length) L.push(`Contradicted claims: ${contradicted.map((x) => `${x.id} ${x.statement}`).join(" | ")}`);
  const verified = c.claims.filter((x) => x.material && x.verification === "VERIFIED");
  if (verified.length) L.push(`Verified material claims: ${verified.slice(0, 8).map((x) => `${x.id} ${x.statement}`).join(" | ")}`);
  const openQ = c.questions.filter((q) => q.status !== "RESOLVED");
  if (openQ.length) L.push(`Open questions: ${openQ.map((q) => `${q.id} [${q.tier}] ${q.question}`).join(" | ")}`);
  const answered = c.questions.filter((q) => q.answer);
  if (answered.length) L.push(`Answers from founder calls: ${answered.map((q) => `${q.id}: ${q.answer}`).join(" | ")}`);
  if (c.nextBestAction) L.push(`Next best action: ${c.nextBestAction.action}`);
  if (c.redTeam) L.push(`Case against passing: ${c.redTeam.caseAgainstPassing.slice(0, 2).join(" | ")}`);
  if (c.analysis.securityFlags.length) L.push(`Security: ${dedupeSecurityFlags(c.analysis.securityFlags).length} instruction-like passage(s) detected in materials (ignored).`);
  L.push(`Evidence label key: company claims are ${evidenceLabel({ verification: "UNVERIFIED", origin: "COMPANY" }).toLowerCase().replace("_", "-")} unless verified.`);

  const text = L.join("\n");
  return {
    pack: { companyId: company.id, slug: company.slug, name: c.identity.name, versionId, updatedAt: new Date().toISOString(), text },
    tokens: estimateTokens(text),
  };
}
