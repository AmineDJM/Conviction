/**
 * Chat computations — "AI interprets. Code calculates."
 *
 * Questions that ask for a number the record does not contain but the
 * economics engine can compute (required trajectory for an Nx outcome at a
 * given price, counterfactual shocks) are detected deterministically, computed
 * by the engine, and handed to the answer model as a labelled COMPUTED
 * context item. The model explains; it never does the arithmetic.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import type { FundProfile } from "@/domain/fund";
import type { DerivedAnalysis } from "@/engine/derive";
import type { BenchmarkRegistry } from "@/engine/benchmarks/types";
import { requiredTrajectory, runCounterfactual, type BuiltInScenarioId, type EconomicsContext, type TrajectoryResult } from "@/engine/economics";
import { summarizeCounterfactual } from "@/engine/economics/counterfactuals";
import { usd } from "@/lib/format";

export type ComputeRequest =
  | { kind: "TRAJECTORY"; entryPostMoneyUsd: number | null; targetMultiple: number | null; targetContributionUsd: number | null; yearsToExit: number | null }
  | { kind: "COUNTERFACTUAL"; scenarios: BuiltInScenarioId[] };

/** Money suffixes, longest first, each ending on a boundary ("Md" is 1e9, never "M" + "d"; "months" is not "m"). */
const UNIT = String.raw`(?:md|milliards?|mds?|bn|b|millions?|mm|m|k)(?![a-zà-ÿ])`;
/** A number: "1,250" (thousands grouping), "1,5" / "1.5" (decimal), "42". */
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;
const TIME_AHEAD = String.raw`(?!\s*(?:ans?|years?|yrs?|months?|mois)(?![a-zà-ÿ]))`;
/** An amount that is money: a currency symbol/word or a scale suffix is required ("à 7 ans", "at 60 months" are not prices). */
const MONEY = String.raw`(?:[$€]\s*(?:${NUM})${TIME_AHEAD}(?:\s*${UNIT})?|(?:${NUM})${TIME_AHEAD}\s*${UNIT}(?:\s*[$€])?|(?:${NUM})${TIME_AHEAD}\s*(?:[$€]|usd|eur|dollars?|euros?)(?![a-zà-ÿ]))`;

/** "$42M", "42 M$", "42m", "1,5 Md", "2 milliards", "1,250M" → USD amount (currency symbols are not converted). */
export function parseMoney(s: string): number | null {
  const m = new RegExp(String.raw`(${NUM})\s*(${UNIT})?`, "i").exec(s);
  if (!m) return null;
  const n = Number(/^\d{1,3}(?:,\d{3})+/.test(m[1]!) ? m[1]!.replace(/,/g, "") : m[1]!.replace(",", "."));
  const u = (m[2] ?? "").toLowerCase();
  const f = u === "k" ? 1e3 : u === "md" || u === "mds" || u.startsWith("milliard") || u === "b" || u === "bn" ? 1e9 : u === "m" || u === "mm" || u.startsWith("million") ? 1e6 : 1;
  return Number.isFinite(n) ? n * f : null;
}

const CF: [RegExp, BuiltInScenarioId][] = [
  [/cac\s*(x|×|\*)\s*2|cac (double|doubles|doubled)|double(s|d)? (the |le )?cac|cac (qui )?double/i, "CAC_X2"],
  [/(next|prochain) (round|tour).{0,40}(12|douze)\s*(months|mois)|\+\s*12\s*(months|mois)|(round|tour).{0,30}(slip|late|retard|d[ée]cal)/i, "NEXT_ROUND_DELAY_12M"],
  [/(entry )?valuation\s*(x|×|\*)\s*2|valo(risation)?\s*(x|×|\*)\s*2|(valuation|valo(risation)?|prix d'entr[ée]e|entry price).{0,20}(double|doubl)/i, "ENTRY_VALUATION_X2"],
  [/openai|commoditi|10\s*(x|×) (cheaper|moins cher)|(ia|ai|llm|inference) .{0,20}(moins ch[eè]re|cheaper)/i, "COMMODITIZATION"],
  [/bundle|gratuit|for free|free (feature|version)|incumbent (gives|offers)/i, "INCUMBENT_BUNDLES_FREE"],
];

export function detectCompute(question: string): ComputeRequest | null {
  const q = question.replace(/ | /g, " ");
  const scenarios = CF.filter(([re]) => re.test(q)).map(([, id]) => id);
  const multiple = /(\d+(?:[.,]\d+)?)\s*(x|×|fois)(?![\wà-ÿ])/i.exec(q);
  const wantsTrajectory = /trajectoire|trajectory|what (would|must|does) .{0,40}(need|take|have to)|what (would|must|has to) happen|que faut-il|minimum|minimale|required|n[ée]cessaire|pour (que|retourner)|to return|retourne/i.test(q);
  if (scenarios.length && !(wantsTrajectory && multiple)) return { kind: "COUNTERFACTUAL", scenarios: [...new Set(scenarios)] };
  if (!wantsTrajectory) return null;
  const price = new RegExp(String.raw`(?:à|\bat|@)\s*(${MONEY})`, "i").exec(q);
  const contribution = new RegExp(String.raw`(?:return|retourner|rapporter)\s+(${MONEY})`, "i").exec(q);
  const years = /(\d+)\s*(?:ans|years|yrs)\b/i.exec(q);
  const months = /(\d+)\s*(?:mois|months)(?![a-zà-ÿ])/i.exec(q);
  const yearsToExit = years ? Number(years[1]) : months && Number(months[1]) >= 12 && Number(months[1]) % 12 === 0 ? Number(months[1]) / 12 : null;
  const targetMultiple = multiple ? Number(multiple[1]!.replace(",", ".")) : null;
  if (!targetMultiple && !contribution) return null;
  return {
    kind: "TRAJECTORY",
    entryPostMoneyUsd: price ? parseMoney(price[1]!) : null,
    targetMultiple,
    targetContributionUsd: !targetMultiple && contribution ? parseMoney(contribution[1]!) : null,
    yearsToExit,
  };
}

export function economicsContext(deal: CanonicalDeal, derived: DerivedAnalysis, registry: BenchmarkRegistry, fund: FundProfile): EconomicsContext {
  return { deal, registry, fund, returns: derived.returns, backwards: derived.backwards, market: derived.market };
}

const pctTxt = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n.toFixed(0)}%`);
const x = (n: number | null | undefined) => (n === null || n === undefined ? "n/a" : `${n.toFixed(2)}×`);

export function trajectoryText(t: TrajectoryResult): string {
  if (!t.modelable) return `COMPUTED — not modelable: ${t.reasons.join("; ")}`;
  const lines = [
    `COMPUTED by the economics engine (cap-table model with future rounds, pool refreshes, follow-on and liquidation preferences). Question: ${t.question}`,
    `Entry post-money ${usd(t.entryPostMoneyUsd)}; we invest ${usd(t.checkUsd)} + follow-on ${usd(t.followOnUsd)} = ${usd(t.investedUsd)}; ${t.roundsBeforeExit} more round(s) before exit in ${t.yearsToExit} years; exit ownership ${t.exitOwnershipPct?.toFixed(2) ?? "n/a"}%.`,
    `Target: ${t.target.kind === "MULTIPLE" ? `${t.target.multiple}× our capital` : usd(t.target.contributionUsd)} → required proceeds ${usd(t.target.requiredProceedsUsd)} → required exit equity ${usd(t.requiredExitEquityUsd)} (naive ownership-only answer ${usd(t.naiveExitEquityUsd)}; preference stack at exit ${usd(t.preferenceStackAtExitUsd)}).`,
    `Current: revenue ${usd(t.current.revenueUsd)} (${t.current.revenueSource}), ARPA ${usd(t.current.arpaUsd)} (${t.current.arpaSource}), customers ${t.current.customers ?? "n/a"}, NRR ${pctTxt(t.current.nrrPct)}.`,
    `Required revenue by exit multiple: ${t.byMultiple.map((r) => `${r.revenueMultiple}× → ${usd(r.requiredRevenueUsd)} (CAGR ${pctTxt(r.requiredCagrPct)}, ~${r.requiredCustomers ?? "n/a"} customers, ${pctTxt(r.samSharePct)} of SAM: ${r.samPlausibility})`).join("; ")}.`,
    `Minimum path (reference ${t.referenceMultiple}×): ${t.path.map((y) => `Y${y.year} ${usd(y.minRevenueUsd)}${y.customers !== null ? ` / ${Math.round(y.customers)} cust.` : ""}${y.newLogos !== null ? ` / ${Math.round(y.newLogos)} new logos` : ""}`).join(" → ")}.`,
    `Growth persistence (MODEL_ASSUMPTION, ${Math.round(t.growthPersistence.decayPerYear * 100)}%/yr decay): ${t.growthPersistence.explanation}`,
    `Overall plausibility: ${t.plausibility}.`,
    ...t.summary,
  ];
  return lines.join("\n");
}

export function runCompute(req: ComputeRequest, ctx: EconomicsContext): { title: string; text: string } {
  if (req.kind === "TRAJECTORY") {
    const t = requiredTrajectory(ctx, {
      ...(req.targetMultiple ? { targetMultiple: req.targetMultiple } : {}),
      ...(req.targetContributionUsd ? { targetContributionUsd: req.targetContributionUsd } : {}),
      ...(req.entryPostMoneyUsd ? { entryPostMoneyUsd: req.entryPostMoneyUsd } : {}),
      ...(req.yearsToExit ? { yearsToExit: req.yearsToExit } : {}),
    });
    return { title: `Computed trajectory — ${req.targetMultiple ? `${req.targetMultiple}× our capital` : usd(req.targetContributionUsd)}${req.entryPostMoneyUsd ? ` at ${usd(req.entryPostMoneyUsd)} post` : ""}`, text: trajectoryText(t) };
  }
  const parts = req.scenarios.map((id) => {
    const s = summarizeCounterfactual(runCounterfactual(ctx, id));
    const b = s.base;
    const c = s.scenario;
    return [
      `SCENARIO ${s.label} — ${s.description}`,
      `BASE MOIC ${x(b.moic.BASE)} → ${x(c.moic.BASE)}; BULL ${x(b.moic.BULL)} → ${x(c.moic.BULL)}; OUTLIER ${x(b.moic.OUTLIER)} → ${x(c.moic.OUTLIER)}.`,
      `Required CAGR ${pctTxt(b.requiredCagrPct)} → ${pctTxt(c.requiredCagrPct)}; trajectory ${b.trajectoryPlausibility} → ${c.trajectoryPlausibility}; financing risk ${b.financingRisk} → ${c.financingRisk}; runway ${b.runwayMonths?.toFixed(1) ?? "n/a"} → ${c.runwayMonths?.toFixed(1) ?? "n/a"} mo; CAC payback ${b.cacPaybackMonths?.toFixed(1) ?? "n/a"} → ${c.cacPaybackMonths?.toFixed(1) ?? "n/a"} mo; burn multiple ${b.burnMultiple?.toFixed(2) ?? "n/a"} → ${c.burnMultiple?.toFixed(2) ?? "n/a"}.`,
      `Worse: ${s.worse.join(", ") || "none"}. Better: ${s.better.join(", ") || "none"}.`,
      s.crossedBreakpoints.length ? `Breakpoints crossed: ${s.crossedBreakpoints.map((p) => p.variable).join(", ")}.` : "No sensitivity breakpoint crossed.",
      s.headline,
    ].join("\n");
  });
  return { title: `Computed counterfactual${req.scenarios.length > 1 ? "s" : ""} — ${req.scenarios.join(", ")}`, text: `COMPUTED by the economics engine; every shock constant is a stated MODEL_ASSUMPTION.\n\n${parts.join("\n\n")}` };
}
