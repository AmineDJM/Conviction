/**
 * §1 FOUNDER OPERATING MATURITY — eight observable signals, reported
 * independently from performance: weak numbers plus a founder who
 * understands exactly why they are weak is a strong signal.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { OPERATING_MATURITY_SIGNALS } from "@/domain/sections";
import type { MetricSelection } from "./metric-selection";
import type { NarrativeInflation } from "./inflation";
import type { PrecisionDiscipline } from "./precision";
import { cohortObservations } from "./decision-metrics";
import type { LatentBasis, LatentEvidence, LatentModule, QualityLevel } from "./types";
import { bases, coverage, lower, pageFromLocation, pagesOf, round } from "./util";

export type MaturitySignalId = (typeof OPERATING_MATURITY_SIGNALS)[number];
export type SignalStatus = "DEMONSTRATED" | "PARTIAL" | "NOT_SHOWN" | "CONTRADICTED";

export const MATURITY_SIGNAL_LABEL: Record<MaturitySignalId, string> = {
  ICP_PRECISION: "Precise ICP",
  USER_BUYER_DISTINCTION: "User / buyer / economic buyer distinguished",
  MODEL_APPROPRIATE_METRICS: "Metrics appropriate to the business model",
  COHORTS_OVER_VANITY: "Cohorts rather than vanity metrics",
  CHURN_REASONS_KNOWN: "Churn reasons known",
  WIN_LOSS_UNDERSTANDING: "Why deals are won / lost",
  UNIT_ECONOMICS_UNDERSTANDING: "Unit economics understood",
  ACTUAL_FORECAST_SEPARATION: "Actual / forecast / pipeline separated",
};

export interface MaturitySignal {
  signal: MaturitySignalId;
  label: string;
  status: SignalStatus | "NOT_ASSESSED";
  modelStatus: SignalStatus | null;
  computedStatus: SignalStatus | null;
  basis: LatentBasis | null;
  evidence: LatentEvidence[];
  /** Set when model and computed statuses disagree (computed wins). */
  conflictNote: string | null;
}

export interface OperatingMaturity extends LatentModule {
  level: QualityLevel;
  score: number | null;
  signals: MaturitySignal[];
  assessed: number;
  conflicts: string[];
  /** Maturity is reported independently from performance. */
  performanceIndependence: string;
  /** True when the deck shows weak / declining numbers together with an explanation of why. */
  understandsWeakNumbers: boolean;
}

const POINTS: Record<SignalStatus, number> = { DEMONSTRATED: 3, PARTIAL: 1.5, NOT_SHOWN: 0, CONTRADICTED: 0 };
const CONSERVATIVE: Record<SignalStatus, number> = { CONTRADICTED: 0, NOT_SHOWN: 1, PARTIAL: 2, DEMONSTRATED: 3 };

const UNIT_ECON_KEYS = ["gross_margin", "contribution_margin", "cac", "cac_payback_months", "ltv", "ltv_to_cac", "burn_multiple", "magic_number"];
const DECLINE_RE = /declin|drop|fell|fall|decreas|lower|down |slow|miss|churn(ed)? (rose|increase)|worse/;

export function operatingMaturity(deal: CanonicalDeal, sel: MetricSelection, prec: PrecisionDiscipline, infl: NarrativeInflation): OperatingMaturity {
  const ls = deal.latentSignals;
  const computed = new Map<MaturitySignalId, { status: SignalStatus; evidence: LatentEvidence[] }>();

  // MODEL_APPROPRIATE_METRICS ← decision-metric coverage.
  if (sel.decisionCoveragePct !== null) {
    const c = sel.decisionCoveragePct;
    computed.set("MODEL_APPROPRIATE_METRICS", {
      status: c >= 80 ? "DEMONSTRATED" : c >= 50 ? "PARTIAL" : "NOT_SHOWN",
      evidence: [{ basis: "COMPUTED", text: `Decision-metric coverage ${c}% (${sel.presentCount}/${sel.expectedCount}) for ${sel.peerGroup}; absent: ${sel.absentDecisionMetrics.join(", ") || "none"}`, page: null }],
    });
  }

  // COHORTS_OVER_VANITY ← cohort evidence vs vanity dependence.
  const cohorts = cohortObservations(deal.metricObservations ?? []);
  const retentionShown = sel.slots.some((s) => s.family === "RETENTION" && s.status === "PRESENT");
  if (sel.vanityDependence !== "INSUFFICIENT_EVIDENCE" || cohorts.length) {
    const v = sel.vanityDependence;
    const status: SignalStatus = cohorts.length
      ? v === "LOW" || v === "INSUFFICIENT_EVIDENCE"
        ? "DEMONSTRATED"
        : "PARTIAL"
      : v === "HIGH"
        ? "CONTRADICTED"
        : retentionShown && v === "LOW"
          ? "PARTIAL"
          : "NOT_SHOWN";
    computed.set("COHORTS_OVER_VANITY", {
      status,
      evidence: [
        { basis: "COMPUTED", text: `${cohorts.length} cohort observation(s)${cohorts[0] ? ` (e.g. ${cohorts[0].label})` : ""}; vanity dependence ${v}${sel.vanitySharePct !== null ? ` (${sel.vanitySharePct}% of quantitative observations)` : ""}`, page: cohorts[0]?.page ?? null },
      ],
    });
  }

  // UNIT_ECONOMICS_UNDERSTANDING ← unit-economics metrics shown and how they are defined.
  const ue = (deal.metrics ?? []).filter((m) => UNIT_ECON_KEYS.includes(m.metricKey) && m.normalizedValue !== null);
  const ueObs = (deal.metricObservations ?? []).filter((o) => UNIT_ECON_KEYS.includes(o.metricKey) && o.value !== null);
  const ueKeys = new Set([...ue.map((m) => m.metricKey), ...ueObs.map((o) => o.metricKey)]);
  const loadingFlags = ue.flatMap((m) => m.qualityFlags.filter((f) => /CAC_NOT_FULLY_LOADED|GROSS_MARGIN_EXCLUDES_COGS/.test(f)));
  const ueExpected = sel.slots.some((s) => (s.family === "UNIT_ECONOMICS" || s.family === "MARGIN") && s.expected);
  if (ueKeys.size || ueExpected) {
    const defined = ueObs.filter((o) => o.definitionAsStated || o.components.length).length + ue.filter((m) => m.definitionUsed || m.components.length).length;
    const status: SignalStatus = ueKeys.size >= 3 && defined > 0 && !loadingFlags.length ? "DEMONSTRATED" : ueKeys.size >= 1 ? "PARTIAL" : "NOT_SHOWN";
    computed.set("UNIT_ECONOMICS_UNDERSTANDING", {
      status,
      evidence: [
        {
          basis: "COMPUTED",
          text: `${ueKeys.size} unit-economics metric(s) shown (${[...ueKeys].sort().join(", ") || "none"})${loadingFlags.length ? `; definition issues: ${loadingFlags.join("; ")}` : ""}`,
          page: pageFromLocation(ue[0]?.location) ?? ueObs[0]?.page ?? null,
        },
      ],
    });
  }

  // WIN_LOSS_UNDERSTANDING ← a win rate shows how often, not why (PARTIAL at most from data).
  const win = (deal.metrics ?? []).find((m) => m.metricKey === "win_rate" && m.normalizedValue !== null);
  if (win) computed.set("WIN_LOSS_UNDERSTANDING", { status: "PARTIAL", evidence: [{ basis: "COMPUTED", text: `Win rate shown (${win.rawValue}) — how often, not why`, page: pageFromLocation(win.location) }] });

  // ACTUAL_FORECAST_SEPARATION ← observation bases, forecast separation and forensics.
  const fda = infl.items.filter((i) => i.source === "COMPUTED" && (i.technique === "FORECAST_DRAWN_AS_ACTUAL" || i.technique === "PIPELINE_AS_BOOKED"));
  const fs = prec.forecastSeparation;
  if (fda.length) computed.set("ACTUAL_FORECAST_SEPARATION", { status: "CONTRADICTED", evidence: fda.map((i) => ({ basis: "COMPUTED" as const, text: i.evidence, page: i.page })) });
  else if (fs.denominator > 0)
    computed.set("ACTUAL_FORECAST_SEPARATION", {
      status: (fs.pct ?? 0) >= 80 ? "DEMONSTRATED" : "PARTIAL",
      evidence: [{ basis: "COMPUTED", text: `${fs.numerator}/${fs.denominator} forward-looking values are labelled and kept off actual charts`, page: null }],
    });

  const signals: MaturitySignal[] = [];
  const conflicts: string[] = [];
  for (const id of OPERATING_MATURITY_SIGNALS) {
    const entries = (ls?.operatingMaturity ?? []).filter((e) => e.signal === id);
    const modelEntry = entries.length ? [...entries].sort((a, b) => CONSERVATIVE[a.status] - CONSERVATIVE[b.status])[0]! : null;
    const c = computed.get(id) ?? null;
    const evidence: LatentEvidence[] = [...(c?.evidence ?? []), ...entries.map((e) => ({ basis: "MODEL_OBSERVED" as const, text: e.evidence, page: e.page }))];
    let status: MaturitySignal["status"] = "NOT_ASSESSED";
    let basis: LatentBasis | null = null;
    let conflictNote: string | null = null;
    if (c) {
      status = c.status;
      basis = "COMPUTED";
      if (modelEntry && modelEntry.status !== c.status) {
        conflictNote = `Model read ${modelEntry.status}, computed evidence shows ${c.status} — computed evidence wins.`;
        conflicts.push(`${MATURITY_SIGNAL_LABEL[id]}: ${conflictNote}`);
      }
    } else if (modelEntry) {
      status = modelEntry.status;
      basis = "MODEL_OBSERVED";
    }
    signals.push({ signal: id, label: MATURITY_SIGNAL_LABEL[id], status, modelStatus: modelEntry?.status ?? null, computedStatus: c?.status ?? null, basis, evidence, conflictNote });
  }

  const assessedSignals = signals.filter((s) => s.status !== "NOT_ASSESSED");
  const assessed = assessedSignals.length;
  const score = assessed ? round(assessedSignals.reduce((a, s) => a + POINTS[s.status as SignalStatus], 0) / (3 * assessed), 3) : null;
  const demonstrated = assessedSignals.filter((s) => s.status === "DEMONSTRATED").length;
  const contradicted = assessedSignals.filter((s) => s.status === "CONTRADICTED").length;
  let level: QualityLevel;
  if (score === null || assessed < 3) level = "INSUFFICIENT_EVIDENCE";
  else if (score >= 0.85 && demonstrated >= 6 && !contradicted) level = "EXCEPTIONAL";
  else if (score >= 0.6 && !contradicted) level = "STRONG";
  else if (score >= 0.35) level = "MODERATE";
  else level = "WEAK";
  if (contradicted && level === "STRONG") level = "MODERATE";

  const unflattering = (ls?.disclosures ?? []).some((d) => d.kind === "UNFLATTERING_METRIC" || d.kind === "FAILED_EXPERIMENT");
  const explainedDecline = (ls?.causalExplanations ?? []).some((c) => !!c.explanationGiven && (DECLINE_RE.test(lower(c.explanationGiven)) || DECLINE_RE.test(lower(c.metric))));
  const understandsWeakNumbers = (unflattering && (ls?.causalExplanations ?? []).some((c) => !!c.explanationGiven)) || explainedDecline;

  const missing = [ls ? null : "model operating-maturity read (latentSignals)", deal.metricObservations?.length ? null : "metric observations"].filter((x): x is string => !!x);
  return {
    basis: bases(...signals.map((s) => s.basis)),
    pages: pagesOf(signals.flatMap((s) => s.evidence.map((e) => e.page))),
    coverage: coverage(
      assessedSignals.map((s) => s.label),
      [...signals.filter((s) => s.status === "NOT_ASSESSED").map((s) => s.label), ...missing],
      `${assessed}/8 signals assessed (${computed.size} computed from data).`,
    ),
    rule:
      "Each signal: DEMONSTRATED 3, PARTIAL 1.5, NOT_SHOWN / CONTRADICTED 0; score = points / (3 × assessed). Computed evidence (decision-metric coverage, cohorts vs vanity, unit-economics metrics, win rate, actual/forecast separation) overrides the model status on conflict. " +
      "EXCEPTIONAL ≥0.85 with ≥6 demonstrated and none contradicted; STRONG ≥0.60 and none contradicted; MODERATE ≥0.35; else WEAK; fewer than 3 assessed signals → INSUFFICIENT_EVIDENCE.",
    level,
    score,
    signals,
    assessed,
    conflicts,
    performanceIndependence:
      "Operating maturity is reported independently from performance: bad numbers plus a founder who understands exactly why is a strong signal; strong numbers without that understanding are not.",
    understandsWeakNumbers,
  };
}
