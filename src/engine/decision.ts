/**
 * §66 Recommendation gates. Code decides which statuses are admissible; the
 * model's suggestion is accepted only if admissible. Every gate evaluation is
 * recorded in a trace shown to the user.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DecisionStatus } from "@/domain/enums";
import type { BenchmarkRegistry } from "./benchmarks/types";
import type { OperatingQuality } from "./scoring/dimensions";
import type { EvidenceQualityResult } from "./scoring/evidence";
import { evidenceAtLeast } from "./scoring/evidence";
import type { PowerLawResult } from "./scoring/powerlaw";
import type { FundFitResult } from "./fund";
import type { RiskProfile } from "./risk";
import type { ReturnModel } from "./returns";

export interface GateTrace {
  gate: string;
  outcome: "PASS" | "BLOCK" | "APPLIED" | "N/A";
  detail: string;
}

export interface Recommendation {
  status: DecisionStatus;
  aiSuggested: DecisionStatus | null;
  aiAccepted: boolean;
  admissible: DecisionStatus[];
  exceptionalOverride: boolean;
  rationale: string;
  watch: { trigger: string; expectedDate: string | null; informationAwaited: string } | null;
  trace: GateTrace[];
}

const ALL: DecisionStatus[] = [
  "SCREEN_OUT",
  "NEEDS_FOUNDER_CALL",
  "NEEDS_TARGETED_DILIGENCE",
  "DEEP_DD",
  "IC_READY",
  "ANALYTICAL_RECOMMEND_INVEST",
  "WATCH",
  "ANALYTICAL_RECOMMEND_PASS",
];

export interface DecisionInputs {
  deal: CanonicalDeal;
  registry: BenchmarkRegistry;
  oqi: OperatingQuality;
  evidence: EvidenceQualityResult;
  powerLaw: PowerLawResult;
  fund: FundFitResult;
  risk: RiskProfile;
  returns: ReturnModel;
}

export function decide(inp: DecisionInputs): Recommendation {
  const { deal, registry: reg, oqi, evidence, powerLaw, fund, risk, returns } = inp;
  const d = reg.decision;
  const trace: GateTrace[] = [];
  let admissible = new Set<DecisionStatus>(ALL);
  const restrict = (allowed: DecisionStatus[]) => {
    admissible = new Set([...admissible].filter((s) => allowed.includes(s)));
  };
  const remove = (s: DecisionStatus[]) => s.forEach((x) => admissible.delete(x));

  const aiSuggested = deal.aiRecommendation?.suggestedStatus ?? null;
  const hasRatedStrength = deal.exceptionalStrengths.some((s) => s.rating === "STRONG" || s.rating === "EXCEPTIONAL");
  const strongMechanism = deal.powerLawRatings?.nonlinearMechanism === "STRONG" || deal.powerLawRatings?.nonlinearMechanism === "EXCEPTIONAL";
  // A big market alone is not exceptional: the override needs a rated strength or mechanism. The bar is tested on the
  // conservative bound (missing Power-Law components scored at 0): the observed-only average rises when a weak component
  // (e.g. the price-dependent outlier path) is withheld, and withholding must never unlock the override.
  const exceptional = powerLaw.lower >= d.exceptionalOverridePowerLaw && powerLaw.coverage >= 0.5 && (hasRatedStrength || strongMechanism);

  // MANDATE
  if (fund.mandate === "FAIL") {
    const failed = fund.gates.filter((g) => g.result === "FAIL").map((g) => g.label);
    trace.push({ gate: "MANDATE", outcome: "BLOCK", detail: `Mandate fail: ${failed.join(", ")}` });
    return finalize("SCREEN_OUT", aiSuggested, ["SCREEN_OUT"], false, `Outside fund mandate (${failed.join(", ")}).`, null, trace);
  }
  trace.push({ gate: "MANDATE", outcome: "PASS", detail: fund.mandate === "INCOMPLETE" ? "No failures; some gates unknown" : "All gates pass" });

  // DEPTH_LIMIT
  if (deal.analysis.mode === "FAST_SCREEN") {
    restrict(["SCREEN_OUT", "NEEDS_FOUNDER_CALL", "WATCH", "ANALYTICAL_RECOMMEND_PASS"]);
    trace.push({ gate: "DEPTH_LIMIT", outcome: "APPLIED", detail: "Fast screen: only screen-out, founder call, watch or pass" });
  } else if (deal.analysis.depth === "PARTIAL") {
    remove(["IC_READY", "ANALYTICAL_RECOMMEND_INVEST"]);
    trace.push({ gate: "DEPTH_LIMIT", outcome: "APPLIED", detail: "Partial analysis cannot be IC-ready or recommend investment" });
  } else trace.push({ gate: "DEPTH_LIMIT", outcome: "PASS", detail: "Full analysis" });

  // EXCEPTIONAL_OVERRIDE and SCREEN_OUT_QUALITY
  if (exceptional) {
    remove(["SCREEN_OUT"]);
    trace.push({ gate: "EXCEPTIONAL_OVERRIDE", outcome: "APPLIED", detail: `Power-Law lower bound ${powerLaw.lower} ≥ ${d.exceptionalOverridePowerLaw}: cannot be screened out on composite quality alone` });
  } else trace.push({ gate: "EXCEPTIONAL_OVERRIDE", outcome: "N/A", detail: `Power-Law lower bound ${powerLaw.lower} (observed ${powerLaw.value ?? "n/a"}, coverage ${powerLaw.coverage}) — override needs ≥ ${d.exceptionalOverridePowerLaw} with a rated strength or mechanism` });

  const qualityLow = oqi.upper < d.screenOutOqiUpper;
  if (qualityLow && !exceptional && !hasRatedStrength) {
    restrict(["SCREEN_OUT", "WATCH", "ANALYTICAL_RECOMMEND_PASS"]);
    trace.push({ gate: "SCREEN_OUT_QUALITY", outcome: "BLOCK", detail: `OQI upper bound ${oqi.upper} < ${d.screenOutOqiUpper} and no rated exceptional strength` });
  } else trace.push({ gate: "SCREEN_OUT_QUALITY", outcome: "PASS", detail: `OQI upper bound ${oqi.upper}` });

  // THESIS_KILLER
  const killers = risk.thesisKillers.filter((r) => r.likelihood === "HIGH" || r.likelihood === "CRITICAL");
  if (killers.length && !exceptional) {
    remove(["IC_READY", "ANALYTICAL_RECOMMEND_INVEST", "DEEP_DD"]);
    trace.push({ gate: "THESIS_KILLER", outcome: "BLOCK", detail: `Likely thesis killer: ${killers.map((k) => k.title).join("; ")}` });
  } else trace.push({ gate: "THESIS_KILLER", outcome: killers.length ? "APPLIED" : "PASS", detail: killers.length ? "Likely thesis killer present but exceptional override applies" : "No likely thesis killer" });

  // MUST_ASK_OPEN
  const openMust = deal.questions.filter((q) => q.tier === "MUST_ASK" && (q.status === "OPEN" || q.status === "ASKED"));
  if (openMust.length && !evidenceAtLeast(evidence.category, "HIGH")) {
    remove(["IC_READY", "ANALYTICAL_RECOMMEND_INVEST", "DEEP_DD", "NEEDS_TARGETED_DILIGENCE"]);
    trace.push({ gate: "MUST_ASK_OPEN", outcome: "BLOCK", detail: `${openMust.length} must-ask questions open; evidence ${evidence.category}` });
  } else trace.push({ gate: "MUST_ASK_OPEN", outcome: "PASS", detail: `${openMust.length} must-ask open; evidence ${evidence.category}` });

  // FOUNDER_CALL_HELD: once a call happened and every must-ask question was addressed, another call is not the default.
  const callHeld = deal.sources.some((x) => x.kind === "TRANSCRIPT");
  if (callHeld && openMust.length === 0) {
    remove(["NEEDS_FOUNDER_CALL"]);
    trace.push({ gate: "FOUNDER_CALL_HELD", outcome: "APPLIED", detail: "Founder call recorded and no must-ask question left open" });
  } else trace.push({ gate: "FOUNDER_CALL_HELD", outcome: "N/A", detail: callHeld ? `${openMust.length} must-ask question(s) still open after the call` : "No founder call recorded" });

  // IC_READY
  const icOk =
    deal.analysis.depth === "FULL" && evidenceAtLeast(evidence.category, d.icReadyMinEvidence) && openMust.length === 0 && fund.mandate === "PASS";
  if (!icOk) remove(["IC_READY"]);
  trace.push({ gate: "IC_READY", outcome: icOk ? "PASS" : "BLOCK", detail: `Depth ${deal.analysis.depth}, evidence ${evidence.category} (min ${d.icReadyMinEvidence}), must-ask open ${openMust.length}, mandate ${fund.mandate}` });

  // INVEST
  const base = returns.scenarios.find((s) => s.scenario === "BASE");
  const investOk = icOk && oqi.lower >= d.investMinOqiLower && (base?.grossMoic ?? 0) >= d.investMinBaseMoic && evidenceAtLeast(evidence.category, d.investMinEvidence);
  if (!investOk) remove(["ANALYTICAL_RECOMMEND_INVEST"]);
  trace.push({ gate: "INVEST", outcome: investOk ? "PASS" : "BLOCK", detail: `OQI lower ${oqi.lower} (min ${d.investMinOqiLower}), base MOIC ${base?.grossMoic?.toFixed(1) ?? "n/a"} (min ${d.investMinBaseMoic})` });

  // WATCH
  const watch = deal.aiRecommendation?.watch ?? null;
  const watchOk = !!watch && !!watch.trigger && !!watch.informationAwaited;
  if (!watchOk) remove(["WATCH"]);
  trace.push({ gate: "WATCH", outcome: watchOk ? "PASS" : "BLOCK", detail: watchOk ? `Trigger: ${watch!.trigger}` : "No trigger/awaited information defined" });

  const adm = ALL.filter((s) => admissible.has(s));
  // Default when the AI suggestion is not admissible: the most diligence-forward admissible status
  // that does not over-claim.
  const fallbackOrder: DecisionStatus[] = [
    "NEEDS_FOUNDER_CALL",
    "NEEDS_TARGETED_DILIGENCE",
    "WATCH",
    "ANALYTICAL_RECOMMEND_PASS",
    "SCREEN_OUT",
    "DEEP_DD",
    "IC_READY",
    "ANALYTICAL_RECOMMEND_INVEST",
  ];
  // SCREEN_OUT is a gate outcome (mandate, quality floor), not an analytical judgment: a model "screen out" with no
  // screen-out gate is an analytical pass.
  const screenGate = qualityLow && !exceptional && !hasRatedStrength;
  const suggestion: DecisionStatus | null = aiSuggested === "SCREEN_OUT" && !screenGate ? "ANALYTICAL_RECOMMEND_PASS" : aiSuggested;
  if (suggestion !== aiSuggested) trace.push({ gate: "SCREEN_OUT_RESERVED", outcome: "APPLIED", detail: "Model suggested SCREEN_OUT without a mandate or quality-floor gate: recorded as an analytical pass" });
  const accepted = suggestion !== null && admissible.has(suggestion);
  const status = accepted ? suggestion! : (fallbackOrder.find((s) => admissible.has(s)) ?? "NEEDS_FOUNDER_CALL");
  const rationale = accepted
    ? (deal.aiRecommendation?.rationale ?? "")
    : aiSuggested === null
      ? `No analytical suggestion available; gates applied ${status}.`
      : `Model suggested ${aiSuggested}, which the gates do not admit. Applied ${status}. ${deal.aiRecommendation?.rationale ?? ""}`.trim();
  return finalize(status, aiSuggested, adm, exceptional, rationale, status === "WATCH" ? watch : null, trace);
}

function finalize(
  status: DecisionStatus,
  aiSuggested: DecisionStatus | null,
  admissible: DecisionStatus[],
  exceptionalOverride: boolean,
  rationale: string,
  watch: Recommendation["watch"],
  trace: GateTrace[],
): Recommendation {
  return { status, aiSuggested, aiAccepted: aiSuggested === status, admissible, exceptionalOverride, rationale, watch, trace };
}
