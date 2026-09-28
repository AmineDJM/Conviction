/**
 * 10. SCALABILITY ARCHITECTURE — does growth make the company better or more
 * fragile? Custom work per customer, a local team per country, human support
 * per contract, services share, implementation time, gross-margin trend with
 * scale, support/CS headcount per customer. Distinct from current gross
 * margin (the level); this is about the slope.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { DIVERGENCE_ASSUMPTIONS as A } from "./assumptions";
import type { DivergenceInputs } from "./context";
import type { DivergenceEvidence, DivergenceLevel, FactorBase } from "./types";
import { basesOf, coverage, ev, isFact, metricRef, num, pagesOfEvidence, pct1, round } from "./util";

export interface MarginTrend {
  from: { period: string; pct: number; page: number | null };
  to: { period: string; pct: number; page: number | null };
  deltaPts: number;
  points: number;
}

export interface ScalabilityFactor extends FactorBase {
  id: "SCALABILITY_ARCHITECTURE";
  points: number;
  servicesSharePct: number | null;
  marginTrend: MarginTrend | null;
  implementationWeeks: number | null;
  supportFtePer10Customers: number | null;
  issues: { issue: string; points: number }[];
}

/** Gross-margin trend from the raw observations: earliest vs latest historical period. */
export function grossMarginTrend(deal: CanonicalDeal): MarginTrend | null {
  const byPeriod = new Map<string, { period: string; pct: number; page: number | null; t: number }>();
  for (const o of deal.metricObservations ?? []) {
    if (o.metricKey !== "gross_margin" || o.value === null || !Number.isFinite(o.value) || !["ACTUAL", "LTM", "CURRENT"].includes(o.basis)) continue;
    const period = o.periodEnd ?? o.periodStart;
    if (!period) continue;
    const t = Date.parse(period.length === 4 ? `${period}-12-31` : period.length === 7 ? `${period}-28` : period);
    if (!Number.isFinite(t)) continue;
    const pct = o.value <= 1 && o.unit === "RATIO" ? o.value * 100 : o.value;
    if (!byPeriod.has(period)) byPeriod.set(period, { period, pct, page: o.page, t });
  }
  const pts = [...byPeriod.values()].sort((a, b) => a.t - b.t);
  if (pts.length < 2) return null;
  const from = pts[0]!;
  const to = pts[pts.length - 1]!;
  const delta = round(to.pct - from.pct, 1);
  return { from: { period: from.period, pct: from.pct, page: from.page }, to: { period: to.period, pct: to.pct, page: to.page }, deltaPts: delta, points: delta <= -A.marginTrendPts ? 2 : delta >= A.marginTrendPts ? -1 : 0 };
}

export function scalabilityArchitecture(inp: DivergenceInputs): ScalabilityFactor {
  const sc = inp.draft?.scalability ?? null;
  const issues: ScalabilityFactor["issues"] = [];
  const evidence: DivergenceEvidence[] = [];

  const services = metricRef(inp.deal, "services_revenue_share");
  if (services) {
    const p = services.value >= A.servicesShareHighPct ? 2 : services.value >= A.servicesShareWatchPct ? 1 : 0;
    issues.push({ issue: `Services are ${pct1(services.value)} of revenue`, points: p });
    evidence.push(ev("COMPUTED", `Services share of revenue ${pct1(services.value)} (+${p})`, [services.page], [services.ref]));
  }
  const trend = grossMarginTrend(inp.deal);
  if (trend) {
    issues.push({ issue: `Gross margin ${trend.deltaPts >= 0 ? "+" : ""}${trend.deltaPts} pts from ${trend.from.period} to ${trend.to.period}`, points: trend.points });
    evidence.push(ev("COMPUTED", `Gross margin ${pct1(trend.from.pct)} (${trend.from.period}) → ${pct1(trend.to.pct)} (${trend.to.period}): ${trend.deltaPts >= 0 ? "+" : ""}${trend.deltaPts} pts (${trend.points >= 0 ? "+" : ""}${trend.points})`, [trend.from.page, trend.to.page]));
  }
  const ttv = metricRef(inp.deal, "time_to_value_days");
  const weeks = sc?.implementationWeeks ?? (ttv ? round(ttv.value / 7, 1) : null);
  if (weeks !== null && weeks > 0) {
    const p = weeks >= A.implementationHighWeeks ? 2 : weeks >= A.implementationWatchWeeks ? 1 : 0;
    issues.push({ issue: `Implementation takes ${weeks} weeks`, points: p });
    evidence.push(ev(sc?.implementationWeeks != null ? "MODEL_OBSERVED" : "COMPUTED", `Implementation / time to value ${weeks} weeks (+${p})`, [ttv?.page], [ttv?.ref]));
  }
  const supportFte = (sc?.headcountByFunction ?? []).filter((h) => h.function === "CUSTOMER_SUCCESS_SUPPORT" || h.function === "SERVICES_IMPLEMENTATION").reduce((s, h) => s + (h.count > 0 ? h.count : 0), 0);
  const customers = metricRef(inp.deal, "paying_customers");
  const per10 = supportFte > 0 && customers && customers.value > 0 ? round(supportFte / (customers.value / 10), 2) : null;
  if (per10 !== null) {
    const p = per10 >= A.supportFtePer10CustomersHigh ? 2 : per10 >= A.supportFtePer10CustomersWatch ? 1 : 0;
    issues.push({ issue: `${supportFte} support/services FTE for ${customers!.value} customers (${per10} per 10 customers)`, points: p });
    evidence.push(ev("COMPUTED", `${supportFte} customer-success/support/services FTE ÷ ${customers!.value} paying customers = ${per10} per 10 customers (+${p})`, [customers!.page], [customers!.ref]));
  }
  const signals = (sc?.signals ?? []).filter((s) => isFact(s.evidence));
  const fragile = signals.filter((s) => s.direction === "FRAGILE");
  const scales = signals.filter((s) => s.direction === "SCALES");
  const sigPts = Math.min(3, fragile.length) - Math.min(2, scales.length);
  if (signals.length) issues.push({ issue: `${fragile.length} fragile / ${scales.length} scaling signals in the materials`, points: sigPts });
  for (const s of signals) evidence.push(ev("MODEL_OBSERVED", `${s.kind.toLowerCase().replace(/_/g, " ")} — ${s.direction.toLowerCase()}: ${s.evidence}`, [s.page]));

  const points = issues.reduce((s, i) => s + i.points, 0);
  const assessed = issues.length > 0;
  let level: DivergenceLevel = "INSUFFICIENT_EVIDENCE";
  let reading = "UNREAD";
  // STRONG needs at least one measured input; model signals alone can reach ADEQUATE at best.
  const measured = !!services || !!trend || weeks !== null || per10 !== null;
  if (assessed) {
    level = points <= 0 ? (measured ? "STRONG" : "ADEQUATE") : points <= 2 ? "ADEQUATE" : "WEAK";
    reading = level === "STRONG" ? "GROWTH_STRENGTHENS" : level === "ADEQUATE" ? "NEUTRAL" : "GROWTH_FRAGILIZES";
  }
  const top = [...issues].filter((i) => i.points > 0).sort((a, b) => b.points - a.points);
  const why = !assessed
    ? "Nothing shows how delivery cost behaves with scale (services share, implementation time, margin trend, support load)."
    : top.length
      ? `${top[0]!.issue}${top.length > 1 ? `; ${top[1]!.issue.charAt(0).toLowerCase()}${top[1]!.issue.slice(1)}` : ""} (${points} fragility points).`
      : `Growth does not add proportional human delivery cost (${points} fragility points)${measured ? "" : " — on model-observed signals only, no measured delivery cost"}.`;

  const implications: string[] = [];
  if (level === "WEAK") implications.push("Each new customer adds people (services, support, local teams): revenue and headcount grow together, gross margin does not expand, and the company becomes harder to run as it grows.");
  if (trend && trend.deltaPts <= -A.marginTrendPts) implications.push(`Gross margin fell ${Math.abs(trend.deltaPts)} pts while the company grew — scale is making each dollar of revenue more expensive to deliver.`);
  if (level === "STRONG") implications.push("Delivery is standardised: growth should expand margins and free people for product and sales.");

  return {
    id: "SCALABILITY_ARCHITECTURE",
    n: 10,
    name: "Scalability architecture",
    question: "Does growth make the company better — or more fragile?",
    level,
    reading,
    why,
    basis: basesOf(evidence),
    pages: pagesOfEvidence(evidence),
    rule: `Fragility points: services ≥ ${A.servicesShareHighPct}% of revenue +2 (≥ ${A.servicesShareWatchPct}% +1); gross margin down ≥ ${A.marginTrendPts} pts across reported periods +2 (up ≥ ${A.marginTrendPts} pts −1); implementation ≥ ${A.implementationHighWeeks} weeks +2 (≥ ${A.implementationWatchWeeks} +1); support + services FTE per 10 customers ≥ ${A.supportFtePer10CustomersHigh} +2 (≥ ${A.supportFtePer10CustomersWatch} +1); each FRAGILE signal +1 (max 3), each SCALES signal −1 (max 2). ≤ 0 → STRONG (only with at least one measured input — signals alone cap at ADEQUATE), 1–2 → ADEQUATE, ≥ 3 → WEAK. Signals whose evidence only states an absence are not counted. Current gross margin level is not an input — only its slope.`,
    evidence,
    coverage: coverage(
      [!!services && "services share", !!trend && "gross-margin trend", weeks !== null && "implementation time", per10 !== null && "support headcount per customer", signals.length > 0 && "delivery signals"],
      [!services && "services share", !trend && "gross-margin trend (≥ 2 periods)", weeks === null && "implementation time", per10 === null && "support headcount per customer", !signals.length && "delivery signals"],
    ),
    computed: [
      num("servicesSharePct", "Services share of revenue", services?.value ?? null, "PCT"),
      num("marginDeltaPts", "Gross-margin change (pts)", trend?.deltaPts ?? null, "RATIO"),
      num("implementationWeeks", "Implementation (weeks)", weeks, "RATIO"),
      num("supportPer10", "Support/services FTE per 10 customers", per10, "RATIO"),
      num("points", "Fragility points", points, "COUNT"),
    ],
    implications,
    points,
    servicesSharePct: services?.value ?? null,
    marginTrend: trend,
    implementationWeeks: weeks,
    supportFtePer10Customers: per10,
    issues,
  };
}
