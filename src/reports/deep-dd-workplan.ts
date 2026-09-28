/**
 * DEEP DD — DILIGENCE WORK PLAN (deterministic).
 *
 *   (canonical, derived) → ordered, deduplicated workstreams of concrete requests
 *
 * No model calls and no new estimates: every candidate comes from something
 * already in the stored record (thesis-killing risks, fund gates, computed
 * sensitivity breakpoints, open information gaps, verification priority,
 * evidence debt, integrity findings, "perfect slides", open MUST_ASK
 * questions). Priority is read from stored indices (the Decision Leverage
 * Index of derived.focus, the verification / research priority indices) or,
 * when none applies, from a fixed conventional weight stated in WORKPLAN_RULES.
 * Priorities rank attention; they are never probabilities. Cost and time are
 * not computable from the record and are therefore never shown.
 */
import type { CanonicalDeal, Claim, InformationGap, Risk } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import type { FocusItem } from "@/engine/focus";
import type { SensitivityRow } from "@/engine/economics/sensitivity";
import type { IntegrityFinding } from "@/engine/integrity/types";
import { metricDef } from "@/engine/metrics/dictionary";
import { multiple, pct, usd } from "@/lib/format";
import { clip, enumLabel, stripRefs } from "./text";

/* ---------------------------------------------------------------- */
/* Types                                                              */
/* ---------------------------------------------------------------- */

export const WORKSTREAMS = [
  { id: "FINANCIAL", label: "Financial & cohort analysis" },
  { id: "CUSTOMER", label: "Customer references & PMF" },
  { id: "GTM", label: "Go-to-market repeatability" },
  { id: "TECHNICAL", label: "Technical & product" },
  { id: "MARKET", label: "Market & competition" },
  { id: "TEAM", label: "Team & founder references" },
  { id: "LEGAL", label: "Legal, cap table & terms" },
] as const;
export type WorkstreamId = (typeof WORKSTREAMS)[number]["id"];

export type Answerer = "FOUNDER" | "DATA_ROOM" | "PUBLIC" | "REFERENCES";
export const ANSWERER_LABEL: Record<Answerer, string> = { FOUNDER: "Founder", DATA_ROOM: "Data room", PUBLIC: "Public sources", REFERENCES: "References" };

export type RequestKind = "DATA_ROOM_REQUEST" | "FOUNDER_QUESTION" | "REFERENCE_CALLS" | "PUBLIC_RESEARCH" | "PERFECT_SLIDE" | "RECONCILIATION" | "THESIS_TEST" | "MANDATE_CHECK";

/** Where a candidate came from. Also the tie-break order (most binding first). */
export type DriverKind = "THESIS_KILLER" | "MANDATE_GATE" | "BREAKPOINT" | "GAP" | "CLAIM" | "EVIDENCE_DEBT" | "INTEGRITY" | "PERFECT_SLIDE" | "QUESTION";
const DRIVER_ORDER: DriverKind[] = ["THESIS_KILLER", "MANDATE_GATE", "BREAKPOINT", "GAP", "CLAIM", "EVIDENCE_DEBT", "INTEGRITY", "PERFECT_SLIDE", "QUESTION"];
export const DRIVER_LABEL: Record<DriverKind, string> = {
  THESIS_KILLER: "Thesis-killing risk",
  MANDATE_GATE: "Fund mandate gate",
  BREAKPOINT: "Sensitivity breakpoint",
  GAP: "Open information gap",
  CLAIM: "Verification priority",
  EVIDENCE_DEBT: "Evidence debt",
  INTEGRITY: "Integrity finding",
  PERFECT_SLIDE: "Missing evidence (perfect slide)",
  QUESTION: "Open MUST_ASK question",
};

export interface Driver {
  kind: DriverKind;
  /** Stable key of the source object (GAP-04, CLM-012, sens:NRR, debt:TRACTION …). */
  key: string;
  label: string;
  /** Record refs (MET/CLM/SRC/RSK/Q/GAP) and engine refs (calc:…). Never empty. */
  refs: string[];
}

export type Priority = "P1" | "P2" | "P3";

export interface WorkItem {
  /** DD-01 … in plan order. */
  id: string;
  workstream: WorkstreamId;
  priority: Priority;
  /** Priority index 0–100 (attention, not a probability) and where it was read from. */
  leverage: number;
  leverageBasis: string;
  /** True for thesis killers, failed mandate gates and breakpoints already crossed. */
  binding: boolean;
  kind: RequestKind;
  /** The concrete request (first) and any merged requests. */
  requests: string[];
  /** "Perfect slide" specification when the request is a missing-evidence slide. */
  perfectSlides: string[];
  answerers: Answerer[];
  why: string;
  unlocks: string[];
  /** Primary driver (the strongest source), plus every merged source. */
  driver: Driver;
  mergedFrom: Driver[];
  /** Computed breakpoints this item bears on. */
  breakpoints: { id: string; variable: string; status: string }[];
  refs: string[];
}

export interface KillCriterion {
  text: string;
  basis: "THESIS_KILLER" | "MANDATE_GATE" | "BREAKPOINT" | "BREAKING_POINT" | "REVERSING_QUESTION" | "FALSIFIER";
  origin: "COMPUTED" | "MODEL";
  refs: string[];
  /** Work item that tests it (null when no item covers it). */
  testedBy: string | null;
}

export interface WorkPlan {
  items: WorkItem[];
  workstreams: { id: WorkstreamId; label: string; items: WorkItem[]; p1: number }[];
  killCriteria: KillCriterion[];
  considered: number;
  merged: number;
  /** Inputs that were absent on this version (older derived, partial analysis). */
  missingInputs: string[];
  rules: string[];
}

export const WORKPLAN_RULES = [
  "Candidates: thesis-killing risks; failed or unknown fund-mandate gates; computed sensitivity breakpoints on the verify-first list or within 25% of breaking; open information gaps; the ten highest verification-priority claims; evidence-debt areas at HIGH or VERY_HIGH; integrity findings at HIGH or CRITICAL; expected-evidence and analysis “perfect slides”; open MUST_ASK questions.",
  "Priority index = the highest Decision Leverage Index (derived.focus) among the item's refs or variable; otherwise the source's stored index (verification priority, research priority); otherwise a fixed conventional weight — thesis killer 100, failed gate 100, crossed breakpoint 95, breakpoint within margin m: 55 + 45 × (1 − |m| ÷ 100), unknown gate 60, integrity CRITICAL 85 / HIGH 65, evidence debt VERY_HIGH 70 / HIGH 55, MUST_ASK question 60 (+10 when it affects the recommendation), perfect slide 40 (60 when the expected item is HIGH/CRITICAL). An attention ranking, never a probability.",
  "Duplicates merge, strongest first and without chaining: same source object; a question that cites a gap; a claim named by an integrity finding or a thesis killer; a breakpoint and a claim, gap or finding on the same metric (by id or by the metric's name); or a word overlap (set cosine) ≥ 0.5 between the subjects (never the request wording). The merged item keeps the higher priority and the union of refs, answerers, requests, perfect slides and unlocks.",
  "Tiers: P1 = binding (thesis killer, failed gate, crossed breakpoint) or index ≥ 70; P2 = index ≥ 40; P3 otherwise. Order: tier, index, source (killer, gate, breakpoint, gap, claim, debt, integrity, slide, question), key.",
  "No cost or time estimate is shown: none is computable from the record.",
];

/* ---------------------------------------------------------------- */
/* Helpers                                                            */
/* ---------------------------------------------------------------- */

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\b(?:clm|src|met|rsk|gap|q)-[a-z0-9]+\b/g, " ")
      .replace(/[^a-z0-9%$ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
export function overlap(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  // Set cosine: a long text does not "contain" a short one by accident (as overlap ÷ min would).
  return n / Math.sqrt(A.size * B.size);
}

const REF_RE = /\b(?:(?:CLM|SRC|MET)-[A-Z0-9_]+|RSK-\d{2}|Q-\d{2}|GAP-\d{2})\b/g;
/** Record refs mentioned inside a text, in order of appearance, unique. */
export function refsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.match(REF_RE) ?? [])];
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
/** Drop trailing full stops so templated sentences never end in "..". */
const noStop = (s: string) => s.replace(/[.\s]+$/, "");
const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

/** Deterministic workstream from free text; null when nothing matches. Order matters. */
const STREAM_RULES: [WorkstreamId, RegExp][] = [
  ["LEGAL", /cap[- ]?table|liquidation preference|preference stack|option[- ]pool|pro[- ]rata|term sheet|\bSAFEs?\b|convertible|board seat|IP assignment|patent|licen[cs]e|regulat|legal|litigation|ownership|capitali[sz]ation|dilution|post-money|pre-money/i],
  ["GTM", /pipeline|funnel|win rate|sales cycle|quota|\bAEs?\b|sales rep|rep-level|channel|partner|go-to-market|\bGTM\b|founder[- ]led|founder participation|sales capacity|sales motion|sales efficiency/i],
  ["CUSTOMER", /reference|named customer|logos?\b|renewal|churn reason|customer interview|customer call|pilot|lost customer|customer satisfaction/i],
  ["FINANCIAL", /\bARR\b|\bMRR\b|revenue|cohort|retention|\bNRR\b|\bGRR\b|burn|runway|margin|billing|ledger|bank|financial|\bACV\b|ARPA|bridge|\bCAC\b|payback|unit economics|cash/i],
  ["TECHNICAL", /accuracy|touchless|integration|architecture|security|SOC ?2|uptime|latency|technical|technology|product|exception rate|demo|model provider|inference|automation/i],
  ["MARKET", /market|\bTAM\b|\bSAM\b|competit|incumbent|win\/loss|pricing power|category|substitut/i],
  ["TEAM", /founder|co-?founder|\bCEO\b|\bCTO\b|hiring|\bhire\b|team|key person|management/i],
];
export function streamOf(text: string, fallback: WorkstreamId): WorkstreamId {
  for (const [id, re] of STREAM_RULES) if (re.test(text)) return id;
  return fallback;
}

const CLAIM_STREAM: Record<string, WorkstreamId> = {
  METRIC: "FINANCIAL",
  FINANCIAL: "FINANCIAL",
  CUSTOMER: "CUSTOMER",
  PRODUCT: "TECHNICAL",
  TECHNOLOGY: "TECHNICAL",
  MARKET: "MARKET",
  COMPETITION: "MARKET",
  TEAM: "TEAM",
  FUNDING: "LEGAL",
  PARTNERSHIP: "GTM",
  REGULATORY: "LEGAL",
  IP: "LEGAL",
};
const CLAIM_ANSWERERS: Record<string, Answerer[]> = {
  METRIC: ["DATA_ROOM"],
  FINANCIAL: ["DATA_ROOM"],
  CUSTOMER: ["REFERENCES", "DATA_ROOM"],
  PRODUCT: ["DATA_ROOM", "FOUNDER"],
  TECHNOLOGY: ["DATA_ROOM", "FOUNDER"],
  MARKET: ["PUBLIC"],
  COMPETITION: ["PUBLIC", "REFERENCES"],
  TEAM: ["REFERENCES", "PUBLIC"],
  FUNDING: ["DATA_ROOM"],
  PARTNERSHIP: ["REFERENCES", "DATA_ROOM"],
  REGULATORY: ["DATA_ROOM", "PUBLIC"],
  IP: ["DATA_ROOM", "PUBLIC"],
};
const CLAIM_EVIDENCE: Record<string, string> = {
  METRIC: "the source export (billing system, ledger or product analytics) that reproduces the figure",
  FINANCIAL: "management accounts and bank statements that reconcile the figure",
  CUSTOMER: "the signed contract and a reference call with the named customer",
  PRODUCT: "a live demonstration on customer data and production usage logs",
  TECHNOLOGY: "a technical session with the engineering lead and production logs",
  MARKET: "an independent market source with a stated method",
  COMPETITION: "independent competitive evidence (win/loss records, customer references on alternatives)",
  TEAM: "back-channel references on the stated role and outcome",
  FUNDING: "signed financing documents",
  PARTNERSHIP: "the partner agreement and a partner reference",
  REGULATORY: "registrations, filings and regulator correspondence",
  IP: "patent filings and IP-assignment agreements",
  OTHER: "a primary document that supports the statement",
};

const GAP_STREAM: Record<InformationGap["target"], WorkstreamId> = {
  FOUNDER: "TEAM",
  COMPANY: "FINANCIAL",
  PRODUCT: "TECHNICAL",
  CUSTOMER: "CUSTOMER",
  MARKET: "MARKET",
  COMPETITOR: "MARKET",
  REGULATORY: "LEGAL",
  FINANCING: "FINANCIAL",
};
const GAP_ANSWERERS: Record<InformationGap["researchability"], Answerer[]> = {
  PUBLIC_WEB: ["PUBLIC"],
  FOUNDER_ONLY: ["FOUNDER"],
  BOTH: ["PUBLIC", "FOUNDER"],
  DATA_ROOM: ["DATA_ROOM"],
};
const GAP_KIND: Record<InformationGap["researchability"], RequestKind> = { PUBLIC_WEB: "PUBLIC_RESEARCH", FOUNDER_ONLY: "FOUNDER_QUESTION", BOTH: "PUBLIC_RESEARCH", DATA_ROOM: "DATA_ROOM_REQUEST" };

const RISK_STREAM: Record<Risk["category"], WorkstreamId> = {
  TECHNICAL: "TECHNICAL",
  PRODUCT: "TECHNICAL",
  MARKET: "MARKET",
  GTM: "GTM",
  CUSTOMER: "CUSTOMER",
  COMPETITION: "MARKET",
  REGULATORY: "LEGAL",
  LEGAL_IP: "LEGAL",
  FINANCING: "FINANCIAL",
  EXECUTION: "TEAM",
  KEY_PERSON: "TEAM",
};
const RISK_ANSWERERS: Record<Risk["category"], Answerer[]> = {
  TECHNICAL: ["DATA_ROOM", "FOUNDER"],
  PRODUCT: ["DATA_ROOM", "REFERENCES"],
  MARKET: ["PUBLIC", "REFERENCES"],
  GTM: ["DATA_ROOM", "REFERENCES"],
  CUSTOMER: ["REFERENCES", "DATA_ROOM"],
  COMPETITION: ["PUBLIC", "REFERENCES"],
  REGULATORY: ["DATA_ROOM", "PUBLIC"],
  LEGAL_IP: ["DATA_ROOM"],
  FINANCING: ["DATA_ROOM", "FOUNDER"],
  EXECUTION: ["REFERENCES", "FOUNDER"],
  KEY_PERSON: ["REFERENCES", "FOUNDER"],
};

const DEBT_AREA: Record<string, { label: string; stream: WorkstreamId; answerers: Answerer[]; request: string }> = {
  PRODUCT_PROOF: { label: "Product proof", stream: "TECHNICAL", answerers: ["DATA_ROOM", "REFERENCES"], request: "Production usage logs, a live demo on customer data and one technical customer reference" },
  TRACTION: { label: "Traction", stream: "FINANCIAL", answerers: ["DATA_ROOM", "REFERENCES"], request: "Billing export and customer-level ARR ledger reconciled to the bank, plus the contract list" },
  MARKET: { label: "Market", stream: "MARKET", answerers: ["PUBLIC"], request: "Independent sources for market size and structure, with the stated method" },
  GTM: { label: "Go-to-market", stream: "GTM", answerers: ["DATA_ROOM"], request: "CRM export: pipeline by stage with ages, win/loss with reasons, rep-level attainment" },
  MOAT: { label: "Moat", stream: "MARKET", answerers: ["PUBLIC", "REFERENCES"], request: "Customer references on switching costs and alternatives; independent competitive evidence" },
  TEAM: { label: "Team", stream: "TEAM", answerers: ["REFERENCES", "PUBLIC"], request: "Back-channel references on each founder's stated role and outcome" },
  FINANCING: { label: "Financing", stream: "LEGAL", answerers: ["DATA_ROOM"], request: "Signed financing documents, pro-forma cap table and SAFE/note schedule" },
};

/** What to request to confirm a breakpoint variable (by metric key, then by text). */
function breakpointRequest(r: SensitivityRow): { request: string; stream: WorkstreamId; answerers: Answerer[] } {
  const k = r.metricKey ?? "";
  const text = `${r.variable} ${k}`;
  if (/exit_ownership|post_money|pre_money|dilution|ownership|entry/i.test(text))
    return { request: "Pro-forma cap table, term sheet, SAFE/note schedule and option-pool plan (inputs of the ownership path)", stream: "LEGAL", answerers: ["DATA_ROOM", "FOUNDER"] };
  if (/burn|runway|cash|milestone|months_to/i.test(text))
    return { request: "Monthly management accounts, bank statements and the post-round hiring and spend plan", stream: "FINANCIAL", answerers: ["DATA_ROOM", "FOUNDER"] };
  if (/nrr|grr|retention|churn/i.test(text)) return { request: "Revenue-cohort table (12–18 months): beginning ARR, churn, contraction, expansion, ending ARR per cohort", stream: "FINANCIAL", answerers: ["DATA_ROOM"] };
  if (/cac|payback|ltv|magic/i.test(text)) return { request: "Fully loaded sales & marketing spend by month against new-logo ARR (CAC and payback by cohort)", stream: "FINANCIAL", answerers: ["DATA_ROOM"] };
  if (/growth|arr|revenue|mrr/i.test(text)) return { request: "Monthly ARR bridge: new, expansion, contraction, churn — with the customer-level ledger", stream: "FINANCIAL", answerers: ["DATA_ROOM"] };
  if (/margin|cogs|inference|hosting/i.test(text)) return { request: "Cost-of-revenue breakdown (hosting, inference, support, implementation) by month", stream: "FINANCIAL", answerers: ["DATA_ROOM"] };
  if (/multiple|exit/i.test(text)) return { request: "Comparable transactions and public multiples for the exit scenarios (independent sources)", stream: "MARKET", answerers: ["PUBLIC"] };
  if (/sam|tam|market/i.test(text)) return { request: "Independent market sizing with the stated method", stream: "MARKET", answerers: ["PUBLIC"] };
  return { request: `Source data behind ${r.variable.toLowerCase()}`, stream: streamOf(text, "FINANCIAL"), answerers: ["DATA_ROOM"] };
}

export function sensValue(v: number | string | null, unit: SensitivityRow["unit"]): string {
  if (v === null) return "n/a";
  if (typeof v === "string") return v;
  switch (unit) {
    case "USD":
      return usd(v, 2);
    case "USD_PER_MONTH":
      return `${usd(v)}/mo`;
    case "PCT":
      return pct(v, Math.abs(v) < 10 ? 1 : 0);
    case "MONTHS":
      return `${v.toFixed(1)} mo`;
    case "MULTIPLE":
      return multiple(v, 1);
    default:
      return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
}

export function breakpointStatus(r: SensitivityRow): string {
  if (r.broken) return "already past its breakpoint";
  if (r.margin === null) return "margin not computable";
  return `${Math.abs(r.margin).toFixed(0)}% from breaking`;
}

/* ---------------------------------------------------------------- */
/* Candidates                                                         */
/* ---------------------------------------------------------------- */

interface Candidate {
  driver: Driver;
  stream: WorkstreamId;
  kind: RequestKind;
  request: string;
  perfectSlide: string | null;
  answerers: Answerer[];
  why: string;
  unlocks: string;
  /** Fallback index when focus has no rank for this candidate. */
  own: number;
  ownBasis: string;
  binding: boolean;
  /** Direct merge keys: objects this candidate is explicitly about (a gap a question cites, the claims an integrity finding names, a breakpoint's metric). */
  links: string[];
  /** Content used for the word-overlap merge (never template wording). */
  matchText: string;
  /** Label of a focus item to match by text (breakpoint variables). */
  focusLabel?: string;
  breakpoints: WorkItem["breakpoints"];
}

function focusIndex(ranked: FocusItem[]) {
  const byRef = new Map<string, FocusItem>();
  const byLabel = new Map<string, FocusItem>();
  for (const f of ranked) {
    for (const r of f.refs) if (!byRef.has(r) || byRef.get(r)!.leverage < f.leverage) byRef.set(r, f);
    byLabel.set(f.label, f);
  }
  return { byRef, byLabel };
}

export function buildWorkPlan(c: CanonicalDeal, d: DerivedAnalysis): WorkPlan {
  const integ = d.integrity ?? null;
  const econ = d.economics ?? null;
  const focus = d.focus ?? null;
  const missingInputs: string[] = [];
  if (!focus) missingInputs.push("decision focus (priority falls back to stored source indices)");
  if (!econ) missingInputs.push("economics report (no sensitivity breakpoints)");
  if (!integ) missingInputs.push("integrity report (no verification priority, evidence debt or integrity findings)");

  const rec = d.recommendation;
  const gateBlocked = (g: string) => rec?.trace?.some((t) => t.gate === g && t.outcome === "BLOCK") ?? false;
  const cands: Candidate[] = [];
  const claimById = new Map(c.claims.map((x) => [x.id, x]));
  // Only refs that exist in this version (or engine refs) are ever emitted, so every chip resolves.
  const ids = new Set<string>([...c.claims.map((x) => x.id), ...c.sources.map((x) => x.id), ...c.metrics.map((x) => x.id), ...c.risks.map((x) => x.id), ...c.questions.map((x) => x.id), ...c.informationGaps.map((x) => x.id)]);
  const keep = (refs: string[], fallback: string) => {
    const k = uniq(refs.filter((r) => r.startsWith("calc:") || ids.has(r)));
    return k.length ? k : [fallback];
  };
  const primaryMetric = (key: string | null) => (key ? c.metrics.find((m) => m.metricKey === key && m.isPrimary) : undefined);

  /* 1. Thesis killers */
  const killers = d.risk?.thesisKillers ?? [];
  for (const r of killers) {
    cands.push({
      driver: { kind: "THESIS_KILLER", key: r.id, label: r.title, refs: uniq([r.id, ...r.claimRefs]) },
      stream: RISK_STREAM[r.category] ?? "FINANCIAL",
      kind: "THESIS_TEST",
      request: `Test the thesis-killing risk ${r.id} — ${noStop(r.title)}.${r.mitigation ? ` How to test it: ${stripRefs(r.mitigation)}` : ""}`,
      perfectSlide: null,
      answerers: RISK_ANSWERERS[r.category] ?? ["DATA_ROOM"],
      why: clip(stripRefs(r.description), 260),
      unlocks: "Continue or stop: a thesis-killing risk (THESIS_KILLER gate)",
      own: 100,
      ownBasis: "thesis killer (binding)",
      binding: true,
      links: [...r.claimRefs],
      matchText: r.title,
      breakpoints: [],
    });
  }

  /* 2. Mandate gates */
  for (const g of d.fundFit?.gates ?? []) {
    if (g.result === "PASS") continue;
    const fail = g.result === "FAIL";
    cands.push({
      driver: { kind: "MANDATE_GATE", key: `gate:${g.id}`, label: `Fund mandate — ${g.label}`, refs: ["calc:scores"] },
      stream: /stage|check|valuation|ownership/i.test(g.label) ? "LEGAL" : "TEAM",
      kind: "MANDATE_CHECK",
      request: `${fail ? "Mandate gate failed" : "Complete the mandate check"}: ${g.label} — ${g.detail}`,
      perfectSlide: null,
      answerers: ["FOUNDER", "PUBLIC"],
      why: fail ? "A failed mandate gate is binding: the fund cannot invest while it holds, whatever else is true." : "An unknown mandate gate leaves the fund-fit check incomplete.",
      unlocks: fail ? "Whether the fund can invest at all (binding MANDATE gate)" : "Completes the MANDATE gate",
      own: fail ? 100 : 60,
      ownBasis: fail ? "failed mandate gate (binding)" : "unknown mandate gate",
      binding: fail,
      links: [],
      matchText: g.label,
      breakpoints: [],
    });
  }

  /* 3. Sensitivity breakpoints */
  const sensRows = econ?.sensitivity?.rows ?? [];
  const verifyFirst = new Set(econ?.sensitivity?.verifyFirst ?? []);
  const isVerifyFirst = (r: SensitivityRow) => [...verifyFirst].some((v) => v.startsWith(r.variable));
  for (const r of sensRows) {
    const near = r.broken === true || (r.margin !== null && Math.abs(r.margin) <= 25);
    if (!near && !isVerifyFirst(r)) continue;
    const m = primaryMetric(r.metricKey);
    const spec = breakpointRequest(r);
    const own = r.broken ? 95 : r.margin !== null ? round1(55 + 45 * (1 - Math.min(1, Math.abs(r.margin) / 100))) : 55;
    const bp = { id: r.id, variable: r.variable, status: breakpointStatus(r) };
    cands.push({
      driver: { kind: "BREAKPOINT", key: `sens:${r.id}`, label: r.variable, refs: uniq([...(m ? [m.id] : []), "calc:economics"]) },
      stream: spec.stream,
      kind: "DATA_ROOM_REQUEST",
      request: `Confirm ${r.variable.charAt(0).toLowerCase()}${r.variable.slice(1)} — now ${sensValue(r.current, r.unit)}, ${r.breaksAt === null ? "no value in the searched range clears it" : `breaks at ${sensValue(r.breaksAt, r.unit)}`} (${breakpointStatus(r)}). Request: ${spec.request}.`,
      perfectSlide: null,
      answerers: spec.answerers,
      why: clip(r.why, 260),
      unlocks: /ownership|post-money|dilution|entry/i.test(r.variable)
        ? "Price and structure: whether the entry terms can return the fund"
        : /burn|milestone|runway|cash/i.test(r.variable)
          ? "Financing risk: whether cash lasts to the next round"
          : "Whether the operating case behind the returns holds",
      own,
      ownBasis: r.broken ? "breakpoint already crossed" : r.margin !== null ? `breakpoint margin ${Math.abs(r.margin).toFixed(0)}%` : "breakpoint (margin not computable)",
      binding: r.broken === true,
      links: m ? [m.id] : [],
      matchText: `${r.variable} ${spec.request}`,
      focusLabel: r.variable,
      breakpoints: [bp],
    });
  }

  /* 4. Open information gaps */
  const rp = new Map((d.researchPriority ?? []).map((g) => [g.gapId, g.index]));
  for (const g of c.informationGaps.filter((x) => x.status === "OPEN" || x.status === "NEEDS_FOUNDER")) {
    const fallback = GAP_STREAM[g.target] ?? "FINANCIAL";
    const stream = g.target === "FINANCING" || g.target === "COMPANY" ? streamOf(g.question, fallback) : fallback;
    const idx = rp.get(g.id);
    cands.push({
      driver: { kind: "GAP", key: g.id, label: g.question, refs: [g.id] },
      stream,
      kind: GAP_KIND[g.researchability] ?? "DATA_ROOM_REQUEST",
      request: `${g.question}${g.suggestedQueries.length && g.researchability !== "DATA_ROOM" && g.researchability !== "FOUNDER_ONLY" ? ` (searches: ${g.suggestedQueries.slice(0, 2).join("; ")})` : ""}`,
      perfectSlide: null,
      answerers: GAP_ANSWERERS[g.researchability] ?? ["DATA_ROOM"],
      why: g.whyItMatters,
      unlocks: `Resolves ${g.id}: ${enumLabel(g.target).toLowerCase()} unknown of decision importance ${g.decisionImportance}/5`,
      own: idx ?? round1(20 * g.decisionImportance * (g.uncertainty / 5)),
      ownBasis: idx !== undefined ? `research priority ${idx}` : `importance ${g.decisionImportance}/5 × uncertainty ${g.uncertainty}/5`,
      binding: false,
      links: refsIn(g.question).filter((x) => x !== g.id),
      matchText: g.question,
      breakpoints: [],
    });
  }

  /* 5. Verification priority (claims) */
  for (const v of (integ?.verificationPriority?.items ?? []).slice(0, 10)) {
    const cl: Claim | undefined = claimById.get(v.claimId);
    const cat = cl?.category ?? v.category;
    const evidence = cl?.evidenceNeeded ? stripRefs(cl.evidenceNeeded) : CLAIM_EVIDENCE[cat] ?? CLAIM_EVIDENCE.OTHER!;
    cands.push({
      driver: { kind: "CLAIM", key: v.claimId, label: v.statement, refs: [v.claimId, "calc:integrity"] },
      stream: CLAIM_STREAM[cat] ?? streamOf(v.statement, "FINANCIAL"),
      kind: cat === "CUSTOMER" || cat === "TEAM" || cat === "PARTNERSHIP" ? "REFERENCE_CALLS" : cat === "MARKET" || cat === "COMPETITION" ? "PUBLIC_RESEARCH" : "DATA_ROOM_REQUEST",
      request: `Verify ${v.claimId} — “${noStop(clip(v.statement, 200))}”. Evidence needed: ${noStop(clip(evidence, 220))}.`,
      perfectSlide: null,
      answerers: CLAIM_ANSWERERS[cat] ?? ["DATA_ROOM"],
      why: `Material, ${v.unusualness >= 0.7 ? "unusual" : "ordinary"} and unverified claim${v.pages.length ? ` (p. ${v.pages.join(", ")})` : ""}; ${cl ? `currently ${enumLabel(cl.verification).toLowerCase()}` : "status unknown"}.`,
      unlocks: `Moves ${v.claimId} from company-reported toward verified (evidence quality${gateBlocked("IC_READY") ? "; IC_READY gate" : ""})`,
      own: v.index,
      ownBasis: `verification priority ${v.index}`,
      binding: false,
      // A metric extracted from this claim ties the claim to that metric's breakpoint.
      links: c.metrics.filter((m) => m.isPrimary && m.claimId === v.claimId).map((m) => m.id),
      matchText: v.statement,
      breakpoints: [],
    });
  }

  /* 6. Evidence debt */
  for (const a of integ?.evidenceDebt?.areas ?? []) {
    if (a.level !== "HIGH" && a.level !== "VERY_HIGH") continue;
    const meta = DEBT_AREA[a.area] ?? { label: enumLabel(a.area), stream: "FINANCIAL" as WorkstreamId, answerers: ["DATA_ROOM"] as Answerer[], request: "Independent evidence for the area" };
    const top = (integ?.evidenceDebt?.topDebt ?? []).filter((t) => t.area === a.area).map((t) => t.ref);
    cands.push({
      driver: { kind: "EVIDENCE_DEBT", key: `debt:${a.area}`, label: `${meta.label} evidence debt ${enumLabel(a.level).toLowerCase()}`, refs: uniq([...top.slice(0, 6), "calc:integrity"]) },
      stream: meta.stream,
      kind: "DATA_ROOM_REQUEST",
      request: `${meta.label}: ${a.companyOnly + a.contradicted} of ${a.items} items rest only on company assertions or are contradicted. Request: ${meta.request}.`,
      perfectSlide: null,
      answerers: meta.answerers,
      why: `Evidence debt ${enumLabel(a.level).toLowerCase()} in ${meta.label.toLowerCase()} (${a.verified} verified, ${a.independentlySupported} independently supported).`,
      unlocks: `Lowers ${meta.label.toLowerCase()} evidence debt (evidence quality${gateBlocked("IC_READY") ? "; IC_READY gate" : ""})`,
      own: a.level === "VERY_HIGH" ? 70 : 55,
      ownBasis: `evidence debt ${a.level.replace("_", " ").toLowerCase()}`,
      binding: false,
      links: [],
      matchText: `${meta.label} evidence ${meta.request}`,
      breakpoints: [],
    });
  }

  /* 7. Integrity findings (computed, HIGH / CRITICAL) */
  const findings: IntegrityFinding[] = (integ?.findings ?? []).filter((f) => f.origin === "COMPUTED" && (f.severity === "HIGH" || f.severity === "CRITICAL") && f.module !== "SECURITY");
  for (const f of findings) {
    const text = `${f.title} ${f.kind}`;
    const contradicted = /CONTRADICT|INDEPENDENT/.test(f.kind);
    const stream = /TAM|MARKET/.test(f.kind) ? "MARKET" : streamOf(text, "FINANCIAL");
    cands.push({
      driver: { kind: "INTEGRITY", key: f.id, label: f.title, refs: uniq([...f.metricIds, ...f.claimIds, ...f.sourceIds, "calc:integrity"]) },
      stream,
      kind: "RECONCILIATION",
      request: `Resolve: ${noStop(clip(f.title, 200))}${f.pages.length ? ` (p. ${f.pages.join(", ")})` : ""}.`,
      perfectSlide: null,
      answerers: contradicted ? ["FOUNDER", "PUBLIC"] : ["DATA_ROOM", "FOUNDER"],
      why: clip(f.detail.split(" | ")[0] ?? f.detail, 260),
      unlocks: `Removes a ${f.severity.toLowerCase()} integrity finding before IC`,
      own: f.severity === "CRITICAL" ? 85 : 65,
      ownBasis: `integrity ${f.severity.toLowerCase()}`,
      binding: false,
      links: [...f.claimIds, ...f.metricIds],
      matchText: f.title,
      breakpoints: [],
    });
  }

  /* 8. Perfect slides: expected evidence (code) then analysis (model) */
  const expItems = new Map((integ?.expectedEvidence?.items ?? []).map((i) => [i.itemId, i]));
  const EXP_STREAM: Record<string, WorkstreamId> = { cap_table: "LEGAL", named_customers: "CUSTOMER", pipeline_funnel: "GTM", services_mix: "FINANCIAL" };
  for (const s of integ?.expectedEvidence?.perfectSlides ?? []) {
    const it = expItems.get(s.itemId);
    const sev = it?.severity ?? null;
    cands.push({
      driver: { kind: "PERFECT_SLIDE", key: `exp:${s.itemId}`, label: `${s.label} (${it ? enumLabel(it.presence).toLowerCase() : "missing"})`, refs: ["calc:integrity"] },
      stream: EXP_STREAM[s.itemId] ?? streamOf(`${s.label} ${s.slide}`, "FINANCIAL"),
      kind: "PERFECT_SLIDE",
      request: `Request the missing “${s.label}” evidence as a slide or data-room file.`,
      perfectSlide: s.slide,
      answerers: ["FOUNDER", "DATA_ROOM"],
      why: `Expected for ${enumLabel(integ?.expectedEvidence?.profile).toLowerCase()} at this stage and ${it ? enumLabel(it.presence).toLowerCase() : "missing"} in the materials.`,
      unlocks: `Fills a missing expected-evidence item (${s.label})`,
      own: sev === "HIGH" || sev === "CRITICAL" ? 60 : 40,
      ownBasis: `expected evidence${sev ? ` ${sev.toLowerCase()}` : ""}`,
      binding: false,
      links: [],
      matchText: `${s.label} ${s.slide}`,
      breakpoints: [],
    });
  }
  for (const [i, s] of c.perfectSlides.entries()) {
    const refs = refsIn(`${s.missing} ${s.slide}`);
    cands.push({
      driver: { kind: "PERFECT_SLIDE", key: `slide:${i + 1}`, label: clip(stripRefs(s.missing), 160), refs: refs.length ? refs : ["calc:integrity"] },
      stream: streamOf(`${s.missing} ${s.slide}`, "FINANCIAL"),
      kind: "PERFECT_SLIDE",
      request: `Request: ${clip(stripRefs(s.missing), 200)}`,
      perfectSlide: s.slide,
      answerers: ["FOUNDER", "DATA_ROOM"],
      why: stripRefs(s.missing),
      unlocks: "Replaces a weak or missing piece of evidence with the exact data needed",
      own: 40,
      ownBasis: "perfect slide (analysis)",
      binding: false,
      links: refs,
      matchText: `${stripRefs(s.missing)} ${stripRefs(s.slide)}`,
      breakpoints: [],
    });
  }

  /* 9. Open MUST_ASK questions */
  for (const q of c.questions.filter((x) => x.tier === "MUST_ASK" && x.status !== "RESOLVED")) {
    const text = `${q.question} ${q.whyItMatters}`;
    const affects = q.affects.map((a) => enumLabel(a).toLowerCase());
    cands.push({
      driver: { kind: "QUESTION", key: q.id, label: q.question, refs: [q.id] },
      stream: streamOf(text, "FINANCIAL"),
      kind: "FOUNDER_QUESTION",
      request: `Ask ${q.id}: ${q.question}`,
      perfectSlide: null,
      answerers: ["FOUNDER"],
      why: q.whyItMatters,
      unlocks: `Closes a MUST_ASK question${gateBlocked("MUST_ASK_OPEN") ? " (MUST_ASK_OPEN gate)" : ""}${affects.length ? `; affects ${affects.join(", ")}` : ""}`,
      own: 60 + (q.affects.includes("RECOMMENDATION") ? 10 : 0),
      ownBasis: `MUST_ASK question${q.affects.includes("RECOMMENDATION") ? " affecting the recommendation" : ""}`,
      binding: false,
      // A question that cites a gap is about that gap.
      links: refsIn(`${q.question} ${q.knownContext} ${q.whyItMatters}`).filter((x) => x.startsWith("GAP-")),
      matchText: q.question,
      breakpoints: [],
    });
  }

  /* ---------- priority from focus ---------- */
  const fx = focus ? focusIndex(focus.ranked ?? []) : null;
  const scored = cands.map((cand) => {
    let lev = cand.own;
    let basis = cand.ownBasis;
    if (fx) {
      const hits = [...cand.driver.refs, ...cand.links].map((r) => fx.byRef.get(r)).filter((x): x is FocusItem => !!x);
      const byLabel = cand.focusLabel ? fx.byLabel.get(cand.focusLabel) : undefined;
      if (byLabel) hits.push(byLabel);
      const best = hits.sort((a, b) => b.leverage - a.leverage)[0];
      if (best) {
        lev = best.leverage;
        basis = `decision leverage ${best.leverage.toFixed(0)} (focus)`;
      }
    }
    // Binding items rank at the top however focus scored them.
    if (cand.binding && lev < cand.own) {
      lev = cand.own;
      basis = cand.ownBasis;
    }
    return { cand, lev: clamp(lev), basis };
  });

  /* ---------- linked breakpoints ---------- */
  for (const s of scored) {
    if (s.cand.driver.kind === "BREAKPOINT") continue;
    const text = `${s.cand.request} ${s.cand.driver.label}`;
    for (const r of sensRows) {
      if (r.margin === null && r.broken === null) continue;
      const m = primaryMetric(r.metricKey);
      const onMetric = m && (s.cand.links.includes(m.id) || s.cand.driver.refs.includes(m.id));
      const shortName = r.metricKey ? metricDef(r.metricKey)?.shortName : undefined;
      const named = shortName && shortName.length >= 3 && new RegExp(`\\b${shortName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);
      if (onMetric || named) s.cand.breakpoints.push({ id: r.id, variable: r.variable, status: breakpointStatus(r) });
    }
  }

  /* ---------- order, then greedy dedupe ---------- */
  const tier = (lev: number, binding: boolean): Priority => (binding || lev >= 70 ? "P1" : lev >= 40 ? "P2" : "P3");
  scored.sort(
    (a, b) =>
      Number(b.cand.binding) - Number(a.cand.binding) ||
      b.lev - a.lev ||
      DRIVER_ORDER.indexOf(a.cand.driver.kind) - DRIVER_ORDER.indexOf(b.cand.driver.kind) ||
      a.cand.driver.key.localeCompare(b.cand.driver.key),
  );

  interface Acc {
    cand: Candidate;
    lev: number;
    basis: string;
    binding: boolean;
    requests: string[];
    slides: string[];
    answerers: Answerer[];
    unlocks: string[];
    merged: Driver[];
    refs: string[];
    /** Primary keys of every candidate merged here (never their links: no chaining). */
    members: Set<string>;
    breakpoints: WorkItem["breakpoints"];
  }
  const kept: Acc[] = [];
  let merged = 0;
  const isMet = (k: string) => k.startsWith("MET-");
  const explicitLink = (a: Acc, b: Candidate) => {
    if (a.members.has(b.driver.key)) return true; // same source object
    if (b.links.some((l) => a.members.has(l))) return true; // b is about something already here (a question citing a gap …)
    if (a.cand.links.includes(b.driver.key)) return true; // the host is about b (a finding naming a claim …)
    // A breakpoint and a claim / gap / finding on the same metric.
    if (a.cand.driver.kind === "BREAKPOINT" || b.driver.kind === "BREAKPOINT") {
      if (a.cand.links.some((l) => isMet(l) && b.links.includes(l))) return true;
      // …or a subject that names the breakpoint's metric (NRR, CAC payback …).
      if (a.cand.breakpoints.some((x) => b.breakpoints.some((y) => y.id === x.id))) return true;
    }
    return false;
  };
  for (const s of scored) {
    const host = kept.find((k) => explicitLink(k, s.cand) || overlap(k.cand.matchText, s.cand.matchText) >= 0.5);
    if (host) {
      merged++;
      host.merged.push(s.cand.driver);
      host.members.add(s.cand.driver.key);
      if (!host.requests.some((r) => overlap(r, s.cand.request) >= 0.8)) host.requests.push(s.cand.request);
      if (s.cand.perfectSlide && !host.slides.includes(s.cand.perfectSlide)) host.slides.push(s.cand.perfectSlide);
      host.answerers = uniq([...host.answerers, ...s.cand.answerers]);
      if (!host.unlocks.includes(s.cand.unlocks)) host.unlocks.push(s.cand.unlocks);
      host.refs = uniq([...host.refs, ...s.cand.driver.refs]);
      host.binding = host.binding || s.cand.binding;
      for (const bp of s.cand.breakpoints) if (!host.breakpoints.some((x) => x.id === bp.id)) host.breakpoints.push(bp);
      continue;
    }
    kept.push({
      cand: s.cand,
      lev: s.lev,
      basis: s.basis,
      binding: s.cand.binding,
      requests: [s.cand.request],
      slides: s.cand.perfectSlide ? [s.cand.perfectSlide] : [],
      answerers: [...s.cand.answerers],
      unlocks: [s.cand.unlocks],
      merged: [],
      refs: [...s.cand.driver.refs],
      members: new Set([s.cand.driver.key]),
      breakpoints: s.cand.breakpoints.filter((bp, i, xs) => xs.findIndex((y) => y.id === bp.id) === i),
    });
  }

  const ANSWER_ORDER: Answerer[] = ["FOUNDER", "DATA_ROOM", "REFERENCES", "PUBLIC"];
  const ordered = kept.sort(
    (a, b) =>
      ["P1", "P2", "P3"].indexOf(tier(a.lev, a.binding)) - ["P1", "P2", "P3"].indexOf(tier(b.lev, b.binding)) ||
      b.lev - a.lev ||
      DRIVER_ORDER.indexOf(a.cand.driver.kind) - DRIVER_ORDER.indexOf(b.cand.driver.kind) ||
      a.cand.driver.key.localeCompare(b.cand.driver.key),
  );
  const FALLBACK_REF: Record<DriverKind, string> = { THESIS_KILLER: "calc:risks", MANDATE_GATE: "calc:scores", BREAKPOINT: "calc:economics", GAP: "calc:questions", CLAIM: "calc:integrity", EVIDENCE_DEBT: "calc:integrity", INTEGRITY: "calc:integrity", PERFECT_SLIDE: "calc:integrity", QUESTION: "calc:questions" };
  const cleanDriver = (x: Driver): Driver => ({ ...x, refs: keep(x.refs, FALLBACK_REF[x.kind]) });
  const items: WorkItem[] = ordered.map((k, i) => ({
    id: `DD-${String(i + 1).padStart(2, "0")}`,
    workstream: k.cand.stream,
    priority: tier(k.lev, k.binding),
    leverage: k.lev,
    leverageBasis: k.basis,
    binding: k.binding,
    kind: k.cand.kind,
    requests: k.requests,
    perfectSlides: k.slides,
    answerers: [...k.answerers].sort((a, b) => ANSWER_ORDER.indexOf(a) - ANSWER_ORDER.indexOf(b)),
    why: k.cand.why,
    unlocks: k.unlocks,
    driver: cleanDriver(k.cand.driver),
    mergedFrom: k.merged.map(cleanDriver),
    breakpoints: k.breakpoints,
    refs: keep(k.refs, FALLBACK_REF[k.cand.driver.kind]),
  }));

  const workstreams = WORKSTREAMS.map((w) => {
    const its = items.filter((it) => it.workstream === w.id);
    return { id: w.id, label: w.label, items: its, p1: its.filter((x) => x.priority === "P1").length };
  })
    .filter((w) => w.items.length)
    // Workstreams ordered by their best item (the plan order).
    .sort((a, b) => items.indexOf(a.items[0]!) - items.indexOf(b.items[0]!));

  /* ---------- kill criteria ---------- */
  const killCriteria: KillCriterion[] = [];
  const testedBy = (refs: string[], key: string) => items.find((it) => it.driver.key === key || it.mergedFrom.some((m) => m.key === key) || refs.some((r) => !r.startsWith("calc:") && it.refs.includes(r)))?.id ?? null;
  for (const r of killers)
    killCriteria.push({
      text: `Stop if ${r.id} is confirmed: ${r.title}.`,
      basis: "THESIS_KILLER",
      origin: "COMPUTED",
      refs: uniq([r.id, ...r.claimRefs]),
      testedBy: testedBy([r.id], r.id),
    });
  for (const g of d.fundFit?.gates ?? [])
    if (g.result === "FAIL") killCriteria.push({ text: `Binding: fund mandate — ${g.label} (${g.detail}).`, basis: "MANDATE_GATE", origin: "COMPUTED", refs: ["calc:scores"], testedBy: testedBy([], `gate:${g.id}`) });
  for (const r of sensRows) {
    const m = primaryMetric(r.metricKey);
    if (!m || r.method !== "COMPUTED") continue;
    if (!(r.broken || (r.margin !== null && Math.abs(r.margin) <= 25))) continue;
    killCriteria.push({
      text: r.broken
        ? `${r.variable}: at the reported ${sensValue(r.current, r.unit)} the case is already past its breakpoint (${sensValue(r.breaksAt, r.unit)}). Stop unless verification moves it back.`
        : `Stop if verified ${r.variable.charAt(0).toLowerCase()}${r.variable.slice(1)} is ${r.direction === "BREAKS_BELOW" ? "below" : r.direction === "BREAKS_ABOVE" ? "above" : "beyond"} ${sensValue(r.breaksAt, r.unit)} (reported ${sensValue(r.current, r.unit)}).`,
      basis: "BREAKPOINT",
      origin: "COMPUTED",
      refs: [m.id, "calc:economics"],
      testedBy: testedBy([m.id], `sens:${r.id}`),
    });
  }
  const bp = c.decisionCore?.compression.breakingPoint;
  if (bp) killCriteria.push({ text: `Stop if the breaking point holds: ${stripRefs(bp)}`, basis: "BREAKING_POINT", origin: "MODEL", refs: refsIn(bp), testedBy: testedBy(refsIn(bp), "") });
  const rq = c.decisionCore?.reversingQuestion;
  if (rq?.ifUnfavorable) killCriteria.push({ text: `Stop if the reversing question comes back unfavourable: ${stripRefs(rq.ifUnfavorable)}`, basis: "REVERSING_QUESTION", origin: "MODEL", refs: refsIn(`${rq.question} ${rq.ifUnfavorable}`), testedBy: d.focus?.reversingQuestion?.id ? testedBy([d.focus.reversingQuestion.id], d.focus.reversingQuestion.id) : null });
  for (const f of c.falsification)
    for (const x of f.falsifiers)
      if (x.status === "FOUND" || x.status === "PARTIAL_SIGNAL")
        killCriteria.push({
          text: `Falsifier ${x.status === "FOUND" ? "already found" : "partly signalled"}: ${stripRefs(x.falsifier)}`,
          basis: "FALSIFIER",
          origin: "MODEL",
          refs: refsIn(`${x.falsifier} ${x.evidence}`),
          testedBy: testedBy(refsIn(x.evidence), ""),
        });

  return { items, workstreams, killCriteria: killCriteria.map((k) => ({ ...k, refs: keep(k.refs, "calc:risks") })), considered: cands.length, merged, missingInputs, rules: WORKPLAN_RULES };
}
