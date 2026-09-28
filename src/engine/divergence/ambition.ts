/**
 * 1. FOUNDER AMBITION CEILING — what company is this person really trying to
 * build: a €100M business or global infrastructure?
 *
 * Reads observable scope signals (product scope, geography, market framing,
 * hiring plan, roadmap, round size vs plan) and links the ambition class to
 * the outcome the economics engine says this deal needs. Distinct from the
 * latent "ambition consistency" (headline vs funded plan), which is reused
 * here, not recomputed.
 */
import type { DivergenceDraft } from "@/domain/sections";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, fmtUsd, hasText, isFact, months1, num, pagesOfEvidence, round } from "./util";

export type AmbitionClass = "NICHE_BUSINESS" | "CATEGORY_COMPANY" | "GLOBAL_PLATFORM";

export interface AmbitionFactor extends FactorBase {
  id: "AMBITION_CEILING";
  ambitionClass: AmbitionClass | null;
  /** Mean of the known scope components on a 0–3 scale (+/-0.5 for the balance of signals). */
  scopeIndex: number | null;
  requiredOutcomeClass: AmbitionClass | null;
  requiredExitEquityUsd: number | null;
  latentConsistency: string | null;
  signals: { kind: string; direction: "EXPANSIVE" | "CONTAINED"; evidence: string; page: number | null }[];
}

const SCOPE: Record<string, number> = { SINGLE_WORKFLOW: 0, PRODUCT_SUITE: 1, PLATFORM: 2, INFRASTRUCTURE: 3 };
const GEO: Record<string, number> = { LOCAL: 0, REGIONAL: 1, MULTI_REGION: 2, GLOBAL: 3 };
const FRAME: Record<string, number> = { TOOL_IN_EXISTING_CATEGORY: 0, CATEGORY_LEADER: 1, NEW_CATEGORY: 2, INFRASTRUCTURE_LAYER: 3 };
/** One country that is a continental-size single market scores as REGIONAL (MODEL_ASSUMPTION). */
const CONTINENTAL_MARKET_RE = /\b(united states|u\.s\.a?\.?|usa|us|america|china|india)\b/i;

const CLASS_RANK: Record<AmbitionClass, number> = { NICHE_BUSINESS: 0, CATEGORY_COMPANY: 1, GLOBAL_PLATFORM: 2 };
const CLASS_TEXT: Record<AmbitionClass, string> = { NICHE_BUSINESS: "a niche business (< $300M outcome)", CATEGORY_COMPANY: "a category company ($300M–$3B outcome)", GLOBAL_PLATFORM: "a global platform (≥ $3B outcome)" };

export function outcomeClass(exitEquityUsd: number): AmbitionClass {
  const b = A.outcomeBandsUsd;
  if (exitEquityUsd >= b.GLOBAL_PLATFORM![0]) return "GLOBAL_PLATFORM";
  if (exitEquityUsd >= b.CATEGORY_COMPANY![0]) return "CATEGORY_COMPANY";
  return "NICHE_BUSINESS";
}

export function ambitionClassOf(index: number): AmbitionClass {
  return index >= 2 ? "GLOBAL_PLATFORM" : index >= 1 ? "CATEGORY_COMPANY" : "NICHE_BUSINESS";
}

function scopeIndex(a: DivergenceDraft["ambition"] | null, hqCountry: string | null): { index: number | null; parts: string[] } {
  const parts: string[] = [];
  const vals: number[] = [];
  if (a && a.productScope in SCOPE) {
    vals.push(SCOPE[a.productScope]!);
    parts.push(`product scope ${a.productScope.toLowerCase().replace(/_/g, " ")} (${SCOPE[a.productScope]})`);
  }
  if (a && a.geography in GEO) {
    const geoText = [hqCountry ?? "", ...a.signals.filter((s) => s.kind === "GEOGRAPHY" && isFact(s.evidence)).map((s) => s.evidence)].join(" ; ");
    const continental = a.geography === "LOCAL" && CONTINENTAL_MARKET_RE.test(geoText);
    const g = continental ? GEO.REGIONAL! : GEO[a.geography]!;
    vals.push(g);
    parts.push(`geography ${a.geography.toLowerCase().replace(/_/g, " ")} (${g})${continental ? " — a single continental-size market scores as regional" : ""}`);
  }
  if (a && a.marketFraming in FRAME) {
    vals.push(FRAME[a.marketFraming]!);
    parts.push(`market framing ${a.marketFraming.toLowerCase().replace(/_/g, " ")} (${FRAME[a.marketFraming]})`);
  }
  if (!vals.length) return { index: null, parts };
  let index = vals.reduce((x, y) => x + y, 0) / vals.length;
  const sig = (a?.signals ?? []).filter((s) => isFact(s.evidence));
  const balance = sig.filter((s) => s.direction === "EXPANSIVE").length - sig.filter((s) => s.direction === "CONTAINED").length;
  if (balance >= 2) {
    index += 0.5;
    parts.push(`signals net expansive (+${balance}) → +0.5`);
  } else if (balance <= -2) {
    index -= 0.5;
    parts.push(`signals net contained (${balance}) → −0.5`);
  }
  return { index: round(Math.max(0, Math.min(3, index)), 2), parts };
}

export function ambitionCeiling(inp: DivergenceInputs): AmbitionFactor {
  const a = inp.draft?.ambition ?? null;
  const lat = inp.latentAmbition;
  const { index, parts } = scopeIndex(a, inp.deal.identity?.hqCountry ?? null);
  const cls = index === null ? null : ambitionClassOf(index);
  const traj = inp.economics?.trajectory?.fundTarget ?? null;
  const requiredExit = traj?.modelable && traj.requiredExitEquityUsd && traj.requiredExitEquityUsd > 0 ? traj.requiredExitEquityUsd : null;
  const requiredClass = requiredExit !== null ? outcomeClass(requiredExit) : null;
  const consistency = lat?.consistency ?? null;

  const evidence: DivergenceEvidence[] = [];
  const signals = (a?.signals ?? []).filter((s) => isFact(s.evidence)).slice(0, 8);
  if (a && hasText(a.statedEndState)) evidence.push(ev("MODEL_OBSERVED", `Stated end state: "${a.statedEndState}"`));
  for (const s of signals) evidence.push(ev("MODEL_OBSERVED", `${s.kind.toLowerCase().replace(/_/g, " ")} (${s.direction.toLowerCase()}): ${s.evidence}`, [s.page]));
  if (parts.length) evidence.push(ev("COMPUTED", `Scope index ${index ?? "n/a"} / 3 from ${parts.join("; ")}`));
  if (lat && consistency !== "UNCLEAR") evidence.push(ev("COMPUTED", `Latent ambition consistency (headline vs funded plan): ${consistency}${lat.tamToRaise ? ` — deck TAM ${lat.tamToRaise.toLocaleString("en-US")}× the raise` : ""}`));
  if (requiredExit !== null) evidence.push(ev("COMPUTED", `Economics trajectory: returning the fund's target contribution needs ${fmtUsd(requiredExit)} of exit equity (${CLASS_TEXT[requiredClass!]})`));

  // Financing pace: how long the round funds the plan, and how fast burn accelerates.
  const fm = inp.financing;
  const raise = fm?.raiseUsd ?? null;
  const planned = inp.deal.financingPath?.plannedMonthlyBurnUsd ?? null;
  const current = fm && fm.burnSource === "CURRENT" ? fm.monthlyBurnUsd : null;
  const monthsFunded = raise && fm?.monthlyBurnUsd && fm.monthlyBurnUsd > 0 ? round(((fm.cashUsd ?? 0) + raise) / fm.monthlyBurnUsd, 1) : null;
  const burnStep = planned && current && current > 0 ? round(planned / current, 2) : null;

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let why = "The deck does not show what company is being built (scope, geography, market framing unread).";
  if (cls) {
    if (requiredClass) {
      const gap = CLASS_RANK[requiredClass] - CLASS_RANK[cls];
      level = gap <= 0 ? "STRONG" : gap === 1 ? "ADEQUATE" : "WEAK";
      why =
        gap <= 0
          ? `The deck builds ${CLASS_TEXT[cls]}, at least the ${fmtUsd(requiredExit)} outcome this deal needs.`
          : `The deck builds ${CLASS_TEXT[cls]}; this deal needs ${fmtUsd(requiredExit)} of exit equity (${CLASS_TEXT[requiredClass]}).`;
    } else {
      level = cls === "GLOBAL_PLATFORM" ? "STRONG" : cls === "CATEGORY_COMPANY" ? "ADEQUATE" : "WEAK";
      why = `The deck builds ${CLASS_TEXT[cls]} (required outcome not modelable — no entry valuation).`;
    }
    if (consistency === "DISCONNECTED" && level === "STRONG") {
      level = "ADEQUATE";
      why += " The funded plan does not reach it (latent consistency: disconnected).";
    }
  }

  const implications: string[] = [];
  if (cls) implications.push(`Outcome size implied by the stated ambition: ${CLASS_TEXT[cls]}.`);
  if (requiredExit !== null && cls && requiredClass && CLASS_RANK[requiredClass] > CLASS_RANK[cls])
    implications.push(`Returning the fund target requires a bigger company than the one described — the founder's strategic choices (scope, geography) must widen, or the return must come from price.`);
  if (monthsFunded !== null) implications.push(`Financing pace: cash plus the round funds ${months1(monthsFunded)} at ${fmtUsd(fm!.monthlyBurnUsd)}/month (${fm!.burnSource.toLowerCase()} burn)${burnStep ? `; planned burn is ${burnStep}× today's` : ""}.`);
  if (consistency === "DISCONNECTED" || consistency === "STRETCHED") implications.push(`Headline ambition is ${consistency.toLowerCase()} relative to what the round funds (latent consistency) — the bridge from the wedge to the headline must be shown.`);

  return {
    id: "AMBITION_CEILING",
    n: 1,
    name: "Founder ambition ceiling",
    question: "What company is this founder really trying to build?",
    level,
    reading: cls ?? "UNREAD",
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule:
      "Scope index = mean of product scope (single workflow 0 … infrastructure 3), target geography (local 0 … global 3; one country that is a continental-size market — US, China, India — scores as regional 1) and market framing (tool 0 … infrastructure layer 3), ±0.5 when observable signals are net expansive/contained by ≥ 2; < 1 niche business, < 2 category company, else global platform. Compared with the outcome class of the exit equity the economics trajectory needs to return the fund target: at or above → STRONG, one class short → ADEQUATE, two short → WEAK (without a modelable trajectory: global STRONG, category ADEQUATE, niche WEAK). A DISCONNECTED latent consistency caps at ADEQUATE. Brand, pedigree and TAM size never enter.",
    evidence,
    coverage: coverage(
      [a && "model ambition read", signals.length > 0 && "scope signals", requiredExit !== null && "required outcome (economics trajectory)", lat && "latent ambition consistency", monthsFunded !== null && "burn and round size"],
      [!a && "model ambition read (divergence pass)", !signals.length && "scope signals", requiredExit === null && "required outcome (entry valuation)", !lat && "latent ambition consistency", monthsFunded === null && "burn and round size"],
    ),
    computed: [
      num("scopeIndex", "Scope index (0–3)", index, "RATIO"),
      num("ambitionClass", "Ambition class", cls, "TEXT"),
      num("requiredExitEquityUsd", "Exit equity needed for the fund target", requiredExit, "USD"),
      num("requiredClass", "Outcome class needed", requiredClass, "TEXT"),
      num("monthsFunded", "Months funded by cash + round", monthsFunded, "MONTHS"),
      num("burnStep", "Planned ÷ current burn", burnStep, "MULTIPLE"),
    ],
    implications,
    ambitionClass: cls,
    scopeIndex: index,
    requiredOutcomeClass: requiredClass,
    requiredExitEquityUsd: requiredExit,
    latentConsistency: consistency,
    signals: signals.map((s) => ({ kind: s.kind, direction: s.direction, evidence: s.evidence, page: s.page })),
  };
}
