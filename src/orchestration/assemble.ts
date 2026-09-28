/**
 * Deterministic assembly of model outputs into the canonical object.
 * Code — not the model — decides ids, verification status, independence
 * and freshness.
 */
import type { CanonicalDeal, Claim, InformationGap, Source } from "@/domain/canonical";
import type { TriageOutput } from "@/ai/prompts/triage";
import type { ClaimsExtractionOutput, MetricsExtractionOutput } from "@/ai/prompts/extract";
import type { DeckForensics, DivergenceDraft, LatentSignalsDraft } from "@/domain/sections";
import type { ThesisOutput, ActionsOutput } from "@/ai/prompts/decision";
import type { ResearchOutput } from "@/ai/prompts/research";
import type { InvestmentAnalysisOutput } from "@/ai/prompts/investment-analysis";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import { normalizeObservation, parsePeriodDate } from "@/engine/metrics/normalize";
import { deriveMetrics } from "@/engine/metrics/derive";
import { seqIdFactory, nowIso, normName } from "@/server/ids";
import { detectInjection } from "@/ai/untrusted";
import type { Level, RubricRating } from "@/domain/enums";
import { formatTimestamp, type TranscriptSegment } from "@/domain/meetings";
import { resolveRefs } from "@/ingestion/transcript";

export interface IngestedDoc {
  documentId: string;
  filename: string;
  kind: string;
  pages: { pageNo: number; text: string }[];
}

function freshnessFor(dateStr: string | null | undefined, asOf: Date): Claim["freshness"] {
  const d = parsePeriodDate(dateStr);
  if (!d) return "CURRENT";
  const months = (asOf.getTime() - d.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  return months > 18 ? "STALE" : months > 9 ? "AGING" : "CURRENT";
}

/* ---------------------------------------------------------------- */
/* v3 passes: triage, claims, metrics, forensics, latent               */
/* ---------------------------------------------------------------- */

/** Documents become company-origin sources; the primary deck is SRC-001. */
export function applyDocuments(c: CanonicalDeal, docs: IngestedDoc[], asOf = new Date()): CanonicalDeal {
  const next = structuredClone(c);
  const srcId = seqIdFactory("SRC", next.sources.map((x) => x.id));
  next.documents = docs.map((d) => ({ id: d.documentId, filename: d.filename, kind: d.kind, pages: d.pages.length }));
  for (const d of docs) {
    if (next.sources.some((s) => s.documentId === d.documentId)) continue;
    next.sources.push({
      id: srcId(),
      kind: "DOCUMENT",
      title: d.filename,
      url: null,
      documentId: d.documentId,
      publisher: null,
      publishedDate: null,
      retrievedAt: asOf.toISOString(),
      origin: "COMPANY",
      independenceGroup: "COMPANY",
      citationVerified: true,
    });
  }
  // Deterministic injection detector over every raw page.
  const flags = docs.flatMap((d) => d.pages.flatMap((p) => detectInjection(p.text, `${d.filename} p. ${p.pageNo}`)));
  next.analysis.securityFlags = dedupeFlags([...next.analysis.securityFlags, ...flags]);
  return next;
}

function primaryDocSource(c: CanonicalDeal): string | null {
  return c.sources.find((s) => s.kind === "DOCUMENT")?.id ?? null;
}

export function applyTriage(c: CanonicalDeal, out: TriageOutput): CanonicalDeal {
  const next = structuredClone(c);
  const gapId = seqIdFactory("GAP", next.informationGaps.map((x) => x.id), 2);
  next.identity = out.identity;
  next.classification = out.classification;
  next.foundersFromDeck = out.founders;
  next.informationGaps = out.informationGaps.map((g) => ({ ...g, id: gapId(), status: g.researchability === "FOUNDER_ONLY" ? "NEEDS_FOUNDER" : "OPEN", resolutionNote: null }));
  const doc = next.sources.find((s) => s.kind === "DOCUMENT");
  if (doc && !doc.publisher) doc.publisher = out.identity.name;
  return next;
}

export function applyClaimsExtraction(c: CanonicalDeal, out: ClaimsExtractionOutput, asOf = new Date()): CanonicalDeal {
  const next = structuredClone(c);
  const clmId = seqIdFactory("CLM", next.claims.map((x) => x.id));
  const src = primaryDocSource(next);
  for (const cl of out.claims) {
    next.claims.push({
      id: clmId(),
      category: cl.category,
      statement: cl.statement,
      valueText: cl.valueText,
      entity: cl.entity,
      period: cl.period,
      material: cl.material,
      unusualness: Math.min(5, Math.max(1, cl.unusualness)),
      proposition: cl.proposition,
      evidenceNeeded: cl.evidenceNeeded,
      origin: "COMPANY",
      verification: "UNVERIFIED",
      freshness: freshnessFor(cl.period, asOf),
      independence: "COMPANY_DERIVED",
      verificationMethod: "Stated in company materials",
      limitations: null,
      contradictions: [],
      evidence: src ? [{ sourceId: src, effect: "ORIGIN", excerpt: cl.excerpt, location: cl.page ? `p. ${cl.page}` : null, note: null }] : [],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Extracted from deck" }],
    });
  }
  next.product = out.product;
  next.businessModel = out.businessModel;
  next.customers = out.customers;
  const flags = out.suspectedInstructions.map((s) => ({ location: s.page ? `p. ${s.page}` : "document", excerpt: s.excerpt }));
  next.analysis.securityFlags = dedupeFlags([...next.analysis.securityFlags, ...flags]);
  return next;
}

export function applyMetricsExtraction(c: CanonicalDeal, out: MetricsExtractionOutput, asOf = new Date()): CanonicalDeal {
  const next = structuredClone(c);
  const metId = seqIdFactory("MET", next.metrics.map((x) => x.id));
  const src = primaryDocSource(next);
  next.metricObservations = out.metrics;
  next.financing = out.financing;
  next.deckMarket = out.deckMarket;
  const findClaimByExcerpt = (excerpt: string) => {
    const e = excerpt.trim().slice(0, 40).toLowerCase();
    if (!e) return null;
    return next.claims.find((x) => x.evidence.some((ev) => ev.excerpt.toLowerCase().includes(e)))?.id ?? null;
  };
  const instances = out.metrics
    .map((o) => normalizeObservation(o, { asOf, nextId: metId, sourceIdForPage: () => src, claimIdForExcerpt: findClaimByExcerpt }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  // Analyst corrections are overrides (canonical.overrides), re-anchored after extraction — never metric copies.
  next.metrics = deriveMetrics(instances, metId);
  return next;
}

export function applyForensics(c: CanonicalDeal, out: DeckForensics): CanonicalDeal {
  const next = structuredClone(c);
  next.forensics = out;
  const flags = out.suspectedInstructions.map((s) => ({ location: s.page ? `p. ${s.page}` : "document (visual)", excerpt: s.excerpt }));
  next.analysis.securityFlags = dedupeFlags([...next.analysis.securityFlags, ...flags]);
  // The model's customer evidence levels from visuals do not upgrade extraction; logos stay logos.
  return next;
}

export function applyLatent(c: CanonicalDeal, out: LatentSignalsDraft): CanonicalDeal {
  const next = structuredClone(c);
  next.latentSignals = out;
  return next;
}

/**
 * Divergence signals (deck-only). Code sanitizes what the model reported —
 * percentages outside 0–100 and negative counts become null — and never
 * derives a level here: engine/divergence computes every factor.
 */
export function applyDivergence(c: CanonicalDeal, out: DivergenceDraft): CanonicalDeal {
  const next = structuredClone(c);
  const d = structuredClone(out);
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) || v < 0 || v > 100 ? null : v);
  const pos = (v: number | null) => (v === null || !Number.isFinite(v) || v < 0 ? null : v);
  d.capTable.founderOwnershipPct = pct(d.capTable.founderOwnershipPct);
  d.capTable.optionPoolPct = pct(d.capTable.optionPoolPct);
  d.capTable.optionPoolAvailablePct = pct(d.capTable.optionPoolAvailablePct);
  d.capTable.founders = d.capTable.founders.filter((f) => f.name.trim()).map((f) => ({ ...f, ownershipPct: pct(f.ownershipPct) }));
  d.capTable.convertibles = d.capTable.convertibles.map((x) => ({ ...x, discountPct: pct(x.discountPct) }));
  d.marketStructure.topBuyersSharePct = pct(d.marketStructure.topBuyersSharePct);
  d.marketStructure.largestCompetitorSharePct = pct(d.marketStructure.largestCompetitorSharePct);
  d.marketStructure.addressableBuyerCount = pos(d.marketStructure.addressableBuyerCount);
  d.marketStructure.topBuyersCount = pos(d.marketStructure.topBuyersCount);
  d.dependencies = d.dependencies.map((x) => ({ ...x, switchingTimeMonths: pos(x.switchingTimeMonths) }));
  d.scalability.implementationWeeks = pos(d.scalability.implementationWeeks);
  d.scalability.headcountByFunction = d.scalability.headcountByFunction.filter((h) => Number.isFinite(h.count) && h.count > 0);
  d.syndicate = d.syndicate.filter((s) => s.name.trim());
  d.ambition.signals = d.ambition.signals.slice(0, 8);
  next.divergence = d;
  return next;
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9$%. ]/g, " ").split(/\s+/).filter((w) => w.length > 2));
export function jaccard(a: string, b: string) {
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Map triage key-claim refs (k1…) to extracted claim ids by statement similarity. */
export function linkKeyClaims(keyClaims: { ref: string; statement: string }[], claims: Claim[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const k of keyClaims) {
    let best: { id: string; score: number } | null = null;
    for (const cl of claims) {
      const score = jaccard(k.statement, cl.statement);
      if (!best || score > best.score) best = { id: cl.id, score };
    }
    if (best && best.score >= 0.25) map.set(k.ref, best.id);
  }
  return map;
}

function dedupeFlags(flags: { location: string; excerpt: string }[]) {
  const seen = new Set<string>();
  return flags.filter((f) => {
    const k = f.excerpt.slice(0, 60);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------------------------------------------------------------- */
/* Research                                                           */
/* ---------------------------------------------------------------- */

function domainOf(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    const parts = h.split(".");
    return parts.slice(-2).join(".");
  } catch {
    return url;
  }
}

function urlKey(url: string) {
  try {
    const u = new URL(url);
    return (u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export interface ResearchContext {
  /** URLs actually returned by the search tool in this call. */
  searchSources: { url: string; title?: string }[];
  companyWebsite: string | null;
}

export function applyResearch(c: CanonicalDeal, out: ResearchOutput, ctx: ResearchContext, asOf = new Date()): CanonicalDeal {
  return applyResearchDetailed(c, out, ctx, asOf).deal;
}

/** applyResearch, also returning finding ref → claim id (the confirmed claim, or the claim created). */
export function applyResearchDetailed(c: CanonicalDeal, out: ResearchOutput, ctx: ResearchContext, asOf = new Date()): { deal: CanonicalDeal; refMap: Map<string, string> } {
  const next = structuredClone(c);
  const srcId = seqIdFactory("SRC", next.sources.map((x) => x.id));
  const clmId = seqIdFactory("CLM", next.claims.map((x) => x.id));
  const retrieved = new Set(ctx.searchSources.map((s) => urlKey(s.url)));
  const companyDomain = ctx.companyWebsite ? domainOf(ctx.companyWebsite.startsWith("http") ? ctx.companyWebsite : `https://${ctx.companyWebsite}`) : null;

  const sourceFor = (url: string, title: string, publisher: string | null, published: string | null, origin: Source["origin"], derivedFromCompany: boolean): Source => {
    const existing = next.sources.find((s) => s.url && urlKey(s.url) === urlKey(url));
    if (existing) return existing;
    const isCompanyDomain = companyDomain !== null && domainOf(url) === companyDomain;
    const src: Source = {
      id: srcId(),
      kind: "WEB",
      title,
      url,
      documentId: null,
      publisher,
      publishedDate: published,
      retrievedAt: asOf.toISOString(),
      origin: isCompanyDomain ? "COMPANY" : origin,
      // Company-derived content (press releases, interviews) shares one origin group.
      independenceGroup: isCompanyDomain || derivedFromCompany ? "COMPANY" : domainOf(url),
      citationVerified: retrieved.has(urlKey(url)),
    };
    next.sources.push(src);
    return src;
  };

  const refMap = new Map<string, string>();
  for (const f of out.findings) {
    const src = sourceFor(f.sourceUrl, f.sourceTitle, f.publisher, f.publishedDate, f.origin, f.derivedFromCompany);
    const target = f.relatesToClaimRef ? next.claims.find((x) => x.id === f.relatesToClaimRef) : undefined;
    if (target && f.effect !== "NEW_INFORMATION") {
      target.evidence.push({ sourceId: src.id, effect: f.effect, excerpt: f.finding, location: f.sourceUrl, note: src.citationVerified ? null : "URL not among retrieved search results — unverified citation" });
      target.history.push({ at: asOf.toISOString(), change: f.effect === "CONTRADICTS" ? "CONTRADICTED" : "CONFIRMED", note: `${f.effect} via ${src.id}` });
      recomputeVerification(target, next);
      refMap.set(f.ref, target.id);
    } else {
      const id = clmId();
      refMap.set(f.ref, id);
      // "No evidence found" is a gap, not a verified fact about the company.
      const negative = NEGATIVE_FINDING.test(f.finding);
      const independent = !negative && src.origin !== "COMPANY" && !f.derivedFromCompany && src.citationVerified;
      next.claims.push({
        id,
        category: topicToCategory(f.topic),
        statement: f.finding,
        valueText: null,
        entity: f.topic === "FOUNDER" ? "founder" : f.topic === "COMPETITOR" ? "competitor" : "company",
        period: f.publishedDate,
        material: true,
        unusualness: 2,
        proposition: null,
        evidenceNeeded: null,
        origin: src.origin,
        verification: independent && src.origin === "PRIMARY_EXTERNAL" ? "VERIFIED" : independent ? "PARTIALLY_VERIFIED" : "UNVERIFIED",
        freshness: freshnessFor(f.publishedDate, asOf),
        independence: independent ? "INDEPENDENT" : src.independenceGroup === "COMPANY" ? "COMPANY_DERIVED" : "SHARED_ORIGIN",
        verificationMethod: `External research (${src.origin.toLowerCase().replace(/_/g, " ")})`,
        limitations: negative ? "Absence of evidence in the sources searched — not a verified fact" : src.citationVerified ? null : "Cited URL not among retrieved search results",
        contradictions: [],
        evidence: [{ sourceId: src.id, effect: "NEW_INFORMATION", excerpt: f.finding, location: f.sourceUrl, note: null }],
        history: [{ at: asOf.toISOString(), change: "CREATED", note: "From external research" }],
      });
    }
  }

  // Founder findings → TEAM claims linked to founders.
  for (const ff of out.founderFindings) {
    const src = sourceFor(ff.sourceUrl, `${ff.founderName} — ${ff.kind.toLowerCase()}`, null, null, "INDEPENDENT_SECONDARY", false);
    next.claims.push({
      id: clmId(),
      category: "TEAM",
      statement: `${ff.founderName}: ${ff.finding}`,
      valueText: null,
      entity: ff.founderName,
      period: null,
      material: true,
      unusualness: 2,
      proposition: null,
      evidenceNeeded: null,
      origin: src.origin,
      verification: src.citationVerified && src.origin !== "COMPANY" ? "PARTIALLY_VERIFIED" : "UNVERIFIED",
      freshness: "CURRENT",
      independence: src.origin === "COMPANY" ? "COMPANY_DERIVED" : "INDEPENDENT",
      verificationMethod: "Founder research",
      limitations: ff.relevance,
      contradictions: [],
      evidence: [{ sourceId: src.id, effect: "NEW_INFORMATION", excerpt: ff.finding, location: ff.sourceUrl, note: null }],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Founder research" }],
    });
  }

  // Market estimates and competitors → claims (analysis step reads them).
  for (const m of out.marketEstimates) {
    const src = sourceFor(m.sourceUrl, m.description, null, m.year ? String(m.year) : null, "INDEPENDENT_SECONDARY", false);
    const range = m.lowUsd || m.highUsd ? ` ($${((m.lowUsd ?? m.highUsd)! / 1e9).toFixed(2)}B–$${((m.highUsd ?? m.lowUsd)! / 1e9).toFixed(2)}B)` : "";
    next.claims.push({
      id: clmId(),
      category: "MARKET",
      statement: `${m.description}${range}. Scope: ${m.scope}`,
      valueText: range || null,
      entity: "market",
      period: m.year ? String(m.year) : null,
      material: true,
      unusualness: 2,
      proposition: null,
      evidenceNeeded: null,
      origin: src.origin,
      verification: src.citationVerified ? "PARTIALLY_VERIFIED" : "UNVERIFIED",
      freshness: freshnessFor(m.year ? String(m.year) : null, asOf),
      independence: src.origin === "COMPANY" ? "COMPANY_DERIVED" : "INDEPENDENT",
      verificationMethod: "Independent market estimate",
      limitations: "Third-party estimates vary in scope and method",
      contradictions: [],
      evidence: [{ sourceId: src.id, effect: "NEW_INFORMATION", excerpt: m.description, location: m.sourceUrl, note: null }],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Market research" }],
    });
  }
  for (const comp of out.competitors) {
    const url = comp.url ?? null;
    const src = url ? sourceFor(url, comp.name, comp.name, null, "COMPANY", true) : null;
    next.claims.push({
      id: clmId(),
      category: "COMPETITION",
      statement: `${comp.name} (${comp.type.toLowerCase().replace(/_/g, " ")}): ${comp.description}${comp.scale ? ` — ${comp.scale}` : ""}`,
      valueText: null,
      entity: comp.name,
      period: null,
      material: comp.type === "DIRECT" || comp.type === "INCUMBENT",
      unusualness: 2,
      proposition: null,
      evidenceNeeded: null,
      origin: "INDEPENDENT_SECONDARY",
      verification: "PARTIALLY_VERIFIED",
      freshness: "CURRENT",
      independence: "INDEPENDENT",
      verificationMethod: "Competitive research",
      limitations: null,
      contradictions: [],
      evidence: src ? [{ sourceId: src.id, effect: "NEW_INFORMATION", excerpt: comp.description, location: url, note: null }] : [],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Competitive research" }],
    });
  }

  // Gap updates.
  for (const u of out.gapUpdates) {
    const g = next.informationGaps.find((x) => x.id === u.gapRef);
    if (!g) continue;
    g.status = u.status === "RESOLVED" ? "RESOLVED" : u.status === "NEEDS_FOUNDER" ? "NEEDS_FOUNDER" : "RESEARCHED";
    g.resolutionNote = u.note;
  }

  const flags = out.suspectedInstructions.map((s) => ({ location: s.url, excerpt: s.excerpt }));
  next.analysis.securityFlags = dedupeFlags([...next.analysis.securityFlags, ...flags]);
  return { deal: next, refMap };
}

export const NEGATIVE_FINDING = /\b(no|not any|could not|couldn't|unable to|did not|didn't)\b[^.]{0,60}\b(evidence|record|information|mention|trace|result|verif|find|found|locate|confirm)/i;

function topicToCategory(t: string): Claim["category"] {
  switch (t) {
    case "FOUNDER":
      return "TEAM";
    case "CUSTOMER":
      return "CUSTOMER";
    case "MARKET":
      return "MARKET";
    case "COMPETITOR":
      return "COMPETITION";
    case "REGULATORY":
      return "REGULATORY";
    case "FINANCING":
      return "FUNDING";
    case "PRODUCT":
      return "PRODUCT";
    default:
      return "OTHER";
  }
}

/**
 * Verification is computed from the evidence links, never asserted by the model:
 * - any CONTRADICTS from a retrieved, non-company source → CONTRADICTED
 * - CONFIRMS from a retrieved PRIMARY_EXTERNAL source, or from ≥2 independent groups → VERIFIED
 * - any other retrieved independent confirmation → PARTIALLY_VERIFIED
 * - otherwise UNVERIFIED
 */
export function recomputeVerification(claim: Claim, deal: CanonicalDeal) {
  const links = claim.evidence
    .map((e) => ({ e, s: deal.sources.find((x) => x.id === e.sourceId) }))
    .filter((x) => x.s && x.s.citationVerified && x.s.origin !== "COMPANY" && x.s.independenceGroup !== "COMPANY");
  const contradicts = links.filter((x) => x.e.effect === "CONTRADICTS");
  const confirms = links.filter((x) => x.e.effect === "CONFIRMS" || x.e.effect === "PARTIALLY_CONFIRMS");
  const groups = new Set(confirms.map((x) => x.s!.independenceGroup));
  if (contradicts.length) {
    claim.verification = "CONTRADICTED";
    claim.contradictions = contradicts.map((x) => `${x.s!.id}: ${x.e.excerpt}`);
  } else if (confirms.some((x) => x.e.effect === "CONFIRMS" && x.s!.origin === "PRIMARY_EXTERNAL") || groups.size >= 2) {
    claim.verification = "VERIFIED";
  } else if (confirms.length) {
    claim.verification = "PARTIALLY_VERIFIED";
  }
  claim.independence = groups.size > 0 ? "INDEPENDENT" : claim.independence;
  if (claim.verification !== "UNVERIFIED") claim.verificationMethod = `Checked against ${links.length} external source(s), ${groups.size} independent origin(s)`;
  // Propagate to linked metrics.
  for (const m of deal.metrics) if (m.claimId === claim.id) {
    m.verification = claim.verification;
    if (claim.verification === "CONTRADICTED") m.state = "CONTRADICTED";
  }
}

/* ---------------------------------------------------------------- */
/* Analysis & red team                                                */
/* ---------------------------------------------------------------- */

export function applyInvestmentAnalysis(c: CanonicalDeal, out: InvestmentAnalysisOutput): CanonicalDeal {
  const next = structuredClone(c);
  const rskId = seqIdFactory("RSK", [], 2);
  next.founders = out.founders.map((f, i) => {
    const deck = next.foundersFromDeck.find((d) => normName(d.name) === normName(f.name)) ?? next.foundersFromDeck[i];
    return {
      ...f,
      id: `FDR-${String(i + 1).padStart(2, "0")}`,
      backgroundFromDeck: deck?.backgroundFromDeck ?? "",
      priorOrganizations: deck?.priorOrganizations ?? [],
      publicProfileUrls: deck?.publicProfileUrls ?? [],
      researchFindingSourceIds: next.claims
        .filter((cl) => cl.category === "TEAM" && normName(cl.entity) === normName(f.name))
        .flatMap((cl) => cl.evidence.map((e) => e.sourceId)),
    };
  });
  next.product = out.product;
  next.pain = out.pain;
  next.customers = out.customers;
  next.pmf = out.pmf;
  next.market = out.market;
  next.competition = out.competition;
  next.moat = out.moat;
  next.gtm = out.gtm;
  next.economicsNotes = out.economicsNotes;
  next.financingPath = out.financingPath;
  next.risks = out.risks.map((r) => ({ ...r, id: rskId() }));
  next.rubric = out.rubric;
  next.exitAssumptions = out.exitAssumptions;
  next.arpaAssumptionUsd = out.arpaAssumptionUsd;
  return next;
}

/** §63 Question decision test, enforced in code. */
export function passesDecisionTest(q: { ifAnswerA: string; ifAnswerB: string; affects: string[] }) {
  const a = q.ifAnswerA.trim().toLowerCase();
  const b = q.ifAnswerB.trim().toLowerCase();
  return q.affects.length > 0 && a.length > 8 && b.length > 8 && a !== b;
}

export function applyThesis(c: CanonicalDeal, out: ThesisOutput): CanonicalDeal {
  const next = structuredClone(c);
  next.realityCheck = out.realityCheck;
  next.revealedBeyondPitch = out.revealedBeyondPitch;
  next.decisionCore = { ...out.decisionCore, determinants: out.decisionCore.determinants.slice(0, 5), outlierSignals: out.decisionCore.outlierSignals.slice(0, 2) };
  next.executiveSummary = out.executiveSummary;
  next.exceptionalStrengths = out.exceptionalStrengths.map((x, i) => ({ ...x, id: `EXC-${i + 1}` }));
  next.nonlinear = out.nonlinear;
  next.thesis = { ...out.thesis, thesisPoints: out.thesis.thesisPoints.slice(0, 3), whatCouldBreak: out.thesis.whatCouldBreak.slice(0, 3) };
  next.falsification = out.falsification;
  next.redTeam = out.redTeam;
  next.alternativeExplanations = out.alternativeExplanations;
  next.whatILike = out.whatILike.slice(0, 3);
  next.whatWorriesMe = out.whatWorriesMe.slice(0, 3);
  next.powerLawRatings = out.powerLawRatings;
  return next;
}

export function applyActions(c: CanonicalDeal, out: ActionsOutput): CanonicalDeal {
  const next = structuredClone(c);
  next.causalModel = out.causalModel;
  next.sensitivityDrivers = out.sensitivityDrivers.slice(0, 6);
  next.perfectSlides = out.perfectSlides;
  const tierOrder = { MUST_ASK: 0, IMPORTANT: 1, OPTIONAL: 2 } as const;
  next.questions = out.questions
    .filter(passesDecisionTest)
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier])
    .slice(0, 8)
    .map((q, i) => ({ ...q, id: `Q-${String(i + 1).padStart(2, "0")}`, status: "OPEN", answer: null, answeredAt: null, resolutionNote: null }));
  next.nextBestAction = out.nextBestAction;
  next.aiRecommendation = out.recommendation;
  return next;
}

/* ---------------------------------------------------------------- */
/* Founder call update (§65)                                          */
/* ---------------------------------------------------------------- */

export interface FounderCallChangeCounts {
  confirmed: number;
  clarified: number;
  changed: number;
  contradicted: number;
  unresolved: number;
  newClaims: number;
}

/** Where code limited what founder statements alone could change (shown next to the Before/After). */
export interface MeetingGuard {
  /** Join key of the change (RUBRIC:<criterion>, FOUNDER:<name>:<dimension>, CONDITION:<i>, RSK-xx). */
  key: string;
  proposed: string;
  applied: string;
  note: string;
}

export interface FounderCallApplyOptions {
  /** Verbatim transcript turns: evidence locations become "Meeting 1 · T-12 · 04:31". */
  segments?: TranscriptSegment[];
  /** "Meeting 1 (2026-09-20)". */
  label?: string;
}

const RATING_ORDER = ["INSUFFICIENT_EVIDENCE", "WEAK", "BELOW_BAR", "ADEQUATE", "STRONG", "EXCEPTIONAL"] as const;
const LEVEL_ORDER = ["LOW", "MODERATE", "HIGH", "CRITICAL"] as const;
const WEAKNESS_ORDER = ["REPAIRABLE", "STRUCTURAL", "THESIS_KILLING"] as const;
/** Capabilities a partner can actually observe in a meeting; the rest stay INFERRED from what was said. */
const MEETING_OBSERVABLE = new Set(["COMMUNICATION_INTELLECTUAL_HONESTY", "JUDGMENT", "CUSTOMER_UNDERSTANDING", "LEARNING_VELOCITY", "COFOUNDER_DYNAMICS"]);
const COMPANY_REPORTED_NOTE = "founder statements are company-reported";

/**
 * Founder statements are company-reported: they can lower a rating freely but
 * raise it by at most one notch (from INSUFFICIENT_EVIDENCE: at most ADEQUATE),
 * never to EXCEPTIONAL. Verification is never touched here.
 */
export function guardRating(before: RubricRating | null, proposed: RubricRating): { applied: RubricRating; capped: boolean } {
  const b = before ? RATING_ORDER.indexOf(before) : 0;
  const p = RATING_ORDER.indexOf(proposed);
  if (p <= b) return { applied: proposed, capped: false };
  const cap = b === 0 ? RATING_ORDER.indexOf("ADEQUATE") : Math.min(b + 1, RATING_ORDER.indexOf("STRONG"));
  return p > cap ? { applied: RATING_ORDER[cap]!, capped: true } : { applied: proposed, capped: false };
}

/**
 * A risk can be escalated freely. Founder statements reduce it by at most `maxDown`
 * levels: severity (impact if it happens) not at all, likelihood by one.
 */
function guardLevel(before: Level, proposed: Level, maxDown: number): { applied: Level; capped: boolean } {
  const b = LEVEL_ORDER.indexOf(before);
  const p = LEVEL_ORDER.indexOf(proposed);
  if (p >= b - maxDown) return { applied: proposed, capped: false };
  return { applied: LEVEL_ORDER[b - maxDown]!, capped: true };
}

export function applyFounderCall(
  c: CanonicalDeal,
  out: FounderCallOutput,
  transcriptSourceTitle: string,
  asOf = new Date(),
  opts: FounderCallApplyOptions = {},
): { deal: CanonicalDeal; changes: FounderCallChangeCounts; guards: MeetingGuard[] } {
  const next = structuredClone(c);
  const at = asOf.toISOString();
  const label = opts.label ?? "Founder call";
  const segments = opts.segments ?? [];
  const srcId = seqIdFactory("SRC", next.sources.map((x) => x.id));
  const clmId = seqIdFactory("CLM", next.claims.map((x) => x.id));
  const metId = seqIdFactory("MET", next.metrics.map((x) => x.id));
  const rskId = seqIdFactory("RSK", next.risks.map((x) => x.id), 2);
  const src: Source = {
    id: srcId(),
    kind: "TRANSCRIPT",
    title: transcriptSourceTitle,
    url: null,
    documentId: null,
    publisher: null,
    publishedDate: asOf.toISOString().slice(0, 10),
    retrievedAt: at,
    origin: "COMPANY",
    independenceGroup: "COMPANY",
    citationVerified: true,
  };
  next.sources.push(src);
  const changes: FounderCallChangeCounts = { confirmed: 0, clarified: 0, changed: 0, contradicted: 0, unresolved: 0, newClaims: 0 };
  const guards: MeetingGuard[] = [];
  /** "Meeting 1 · T-12 · 04:31" — the exact turn a statement was made in (falls back to the meeting label). */
  const loc = (refs: string[] | undefined, excerpt?: string | null) => {
    const r = segments.length ? resolveRefs(segments, refs, excerpt) : [];
    if (!r.length) return `${label} · transcript`;
    const first = r[0]!;
    const ts = formatTimestamp(first.startSec);
    return `${label} · ${r.map((x) => x.ref).join(", ")}${ts ? ` · ${ts}` : ""}`;
  };
  /**
   * With a segmented transcript, an extraction item that cannot be located in it
   * (no valid turn ref, excerpt not found) does not change the analysis.
   */
  const anchored = (key: string, what: string, refs: string[] | undefined, excerpt?: string | null) => {
    if (!segments.length || resolveRefs(segments, refs, excerpt).length) return true;
    guards.push({ key, proposed: what, applied: "not applied", note: "Not located in the transcript (no valid turn reference or verbatim excerpt)" });
    return false;
  };

  for (const u of out.questionUpdates) {
    const q = next.questions.find((x) => x.id === u.questionId);
    // Not discussed in this meeting: the question keeps its status (an earlier answer is not erased).
    if (!q || (u.status === "OPEN" && segments.length > 0)) continue;
    if (!anchored(q.id, `${u.status}: ${u.answerSummary}`, u.transcriptRefs, u.transcriptExcerpt)) continue;
    q.status = u.status === "OPEN" ? "ASKED" : u.status;
    q.answer = u.answerSummary;
    q.answeredAt = at;
    q.resolutionNote = `${u.implication} (${loc(u.transcriptRefs, u.transcriptExcerpt)})`;
  }

  const contradictedClaims = new Set<string>();
  for (const u of out.claimUpdates) {
    const cl = next.claims.find((x) => x.id === u.claimId);
    if (!cl || !anchored(cl.id, `${u.change}: ${u.founderSaid}`, u.transcriptRefs, u.transcriptExcerpt)) continue;
    const where = loc(u.transcriptRefs, u.transcriptExcerpt);
    const effect = u.change === "CONTRADICTED" ? "CONTRADICTS" : u.change === "CONFIRMED" ? "CONFIRMS" : "NEW_INFORMATION";
    const note = u.change === "CLARIFIED" ? `Clarification: ${u.note}` : u.note;
    cl.evidence.push({ sourceId: src.id, effect, excerpt: u.transcriptExcerpt, location: where, note });
    cl.history.push({ at, change: u.change, note: `${label}: ${note}` });
    // Founder statements never upgrade verification (company origin); contradictions are recorded, not resolved.
    if (u.change === "CONTRADICTED") {
      cl.contradictions.push(`Founder call — ${where} (transcript): ${u.founderSaid || u.note}`);
      contradictedClaims.add(cl.id);
      changes.contradicted++;
    } else if (u.change === "CONFIRMED") changes.confirmed++;
    else if (u.change === "CLARIFIED") changes.clarified++;
    else if (u.change === "CHANGED") changes.changed++;
    else changes.unresolved++;
  }
  for (const x of out.contradictions ?? []) {
    if (!anchored(`CONTRADICTION:${x.targetId ?? x.statement.slice(0, 40)}`, x.statement, x.transcriptRefs, x.transcriptExcerpt)) continue;
    const cl = x.targetId ? next.claims.find((k) => k.id === x.targetId) : undefined;
    if (cl && !contradictedClaims.has(cl.id)) {
      const where = loc(x.transcriptRefs, x.transcriptExcerpt);
      cl.evidence.push({ sourceId: src.id, effect: "CONTRADICTS", excerpt: x.transcriptExcerpt, location: where, note: x.statement });
      cl.history.push({ at, change: "CONTRADICTED", note: `${label}: ${x.statement}` });
      cl.contradictions.push(`Founder call — ${where} (transcript): ${x.statement}`);
      contradictedClaims.add(cl.id);
      changes.contradicted++;
    }
    const m = x.targetId ? next.metrics.find((k) => k.id === x.targetId) : undefined;
    if (m) {
      if (!m.qualityFlags.includes("CONTRADICTED_IN_MEETING")) m.qualityFlags.push("CONTRADICTED_IN_MEETING");
      m.notes = [m.notes, `${label}: founder statement conflicts — ${x.statement} (${loc(x.transcriptRefs, x.transcriptExcerpt)})`].filter(Boolean).join(" | ");
    }
  }
  for (const u of out.metricClarifications ?? []) {
    const m = next.metrics.find((x) => x.id === u.metricId);
    if (!m || !anchored(m.id, u.clarifiedDefinition, u.transcriptRefs, u.transcriptExcerpt)) continue;
    // The reported value is kept as extracted; the clarified definition is recorded next to it.
    if (!m.qualityFlags.includes("DEFINITION_CLARIFIED_IN_MEETING")) m.qualityFlags.push("DEFINITION_CLARIFIED_IN_MEETING");
    m.notes = [m.notes, `${label}: ${u.clarifiedDefinition} — ${u.implication} (${loc(u.transcriptRefs, u.transcriptExcerpt)})`].filter(Boolean).join(" | ");
    const cl = m.claimId ? next.claims.find((x) => x.id === m.claimId) : undefined;
    if (cl && !out.claimUpdates.some((x) => x.claimId === cl.id)) {
      cl.evidence.push({ sourceId: src.id, effect: "NEW_INFORMATION", excerpt: u.transcriptExcerpt, location: loc(u.transcriptRefs, u.transcriptExcerpt), note: `Clarification: ${u.clarifiedDefinition}` });
      cl.history.push({ at, change: "CLARIFIED", note: `${label}: ${u.clarifiedDefinition}` });
      changes.clarified++;
    }
  }
  for (const n of out.newClaims) {
    if (!anchored(`NEW:${n.statement.slice(0, 40)}`, n.statement, n.transcriptRefs, n.excerpt)) continue;
    changes.newClaims++;
    next.claims.push({
      id: clmId(),
      category: n.category,
      statement: n.statement,
      valueText: n.valueText,
      entity: "company",
      period: null,
      material: n.material,
      unusualness: 2,
      proposition: null,
      evidenceNeeded: null,
      origin: "COMPANY",
      verification: "UNVERIFIED",
      freshness: "CURRENT",
      independence: "COMPANY_DERIVED",
      verificationMethod: "Stated by founder in meeting",
      limitations: null,
      contradictions: [],
      evidence: [{ sourceId: src.id, effect: "ORIGIN", excerpt: n.excerpt, location: loc(n.transcriptRefs, n.excerpt), note: null }],
      history: [{ at, change: "CREATED", note: label }],
    });
  }
  for (const u of out.gapUpdates ?? []) {
    const g = next.informationGaps.find((x) => x.id === u.gapId);
    if (!g || (u.status === "OPEN" && segments.length > 0 && !u.transcriptRefs.length)) continue;
    if (!anchored(g.id, `${u.status}: ${u.note}`, u.transcriptRefs)) continue;
    g.status = u.status;
    g.resolutionNote = `${label}: ${u.note}`;
  }

  /* ---------- targeted re-evaluation (guarded) ---------- */
  for (const u of out.rubricUpdates ?? []) {
    if (!anchored(`RUBRIC:${u.criterion}`, u.rating, u.transcriptRefs)) continue;
    const cur = next.rubric.find((r) => r.criterion === u.criterion);
    const g = guardRating(cur?.rating ?? null, u.rating);
    if (g.capped) guards.push({ key: `RUBRIC:${u.criterion}`, proposed: u.rating, applied: g.applied, note: `Raised at most one notch on meeting evidence alone (${COMPANY_REPORTED_NOTE})` });
    const rationale = `${u.reason} (${loc(u.transcriptRefs)}; ${COMPANY_REPORTED_NOTE})`;
    if (cur) {
      cur.rating = g.applied;
      cur.rationale = rationale;
    } else next.rubric.push({ criterion: u.criterion, rating: g.applied, rationale, claimRefs: [] });
  }
  for (const u of out.capabilityUpdates ?? []) {
    const f = next.founders.find((x) => normName(x.name) === normName(u.founderName));
    if (!f || !anchored(`FOUNDER:${f.id}:${u.dimension}`, u.rating, u.transcriptRefs)) continue;
    const cap = f.capabilities.find((x) => x.dimension === u.dimension);
    const g = guardRating(cap?.rating ?? null, u.rating);
    const key = `FOUNDER:${f.id}:${u.dimension}`;
    if (g.capped) guards.push({ key, proposed: u.rating, applied: g.applied, note: `Raised at most one notch on meeting evidence alone (${COMPANY_REPORTED_NOTE})` });
    const observability = MEETING_OBSERVABLE.has(u.dimension) ? "OBSERVABLE" : cap?.observability === "OBSERVABLE" ? "OBSERVABLE" : "INFERRED";
    const evidence = `${u.founderSaid} — ${u.reason} (${loc(u.transcriptRefs)})`;
    if (cap) Object.assign(cap, { rating: g.applied, observability, evidence });
    else f.capabilities.push({ dimension: u.dimension, relevant: true, rating: g.applied, observability, evidence, claimRefs: [] });
  }
  if (next.thesis) {
    for (const u of out.conditionUpdates ?? []) {
      const cond = next.thesis.requiredConditions[u.conditionIndex];
      if (!cond || !anchored(`CONDITION:${u.conditionIndex}`, u.status, u.transcriptRefs)) continue;
      let status = u.status;
      // A founder's word can make a condition plausible, not supported.
      if (status === "SUPPORTED" && cond.status !== "SUPPORTED") {
        guards.push({ key: `CONDITION:${u.conditionIndex}`, proposed: "SUPPORTED", applied: "PARTIALLY_SUPPORTED", note: `Support resting on meeting statements alone is partial (${COMPANY_REPORTED_NOTE})` });
        status = "PARTIALLY_SUPPORTED";
      }
      cond.status = status;
      cond.currentEvidence = `${u.founderSaid} — ${u.reason} (${loc(u.transcriptRefs)}; ${COMPANY_REPORTED_NOTE})`;
    }
  }
  for (const u of out.riskUpdates ?? []) {
    if (!anchored(u.riskId ?? `NEW_RISK:${u.title.slice(0, 40)}`, `${u.severity} / ${u.likelihood}`, u.transcriptRefs)) continue;
    const r = u.riskId ? next.risks.find((x) => x.id === u.riskId) : undefined;
    const where = loc(u.transcriptRefs);
    if (!r) {
      next.risks.push({
        id: rskId(),
        category: u.category,
        title: u.title,
        description: u.description,
        severity: u.severity,
        likelihood: u.likelihood,
        timing: "NOW",
        mitigation: "",
        evidence: `${u.founderSaid} (${where})`,
        claimRefs: [],
        weaknessClass: u.weaknessClass,
        repair: null,
      });
      continue;
    }
    const sev = guardLevel(r.severity, u.severity, 0);
    const lik = guardLevel(r.likelihood, u.likelihood, 1);
    const wb = WEAKNESS_ORDER.indexOf(r.weaknessClass);
    const wp = WEAKNESS_ORDER.indexOf(u.weaknessClass);
    const weaknessClass = wp >= wb - 1 ? u.weaknessClass : WEAKNESS_ORDER[wb - 1]!;
    if (sev.capped || lik.capped || weaknessClass !== u.weaknessClass)
      guards.push({ key: r.id, proposed: `${u.severity} / ${u.likelihood}`, applied: `${sev.applied} / ${lik.applied}`, note: `Meeting statements alone do not lower severity and lower likelihood by at most one level (${COMPANY_REPORTED_NOTE})` });
    r.severity = sev.applied;
    r.likelihood = lik.applied;
    r.weaknessClass = weaknessClass;
    r.evidence = [r.evidence, `${label}: ${u.founderSaid} — ${u.reason} (${where})`].filter(Boolean).join(" | ");
  }

  if (out.recommendation) next.aiRecommendation = out.recommendation;
  if (out.nextAction) next.nextBestAction = { action: out.nextAction.action, rationale: out.nextAction.rationale, type: out.nextAction.type };
  const statedMetrics = out.newMetrics.filter((o) => anchored(`METRIC:${o.metricKey}:${o.rawText.slice(0, 30)}`, o.rawText, [], o.excerpt));
  const newInstances = statedMetrics
    .map((o) => normalizeObservation(o, { asOf, nextId: metId, sourceIdForPage: () => src.id }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  for (const m of newInstances) m.location = loc([], m.excerpt);
  next.metricObservations = [...next.metricObservations, ...statedMetrics];
  next.metrics = deriveMetrics([...next.metrics.filter((m) => m.calculationMethod !== "DERIVED"), ...newInstances], metId);
  return { deal: next, changes, guards };
}

export function openGaps(c: CanonicalDeal): InformationGap[] {
  return c.informationGaps.filter((g) => g.status === "OPEN");
}
