/** Compact, deterministic serializations of the canonical object for model passes. */
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { metricDef } from "@/engine/metrics/dictionary";

const fmtUsd = (n: number | null | undefined) =>
  n === null || n === undefined ? null : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}k` : `$${n.toFixed(0)}`;

export function metricsTable(c: CanonicalDeal) {
  return c.metrics
    .filter((m) => m.isPrimary)
    .map((m) => ({
      id: m.id,
      metric: metricDef(m.metricKey)?.shortName ?? m.metricKey,
      key: m.metricKey,
      value: m.normalizedValue,
      unit: m.unit,
      raw: m.rawValue,
      period: m.periodEnd,
      state: m.state,
      verification: m.verification,
      method: m.calculationMethod,
      sampleSize: m.sampleSize,
      flags: m.qualityFlags,
    }));
}

export function claimsDigest(c: CanonicalDeal, limit = 140) {
  return c.claims.slice(0, limit).map((cl) => ({
    id: cl.id,
    category: cl.category,
    statement: cl.statement,
    material: cl.material,
    origin: cl.origin,
    verification: cl.verification,
    sources: cl.evidence.map((e) => `${e.sourceId}:${e.effect}${e.location ? `@${e.location}` : ""}`),
    contradictions: cl.contradictions,
  }));
}

export function canonicalForAnalysis(c: CanonicalDeal) {
  return {
    identity: c.identity,
    classification: c.classification,
    product: c.product,
    businessModel: c.businessModel,
    customers: c.customers,
    foundersFromDeck: c.foundersFromDeck,
    metrics: metricsTable(c),
    financing: c.financing,
    deckMarket: c.deckMarket,
    claims: claimsDigest(c),
    sources: c.sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, url: s.url, origin: s.origin, citationVerified: s.citationVerified })),
    openInformationGaps: c.informationGaps.filter((g) => g.status !== "RESOLVED").map((g) => ({ id: g.id, question: g.question, status: g.status, note: g.resolutionNote })),
  };
}

export function derivedDigest(d: DerivedAnalysis) {
  return {
    peerGroup: d.peerGroup.name,
    operatingQuality: { value: d.operatingQuality.value, lower: d.operatingQuality.lower, upper: d.operatingQuality.upper, coverage: d.operatingQuality.coverage, status: d.operatingQuality.status, note: "Conventional index, not a probability" },
    dimensions: d.dimensions.map((x) => ({ id: x.id, value: x.value, coverage: x.coverage, status: x.status })),
    evidence: { category: d.evidence.category, index: d.evidence.index, materialClaims: d.evidence.materialClaims, verified: d.evidence.verifiedMaterial, contradicted: d.evidence.contradictedMaterial, companyOnly: d.evidence.companyOnlyMaterial },
    market: {
      primary: d.market.primary ? { method: d.market.primary.method, low: fmtUsd(d.market.primary.lowUsd), high: fmtUsd(d.market.primary.highUsd), formula: d.market.primary.formula } : null,
      deckTam: fmtUsd(d.market.deckTamUsd),
      deckInflation: d.market.deckInflation,
    },
    returns: d.returns.modelable
      ? d.returns.scenarios.map((s) => ({ scenario: s.scenario, exitEquity: fmtUsd(s.exitEquityUsd), exitOwnershipPct: +s.exitOwnershipPct.toFixed(2), grossMoic: s.grossMoic && +s.grossMoic.toFixed(2), grossIrr: s.grossIrr && +(s.grossIrr * 100).toFixed(1), basis: s.basis }))
      : { unavailable: d.returns.warnings },
    backwards: d.backwards && { explanation: d.backwards.explanation, plausibility: d.backwards.plausibility },
    financing: { risk: d.financing.risk, explanation: d.financing.explanation },
    fundFit: { mandate: d.fundFit.mandate, failedGates: d.fundFit.gates.filter((g) => g.result !== "PASS").map((g) => `${g.label}: ${g.result} (${g.detail})`), index: d.fundFit.index },
    risk: { headline: d.risk.headline, thesisKillers: d.risk.thesisKillers.map((r) => r.title) },
    smallSampleWarnings: d.smallSampleWarnings.map((w) => `${w.label}: ${w.detail}`),
    // Ten ordinal divergence factors (never a score, never part of the OQI). Absent on versions derived before the engine existed.
    divergence: d.divergence
      ? { headline: d.divergence.summary.headline, factors: d.divergence.summary.factors.map((f) => `${f.n}. ${f.name}: ${f.level} (${f.reading}) — ${f.why}${f.numbers.length ? ` [${f.numbers.join("; ")}]` : ""}`) }
      : null,
    // Code-ranked decision focus (Decision Leverage Index — attention, not a probability). Absent on older versions.
    decisionFocus: d.focus
      ? {
          headline: d.focus.headline,
          determinants: d.focus.determinants.map((x) => `${x.label} — leverage ${x.leverage} (${x.status}; ${x.why.slice(0, 2).join("; ")})${x.refs.length ? ` [${x.refs.slice(0, 4).join(", ")}]` : ""}`),
          outlierCandidates: d.focus.outlierCandidates.map((o) => `${o.label} — ${o.basis} (${o.status})`),
          reversingQuestion: d.focus.reversingQuestion?.question ?? null,
        }
      : null,
  };
}

export { fmtUsd };
