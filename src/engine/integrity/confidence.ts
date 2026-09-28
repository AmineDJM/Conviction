/**
 * 7. CONFIDENCE BY FIELD.
 *
 * Score per primary metric: base by verification (VERIFIED 3 · PARTIALLY 2.5 ·
 * UNVERIFIED 2), minus penalties for state, basis and quality flags, and for
 * implied-metric / cross-slide conflicts involving the metric.
 *   ≥ 2.75 HIGH · ≥ 1.75 MEDIUM · otherwise LOW · no usable value → NONE.
 * The same scale is applied to round terms, market size (by reconstruction
 * method) and founders (research-backed vs deck-only — never by pedigree).
 */
import type { MetricInstance } from "@/domain/canonical";
import { metricDef } from "../metrics/dictionary";
import { isAnalystCorrected } from "../override-marks";
import { reconstructMarket } from "../market";
import type { IntegrityContext } from "./context";
import { claimSupport } from "./evidence-debt";
import type { ConfidenceLevel, ConfidenceResult, CrossSlideInconsistency, FieldConfidence, ImpliedMetric } from "./types";
import { arr, isNum, moneyUsd, round, sevRank, str } from "./util";

export function confidenceLevel(score: number, usable = true): ConfidenceLevel {
  if (!usable) return "NONE";
  if (score >= 2.75) return "HIGH";
  if (score >= 1.75) return "MEDIUM";
  return "LOW";
}

const FLAG_PENALTIES: [prefix: string, penalty: number, reason: string][] = [
  ["SMALL_SAMPLE", 1, "small sample"],
  ["SAMPLE_SIZE_UNKNOWN", 0.5, "sample size unknown"],
  ["NO_DENOMINATOR", 1, "rate without denominator"],
  ["NO_COHORT_DEFINITION", 0.5, "no cohort definition"],
  ["DEFINITION_NOT_STATED", 0.5, "definition not stated"],
  ["EXTRACTION_MISMATCH", 1, "model and raw-text parse disagreed"],
  ["VALUE_FROM_RAW_TEXT", 0.25, "value read from raw text"],
  ["NO_AS_OF_DATE", 0.5, "no as-of date"],
  ["CUMULATIVE_NOT_RUN_RATE", 1, "cumulative, not run-rate"],
  ["MONTHLY_FIGURE_LABELLED_ARR", 0.5, "single month annualized"],
  ["GROSS_MARGIN_EXCLUDES_COGS", 1, "margin excludes cost of revenue"],
  ["COGS_COMPOSITION_UNVERIFIED", 0.25, "COGS composition unverified"],
  ["CAC_NOT_FULLY_LOADED", 1, "CAC not fully loaded"],
  ["CAC_LOADING_UNVERIFIED", 0.25, "CAC loading unverified"],
  ["CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING", 1, "count may include non-paying"],
  ["ARR_MAY_INCLUDE_NON_RECURRING", 1, "ARR may include non-recurring"],
  ["SIGNED_NOT_DEPLOYED", 1, "signed, not deployed"],
  ["INCONSISTENT_WITH_INPUTS", 1, "inconsistent with its inputs"],
  ["UNSUPPORTED_CURRENCY", 1, "unsupported currency"],
];

function metricConfidence(m: MetricInstance, implied: ImpliedMetric[], cross: CrossSlideInconsistency[]): FieldConfidence {
  const label = metricDef(m.metricKey)?.shortName ?? m.metricKey;
  const reasons: string[] = [];
  const unusable = !isNum(m.normalizedValue) || ["UNKNOWN", "WITHHELD", "NOT_APPLICABLE", "NOT_YET_MEANINGFUL"].includes(m.state);
  if (unusable) return { field: `metric:${m.metricKey}`, label, ref: m.id, confidence: "NONE", score: 0, reasons: [`state ${m.state.toLowerCase()}${!isNum(m.normalizedValue) ? ", no value" : ""}`] };
  if (m.state === "CONTRADICTED" || m.verification === "CONTRADICTED") return { field: `metric:${m.metricKey}`, label, ref: m.id, confidence: "NONE", score: 0, reasons: ["contradicted"] };
  let score = m.verification === "VERIFIED" ? 3 : m.verification === "PARTIALLY_VERIFIED" ? 2.5 : 2;
  reasons.push(m.verification === "VERIFIED" ? "independently verified" : m.verification === "PARTIALLY_VERIFIED" ? "partially verified" : "company-reported, unverified");
  if (isAnalystCorrected(m)) {
    score = Math.min(3, score + 0.5);
    reasons.push("corrected by a reviewer");
  }
  if (m.calculationMethod === "DERIVED") {
    score -= 0.25;
    reasons.push("derived by formula");
  }
  if (m.state === "INFERRED") {
    score -= 1;
    reasons.push("inferred, not stated");
  }
  if (m.state === "STALE") {
    score -= 1;
    reasons.push("stale");
  }
  if (m.basis === "SIGNED" || m.basis === "BOOKED") {
    score -= 1;
    reasons.push(`basis ${m.basis.toLowerCase()}`);
  }
  for (const [prefix, pen, reason] of FLAG_PENALTIES) {
    if (m.qualityFlags.some((f) => f.startsWith(prefix))) {
      score -= pen;
      reasons.push(reason);
    }
  }
  for (const r of implied) {
    if (r.verdict === "INCONSISTENT" && sevRank(r.severity) >= 1 && r.inputs.includes(m.id)) {
      score -= 1;
      reasons.push(`conflicts with implied ${r.name.toLowerCase()}`);
    }
  }
  if (cross.some((x) => x.origin === "COMPUTED" && x.metricKey === m.metricKey && sevRank(x.severity) >= 1)) {
    score -= 1;
    reasons.push("different values on different slides");
  }
  return { field: `metric:${m.metricKey}`, label, ref: m.id, confidence: confidenceLevel(score), score: round(score, 2), reasons };
}

export function confidenceByField(ctx: IntegrityContext, implied: ImpliedMetric[], cross: CrossSlideInconsistency[]): ConfidenceResult {
  const keys = [...new Set(ctx.metrics.map((m) => m.metricKey))].sort();
  const metrics: FieldConfidence[] = [];
  for (const k of keys) {
    const m = ctx.primary(k) ?? ctx.metrics.find((x) => x.metricKey === k && x.isPrimary) ?? null;
    if (m) metrics.push(metricConfidence(m, implied, cross));
  }

  const fields: FieldConfidence[] = [];
  const f = ctx.deal.financing;
  const rowBad = (name: string) => implied.find((r) => r.name === name && r.verdict === "INCONSISTENT");

  // Round terms — raise.
  {
    const reasons: string[] = [];
    let score = 0;
    let usable = false;
    if (f?.raiseAmount && isNum(f.raiseAmount.amount)) {
      usable = true;
      score = 2;
      reasons.push("stated by the company");
      if (moneyUsd(f.raiseAmount) === null) {
        score -= 1;
        reasons.push(`unsupported currency ${f.raiseAmount.currency}`);
      }
      if (f.instrument === "UNKNOWN") {
        score -= 0.5;
        reasons.push("instrument not stated");
      }
      if (ctx.claims.some((c) => c.category === "FUNDING" && claimSupport(c, ctx).status === "VERIFIED")) {
        score += 1;
        reasons.push("funding claim independently verified");
      }
      if (rowBad("DILUTION")) {
        score -= 1;
        reasons.push("round arithmetic impossible");
      }
    } else reasons.push("raise amount not stated");
    fields.push({ field: "round.raise", label: "Round size", ref: usable ? "financing.raiseAmount" : null, confidence: confidenceLevel(score, usable), score: round(score, 2), reasons });
  }
  // Round terms — valuation.
  {
    const reasons: string[] = [];
    const pre = isNum(f?.preMoney?.amount);
    const post = isNum(f?.postMoney?.amount);
    const cap = isNum(f?.valuationCap?.amount);
    const usable = pre || post || cap;
    let score = usable ? 2 : 0;
    if (!usable) reasons.push(f?.instrument === "SAFE" ? "uncapped SAFE: no valuation" : "valuation not stated");
    else {
      reasons.push(`stated: ${[pre && "pre-money", post && "post-money", cap && "cap"].filter(Boolean).join(", ")}`);
      const bad = rowBad("PRE_MONEY") ?? rowBad("SAFE_CAP") ?? rowBad("DILUTION");
      if (bad) {
        score -= sevRank(bad.severity) >= 2 ? 1.5 : 1;
        reasons.push(`${bad.name.toLowerCase().replace(/_/g, " ")} inconsistent`);
      } else if (pre && post) {
        score += 0.5;
        reasons.push("pre + raise = post");
      }
      if (f?.instrument === "SAFE" && !cap) {
        score -= 1;
        reasons.push("SAFE without cap");
      }
    }
    fields.push({ field: "round.valuation", label: "Valuation", ref: usable ? (post ? "financing.postMoney" : pre ? "financing.preMoney" : "financing.valuationCap") : null, confidence: confidenceLevel(score, usable), score: round(score, 2), reasons });
  }
  // Market size — by reconstruction method.
  {
    const reasons: string[] = [];
    let recon: ReturnType<typeof reconstructMarket> | null = null;
    try {
      recon = reconstructMarket({ ...ctx.deal, market: ctx.deal.market ?? null, deckMarket: ctx.deal.deckMarket ?? { tam: null, sam: null, som: null, description: null } });
    } catch {
      recon = null;
    }
    let score = 0;
    let usable = true;
    let ref: string | null = null;
    const method = recon?.primary?.method ?? null;
    if (method === "BOTTOM_UP") {
      score = 2.5;
      ref = "market.bottomUp";
      reasons.push("bottom-up reconstruction");
      if ((recon?.ranges.length ?? 0) >= 2 && isNum(recon?.methodDivergence) && recon!.methodDivergence! < 3) {
        score += 0.5;
        reasons.push("methods agree (< 3× divergence)");
      } else if (isNum(recon?.methodDivergence) && recon!.methodDivergence! > 10) {
        score -= 0.5;
        reasons.push("methods diverge > 10×");
      }
    } else if (method === "VALUE_CAPTURE") {
      score = 2;
      ref = "market.valueCapture";
      reasons.push("value-capture reconstruction");
    } else if (method === "TOP_DOWN") {
      score = 1.5;
      ref = "market.topDown";
      reasons.push("top-down estimates only");
    } else if (isNum(ctx.deal.deckMarket?.tam?.amount)) {
      score = 1;
      ref = "deckMarket.tam";
      reasons.push("deck TAM only, not reconstructed");
    } else {
      usable = false;
      reasons.push("no market size");
    }
    if (isNum(recon?.deckInflation) && recon!.deckInflation! > 3) reasons.push(`deck TAM ${recon!.deckInflation!.toFixed(1)}× the reconstruction`);
    fields.push({ field: "market.size", label: "Market size", ref, confidence: confidenceLevel(score, usable), score: round(score, 2), reasons });
  }
  // Founders — research-backed or deck-only. Never uses schools or employers.
  {
    const names = new Map<string, string>();
    for (const x of [...arr(ctx.deal.foundersFromDeck), ...arr(ctx.deal.founders)]) {
      const n = str(x?.name).trim();
      if (n && !names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
    }
    for (const [lower, name] of [...names.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const reasons: string[] = [];
      const researched = arr(ctx.deal.founders).find((x) => str(x?.name).toLowerCase() === lower);
      const researchSources = arr(researched?.researchFindingSourceIds).map((id) => ctx.sourceById.get(id)).filter((s) => s && s.origin !== "COMPANY" && s.independenceGroup !== "COMPANY");
      const teamClaims = ctx.claims.filter((c) => c.category === "TEAM" && (str(c.entity).toLowerCase().includes(lower) || c.statement.toLowerCase().includes(lower)));
      const statuses = teamClaims.map((c) => claimSupport(c, ctx).status);
      let score: number;
      if (researchSources.length || statuses.some((s) => s === "VERIFIED" || s === "INDEPENDENTLY_SUPPORTED")) {
        score = 2.5;
        reasons.push("background supported by external research");
        if (statuses.includes("VERIFIED")) {
          score += 0.5;
          reasons.push("verified claim");
        }
      } else {
        score = 1.5;
        reasons.push("deck-only background");
      }
      if (statuses.includes("CONTRADICTED")) {
        score = Math.min(score, 1);
        reasons.push("a claim about this founder is contradicted");
      }
      fields.push({ field: `founder:${name}`, label: name, ref: null, confidence: confidenceLevel(score), score: round(score, 2), reasons });
    }
  }
  return { metrics, fields };
}
