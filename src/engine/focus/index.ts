/**
 * DECISION FOCUS — "out of everything in the record, which few things actually
 * decide this investment?"
 *
 * Deterministic complement to the model's decision core. Every candidate
 * (metric, claim, information gap, risk, fund gate, computed sensitivity
 * breakpoint) gets a Decision Leverage Index:
 *
 *   leverage = 100 × impact × (0.4 + 0.6 × uncertainty)
 *
 *   impact       how much the outcome moves with it (distance to a computed
 *                breakpoint, thesis-killer / gate status, materiality × unusualness,
 *                gap decision importance)
 *   uncertainty  how unresolved it is (verification / evidence status)
 *
 * A consequential variable matters most while it is unresolved; a resolved one
 * still matters (floor 0.4). Items about the same variable collapse into one.
 * A failed fund-mandate gate is binding and ranks first. The index ranks
 * attention; it is not a probability and never feeds scores.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { BenchmarkRegistry } from "@/engine/benchmarks/types";
import type { PeerGroupRef } from "@/engine/scoring/peer";
import type { SensitivityRow } from "@/engine/economics/sensitivity";
import { findBenchmark, interpolate } from "@/engine/scoring/curve";
import { metricDef } from "@/engine/metrics/dictionary";

export const FOCUS_VERSION = "1.0";
export const FOCUS_RULE = "Decision Leverage Index = 100 × impact × (0.4 + 0.6 × uncertainty). Ranks attention, not a probability.";

export type FocusKind = "SENSITIVITY" | "METRIC" | "CLAIM" | "GAP" | "RISK" | "GATE";

export interface FocusItem {
  key: string;
  kind: FocusKind;
  label: string;
  refs: string[];
  impact: number;
  uncertainty: number;
  leverage: number;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "COMPANY_REPORTED" | "CONTRADICTED" | "UNKNOWN" | "COMPUTED";
  why: string[];
}

export interface OutlierCandidate {
  label: string;
  basis: string;
  status: FocusItem["status"];
  refs: string[];
}

export interface DecisionFocus {
  version: string;
  rule: string;
  considered: number;
  determinants: FocusItem[];
  ranked: FocusItem[];
  outlierCandidates: OutlierCandidate[];
  reversingQuestion: { question: string; id: string | null; linkedTo: string | null; source: "QUESTIONS" | "MODEL" } | null;
  modelAgreement: { agreed: string[]; modelOnly: string[]; codeOnly: string[] } | null;
  headline: string;
}

export interface FocusContext {
  sensitivity?: SensitivityRow[];
  gates?: { id: string; label: string; result: string; detail: string }[];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%$ ]/g, " ").split(/\s+/).filter((w) => w.length > 3));
function overlap(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}

const UNCERTAINTY: Record<FocusItem["status"], number> = { VERIFIED: 0.15, PARTIALLY_VERIFIED: 0.4, COMPANY_REPORTED: 0.7, CONTRADICTED: 1, UNKNOWN: 1, COMPUTED: 0.5 };

function metricStatus(v: string, method: string, state: string): FocusItem["status"] {
  if (state !== "OBSERVED" && state !== "INFERRED") return "UNKNOWN";
  if (method === "DERIVED") return "COMPUTED";
  if (v === "VERIFIED") return "VERIFIED";
  if (v === "PARTIALLY_VERIFIED") return "PARTIALLY_VERIFIED";
  if (v === "CONTRADICTED") return "CONTRADICTED";
  return "COMPANY_REPORTED";
}

function item(kind: FocusKind, key: string, label: string, refs: string[], impact: number, status: FocusItem["status"], why: string[], uncertaintyOverride?: number): FocusItem {
  const uncertainty = clamp01(uncertaintyOverride ?? UNCERTAINTY[status]);
  const imp = clamp01(impact);
  return { key, kind, label, refs, impact: +imp.toFixed(3), uncertainty: +uncertainty.toFixed(3), leverage: +(100 * imp * (0.4 + 0.6 * uncertainty)).toFixed(1), status, why };
}

export function decisionFocus(deal: CanonicalDeal, registry: BenchmarkRegistry, peer: PeerGroupRef, ctx: FocusContext = {}): DecisionFocus {
  const items: FocusItem[] = [];

  // 1. Computed breakpoints: the closer the current value is to the point where the case breaks, the higher the impact.
  for (const r of ctx.sensitivity ?? []) {
    if (r.margin === null && r.broken === null) continue;
    const proximity = r.broken ? 1 : r.margin === null ? 0.5 : clamp01(1 - Math.abs(r.margin) / 100);
    const m = r.metricKey ? deal.metrics.find((x) => x.metricKey === r.metricKey && x.isPrimary) : undefined;
    const status = m ? metricStatus(m.verification, m.calculationMethod, m.state) : r.method === "COMPUTED" ? "COMPUTED" : "UNKNOWN";
    items.push(
      item("SENSITIVITY", r.metricKey ? `metric:${r.metricKey}` : `sens:${r.id}`, r.variable, m ? [m.id] : [], 0.55 + 0.45 * proximity, status, [
        r.broken ? `Already past its breakpoint (${r.breaksAt})` : r.margin !== null ? `${Math.abs(r.margin).toFixed(0)}% from the breakpoint (${r.current} → breaks at ${r.breaksAt})` : `Breakpoint ${r.breaksAt}`,
        r.why,
      ]),
    );
  }

  // 2. Primary metrics the dictionary marks decision-relevant (have benchmarks for this peer group).
  for (const m of deal.metrics.filter((x) => x.isPrimary)) {
    const b = findBenchmark(registry, m.metricKey, peer.profile, peer.stageBand);
    if (!b) continue;
    const status = metricStatus(m.verification, m.calculationMethod, m.state);
    const flagged = m.qualityFlags.filter((f) => !f.startsWith("NO_AS_OF_DATE") && !f.startsWith("TIME_UNIT")).length;
    items.push(item("METRIC", `metric:${m.metricKey}`, metricDef(m.metricKey)?.shortName ?? m.label, [m.id], 0.45 + Math.min(0.2, flagged * 0.07), status, [`Benchmarked for ${peer.name}`, ...(flagged ? [`${flagged} quality flag(s)`] : [])]));
  }

  // 3. Material claims, weighted by how unusual they are.
  for (const c of deal.claims.filter((x) => x.material)) {
    const status: FocusItem["status"] = c.verification === "VERIFIED" ? "VERIFIED" : c.verification === "PARTIALLY_VERIFIED" ? "PARTIALLY_VERIFIED" : c.verification === "CONTRADICTED" ? "CONTRADICTED" : "COMPANY_REPORTED";
    items.push(item("CLAIM", `claim:${c.id}`, c.statement, [c.id], 0.3 + 0.1 * Math.min(5, Math.max(1, c.unusualness ?? 1)), status, [`Material claim, unusualness ${c.unusualness ?? 1}/5`, c.verificationMethod]));
  }

  // 4. Open information gaps: importance × stated uncertainty.
  for (const g of deal.informationGaps.filter((x) => x.status !== "RESOLVED")) {
    items.push(item("GAP", `gap:${g.id}`, g.question, [g.id], g.decisionImportance / 5, "UNKNOWN", [g.whyItMatters], g.uncertainty / 5));
  }

  // 5. Risks: thesis killers and high-severity risks.
  for (const [i, r] of deal.risks.entries()) {
    const sev = { LOW: 0.3, MODERATE: 0.5, HIGH: 0.8, CRITICAL: 0.9 }[r.severity] ?? 0.5;
    const impact = r.weaknessClass === "THESIS_KILLING" ? 1 : r.weaknessClass === "STRUCTURAL" ? Math.max(sev, 0.7) : sev * 0.8;
    const lik = { LOW: 0.3, MODERATE: 0.55, HIGH: 0.8, CRITICAL: 0.95 }[r.likelihood] ?? 0.5;
    items.push(item("RISK", `risk:${i}`, r.title, r.claimRefs, impact, "UNKNOWN", [`${r.category} · ${r.severity} severity · ${r.weaknessClass.toLowerCase().replace("_", "-")}`], lik));
  }

  // 6. Fund gates: binary for the fund regardless of company quality.
  for (const g of ctx.gates ?? []) {
    if (g.result === "PASS") continue;
    const it = item("GATE", `gate:${g.id}`, `Fund mandate — ${g.label}`, [], g.result === "FAIL" ? 1 : 0.6, g.result === "FAIL" ? "VERIFIED" : "UNKNOWN", [g.detail], g.result === "FAIL" ? 0.15 : 0.8);
    // A failed mandate gate is binding: while it holds, the fund cannot invest, whatever else is true.
    if (g.result === "FAIL") {
      it.leverage = 100;
      it.why.unshift("Binding: the fund cannot invest while this holds");
    }
    items.push(it);
  }

  // Collapse items about the same variable (same key), keeping the strongest and merging reasons.
  const byKey = new Map<string, FocusItem>();
  for (const it of items) {
    const prev = byKey.get(it.key);
    if (!prev) byKey.set(it.key, it);
    else {
      const [hi, lo] = prev.leverage >= it.leverage ? [prev, it] : [it, prev];
      byKey.set(it.key, { ...hi, refs: [...new Set([...hi.refs, ...lo.refs])], why: [...new Set([...hi.why, ...lo.why])] });
    }
  }
  // Near-duplicate labels (a gap and a risk about the same thing) collapse too.
  const ranked: FocusItem[] = [];
  for (const it of [...byKey.values()].sort((a, b) => b.leverage - a.leverage || a.key.localeCompare(b.key))) {
    const dup = ranked.find((r) => overlap(r.label, it.label) >= 0.6);
    if (dup) {
      dup.refs = [...new Set([...dup.refs, ...it.refs])];
      dup.why = [...new Set([...dup.why, ...it.why])];
    } else ranked.push({ ...it });
  }
  const determinants = ranked.slice(0, 5);

  // Outlier candidates: top of a benchmark curve, or an exceptional strength rated on evidence — never manufactured.
  const outliers: (OutlierCandidate & { score: number })[] = [];
  for (const m of deal.metrics.filter((x) => x.isPrimary && x.state === "OBSERVED" && x.normalizedValue !== null)) {
    const b = findBenchmark(registry, m.metricKey, peer.profile, peer.stageBand);
    if (!b?.curve) continue;
    const score = interpolate(b.curve, m.normalizedValue!);
    if (score < 90) continue;
    const status = metricStatus(m.verification, m.calculationMethod, m.state);
    outliers.push({
      label: `${metricDef(m.metricKey)?.shortName ?? m.label} ${m.rawValue}`,
      basis: `Top of the ${b.type.toLowerCase().replace(/_/g, " ")} curve for ${peer.name} (score ${score.toFixed(0)}/100 — a curve position, not a percentile)`,
      status,
      refs: [m.id],
      score: score - (status === "COMPANY_REPORTED" ? 5 : 0),
    });
  }
  for (const s of deal.exceptionalStrengths.filter((x) => x.rating === "EXCEPTIONAL")) {
    outliers.push({ label: s.claim, basis: `Exceptional strength rated on evidence: ${s.evidence}`, status: "COMPANY_REPORTED", refs: s.claimRefs, score: 95 });
  }
  const outlierCandidates = outliers
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ score: _s, ...o }) => o);

  // Reversing question: the open question most tied to the top determinant.
  let reversingQuestion: DecisionFocus["reversingQuestion"] = null;
  const top = determinants[0];
  if (top) {
    const open = deal.questions.filter((q) => q.status !== "RESOLVED");
    const scored = open
      .map((q) => ({ q, s: Math.max(...determinants.slice(0, 3).map((d, i) => overlap(`${q.question} ${q.whyItMatters}`, `${d.label} ${d.why.join(" ")}`) * (1 - i * 0.2))) + (q.tier === "MUST_ASK" ? 0.15 : 0) + (q.affects.includes("RECOMMENDATION") ? 0.1 : 0) }))
      .sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.25) reversingQuestion = { question: scored[0].q.question, id: scored[0].q.id, linkedTo: top.label, source: "QUESTIONS" };
    else if (deal.decisionCore?.reversingQuestion) reversingQuestion = { question: deal.decisionCore.reversingQuestion.question, id: null, linkedTo: null, source: "MODEL" };
  }

  // Agreement with the model's own five determinants.
  let modelAgreement: DecisionFocus["modelAgreement"] = null;
  if (deal.decisionCore?.determinants.length) {
    const model = deal.decisionCore.determinants;
    const matches = (d: FocusItem, m: (typeof model)[number]) => m.refs.some((r) => d.refs.includes(r)) || overlap(d.label, m.fact) >= 0.34;
    modelAgreement = {
      agreed: determinants.filter((d) => model.some((m) => matches(d, m))).map((d) => d.label),
      codeOnly: determinants.filter((d) => !model.some((m) => matches(d, m))).map((d) => d.label),
      modelOnly: model.filter((m) => !determinants.some((d) => matches(d, m))).map((m) => m.fact),
    };
  }

  const considered = items.length;
  const headline = determinants.length
    ? `Of ${considered} items in the record, ${determinants.length} carry most of the decision: ${determinants
        .slice(0, 3)
        .map((d) => d.label)
        .join("; ")}${determinants.length > 3 ? "…" : ""}.`
    : "Not enough structured information to rank what decides this investment.";

  return { version: FOCUS_VERSION, rule: FOCUS_RULE, considered, determinants, ranked: ranked.slice(0, 20), outlierCandidates, reversingQuestion, modelAgreement, headline };
}
