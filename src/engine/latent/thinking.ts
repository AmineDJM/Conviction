/**
 * §2 QUALITY OF THINKING — does the deck support its conclusions with
 * evidence and causal reasoning, or with assertion? Plus computed checks on
 * the reasoning style (market sizing top-down vs bottom-up).
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { LatentEvidence, LatentModule, QualityLevel } from "./types";
import { bases, coverage, lower, pageFromLocation, pagesOf, pct, round } from "./util";

export type MarketSizingStyle = "BOTTOM_UP" | "TOP_DOWN" | "MIXED" | "UNSTATED";

export interface QualityOfThinking extends LatentModule {
  level: QualityLevel;
  /** Share of the deck's key conclusions supported by evidence AND causal reasoning (0–100). */
  supportedPct: number | null;
  evidenceOnlyPct: number | null;
  assertionOnlyPct: number | null;
  conclusions: number;
  unsupportedConclusions: { conclusion: string; page: number | null }[];
  evidenceWithoutReasoning: { conclusion: string; page: number | null }[];
  marketSizing: { style: MarketSizingStyle; evidence: LatentEvidence[] };
  /** Share of key metric movements for which the deck gives a causal explanation (0–100). */
  explainedMovementsPct: number | null;
}

const TOP_DOWN_RE =
  /\bcagr\b|\bgrowing (at )?\d+(\.\d+)?\s?%|\b\d+(\.\d+)?\s?%\s*(annual|a year|per year|yoy|cagr)|according to (gartner|mckinsey|idc|statista|grand view|markets ?and ?markets|forrester|bcg|pitchbook|cb insights)|\$\s?\d+(\.\d+)?\s?(b|bn|billion|t|tn|trillion)\b[^.]{0,40}\bmarket|\bmarket\b[^.]{0,40}\$\s?\d+(\.\d+)?\s?(b|bn|billion|t|tn|trillion)\b|\b\d+\s?% of (the|a) \$?\d/;
const BOTTOM_UP_RE =
  /\b\d[\d,.]*\s?(k|m)?\s+(target |addressable |relevant )?(companies|customers|businesses|firms|clinics|hospitals|restaurants|fleets|accounts|sites|practices|stores|farms|schools|labs|banks|insurers|plants|warehouses|developers|teams|households)\b[^.]{0,80}(×|\bx\b|\*|\btimes\b|\bat\b|@)\s?\$?\s?\d|\b(acv|arpa|arpu|price per|per (customer|seat|site|account|year|clinic|unit))\b[^.]{0,60}(×|\bx\b|\*|\btimes\b)|\bbottom[- ]up\b/;

export function marketSizingStyle(deal: CanonicalDeal): QualityOfThinking["marketSizing"] {
  const texts: { text: string; page: number | null; source: "MODEL_OBSERVED" | "COMPUTED" }[] = [];
  const dm = deal.deckMarket;
  if (dm?.description) texts.push({ text: dm.description, page: null, source: "COMPUTED" });
  for (const m of [dm?.tam, dm?.sam, dm?.som]) if (m?.rawText) texts.push({ text: m.rawText, page: null, source: "COMPUTED" });
  for (const c of deal.claims ?? [])
    if (c.category === "MARKET") texts.push({ text: `${c.statement} ${c.valueText ?? ""} ${c.evidence.map((e) => e.excerpt).join(" ")}`, page: pageFromLocation(c.evidence[0]?.location), source: "COMPUTED" });
  for (const r of deal.latentSignals?.reasoningChains ?? [])
    if (/market|tam|sam|som/i.test(`${r.conclusion} ${r.chain}`)) texts.push({ text: `${r.conclusion} ${r.chain}`, page: r.page, source: "MODEL_OBSERVED" });
  const evidence: LatentEvidence[] = [];
  let top = false;
  let bottom = false;
  for (const t of texts) {
    const l = lower(t.text);
    const isBottom = BOTTOM_UP_RE.test(l);
    const isTop = TOP_DOWN_RE.test(l);
    if (isBottom) bottom = true;
    if (isTop) top = true;
    if (isBottom || isTop) evidence.push({ basis: t.source, text: `${isBottom ? "bottom-up" : "top-down"}: ${t.text.slice(0, 160)}`, page: t.page });
  }
  const style: MarketSizingStyle = top && bottom ? "MIXED" : bottom ? "BOTTOM_UP" : top ? "TOP_DOWN" : "UNSTATED";
  return { style, evidence: evidence.slice(0, 6) };
}

export function qualityOfThinking(deal: CanonicalDeal): QualityOfThinking {
  const ls = deal.latentSignals;
  const chains = ls?.reasoningChains ?? [];
  const n = chains.length;
  const supported = chains.filter((c) => c.support === "EVIDENCE_AND_CAUSAL_REASONING");
  const evidenceOnly = chains.filter((c) => c.support === "EVIDENCE_ONLY");
  const assertion = chains.filter((c) => c.support === "ASSERTION_ONLY");
  const sizing = marketSizingStyle(deal);
  const expl = ls?.causalExplanations ?? [];
  const explained = expl.filter((c) => !!c.explanationGiven?.trim()).length;

  let score: number | null = n ? (supported.length + 0.5 * evidenceOnly.length) / n : null;
  if (score !== null) {
    if (sizing.style === "BOTTOM_UP") score += 0.1;
    if (sizing.style === "TOP_DOWN") score -= 0.1;
    if (expl.length) score += 0.1 * (explained / expl.length - 0.5);
    score = Math.max(0, Math.min(1, round(score, 3)));
  }
  let level: QualityLevel;
  if (score === null || n < 3) level = "INSUFFICIENT_EVIDENCE";
  else if (score >= 0.8) level = "EXCEPTIONAL";
  else if (score >= 0.6) level = "STRONG";
  else if (score >= 0.35) level = "MODERATE";
  else level = "WEAK";

  return {
    basis: bases(n > 0 && "MODEL_OBSERVED", "COMPUTED"),
    pages: pagesOf([...chains.map((c) => c.page), ...sizing.evidence.map((e) => e.page)]),
    coverage: coverage(
      [n ? `${n} reasoning chains` : null, sizing.style !== "UNSTATED" ? "market sizing text" : null, expl.length ? "causal explanations" : null].filter((x): x is string => !!x),
      [n ? null : "model reasoning chains (latentSignals)", sizing.style !== "UNSTATED" ? null : "market sizing text", expl.length ? null : "causal explanations"].filter((x): x is string => !!x),
      n < 3 ? "Fewer than 3 reasoning chains: level not assessed; computed checks still reported." : null,
    ),
    rule:
      "Score = (conclusions with evidence + causal reasoning + ½ × evidence-only) / conclusions; +0.10 bottom-up market sizing, −0.10 top-down only; ±0.05 for the share of metric movements explained. EXCEPTIONAL ≥0.80, STRONG ≥0.60, MODERATE ≥0.35, else WEAK; <3 conclusions → INSUFFICIENT_EVIDENCE.",
    level,
    supportedPct: pct(supported.length, n),
    evidenceOnlyPct: pct(evidenceOnly.length, n),
    assertionOnlyPct: pct(assertion.length, n),
    conclusions: n,
    unsupportedConclusions: assertion.map((c) => ({ conclusion: c.conclusion, page: c.page })),
    evidenceWithoutReasoning: evidenceOnly.map((c) => ({ conclusion: c.conclusion, page: c.page })),
    marketSizing: sizing,
    explainedMovementsPct: pct(explained, expl.length),
  };
}
