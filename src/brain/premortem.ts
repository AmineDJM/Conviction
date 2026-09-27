/**
 * IC pre-mortem context — "why could this deal die at the fund, who will
 * challenge it, and on which variable?"
 *
 * Deterministic: the deal's fragile variables come from the canonical record
 * and the deterministic layer; the people come ONLY from documented
 * preferences and recorded observations. A member with nothing recorded is
 * reported as such — the model is never given room to invent their view.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";

export interface PremortemMember {
  id: string;
  name: string;
  role: string;
  focus: string[];
  documentedPreferences: string | null;
  observations: { kind: string; statement: string; topic: string | null; provenance: string; observedAt: string; companyId: string | null }[];
}

export interface FragileVariable {
  variable: string;
  why: string;
  source: string; // where in the record it comes from
}

export interface PremortemMatch {
  memberId: string;
  memberName: string;
  variable: string;
  basis: "DOCUMENTED" | "OBSERVED";
  evidence: string;
  overlap: string[];
}

export const PREMORTEM_QUESTION = /(mourir|meurt|tuer|tue\b|kill|die|dies|pre-?mortem|pr[ée]-?mortem|challeng|objection|push ?back|bloqu|block|qui va|who will|sur quelle variable|which variable|ic\b|comit[ée])/i;

const STOP = new Set(
  "the and for with that this from into over under than then they them their what when where which while would could should about after before being between both each more most other some such only very also into your our are was were has have had not but can may will just like per via les des une pour avec dans sur par pas plus que qui est son ses aux du de la le et en ou au".split(" "),
);

function terms(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9→ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP.has(w)),
  );
}

/** Topic synonyms so "unit economics" meets "CAC payback", "burn", "gross margin"… */
const TOPICS: [string, RegExp][] = [
  ["unit economics", /unit economics|cac|payback|ltv|gross margin|marge|contribution|burn multiple/i],
  ["retention", /retention|r[ée]tention|churn|nrr|grr|cohort/i],
  ["go-to-market", /go-to-market|gtm|sales|vente|founder-led|pipeline|cycle|channel|distribution/i],
  ["market size", /market|march[ée]|tam|sam|value capture/i],
  ["competition", /compet|concurren|incumbent|moat|bundle|commoditi/i],
  ["valuation", /valuation|valo|price|prix|entry|dilution|ownership|moic|return/i],
  ["team", /founder|fondateur|team|[ée]quipe|cto|ceo|hiring|recrut/i],
  ["technology", /technolog|ai\b|ia\b|model|inference|infra|defensib/i],
  ["financing", /financing|runway|burn|next round|tour suivant|bridge|capital/i],
];

function topicsOf(s: string) {
  return TOPICS.filter(([, re]) => re.test(s)).map(([t]) => t);
}

export function fragileVariables(deal: CanonicalDeal, derived: DerivedAnalysis | null): FragileVariable[] {
  const out: FragileVariable[] = [];
  if (deal.decisionCore?.compression.breakingPoint) out.push({ variable: deal.decisionCore.compression.breakingPoint, why: "Breaking point of the bet", source: "Decision core" });
  if (deal.decisionCore?.reversingQuestion) out.push({ variable: deal.decisionCore.reversingQuestion.question, why: `If favorable: ${deal.decisionCore.reversingQuestion.ifFavorable}. If unfavorable: ${deal.decisionCore.reversingQuestion.ifUnfavorable}`, source: "Reversing question" });
  for (const d of deal.sensitivityDrivers.slice(0, 5)) out.push({ variable: d.variable, why: `Now ${d.currentAssumption}; thesis breaks at ${d.breaksAt}. ${d.why}`, source: "Sensitivity driver" });
  for (const r of deal.risks.filter((x) => x.weaknessClass === "THESIS_KILLING" || x.severity === "CRITICAL" || x.severity === "HIGH").slice(0, 6))
    out.push({ variable: r.title, why: `${r.category} risk (${r.severity}, ${r.weaknessClass}): ${r.description}`, source: r.weaknessClass === "THESIS_KILLING" ? "Thesis killer" : "High risk" });
  for (const g of derived?.fundFit.gates.filter((x) => x.result !== "PASS") ?? []) out.push({ variable: g.label, why: `Fund gate ${g.result}: ${g.detail}`, source: "Fund mandate" });
  for (const q of deal.questions.filter((x) => x.tier === "MUST_ASK" && x.status === "OPEN").slice(0, 3)) out.push({ variable: q.question, why: `Open MUST_ASK question (${q.id})`, source: "Founder questions" });
  return out;
}

/** Deterministic overlap between a member's recorded focus/preferences/observations and the deal's fragile variables. */
export function matchMembers(members: PremortemMember[], variables: FragileVariable[], companyId: string | null): PremortemMatch[] {
  const matches: PremortemMatch[] = [];
  for (const m of members) {
    const sources: { basis: "DOCUMENTED" | "OBSERVED"; text: string }[] = [];
    if (m.documentedPreferences || m.focus.length) sources.push({ basis: "DOCUMENTED", text: `${m.focus.join(", ")}. ${m.documentedPreferences ?? ""}` });
    for (const o of m.observations.filter((x) => x.provenance === "OBSERVED")) sources.push({ basis: "OBSERVED", text: `${o.topic ?? ""} ${o.statement}${o.companyId === companyId ? " (on this company)" : ""}` });
    for (const v of variables) {
      const vt = `${v.variable} ${v.why}`;
      const vTopics = topicsOf(vt);
      const vTerms = terms(vt);
      for (const src of sources) {
        const shared = [...new Set([...topicsOf(src.text).filter((t) => vTopics.includes(t)), ...[...terms(src.text)].filter((w) => vTerms.has(w) && w.length > 5)])];
        if (!shared.length) continue;
        matches.push({ memberId: m.id, memberName: m.name, variable: v.variable, basis: src.basis, evidence: src.text.slice(0, 240), overlap: shared.slice(0, 5) });
        break;
      }
    }
  }
  // Observed behaviour outranks documented preference; more overlap first.
  return matches.sort((a, b) => (a.basis === b.basis ? b.overlap.length - a.overlap.length : a.basis === "OBSERVED" ? -1 : 1));
}

export function premortemText(companyName: string, variables: FragileVariable[], members: PremortemMember[], matches: PremortemMatch[], companyId: string | null): string {
  const lines: string[] = [];
  lines.push(`IC PRE-MORTEM INPUTS for ${companyName}. Deterministic: variables come from the deal record; people come only from documented preferences (DOCUMENTED) and recorded meeting observations (OBSERVED). Topic overlap is a heuristic pointer, not a prediction of anyone's view.`);
  lines.push(`\nFRAGILE VARIABLES (${variables.length}):`);
  variables.forEach((v, i) => lines.push(`${i + 1}. [${v.source}] ${v.variable} — ${v.why}`));
  lines.push(`\nIC MEMBERS (${members.length}):`);
  if (!members.length) lines.push("No IC members recorded. Say that no member profile exists; do not name or characterise anyone.");
  for (const m of members) {
    const own = m.observations.filter((o) => o.companyId === companyId);
    const observed = m.observations.filter((o) => o.provenance === "OBSERVED");
    const inferred = m.observations.filter((o) => o.provenance === "INFERRED");
    const hasRecord = !!m.documentedPreferences || m.focus.length > 0 || m.observations.length > 0;
    lines.push(
      `- ${m.name} (${m.role}) — documented focus: ${m.focus.join(", ") || "none"}; documented preferences: ${m.documentedPreferences ?? "none"}; ${observed.length} observed statement(s), ${inferred.length} inferred pattern(s)${own.length ? `, ${own.length} on this company` : ""}.${hasRecord ? "" : " NOTHING RECORDED — do not attribute any view to this person."}`,
    );
    for (const o of own.slice(0, 4)) lines.push(`    on this company ${o.observedAt.slice(0, 10)} [${o.provenance}] ${o.kind}: ${o.statement}`);
  }
  lines.push(`\nOVERLAPS (member ↔ fragile variable):`);
  if (!matches.length) lines.push("None found. State that no recorded preference or observation points at a specific variable; do not invent one.");
  for (const x of matches.slice(0, 10)) lines.push(`- ${x.memberName} ↔ "${x.variable}" [${x.basis}] via ${x.overlap.join(", ")} — record: ${x.evidence}`);
  return lines.join("\n");
}
