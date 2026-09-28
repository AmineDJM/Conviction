/**
 * Numerical exercises. Every answer is computed by the engines from the deal
 * (calc/finance, economics trajectory, returns inputs); the user's number is
 * graded with a relative tolerance and the worked solution is shown.
 */
import { burnMultiple, cacPaybackMonths, cagr, runwayMonths } from "@/engine/calc/finance";
import { toUsd } from "@/engine/metrics/normalize";
import type { MetricInstance } from "@/domain/canonical";
import type { TrainingCase } from "./case";
import { deckReportedMetrics, pickFacts } from "./case";
import { caseLine, emptyKey, makeExercise } from "./exercise";
import { money } from "./format";
import { aiSummary, expertFocus, links, metricLink } from "./reveal";
import type { Concept, Exercise, NumericTask, Skill } from "./types";
import { NUMERIC_LABEL } from "./labels";

type Unit = "USD" | "PERCENT" | "MONTHS" | "MULTIPLE";

const HINT: Record<Unit, string> = {
  USD: "Dollars — e.g. 2.4B, 180M or 42k",
  PERCENT: "Percent — e.g. 12.5",
  MONTHS: "Months — e.g. 14",
  MULTIPLE: "Multiple — e.g. 1.8",
};

export function displayValue(unit: Unit, v: number): string {
  if (unit === "USD") return money(v);
  if (unit === "PERCENT") return `${v.toFixed(v < 10 ? 2 : 1)}%`;
  if (unit === "MONTHS") return `${v.toFixed(1)} months`;
  return `${v.toFixed(2)}×`;
}

interface Spec {
  task: NumericTask;
  unit: Unit;
  value: number;
  tolerance: number;
  level: number;
  skills: (Skill | null)[];
  concepts: Concept[];
  prompt: string;
  factIds: string[];
  steps: string[];
  alternative?: string[];
  focus?: string[];
  metricIds?: string[];
}

const usdOf = (m: { amount: number | null; currency: string } | null | undefined) => (m?.amount ? (toUsd(m.amount, m.currency)?.usd ?? null) : null);

/** Metric fact ids for a metric key (all deck-reported instances), used to hide the answer from the context. */
function factIdsFor(c: TrainingCase, keys: string[]): string[] {
  return deckReportedMetrics(c.deal).filter((m) => keys.includes(m.metricKey)).map((m) => `F-${m.id}`);
}

function deck(c: TrainingCase, key: string): MetricInstance | null {
  return c.deckMetrics[key] ?? null;
}

export function numericSpecs(c: TrainingCase): Spec[] {
  const d = c.deal;
  const specs: Spec[] = [];
  const f = d.financing;

  // RUNWAY = cash ÷ monthly net burn.
  const cash = deck(c, "cash_balance")?.normalizedValue ?? usdOf(f?.cashBalance) ?? null;
  const burn = deck(c, "monthly_net_burn")?.normalizedValue ?? usdOf(f?.monthlyBurn) ?? null;
  const factOf = (key: string, fallback: string, present: boolean) => (deck(c, key) ? `F-${deck(c, key)!.id}` : present ? fallback : null);
  const cashFact = factOf("cash_balance", "F-CASH", !!f?.cashBalance?.amount);
  const burnFact = factOf("monthly_net_burn", "F-BURN", !!f?.monthlyBurn?.amount);
  if (cash !== null && burn !== null && cashFact && burnFact) {
    const r = runwayMonths(cash, burn);
    if (r !== null) {
      const claim = deck(c, "runway_months")?.normalizedValue ?? f?.runwayClaimMonths ?? null;
      specs.push({
        task: "RUNWAY",
        unit: "MONTHS",
        value: r,
        tolerance: 0.05,
        level: 1,
        skills: [c.domainSkill, "RISK_DETECTION"],
        concepts: ["RUNWAY_FINANCING"],
        prompt: `${caseLine(c)}\n\nFrom the deck's cash and monthly net burn, how many months of runway does the company have before this round closes?`,
        factIds: [cashFact, burnFact],
        steps: [`Runway = cash ÷ monthly net burn = ${money(cash)} ÷ ${money(burn)} = ${r.toFixed(1)} months.`, ...(claim !== null ? [`The deck states ${claim} months — ${Math.abs(claim - r) / r > 0.1 ? `a ${(((claim - r) / r) * 100).toFixed(0)}% difference worth asking about.` : "consistent."}`] : [])],
        focus: ["Runway before a round is short by design; what matters is whether cash plus the round reaches the milestone that prices the next round."],
      });
    }
  }

  // IMPLIED ACV = ARR ÷ paying customers.
  const arr = deck(c, "arr");
  const cust = deck(c, "paying_customers");
  if (arr?.normalizedValue && cust?.normalizedValue && cust.normalizedValue > 0) {
    const acv = arr.normalizedValue / cust.normalizedValue;
    const stated = deck(c, "acv")?.normalizedValue ?? null;
    specs.push({
      task: "IMPLIED_ACV",
      unit: "USD",
      value: acv,
      tolerance: 0.05,
      level: 1,
      skills: ["SAAS_METRICS", "GTM"],
      concepts: ["UNIT_ECONOMICS"],
      prompt: `${caseLine(c)}\n\nWhat average annual contract value (ACV) do the deck's ARR and paying-customer count imply?`,
      factIds: [`F-${arr.id}`, `F-${cust.id}`],
      steps: [`Implied ACV = ARR ÷ paying customers = ${money(arr.normalizedValue)} ÷ ${cust.normalizedValue} = ${money(acv)}.`, ...(stated ? [`The deck states ACV ${money(stated)} (Δ ${(((stated - acv) / acv) * 100).toFixed(0)}%).`] : [])],
      focus: ["ACV sets which sales motion is affordable: below ~$25k, field sales rarely pays back; above ~$100k, a long enterprise cycle is expected."],
      metricIds: [arr.id, cust.id],
    });
  }

  // ENTRY OWNERSHIP & ROUND DILUTION (returns engine inputs).
  const entry = c.derived.returns?.inputs?.entry;
  const check = c.derived.returns?.inputs?.checkUsd ?? null;
  const post = entry?.postMoneyUsd ?? null;
  const raise = entry?.raiseUsd ?? null;
  const priceFacts = ["F-RAISE", "F-PRE", "F-POST", "F-CAP", "F-INSTRUMENT"];
  if (post && check && post > check) {
    const own = (check / post) * 100;
    specs.push({
      task: "ENTRY_OWNERSHIP",
      unit: "PERCENT",
      value: own,
      tolerance: 0.03,
      level: 1,
      skills: ["CAP_TABLES"],
      concepts: ["ENTRY_PRICE", "DILUTION"],
      prompt: `${caseLine(c)}\n\nYour fund writes a ${money(check)} check${entry?.instrument === "SAFE" || entry?.instrument === "CONVERTIBLE_NOTE" ? " at the valuation cap" : ""}. The round is priced at ${money(post)} ${entry?.instrument === "SAFE" ? "post-money cap" : "post-money"}. What ownership do you buy (fully diluted, at entry)?`,
      factIds: priceFacts,
      steps: [`Ownership = check ÷ post-money = ${money(check)} ÷ ${money(post)} = ${own.toFixed(2)}%.`, ...(entry?.instrument === "SAFE" ? ["A SAFE converts at the cap (or the discount, if better) — at the cap is the conservative reading."] : [])],
      focus: ["Entry ownership is diluted by every later round and pool refresh; the exit ownership is what pays."],
    });
  }
  if (post && raise && post > raise) {
    const dil = (raise / post) * 100;
    specs.push({
      task: "ROUND_DILUTION",
      unit: "PERCENT",
      value: dil,
      tolerance: 0.03,
      level: 2,
      skills: ["CAP_TABLES"],
      concepts: ["DILUTION"],
      prompt: `${caseLine(c)}\n\nThe company raises ${money(raise)} at ${money(post)} post-money. By what percentage are existing shareholders diluted in this round (before any option-pool top-up)?`,
      factIds: priceFacts,
      steps: [`Dilution = new money ÷ post-money = ${money(raise)} ÷ ${money(post)} = ${dil.toFixed(1)}%.`, `Existing holders keep ${(100 - dil).toFixed(1)}% of what they owned.`],
      focus: ["A pre-money option-pool top-up dilutes existing holders further — ask whether the pool is in the pre."],
    });
  }

  // CAC PAYBACK = CAC ÷ (ACV/12 × gross margin).
  const cac = deck(c, "cac");
  const gm = deck(c, "gross_margin");
  const acvM = deck(c, "acv");
  const acvValue = acvM?.normalizedValue ?? (arr?.normalizedValue && cust?.normalizedValue ? arr.normalizedValue / cust.normalizedValue : null);
  if (cac?.normalizedValue && gm?.normalizedValue && acvValue) {
    const p = cacPaybackMonths(cac.normalizedValue, acvValue, gm.normalizedValue);
    if (p !== null) {
      const incomplete = (c.derived.integrity?.findings ?? []).some((x) => x.kind === "CAC_INCOMPLETE" || x.kind === "CAC_NOT_FULLY_LOADED");
      specs.push({
        task: "CAC_PAYBACK",
        unit: "MONTHS",
        value: p,
        tolerance: 0.05,
        level: 2,
        skills: [c.domainSkill ?? "SAAS_METRICS", "GTM"],
        concepts: ["UNIT_ECONOMICS"],
        prompt: `${caseLine(c)}\n\nWhat is the gross-margin-adjusted CAC payback, in months?`,
        factIds: [`F-${cac.id}`, `F-${gm.id}`, ...(acvM ? [`F-${acvM.id}`] : [`F-${arr!.id}`, `F-${cust!.id}`])],
        steps: [
          ...(acvM ? [] : [`ACV = ARR ÷ customers = ${money(acvValue)}.`]),
          `Monthly gross profit per customer = ACV ÷ 12 × gross margin = ${money(acvValue)} ÷ 12 × ${gm.normalizedValue}% = ${money((acvValue / 12) * (gm.normalizedValue / 100))}.`,
          `Payback = CAC ÷ monthly gross profit = ${money(cac.normalizedValue)} ÷ ${money((acvValue / 12) * (gm.normalizedValue / 100))} = ${p.toFixed(1)} months.`,
          ...(incomplete ? ["The integrity engine flags this CAC as not fully loaded — the real payback is longer."] : []),
        ],
        focus: ["Payback on revenue instead of gross profit, or on a CAC that excludes salaries, is the most common flattering shortcut."],
        metricIds: [cac.id, gm.id],
      });
    }
  }

  // BURN MULTIPLE = 12 × monthly burn ÷ net new ARR over the last 12 months.
  const arrHist = deckReportedMetrics(d)
    .filter((m) => m.metricKey === "arr" && !m.isPrimary && m.periodEnd && arr?.periodEnd)
    .map((m) => ({ m, months: monthsBetween(m.periodEnd!, arr!.periodEnd!) }))
    .filter((x) => x.months !== null && x.months >= 10 && x.months <= 14)
    .sort((a, b) => Math.abs(12 - a.months!) - Math.abs(12 - b.months!))[0];
  if (arr?.normalizedValue && arrHist && burn !== null && burnFact) {
    const netNew = arr.normalizedValue - arrHist.m.normalizedValue!;
    const bm = burnMultiple(burn * 12, netNew);
    if (bm !== null) {
      specs.push({
        task: "BURN_MULTIPLE",
        unit: "MULTIPLE",
        value: bm,
        tolerance: 0.06,
        level: 3,
        skills: [c.domainSkill ?? "SAAS_METRICS", "RETURN_MODELING"],
        concepts: ["CAPITAL_EFFICIENCY"],
        prompt: `${caseLine(c)}\n\nAssuming the current monthly net burn held over the last year, what is the burn multiple?`,
        factIds: [`F-${arr.id}`, `F-${arrHist.m.id}`, burnFact],
        steps: [
          `Net new ARR = ${money(arr.normalizedValue)} − ${money(arrHist.m.normalizedValue)} = ${money(netNew)} over ${arrHist.months} months.`,
          `Net burn over the period ≈ 12 × ${money(burn)} = ${money(burn * 12)} (assumes constant burn — a real P&L would refine it).`,
          `Burn multiple = net burn ÷ net new ARR = ${bm.toFixed(2)}×.`,
        ],
        focus: ["Below 1× is excellent, 1–2× is healthy for Series A, above 2× means growth is being bought."],
        metricIds: [arr.id, arrHist.m.id],
      });
    }
  }

  // EXIT FOR 20× and FUND-RETURN EXIT — the economics engine (cap-table waterfall, dilution, preferences).
  const traj = c.derived.economics?.trajectory;
  const cm = traj?.capitalMultiple;
  if (cm?.modelable && cm.requiredExitEquityUsd && cm.exitOwnershipPct && cm.target.multiple) {
    const naive = cm.naiveExitEquityUsd;
    specs.push({
      task: "EXIT_FOR_20X",
      unit: "USD",
      value: cm.requiredExitEquityUsd,
      tolerance: 0.12,
      level: 4,
      skills: ["RETURN_MODELING", "CAP_TABLES"],
      concepts: ["RETURN_PATH", "DILUTION"],
      prompt: `${caseLine(c)}\n\nYou invest ${money(cm.investedUsd)} in total (${money(cm.checkUsd)} now${cm.followOnUsd > 0 ? ` + ${money(cm.followOnUsd)} follow-on` : ""}). After ${cm.roundsBeforeExit} further round${cm.roundsBeforeExit === 1 ? "" : "s"} you own ${cm.exitOwnershipPct.toFixed(2)}% fully diluted at exit, alongside a ${money(cm.preferenceStackAtExitUsd ?? 0)} liquidation-preference stack. What exit equity value returns ${cm.target.multiple}× your capital?`,
      factIds: priceFacts,
      steps: [
        `Target proceeds = ${cm.target.multiple} × ${money(cm.investedUsd)} = ${money(cm.target.requiredProceedsUsd ?? cm.target.multiple * cm.investedUsd)}.`,
        `Naive exit value = proceeds ÷ exit ownership = ${naive ? money(naive) : "n/a"}.`,
        `The cap-table waterfall (economics engine) solves for the exit value at which our proceeds equal the target, accounting for preferences: ${money(cm.requiredExitEquityUsd)}.`,
        ...cm.summary.slice(1, 3),
      ],
      alternative: naive ? [`If you answered ~${money(naive)}, you did the math right but ignored the preference stack; within ${(0.12 * 100).toFixed(0)}% tolerance it still counts.`] : [],
      focus: [`The question is not the exit value; it is whether ${money(cm.requiredExitEquityUsd)} is plausible: ${cm.plausibility.toLowerCase()} (${cm.summary[cm.summary.length - 1] ?? ""}).`],
    });
    const rev0 = cm.current.revenueUsd;
    const ref = cm.byMultiple.find((r) => r.revenueMultiple === cm.referenceMultiple) ?? null;
    if (rev0 && rev0 > 0 && cm.yearsToExit > 0) {
      const required = cm.requiredExitEquityUsd / cm.referenceMultiple;
      const g = cagr(rev0, required, cm.yearsToExit);
      if (g !== null) {
        specs.push({
          task: "REQUIRED_CAGR",
          unit: "PERCENT",
          value: g * 100,
          tolerance: 0.06,
          level: 3,
          skills: ["RETURN_MODELING", c.domainSkill],
          concepts: ["RETURN_PATH", "GROWTH_QUALITY"],
          prompt: `${caseLine(c)}\n\nTo return ${cm.target.multiple}× your capital the company must exit at ${money(cm.requiredExitEquityUsd)} in ${cm.yearsToExit} years. At ${cm.referenceMultiple}× revenue, what annual revenue growth (CAGR) does that require from today's ${money(rev0)} (${cm.current.revenueSource})?`,
          factIds: [],
          steps: [
            `Required revenue = exit value ÷ multiple = ${money(cm.requiredExitEquityUsd)} ÷ ${cm.referenceMultiple} = ${money(required)}.`,
            `CAGR = (required ÷ current)^(1/years) − 1 = (${money(required)} ÷ ${money(rev0)})^(1/${cm.yearsToExit}) − 1 = ${(g * 100).toFixed(1)}%.`,
            cm.growthPersistence.explanation,
          ],
          focus: [`Growth decays: sustaining ${(g * 100).toFixed(0)}% for ${cm.yearsToExit} years is a different claim from growing ${(g * 100).toFixed(0)}% next year.${ref?.samSharePct ? ` It also means ${ref.samSharePct.toFixed(1)}% of the reconstructed SAM.` : ""}`],
        });
      }
    }
  }
  const ft = traj?.fundTarget;
  if (ft?.modelable && ft.requiredExitEquityUsd && ft.target.contributionUsd && ft.exitOwnershipPct) {
    specs.push({
      task: "FUND_RETURN_EXIT",
      unit: "USD",
      value: ft.requiredExitEquityUsd,
      tolerance: 0.12,
      level: 4,
      skills: ["RETURN_MODELING"],
      concepts: ["RETURN_PATH", "ENTRY_PRICE"],
      prompt: `${caseLine(c)}\n\nYour fund needs a winner to contribute ${money(ft.target.contributionUsd)}. With ${ft.exitOwnershipPct.toFixed(2)}% fully diluted at exit (after ${ft.roundsBeforeExit} further rounds) and a ${money(ft.preferenceStackAtExitUsd ?? 0)} preference stack, what exit equity value does this deal need?`,
      factIds: priceFacts,
      steps: [
        `Naive: ${money(ft.target.contributionUsd)} ÷ ${ft.exitOwnershipPct.toFixed(2)}% = ${ft.naiveExitEquityUsd ? money(ft.naiveExitEquityUsd) : "n/a"}.`,
        `Cap-table waterfall solve (economics engine): ${money(ft.requiredExitEquityUsd)}.`,
        ...ft.summary.slice(1, 2),
      ],
      focus: ["Fund math, not deal math: a deal that cannot plausibly return the fund target must be justified another way."],
    });
  }

  // NET REVENUE FROM GMV (marketplaces).
  const gmv = deck(c, "gmv");
  const take = deck(c, "take_rate");
  if (gmv?.normalizedValue && take?.normalizedValue) {
    const net = (gmv.normalizedValue * take.normalizedValue) / 100;
    specs.push({
      task: "NET_REVENUE_FROM_GMV",
      unit: "USD",
      value: net,
      tolerance: 0.05,
      level: 1,
      skills: ["MARKETPLACE_ECONOMICS"],
      concepts: ["GROWTH_QUALITY"],
      prompt: `${caseLine(c)}\n\nWhat net revenue does the deck's GMV and take rate imply?`,
      factIds: [`F-${gmv.id}`, `F-${take.id}`],
      steps: [`Net revenue = GMV × take rate = ${money(gmv.normalizedValue)} × ${take.normalizedValue}% = ${money(net)}.`, "Valuation multiples apply to net revenue, never to GMV."],
      focus: ["A marketplace priced on GMV is priced on money it never keeps."],
      metricIds: [gmv.id, take.id],
    });
  }
  return specs;
}

function monthsBetween(a: string, b: string): number | null {
  const pa = /^(\d{4})-(\d{2})/.exec(a);
  const pb = /^(\d{4})-(\d{2})/.exec(b);
  if (!pa || !pb) return null;
  return (Number(pb[1]) - Number(pa[1])) * 12 + (Number(pb[2]) - Number(pa[2]));
}

export function numericExercises(c: TrainingCase): Exercise[] {
  return numericSpecs(c).map((s) => {
    const key = emptyKey();
    const display = displayValue(s.unit, s.value);
    key.numeric = { value: s.value, tolerance: s.tolerance, unit: s.unit, display };
    key.answer = `${NUMERIC_LABEL[s.task]}: ${display} (tolerance ±${(s.tolerance * 100).toFixed(0)}%).`;
    key.workedSolution = s.steps;
    key.alternativeReasoning = s.alternative ?? [];
    key.aiAnalysis = aiSummary(c);
    key.expertFocus = [...(s.focus ?? []), ...expertFocus(c).slice(0, 2)];
    key.evidence = links(...(s.metricIds ?? []).map((id) => metricLink(c, id)), { label: "Return model", href: `/deals/${c.ref.slug}/returns` });
    key.concepts = s.concepts;
    // Hide any fact that states the answer (e.g. the deck's own runway or ACV).
    const hidden = new Set(
      {
        RUNWAY: [...factIdsFor(c, ["runway_months"]), "F-RUNWAY-CLAIM"],
        IMPLIED_ACV: factIdsFor(c, ["acv"]),
        CAC_PAYBACK: factIdsFor(c, ["cac_payback_months"]),
        BURN_MULTIPLE: factIdsFor(c, ["burn_multiple"]),
        NET_REVENUE_FROM_GMV: factIdsFor(c, ["revenue_ttm", "arr"]),
      }[s.task as string] ?? [],
    );
    return makeExercise({
      c,
      kind: "NUMERIC",
      variant: s.task,
      skills: s.skills,
      level: s.level,
      title: NUMERIC_LABEL[s.task],
      prompt: s.prompt,
      context: pickFacts(c, s.factIds).filter((x) => !hidden.has(x.id)),
      input: { type: "numeric", unit: s.unit, hint: HINT[s.unit] },
      key,
    });
  });
}
