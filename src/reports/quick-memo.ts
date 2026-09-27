/**
 * QUICK MEMO (§68–70, §98) — deterministic renderer: canonical + derived →
 * short, structured lines. No model calls; every number is read from the
 * canonical object or the derived analysis, never re-computed differently.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import type { QuestionTier } from "@/domain/enums";
import { DECISION_LABEL, STAGE_LABEL, usd } from "@/lib/format";
import { brief, clip, enumLabel as titleCase, stripRefs } from "./text";

export interface QuickMemo {
  name: string;
  oneLiner: string;
  facts: { label: string; value: string }[];
  product: { type: string; whatItDoes: string; user: string; buyer: string } | null;
  businessModel: { how: string; pricing: string | null; revenueModel: string } | null;
  gtm: { motion: string; channels: string; cycle: string | null; founderLed: string } | null;
  founders: { name: string; role: string; background: string; fmf: string }[];
  market: { range: string | null; method: string | null; wedge: string | null; deckTam: string | null; inflation: string | null } | null;
  competitors: { name: string; type: string }[];
  strength: { claim: string; rating: string } | null;
  fatalQuestion: string | null;
  likes: string[];
  worries: string[];
  view: { status: string; label: string; rationale: string; exceptionalOverride: boolean; nextAction: string | null };
  questions: { id: string; tier: QuestionTier; text: string }[];
  analysis: { depth: "FULL" | "PARTIAL"; mode: string; partialReasons: string[] };
}

const TIER_ORDER: QuestionTier[] = ["MUST_ASK", "IMPORTANT", "OPTIONAL"];

export function buildQuickMemo(c: CanonicalDeal, d: DerivedAnalysis, company?: { country?: string | null }): QuickMemo {
  const entry = d.returns.inputs.entry;
  const isSafe = entry.instrument === "SAFE" || entry.instrument === "CONVERTIBLE_NOTE";
  const sector = [...c.classification.industry.map(titleCase), ...c.classification.productType.slice(0, 2).map(titleCase)].join(" · ");

  const facts = [
    { label: "Sector", value: sector || "—" },
    { label: "Stage", value: `${STAGE_LABEL[c.classification.financingStage] ?? "—"} · ${titleCase(c.classification.operationalMaturity)}` },
    ...(c.identity.hqCountry ?? company?.country ? [{ label: "Country", value: (c.identity.hqCountry ?? company?.country)! }] : []),
    { label: "Round", value: entry.raiseUsd ? `${usd(entry.raiseUsd)} ${titleCase(entry.instrument)}` : titleCase(entry.instrument) },
    { label: isSafe ? "Cap" : "Post-money", value: entry.postMoneyUsd ? usd(entry.postMoneyUsd) : "Not disclosed" },
  ];

  const primary = d.market.primary;
  const rec = d.recommendation;

  const questions = [...c.questions]
    .filter((q) => q.status !== "RESOLVED")
    .sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier))
    .slice(0, 8)
    .map((q) => ({ id: q.id, tier: q.tier, text: clip(stripRefs(q.question), 190) }));

  return {
    name: c.identity.name,
    oneLiner: stripRefs(c.identity.oneLiner),
    facts,
    product: c.product
      ? {
          type: brief(c.product.whatItIs, 90),
          whatItDoes: brief(c.product.whatItDoes, 150),
          user: brief(c.product.user, 80),
          buyer: brief(c.product.buyer, 80),
        }
      : null,
    businessModel: c.businessModel
      ? {
          how: brief(c.businessModel.howItMakesMoney, 140),
          pricing: c.businessModel.pricing ? brief(c.businessModel.pricing, 100) : null,
          revenueModel: c.classification.revenueModel.map(titleCase).join(", ") || "—",
        }
      : null,
    gtm: c.gtm
      ? {
          motion: brief(c.gtm.salesMotion, 130),
          channels: clip(c.gtm.channels.map(stripRefs).join(", "), 110) || "—",
          cycle: c.gtm.salesCycle ? brief(c.gtm.salesCycle, 60) : null,
          founderLed: brief(c.gtm.founderLedAssessment, 120),
        }
      : null,
    founders: (c.founders.length ? c.founders : c.foundersFromDeck.map((f) => ({ ...f, summary: f.backgroundFromDeck, founderMarketFit: "" }))).slice(0, 4).map((f) => ({
      name: f.name,
      role: f.role,
      background: brief(f.backgroundFromDeck || f.summary, 120),
      fmf: f.founderMarketFit ? brief(f.founderMarketFit, 120) : "Not assessed",
    })),
    market:
      primary || c.market
        ? {
            range: primary ? `${usd(primary.lowUsd)}–${usd(primary.highUsd)}` : null,
            method: primary ? titleCase(primary.method) : null,
            wedge: c.market ? brief(c.market.wedge, 130) : null,
            deckTam: d.market.deckTamUsd ? usd(d.market.deckTamUsd) : null,
            inflation: d.market.deckInflation ? `${d.market.deckInflation.toFixed(1)}×` : null,
          }
        : null,
    competitors: (c.competition?.competitors ?? [])
      .slice()
      .sort((a, b) => ["DIRECT", "INCUMBENT", "EMERGING", "INDIRECT", "INTERNAL_SOLUTION", "DO_NOTHING"].indexOf(a.type) - ["DIRECT", "INCUMBENT", "EMERGING", "INDIRECT", "INTERNAL_SOLUTION", "DO_NOTHING"].indexOf(b.type))
      .slice(0, 5)
      .map((x) => ({ name: x.name, type: titleCase(x.type) })),
    strength: c.exceptionalStrengths[0] ? { claim: clip(stripRefs(c.exceptionalStrengths[0].claim), 240), rating: titleCase(c.exceptionalStrengths[0].rating) } : null,
    fatalQuestion: c.thesis ? clip(stripRefs(c.thesis.fatalQuestion), 240) : null,
    likes: c.whatILike.slice(0, 3).map((x) => clip(stripRefs(x), 170)),
    worries: c.whatWorriesMe.slice(0, 3).map((x) => clip(stripRefs(x), 170)),
    view: {
      status: rec.status,
      label: DECISION_LABEL[rec.status] ?? titleCase(rec.status),
      rationale: brief(rec.rationale.replace(/^Model suggested [A-Z_]+, which the gates do not admit\. Applied [A-Z_]+\.\s*/, ""), 170),
      exceptionalOverride: rec.exceptionalOverride,
      nextAction: c.nextBestAction ? brief(c.nextBestAction.action, 150) : null,
    },
    questions,
    analysis: { depth: c.analysis.depth, mode: c.analysis.mode, partialReasons: c.analysis.partialReasons },
  };
}
