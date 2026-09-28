/**
 * 5. MARKET STRUCTURE (not size) — fragmentation, buyer and seller
 * concentration, pricing power, network structure, purchase frequency,
 * switching costs, procurement power, winner-take dynamics, incumbent
 * bundling. A $20B TAM can be terrible; a smaller fragmented, underserved,
 * winner-take-most market can be excellent. Market size is shown for contrast
 * and never enters the level.
 */
import type { MARKET_DIMENSIONS, STRUCTURE_READINGS } from "@/domain/sections";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, fmtUsd, isFact, minLevel, num, pagesOfEvidence, pct1, round } from "./util";

type Dimension = (typeof MARKET_DIMENSIONS)[number];
type Reading = (typeof STRUCTURE_READINGS)[number];

/** Dimension weights (MODEL_ASSUMPTION): the ones that decide value capture weigh double. */
export const STRUCTURE_WEIGHTS: Record<Dimension, number> = {
  BUYER_CONCENTRATION: 2,
  PRICING_POWER: 2,
  SWITCHING_COSTS: 2,
  WINNER_TAKE_DYNAMICS: 2,
  INCUMBENT_BUNDLING: 2,
  PROCUREMENT_POWER: 1,
  FRAGMENTATION: 1,
  SUPPLIER_CONCENTRATION: 1,
  NETWORK_STRUCTURE: 1,
  PURCHASE_FREQUENCY: 1,
};
const VALUE: Record<Reading, number | null> = { FAVORABLE: 1, NEUTRAL: 0, UNFAVORABLE: -1, UNKNOWN: null };

export interface StructureDimension {
  dimension: Dimension;
  reading: Reading;
  weight: number;
  basis: "MODEL_OBSERVED" | "COMPUTED";
  evidence: string;
  pages: number[];
}

export interface MarketStructureFactor extends FactorBase {
  id: "MARKET_STRUCTURE";
  dimensions: StructureDimension[];
  /** Σ weight × (+1/0/−1) ÷ Σ weight of assessed dimensions, −1…+1. */
  structureBalance: number | null;
  assessed: number;
  /** Shown for contrast only — never used in the level. */
  marketSize: { reconstructedHighUsd: number | null; deckTamUsd: number | null };
}

export function marketStructure(inp: DivergenceInputs): MarketStructureFactor {
  const ms = inp.draft?.marketStructure ?? null;
  const dims = new Map<Dimension, StructureDimension>();
  const conflicts: string[] = [];
  for (const d of ms?.dimensions ?? []) {
    if (d.reading === "UNKNOWN" || !isFact(d.evidence)) continue;
    const prev = dims.get(d.dimension);
    if (!prev) {
      dims.set(d.dimension, { dimension: d.dimension, reading: d.reading, weight: STRUCTURE_WEIGHTS[d.dimension], basis: "MODEL_OBSERVED", evidence: d.evidence, pages: d.page !== null ? [d.page] : [] });
    } else if (prev.reading !== d.reading) {
      // Contradictory readings of the same dimension: the deck informs both ways → NEUTRAL.
      conflicts.push(d.dimension);
      dims.set(d.dimension, { ...prev, reading: "NEUTRAL", evidence: `${prev.evidence} / ${d.evidence}`, pages: [...prev.pages, ...(d.page !== null ? [d.page] : [])] });
    }
  }
  const computed = (dimension: Dimension, reading: Reading, evidence: string) =>
    dims.set(dimension, { dimension, reading, weight: STRUCTURE_WEIGHTS[dimension], basis: "COMPUTED", evidence, pages: dims.get(dimension)?.pages ?? [] });

  // Stated numbers override the model's reading of the same dimension.
  const top = ms?.topBuyersSharePct ?? null;
  if (top !== null && top > 0) {
    const n = ms?.topBuyersCount ? `top ${ms.topBuyersCount}` : "largest";
    computed("BUYER_CONCENTRATION", top >= A.buyerConcentrationHighPct ? "UNFAVORABLE" : top <= A.buyerConcentrationLowPct ? "FAVORABLE" : "NEUTRAL", `The ${n} buyers control ${pct1(top)} of spend`);
  }
  const buyers = ms?.addressableBuyerCount ?? inp.deal.market?.bottomUp?.customerCountHigh ?? null;
  if (buyers !== null && buyers > 0) {
    const src = ms?.addressableBuyerCount ? "stated in the deck" : "bottom-up market reconstruction";
    computed("FRAGMENTATION", buyers < A.concentratedBuyersBelow ? "UNFAVORABLE" : buyers > A.fragmentedBuyersAbove ? "FAVORABLE" : "NEUTRAL", `${Math.round(buyers).toLocaleString("en-US")} addressable buyers (${src})`);
  }
  const inc = ms?.largestCompetitorSharePct ?? null;
  if (inc !== null && inc > 0) computed("WINNER_TAKE_DYNAMICS", inc >= A.incumbentShareTakenPct ? "UNFAVORABLE" : inc <= A.incumbentShareOpenPct ? "FAVORABLE" : "NEUTRAL", `Largest incumbent holds ${pct1(inc)} of the market`);
  // Analysis cross-check: an incumbent-copy adversarial test that FAILS is incumbent bundling risk (only if the deck is silent).
  const copy = inp.deal.competition?.adversarialTests.find((t) => t.test === "INCUMBENT_COPY");
  if (copy && !dims.has("INCUMBENT_BUNDLING") && (copy.verdict === "FAILS" || copy.verdict === "SURVIVES"))
    computed("INCUMBENT_BUNDLING", copy.verdict === "FAILS" ? "UNFAVORABLE" : "NEUTRAL", `Adversarial test (incumbent copies): ${copy.verdict.toLowerCase()} — ${copy.outcome}`);

  const dimensions = [...dims.values()].sort((a, b) => b.weight - a.weight || a.dimension.localeCompare(b.dimension));
  const assessed = dimensions.filter((d) => VALUE[d.reading] !== null);
  const wSum = assessed.reduce((s, d) => s + d.weight, 0);
  const balance = wSum > 0 && assessed.length >= 3 ? round(assessed.reduce((s, d) => s + d.weight * (VALUE[d.reading] ?? 0), 0) / wSum, 2) : null;
  const buyerConcentrated = dims.get("BUYER_CONCENTRATION")?.basis === "COMPUTED" && dims.get("BUYER_CONCENTRATION")?.reading === "UNFAVORABLE";

  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "UNREAD";
  if (assessed.length >= 3 && balance !== null) {
    level = balance >= 0.3 ? "STRONG" : balance > -0.3 ? "ADEQUATE" : "WEAK";
    if (buyerConcentrated) level = minLevel(level, "ADEQUATE");
    reading = level === "STRONG" ? "STRUCTURALLY_ATTRACTIVE" : level === "ADEQUATE" ? "MIXED" : "STRUCTURALLY_HOSTILE";
  }
  const fav = assessed.filter((d) => d.reading === "FAVORABLE").map((d) => d.dimension.toLowerCase().replace(/_/g, " "));
  const unfav = assessed.filter((d) => d.reading === "UNFAVORABLE").map((d) => d.dimension.toLowerCase().replace(/_/g, " "));
  const why =
    level === "INSUFFICIENT_EVIDENCE"
      ? `Only ${assessed.length} structural dimension${assessed.length === 1 ? "" : "s"} can be read — at least 3 are needed; market size alone says nothing about structure.`
      : `${fav.length ? `Favourable: ${fav.join(", ")}` : "Nothing favourable"}${unfav.length ? `; unfavourable: ${unfav.join(", ")}` : ""} (balance ${balance}).`;

  const evidence: DivergenceEvidence[] = dimensions.map((d) => ev(d.basis, `${d.dimension.toLowerCase().replace(/_/g, " ")} — ${d.reading.toLowerCase()}: ${d.evidence}`, d.pages));
  const sizeHigh = inp.market?.primary?.highUsd ?? null;
  const deckTam = inp.market?.deckTamUsd ?? null;
  const implications: string[] = [];
  if (level === "WEAK") implications.push(`Size is not structure: ${sizeHigh || deckTam ? `a ${fmtUsd(sizeHigh ?? deckTam)} market ` : "the market "}with this structure caps pricing and value capture — growth will cost more per dollar of revenue than in a lookalike with a better-structured market.`);
  if (level === "STRONG") implications.push("Structure favours an entrant: dispersed buyers, pricing power or switching costs let a winner capture value even if the market is smaller than the headline.");
  if (buyerConcentrated) implications.push("Concentrated buyers set prices and terms (procurement power); a few logos decide the company.");
  if (conflicts.length) implications.push(`The materials inform ${conflicts.map((c) => c.toLowerCase().replace(/_/g, " ")).join(", ")} both ways — read as neutral.`);

  return {
    id: "MARKET_STRUCTURE",
    n: 5,
    name: "Market structure (not size)",
    question: "Does the structure of this market let a winner capture value?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: `Each dimension FAVORABLE +1, NEUTRAL 0, UNFAVORABLE −1, weighted 2 for buyer concentration, pricing power, switching costs, winner-take dynamics and incumbent bundling, 1 otherwise. Stated numbers override the model's reading: top buyers ≥ ${A.buyerConcentrationHighPct}% of spend → concentrated (≤ ${A.buyerConcentrationLowPct}% dispersed); < ${A.concentratedBuyersBelow} addressable buyers concentrated, > ${A.fragmentedBuyersAbove.toLocaleString("en-US")} fragmented; largest incumbent ≥ ${A.incumbentShareTakenPct}% winner-take already taken (≤ ${A.incumbentShareOpenPct}% open). Balance ≥ 0.3 STRONG, > −0.3 ADEQUATE, else WEAK; ≥ 3 assessed dimensions required; computed buyer concentration caps at ADEQUATE. Market size is never an input.`,
    evidence,
    coverage: coverage(
      [assessed.length > 0 && `${assessed.length}/10 structural dimensions`, top !== null && "top-buyer share", buyers !== null && "buyer count", inc !== null && "incumbent share"],
      [assessed.length < 10 && `${10 - assessed.length}/10 structural dimensions unread`, top === null && "top-buyer share", buyers === null && "buyer count", inc === null && "incumbent share"],
    ),
    computed: [
      num("balance", "Structure balance (−1…+1)", balance, "RATIO"),
      num("assessed", "Dimensions assessed", assessed.length, "COUNT"),
      num("topBuyersSharePct", "Top buyers' share of spend", top, "PCT", "MODEL_OBSERVED"),
      num("addressableBuyers", "Addressable buyers", buyers, "COUNT"),
      num("marketSizeHighUsd", "Market size (contrast only, not used)", sizeHigh ?? deckTam, "USD"),
    ],
    implications,
    dimensions,
    structureBalance: balance,
    assessed: assessed.length,
    marketSize: { reconstructedHighUsd: sizeHigh, deckTamUsd: deckTam },
  };
}
