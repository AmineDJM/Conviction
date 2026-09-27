/**
 * §5 MISSING INFORMATION AS SIGNAL — an absent decision metric is judged
 * against what a company at this maturity would normally track. Materiality
 * depends on the stage band (and a very small customer base), never on the
 * company's performance elsewhere.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { PeerGroupRef } from "../scoring/peer";
import { PROFILE_LABELS, STAGE_BAND_LABELS } from "../scoring/peer";
import { FAMILY_NOUN, FAMILY_PRIORITY, STAGE_RANK, type SlotFamily } from "./decision-metrics";
import type { MetricSelection, SlotAssessment } from "./metric-selection";
import type { LatentModule } from "./types";
import { bases, coverage, currentValue, pagesOf } from "./util";

export type OmissionSeverity = "HIGH" | "MODERATE" | "LOW";

export interface Omission {
  slotId: string;
  metric: string;
  family: SlotFamily;
  /** WITHHELD = the deck explicitly declines to disclose; ABSENT = simply not shown; STALE = only an outdated value; FORWARD_ONLY = only a forecast/target. */
  kind: "WITHHELD" | "ABSENT" | "STALE" | "FORWARD_ONLY" | "NOT_YET_EXPECTED";
  severity: OmissionSeverity;
  sentence: string;
  /** Flattering substitute shown instead (vanity metric), if any. */
  flatteringSubstitute: string | null;
  expectedFrom: string;
  context: string[];
}

export interface MissingAsSignal extends LatentModule {
  omissions: Omission[];
  material: Omission[];
  withheld: Omission[];
  notYetExpected: Omission[];
  highCount: number;
}

const SEV: OmissionSeverity[] = ["LOW", "MODERATE", "HIGH"];
const bump = (s: OmissionSeverity, d: number): OmissionSeverity => SEV[Math.max(0, Math.min(2, SEV.indexOf(s) + d))]!;

function sentenceFor(s: SlotAssessment, kind: Omission["kind"], severity: OmissionSeverity, peer: PeerGroupRef, ctx: { shown: string[]; fewCustomers: number | null; substitute: string | null }): string {
  const noun = FAMILY_NOUN[s.family];
  const stage = STAGE_BAND_LABELS[peer.stageBand];
  const shown = ctx.shown.length ? ` The deck shows ${ctx.shown.slice(0, 4).join(", ")} but not ${s.label}.` : "";
  const sub = ctx.substitute ? ` It shows ${ctx.substitute} instead — a flattering substitute for the missing metric.` : "";
  const few = ctx.fewCustomers !== null ? ` With only ${ctx.fewCustomers} paying customers, cohorts are too small to be meaningful yet.` : "";
  if (kind === "NOT_YET_EXPECTED")
    return `${noun} (${s.label}) is not yet expected at the ${stage} stage; its absence is not a signal.${few}`;
  const lead =
    kind === "WITHHELD"
      ? `${s.label} is explicitly withheld.`
      : kind === "STALE"
        ? `${s.label} is only shown with an outdated value.`
        : kind === "FORWARD_ONLY"
          ? `${s.label} is only shown as a forecast or target, not as an actual.`
          : null;
  const body =
    severity === "HIGH"
      ? `${noun} omission is material because a company at this maturity (${stage}, ${PROFILE_LABELS[peer.profile]}) would normally be expected to track ${s.label} — it evidences ${s.why}.`
      : severity === "MODERATE"
        ? `${noun} is normally expected from this stage (${stage}); without ${s.label}, ${s.why} remains unevidenced.`
        : `${noun} (${s.label}) is a minor gap at this stage.${few}`;
  return [lead, body].filter(Boolean).join(" ") + shown + sub;
}

export function missingAsSignal(deal: CanonicalDeal, peer: PeerGroupRef, sel: MetricSelection): MissingAsSignal {
  const band = STAGE_RANK[peer.stageBand] ?? 0;
  const customers = currentValue(deal, "paying_customers");
  const shown = sel.slots.filter((s) => s.status === "PRESENT").map((s) => s.label);
  const omissions: Omission[] = [];
  for (const s of sel.slots) {
    if (s.status === "PRESENT" || s.status === "NOT_APPLICABLE") continue;
    const kind: Omission["kind"] = !s.expected || s.status === "NOT_YET_EXPECTED" ? "NOT_YET_EXPECTED" : s.status;
    const substitute = sel.vanityInPlaceOfDecision.find((v) => v.absentDecisionMetric === s.label)?.vanity ?? null;
    const context: string[] = [];
    let severity: OmissionSeverity;
    if (kind === "NOT_YET_EXPECTED") severity = "LOW";
    else {
      const from = STAGE_RANK[s.expectedFrom];
      severity = from < band ? "HIGH" : "MODERATE";
      context.push(from < band ? `expected since ${STAGE_BAND_LABELS[s.expectedFrom]}` : `expected from ${STAGE_BAND_LABELS[s.expectedFrom]}`);
      if (kind === "WITHHELD") context.push("explicitly declined");
      if (kind === "STALE") {
        severity = bump(severity, -1);
        context.push("outdated value shown");
      }
      if (substitute) {
        severity = bump(severity, 1);
        context.push(`flattering substitute shown: ${substitute}`);
      }
    }
    const fewCustomers = s.family === "RETENTION" && customers && customers.value < 10 ? customers.value : null;
    if (fewCustomers !== null && kind !== "NOT_YET_EXPECTED") {
      severity = bump(severity, -1);
      context.push(`only ${fewCustomers} paying customers`);
    }
    if (kind === "WITHHELD" && severity === "LOW") severity = "MODERATE";
    omissions.push({
      slotId: s.slotId,
      metric: s.label,
      family: s.family,
      kind,
      severity,
      sentence: sentenceFor(s, kind, severity, peer, { shown: kind === "NOT_YET_EXPECTED" ? [] : shown, fewCustomers, substitute }),
      flatteringSubstitute: substitute,
      expectedFrom: STAGE_BAND_LABELS[s.expectedFrom],
      context,
    });
  }
  const rankSev = (o: Omission) => (o.kind === "NOT_YET_EXPECTED" ? 3 : 2 - SEV.indexOf(o.severity));
  omissions.sort((a, b) => rankSev(a) - rankSev(b) || FAMILY_PRIORITY[a.family] - FAMILY_PRIORITY[b.family] || a.slotId.localeCompare(b.slotId));
  const material = omissions.filter((o) => o.kind !== "NOT_YET_EXPECTED" && o.severity !== "LOW");
  return {
    basis: bases("COMPUTED"),
    pages: pagesOf(sel.slots.filter((s) => s.status === "PRESENT").flatMap((s) => s.pages)),
    coverage: coverage(
      [deal.metricObservations?.length || deal.metrics?.length ? "metrics shown" : null, "peer group"].filter((x): x is string => !!x),
      deal.metricObservations?.length || deal.metrics?.length ? [] : ["metrics shown"],
      "Omission = the metric is not in the extracted deck data; the extraction itself can miss a metric, so confirm before raising it.",
    ),
    rule:
      "HIGH when the decision metric has been expected since an earlier stage band than the company's; MODERATE when it becomes expected at the current band; LOW / not yet expected otherwise. " +
      "+1 level when a vanity metric is shown in its place; −1 when only a stale value is shown; retention −1 with fewer than 10 paying customers; WITHHELD is at least MODERATE and reported separately from simple absence.",
    omissions,
    material,
    withheld: omissions.filter((o) => o.kind === "WITHHELD"),
    notYetExpected: omissions.filter((o) => o.kind === "NOT_YET_EXPECTED"),
    highCount: omissions.filter((o) => o.kind !== "NOT_YET_EXPECTED" && o.severity === "HIGH").length,
  };
}
