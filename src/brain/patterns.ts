/**
 * INFERRED fund patterns — computed, never generated.
 *
 * Patterns are derived deterministically from recorded IC observations and IC
 * decisions, with counts, shares and examples, and only above minimum sample
 * sizes. They are associations in the fund's own record, never stated
 * preferences and never predictions of what a person thinks. Anything below
 * the thresholds is not reported.
 */
import { createHash } from "node:crypto";

export const PATTERN_VERSION = "patterns_v1";
/** Minimum recorded observations before a member-level pattern is reported. */
export const MIN_MEMBER_OBSERVATIONS = 3;
/** Minimum share of a member's interventions on one topic. */
export const MIN_TOPIC_SHARE = 0.4;
/** Minimum decided deals on each side before a decision association is reported. */
export const MIN_DECIDED = 3;
/** Minimum gap (share among rejected − share among approved) for a decision association. */
export const MIN_ASSOCIATION_GAP = 0.4;

export interface PatternObservation {
  memberId: string;
  kind: string;
  topic: string | null;
  statement: string;
  provenance: string;
  observedAt: string;
  companyId: string | null;
}

export interface PatternDeal {
  companyId: string;
  name: string;
  icDecision: string; // PENDING | APPROVED | REJECTED
  /** Traits drawn from the deal's current version (risk categories rated HIGH/CRITICAL, failed gates, weak dimensions, stage, sector…). */
  traits: string[];
}

export interface FundPattern {
  key: string;
  scope: "MEMBER" | "FUND";
  memberId: string | null;
  title: string;
  body: string;
  k: number;
  n: number;
  share: number;
  examples: string[];
}

/** Topic families so "churn", "NRR" and "retention" count as one concern. */
const FAMILIES: [string, RegExp][] = [
  ["retention", /retention|r[ée]tention|churn|nrr|grr|cohort|renewal/i],
  ["unit economics", /unit econ|cac|payback|ltv|gross margin|marge|contribution|burn multiple|margin/i],
  ["valuation & price", /valuation|valo|price|prix|pricing of the round|entry|dilution|ownership|terms/i],
  ["team & founders", /founder|fondateur|team|[ée]quipe|ceo|cto|hiring|recrut|key person/i],
  ["market size", /market|march[ée]|tam|sam|som|sizing/i],
  ["competition & moat", /compet|concurren|incumbent|moat|defensib|differentiat/i],
  ["go-to-market", /go-to-market|gtm|sales|vente|channel|distribution|pipeline|cycle/i],
  ["technology & product", /technolog|product|produit|ai\b|ia\b|model|infra|technical/i],
  ["financing & runway", /financing|runway|burn|next round|tour suivant|capital|bridge|cash/i],
  ["regulation", /regulat|r[ée]glement|compliance|licen/i],
];

export function topicFamily(topic: string | null, statement = ""): string {
  const t = `${topic ?? ""} ${topic ? "" : statement}`;
  for (const [name, re] of FAMILIES) if (re.test(t)) return name;
  return (topic ?? "other").toLowerCase().trim() || "other";
}

const key = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function computePatterns(members: { id: string; name: string }[], observations: PatternObservation[], deals: PatternDeal[]): FundPattern[] {
  const out: FundPattern[] = [];
  const observed = observations.filter((o) => o.provenance === "OBSERVED");

  /* ---- member topic focus and intervention style ---- */
  for (const m of members) {
    const obs = observed.filter((o) => o.memberId === m.id);
    const n = obs.length;
    if (n < MIN_MEMBER_OBSERVATIONS) continue;
    const byTopic = new Map<string, PatternObservation[]>();
    for (const o of obs) {
      const f = topicFamily(o.topic, o.statement);
      byTopic.set(f, [...(byTopic.get(f) ?? []), o]);
    }
    for (const [topic, list] of [...byTopic.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const k = list.length;
      if (k < 2 || k / n < MIN_TOPIC_SHARE) continue;
      out.push({
        key: key("member-topic", m.id, topic),
        scope: "MEMBER",
        memberId: m.id,
        title: `${m.name} — recurring topic: ${topic}`,
        body: `${m.name} raised ${topic} in ${k} of ${n} recorded interventions (${pct(k / n)}). Examples: ${list.slice(0, 2).map((o) => `“${o.statement}” (${o.observedAt.slice(0, 10)})`).join("; ")}. INFERRED from the meeting record — an association, not a stated preference.`,
        k,
        n,
        share: k / n,
        examples: list.slice(0, 3).map((o) => o.statement),
      });
    }
    const concerns = obs.filter((o) => o.kind === "CONCERN").length;
    if (n >= 5 && concerns / n >= 0.6) {
      out.push({
        key: key("member-style", m.id),
        scope: "MEMBER",
        memberId: m.id,
        title: `${m.name} — interventions are mostly concerns`,
        body: `${concerns} of ${n} recorded interventions by ${m.name} were concerns (${pct(concerns / n)}). INFERRED from the meeting record; says nothing about their eventual vote.`,
        k: concerns,
        n,
        share: concerns / n,
        examples: obs.filter((o) => o.kind === "CONCERN").slice(0, 3).map((o) => o.statement),
      });
    }
  }

  /* ---- decision associations (fund level) ---- */
  const approved = deals.filter((d) => d.icDecision === "APPROVED");
  const rejected = deals.filter((d) => d.icDecision === "REJECTED");
  if (approved.length >= MIN_DECIDED && rejected.length >= MIN_DECIDED) {
    const traits = new Set(deals.flatMap((d) => d.traits));
    for (const t of traits) {
      const r = rejected.filter((d) => d.traits.includes(t));
      const a = approved.filter((d) => d.traits.includes(t));
      const gap = r.length / rejected.length - a.length / approved.length;
      if (r.length < 2 || gap < MIN_ASSOCIATION_GAP) continue;
      out.push({
        key: key("decision", t),
        scope: "FUND",
        memberId: null,
        title: `Rejected deals often shared: ${t}`,
        body: `${r.length} of ${rejected.length} deals the IC rejected had "${t}" (${pct(r.length / rejected.length)}), versus ${a.length} of ${approved.length} approved (${pct(a.length / approved.length)}). Examples: ${r.slice(0, 3).map((d) => d.name).join(", ")}. INFERRED association in a small sample — not a rule and not a stated policy.`,
        k: r.length,
        n: rejected.length,
        share: r.length / rejected.length,
        examples: r.slice(0, 3).map((d) => d.name),
      });
    }
  }

  /* ---- concerns raised on deals later rejected ---- */
  const rejectedIds = new Set(rejected.map((d) => d.companyId));
  const onRejected = observed.filter((o) => o.kind === "CONCERN" && o.companyId && rejectedIds.has(o.companyId));
  const dealsWithConcerns = new Set(onRejected.map((o) => o.companyId));
  if (dealsWithConcerns.size >= MIN_DECIDED) {
    const byTopic = new Map<string, Set<string>>();
    for (const o of onRejected) {
      const f = topicFamily(o.topic, o.statement);
      byTopic.set(f, new Set([...(byTopic.get(f) ?? []), o.companyId!]));
    }
    const [topic, ids] = [...byTopic.entries()].sort((a, b) => b[1].size - a[1].size)[0]!;
    if (ids.size >= 2) {
      out.push({
        key: key("rejected-concern", topic),
        scope: "FUND",
        memberId: null,
        title: `Most frequent recorded concern on rejected deals: ${topic}`,
        body: `Among ${dealsWithConcerns.size} rejected deals with recorded IC concerns, ${ids.size} had a concern about ${topic}. INFERRED from the meeting record.`,
        k: ids.size,
        n: dealsWithConcerns.size,
        share: ids.size / dealsWithConcerns.size,
        examples: deals.filter((d) => ids.has(d.companyId)).slice(0, 3).map((d) => d.name),
      });
    }
  }
  return out;
}

/** Traits used for decision associations, from a deal's current version (stable, human-readable). */
export function dealTraits(v: {
  stage: string | null;
  sectors: string[];
  highRiskCategories: string[];
  failedGates: string[];
  weakDimensions: string[];
  evidenceCategory: string | null;
}): string[] {
  return [
    ...(v.stage ? [`stage ${v.stage.toLowerCase().replace(/_/g, " ")}`] : []),
    ...v.sectors.map((x) => `sector ${x.toLowerCase().replace(/_/g, " ")}`),
    ...v.highRiskCategories.map((x) => `high ${x.toLowerCase().replace(/_/g, " ")} risk`),
    ...v.failedGates.map((x) => `fund gate not passed: ${x}`),
    ...v.weakDimensions.map((x) => `weak ${x.toLowerCase().replace(/_/g, " ")}`),
    ...(v.evidenceCategory ? [`evidence ${v.evidenceCategory.toLowerCase().replace(/_/g, " ")}`] : []),
  ];
}
