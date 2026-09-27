/**
 * 2. IMPLIED METRICS ENGINE — "the equations between slides".
 *
 * Every relation that can be computed from the deck is computed and compared
 * with the value the deck states. Tolerance-based severity on the relative
 * delta |stated − implied| / |implied|:
 *   < 2% rounding (CONSISTENT) · 2–10% LOW · 10–25% MODERATE · 25–50% HIGH · > 50% CRITICAL.
 * Relations that are logical bounds (SOM ≤ SAM ≤ TAM, top-1 ≤ top-5 …) or
 * ratios with a wide natural range (deck TAM vs price × customers) use the
 * explicit thresholds documented on each row.
 */
import type { MetricInstance } from "@/domain/canonical";
import { reconstructMarket } from "../market";
import type { IntegrityContext } from "./context";
import type { ImpliedMetric, IntegrityFinding, IntegritySeverity } from "./types";
import { arr, finding, fmtNum, fmtUsd, isNum, moneyUsd, relDeltaPct, round, severityForDeltaPct, str } from "./util";

/** Fully-loaded monthly cost per new hire used by the hiring-plan check. MODEL ASSUMPTION. */
export const HIRE_MONTHLY_COST_USD = 12_500;
/** Deck TAM / (price × realistic customers) above this ratio is flagged. */
export const TAM_RATIO_THRESHOLDS = { MODERATE: 3, HIGH: 10, CRITICAL: 30 } as const;

type Unit = ImpliedMetric["unit"];

interface Rel {
  name: string;
  label: string;
  formula: string;
  unit: Unit;
  inputs: (string | null | undefined)[];
  missing: string[];
  implied: number | null;
  stated: number | null;
  note?: string;
  /** Compare growth rates as multipliers (1 + g) rather than raw percentages. */
  multiplier?: boolean;
}

function compare(r: Rel): ImpliedMetric {
  const inputs = [...new Set(r.inputs.filter((x): x is string => !!x))];
  const base = { id: `IMP-${r.name}`, name: r.name, formula: r.formula, inputs, missingInputs: r.missing, unit: r.unit };
  const implied = isNum(r.implied) ? round(r.implied, 4) : null;
  const stated = isNum(r.stated) ? round(r.stated, 4) : null;
  if (implied === null || stated === null)
    return { ...base, impliedValue: implied, statedValue: stated, deltaPct: null, verdict: "UNVERIFIABLE", severity: null, note: r.note ?? (implied === null ? `Cannot compute ${r.label.toLowerCase()}.` : "No stated value to compare.") };
  const delta = r.multiplier ? relDeltaPct(1 + stated / 100, 1 + implied / 100) : relDeltaPct(stated, implied);
  const sev = severityForDeltaPct(delta);
  return {
    ...base,
    impliedValue: implied,
    statedValue: stated,
    deltaPct: Number.isFinite(delta) ? round(delta, 2) : null,
    verdict: sev ? "INCONSISTENT" : "CONSISTENT",
    severity: sev,
    note: r.note ?? (sev ? `Stated ${fmtVal(stated, r.unit)} vs implied ${fmtVal(implied, r.unit)}.` : "Within rounding tolerance (< 2%)."),
  };
}

function custom(r: Omit<Rel, "multiplier"> & { verdict: ImpliedMetric["verdict"]; severity: IntegritySeverity | null; deltaPct: number | null; note: string }): ImpliedMetric {
  return {
    id: `IMP-${r.name}`,
    name: r.name,
    formula: r.formula,
    inputs: [...new Set(r.inputs.filter((x): x is string => !!x))],
    missingInputs: r.missing,
    unit: r.unit,
    impliedValue: isNum(r.implied) ? round(r.implied, 4) : null,
    statedValue: isNum(r.stated) ? round(r.stated, 4) : null,
    deltaPct: isNum(r.deltaPct) ? round(r.deltaPct, 2) : null,
    verdict: r.verdict,
    severity: r.severity,
    note: r.note,
  };
}

function fmtVal(v: number | null, unit: Unit): string {
  if (v === null) return "n/a";
  switch (unit) {
    case "USD":
      return fmtUsd(v);
    case "PERCENT":
      return `${fmtNum(v, 1)}%`;
    case "MONTHS":
      return `${fmtNum(v, 1)} months`;
    case "MULTIPLE":
      return `${fmtNum(v, 2)}×`;
    default:
      return fmtNum(v, 2);
  }
}

const need = (missing: string[], name: string, v: unknown) => {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) missing.push(name);
};
const val = (m: MetricInstance | null) => (m && isNum(m.normalizedValue) ? m.normalizedValue : null);

function ratioSeverity(ratio: number): IntegritySeverity | null {
  if (ratio > TAM_RATIO_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (ratio > TAM_RATIO_THRESHOLDS.HIGH) return "HIGH";
  if (ratio > TAM_RATIO_THRESHOLDS.MODERATE) return "MODERATE";
  if (ratio < 1 / TAM_RATIO_THRESHOLDS.MODERATE) return "LOW";
  return null;
}

/** "hire 12 engineers", "12 new hires", "grow the team to 40" → hires (target minus current when "to N"). */
export function parseHires(texts: string[], currentHeadcount: number | null): number | null {
  let total = 0;
  let found = false;
  for (const t of texts) {
    const s = t.toLowerCase();
    const to = /\b(?:grow|scale|expand)\w*\s+(?:the\s+)?(?:team|headcount)\s+to\s+(\d{1,4})\b/.exec(s);
    if (to) {
      if (isNum(currentHeadcount)) {
        total += Math.max(0, Number(to[1]) - currentHeadcount);
        found = true;
      }
      continue;
    }
    const a = /\b(?:hire|hiring|recruit\w*|add|adding)\s+(\d{1,4})\b/.exec(s);
    const b = /\b(\d{1,4})\s+(?:new\s+|additional\s+)?(?:hires|engineers|people|employees|ftes?|sales ?reps|reps|aes|account executives|salespeople|developers|scientists)\b/.exec(s);
    const n = a ? Number(a[1]) : b ? Number(b[1]) : null;
    if (n !== null) {
      total += n;
      found = true;
    }
  }
  return found ? total : null;
}

export function impliedMetrics(ctx: IntegrityContext): { rows: ImpliedMetric[]; findings: IntegrityFinding[] } {
  const rows: ImpliedMetric[] = [];
  const d = ctx.deal;
  const f = d.financing;
  const fp = d.financingPath;

  const arrM = ctx.primary("arr");
  const custM = ctx.primary("paying_customers");
  const arrV = val(arrM);
  const custV = val(custM);

  /* ACV = ARR / customers ------------------------------------------ */
  {
    const missing: string[] = [];
    need(missing, "arr", arrV);
    need(missing, "paying_customers", custV);
    const stated = ctx.stated("acv");
    const implied = arrV !== null && custV !== null && custV > 0 ? arrV / custV : null;
    rows.push(compare({ name: "ACV", label: "Implied ACV", formula: "ARR / paying customers", unit: "USD", inputs: [arrM?.id, custM?.id, stated?.id], missing, implied, stated: val(stated) }));
  }

  /* MRR × 12 = ARR -------------------------------------------------- */
  {
    const mrr = ctx.stated("mrr");
    const arrS = ctx.stated("arr");
    const missing: string[] = [];
    need(missing, "mrr", val(mrr));
    need(missing, "arr (reported)", val(arrS));
    const samePeriod = !mrr || !arrS || !mrr.periodEnd || !arrS.periodEnd || mrr.periodEnd.slice(0, 7) === arrS.periodEnd.slice(0, 7);
    const annualizedFromMonthly = arrS?.qualityFlags.some((x) => x.startsWith("MONTHLY_FIGURE_LABELLED_ARR")) ?? false;
    rows.push(
      compare({
        name: "ARR_VS_MRR",
        label: "ARR vs MRR × 12",
        formula: "MRR × 12",
        unit: "USD",
        inputs: [mrr?.id, arrS?.id],
        missing,
        implied: samePeriod && !annualizedFromMonthly && val(mrr) !== null ? val(mrr)! * 12 : null,
        stated: val(arrS),
        note: !samePeriod ? "MRR and ARR are for different periods." : undefined,
      }),
    );
  }

  /* Runway: pre-round cash / burn, post-round (cash + raise) / planned burn */
  const cashUsd = moneyUsd(f?.cashBalance) ?? val(ctx.primary("cash_balance"));
  const burnUsd = moneyUsd(f?.monthlyBurn) ?? val(ctx.primary("monthly_net_burn"));
  const raiseUsd = moneyUsd(f?.raiseAmount);
  const plannedBurn = isNum(fp?.plannedMonthlyBurnUsd) && fp.plannedMonthlyBurnUsd > 0 ? fp.plannedMonthlyBurnUsd : null;
  const preRunway = cashUsd !== null && burnUsd !== null && burnUsd > 0 ? cashUsd / burnUsd : null;
  const postBurn = plannedBurn ?? (burnUsd !== null && burnUsd > 0 ? burnUsd : null);
  const postRunway = postBurn !== null && (cashUsd !== null || raiseUsd !== null) && raiseUsd !== null ? ((cashUsd ?? 0) + raiseUsd) / postBurn : null;
  {
    const statedRunwayMetric = ctx.stated("runway_months");
    const stated = isNum(f?.runwayClaimMonths) ? f.runwayClaimMonths : val(statedRunwayMetric);
    const inputs = [
      f?.cashBalance ? "financing.cashBalance" : ctx.primary("cash_balance")?.id,
      f?.monthlyBurn ? "financing.monthlyBurn" : ctx.primary("monthly_net_burn")?.id,
      raiseUsd !== null ? "financing.raiseAmount" : null,
      plannedBurn !== null ? "financingPath.plannedMonthlyBurnUsd" : null,
      isNum(f?.runwayClaimMonths) ? "financing.runwayClaimMonths" : statedRunwayMetric?.id,
    ];
    const missing: string[] = [];
    need(missing, "cash balance", cashUsd);
    need(missing, "monthly burn", burnUsd);
    const alt = [
      { label: "PRE_ROUND", v: preRunway, formula: "cash / current monthly net burn" },
      { label: "POST_ROUND", v: postRunway, formula: `(cash + raise) / ${plannedBurn !== null ? "planned" : "current"} monthly burn` },
    ].filter((x) => isNum(x.v));
    if (burnUsd !== null && burnUsd <= 0) {
      rows.push(custom({ name: "RUNWAY", label: "Runway", formula: "cash / net burn", unit: "MONTHS", inputs, missing, implied: null, stated, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Net burn ≤ 0 (cash-flow positive); runway is not bounded by cash." }));
    } else if (stated === null || !alt.length) {
      const best = alt[0];
      rows.push(compare({ name: "RUNWAY", label: "Implied runway", formula: best?.formula ?? "cash / monthly net burn", unit: "MONTHS", inputs, missing, implied: best?.v ?? null, stated, note: alt.length ? `Pre-round ${fmtVal(preRunway, "MONTHS")}; post-round ${fmtVal(postRunway, "MONTHS")}.` : undefined }));
    } else {
      // Compare with the interpretation closest to the claim, and say which one it was.
      const scored = alt.map((x) => ({ ...x, delta: relDeltaPct(stated, x.v!) })).sort((a, b) => a.delta - b.delta);
      const best = scored[0]!;
      const row = compare({ name: "RUNWAY", label: "Implied runway", formula: best.formula, unit: "MONTHS", inputs, missing, implied: best.v, stated });
      row.note = `Claimed ${fmtVal(stated, "MONTHS")}; closest interpretation ${best.label === "PRE_ROUND" ? "pre-round" : "post-round"} ${fmtVal(best.v, "MONTHS")} (pre-round ${fmtVal(preRunway, "MONTHS")}, post-round ${fmtVal(postRunway, "MONTHS")}).`;
      rows.push(row);
    }
  }

  /* ARR growth vs customer growth ⇒ implied ARPA growth -------------- */
  const statedArrGrowth = ctx.stated("arr_growth_yoy");
  const arrSeries = ctx.seriesGrowth("arr");
  const annualize = (g: { growthPct: number; months: number }) => (Math.pow(1 + g.growthPct / 100, 12 / g.months) - 1) * 100;
  const arrGrowth = val(statedArrGrowth) ?? val(ctx.primary("arr_growth_yoy")) ?? (arrSeries ? annualize(arrSeries) : null);
  {
    const custSeries = ctx.seriesGrowth("paying_customers");
    const custGrowth = custSeries ? annualize(custSeries) : null;
    const nrr = ctx.primary("nrr");
    const missing: string[] = [];
    need(missing, "ARR growth", arrGrowth);
    need(missing, "customer count ~12 months apart", custGrowth);
    const inputs = [statedArrGrowth?.id ?? ctx.primary("arr_growth_yoy")?.id, arrSeries?.latest.ref, arrSeries?.prior.ref, custSeries?.latest.ref, custSeries?.prior.ref, nrr?.id];
    if (arrGrowth === null || custGrowth === null || custGrowth <= -100) {
      rows.push(custom({ name: "ARPA_EXPANSION", label: "Implied ARPA growth", formula: "(1 + ARR growth) / (1 + customer growth) − 1", unit: "PERCENT", inputs, missing, implied: null, stated: val(nrr), verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Needs ARR growth and customer counts about 12 months apart." }));
    } else {
      const arpa = ((1 + arrGrowth / 100) / (1 + custGrowth / 100) - 1) * 100;
      const nrrV = val(nrr);
      let verdict: ImpliedMetric["verdict"] = "CONSISTENT";
      let severity: IntegritySeverity | null = null;
      let note = `ARR ${fmtNum(arrGrowth, 0)}% vs customers ${fmtNum(custGrowth, 0)}% ⇒ revenue per customer must grow ≈ ${fmtNum(arpa, 0)}%.`;
      if (arpa > 50 && (nrrV === null || nrrV - 100 < arpa / 2)) {
        verdict = "INCONSISTENT";
        severity = arpa > 100 ? "HIGH" : "MODERATE";
        note += nrrV === null ? " No NRR is reported to explain that expansion." : ` NRR of ${fmtNum(nrrV, 0)}% explains at most ${fmtNum(nrrV - 100, 0)} points of it; new customers would have to be much larger, or one of the two series is mis-stated.`;
      } else if (arpa < -30) {
        verdict = "INCONSISTENT";
        severity = "LOW";
        note += " ARR grew much slower than customers: ARPA is falling, or the customer count includes non-paying accounts.";
      }
      rows.push(custom({ name: "ARPA_EXPANSION", label: "Implied ARPA growth", formula: "(1 + ARR growth) / (1 + customer growth) − 1", unit: "PERCENT", inputs, missing, implied: arpa, stated: nrrV, verdict, severity, deltaPct: null, note }));
    }
  }

  /* Stated ARR growth vs the ARR points shown -------------------------- */
  {
    const missing: string[] = [];
    need(missing, "stated ARR growth", val(statedArrGrowth));
    need(missing, "two ARR points ~12 months apart", arrSeries?.growthPct);
    rows.push(
      compare({
        name: "ARR_GROWTH",
        label: "ARR growth from the ARR series",
        formula: "(ARR latest / ARR ~12 months earlier)^(12/months) − 1, compared as multipliers (1 + g)",
        unit: "PERCENT",
        inputs: [statedArrGrowth?.id, arrSeries?.latest.ref, arrSeries?.prior.ref],
        missing,
        implied: arrSeries ? annualize(arrSeries) : null,
        stated: statedArrGrowth && statedArrGrowth.calculationMethod !== "DERIVED" ? val(statedArrGrowth) : null,
        multiplier: true,
      }),
    );
  }

  /* ARR per FTE --------------------------------------------------------- */
  {
    const hc = ctx.primary("headcount");
    const stated = ctx.stated("revenue_per_employee");
    const missing: string[] = [];
    need(missing, "arr", arrV);
    need(missing, "headcount", val(hc));
    rows.push(compare({ name: "ARR_PER_FTE", label: "ARR per FTE", formula: "ARR / headcount", unit: "USD", inputs: [arrM?.id, hc?.id, stated?.id], missing, implied: arrV !== null && val(hc) ? arrV / val(hc)! : null, stated: val(stated) }));
  }

  /* Burn multiple --------------------------------------------------------- */
  {
    const stated = ctx.stated("burn_multiple");
    let netNew: number | null = null;
    let netNewRefs: (string | undefined)[] = [];
    if (arrSeries) {
      netNew = ((arrSeries.latest.value - arrSeries.prior.value) * 12) / arrSeries.months;
      netNewRefs = [arrSeries.latest.ref, arrSeries.prior.ref];
    } else if (arrV !== null && arrGrowth !== null && arrGrowth > -100) {
      netNew = (arrV * arrGrowth) / (100 + arrGrowth);
      netNewRefs = [arrM?.id, statedArrGrowth?.id ?? ctx.primary("arr_growth_yoy")?.id];
    }
    const missing: string[] = [];
    need(missing, "monthly burn", burnUsd);
    need(missing, "net new ARR", netNew);
    const implied = burnUsd !== null && netNew !== null && netNew > 0 ? (burnUsd * 12) / netNew : null;
    rows.push(
      compare({
        name: "BURN_MULTIPLE",
        label: "Burn multiple",
        formula: "monthly net burn × 12 / net new ARR (12 months)",
        unit: "MULTIPLE",
        inputs: [f?.monthlyBurn ? "financing.monthlyBurn" : ctx.primary("monthly_net_burn")?.id, ...netNewRefs, stated?.id],
        missing,
        implied,
        stated: stated && stated.calculationMethod !== "DERIVED" ? val(stated) : null,
        note: netNew !== null && netNew <= 0 ? "No net new ARR: burn multiple is unbounded." : undefined,
      }),
    );
  }

  /* Round arithmetic --------------------------------------------------------- */
  const preUsd = moneyUsd(f?.preMoney);
  const postUsd = moneyUsd(f?.postMoney);
  const capUsd = moneyUsd(f?.valuationCap);
  const instrument = f?.instrument ?? "UNKNOWN";
  {
    const missing: string[] = [];
    need(missing, "raise", raiseUsd);
    need(missing, "post-money", postUsd);
    need(missing, "pre-money", preUsd);
    rows.push(
      compare({
        name: "PRE_MONEY",
        label: "Implied pre-money",
        formula: "post-money − raise",
        unit: "USD",
        inputs: [raiseUsd !== null ? "financing.raiseAmount" : null, postUsd !== null ? "financing.postMoney" : null, preUsd !== null ? "financing.preMoney" : null],
        missing,
        implied: postUsd !== null && raiseUsd !== null ? postUsd - raiseUsd : null,
        stated: preUsd,
        note: postUsd === null && preUsd !== null && raiseUsd !== null ? `Implied post-money ${fmtUsd(preUsd + raiseUsd)} (pre + raise); no stated post to compare.` : undefined,
      }),
    );
  }
  {
    const post = postUsd ?? (preUsd !== null && raiseUsd !== null ? preUsd + raiseUsd : null) ?? (instrument === "SAFE" || instrument === "CONVERTIBLE_NOTE" ? capUsd : null);
    const missing: string[] = [];
    need(missing, "raise", raiseUsd);
    need(missing, "post-money (stated, pre + raise, or SAFE cap)", post);
    const pool = isNum(f?.optionPoolIncreasePct) ? f.optionPoolIncreasePct : null;
    const inputs = [raiseUsd !== null ? "financing.raiseAmount" : null, postUsd !== null ? "financing.postMoney" : preUsd !== null ? "financing.preMoney" : capUsd !== null ? "financing.valuationCap" : null, pool !== null ? "financing.optionPoolIncreasePct" : null];
    if (raiseUsd !== null && post !== null && post > 0 && raiseUsd >= post) {
      rows.push(custom({ name: "DILUTION", label: "Implied dilution", formula: "raise / post-money", unit: "PERCENT", inputs, missing, implied: (raiseUsd / post) * 100, stated: null, verdict: "INCONSISTENT", severity: "CRITICAL", deltaPct: null, note: `Raise ${fmtUsd(raiseUsd)} is not smaller than the post-money ${fmtUsd(post)}: the round terms are impossible as stated.` }));
    } else {
      const dil = raiseUsd !== null && post !== null && post > 0 ? (raiseUsd / post) * 100 : null;
      rows.push(custom({ name: "DILUTION", label: "Implied dilution", formula: "raise / post-money (+ option pool top-up)", unit: "PERCENT", inputs, missing, implied: dil, stated: null, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: dil !== null ? `Round dilution ≈ ${fmtNum(dil, 1)}%${pool !== null ? `; with the ${fmtNum(pool, 1)}% pool top-up ≈ ${fmtNum(dil + pool, 1)}% for existing holders` : ""}.` : "Cannot compute dilution." }));
    }
  }
  if (instrument === "SAFE" || instrument === "CONVERTIBLE_NOTE") {
    const statedValuation = postUsd ?? preUsd;
    if (capUsd === null) {
      rows.push(custom({ name: "SAFE_CAP", label: "SAFE cap vs stated valuation", formula: "cap ≈ post-money (post-money SAFE) or pre-money", unit: "USD", inputs: ["financing.instrument"], missing: ["valuation cap"], implied: null, stated: statedValuation, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Uncapped instrument: conversion price and dilution cannot be computed." }));
    } else if (statedValuation === null) {
      rows.push(custom({ name: "SAFE_CAP", label: "SAFE cap vs stated valuation", formula: "cap ≈ post-money (post-money SAFE) or pre-money", unit: "USD", inputs: ["financing.valuationCap"], missing: ["stated pre/post-money"], implied: capUsd, stated: null, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "No stated valuation to compare with the cap." }));
    } else {
      const candidates = [postUsd, preUsd, postUsd === null && preUsd !== null && raiseUsd !== null ? preUsd + raiseUsd : null].filter(isNum);
      const delta = Math.min(...candidates.map((v) => relDeltaPct(v, capUsd)));
      const sev = severityForDeltaPct(delta);
      rows.push(custom({ name: "SAFE_CAP", label: "SAFE cap vs stated valuation", formula: "cap ≈ post-money (post-money SAFE) or pre-money", unit: "USD", inputs: ["financing.valuationCap", postUsd !== null ? "financing.postMoney" : null, preUsd !== null ? "financing.preMoney" : null], missing: [], implied: capUsd, stated: statedValuation, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: delta, note: sev ? `Cap ${fmtUsd(capUsd)} matches neither the stated pre-money (${fmtUsd(preUsd)}) nor post-money (${fmtUsd(postUsd)}).` : "Cap matches the stated valuation." }));
    }
  }

  /* Market: TAM vs price × customers, reconstructed market, nesting ---------- */
  const dm = d.deckMarket ?? { tam: null, sam: null, som: null, description: null };
  const tam = moneyUsd(dm.tam);
  const sam = moneyUsd(dm.sam);
  const som = moneyUsd(dm.som);
  {
    const bu = d.market?.bottomUp ?? null;
    const statedAcv = val(ctx.stated("acv"));
    const anyAcv = val(ctx.primary("acv"));
    const price = statedAcv ?? anyAcv ?? (arrV !== null && custV ? arrV / custV : null) ?? (isNum(d.arpaAssumptionUsd) ? d.arpaAssumptionUsd : null);
    const customers = bu ? Math.max(bu.customerCountLow, bu.customerCountHigh) : null;
    const missing: string[] = [];
    need(missing, "deck TAM", tam);
    need(missing, "company price (ACV / ARPA)", price);
    need(missing, "realistic customer count (bottom-up)", customers);
    const implied = price !== null && isNum(customers) && customers > 0 ? price * customers : null;
    const inputs = ["deckMarket.tam", ctx.stated("acv")?.id ?? ctx.primary("acv")?.id ?? (arrM && custM ? `${arrM.id}/${custM.id}` : isNum(d.arpaAssumptionUsd) ? "arpaAssumptionUsd" : null), bu ? "market.bottomUp.customerCountHigh" : null];
    if (tam === null || implied === null || implied <= 0) {
      rows.push(custom({ name: "TAM_VS_PRICE_X_CUSTOMERS", label: "Deck TAM vs price × customers", formula: "company price × realistic customer count", unit: "USD", inputs, missing, implied, stated: tam, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Needs deck TAM, a company price and a bottom-up customer count." }));
    } else {
      const ratio = tam / implied;
      const sev = ratioSeverity(ratio);
      rows.push(custom({ name: "TAM_VS_PRICE_X_CUSTOMERS", label: "Deck TAM vs price × customers", formula: "company price × realistic customer count; flagged when deck TAM / that > 3 (MODERATE), > 10 (HIGH), > 30 (CRITICAL), or < 1/3 (LOW)", unit: "USD", inputs, missing, implied, stated: tam, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: (ratio - 1) * 100, note: `Deck TAM ${fmtUsd(tam)} is ${fmtNum(ratio, 1)}× the company's own price (${fmtUsd(price)}) × ${Math.round(customers!).toLocaleString("en-US")} realistic customers (${fmtUsd(implied)}).` }));
    }
  }
  {
    let recon: ReturnType<typeof reconstructMarket> | null = null;
    try {
      recon = reconstructMarket({ ...d, market: d.market ?? null, deckMarket: dm });
    } catch {
      recon = null;
    }
    const high = recon?.primary?.highUsd ?? null;
    const missing: string[] = [];
    need(missing, "deck TAM", tam);
    need(missing, "reconstructed market", high);
    if (tam === null || !isNum(high) || high <= 0) {
      rows.push(custom({ name: "DECK_TAM_VS_RECONSTRUCTED", label: "Deck TAM vs reconstructed market", formula: "deck TAM / reconstructed market (high)", unit: "USD", inputs: ["deckMarket.tam", recon?.primary ? `market.${recon.primary.method}` : null], missing, implied: high, stated: tam, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Needs deck TAM and a reconstructed market range." }));
    } else {
      const ratio = tam / high;
      const sev = ratio < 1 ? null : ratioSeverity(ratio);
      rows.push(custom({ name: "DECK_TAM_VS_RECONSTRUCTED", label: "Deck TAM vs reconstructed market", formula: "deck TAM / reconstructed market high; > 3 MODERATE, > 10 HIGH, > 30 CRITICAL", unit: "USD", inputs: ["deckMarket.tam", `market.${recon!.primary!.method}`], missing, implied: high, stated: tam, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: (ratio - 1) * 100, note: `Deck TAM is ${fmtNum(ratio, 1)}× the ${recon!.primary!.method.toLowerCase().replace("_", "-")} reconstruction (${recon!.primary!.formula}).` }));
    }
  }
  {
    const nest = (name: string, label: string, inner: number | null, outer: number | null, innerF: string, outerF: string) => {
      const missing: string[] = [];
      need(missing, innerF, inner);
      need(missing, outerF, outer);
      if (inner === null || outer === null || outer <= 0) {
        rows.push(custom({ name, label, formula: `${innerF} ≤ ${outerF}`, unit: "USD", inputs: [inner !== null ? innerF : null, outer !== null ? outerF : null], missing, implied: outer, stated: inner, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Needs both values." }));
        return;
      }
      const over = inner / outer;
      const sev: IntegritySeverity | null = over <= 1.0001 ? null : over > 2 ? "CRITICAL" : "HIGH";
      rows.push(custom({ name, label, formula: `${innerF} ≤ ${outerF}`, unit: "USD", inputs: [innerF, outerF], missing, implied: outer, stated: inner, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: sev ? (over - 1) * 100 : 0, note: sev ? `${label.split(" ")[0]} ${fmtUsd(inner)} exceeds ${fmtUsd(outer)}: the market slide is internally impossible.` : "Nested correctly." }));
    };
    nest("SAM_WITHIN_TAM", "SAM ≤ TAM", sam, tam, "deckMarket.sam", "deckMarket.tam");
    nest("SOM_WITHIN_SAM", "SOM ≤ SAM", som, sam ?? tam, "deckMarket.som", sam !== null ? "deckMarket.sam" : "deckMarket.tam");
    const revenue = arrV ?? val(ctx.primary("revenue_ttm"));
    if (som !== null && revenue !== null) {
      const sev: IntegritySeverity | null = revenue > som ? "MODERATE" : null;
      rows.push(custom({ name: "SOM_VS_REVENUE", label: "SOM vs current revenue", formula: "current revenue ≤ SOM", unit: "USD", inputs: ["deckMarket.som", arrM?.id ?? ctx.primary("revenue_ttm")?.id], missing: [], implied: revenue, stated: som, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: sev ? (revenue / som - 1) * 100 : 0, note: sev ? `Current revenue ${fmtUsd(revenue)} already exceeds the obtainable market ${fmtUsd(som)}.` : "SOM exceeds current revenue." }));
    }
  }

  /* Use of funds vs planned burn × milestone months ----------------------------- */
  {
    const milestone = isNum(fp?.milestoneMonths) ? fp.milestoneMonths : null;
    const missing: string[] = [];
    need(missing, "raise", raiseUsd);
    need(missing, "milestone months", milestone);
    need(missing, "planned or current burn", postBurn);
    const inputs = [raiseUsd !== null ? "financing.raiseAmount" : null, cashUsd !== null ? "financing.cashBalance" : null, milestone !== null ? "financingPath.milestoneMonths" : null, plannedBurn !== null ? "financingPath.plannedMonthlyBurnUsd" : burnUsd !== null ? "financing.monthlyBurn" : null];
    if (raiseUsd === null || milestone === null || postBurn === null) {
      rows.push(custom({ name: "RAISE_FUNDS_MILESTONE", label: "Raise vs capital to milestone", formula: "(cash + raise) ≥ burn × milestone months", unit: "USD", inputs, missing, implied: null, stated: raiseUsd, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: "Needs raise, milestone months and burn." }));
    } else {
      const required = postBurn * milestone;
      const available = (cashUsd ?? 0) + raiseUsd;
      const shortfall = required > 0 ? ((required - available) / required) * 100 : 0;
      const sev = shortfall > 0 ? severityForDeltaPct(shortfall) : null;
      const withLead = postBurn * (milestone + ctx.leadMonths);
      if (cashUsd === null) missing.push("cash balance (assumed 0)");
      rows.push(
        custom({
          name: "RAISE_FUNDS_MILESTONE",
          label: "Raise vs capital to milestone",
          formula: `(cash + raise) ≥ ${plannedBurn !== null ? "planned" : "current"} burn × milestone months`,
          unit: "USD",
          inputs,
          missing,
          implied: required,
          stated: available,
          verdict: sev ? "INCONSISTENT" : "CONSISTENT",
          severity: sev,
          deltaPct: shortfall > 0 ? shortfall : 0,
          note: sev
            ? `The milestone needs ≈ ${fmtUsd(required)} (${fmtUsd(postBurn)}/month × ${milestone} months) but cash + raise is ${fmtUsd(available)}: shortfall ${fmtNum(shortfall, 0)}%.`
            : available < withLead
              ? `Funds the milestone (${fmtUsd(required)}) but not the ~${ctx.leadMonths}-month raise that follows (${fmtUsd(withLead)}).`
              : `Cash + raise ${fmtUsd(available)} covers the milestone and a ${ctx.leadMonths}-month fundraising buffer.`,
        }),
      );
    }
  }
  {
    const claimed = arr(f?.milestonesClaimed).filter((m) => isNum(m?.monthsFromNow));
    if (claimed.length && postRunway !== null) {
      const latest = [...claimed].sort((a, b) => b.monthsFromNow! - a.monthsFromNow!)[0]!;
      const over = latest.monthsFromNow! > postRunway ? ((latest.monthsFromNow! - postRunway) / latest.monthsFromNow!) * 100 : 0;
      const sev = over > 0 ? severityForDeltaPct(over) : null;
      rows.push(custom({ name: "MILESTONES_WITHIN_RUNWAY", label: "Claimed milestones vs post-round runway", formula: "latest claimed milestone month ≤ (cash + raise) / burn", unit: "MONTHS", inputs: ["financing.milestonesClaimed", "financing.raiseAmount"], missing: [], implied: postRunway, stated: latest.monthsFromNow, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: over, note: sev ? `"${str(latest.milestone)}" is claimed at month ${latest.monthsFromNow} but post-round runway is ${fmtVal(postRunway, "MONTHS")}.` : "Claimed milestones fall within the post-round runway." }));
    }
  }
  {
    const pcts = arr(f?.useOfFunds)
      .map((u) => /(\d+(?:\.\d+)?)\s*%/.exec(str(u)))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]));
    if (pcts.length >= 2) {
      const sum = pcts.reduce((a, b) => a + b, 0);
      const delta = Math.abs(sum - 100);
      const sev = severityForDeltaPct(delta);
      rows.push(custom({ name: "USE_OF_FUNDS_ALLOCATION", label: "Use-of-funds allocation sums to 100%", formula: "Σ allocation % = 100", unit: "PERCENT", inputs: ["financing.useOfFunds"], missing: [], implied: 100, stated: sum, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: delta, note: sev ? `Use-of-funds percentages sum to ${fmtNum(sum, 1)}%.` : "Allocation sums to 100%." }));
    }
  }

  /* Hiring plan vs burn ---------------------------------------------------------- */
  {
    const hc = val(ctx.primary("headcount"));
    const texts = [...arr(f?.useOfFunds).map(str), ...arr(f?.milestonesClaimed).map((m) => str(m?.milestone))];
    let hires = parseHires(texts, hc);
    const fcHeadcount = ctx.observations.filter((o) => o.metricKey === "headcount" && (o.basis === "FORECAST" || o.basis === "TARGET") && isNum(o.value));
    if (hires === null && fcHeadcount.length && hc !== null) hires = Math.max(0, Math.max(...fcHeadcount.map((o) => o.value!)) - hc);
    if (hires !== null && hires > 0) {
      const increment = plannedBurn !== null && burnUsd !== null ? plannedBurn - burnUsd : null;
      const impliedIncrement = hires * HIRE_MONTHLY_COST_USD;
      const inputs = ["financing.useOfFunds", plannedBurn !== null ? "financingPath.plannedMonthlyBurnUsd" : null, burnUsd !== null ? "financing.monthlyBurn" : null, ctx.primary("headcount")?.id];
      if (increment === null) {
        rows.push(custom({ name: "HIRING_PLAN_VS_BURN", label: "Hiring plan vs planned burn", formula: `new hires × ${fmtUsd(HIRE_MONTHLY_COST_USD)}/month (model assumption) ≤ planned burn − current burn`, unit: "USD", inputs, missing: ["planned and current burn"], implied: impliedIncrement, stated: null, verdict: "UNVERIFIABLE", severity: null, deltaPct: null, note: `${hires} planned hires ≈ ${fmtUsd(impliedIncrement)}/month of added burn; planned burn not stated.` }));
      } else if (impliedIncrement > increment * 1.25) {
        const delta = increment > 0 ? relDeltaPct(increment, impliedIncrement) : 100;
        const raw = severityForDeltaPct(delta);
        const sev: IntegritySeverity | null = raw === "HIGH" || raw === "CRITICAL" ? "MODERATE" : raw; // assumption-driven: capped at MODERATE
        rows.push(custom({ name: "HIRING_PLAN_VS_BURN", label: "Hiring plan vs planned burn", formula: `new hires × ${fmtUsd(HIRE_MONTHLY_COST_USD)}/month (model assumption) ≤ planned burn − current burn`, unit: "USD", inputs, missing: [], implied: impliedIncrement, stated: increment, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: delta, note: `${hires} planned hires cost ≈ ${fmtUsd(impliedIncrement)}/month but planned burn rises by only ${fmtUsd(increment)}/month.` }));
      } else {
        rows.push(custom({ name: "HIRING_PLAN_VS_BURN", label: "Hiring plan vs planned burn", formula: `new hires × ${fmtUsd(HIRE_MONTHLY_COST_USD)}/month (model assumption) ≤ planned burn − current burn`, unit: "USD", inputs, missing: [], implied: impliedIncrement, stated: increment, verdict: "CONSISTENT", severity: null, deltaPct: 0, note: "Planned burn increase covers the hiring plan." }));
      }
    }
  }

  /* GMV × take rate = net revenue ------------------------------------------------ */
  {
    const gmv = ctx.primary("gmv");
    const take = ctx.primary("take_rate");
    if (gmv || take) {
      const rev = ctx.stated("revenue_ttm") ?? ctx.stated("arr");
      const missing: string[] = [];
      need(missing, "gmv", val(gmv));
      need(missing, "take rate", val(take));
      need(missing, "reported revenue", val(rev));
      rows.push(compare({ name: "NET_REVENUE_FROM_GMV", label: "Net revenue from GMV × take rate", formula: "GMV × take rate", unit: "USD", inputs: [gmv?.id, take?.id, rev?.id], missing, implied: val(gmv) !== null && val(take) !== null ? (val(gmv)! * val(take)!) / 100 : null, stated: val(rev) }));
    }
  }

  /* Concentration bounds ------------------------------------------------------------ */
  {
    const t1 = ctx.primary("customer_concentration_top1");
    const t5 = ctx.primary("customer_concentration_top5");
    if (t1 || t5) {
      const n = custV;
      const v1 = val(t1);
      const v5 = val(t5);
      let note = "Concentration figures are mutually consistent.";
      let sev: IntegritySeverity | null = null;
      let implied: number | null = null;
      let stated: number | null = null;
      if (v1 !== null && v5 !== null && v1 > v5 + 0.01) {
        sev = "CRITICAL";
        note = `Top-1 share ${fmtNum(v1, 1)}% exceeds top-5 share ${fmtNum(v5, 1)}%: impossible.`;
        implied = v5;
        stated = v1;
      } else if (v5 !== null && n !== null && n >= 1 && v5 < Math.min(100, 500 / n) - 0.5) {
        sev = "HIGH";
        implied = Math.min(100, 500 / n);
        stated = v5;
        note = `With ${fmtNum(n, 0)} customers the top 5 hold at least ${fmtNum(implied, 1)}% of revenue; ${fmtNum(v5, 1)}% is impossible.`;
      } else if (v1 !== null && n !== null && n >= 1 && v1 < 100 / n - 0.5) {
        sev = "HIGH";
        implied = 100 / n;
        stated = v1;
        note = `With ${fmtNum(n, 0)} customers the largest holds at least ${fmtNum(implied, 1)}% of revenue; ${fmtNum(v1, 1)}% is impossible.`;
      }
      rows.push(custom({ name: "CONCENTRATION_BOUNDS", label: "Customer concentration bounds", formula: "top-1 ≤ top-5; top-1 ≥ 100/N; top-5 ≥ min(100, 500/N)", unit: "PERCENT", inputs: [t1?.id, t5?.id, custM?.id], missing: n === null ? ["paying_customers"] : [], implied, stated, verdict: sev ? "INCONSISTENT" : "CONSISTENT", severity: sev, deltaPct: null, note }));
    }
  }

  /* Unit economics identities ----------------------------------------------------- */
  {
    const cacM = ctx.stated("cac");
    const acv = ctx.primary("acv") ?? null;
    const acvV = val(acv) ?? (arrV !== null && custV ? arrV / custV : null);
    const gm = ctx.primary("gross_margin");
    const stated = ctx.stated("cac_payback_months");
    if (stated || (cacM && gm)) {
      const missing: string[] = [];
      need(missing, "cac", val(cacM));
      need(missing, "acv", acvV);
      need(missing, "gross margin", val(gm));
      const implied = val(cacM) !== null && acvV !== null && val(gm) ? val(cacM)! / ((acvV / 12) * (val(gm)! / 100)) : null;
      rows.push(compare({ name: "CAC_PAYBACK", label: "CAC payback", formula: "CAC / (ACV / 12 × gross margin)", unit: "MONTHS", inputs: [cacM?.id, acv?.id ?? (arrM && custM ? `${arrM.id}/${custM.id}` : null), gm?.id, stated?.id], missing, implied, stated: val(stated) }));
    }
    const ltv = ctx.stated("ltv");
    const ltvCac = ctx.stated("ltv_to_cac");
    if (ltvCac || (ltv && cacM)) {
      const missing: string[] = [];
      need(missing, "ltv", val(ltv));
      need(missing, "cac", val(cacM));
      rows.push(compare({ name: "LTV_TO_CAC", label: "LTV / CAC", formula: "LTV / CAC", unit: "MULTIPLE", inputs: [ltv?.id, cacM?.id, ltvCac?.id], missing, implied: val(ltv) !== null && val(cacM) ? val(ltv)! / val(cacM)! : null, stated: val(ltvCac) }));
    }
    const dau = ctx.primary("dau");
    const mau = ctx.primary("mau");
    const dm2 = ctx.stated("dau_mau");
    if (dm2 && (dau || mau)) {
      const missing: string[] = [];
      need(missing, "dau", val(dau));
      need(missing, "mau", val(mau));
      rows.push(compare({ name: "DAU_MAU", label: "DAU / MAU", formula: "DAU / MAU × 100", unit: "PERCENT", inputs: [dau?.id, mau?.id, dm2.id], missing, implied: val(dau) !== null && val(mau) ? (val(dau)! / val(mau)!) * 100 : null, stated: val(dm2) }));
    }
  }

  const findings: IntegrityFinding[] = [];
  for (const r of rows) {
    if (r.verdict !== "INCONSISTENT" || !r.severity) continue;
    const ms = r.inputs.map((id) => ctx.metrics.find((m) => m.id === id)).filter((m): m is MetricInstance => !!m);
    findings.push(
      finding({
        kind: `IMPLIED_${r.name}`,
        module: "IMPLIED_METRICS",
        severity: r.severity,
        title: `${labelFor(r)}: stated ${fmtVal(r.statedValue, r.unit)} vs implied ${fmtVal(r.impliedValue, r.unit)}${r.deltaPct !== null && Number.isFinite(r.deltaPct) && r.deltaPct !== 0 ? ` (Δ ${fmtNum(r.deltaPct, 0)}%)` : ""}`,
        detail: `${r.formula}. ${r.note}`,
        metricIds: ms.map((m) => m.id),
        claimIds: ms.map((m) => m.claimId),
        pages: ms.map((m) => ctx.metricPage(m)),
      }),
    );
  }
  return { rows, findings };
}

const LABELS: Record<string, string> = {
  ACV: "ACV vs ARR / customers",
  ARR_VS_MRR: "ARR vs MRR × 12",
  RUNWAY: "Runway claim vs cash / burn",
  ARPA_EXPANSION: "ARR growth vs customer growth",
  ARR_GROWTH: "Stated ARR growth vs ARR points shown",
  ARR_PER_FTE: "ARR per FTE",
  BURN_MULTIPLE: "Burn multiple",
  PRE_MONEY: "Pre-money vs post − raise",
  DILUTION: "Round terms",
  SAFE_CAP: "SAFE cap vs stated valuation",
  TAM_VS_PRICE_X_CUSTOMERS: "Deck TAM vs price × realistic customers",
  DECK_TAM_VS_RECONSTRUCTED: "Deck TAM vs reconstructed market",
  SAM_WITHIN_TAM: "SAM exceeds TAM",
  SOM_WITHIN_SAM: "SOM exceeds SAM",
  SOM_VS_REVENUE: "Revenue exceeds SOM",
  RAISE_FUNDS_MILESTONE: "Raise does not fund the milestone",
  MILESTONES_WITHIN_RUNWAY: "Claimed milestone beyond runway",
  USE_OF_FUNDS_ALLOCATION: "Use-of-funds allocation",
  HIRING_PLAN_VS_BURN: "Hiring plan vs planned burn",
  NET_REVENUE_FROM_GMV: "Revenue vs GMV × take rate",
  CONCENTRATION_BOUNDS: "Customer concentration",
  CAC_PAYBACK: "CAC payback",
  LTV_TO_CAC: "LTV / CAC",
  DAU_MAU: "DAU / MAU",
};

function labelFor(r: ImpliedMetric) {
  return LABELS[r.name] ?? r.name;
}
