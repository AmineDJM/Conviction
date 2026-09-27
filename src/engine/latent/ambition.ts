/**
 * §8 CONSISTENCY OF AMBITION — headline ambition vs what the round actually
 * funds. "How does the company actually get from this wedge to the headline?"
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { MarketReconstruction } from "../market";
import type { LatentEvidence, LatentModule } from "./types";
import { bases, coverage, fmtUsd, lower, moneyUsd, pagesOf, round } from "./util";

export type AmbitionConsistency = "CONSISTENT" | "STRETCHED" | "DISCONNECTED" | "UNCLEAR";
export type GeoScope = "LOCAL" | "REGIONAL" | "GLOBAL" | "UNSTATED";

export interface Ambition extends LatentModule {
  consistency: AmbitionConsistency;
  computedConsistency: AmbitionConsistency;
  modelConsistency: AmbitionConsistency | null;
  deckTamUsd: number | null;
  raiseUsd: number | null;
  reconstructedMarketHighUsd: number | null;
  /** Deck TAM / raise amount. */
  tamToRaise: number | null;
  /** Deck TAM / reconstructed market high. */
  deckTamToReconstructed: number | null;
  fundedGeography: { scope: GeoScope; places: string[] };
  headlineScope: GeoScope;
  narrowProductScope: boolean;
  bridgeStated: boolean | null;
  points: number;
  evidence: LatentEvidence[];
  question: string;
}

const COUNTRIES = [
  "france", "germany", "spain", "italy", "united kingdom", "uk", "netherlands", "belgium", "switzerland", "austria", "sweden", "norway", "denmark", "finland",
  "poland", "portugal", "ireland", "united states", "usa", "u s", "canada", "mexico", "brazil", "india", "china", "japan", "singapore", "australia", "israel",
  "uae", "saudi arabia", "nigeria", "kenya", "south africa", "luxembourg", "czech republic", "romania", "greece", "turkey", "korea", "indonesia", "vietnam",
];
const SUBREGIONS = ["dach", "nordics", "benelux", "iberia", "baltics", "cee", "gcc", "bay area", "new york", "london", "paris", "berlin", "munich"];
const REGIONS = ["europe", "european", "eu", "north america", "latam", "latin america", "apac", "asia", "emea", "mena", "africa", "middle east"];
const GLOBAL_RE = /\bglobal(ly)?\b|\bworld ?wide\b|\binternational(ly)?\b|\bthe world\b|\bplanet\b|\bevery (company|business|country|market)\b/;
const NARROW_RE = /\bsingle (product|module|workflow|use case|vertical)\b|\bone (product|module|workflow|use case|vertical)\b|\bworkflow\b|\bmodule\b|\bvertical\b|\bniche\b|\bmvp\b|\bpilot\b|\blocal\b/;
const NO_BRIDGE_RE = /\bnot (explain|explained|shown|described|stated|bridged|addressed)\b|\bno (bridge|explanation|path|plan|roadmap)\b|\bdoes not\b|\bdoesn['’]t\b|\bunclear\b|\babsent\b|\bnone\b|\bmissing\b|\bnot provided\b/;

function places(text: string): string[] {
  const t = ` ${lower(text).replace(/[^\p{L}\s]/gu, " ")} `;
  const found = new Set<string>();
  for (const c of [...COUNTRIES, ...SUBREGIONS, ...REGIONS]) if (t.includes(` ${c} `)) found.add(c);
  return [...found].sort();
}

export function geoScope(text: string): { scope: GeoScope; places: string[] } {
  const p = places(text);
  if (GLOBAL_RE.test(lower(text))) return { scope: "GLOBAL", places: p };
  if (p.some((x) => REGIONS.includes(x))) return { scope: "REGIONAL", places: p };
  const countries = p.filter((x) => COUNTRIES.includes(x) || SUBREGIONS.includes(x));
  if (countries.length >= 5) return { scope: "REGIONAL", places: p };
  if (countries.length) return { scope: "LOCAL", places: p };
  return { scope: "UNSTATED", places: p };
}

const SEVERITY: Record<AmbitionConsistency, number> = { UNCLEAR: -1, CONSISTENT: 0, STRETCHED: 1, DISCONNECTED: 2 };

export function ambition(deal: CanonicalDeal, market: MarketReconstruction | null): Ambition {
  const ls = deal.latentSignals?.ambition ?? null;
  const fin = deal.financing;
  const deckTamUsd = market?.deckTamUsd ?? moneyUsd(deal.deckMarket?.tam);
  const raiseUsd = moneyUsd(fin?.raiseAmount);
  const reconstructedHigh = market?.primary?.highUsd ?? null;
  const tamToRaise = deckTamUsd && raiseUsd ? round(deckTamUsd / raiseUsd, 0) : null;
  const deckTamToReconstructed = deckTamUsd && reconstructedHigh ? round(deckTamUsd / reconstructedHigh, 1) : null;
  const fundsText = [...(fin?.useOfFunds ?? []), ...(fin?.milestonesClaimed ?? []).map((m) => m.milestone), ls?.operationalRoadmap ?? ""].join(" ; ");
  const funded = geoScope(fundsText);
  const headlineText = `${ls?.headline ?? ""} ${deal.deckMarket?.description ?? ""}`;
  const headlineGeo = geoScope(headlineText);
  const headlineScope: GeoScope = headlineGeo.scope === "GLOBAL" || (deckTamUsd !== null && deckTamUsd >= 10e9) ? "GLOBAL" : headlineGeo.scope;
  const narrowProductScope = NARROW_RE.test(lower(fundsText));
  const bridgeStated = ls ? !!ls.bridge.trim() && !NO_BRIDGE_RE.test(lower(ls.bridge)) : null;

  const evidence: LatentEvidence[] = [];
  let points = 0;
  if (tamToRaise !== null) {
    const p = tamToRaise >= 5000 ? 2 : tamToRaise >= 1000 ? 1 : 0;
    points += p;
    evidence.push({ basis: "COMPUTED", text: `Deck TAM ${fmtUsd(deckTamUsd)} is ${tamToRaise.toLocaleString("en-US")}× the ${fmtUsd(raiseUsd)} raise (+${p})`, page: null });
  }
  if (deckTamToReconstructed !== null) {
    const p = deckTamToReconstructed > 10 ? 2 : deckTamToReconstructed > 3 ? 1 : 0;
    points += p;
    evidence.push({ basis: "COMPUTED", text: `Deck TAM is ${deckTamToReconstructed}× the reconstructed market (${fmtUsd(reconstructedHigh)}) (+${p})`, page: null });
  }
  if (headlineScope === "GLOBAL" && funded.scope === "LOCAL") {
    points += 2;
    evidence.push({ basis: "COMPUTED", text: `Global headline vs a local funded scope (${funded.places.join(", ")}) (+2)`, page: null });
  } else if (headlineScope === "GLOBAL" && funded.scope === "REGIONAL") {
    points += 1;
    evidence.push({ basis: "COMPUTED", text: `Global headline vs a regional funded scope (${funded.places.join(", ")}) (+1)`, page: null });
  }
  if (narrowProductScope && headlineScope === "GLOBAL") {
    points += 1;
    evidence.push({ basis: "COMPUTED", text: "Use of funds targets a narrow product / workflow scope under a global headline (+1)", page: null });
  }
  if (bridgeStated === false) {
    points += 1;
    evidence.push({ basis: "MODEL_OBSERVED", text: `No wedge-to-headline bridge: ${ls!.bridge}`, page: null });
  }
  const computable = tamToRaise !== null || deckTamToReconstructed !== null || funded.scope !== "UNSTATED";
  const computedConsistency: AmbitionConsistency = !computable ? "UNCLEAR" : points >= 4 ? "DISCONNECTED" : points >= 2 ? "STRETCHED" : "CONSISTENT";
  const modelConsistency = ls?.consistency ?? null;
  if (ls) evidence.push({ basis: "MODEL_OBSERVED", text: `Model: ${ls.consistency} — headline "${ls.headline}"; funds "${ls.operationalRoadmap}"`, page: null });
  const consistency =
    SEVERITY[computedConsistency] >= SEVERITY[modelConsistency ?? "UNCLEAR"] ? computedConsistency : (modelConsistency as AmbitionConsistency);

  const wedge = deal.market?.wedge || funded.places.join(" / ") || (fin?.useOfFunds ?? [])[0] || "the current wedge";
  const headline = ls?.headline || (deckTamUsd ? `a ${fmtUsd(deckTamUsd)} market` : "the headline ambition");
  return {
    basis: bases("COMPUTED", !!ls && "MODEL_OBSERVED"),
    pages: pagesOf([]),
    coverage: coverage(
      [deckTamUsd !== null ? "deck TAM" : null, raiseUsd !== null ? "raise amount" : null, reconstructedHigh !== null ? "reconstructed market" : null, fin?.useOfFunds?.length ? "use of funds" : null, ls ? "model ambition read" : null].filter((x): x is string => !!x),
      [deckTamUsd !== null ? null : "deck TAM", raiseUsd !== null ? null : "raise amount", reconstructedHigh !== null ? null : "reconstructed market", fin?.useOfFunds?.length ? null : "use of funds", ls ? null : "model ambition read (latentSignals)"].filter((x): x is string => !!x),
    ),
    rule:
      "Points: deck TAM / raise ≥5,000× +2 (≥1,000× +1); deck TAM / reconstructed market >10× +2 (>3× +1); global headline (or deck TAM ≥$10B) vs local funded geography +2 (regional +1); narrow funded product scope under a global headline +1; no stated wedge-to-headline bridge +1. DISCONNECTED ≥4, STRETCHED ≥2, else CONSISTENT; UNCLEAR without inputs. The final reading is the more severe of the computed and model readings.",
    consistency,
    computedConsistency,
    modelConsistency,
    deckTamUsd,
    raiseUsd,
    reconstructedMarketHighUsd: reconstructedHigh,
    tamToRaise,
    deckTamToReconstructed,
    fundedGeography: funded,
    headlineScope,
    narrowProductScope,
    bridgeStated,
    points,
    evidence,
    question: `How does the company actually get from ${wedge} to ${headline}?`,
  };
}
