/**
 * Deck forensics. The answer key is the deterministic integrity report
 * (metric rules, implied metrics, cross-slide checks, contradictions,
 * expected evidence) mapped onto training categories; statements with no
 * finding are the decoys.
 */
import type { IntegrityFinding } from "@/engine/integrity";
import type { TrainingCase } from "./case";
import { caseLine, emptyKey, makeExercise } from "./exercise";
import { seededShuffle } from "./format";
import { forensicCategory } from "./forensic-map";
import { FORENSIC_LABEL } from "./labels";
import { aiSummary, claimLink, expertFocus, links, metricLink } from "./reveal";
import { FORENSIC_CATEGORIES, type CasePattern, type Concept, type DeckFact, type Exercise, type ForensicCategory } from "./types";

const SEV: Record<string, number> = { LOW: 1, MODERATE: 2, HIGH: 3, CRITICAL: 4 };

const CATEGORY_CONCEPT: Record<ForensicCategory, Concept> = {
  MISLEADING_METRIC: "METRIC_DEFINITION",
  OMISSION: "MISSING_EVIDENCE",
  CONTRADICTION: "INTERNAL_CONSISTENCY",
  INFLATED_TAM: "MARKET_SIZE_INFLATION",
  PILOTS_AS_CUSTOMERS: "CUSTOMER_QUALITY",
  FORECAST_AS_ACTUAL: "FORECAST_VS_ACTUAL",
};
export const categoryConcept = (c: ForensicCategory) => CATEGORY_CONCEPT[c];

/**
 * Not detectable from the deck alone: contradictions by independent research, source quality, security.
 * Deck forensics trains on what a careful reader of the deck itself can see.
 */
const EXCLUDED = new Set(["EXPECTED_EVIDENCE_MISSING", "CLAIM_CONTRADICTED", "VERIFICATION_RESTS_ON_WEAK_SOURCE", "CITATION_UNVERIFIED", "INSTRUCTION_TEXT_IN_MATERIALS"]);

export interface FlaggedStatement {
  fact: DeckFact;
  categories: ForensicCategory[];
  findings: IntegrityFinding[];
}

/** Locate the deck fact a finding is about (metric, claim, TAM, runway claim). */
function factForFinding(c: TrainingCase, f: IntegrityFinding): DeckFact | null {
  const byId = new Map(c.facts.map((x) => [x.id, x]));
  if (f.kind.includes("TAM") && byId.has("F-TAM")) return byId.get("F-TAM")!;
  if (f.kind.includes("SOM") && byId.has("F-SOM")) return byId.get("F-SOM")!;
  for (const id of f.metricIds) {
    const fact = byId.get(`F-${id}`);
    if (fact) return fact;
  }
  for (const id of f.claimIds) {
    const fact = byId.get(`F-${id}`);
    if (fact) return fact;
  }
  if (f.kind.includes("TAM")) return byId.get("F-TAM") ?? null;
  if (f.kind.includes("SOM")) return byId.get("F-SOM") ?? null;
  if (f.kind.includes("RUNWAY")) return byId.get("F-RUNWAY-CLAIM") ?? c.facts.find((x) => x.ref?.kind === "metric" && c.deal.metrics.find((m) => m.id === x.ref!.id)?.metricKey === "runway_months") ?? null;
  return null;
}

export function flaggedStatements(c: TrainingCase): FlaggedStatement[] {
  const out = new Map<string, FlaggedStatement>();
  for (const f of c.derived.integrity?.findings ?? []) {
    if ((SEV[f.severity] ?? 0) < SEV.MODERATE! || EXCLUDED.has(f.kind)) continue;
    const cat = forensicCategory(f);
    if (!cat) continue;
    const fact = factForFinding(c, f);
    if (!fact) continue;
    const cur = out.get(fact.id) ?? { fact, categories: [], findings: [] };
    if (!cur.categories.includes(cat)) cur.categories.push(cat);
    cur.findings.push(f);
    out.set(fact.id, cur);
  }
  return [...out.values()].sort((a, b) => Math.max(...b.findings.map((x) => SEV[x.severity] ?? 0)) - Math.max(...a.findings.map((x) => SEV[x.severity] ?? 0)) || (a.fact.id < b.fact.id ? -1 : 1));
}

/** Facts no finding touches (any severity), usable as decoys. */
function cleanFacts(c: TrainingCase): DeckFact[] {
  const touched = new Set<string>();
  for (const f of c.derived.integrity?.findings ?? []) {
    for (const id of [...f.metricIds, ...f.claimIds]) touched.add(`F-${id}`);
    if (f.kind.includes("TAM")) touched.add("F-TAM");
    if (f.kind.includes("RUNWAY")) touched.add("F-RUNWAY-CLAIM");
  }
  const flaggedMetrics = new Set(c.deal.metrics.filter((m) => m.qualityFlags.length > 0).map((m) => `F-${m.id}`));
  const contradicted = new Set(c.deal.claims.filter((x) => x.verification === "CONTRADICTED" || x.contradictions.length > 0).map((x) => `F-${x.id}`));
  return c.facts.filter((f) => f.ref && !touched.has(f.id) && !flaggedMetrics.has(f.id) && !contradicted.has(f.id));
}

export function statementsExercise(c: TrainingCase): Exercise | null {
  const flagged = flaggedStatements(c).slice(0, 5);
  if (flagged.length < 2) return null;
  const decoys = seededShuffle(cleanFacts(c), `${c.ref.versionId}:decoys`).slice(0, Math.max(3, 8 - flagged.length));
  if (decoys.length < 2) return null;
  const all = seededShuffle([...flagged.map((x) => x.fact), ...decoys], `${c.ref.versionId}:statements`);
  const statements = all.map((f, i) => ({ id: `S${i + 1}`, text: `${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ""}${f.page ? ` — p. ${f.page}` : ""}` }));
  const sid = (factId: string) => statements[all.findIndex((x) => x.id === factId)]!.id;
  const key = emptyKey();
  key.flagged = {};
  for (const x of flagged) key.flagged[sid(x.fact.id)] = x.categories;
  for (const x of flagged)
    key.optionNotes[sid(x.fact.id)] = `${x.categories.map((k) => FORENSIC_LABEL[k]).join(" / ")} — ${x.findings.map((f) => `${f.title} (${f.severity.toLowerCase()}): ${f.detail}`).join(" ")}`.slice(0, 700);
  for (const f of decoys) key.optionNotes[sid(f.id)] = "No integrity finding: nothing in the deck contradicts or undermines this statement.";
  key.answer = `${flagged.length} of ${statements.length} statements are problematic: ${flagged.map((x) => `${sid(x.fact.id)} (${x.categories.map((k) => FORENSIC_LABEL[k].toLowerCase()).join(", ")})`).join("; ")}.`;
  key.workedSolution = [
    "The integrity engine re-derives every number it can from the deck's own inputs, checks definitions and populations, compares slides and sources, and flags presentation choices.",
    ...flagged.map((x) => `${sid(x.fact.id)} — ${key.optionNotes[sid(x.fact.id)]}`),
  ];
  key.alternativeReasoning = ["A flag is not an accusation: an undefined metric or an aggressive TAM is a question to ask, not proof of bad faith."];
  if (c.derived.integrity?.summary?.headline) key.aiAnalysis.push(`Integrity headline: ${c.derived.integrity.summary.headline}`);
  const inflation = c.derived.latent?.narrativeInflation;
  if (inflation && inflation.why.length) key.aiAnalysis.push(`Narrative inflation (${inflation.level.toLowerCase()}): ${inflation.why.slice(0, 3).join(" ")}`);
  key.aiAnalysis.push(...aiSummary(c).slice(0, 2));
  key.expertFocus = expertFocus(c);
  key.evidence = links(
    ...flagged.flatMap((x) => [...x.findings.flatMap((f) => f.claimIds.map((id) => claimLink(c, id))), ...x.findings.flatMap((f) => f.metricIds.map((id) => metricLink(c, id)))]),
    { label: "Integrity findings", href: `/deals/${c.ref.slug}/evidence` },
  );
  key.concepts = [...new Set(flagged.flatMap((x) => x.categories.map(categoryConcept)))];
  const patterns: CasePattern[] = c.patterns.filter((p) => ["INFLATED_TAM", "PILOTS_AS_CUSTOMERS", "FORECAST_AS_ACTUAL"].includes(p.pattern)).map((p) => p.pattern);
  const subtle = flagged.filter((x) => x.findings.every((f) => (SEV[f.severity] ?? 0) <= SEV.MODERATE!)).length;
  return makeExercise({
    c,
    kind: "FORENSICS_STATEMENTS",
    variant: "statements",
    skills: ["DECK_FORENSICS", c.domainSkill],
    level: 3 + (subtle >= 2 ? 1 : 0),
    patterns,
    title: "Deck forensics: what is misleading here?",
    prompt: `${caseLine(c)}\n\nThese statements are taken from the deck. Flag every one that is misleading, undefined, contradicted, inflated or presents forecasts, pilots or logos as something they are not — and say which. Leave the sound ones unflagged.`,
    context: [],
    input: { type: "statements", statements, categories: FORENSIC_CATEGORIES.map((id) => ({ id, label: FORENSIC_LABEL[id] })) },
    key,
  });
}

export function omissionsExercise(c: TrainingCase): Exercise | null {
  const items = c.derived.integrity?.expectedEvidence?.items ?? [];
  const missing = items.filter((i) => i.level === "EXPECTED" && i.presence !== "PRESENT");
  const present = items.filter((i) => i.level === "EXPECTED" && i.presence === "PRESENT");
  const absent = (c.derived.latent?.metricSelection?.absentDecisionMetrics ?? []).filter((m) => !items.some((i) => i.label.toLowerCase() === m.toLowerCase()));
  if (missing.length + absent.length < 2 || present.length < 2) return null;
  const pool = [
    ...missing.map((i) => ({ id: i.itemId, label: i.label, missing: true, note: `${i.presence === "WITHHELD" ? "Withheld" : "Missing"}${i.severity ? ` (${i.severity.toLowerCase()})` : ""}${i.perfectSlide ? ` — ideal slide: ${i.perfectSlide}` : ""}` })),
    ...absent.slice(0, 2).map((m, k) => ({ id: `ABS-${k}`, label: m, missing: true, note: "Decision metric for this business model that the deck does not show (latent metric-selection analysis)." })),
    ...seededShuffle(present, `${c.ref.versionId}:present-om`).slice(0, 4).map((i) => ({ id: i.itemId, label: i.label, missing: false, note: `Present on the deck (${i.refs.join(", ") || "shown"}).` })),
  ].slice(0, 8);
  const order = seededShuffle(pool, `${c.ref.versionId}:omissions`);
  const options = order.map((x, i) => ({ id: `O${i + 1}`, text: x.label }));
  const key = emptyKey();
  key.correctOptionIds = order.map((x, i) => (x.missing ? options[i]!.id : null)).filter((x): x is string => !!x);
  order.forEach((x, i) => (key.optionNotes[options[i]!.id] = x.note));
  key.answer = `Missing: ${order.filter((x) => x.missing).map((x) => x.label).join(", ")}.`;
  key.workedSolution = ["Stage-specific expected evidence (integrity engine) lists what a comparable deck at this stage and business model should show; compare it with what this deck actually shows.", ...order.map((x, i) => `${options[i]!.id} ${x.label}: ${x.note}`)];
  key.aiAnalysis = [...(c.derived.latent?.summary?.materialOmissions ?? []).slice(0, 3), ...aiSummary(c).slice(0, 2)];
  key.expertFocus = expertFocus(c, ["What a deck leaves out is information: the founder chose what to show."]);
  key.concepts = ["MISSING_EVIDENCE"];
  key.evidence = [{ label: "Expected evidence", href: `/deals/${c.ref.slug}/evidence` }];
  return makeExercise({
    c,
    kind: "FORENSICS_OMISSIONS",
    variant: "omissions",
    skills: ["DECK_FORENSICS", c.domainSkill],
    level: 3,
    title: "What does the deck leave out?",
    prompt: `${caseLine(c)}\n\nBelow is everything the deck shows. Which of the listed items would you expect from a company at this stage and business model that the deck does NOT provide? Select all that apply.`,
    context: c.facts.filter((f) => f.group !== "Claims").slice(0, 24),
    input: { type: "multi", options, minPicks: 1, maxPicks: options.length },
    key,
  });
}
