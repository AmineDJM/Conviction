/**
 * Reveal material shared by every generator: what the AI analysis concluded,
 * what an experienced investor would focus on, and evidence links into the
 * deal. Read only after the answer is stored.
 */
import { DECISION_LABEL } from "@/lib/format";
import { PATTERN_LABEL } from "./labels";
import { dealHref, type TrainingCase } from "./case";
import type { EvidenceLinkRef, KeyPoint } from "./types";
import { outlierSignals } from "./patterns";
import type { Concept } from "./types";

const HIGH = new Set(["HIGH", "CRITICAL"]);

export function aiSummary(c: TrainingCase): string[] {
  const d = c.deal;
  const out: string[] = [];
  const rec = c.derived.recommendation;
  if (rec) out.push(`Deterministic recommendation: ${DECISION_LABEL[rec.status] ?? rec.status}.`);
  if (d.aiRecommendation) out.push(`Model-suggested status: ${DECISION_LABEL[d.aiRecommendation.suggestedStatus] ?? d.aiRecommendation.suggestedStatus} — ${d.aiRecommendation.rationale}`);
  if (d.thesis?.bet) out.push(`The bet: ${d.thesis.bet}`);
  if (d.decisionCore?.compression.breakingPoint) out.push(`Breaking point: ${d.decisionCore.compression.breakingPoint}`);
  else if (d.thesis?.fatalWeakness) out.push(`Fatal weakness: ${d.thesis.fatalWeakness}`);
  return out;
}

export function expertFocus(c: TrainingCase, extra: string[] = []): string[] {
  const d = c.deal;
  const out = [...extra];
  for (const p of c.patterns.filter((x) => x.expert)) out.push(`${PATTERN_LABEL[p.pattern]}: ${p.evidence}`);
  const q = d.decisionCore?.reversingQuestion.question ?? d.thesis?.fatalQuestion ?? null;
  if (q) out.push(`The question that could reverse the decision: ${q}`);
  if (d.nextBestAction) out.push(`Next best action: ${d.nextBestAction.action}`);
  const s = d.sensitivityDrivers[0];
  if (s) out.push(`Most fragile assumption: ${s.variable} — breaks at ${s.breaksAt}.`);
  return [...new Set(out)].slice(0, 6);
}

export function claimLink(c: TrainingCase, claimId: string, label?: string): EvidenceLinkRef | null {
  const cl = c.deal.claims.find((x) => x.id === claimId);
  if (!cl) return null;
  return { label: label ?? `${cl.id} · ${cl.statement.slice(0, 110)}`, href: dealHref(c.ref.slug, { kind: "claim", id: cl.id }) };
}

export function metricLink(c: TrainingCase, metricId: string, label?: string): EvidenceLinkRef | null {
  const m = c.deal.metrics.find((x) => x.id === metricId);
  if (!m) return null;
  const href = m.claimId ? dealHref(c.ref.slug, { kind: "claim", id: m.claimId }) : dealHref(c.ref.slug, { kind: "metric", id: m.id });
  return { label: label ?? `${m.id} · ${m.label}: ${m.rawValue}`, href };
}

export function links(...xs: (EvidenceLinkRef | null | undefined)[]): EvidenceLinkRef[] {
  const seen = new Set<string>();
  const out: EvidenceLinkRef[] = [];
  for (const x of xs) if (x && !seen.has(x.href + x.label)) (seen.add(x.href + x.label), out.push(x));
  return out;
}

const RISK_CONCEPT: Record<string, Concept> = {
  TECHNICAL: "TECHNICAL_ADVANTAGE",
  PRODUCT: "PMF_EVIDENCE",
  MARKET: "MARKET_SIZE_INFLATION",
  GTM: "UNIT_ECONOMICS",
  CUSTOMER: "RETENTION_RISK",
  COMPETITION: "COMPETITION",
  REGULATORY: "MISSING_EVIDENCE",
  LEGAL_IP: "MISSING_EVIDENCE",
  FINANCING: "RUNWAY_FINANCING",
  EXECUTION: "FOUNDER_DEPENDENCE",
  KEY_PERSON: "FOUNDER_DEPENDENCE",
};

/** Concept a risk is about, refined by keywords in its title (retention, churn, capital …). */
export function riskConcept(r: { category: string; title: string; description: string }): Concept {
  const t = `${r.title} ${r.description}`.toLowerCase();
  if (/retention|churn|nrr|renewal|cohort/.test(t)) return "RETENTION_RISK";
  if (/capital[- ]intensive|capex|capital intensity/.test(t)) return "CAPITAL_INTENSITY";
  if (/runway|financing|bridge|next round/.test(t)) return "RUNWAY_FINANCING";
  if (/concentration|largest customer/.test(t)) return "CUSTOMER_CONCENTRATION";
  if (/pilot|logo|loi/.test(t)) return "CUSTOMER_QUALITY";
  if (/\btam\b|market size|addressable/.test(t)) return "MARKET_SIZE_INFLATION";
  if (/cac|payback|unit economics|margin/.test(t)) return "UNIT_ECONOMICS";
  if (/founder[- ]led|founder[- ]dependent|key person/.test(t)) return "FOUNDER_DEPENDENCE";
  if (/valuation|price|entry/.test(t)) return "ENTRY_PRICE";
  return RISK_CONCEPT[r.category] ?? "MISSING_EVIDENCE";
}

/** Key points for rubric grading: critical risks and outlier signals, with links. */
export function riskAndOutlierPoints(c: TrainingCase, maxRisks = 5): KeyPoint[] {
  const d = c.deal;
  const points: KeyPoint[] = [];
  const risks = [...d.risks].sort((a, b) => sev(b.severity) - sev(a.severity) || sev(b.likelihood) - sev(a.likelihood)).slice(0, maxRisks);
  risks.forEach((r, i) =>
    points.push({
      id: `R${i + 1}`,
      kind: "RISK",
      text: `${r.title}: ${r.description}`.slice(0, 320),
      critical: HIGH.has(r.severity),
      concept: riskConcept(r),
      href: r.claimRefs[0] ? dealHref(c.ref.slug, { kind: "claim", id: r.claimRefs[0] }) : `/deals/${c.ref.slug}/risks`,
    }),
  );
  const top = (c.derived.integrity?.findings ?? []).filter((f) => f.severity === "CRITICAL" && f.module !== "SECURITY").slice(0, 2);
  top.forEach((f, i) =>
    points.push({
      id: `I${i + 1}`,
      kind: "RISK",
      text: f.title.slice(0, 300),
      critical: true,
      concept: f.kind.includes("TAM") ? "MARKET_SIZE_INFLATION" : "INTERNAL_CONSISTENCY",
      href: f.claimIds[0] ? dealHref(c.ref.slug, { kind: "claim", id: f.claimIds[0] }) : `/deals/${c.ref.slug}/evidence`,
    }),
  );
  outlierSignals(d, { includePlausible: true })
    .slice(0, 3)
    .forEach((s, i) =>
      points.push({
        id: `O${i + 1}`,
        kind: "OUTLIER",
        text: `${s.support === "PLAUSIBLE" ? "Plausible, not demonstrated: " : ""}${s.text}`.slice(0, 320),
        critical: s.support === "EVIDENCED",
        concept: s.kind === "TECHNICAL_BREAKTHROUGH" || s.kind === "COST_CURVE_CHANGE" ? "TECHNICAL_ADVANTAGE" : s.kind === "FOUNDER_INSIGHT" ? "FOUNDER_CAPABILITY" : "OUTLIER_SIGNAL",
        href: `/deals/${c.ref.slug}`,
      }),
    );
  return points;
}

function sev(l: string): number {
  return { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 }[l] ?? 0;
}
