/**
 * 1. METRIC INTEGRITY RULES — presentation choices that inflate a metric.
 *
 * Each rule reads normalized instances (qualityFlags from normalize.ts),
 * raw observations and a few classification fields, and emits findings that
 * point at metric ids, claim ids and pages. Where normalize.ts flags are
 * produced by substring regexes (e.g. "trial" inside "industrial"), the rule
 * re-checks the underlying text with word boundaries before reporting.
 */
import type { MetricInstance } from "@/domain/canonical";
import { metricDef } from "../metrics/dictionary";
import { hasFlag, metricText, obsText, type IntegrityContext, CONTRACTED_BASES } from "./context";
import type { IntegrityFinding, IntegritySeverity } from "./types";
import { arr, finding, fmtNum, fmtUsd, isNum, monthsBetween, parseDate, parseDurationDays, shiftSeverity, str } from "./util";

const M = "METRIC_RULES" as const;

/** Minimum prior-period revenue base below which percentage growth is not meaningful (USD). */
export const TINY_ARR_BASE_USD = 100_000;
/** Minimum MRR base for month-over-month growth (USD). */
export const TINY_MRR_BASE_USD = 10_000;
/** Services share above which a SaaS label is questionable (%). */
export const SERVICES_SHARE_THRESHOLD = 25;
/** Sales cycle (days) incompatible with a self-serve / PLG claim. */
export const SELF_SERVE_MAX_CYCLE_DAYS = 60;
/** ACV (USD) that implies an enterprise sale rather than self-serve. */
export const ENTERPRISE_ACV_USD = 50_000;

const CORE_KEYS = new Set(["arr", "mrr", "revenue_ttm", "paying_customers", "nrr", "grr", "gross_margin", "burn_multiple", "acv", "gmv", "take_rate"]);
const CASH_KEYS = new Set(["cash_balance", "monthly_net_burn", "runway_months"]);
const RATE_KEYS_MATERIAL = new Set(["nrr", "grr", "logo_retention", "pilot_to_production_rate", "win_rate"]);
const RATE_KEYS_OTHER = new Set(["d1_retention", "d7_retention", "d30_retention", "repeat_rate", "default_rate", "loss_rate"]);
const RETENTION_KEYS = ["nrr", "grr", "logo_retention"];

const NON_PAYING_RE = /\b(pilots?|trials?|free trials?|poc|pocs|proofs? of concept|lois?|letters? of intent|free|freemium|design partners?|logos?|unpaid|beta users?)\b/;
const COGS_EXCLUSION_RE = /\b(?:exclud\w*|excl\.?|before|ex\.|not including|net of|without)\s+([^.;:]{3,80})/g;
const COGS_ITEM_RE = /\b(inference|compute|gpu|cloud|hosting|llm|api costs?|model costs?|support|human|humans|ops|operations|delivery|labou?r|annotat\w*|review\w*|onboarding|implementation|contractors?)\b/;
const CAC_PARTIAL_RE = /\b(exclud\w*|excl\.?|not including|without)\b|\b(paid|ad|media|marketing)\s+(spend\s+)?only\b|\bonly\s+(paid|ad|media|marketing)\b|\bblended\b/;
const SELF_SERVE_RE = /\b(self[- ]?serve|self[- ]service|product[- ]led|plg|bottom[- ]up adoption|no[- ]touch|low[- ]touch|credit[- ]card sign ?up)\b/i;
const GMV_WORDS_RE = /\b(gmv|gross merchandise|gross bookings|gross transaction|transaction volume|tpv|total payment volume|gross sales|gross order value)\b/;
const COHORT_RE = /\b(cohorts?|trailing|ttm|12[- ]month|twelve[- ]month|annual cohort|vintage)\b/;

const pagesOf = (ctx: IntegrityContext, ms: (MetricInstance | null | undefined)[]) => ms.map((m) => (m ? ctx.metricPage(m) : null));

function stageAdjust(ctx: IntegrityContext, s: IntegritySeverity): IntegritySeverity {
  // Tiny bases are normal at seed; the presentation is still misleading, one level lower.
  return ctx.stageBand === "EARLY" ? (shiftSeverity(s, -1) ?? "LOW") : s;
}

function growthOnTinyBase(ctx: IntegrityContext, out: IntegrityFinding[]) {
  for (const [gKey, baseKey] of [
    ["arr_growth_yoy", "arr"],
    ["revenue_growth_yoy", "revenue_ttm"],
  ] as const) {
    const g = ctx.primary(gKey);
    if (!g || !isNum(g.normalizedValue) || g.normalizedValue < 50) continue;
    const current = ctx.primary(baseKey) ?? (baseKey === "revenue_ttm" ? ctx.primary("arr") : null);
    // Prefer the actual prior point when the growth was derived from a series.
    let base: number | null = null;
    const inputs = g.inputs.map((id) => ctx.metrics.find((m) => m.id === id)).filter((m): m is MetricInstance => !!m && m.metricKey === baseKey);
    if (inputs.length >= 2) {
      const sorted = [...inputs].sort((a, b) => (parseDate(a.periodEnd)?.getTime() ?? 0) - (parseDate(b.periodEnd)?.getTime() ?? 0));
      base = sorted[0]!.normalizedValue;
    } else if (current && isNum(current.normalizedValue)) base = current.normalizedValue / (1 + g.normalizedValue / 100);
    if (!isNum(base) || base >= TINY_ARR_BASE_USD) continue;
    const sev: IntegritySeverity = base < 25_000 || g.normalizedValue >= 500 ? "HIGH" : "MODERATE";
    out.push(
      finding({
        kind: "GROWTH_ON_TINY_BASE",
        module: M,
        severity: stageAdjust(ctx, sev),
        title: `${fmtNum(g.normalizedValue, 0)}% growth computed from a ${fmtUsd(base)} base`,
        detail: `${metricDef(gKey)?.shortName ?? gKey} of ${fmtNum(g.normalizedValue, 0)}% starts from about ${fmtUsd(base)} (${current ? `current ${fmtUsd(current.normalizedValue)}` : "prior point"}). Below ${fmtUsd(TINY_ARR_BASE_USD)} a percentage growth rate says little about repeatable demand; look at absolute net-new revenue and customer counts instead.`,
        metricIds: [g.id, current?.id, ...inputs.map((i) => i.id)],
        claimIds: [g.claimId, current?.claimId],
        pages: pagesOf(ctx, [g, current, ...inputs]),
      }),
    );
  }

  const mom = ctx.primary("mom_growth");
  if (mom && isNum(mom.normalizedValue) && mom.normalizedValue > 0) {
    const start = parseDate(mom.periodStart);
    const end = parseDate(mom.periodEnd);
    const window = start && end ? monthsBetween(start, end) : null;
    const mrr = ctx.primary("mrr")?.normalizedValue ?? (isNum(ctx.primary("arr")?.normalizedValue) ? ctx.primary("arr")!.normalizedValue! / 12 : null);
    const reasons: string[] = [];
    let sev: IntegritySeverity | null = null;
    if (window !== null && window < 3) {
      reasons.push(`measured over ${fmtNum(window, 1)} months (< 3)`);
      sev = mom.normalizedValue >= 30 ? "HIGH" : "MODERATE";
    } else if (window === null && !/\b(\d+|three|six|twelve)[- ]month|\bover\b|\bsince\b|\bcmgr\b|\baverage\b/.test(metricText(mom))) {
      reasons.push("measurement window not stated");
      sev = "LOW";
    }
    if (isNum(mrr) && mrr < TINY_MRR_BASE_USD) {
      reasons.push(`MRR base ${fmtUsd(mrr)} (< ${fmtUsd(TINY_MRR_BASE_USD)})`);
      sev = sev === "HIGH" ? "HIGH" : "MODERATE";
    }
    if (sev)
      out.push(
        finding({
          kind: "GROWTH_ON_TINY_BASE",
          key: "mom",
          module: M,
          severity: stageAdjust(ctx, sev),
          title: `Month-over-month growth of ${fmtNum(mom.normalizedValue, 0)}% is not a reliable trend`,
          detail: `MoM growth ${reasons.join("; ")}. A short or undisclosed window lets one strong month stand for a trend; ask for 6–12 months of monthly revenue.`,
          metricIds: [mom.id],
          claimIds: [mom.claimId],
          pages: pagesOf(ctx, [mom]),
        }),
      );
  }
}

function gmvAsRevenue(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const c = ctx.classification;
  const isMarketplace = ctx.profile === "MARKETPLACE" || c.revenueModel.includes("TAKE_RATE") || c.productType.includes("MARKETPLACE");
  const gmv = ctx.primary("gmv");
  const take = ctx.primary("take_rate");
  // A reported revenue figure already identified as gross volume by normalization (kept, marked CONTRADICTED).
  const grossFlagged = ctx.metrics.find((m) => hasFlag(m, "GROSS_VOLUME_AS_REVENUE") && isNum(m.normalizedValue));
  const revenue = grossFlagged ?? ctx.primary("revenue_ttm") ?? ctx.primary("arr");
  // Revenue ≈ GMV: gross volume presented as the company's revenue.
  if (gmv && revenue && isNum(gmv.normalizedValue) && isNum(revenue.normalizedValue) && gmv.normalizedValue > 0) {
    const ratio = revenue.normalizedValue / gmv.normalizedValue;
    if (ratio >= 0.9 && (isMarketplace || take)) {
      const sev: IntegritySeverity = take && isNum(take.normalizedValue) && take.normalizedValue < 50 ? "CRITICAL" : "HIGH";
      out.push(
        finding({
          kind: "GMV_AS_REVENUE",
          module: M,
          severity: sev,
          title: "Revenue is reported at the level of GMV",
          detail: `Reported ${metricDef(revenue.metricKey)?.shortName ?? revenue.metricKey} ${fmtUsd(revenue.normalizedValue)} is ${fmtNum(ratio * 100, 0)}% of GMV ${fmtUsd(gmv.normalizedValue)}${take ? ` although the stated take rate is ${fmtNum(take.normalizedValue, 1)}%` : ""}. For a take-rate business, net revenue ≈ GMV × take rate.`,
          metricIds: [gmv.id, revenue.id, take?.id],
          claimIds: [gmv.claimId, revenue.claimId],
          pages: pagesOf(ctx, [gmv, revenue, take]),
        }),
      );
    }
  }
  // Gross volume that the company itself labels as revenue ("Revenue 2025 (gross order value)").
  const labelledRevenue = ctx.observations.filter((o) => (o.metricKey === "gmv" || o.metricKey === "tpv") && /\b(revenues?|sales|turnover|chiffre d'affaires|ca)\b/i.test(`${o.label ?? ""} ${o.definitionAsStated ?? ""}`));
  if (labelledRevenue.length && !out.some((f) => f.kind === "GMV_AS_REVENUE"))
    out.push(
      finding({
        kind: "GMV_AS_REVENUE",
        key: "gross-labelled",
        module: M,
        severity: take && isNum(take.normalizedValue) && take.normalizedValue < 50 ? "CRITICAL" : "HIGH",
        title: "Gross volume is labelled as revenue",
        detail: `The materials present gross volume as revenue (${labelledRevenue.map((o) => `"${o.label}" ${o.rawText}`).join("; ")})${take && isNum(take.normalizedValue) ? `; with a ${fmtNum(take.normalizedValue, 1)}% take rate, net revenue is about ${fmtNum(take.normalizedValue, 1)}% of it` : ""}. Ask for net revenue by period.`,
        metricIds: [gmv?.id, take?.id],
        claimIds: [gmv?.claimId],
        pages: labelledRevenue.map((o) => o.page),
      }),
    );
  // Revenue figures whose own definition says they are gross volume.
  const revKeys = ["arr", "mrr", "revenue_ttm"];
  const hits = ctx.metrics.filter((m) => revKeys.includes(m.metricKey) && m.calculationMethod !== "DERIVED" && GMV_WORDS_RE.test(metricText(m)));
  const obsHits = ctx.observations.filter((o) => revKeys.includes(o.metricKey) && GMV_WORDS_RE.test(obsText(o)) && !hits.some((m) => m.location === (o.page !== null ? `p. ${o.page}` : null)));
  if (hits.length || obsHits.length)
    out.push(
      finding({
        kind: "GMV_AS_REVENUE",
        key: "label",
        module: M,
        severity: "HIGH",
        title: "A revenue figure is defined as gross volume (GMV / bookings / TPV)",
        detail: "The figure labelled as revenue or ARR is described with gross-volume language. Gross volume is not the company's revenue; ask for net revenue and the take rate by period.",
        metricIds: hits.map((m) => m.id),
        claimIds: hits.map((m) => m.claimId),
        pages: [...pagesOf(ctx, hits), ...obsHits.map((o) => o.page)],
      }),
    );
  if (isMarketplace && revenue && !take && !gmv)
    out.push(
      finding({
        kind: "REVENUE_BASIS_UNDISCLOSED",
        module: M,
        severity: "LOW",
        title: "Marketplace revenue without GMV or take rate",
        detail: "Take-rate business reports revenue without GMV or take rate, so gross vs net recognition cannot be checked.",
        metricIds: [revenue.id],
        pages: pagesOf(ctx, [revenue]),
      }),
    );
}

function bookingsAsArr(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const flagged = ctx.metrics.filter((m) => hasFlag(m, "SIGNED_NOT_DEPLOYED"));
  const flaggedPages = new Set(flagged.map((m) => ctx.metricPage(m)));
  const obs = ctx.observations.filter(
    (o) => ["arr", "mrr", "revenue_ttm"].includes(o.metricKey) && (CONTRACTED_BASES as readonly string[]).includes(o.basis) && !flaggedPages.has(o.page),
  );
  if (flagged.length || obs.length) {
    const arrLive = ctx.primary("arr");
    const contracted = [...flagged.map((m) => m.normalizedValue), ...obs.map((o) => o.value)].filter(isNum);
    const contractedMax = contracted.length ? Math.max(...contracted) : null;
    const share = contractedMax !== null && isNum(arrLive?.normalizedValue) ? contractedMax / (contractedMax + arrLive.normalizedValue) : null;
    out.push(
      finding({
        kind: "BOOKINGS_AS_ARR",
        module: M,
        severity: share !== null && share < 0.2 ? "MODERATE" : "HIGH",
        title: "Signed / booked revenue presented as ARR",
        detail: `${flagged.length + obs.length} revenue figure(s) labelled ARR/MRR/revenue have a SIGNED or BOOKED basis (contracted, not live). They are excluded from ARR and kept as contracted ARR${contractedMax !== null ? ` (${fmtUsd(contractedMax)})` : ""}${isNum(arrLive?.normalizedValue) ? `; live ARR is ${fmtUsd(arrLive.normalizedValue)}` : "; no live ARR is reported"}.`,
        metricIds: flagged.map((m) => m.id),
        claimIds: flagged.map((m) => m.claimId),
        pages: [...pagesOf(ctx, flagged), ...obs.map((o) => o.page)],
      }),
    );
  }
  const nonRec = ctx.metrics.filter(
    (m) =>
      m.metricKey === "arr" &&
      hasFlag(m, "ARR_MAY_INCLUDE_NON_RECURRING") &&
      // normalize.ts matches substrings ("financial services customers", "designed"); re-check with word boundaries.
      (/\b(pilots?|one[- ]time|professional services|services revenue|implementation|setup|set-up|bookings?|signed|contracted|pipeline)\b/.test(metricText(m)) || metricText(m).trim() === ""),
  );
  if (nonRec.length)
    out.push(
      finding({
        kind: "ARR_INCLUDES_NON_RECURRING",
        module: M,
        severity: "MODERATE",
        title: "ARR definition mentions non-recurring or not-yet-live revenue",
        detail: "The ARR definition mentions pilots, one-time/implementation fees, services, bookings or signed-not-live contracts. ARR should contain only active recurring contract value.",
        metricIds: nonRec.map((m) => m.id),
        claimIds: nonRec.map((m) => m.claimId),
        pages: pagesOf(ctx, nonRec),
      }),
    );
  const contractedArr = ctx.primary("contracted_arr");
  const liveArr = ctx.primary("arr");
  if (contractedArr && !liveArr && !flagged.length && !obs.length)
    out.push(
      finding({
        kind: "CONTRACTED_ONLY_REVENUE",
        module: M,
        severity: "MODERATE",
        title: "Only contracted (not live) revenue is reported",
        detail: `Contracted ARR ${fmtUsd(contractedArr.normalizedValue)} is reported with no live ARR; contracted revenue can be cancelled before go-live.`,
        metricIds: [contractedArr.id],
        pages: pagesOf(ctx, [contractedArr]),
      }),
    );
}

function pilotsAndLogos(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const customers = ctx.primary("paying_customers");
  const pilots = ctx.primary("pilots");
  const flagged = ctx.metrics.filter((m) => m.metricKey === "paying_customers" && hasFlag(m, "CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING"));
  // normalize.ts uses substrings ("industrial" contains "trial"); only report when the words really appear, or the text is unavailable.
  const confirmed = flagged.filter((m) => NON_PAYING_RE.test(metricText(m)) || [m.definitionUsed, ...m.components].every((x) => !x));
  const textual = ctx.metrics.filter(
    (m) => m.metricKey === "paying_customers" && m.calculationMethod !== "DERIVED" && !flagged.includes(m) && NON_PAYING_RE.test([m.definitionUsed ?? "", m.components.join(" "), m.label].join(" ").toLowerCase()),
  );
  const hits = [...confirmed, ...textual];
  if (hits.length) {
    const heavyPilots = pilots && customers && isNum(pilots.normalizedValue) && isNum(customers.normalizedValue) && pilots.normalizedValue >= 0.5 * customers.normalizedValue;
    out.push(
      finding({
        kind: "PILOTS_AS_CUSTOMERS",
        module: M,
        severity: heavyPilots ? "HIGH" : "MODERATE",
        title: "Customer count appears to include pilots, trials, LOIs or free users",
        detail: `The customer count's definition mentions non-paying relationships${heavyPilots ? `; ${fmtNum(pilots!.normalizedValue, 0)} pilots vs ${fmtNum(customers!.normalizedValue, 0)} "customers"` : ""}. Ask for paying customers in production separately from pilots and LOIs.`,
        metricIds: [...hits.map((m) => m.id), pilots?.id],
        claimIds: hits.map((m) => m.claimId),
        pages: pagesOf(ctx, hits),
      }),
    );
  }

  const named = arr(ctx.deal.customers?.namedCustomers);
  if (!named.length) return;
  const logoOnly = named.filter((n) => n.evidenceLevel === "LOGO_ONLY");
  const pilotPaying = named.filter((n) => n.relationship === "PAYING" && (n.evidenceLevel === "PILOT" || n.evidenceLevel === "CONTRACT_SIGNED"));
  const customerClaims = ctx.claims.filter((c) => c.category === "CUSTOMER" || /\b(customers?|clients?|trusted by|used by|works? with|working with)\b/i.test(c.statement));
  if (logoOnly.length) {
    const mentioned = customerClaims.filter((c) => logoOnly.some((n) => n.name && `${c.statement} ${c.valueText ?? ""}`.toLowerCase().includes(n.name.toLowerCase())));
    const presentedPaying = logoOnly.some((n) => n.relationship === "PAYING");
    const share = logoOnly.length / named.length;
    const sev: IntegritySeverity = presentedPaying || share >= 0.5 ? "HIGH" : customerClaims.length ? "MODERATE" : "LOW";
    out.push(
      finding({
        kind: "LOGO_ONLY_CUSTOMERS",
        module: M,
        severity: sev,
        title: `${logoOnly.length} of ${named.length} named customers are supported only by a logo`,
        detail: `Logos shown as customers without contract, deployment or payment evidence: ${logoOnly.map((n) => n.name).join(", ")}.${presentedPaying ? " At least one is presented as paying." : ""} A logo can mean a free trial, a single user or a past pilot.`,
        claimIds: (mentioned.length ? mentioned : customerClaims).map((c) => c.id),
        pages: (mentioned.length ? mentioned : customerClaims).flatMap((c) => ctx.claimPages(c)),
        key: logoOnly.map((n) => n.name).join(","),
      }),
    );
  }
  if (pilotPaying.length)
    out.push(
      finding({
        kind: "PILOTS_AS_CUSTOMERS",
        module: M,
        severity: "MODERATE",
        title: "Named customers presented as paying are only at pilot / signed stage",
        detail: `Presented as paying, but the materials only support pilot or signed-not-deployed status: ${pilotPaying.map((n) => `${n.name} (${n.evidenceLevel.toLowerCase()})`).join(", ")}.`,
        key: `named:${pilotPaying.map((n) => n.name).join(",")}`,
      }),
    );
  const presentedPaying = named.filter((n) => n.relationship === "PAYING").length;
  if (customers && isNum(customers.normalizedValue) && presentedPaying > customers.normalizedValue)
    out.push(
      finding({
        kind: "LOGO_WALL_EXCEEDS_CUSTOMER_COUNT",
        module: M,
        severity: "MODERATE",
        title: "More logos presented as paying customers than the stated customer count",
        detail: `${presentedPaying} named customers are presented as paying but the stated paying-customer count is ${fmtNum(customers.normalizedValue, 0)}.`,
        metricIds: [customers.id],
        pages: pagesOf(ctx, [customers]),
      }),
    );
}

function grossMargin(ctx: IntegrityContext, out: IntegrityFinding[]) {
  for (const m of ctx.metrics.filter((x) => x.metricKey === "gross_margin" && x.calculationMethod !== "DERIVED")) {
    const text = [m.definitionUsed ?? "", m.components.join("; "), m.rawValue, m.label].join("; ").toLowerCase();
    const excluded = [...text.matchAll(COGS_EXCLUSION_RE)].map((x) => x[1]!.trim()).filter((x) => COGS_ITEM_RE.test(x));
    const flag = hasFlag(m, "GROSS_MARGIN_EXCLUDES_COGS");
    const textless = !m.definitionUsed && m.components.length === 0;
    if (excluded.length || (flag && textless)) {
      out.push(
        finding({
          kind: "GROSS_MARGIN_EXCLUDES_COGS",
          module: M,
          severity: ctx.isAiHeavy ? "HIGH" : "MODERATE",
          title: `Gross margin${isNum(m.normalizedValue) ? ` of ${fmtNum(m.normalizedValue, 0)}%` : ""} excludes delivery costs`,
          detail: `Gross margin is computed ${excluded.length ? `excluding ${excluded.join("; ")}` : "excluding cost of revenue (per normalization flag)"}. ${ctx.isAiHeavy ? "For an AI product, inference/compute and human review are cost of revenue; " : ""}ask for gross margin with all hosting, inference, support and human-in-the-loop costs.`,
          metricIds: [m.id],
          claimIds: [m.claimId],
          pages: pagesOf(ctx, [m]),
        }),
      );
    } else if (m.isPrimary && ctx.isAiHeavy && isNum(m.normalizedValue) && m.normalizedValue > 75 && !/\b(inference|compute|gpu|hosting|cloud|human|review|support)\b/.test(text)) {
      out.push(
        finding({
          kind: "GROSS_MARGIN_COMPOSITION_UNKNOWN",
          module: M,
          severity: "LOW",
          title: `AI gross margin of ${fmtNum(m.normalizedValue, 0)}% without disclosed inference / human costs`,
          detail: "Gross margin above 75% for an inference- or human-review-heavy product; the deck does not say whether inference, hosting and human operations are in cost of revenue.",
          metricIds: [m.id],
          pages: pagesOf(ctx, [m]),
        }),
      );
    }
  }
}

function cac(ctx: IntegrityContext, out: IntegrityFinding[]) {
  for (const m of ctx.metrics.filter((x) => x.metricKey === "cac" && x.calculationMethod !== "DERIVED")) {
    const text = [m.definitionUsed ?? "", m.components.join("; "), m.rawValue, m.label].join("; ").toLowerCase();
    const partial = hasFlag(m, "CAC_NOT_FULLY_LOADED") || CAC_PARTIAL_RE.test(text);
    if (partial && !/\bfully[- ]loaded\b/.test(text.replace(/not fully[- ]loaded/g, ""))) {
      out.push(
        finding({
          kind: "CAC_INCOMPLETE",
          module: M,
          severity: ctx.primary("cac_payback_months") || ctx.primary("ltv_to_cac") ? "HIGH" : "MODERATE",
          title: "CAC is not fully loaded",
          detail: "CAC excludes part of acquisition cost (e.g. sales salaries, commissions, founder time or only counts paid media). Payback and LTV/CAC built on it are overstated.",
          metricIds: [m.id, ctx.primary("cac_payback_months")?.id, ctx.primary("ltv_to_cac")?.id],
          claimIds: [m.claimId],
          pages: pagesOf(ctx, [m]),
        }),
      );
    } else if (hasFlag(m, "CAC_LOADING_UNVERIFIED") && ctx.stageBand !== "EARLY" && m.isPrimary) {
      out.push(
        finding({
          kind: "CAC_INCOMPLETE",
          key: "unverified",
          module: M,
          severity: "LOW",
          title: "CAC composition not stated",
          detail: "CAC is reported without saying whether salaries, commissions and tools are included.",
          metricIds: [m.id],
          pages: pagesOf(ctx, [m]),
        }),
      );
    }
  }
}

function rates(ctx: IntegrityContext, out: IntegrityFinding[]) {
  for (const key of [...RATE_KEYS_MATERIAL, ...RATE_KEYS_OTHER]) {
    const m = ctx.primary(key);
    if (!m || m.calculationMethod === "DERIVED") continue;
    const def = metricDef(key);
    const material = RATE_KEYS_MATERIAL.has(key);
    const text = metricText(m);
    const noDen = hasFlag(m, "NO_DENOMINATOR") || (m.sampleSize === null && !/\b\d+\s+(customers|accounts|users|clients|cohorts?|pilots|deals|logos|merchants|loans|borrowers)\b/.test(text));
    const min = def?.quality.minSampleSize;
    const small = m.sampleSize !== null && isNum(min) && m.sampleSize < min;
    if (noDen)
      out.push(
        finding({
          kind: "RATE_WITHOUT_DENOMINATOR",
          module: M,
          severity: material ? "MODERATE" : "LOW",
          title: `${def?.shortName ?? key} of ${fmtNum(m.normalizedValue, 0)}% stated without its population`,
          detail: `A rate without the number of customers/accounts it is measured on cannot be weighed: ${fmtNum(m.normalizedValue, 0)}% of 4 accounts and of 400 are different facts.`,
          metricIds: [m.id],
          claimIds: [m.claimId],
          pages: pagesOf(ctx, [m]),
        }),
      );
    else if (small)
      out.push(
        finding({
          kind: "SMALL_SAMPLE_RATE",
          module: M,
          severity: m.sampleSize! < min! / 3 ? (material ? "HIGH" : "MODERATE") : material ? "MODERATE" : "LOW",
          title: `${def?.shortName ?? key} measured on n=${m.sampleSize} (min ${min})`,
          detail: `${def?.shortName ?? key} of ${fmtNum(m.normalizedValue, 0)}% rests on ${m.sampleSize} observations, below the ${min} needed for the rate to be stable.`,
          metricIds: [m.id],
          claimIds: [m.claimId],
          pages: pagesOf(ctx, [m]),
        }),
      );
  }
}

function retentionCohorts(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const hits = RETENTION_KEYS.map((k) => ctx.primary(k)).filter(
    (m): m is MetricInstance => !!m && m.calculationMethod !== "DERIVED" && (hasFlag(m, "NO_COHORT_DEFINITION") || (!m.cohortDefinition && !COHORT_RE.test(metricText(m)))),
  );
  if (!hits.length) return;
  const sev: IntegritySeverity = ctx.stageBand === "LATE" ? "HIGH" : ctx.stageBand === "GROWTH" ? "MODERATE" : "LOW";
  out.push(
    finding({
      kind: "RETENTION_WITHOUT_COHORTS",
      module: M,
      severity: sev,
      title: "Aggregate retention without cohorts or measurement window",
      detail: `${hits.map((m) => `${metricDef(m.metricKey)?.shortName ?? m.metricKey} ${fmtNum(m.normalizedValue, 0)}%`).join(", ")} is reported as a single aggregate. Without cohorts, expansion in a few recent accounts can hide churn in older ones.`,
      metricIds: hits.map((m) => m.id),
      claimIds: hits.map((m) => m.claimId),
      pages: pagesOf(ctx, hits),
    }),
  );
}

function cumulative(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const runRateKeys = ["arr", "mrr", "revenue_ttm", "gmv", "tpv"];
  const flagged = ctx.metrics.filter((m) => hasFlag(m, "CUMULATIVE_NOT_RUN_RATE"));
  const flaggedPages = new Set(flagged.map((m) => ctx.metricPage(m)));
  // Free-labelled cumulative money flows ("Revenue since launch", "Loan volume originated since 2023") count too.
  const flowLabel = /\b(revenue|sales|volume|originat\w*|loans?|gmv|tpv|bookings|transactions?|payments?|processed)\b/i;
  const obs = ctx.observations.filter(
    (o) =>
      (runRateKeys.includes(o.metricKey) || (o.metricKey === "OTHER" && o.unit === "USD_OR_CURRENCY" && flowLabel.test(o.label ?? ""))) &&
      o.periodType === "CUMULATIVE" &&
      !flaggedPages.has(o.page) &&
      o.basis !== "FORECAST" &&
      o.basis !== "TARGET",
  );
  if (!flagged.length && !obs.length) return;
  const onRunRate = flagged.some((m) => ["arr", "mrr"].includes(m.metricKey) && m.isPrimary) || obs.some((o) => o.metricKey === "arr" || o.metricKey === "mrr");
  out.push(
    finding({
      kind: "CUMULATIVE_AS_RUN_RATE",
      module: M,
      severity: onRunRate ? "HIGH" : "MODERATE",
      title: "Cumulative figure presented as a run-rate",
      detail: `${flagged.length + obs.length} figure(s) are cumulative since inception (${[...new Set([...flagged.map((m) => m.metricKey), ...obs.map((o) => (o.metricKey === "OTHER" ? `"${o.label}"` : o.metricKey))])].join(", ")}). Cumulative totals always rise and say nothing about the current rate; ask for the same metric per month or quarter.`,
      metricIds: flagged.map((m) => m.id),
      claimIds: flagged.map((m) => m.claimId),
      pages: [...pagesOf(ctx, flagged), ...obs.map((o) => o.page)],
    }),
  );
}

function servicesAsSaas(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const m = ctx.primary("services_revenue_share");
  const c = ctx.classification;
  const saasLabel = c.productType.includes("SAAS") || c.productType.includes("AI_AGENT") || (ctx.isSoftware && c.revenueModel.includes("SUBSCRIPTION"));
  if (!m || !isNum(m.normalizedValue) || !saasLabel || m.normalizedValue <= SERVICES_SHARE_THRESHOLD) return;
  const s = m.normalizedValue;
  const sev: IntegritySeverity = s > 60 ? "CRITICAL" : s > 40 ? "HIGH" : "MODERATE";
  out.push(
    finding({
      kind: "SERVICES_AS_SAAS",
      module: M,
      severity: sev,
      title: `${fmtNum(s, 0)}% of revenue is services in a company presented as SaaS`,
      detail: `Services are ${fmtNum(s, 0)}% of revenue (threshold ${SERVICES_SHARE_THRESHOLD}%). Services revenue carries lower margins, does not recur and scales with headcount; SaaS benchmarks and multiples do not apply to it.`,
      metricIds: [m.id],
      claimIds: [m.claimId],
      pages: pagesOf(ctx, [m]),
    }),
  );
}

function selfServe(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const gtm = ctx.deal.gtm;
  const gtmText = [str(gtm?.salesMotion), ...arr(gtm?.channels)].join(" ");
  const selfServeClaims = ctx.claims.filter((c) => SELF_SERVE_RE.test(c.statement));
  const claimed = ctx.classification.gtm.includes("PLG") || ctx.classification.gtm.includes("SELF_SERVE") || SELF_SERVE_RE.test(gtmText) || selfServeClaims.length > 0;
  if (!claimed) return;
  const cycleMetric = ctx.primary("sales_cycle_days");
  const cycle = cycleMetric?.normalizedValue ?? parseDurationDays(gtm?.salesCycle);
  const acv = ctx.primary("acv");
  const acvV = acv?.normalizedValue ?? null;
  const reasons: string[] = [];
  if (isNum(cycle) && cycle > SELF_SERVE_MAX_CYCLE_DAYS) reasons.push(`sales cycle ≈ ${fmtNum(cycle, 0)} days`);
  if (isNum(acvV) && acvV >= ENTERPRISE_ACV_USD) reasons.push(`ACV ${fmtUsd(acvV)}`);
  if (!reasons.length) return;
  const sev: IntegritySeverity = (isNum(cycle) && cycle > 180) || (isNum(acvV) && acvV >= 100_000) ? "HIGH" : "MODERATE";
  out.push(
    finding({
      kind: "SELF_SERVE_WITH_ENTERPRISE_SIGNALS",
      module: M,
      severity: sev,
      title: "Self-serve / PLG claim contradicted by enterprise sales signals",
      detail: `The company presents a self-serve or product-led motion but ${reasons.join(" and ")}. Self-serve motions close in days to weeks at low ACV; the economics, hiring plan and benchmarks should be those of a sales-led company.`,
      metricIds: [cycleMetric?.id, acv?.id],
      claimIds: selfServeClaims.map((c) => c.id),
      pages: [...pagesOf(ctx, [cycleMetric, acv]), ...selfServeClaims.flatMap((c) => ctx.claimPages(c))],
    }),
  );
}

function stale(ctx: IntegrityContext, out: IntegrityFinding[]) {
  const seen = new Set<string>();
  for (const m of ctx.metrics) {
    if (!m.isPrimary || seen.has(m.metricKey)) continue;
    if (!(m.state === "STALE" || hasFlag(m, "STALE"))) continue;
    seen.add(m.metricKey);
    const cash = CASH_KEYS.has(m.metricKey);
    const core = CORE_KEYS.has(m.metricKey);
    out.push(
      finding({
        kind: "STALE_METRIC_AS_CURRENT",
        module: M,
        severity: cash ? "HIGH" : core ? "MODERATE" : "LOW",
        title: `${metricDef(m.metricKey)?.shortName ?? m.metricKey} is stale (as of ${m.periodEnd ?? "unknown"})`,
        detail: `${m.qualityFlags.find((f) => f.startsWith("STALE")) ?? "Older than the dictionary's freshness limit"}. It is presented as a current figure; ask for the latest value.`,
        metricIds: [m.id],
        claimIds: [m.claimId],
        pages: pagesOf(ctx, [m]),
      }),
    );
  }
}

function derivedVsReported(ctx: IntegrityContext, out: IntegrityFinding[]) {
  for (const m of ctx.metrics.filter((x) => hasFlag(x, "INCONSISTENT_WITH_INPUTS"))) {
    out.push(
      finding({
        kind: "DERIVED_VS_REPORTED",
        module: M,
        severity: "MODERATE",
        title: `Reported ${metricDef(m.metricKey)?.shortName ?? m.metricKey} disagrees with its own inputs`,
        detail: `${m.qualityFlags.find((f) => f.startsWith("INCONSISTENT_WITH_INPUTS"))}; reported ${fmtNum(m.normalizedValue, 1)}.`,
        metricIds: [m.id],
        claimIds: [m.claimId],
        pages: pagesOf(ctx, [m]),
      }),
    );
  }
  for (const m of ctx.metrics.filter((x) => x.metricKey === "arr" && hasFlag(x, "MONTHLY_FIGURE_LABELLED_ARR"))) {
    out.push(
      finding({
        kind: "MONTHLY_FIGURE_AS_ARR",
        module: M,
        severity: "MODERATE",
        title: "ARR is a single month annualized",
        detail: "A monthly figure was labelled ARR and annualized ×12. A single strong month is a run-rate, not contracted recurring revenue.",
        metricIds: [m.id],
        pages: pagesOf(ctx, [m]),
      }),
    );
  }
}

export function metricRules(ctx: IntegrityContext): IntegrityFinding[] {
  const out: IntegrityFinding[] = [];
  growthOnTinyBase(ctx, out);
  gmvAsRevenue(ctx, out);
  bookingsAsArr(ctx, out);
  pilotsAndLogos(ctx, out);
  grossMargin(ctx, out);
  cac(ctx, out);
  rates(ctx, out);
  retentionCohorts(ctx, out);
  cumulative(ctx, out);
  servicesAsSaas(ctx, out);
  selfServe(ctx, out);
  stale(ctx, out);
  derivedVsReported(ctx, out);
  return out;
}
