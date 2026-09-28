/**
 * Deterministic fast path for simple fact questions ("Quel est le CAC de X ?",
 * "ARR of X?"). No model call: the answer is read from the same canonical
 * object every view renders (zero divergence), with its status, period,
 * source and caveats — or "On ne sait pas encore" when the record does not
 * contain it. Anything that needs judgment falls through to the model path.
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import { metricDef } from "@/engine/metrics/dictionary";
import { metricValue, usd } from "@/lib/format";

export type Lang = "fr" | "en";

export function detectLanguage(q: string): Lang {
  if (/[àâçéèêëîïôûùüÿœ]|\bqu['’]|\b[ldjcs]['’]\w/i.test(q)) return "fr";
  const fr = (q.match(/\b(le|la|les|des|est|quel|quelle|quels|quelles|pourquoi|avons|combien|de|du|sur|dit|ce|que|qui|pour|avec|dans|une|un|il|elle|nous|vous|comment|où|ou|et|pas|sont|a|au|aux|son|sa|ses|leur)\b/gi) ?? []).length;
  const en = (q.match(/\b(the|is|are|what|why|how|which|who|did|does|do|of|on|for|with|in|and|a|an|to|say|said|their|its)\b/gi) ?? []).length;
  return fr > en ? "fr" : "en";
}

type FactKey = { kind: "METRIC"; key: string; related: string[] } | { kind: "VALUATION" } | { kind: "RAISE" };

/** Ordered: the first match wins, more specific patterns first. */
const FACT_PATTERNS: [RegExp, FactKey][] = [
  [/\bcac\s*payback|payback\b|retour sur (le )?cac/i, { kind: "METRIC", key: "cac_payback_months", related: ["cac", "ltv_to_cac"] }],
  [/\bltv\s*[/:]\s*cac|ltv to cac|ratio ltv/i, { kind: "METRIC", key: "ltv_to_cac", related: ["cac", "ltv"] }],
  [/\bcac\b|co[uû]ts? d'acquisition|customer acquisition cost/i, { kind: "METRIC", key: "cac", related: ["cac_payback_months", "ltv_to_cac"] }],
  [/\bltv\b|lifetime value|valeur vie client/i, { kind: "METRIC", key: "ltv", related: ["ltv_to_cac"] }],
  [/\bnrr\b|\bndr\b|net (revenue|dollar) retention|r[ée]tention nette/i, { kind: "METRIC", key: "nrr", related: ["grr", "logo_retention"] }],
  [/\bgrr\b|gross (revenue )?retention|r[ée]tention brute/i, { kind: "METRIC", key: "grr", related: ["nrr", "logo_retention"] }],
  [/\bchurn\b|attrition/i, { kind: "METRIC", key: "logo_retention", related: ["grr", "nrr", "churned_arr"] }],
  [/\bmrr\b/i, { kind: "METRIC", key: "mrr", related: ["arr"] }],
  [/\barr growth|croissance (de l'|du )?arr/i, { kind: "METRIC", key: "arr_growth_yoy", related: ["arr", "revenue_growth_yoy"] }],
  [/\barr\b|annual recurring revenue|revenu r[ée]current/i, { kind: "METRIC", key: "arr", related: ["mrr", "contracted_arr", "revenue_ttm"] }],
  [/gross margin|marge brute/i, { kind: "METRIC", key: "gross_margin", related: ["contribution_margin"] }],
  [/burn multiple/i, { kind: "METRIC", key: "burn_multiple", related: ["monthly_net_burn"] }],
  [/\bburn\b|cash burn|br[uû]le/i, { kind: "METRIC", key: "monthly_net_burn", related: ["runway_months", "cash_balance"] }],
  [/\brunway\b|piste de tr[ée]sorerie/i, { kind: "METRIC", key: "runway_months", related: ["monthly_net_burn", "cash_balance"] }],
  [/\bacv\b|annual contract value|panier moyen|taille moyenne des contrats/i, { kind: "METRIC", key: "acv", related: ["arr", "paying_customers"] }],
  [/headcount|effectif|nombre d'employ[ée]s|how many employees|team size|taille de l'[ée]quipe/i, { kind: "METRIC", key: "headcount", related: [] }],
  [/nombre de clients|combien de clients|how many customers|paying customers|clients payants|customer count/i, { kind: "METRIC", key: "paying_customers", related: ["pilots", "logo_retention"] }],
  [/sales cycle|cycle de vente/i, { kind: "METRIC", key: "sales_cycle_days", related: ["win_rate"] }],
  [/\bgmv\b/i, { kind: "METRIC", key: "gmv", related: ["take_rate"] }],
  [/take rate/i, { kind: "METRIC", key: "take_rate", related: ["gmv"] }],
  [/\bmau\b|monthly active/i, { kind: "METRIC", key: "mau", related: ["dau_mau"] }],
  [/valuation|valo(risation)?|pre-?money|post-?money|\bcap\b/i, { kind: "VALUATION" }],
  [/how much (are they|is it) raising|montant (de la )?lev[ée]e|combien (l[eè]vent|ils l[eè]vent|l[eè]ve)|round size|taille du tour|raise\b|lev[ée]e/i, { kind: "RAISE" }],
];

/** Anything needing judgment, synthesis or several subjects goes to the model. */
const NEEDS_JUDGMENT =
  /(\b(pourquoi|why|versus|vs\.?|should|devrait|faut[- ]il|pense|think|how does|how do|trend|meilleur|best|bon|good|bad|mauvais|benchmark|peer|IC|james|thesis)\b)|\b(compar|challeng|risque|risk|expli|comment\b|[ée]volution|similai?r|cr[ée]dib|r[ée]alist|comit[ée]|th[èe]se)/i;

export function detectFactQuestion(question: string): FactKey | null {
  const q = question.trim();
  if (q.length > 140 || NEEDS_JUDGMENT.test(q)) return null;
  const hits = FACT_PATTERNS.filter(([re]) => re.test(q));
  if (hits.length === 0) return null;
  // Two different facts asked at once ("ARR et NRR") → model path.
  const keys = new Set(hits.map(([, k]) => (k.kind === "METRIC" ? k.key : k.kind)));
  const first = hits[0]![1];
  if (keys.size > 1 && !(first.kind === "METRIC" && [...keys].every((k) => k === first.key || first.related.includes(k)))) return null;
  return first;
}

export interface FastCitation {
  n: number;
  title: string;
  href: string | null;
  label: string | null;
  kind: string;
}

export interface FastAnswer {
  text: string;
  citations: FastCitation[];
  factKey: string;
  found: boolean;
}

const T = {
  fr: {
    unknown: "On ne sait pas encore.",
    notInDeck: (co: string, m: string) => `Le dossier de ${co} ne contient pas de ${m}.`,
    withheld: (co: string, m: string) => `${co} indique explicitement ne pas communiquer son ${m}.`,
    related: "Indicateurs voisins disponibles",
    gap: "Question ouverte",
    ask: "Prochaine action",
    askDefault: (m: string, def: string) => `demander au fondateur le ${m} (${def}).`,
    asOf: "au",
    period: "période",
    source: "Source",
    derived: (inputs: string) => `calculé par Conviction à partir de ${inputs}`,
    implication: "Implication",
    unverified: "Chiffre déclaré par la société, non vérifié : à confirmer avant de l'utiliser dans une conclusion d'IC.",
    verified: "Chiffre corroboré par une source indépendante.",
    contradicted: "Attention : une source contredit ce chiffre.",
    flags: "Points d'attention",
    other: "Autres points",
    noValuation: (co: string) => `Le dossier de ${co} ne donne ni pre-money, ni post-money, ni cap.`,
    noRaise: (co: string) => `Le dossier de ${co} ne donne pas le montant du tour.`,
    valuationAsk: "demander les termes du tour (pre/post-money, instrument, cap, pool d'options).",
    fromDeck: "tel qu'indiqué dans le deck",
  },
  en: {
    unknown: "We don't know yet.",
    notInDeck: (co: string, m: string) => `${co}'s record does not contain a ${m}.`,
    withheld: (co: string, m: string) => `${co} explicitly declines to disclose its ${m}.`,
    related: "Related metrics available",
    gap: "Open question",
    ask: "Next action",
    askDefault: (m: string, def: string) => `ask the founder for the ${m} (${def}).`,
    asOf: "as of",
    period: "period",
    source: "Source",
    derived: (inputs: string) => `computed by Conviction from ${inputs}`,
    implication: "Implication",
    unverified: "Company-reported, not verified: confirm before relying on it in an IC conclusion.",
    verified: "Corroborated by an independent source.",
    contradicted: "Caution: a source contradicts this figure.",
    flags: "Caveats",
    other: "Other data points",
    noValuation: (co: string) => `${co}'s record gives no pre-money, post-money or cap.`,
    noRaise: (co: string) => `${co}'s record does not give the round size.`,
    valuationAsk: "ask for the round terms (pre/post-money, instrument, cap, option pool).",
    fromDeck: "as stated in the deck",
  },
} as const;

function statusLabel(m: MetricInstance, lang: Lang): string {
  const fr = lang === "fr";
  if (m.calculationMethod === "USER_CORRECTED") return fr ? "corrigé par un analyste" : "analyst-corrected";
  if (m.calculationMethod === "DERIVED") return fr ? "calcul" : "computed";
  switch (m.verification) {
    case "VERIFIED":
      return fr ? "vérifié" : "verified";
    case "PARTIALLY_VERIFIED":
      return fr ? "partiellement vérifié" : "partially verified";
    case "CONTRADICTED":
      return fr ? "contredit" : "contradicted";
    default:
      return fr ? "déclaré par la société" : "company-reported";
  }
}

const FLAG_TEXT: Record<string, { fr: string; en: string }> = {
  SIGNED_NOT_DEPLOYED: { fr: "inclut du signé non déployé", en: "includes signed-not-deployed revenue" },
  CUMULATIVE_NOT_RUN_RATE: { fr: "cumul, pas un run-rate", en: "cumulative, not a run-rate" },
  GROSS_MARGIN_EXCLUDES_COGS: { fr: "marge brute hors certains coûts (inférence / ops humaines ?)", en: "gross margin excludes some costs (inference / human ops?)" },
  CUSTOMER_COUNT_MAY_INCLUDE_NON_PAYING: { fr: "peut inclure des clients non payants / pilotes", en: "may include non-paying customers / pilots" },
  ARR_MAY_INCLUDE_NON_RECURRING: { fr: "peut inclure du non-récurrent", en: "may include non-recurring revenue" },
  NO_DENOMINATOR: { fr: "dénominateur non précisé", en: "denominator not stated" },
  NO_COHORT_DEFINITION: { fr: "cohorte non définie", en: "cohort not defined" },
  CAC_NOT_FULLY_LOADED: { fr: "CAC non entièrement chargé", en: "CAC not fully loaded" },
  STALE: { fr: "donnée ancienne", en: "stale data" },
  NO_AS_OF_DATE: { fr: "pas de date de référence", en: "no as-of date" },
  SAMPLE_SIZE_UNKNOWN: { fr: "taille d'échantillon inconnue", en: "sample size unknown" },
};

function flagText(f: string, lang: Lang) {
  const key = Object.keys(FLAG_TEXT).find((k) => f.startsWith(k));
  if (key) return FLAG_TEXT[key]![lang];
  if (f.startsWith("SMALL_SAMPLE")) return lang === "fr" ? "petit échantillon" : "small sample";
  return f.toLowerCase().replace(/_/g, " ");
}

function metricHref(slug: string, id: string) {
  return `/deals/${slug}/evidence?metric=${id}`;
}

function pickInstance(ms: MetricInstance[]): MetricInstance | null {
  const usable = ms.filter((m) => m.state === "OBSERVED" && m.normalizedValue !== null);
  if (!usable.length) return null;
  return usable.find((m) => m.isPrimary) ?? [...usable].sort((a, b) => (b.periodEnd ?? "").localeCompare(a.periodEnd ?? ""))[0]!;
}

export function answerFact(fact: FactKey, co: { name: string; slug: string }, deal: CanonicalDeal, lang: Lang): FastAnswer {
  const t = T[lang];
  const citations: FastCitation[] = [];
  const cite = (title: string, href: string | null, label: string | null, kind = "TABLE") => {
    citations.push({ n: citations.length + 1, title, href, label, kind });
    return `[${citations.length}]`;
  };

  if (fact.kind === "VALUATION" || fact.kind === "RAISE") {
    const f = deal.financing;
    const parts: string[] = [];
    const money = (label: string, m: { amount: number | null; currency: string; rawText: string } | null | undefined) =>
      m && m.amount !== null ? `${label} ${m.currency === "USD" ? usd(m.amount, 1) : m.rawText}` : null;
    const items =
      fact.kind === "VALUATION"
        ? [money("pre-money", f?.preMoney), money("post-money", f?.postMoney), money("cap", f?.valuationCap)]
        : [money(lang === "fr" ? "levée" : "raise", f?.raiseAmount)];
    for (const x of items) if (x) parts.push(x);
    const href = `/deals/${co.slug}/returns`;
    if (!parts.length) {
      return {
        text: `**${t.unknown}** ${fact.kind === "VALUATION" ? t.noValuation(co.name) : t.noRaise(co.name)}\n\n**${t.ask}** : ${t.valuationAsk}`,
        citations,
        factKey: fact.kind,
        found: false,
      };
    }
    const ref = cite(`${co.name} — ${lang === "fr" ? "termes du tour" : "round terms"}`, href, "COMPANY_REPORTED");
    const instrument = f?.instrument && f.instrument !== "UNKNOWN" ? ` · ${f.instrument}` : "";
    return {
      text: `**${co.name} — ${parts.join(" · ")}**${instrument} ${ref}\n\n${t.fromDeck} (${statusLabel({ verification: "UNVERIFIED", calculationMethod: "REPORTED" } as MetricInstance, lang)}).`,
      citations,
      factKey: fact.kind,
      found: true,
    };
  }

  const def = metricDef(fact.key);
  const name = def?.shortName ?? fact.key;
  const all = deal.metrics.filter((m) => m.metricKey === fact.key);
  const m = pickInstance(all);

  if (!m) {
    const withheld = all.some((x) => x.state === "WITHHELD") || deal.metricObservations.some((o) => o.metricKey === fact.key && o.state === "WITHHELD");
    const lines = [`**${t.unknown}** ${withheld ? t.withheld(co.name, name) : t.notInDeck(co.name, name)}`];
    const related = fact.related.map((k) => pickInstance(deal.metrics.filter((x) => x.metricKey === k))).filter((x): x is MetricInstance => !!x);
    if (related.length) {
      lines.push(
        `\n${t.related} :\n${related
          .map((r) => `- ${metricDef(r.metricKey)?.shortName ?? r.label} : ${metricValue(r.unit, r.normalizedValue)} (${statusLabel(r, lang)}) ${cite(`${co.name} — ${r.label} (${r.id})`, metricHref(co.slug, r.id), r.verification)}`)
          .join("\n")}`,
      );
    }
    const words = [name.toLowerCase(), fact.key.replace(/_/g, " ")];
    const gap = deal.informationGaps.find((g) => g.status !== "RESOLVED" && words.some((w) => g.question.toLowerCase().includes(w)));
    if (gap) lines.push(`\n${t.gap} ${cite(`${co.name} — ${gap.id}`, `/deals/${co.slug}/questions#${gap.id}`, gap.status, "GAP")} : ${gap.question}`);
    const q = deal.questions.find((x) => words.some((w) => x.question.toLowerCase().includes(w)));
    lines.push(`\n**${t.ask}** : ${q ? `${q.question} ${cite(`${co.name} — ${q.id}`, `/deals/${co.slug}/questions#${q.id}`, q.tier, "QUESTION")}` : t.askDefault(name, (def?.definition ?? "").slice(0, 160))}`);
    return { text: lines.join("\n"), citations, factKey: fact.key, found: false };
  }

  const ref = cite(`${co.name} — ${m.label} (${m.id})`, metricHref(co.slug, m.id), m.verification);
  const when = m.periodEnd ? ` ${t.asOf} ${m.periodEnd}` : "";
  const basis = m.basis && m.basis !== "CURRENT" ? ` · ${m.basis}` : "";
  const how = m.calculationMethod === "DERIVED" ? ` — ${t.derived(m.inputs.join(", ") || (m.derivation ?? ""))}` : "";
  const lines = [`**${co.name} — ${name} : ${metricValue(m.unit, m.normalizedValue)}**${when}${basis} (${statusLabel(m, lang)}${how}) ${ref}`];
  if (m.excerpt || m.location) lines.push(`\n${t.source} : ${m.location ?? ""}${m.excerpt ? ` « ${m.excerpt.slice(0, 160)} »` : ""}`);
  const flags = m.qualityFlags.map((f) => flagText(f, lang));
  if (flags.length) lines.push(`\n${t.flags} : ${[...new Set(flags)].join(" ; ")}.`);
  const others = all.filter((x) => x.id !== m.id && x.state === "OBSERVED" && x.normalizedValue !== null).slice(0, 3);
  if (others.length) lines.push(`\n${t.other} : ${others.map((x) => `${metricValue(x.unit, x.normalizedValue)}${x.periodEnd ? ` (${x.periodEnd})` : ""} ${cite(`${co.name} — ${x.label} (${x.id})`, metricHref(co.slug, x.id), x.verification)}`).join(" · ")}`);
  const implication = m.verification === "CONTRADICTED" ? t.contradicted : m.verification === "VERIFIED" ? t.verified : m.calculationMethod === "REPORTED" ? t.unverified : null;
  if (implication) lines.push(`\n**${t.implication}** : ${implication}`);
  return { text: lines.join("\n"), citations, factKey: fact.key, found: true };
}
