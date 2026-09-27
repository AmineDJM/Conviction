/**
 * INVESTMENT MEMO (§72, §99) — deterministic renderer.
 *
 *   (canonical, derived) → structured sections → any surface (web reader, PDF)
 *
 * No model calls. Prose comes from the canonical object's analysed fields;
 * every number comes from canonical metrics or the derived analysis and is
 * formatted, never re-derived (§74 report consistency). Evidence references
 * (CLM-…, SRC-…, MET-…, RSK-…, Q-…) are kept inline so a renderer can link them.
 */
import type { CanonicalDeal, MetricInstance } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";
import { metricEvidence } from "@/components/deal/metric";
import { DECISION_LABEL, STAGE_LABEL, metricValue, multiple, pct, usd } from "@/lib/format";
import { NOT_DISCLOSED, clip, enumLabel as label, humanList } from "./text";

export type MemoBlock =
  | { kind: "lead"; text: string }
  | { kind: "p"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "bullets"; items: string[]; tone?: "ok" | "warn" | "risk" }
  | { kind: "kv"; rows: { k: string; v: string }[] }
  | { kind: "table"; head: string[]; rows: string[][]; align?: ("left" | "right")[]; widths?: (string | null)[]; caption?: string }
  | { kind: "note"; tone: "neutral" | "warn" | "risk" | "ok"; title?: string; text: string }
  | { kind: "decision"; status: string; label: string; detail: string };

export interface MemoSection {
  id: string;
  title: string;
  blocks: MemoBlock[];
  /** True when the underlying canonical section was absent (FAST_SCREEN / PARTIAL). */
  missing?: boolean;
}

export interface InvestmentMemo {
  company: string;
  subtitle: string;
  sections: MemoSection[];
}

const MISSING: MemoBlock = { kind: "p", text: "Not analysed in this version." };

const SCEN: Record<string, string> = { FAILURE: "Failure", LOW: "Low", BASE: "Base", BULL: "Bull", OUTLIER: "Outlier" };

function irr(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  if (Math.abs(p) < 0.05) return "0.0%";
  return `${p < 0 ? "−" : ""}${Math.abs(p).toFixed(1)}%`;
}

function metricRows(ms: MetricInstance[]): string[][] {
  return ms.map((m) => {
    const def = metricDef(m.metricKey);
    const ev = metricEvidence(m);
    return [
      `${def?.shortName ?? m.label} (${m.id})`,
      metricValue(m.unit, m.normalizedValue),
      m.periodEnd ?? "—",
      m.sampleSize !== null ? `n=${m.sampleSize}` : "—",
      ev.text,
    ];
  });
}

const TRACTION_KEYS = [
  "arr",
  "mrr",
  "revenue_ttm",
  "gmv",
  "tpv",
  "arr_growth_yoy",
  "revenue_growth_yoy",
  "mom_growth",
  "paying_customers",
  "active_accounts",
  "mau",
  "dau",
  "dau_mau",
  "nrr",
  "grr",
  "logo_retention",
  "d1_retention",
  "d7_retention",
  "d30_retention",
  "repeat_rate",
  "fill_rate",
  "pilots",
  "pilot_to_production_rate",
  "time_to_value_days",
  "customer_concentration_top1",
  "customer_concentration_top5",
  "win_rate",
  "pipeline_value",
  "units_shipped",
  "backlog",
];
const ECON_KEYS = [
  "acv",
  "arpu_monthly",
  "asp",
  "take_rate",
  "gross_margin",
  "contribution_margin",
  "cac",
  "cac_payback_months",
  "ltv",
  "ltv_to_cac",
  "magic_number",
  "burn_multiple",
  "monthly_net_burn",
  "cash_balance",
  "runway_months",
  "capital_to_next_milestone",
  "revenue_per_employee",
  "headcount",
  "sales_cycle_days",
  "founder_led_revenue_share",
  "organic_acquisition_share",
  "default_rate",
  "loss_rate",
  "defect_rate",
];

export function buildInvestmentMemo(c: CanonicalDeal, d: DerivedAnalysis): InvestmentMemo {
  const S: MemoSection[] = [];
  const rec = d.recommendation;
  const entry = d.returns.inputs.entry;
  const isSafe = entry.instrument === "SAFE" || entry.instrument === "CONVERTIBLE_NOTE";
  const base = d.returns.scenarios.find((s) => s.scenario === "BASE");
  const primary = c.metrics.filter((m) => m.isPrimary && m.normalizedValue !== null);
  // The gate outcome is rendered from derived.recommendation; the AI's own suggestion is shown only in the gate trace.
  const rationale = rec.rationale.replace(/^Model suggested [A-Z_]+, which the gates do not admit\. Applied [A-Z_]+\.\s*/, "");
  const summary = c.executiveSummary?.replace(/\s*Recommendation:[^.]*(\.[^.]*)?\.?\s*$/, "").trim() ?? null;

  /* 1. Executive recommendation */
  {
    const b: MemoBlock[] = [
      { kind: "decision", status: rec.status, label: DECISION_LABEL[rec.status] ?? label(rec.status), detail: rationale },
    ];
    if (summary) b.push({ kind: "lead", text: summary });
    b.push({
      kind: "kv",
      rows: [
        { k: "Operating quality", v: d.operatingQuality.value !== null ? `${Math.round(d.operatingQuality.value)} / 100 (bounds ${Math.round(d.operatingQuality.lower)}–${Math.round(d.operatingQuality.upper)}, ${d.peerGroup.name})` : "Not scorable" },
        { k: "Evidence quality", v: `${label(d.evidence.category)} — ${d.evidence.verifiedMaterial} of ${d.evidence.materialClaims} material claims verified, ${d.evidence.contradictedMaterial} contradicted` },
        { k: "Power-law potential", v: d.powerLaw.value !== null ? `${Math.round(d.powerLaw.value)} (anchored index, bounds ${Math.round(d.powerLaw.lower)}–${Math.round(d.powerLaw.upper)})` : "Not scorable" },
        { k: "Fund fit", v: `Mandate ${label(d.fundFit.mandate)}${d.fundFit.index !== null ? ` · index ${Math.round(d.fundFit.index)}` : ""}` },
        { k: "Base case", v: base ? `${multiple(base.grossMoic)} gross MOIC, ${irr(base.grossIrr)} gross IRR, ${pct(base.exitOwnershipPct, 2)} exit ownership` : "Not modelable (entry valuation unknown)" },
        { k: "Backwards test", v: d.backwards ? `${label(d.backwards.plausibility)} — ${d.backwards.explanation}` : "—" },
        { k: "Financing risk", v: label(d.financing.risk) },
        { k: "Next best action", v: c.nextBestAction?.action ?? "—" },
      ],
    });
    b.push({ kind: "note", tone: "neutral", text: "Indices are conventional 0–100 scales for comparison, not probabilities. Scenarios are not probability-weighted. This is an analytical recommendation; the IC decision is recorded separately." });
    S.push({ id: "executive", title: "Executive recommendation", blocks: b });
  }

  /* 2. Company */
  {
    const cl = c.classification;
    S.push({
      id: "company",
      title: "Company",
      blocks: [
        { kind: "lead", text: c.identity.oneLiner },
        ...(c.product?.plainExplanation ? [{ kind: "p", text: c.product.plainExplanation } as MemoBlock] : []),
        {
          kind: "kv",
          rows: [
            ...(() => {
              const known: { k: string; v: string }[] = [];
              const missing: string[] = [];
              const add = (k: string, v: string | null) => (v ? known.push({ k, v }) : missing.push(k.toLowerCase()));
              add("Legal name", c.identity.legalName);
              add("Headquarters", c.identity.hqCountry);
              add("Founded", c.identity.foundedYear ? String(c.identity.foundedYear) : null);
              add("Website", c.identity.website);
              return missing.length ? [...known, { k: "Not disclosed", v: missing.join(", ") }] : known;
            })(),
            { k: "Classification", v: [cl.industry.map(label).join(", "), cl.productType.map(label).join(", "), cl.revenueModel.map(label).join(", ")].filter(Boolean).join(" · ") || "—" },
            { k: "Go-to-market", v: cl.gtm.map(label).join(", ") || "—" },
            { k: "Maturity · stage", v: `${label(cl.operationalMaturity)} · ${STAGE_LABEL[cl.financingStage] ?? label(cl.financingStage)}${cl.declaredStage ? ` (declared “${cl.declaredStage}”)` : ""}` },
          ],
        },
        ...(cl.rationale ? [{ kind: "p", text: cl.rationale } as MemoBlock] : []),
      ],
    });
  }

  /* 3. Exceptional strength */
  S.push({
    id: "strength",
    title: "Exceptional strength",
    blocks: c.exceptionalStrengths.length
      ? c.exceptionalStrengths.flatMap((x, i) => [
          ...(c.exceptionalStrengths.length > 1 ? [{ kind: "h3", text: `Strength ${i + 1}` } as MemoBlock] : []),
          { kind: "lead", text: x.claim } as MemoBlock,
          {
            kind: "kv",
            rows: [
              { k: "Kind · rating", v: `${label(x.kind)} · ${label(x.rating)}` },
              { k: "Evidence", v: x.evidence },
              { k: "Why it matters", v: x.whyItMatters },
              { k: "Durability", v: x.durability },
              { k: "What would invalidate it", v: x.invalidation },
            ],
          } as MemoBlock,
        ])
      : [{ kind: "p", text: "The analysis did not find a precise, evidenced exceptional strength. That is itself a finding." }],
  });

  /* 4. Investment thesis */
  S.push(
    c.thesis
      ? {
          id: "thesis",
          title: "Investment thesis",
          blocks: [
            { kind: "lead", text: c.thesis.bet },
            { kind: "bullets", items: c.thesis.thesisPoints, tone: "ok" },
            { kind: "h3", text: "Required conditions" },
            {
              kind: "table",
              head: ["Condition", "Current evidence", "Status"],
              rows: c.thesis.requiredConditions.map((r) => [r.condition, r.currentEvidence, label(r.status)]),
              widths: ["32%", null, "130px"],
            },
            { kind: "kv", rows: [{ k: "Return path", v: c.thesis.returnPath }, { k: "Next proof", v: c.thesis.nextProof }] },
          ],
        }
      : { id: "thesis", title: "Investment thesis", blocks: [MISSING], missing: true },
  );

  /* 5. Product */
  {
    const p = c.product;
    S.push(
      p
        ? {
            id: "product",
            title: "Product",
            blocks: [
              { kind: "lead", text: `${p.whatItIs} ${p.whatItDoes}` },
              { kind: "kv", rows: [{ k: "User", v: p.user }, { k: "Buyer", v: p.buyer }, { k: "Workflow change", v: p.workflowChange }] },
              ...(p.before.length || p.after.length
                ? [
                    {
                      kind: "kv",
                      rows: [
                        { k: "Before", v: p.before.join(" → ") || "—" },
                        { k: "With the product", v: p.after.join(" → ") || "—" },
                      ],
                    } as MemoBlock,
                  ]
                : []),
              ...(p.valueQuantification.length
                ? [
                    { kind: "h3", text: "Value quantification" } as MemoBlock,
                    {
                      kind: "table",
                      head: ["Value", "Statement", "Evidence status"],
                      rows: p.valueQuantification.map((v) => [label(v.kind), `${v.statement}${v.baseline ? ` (baseline: ${v.baseline})` : ""}`, label(v.evidenceStatus)]),
                      widths: ["130px", null, "140px"],
                    } as MemoBlock,
                  ]
                : []),
            ],
          }
        : { id: "product", title: "Product", blocks: [MISSING], missing: true },
    );
  }

  /* 6. Customer */
  {
    const b: MemoBlock[] = [];
    if (c.pain) {
      b.push({ kind: "p", text: c.pain.assessment });
      b.push({
        kind: "kv",
        rows: [
          { k: "Demand type", v: label(c.pain.demandType) },
          { k: "Frequency", v: c.pain.frequency },
          { k: "Severity", v: c.pain.severity },
          { k: "Economic cost", v: c.pain.economicCost },
          { k: "Urgency", v: c.pain.urgency },
          { k: "Existing budget", v: c.pain.existingBudget },
          { k: "Alternative today", v: c.pain.alternativeBehavior },
        ],
      });
    }
    if (c.customers) {
      b.push({ kind: "h3", text: "Customers" });
      b.push({ kind: "kv", rows: [{ k: "ICP", v: c.customers.icp }, { k: "Segments", v: c.customers.segments.join("; ") || "—" }, { k: "Concentration", v: c.customers.concentrationNote ?? NOT_DISCLOSED }, { k: "References", v: c.customers.referencesNote }] });
      if (c.customers.namedCustomers.length)
        b.push({ kind: "kv", rows: [{ k: "Named customers", v: c.customers.namedCustomers.map((n) => `${n.name} (${label(n.relationship).toLowerCase()})`).join(", ") }] });
    }
    S.push(b.length ? { id: "customer", title: "Customer and pain", blocks: b } : { id: "customer", title: "Customer and pain", blocks: [MISSING], missing: true });
  }

  /* 7. Founders */
  {
    const b: MemoBlock[] = [];
    for (const f of c.founders) {
      b.push({ kind: "h3", text: `${f.name} — ${f.role}` });
      b.push({ kind: "p", text: f.summary });
      b.push({ kind: "kv", rows: [{ k: "Founder–market fit", v: f.founderMarketFit }] });
      if (f.timeline.length) b.push({ kind: "kv", rows: [{ k: "Track record", v: f.timeline.map((t) => `${t.organization} — ${t.role} (${t.period})`).join("; ") }] });
      const caps = f.capabilities.filter((x) => x.relevant);
      if (caps.length)
        b.push({
          kind: "kv",
          rows: [
            {
              k: "Capabilities",
              v: caps.map((x) => `${label(x.dimension)}: ${label(x.rating).toLowerCase()}${x.observability !== "OBSERVABLE" ? ` (${label(x.observability).toLowerCase()})` : ""}`).join(" · "),
            },
          ],
        });
      if (f.notObservableWithoutInterview.length) b.push({ kind: "p", text: `Not observable without interview: ${f.notObservableWithoutInterview.join("; ")}.` });
    }
    if (!c.founders.length && c.foundersFromDeck.length)
      b.push({ kind: "table", head: ["Founder", "Role", "Background (deck)"], rows: c.foundersFromDeck.map((f) => [f.name, f.role, f.backgroundFromDeck]), widths: ["22%", "15%", null] });
    S.push(b.length ? { id: "founders", title: "Founders", blocks: b } : { id: "founders", title: "Founders", blocks: [MISSING], missing: true });
  }

  /* 8. Market */
  {
    const b: MemoBlock[] = [];
    if (c.market) b.push({ kind: "p", text: c.market.currentMarket }, { kind: "kv", rows: [{ k: "Wedge", v: c.market.wedge }] });
    if (d.market.ranges.length)
      b.push({
        kind: "table",
        head: ["Method", "Low", "High", "Formula"],
        rows: d.market.ranges.map((r) => [`${label(r.method)}${d.market.primary?.method === r.method ? " (primary)" : ""}`, usd(r.lowUsd), usd(r.highUsd), r.formula]),
        align: ["left", "right", "right", "left"],
        widths: ["150px", "80px", "80px", null],
        caption: "Market reconstructed by code from analysed assumptions; the deck TAM is never accepted as the market size.",
      });
    const flags: string[] = [];
    if (d.market.deckTamUsd) flags.push(`Deck TAM ${usd(d.market.deckTamUsd)}${d.market.deckInflation ? ` = ${d.market.deckInflation.toFixed(1)}× the reconstructed upper bound` : ""}.`);
    if (d.market.methodDivergence && d.market.methodDivergence > 10) flags.push(`Methods diverge materially (${d.market.methodDivergence > 1000 ? "over 1,000" : d.market.methodDivergence.toFixed(0)}× spread between the lowest and highest bound).`);
    if (flags.length) b.push({ kind: "p", text: flags.join(" ") });
    if (c.market) {
      b.push({ kind: "kv", rows: [{ k: "Deck TAM assessment", v: c.market.deckTamAssessment }, { k: "Value capture", v: c.market.valueCaptureAnalysis.conclusion }, { k: "Pricing power", v: c.market.valueCaptureAnalysis.pricingPower }, { k: "Commoditization", v: c.market.valueCaptureAnalysis.commoditizationRisk }] });
      if (c.market.expansion.length) b.push({ kind: "kv", rows: [{ k: "Expansion paths", v: c.market.expansion.map((e) => e.market).join("; ") }] });
    }
    S.push(b.length ? { id: "market", title: "Market", blocks: b } : { id: "market", title: "Market", blocks: [MISSING], missing: true });
  }

  /* 9. Why now */
  {
    const rub = c.rubric.filter((r) => r.criterion === "TIMING_CATALYST" || r.criterion === "INFLECTION_EVIDENCE");
    const b: MemoBlock[] = [];
    if (c.market?.whyNow) b.push({ kind: "p", text: c.market.whyNow });
    if (rub.length) b.push({ kind: "table", head: ["Criterion", "Rating", "Rationale"], rows: rub.map((r) => [label(r.criterion), label(r.rating), r.rationale]), widths: ["150px", "110px", null] });
    S.push(b.length ? { id: "why-now", title: "Why now", blocks: b } : { id: "why-now", title: "Why now", blocks: [MISSING], missing: true });
  }

  /* 10. PMF */
  S.push(
    c.pmf
      ? {
          id: "pmf",
          title: "Product–market fit",
          blocks: [
            { kind: "p", text: c.pmf.assessment },
            { kind: "table", head: ["Signal", "Direction", "Evidence"], rows: c.pmf.signals.filter((s) => s.direction !== "UNKNOWN").map((s) => [label(s.signal), label(s.direction), s.evidence]), widths: ["150px", "100px", null] },
            ...(c.pmf.signals.some((s) => s.direction === "UNKNOWN")
              ? [{ kind: "kv", rows: [{ k: "No evidence yet", v: c.pmf.signals.filter((s) => s.direction === "UNKNOWN").map((s) => label(s.signal)).join(", ") }] } as MemoBlock]
              : []),
            { kind: "kv", rows: [{ k: "Cohorts older than 12 months", v: c.pmf.olderCohortEvidence ?? "No evidence from customers older than 12 months." }] },
          ],
        }
      : { id: "pmf", title: "Product–market fit", blocks: [MISSING], missing: true },
  );

  /* 11. Traction */
  {
    const ms = TRACTION_KEYS.map((k) => primary.find((m) => m.metricKey === k)).filter((m): m is MetricInstance => !!m);
    const b: MemoBlock[] = ms.length
      ? [{ kind: "table", head: ["Metric", "Value", "As of", "Sample", "Evidence"], rows: metricRows(ms), align: ["left", "right", "right", "right", "left"], widths: [null, "90px", "90px", "70px", "130px"] }]
      : [{ kind: "p", text: "No traction metrics were disclosed." }];
    if (d.smallSampleWarnings.length) b.push({ kind: "note", tone: "warn", title: "Small-sample caution", text: d.smallSampleWarnings.map((w) => `${w.label}: ${w.detail.replace(/_/g, " ").toLowerCase()}`).join("; ") });
    S.push({ id: "traction", title: "Traction", blocks: b });
  }

  /* 12. GTM */
  S.push(
    c.gtm
      ? {
          id: "gtm",
          title: "Go-to-market",
          blocks: [
            { kind: "p", text: c.gtm.assessment },
            {
              kind: "kv",
              rows: [
                { k: "User · buyer", v: `${c.gtm.user} · ${c.gtm.buyer}` },
                { k: "Economic buyer", v: c.gtm.economicBuyer },
                { k: "ICP", v: c.gtm.icp },
                { k: "Sales motion", v: c.gtm.salesMotion },
                { k: "Channels", v: c.gtm.channels.join("; ") || "—" },
                { k: "Sales cycle", v: c.gtm.salesCycle ?? NOT_DISCLOSED },
                { k: "Founder-led sales", v: c.gtm.founderLedAssessment },
              ],
            },
          ],
        }
      : { id: "gtm", title: "Go-to-market", blocks: [MISSING], missing: true },
  );

  /* 13. Economics */
  {
    const ms = ECON_KEYS.map((k) => primary.find((m) => m.metricKey === k)).filter((m): m is MetricInstance => !!m);
    const b: MemoBlock[] = [];
    if (c.businessModel) b.push({ kind: "kv", rows: [{ k: "How it makes money", v: c.businessModel.howItMakesMoney }, { k: "Pricing", v: c.businessModel.pricing ?? NOT_DISCLOSED }] });
    if (c.economicsNotes) b.push({ kind: "p", text: c.economicsNotes });
    if (ms.length) b.push({ kind: "table", head: ["Metric", "Value", "As of", "Sample", "Evidence"], rows: metricRows(ms), align: ["left", "right", "right", "right", "left"], widths: [null, "90px", "90px", "70px", "130px"] });
    S.push(b.length ? { id: "economics", title: "Economics", blocks: b } : { id: "economics", title: "Economics", blocks: [MISSING], missing: true });
  }

  /* 14. Competition */
  S.push(
    c.competition
      ? {
          id: "competition",
          title: "Competition",
          blocks: [
            { kind: "table", head: ["Competitor", "Type", "Description", "Scale"], rows: c.competition.competitors.map((x) => [x.name, label(x.type), clip(x.description, 150), x.scale ? clip(x.scale, 110) : "—"]), widths: ["130px", "100px", null, "24%"] },
            ...(c.competition.adversarialTests.length
              ? [
                  { kind: "h3", text: "Adversarial tests" } as MemoBlock,
                  { kind: "table", head: ["Test", "Outcome", "Verdict"], rows: c.competition.adversarialTests.map((t) => [label(t.test), clip(t.outcome, 230), label(t.verdict)]), widths: ["150px", null, "100px"] } as MemoBlock,
                ]
              : []),
          ],
        }
      : { id: "competition", title: "Competition", blocks: [MISSING], missing: true },
  );

  /* 15. Moat */
  S.push(
    c.moat.length
      ? {
          id: "moat",
          title: "Moat",
          blocks: [
            {
              kind: "table",
              head: ["Dimension", "Today", "In 3 years", "What must happen"],
              rows: c.moat.filter((m) => m.current !== "NONE" || m.in3Years !== "NONE").map((m) => [label(m.dimension), label(m.current), label(m.in3Years), m.whatMustHappen]),
              widths: ["150px", "90px", "90px", null],
            },
            ...(c.moat.some((m) => m.current === "NONE" && m.in3Years === "NONE")
              ? [{ kind: "kv", rows: [{ k: "No moat expected", v: c.moat.filter((m) => m.current === "NONE" && m.in3Years === "NONE").map((m) => label(m.dimension)).join(", ") }] } as MemoBlock]
              : []),
          ],
        }
      : { id: "moat", title: "Moat", blocks: [MISSING], missing: true },
  );

  /* 16. Financing path */
  {
    const f = d.financing;
    const b: MemoBlock[] = [{ kind: "p", text: f.explanation }];
    b.push({
      kind: "kv",
      rows: [
        { k: "Cash · round · burn", v: `${usd(f.cashUsd, 2)} cash + ${usd(f.raiseUsd, 2)} round at ${usd(f.monthlyBurnUsd)}/month (${f.burnSource.toLowerCase()} burn)` },
        { k: "Runway after round", v: f.runwayAfterRoundMonths !== null ? `${f.runwayAfterRoundMonths.toFixed(1)} months` : "—" },
        { k: "Months required", v: f.requiredMonths !== null ? `${f.requiredMonths} (milestone ${f.milestoneMonths} + fundraising lead)` : "—" },
        { k: "Financing risk", v: label(f.risk) },
      ],
    });
    if (f.requiredMonths !== null && f.runwayAfterRoundMonths !== null)
      b.push({
        kind: "table",
        head: ["Milestone slips", "Cash out before raise", "Shortfall", "Bridge needed"],
        rows: f.delays.map((x) => [`${x.delayMonths} months`, x.cashOutBeforeRaise ? "Yes" : "No", x.shortfallMonths > 0 ? `${x.shortfallMonths.toFixed(1)} months` : "—", x.bridgeNeededUsd > 0 ? usd(x.bridgeNeededUsd) : "—"]),
        align: ["left", "left", "right", "right"],
      });
    if (c.financingPath)
      b.push({
        kind: "kv",
        rows: [
          { k: "Proof purchased", v: c.financingPath.proofPurchased },
          { k: "Next-round conditions", v: c.financingPath.nextRoundConditions },
          { k: "Fallback plans", v: c.financingPath.fallbackPlans },
          { k: "Capital intensity", v: label(c.financingPath.capitalIntensity) },
          { k: "Could it die while right?", v: c.financingPath.financingRiskAssessment },
        ],
      });
    S.push({ id: "financing", title: "Financing path", blocks: b });
  }

  /* 17. Round */
  {
    const fin = c.financing;
    const t = fin?.terms;
    const money = (m: { amount: number | null; rawText: string; currency: string } | null | undefined) => (m?.amount ? `${m.currency === "USD" ? usd(m.amount, 2) : `${m.currency} ${m.amount.toLocaleString("en-US")}`} (“${m.rawText}”)` : NOT_DISCLOSED);
    S.push(
      fin
        ? {
            id: "round",
            title: "The round",
            blocks: [
              {
                kind: "kv",
                rows: (() => {
                  const rows: { k: string; v: string | null }[] = [
                    { k: "Instrument", v: label(fin.instrument) },
                    { k: "Raise", v: fin.raiseAmount?.amount ? money(fin.raiseAmount) : null },
                    { k: isSafe ? "Valuation cap" : "Pre-money", v: (isSafe ? fin.valuationCap : fin.preMoney)?.amount ? money(isSafe ? fin.valuationCap : fin.preMoney) : null },
                    { k: "Entry valuation used", v: entry.postMoneyUsd ? `${usd(entry.postMoneyUsd)} ${isSafe ? "cap" : "post-money"} (${entry.source.toLowerCase()})` : null },
                    { k: "Discount", v: fin.discountPct !== null ? `${fin.discountPct}%` : null },
                    { k: "Lead investor", v: fin.leadInvestor },
                    { k: "Existing investors", v: fin.existingInvestors.join(", ") || null },
                    { k: "Use of funds", v: fin.useOfFunds.join("; ") || null },
                    { k: "Liquidation preference", v: t?.liquidationPreferenceMultiple != null ? `${t.liquidationPreferenceMultiple}× ${t.participating ? "participating" : t.participating === false ? "non-participating" : ""}`.trim() : null },
                    { k: "Anti-dilution", v: t?.antiDilution ?? null },
                    { k: "Board", v: t?.boardRights ?? null },
                    { k: "Information rights", v: t?.informationRights ?? null },
                    { k: "Pro rata", v: t?.proRata ?? null },
                    { k: "Protective provisions", v: t?.protectiveProvisions ?? null },
                  ];
                  const known = rows.filter((r): r is { k: string; v: string } => r.v !== null);
                  const missing = rows.filter((r) => r.v === null).map((r) => r.k.toLowerCase());
                  return missing.length ? [...known, { k: NOT_DISCLOSED, v: `${missing.join(", ")}. Undisclosed preference terms are modelled as 1× non-participating.` }] : known;
                })(),
              },
            ],
          }
        : { id: "round", title: "The round", blocks: [MISSING], missing: true },
    );
  }

  /* 18. Return analysis */
  {
    const r = d.returns;
    const b: MemoBlock[] = [];
    if (r.modelable) {
      b.push({
        kind: "table",
        head: ["Scenario", "Exit equity", "Invested", "Exit own.", "Proceeds", "MOIC", "IRR", "% of fund"],
        rows: r.scenarios.map((s) => [
          `${SCEN[s.scenario]} (${s.years}y)`,
          usd(s.exitEquityUsd),
          usd(s.investedUsd, 2),
          pct(s.exitOwnershipPct, 2),
          `${usd(s.proceedsUsd, 2)}${s.preferenceBinding ? " †" : ""}`,
          multiple(s.grossMoic),
          irr(s.grossIrr),
          s.fundContributionPctOfFund !== null ? pct(s.fundContributionPctOfFund, 1) : "—",
        ]),
        align: ["left", "right", "right", "right", "right", "right", "right", "right"],
        caption: `Gross, before fees and carry; not probability-weighted. Check ${usd(r.inputs.checkUsd, 2)} at ${usd(entry.postMoneyUsd)} ${isSafe ? "cap" : "post"}${r.inputs.followOn ? `, pro-rata follow-on from ${usd(r.inputs.reserveUsd, 2)} reserves` : ""}. † liquidation preference binding.`,
      });
      b.push({ kind: "h3", text: "Exit basis" });
      b.push({ kind: "bullets", items: r.scenarios.map((s) => `${SCEN[s.scenario]}: ${clip(s.basis, 170)}`) });
    } else b.push({ kind: "note", tone: "warn", text: r.warnings.join(" ") || "Returns could not be modelled." });
    if (d.backwards) {
      b.push({ kind: "h3", text: "Backwards return analysis" });
      b.push({ kind: "p", text: `${d.backwards.explanation} Plausibility: ${label(d.backwards.plausibility).toLowerCase()}.` });
      b.push({
        kind: "table",
        head: ["Revenue multiple", "Required revenue", "Required customers", "Share of SAM"],
        rows: d.backwards.byMultiple.map((x) => [`${x.revenueMultiple}×`, usd(x.requiredRevenueUsd, 0), x.requiredCustomers !== null ? x.requiredCustomers.toLocaleString("en-US") : "—", x.samSharePct !== null ? pct(x.samSharePct, 1) : "—"]),
        align: ["left", "right", "right", "right"],
        caption: `Revenue per customer ${d.backwards.arpaUsd !== null ? usd(d.backwards.arpaUsd) : "unavailable"} (${d.backwards.arpaSource}); SAM upper bound ${d.backwards.samHighUsd !== null ? usd(d.backwards.samHighUsd) : "unavailable"}.`,
      });
    }
    if (d.priceSensitivity.length) {
      b.push({ kind: "h3", text: "Price sensitivity" });
      const targets = d.priceSensitivity[0]!.maxPostMoneyByTarget.map((m) => m.targetMoic);
      b.push({
        kind: "table",
        head: ["Scenario", ...targets.map((t) => `Max entry for ${t}×`), "Implied at current"],
        rows: d.priceSensitivity.map((row) => [SCEN[row.scenario]!, ...row.maxPostMoneyByTarget.map((m) => usd(m.maxPostMoneyUsd)), multiple(row.currentImpliedMoic)]),
        align: ["left", ...targets.map(() => "right" as const), "right"],
        caption: "Initial check only, preferences ignored: max post = (1 − cumulative dilution) × exit ÷ target multiple.",
      });
    }
    b.push({ kind: "h3", text: "Assumptions" });
    b.push({ kind: "bullets", items: r.assumptions });
    if (r.warnings.length && r.modelable) b.push({ kind: "note", tone: "warn", title: "Model warnings", text: r.warnings.join(" ") });
    S.push({ id: "returns", title: "Return analysis", blocks: b });
  }

  /* 19. Case against investing */
  {
    const b: MemoBlock[] = [];
    if (c.redTeam?.caseAgainstInvesting.length) b.push({ kind: "bullets", items: c.redTeam.caseAgainstInvesting, tone: "risk" });
    if (c.thesis) b.push({ kind: "kv", rows: [{ k: "Fatal weakness", v: c.thesis.fatalWeakness }, { k: "Fatal question", v: c.thesis.fatalQuestion }] });
    if (c.whatWorriesMe.length) b.push({ kind: "h3", text: "What worries me" }, { kind: "bullets", items: c.whatWorriesMe, tone: "warn" });
    S.push(b.length ? { id: "against-investing", title: "Case against investing", blocks: b } : { id: "against-investing", title: "Case against investing", blocks: [MISSING], missing: true });
  }

  /* 20. Case against passing */
  {
    const b: MemoBlock[] = [];
    if (c.redTeam?.caseAgainstPassing.length) b.push({ kind: "bullets", items: c.redTeam.caseAgainstPassing, tone: "ok" });
    if (c.redTeam?.passRegretScenario) b.push({ kind: "note", tone: "neutral", title: "Pass-regret scenario", text: c.redTeam.passRegretScenario });
    if (c.nonlinear)
      b.push({
        kind: "kv",
        rows: [
          { k: "Why it could be disproportionate", v: c.nonlinear.whyDisproportionate },
          { k: "Mechanism", v: c.nonlinear.mechanism },
          { k: "Why it may be underestimated", v: c.nonlinear.whyUnderestimated },
          { k: "Outlier path", v: `${c.nonlinear.outlierPlausible ? "Plausible" : "Not plausible on current evidence"} — ${c.nonlinear.outlierRationale}` },
        ],
      });
    if (c.whatILike.length) b.push({ kind: "h3", text: "What I like" }, { kind: "bullets", items: c.whatILike, tone: "ok" });
    S.push(b.length ? { id: "against-passing", title: "Case against passing", blocks: b } : { id: "against-passing", title: "Case against passing", blocks: [MISSING], missing: true });
  }

  /* 21. Risks */
  {
    const b: MemoBlock[] = [];
    const k = d.risk.thesisKillers;
    if (k.length) b.push({ kind: "note", tone: "risk", title: `Thesis-killing risk${k.length > 1 ? "s" : ""}`, text: k.map((r) => `${r.id} ${r.title} — ${r.description}`).join(" ") });
    if (c.risks.length)
      b.push({
        kind: "table",
        head: ["ID", "Risk", "Category", "Severity · likelihood", "Class"],
        rows: c.risks.map((r) => [r.id, r.title, label(r.category), `${label(r.severity)} · ${label(r.likelihood)}`, label(r.weaknessClass)]),
        widths: ["60px", null, "110px", "140px", "110px"],
        caption: "Mitigations, evidence and repair plans: Risks tab.",
      });
    else b.push({ kind: "p", text: "No risks were recorded in this version." });
    const fals = c.falsification.flatMap((f) => f.falsifiers);
    if (fals.length) {
      const count = (s: string) => fals.filter((x) => x.status === s).length;
      b.push({
        kind: "p",
        text: `Falsification: ${fals.length} falsifiers across ${c.falsification.length} thesis points — ${count("FOUND")} found, ${count("PARTIAL_SIGNAL")} partial signal, ${count("SEARCHED_NOT_FOUND")} searched and not found, ${count("NOT_TESTED")} not yet tested.`,
      });
    }
    S.push({ id: "risks", title: "Risks", blocks: b });
  }

  /* 22. Open questions */
  {
    const open = c.questions.filter((q) => q.status !== "RESOLVED");
    const b: MemoBlock[] = [];
    if (open.length) b.push({ kind: "table", head: ["ID", "Tier", "Question", "Affects"], rows: open.map((q) => [q.id, label(q.tier), clip(q.question, 200), q.affects.map(label).join(", ")]), widths: ["50px", "80px", null, "130px"] });
    const gaps = d.researchPriority.slice(0, 4);
    if (gaps.length)
      b.push({
        kind: "p",
        text: `Research priority (index = importance × uncertainty × researchability; a ranking aid, not a probability): ${gaps.map((g) => `${g.gapId} (${g.index}, ${label(g.channel).toLowerCase()})`).join(", ")}.`,
      });
    S.push(b.length ? { id: "questions", title: "Open questions", blocks: b } : { id: "questions", title: "Open questions", blocks: [{ kind: "p", text: "No open questions." }] });
  }

  /* 23. Recommendation */
  {
    const b: MemoBlock[] = [{ kind: "decision", status: rec.status, label: DECISION_LABEL[rec.status] ?? label(rec.status), detail: rationale }];
    if (rec.watch) b.push({ kind: "kv", rows: [{ k: "Watch trigger", v: rec.watch.trigger }, { k: "Expected", v: rec.watch.expectedDate ?? "—" }, { k: "Information awaited", v: rec.watch.informationAwaited }] });
    if (c.nextBestAction) b.push({ kind: "kv", rows: [{ k: "Next best action", v: c.nextBestAction.action }, { k: "Why", v: c.nextBestAction.rationale }] });
    b.push({ kind: "table", head: ["Gate", "Outcome", "Detail"], rows: rec.trace.map((t) => [t.gate, t.outcome, t.detail]), widths: ["130px", "80px", null], caption: `Admissible statuses: ${humanList(rec.admissible.map((s) => DECISION_LABEL[s] ?? s))}.${rec.aiSuggested && !rec.aiAccepted ? ` The analysis suggested “${DECISION_LABEL[rec.aiSuggested] ?? rec.aiSuggested}”, which the gates did not admit.` : ""}` });
    b.push({ kind: "p", text: `IC decision: ${label(c.icDecision).toLowerCase()}. Execution: ${label(c.executionStatus).toLowerCase()}. This memo is an analytical recommendation and does not record an investment decision.` });
    S.push({ id: "recommendation", title: "Recommendation", blocks: b });
  }

  const cl = c.classification;
  return {
    company: c.identity.name,
    subtitle: [STAGE_LABEL[cl.financingStage], cl.industry.map(label).join(", "), c.identity.hqCountry, entry.raiseUsd ? `raising ${usd(entry.raiseUsd)}` : null, entry.postMoneyUsd ? `${usd(entry.postMoneyUsd)} ${isSafe ? "cap" : "post"}` : null]
      .filter(Boolean)
      .join(" · "),
    sections: S,
  };
}
