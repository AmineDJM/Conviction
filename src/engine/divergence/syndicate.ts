/**
 * 3. SYNDICATE QUALITY (not prestige).
 *
 * Can the existing investors help the next round, support the company in a
 * difficult period, bring customers, recruit, and avoid catastrophic
 * governance? Only STATED BEHAVIOUR in this company counts — never the name,
 * fame or kind of the investor. An inactive famous investor is worth less than
 * an extremely active specialist, so brand names alone can never raise the
 * level (tested by name-swap invariance).
 */
import type { SYNDICATE_BEHAVIOURS } from "@/domain/sections";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, isFact, normName, num, pagesOfEvidence } from "./util";

type Behaviour = (typeof SYNDICATE_BEHAVIOURS)[number];
export const SYNDICATE_CAPABILITIES = ["NEXT_ROUND", "DIFFICULT_PERIODS", "CUSTOMERS", "RECRUITING", "GOVERNANCE"] as const;
export type SyndicateCapability = (typeof SYNDICATE_CAPABILITIES)[number];

/** Behaviour → capability contributions. The only inputs to the level. */
export const BEHAVIOUR_POINTS: Record<Behaviour, Partial<Record<SyndicateCapability, number>>> = {
  FOLLOWS_ON_THIS_ROUND: { NEXT_ROUND: 2, DIFFICULT_PERIODS: 1 },
  PRO_RATA_OR_RESERVES_COMMITTED: { NEXT_ROUND: 1 },
  INVESTS_AT_NEXT_STAGE: { NEXT_ROUND: 1 },
  BRIDGED_OR_SUPPORTED_IN_DOWNTURN: { DIFFICULT_PERIODS: 2 },
  INTRODUCED_CUSTOMERS: { CUSTOMERS: 2 },
  HELPED_RECRUIT: { RECRUITING: 2 },
  ACTIVE_BOARD_OR_OPERATING_SUPPORT: { GOVERNANCE: 1 },
  SECTOR_SPECIALIST: { CUSTOMERS: 1 },
  NOT_FOLLOWING_ON: { NEXT_ROUND: -2 },
  CONFLICT_OF_INTEREST: { GOVERNANCE: -2 },
};

const CAPABILITY_TEXT: Record<SyndicateCapability, string> = {
  NEXT_ROUND: "help the next round",
  DIFFICULT_PERIODS: "support in a difficult period",
  CUSTOMERS: "bring customers",
  RECRUITING: "recruit",
  GOVERNANCE: "governance",
};

export interface SyndicateInvestor {
  name: string;
  kind: string;
  roundRole: string;
  behaviours: Behaviour[];
  /** Behaviours with a stated fact behind them (the only ones counted). */
  counted: Behaviour[];
  researchRefs: string[];
  evidence: string;
  page: number | null;
  nameOnly: boolean;
}

export interface SyndicateFactor extends FactorBase {
  id: "SYNDICATE_QUALITY";
  investors: SyndicateInvestor[];
  capabilities: { capability: SyndicateCapability; net: number; covered: boolean }[];
}

const RESEARCH_RE = /\bfollow[- ]?on\b|\bled\b|\bleads\b|\bparticipat|\breinvest|\bbridge|\bpro[- ]?rata\b|\bdoubled down\b/i;

export function syndicateQuality(inp: DivergenceInputs): SyndicateFactor {
  const draft = inp.draft?.syndicate ?? [];
  const fin = inp.deal.financing;
  const byName = new Map<string, SyndicateInvestor>();
  for (const s of draft) {
    const k = normName(s.name);
    if (!k) continue;
    const counted = isFact(s.evidence) ? [...new Set(s.behaviours)] : [];
    const prev = byName.get(k);
    if (prev) {
      prev.behaviours = [...new Set([...prev.behaviours, ...s.behaviours])];
      prev.counted = [...new Set([...prev.counted, ...counted])];
      prev.nameOnly = prev.counted.length === 0;
      continue;
    }
    byName.set(k, { name: s.name, kind: s.kind, roundRole: s.roundRole, behaviours: [...new Set(s.behaviours)], counted, researchRefs: [], evidence: s.evidence, page: s.page, nameOnly: counted.length === 0 });
  }
  // Names that appear only in the financing extraction: known, but no behaviour stated.
  for (const n of [fin?.leadInvestor ?? null, ...(fin?.existingInvestors ?? [])]) {
    const k = normName(n);
    if (!k || byName.has(k)) continue;
    byName.set(k, { name: n!, kind: "UNKNOWN", roundRole: n === fin?.leadInvestor ? "LEADS_CURRENT_ROUND" : "EXISTING_PARTICIPATION_UNSTATED", behaviours: [], counted: [], researchRefs: [], evidence: "", page: null, nameOnly: true });
  }
  const investors = [...byName.values()];

  // Independent research that states a behaviour of a named investor (content decides, not the name).
  for (const c of inp.deal.claims ?? []) {
    if (c.origin === "COMPANY" || c.independence === "COMPANY_DERIVED" || c.category !== "FUNDING") continue;
    if (!RESEARCH_RE.test(c.statement)) continue;
    const text = normName(c.statement);
    for (const i of investors) if (normName(i.name).length >= 3 && text.includes(normName(i.name))) i.researchRefs.push(c.id);
  }

  const net: Record<SyndicateCapability, number> = { NEXT_ROUND: 0, DIFFICULT_PERIODS: 0, CUSTOMERS: 0, RECRUITING: 0, GOVERNANCE: 0 };
  const evidence: DivergenceEvidence[] = [];
  for (const i of investors) {
    for (const b of i.counted) for (const [cap, pts] of Object.entries(BEHAVIOUR_POINTS[b] ?? {}) as [SyndicateCapability, number][]) net[cap] += pts;
    if (i.researchRefs.length) net.NEXT_ROUND += 1;
    if (i.counted.length) evidence.push(ev("MODEL_OBSERVED", `${i.name} — ${i.counted.map((b) => b.toLowerCase().replace(/_/g, " ")).join(", ")}: ${i.evidence}`, [i.page]));
    if (i.researchRefs.length) evidence.push(ev("RESEARCH", `${i.name}: participation corroborated by independent research`, [], i.researchRefs));
    const uncounted = i.behaviours.filter((b) => !i.counted.includes(b));
    if (uncounted.length) evidence.push(ev("COMPUTED", `${i.name}: ${uncounted.map((b) => b.toLowerCase().replace(/_/g, " ")).join(", ")} reported without a stated fact — not counted`, [i.page]));
  }
  // Cap-table conflicts and operating vetoes are governance facts about the syndicate.
  const conflicts = (inp.draft?.capTable.investorConflicts ?? []).filter((c) => isFact(c.evidence));
  if (conflicts.length) {
    net.GOVERNANCE -= 2;
    for (const c of conflicts) evidence.push(ev("MODEL_OBSERVED", `Investor conflict: ${c.evidence}`, [c.page]));
  }
  const vetoes = (inp.draft?.capTable.terms ?? []).filter((t) => t.term === "INVESTOR_OPERATING_VETO");
  if (vetoes.length) {
    net.GOVERNANCE -= 1;
    for (const t of vetoes) evidence.push(ev("MODEL_OBSERVED", `Operating veto: ${t.evidence}`, [t.page]));
  }

  const capabilities = (Object.keys(net) as SyndicateCapability[]).map((capability) => ({ capability, net: net[capability], covered: net[capability] !== 0 }));
  const pos = capabilities.filter((c) => c.net > 0);
  const neg = capabilities.filter((c) => c.net < 0);
  const behavioural = investors.some((i) => i.counted.length > 0 || i.researchRefs.length > 0) || conflicts.length > 0 || vetoes.length > 0;
  const nameOnly = investors.filter((i) => i.nameOnly && !i.researchRefs.length);

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "NO_INVESTORS_NAMED";
  let why = "No investors are named in the materials.";
  if (investors.length && !behavioural) {
    reading = "NAMES_ONLY";
    why = `${investors.length} investor${investors.length > 1 ? "s" : ""} named, but no stated behaviour (follow-on, reserves, customers, hiring, board work) — names alone never raise the level.`;
  } else if (behavioural) {
    if (neg.length >= 2 || (net.NEXT_ROUND < 0 && pos.length <= 1) || (pos.length === 0 && neg.length > 0)) {
      level = "WEAK";
      reading = "PASSIVE_OR_CONFLICTED";
    } else if (pos.length >= 3 && neg.length === 0) {
      level = "STRONG";
      reading = "ACTIVE_AND_SUPPORTIVE";
    } else {
      level = "ADEQUATE";
      reading = "PARTIAL_SUPPORT";
    }
    const posTxt = pos.map((c) => CAPABILITY_TEXT[c.capability]).join(", ");
    const negTxt = neg.map((c) => CAPABILITY_TEXT[c.capability]).join(", ");
    why = `Stated behaviour shows the syndicate can ${posTxt || "do nothing observable"}${negTxt ? `; negative on ${negTxt}` : ""}.`;
  }

  const implications: string[] = [];
  if (net.NEXT_ROUND < 0) implications.push("Next round: an existing investor not following on is a signal the next lead will ask about — expect a harder raise.");
  else if (net.NEXT_ROUND >= 2) implications.push("Next round: insiders following on reduce financing risk and anchor the next price.");
  if (net.DIFFICULT_PERIODS <= 0 && behavioural) implications.push("Difficult periods: nothing shows the insiders would bridge a slip in the plan — the financing map's delay risk is not mitigated by the syndicate.");
  if (net.GOVERNANCE < 0) implications.push("Governance: a stated conflict or veto can block a sale, a pivot or a down round when it matters most.");
  if (nameOnly.length) implications.push(`Diligence: ask ${nameOnly.slice(0, 3).map((i) => i.name).join(", ")} for their reserves, follow-on intent and what they have done for the company — the deck shows only names.`);

  return {
    id: "SYNDICATE_QUALITY",
    n: 3,
    name: "Syndicate quality (not prestige)",
    question: "Can the existing investors help the next round, the hard months, customers, hiring — and stay out of the way?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: "Only behaviours stated with a fact count: follows on in this round (+2 next round, +1 hard periods), pro-rata/reserves committed (+1 next round), invests at the next stage (+1), bridged or supported in a downturn (+2 hard periods), introduced customers (+2), helped recruit (+2), active board/operating support (+1 governance), sector specialist (+1 customers), independent research corroborating participation (+1 next round); not following on (−2 next round), conflict of interest or stated investor conflict (−2 governance), operating veto (−1 governance). ≥ 3 capabilities positive and none negative → STRONG; ≥ 2 negative, a negative next-round reading with ≤ 1 positive, or only negatives → WEAK; otherwise ADEQUATE. Names, fame and investor kind never enter; names without behaviour → INSUFFICIENT_EVIDENCE.",
    evidence,
    coverage: coverage(
      [investors.length > 0 && "investors named", behavioural && "stated investor behaviour", investors.some((i) => i.researchRefs.length) && "independent research on investors"],
      [!investors.length && "investors named", !behavioural && "stated investor behaviour (follow-on, reserves, support)", !investors.some((i) => i.researchRefs.length) && "independent research on investors"],
    ),
    computed: [
      num("investors", "Investors named", investors.length, "COUNT"),
      num("withBehaviour", "Investors with stated behaviour", investors.filter((i) => i.counted.length).length, "COUNT"),
      ...capabilities.map((c) => num(`net_${c.capability}`, `Net: ${CAPABILITY_TEXT[c.capability]}`, c.net, "COUNT")),
    ],
    implications,
    investors,
    capabilities,
  };
}
