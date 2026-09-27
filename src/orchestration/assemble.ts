/**
 * Deterministic assembly of model outputs into the canonical object.
 * Code — not the model — decides ids, verification status, independence
 * and freshness.
 */
import type { CanonicalDeal, Claim, InformationGap, Source } from "@/domain/canonical";
import type { DeckUnderstandingOutput } from "@/ai/prompts/deck-understanding";
import type { ResearchOutput } from "@/ai/prompts/research";
import type { InvestmentAnalysisOutput } from "@/ai/prompts/investment-analysis";
import type { RedTeamOutput } from "@/ai/prompts/red-team";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import { normalizeObservation, parsePeriodDate } from "@/engine/metrics/normalize";
import { deriveMetrics } from "@/engine/metrics/derive";
import { seqIdFactory, nowIso, normName } from "@/server/ids";
import { detectInjection } from "@/ai/untrusted";

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
/* Deck understanding                                                 */
/* ---------------------------------------------------------------- */

export function applyDeckUnderstanding(c: CanonicalDeal, out: DeckUnderstandingOutput, docs: IngestedDoc[], asOf = new Date()): CanonicalDeal {
  const next = structuredClone(c);
  const srcId = seqIdFactory("SRC", next.sources.map((x) => x.id));
  const clmId = seqIdFactory("CLM", next.claims.map((x) => x.id));
  const metId = seqIdFactory("MET", next.metrics.map((x) => x.id));
  const gapId = seqIdFactory("GAP", next.informationGaps.map((x) => x.id), 2);

  next.identity = out.identity;
  next.classification = out.classification;
  next.product = out.product;
  next.businessModel = out.businessModel;
  next.customers = out.customers;
  next.foundersFromDeck = out.founders;
  next.financing = out.financing;
  next.deckMarket = out.deckMarket;
  next.documents = docs.map((d) => ({ id: d.documentId, filename: d.filename, kind: d.kind, pages: d.pages.length }));

  // One source per document; the primary deck is SRC-001.
  const docSource = new Map<string, string>();
  for (const d of docs) {
    const id = srcId();
    docSource.set(d.documentId, id);
    next.sources.push({
      id,
      kind: "DOCUMENT",
      title: d.filename,
      url: null,
      documentId: d.documentId,
      publisher: out.identity.name,
      publishedDate: null,
      retrievedAt: asOf.toISOString(),
      origin: "COMPANY",
      independenceGroup: "COMPANY",
      citationVerified: true,
    });
  }
  const primarySource = docSource.get(docs[0]?.documentId ?? "") ?? null;

  // Claims.
  const refToClaim = new Map<string, string>();
  for (const cl of out.claims) {
    const id = clmId();
    refToClaim.set(cl.ref, id);
    next.claims.push({
      id,
      category: cl.category,
      statement: cl.statement,
      valueText: cl.valueText,
      entity: cl.entity,
      period: cl.period,
      material: cl.material,
      origin: "COMPANY",
      verification: "UNVERIFIED",
      freshness: freshnessFor(cl.period, asOf),
      independence: "COMPANY_DERIVED",
      verificationMethod: "Stated in company materials",
      limitations: null,
      contradictions: [],
      evidence: primarySource ? [{ sourceId: primarySource, effect: "ORIGIN", excerpt: cl.excerpt, location: cl.page ? `p. ${cl.page}` : null, note: null }] : [],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Extracted from deck" }],
    });
  }

  // Metrics: normalize deterministically, then derive.
  next.metricObservations = out.metrics;
  const findClaimByExcerpt = (excerpt: string) => {
    const e = excerpt.trim().slice(0, 40).toLowerCase();
    if (!e) return null;
    return next.claims.find((x) => x.evidence.some((ev) => ev.excerpt.toLowerCase().includes(e)))?.id ?? null;
  };
  const instances = out.metrics
    .map((o) => normalizeObservation(o, { asOf, nextId: metId, sourceIdForPage: () => primarySource, claimIdForExcerpt: findClaimByExcerpt }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  next.metrics = deriveMetrics([...next.metrics, ...instances], metId);

  // Information gaps.
  next.informationGaps = out.informationGaps.map((g) => ({ ...g, id: gapId(), status: g.researchability === "FOUNDER_ONLY" ? "NEEDS_FOUNDER" : "OPEN", resolutionNote: null }));

  // Security flags: model-reported + deterministic detector over raw pages.
  const flags = [
    ...out.suspectedInstructions.map((s) => ({ location: s.page ? `p. ${s.page}` : "document", excerpt: s.excerpt })),
    ...docs.flatMap((d) => d.pages.flatMap((p) => detectInjection(p.text, `${d.filename} p. ${p.pageNo}`))),
  ];
  next.analysis.securityFlags = dedupeFlags([...next.analysis.securityFlags, ...flags]);
  return next;
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
  return next;
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

export function applyRedTeam(c: CanonicalDeal, out: RedTeamOutput): CanonicalDeal {
  const next = structuredClone(c);
  next.executiveSummary = out.executiveSummary;
  next.exceptionalStrengths = out.exceptionalStrengths.map((x, i) => ({ ...x, id: `EXC-${i + 1}` }));
  next.nonlinear = out.nonlinear;
  next.thesis = { ...out.thesis, thesisPoints: out.thesis.thesisPoints.slice(0, 3), whatCouldBreak: out.thesis.whatCouldBreak.slice(0, 3) };
  next.falsification = out.falsification;
  next.redTeam = out.redTeam;
  next.whatILike = out.whatILike.slice(0, 3);
  next.whatWorriesMe = out.whatWorriesMe.slice(0, 3);
  const tierOrder = { MUST_ASK: 0, IMPORTANT: 1, OPTIONAL: 2 } as const;
  next.questions = out.questions
    .filter(passesDecisionTest)
    .sort((a, b) => tierOrder[a.tier] - tierOrder[b.tier])
    .slice(0, 8)
    .map((q, i) => ({ ...q, id: `Q-${String(i + 1).padStart(2, "0")}`, status: "OPEN", answer: null, answeredAt: null, resolutionNote: null }));
  next.nextBestAction = out.nextBestAction;
  next.aiRecommendation = out.recommendation;
  next.powerLawRatings = out.powerLawRatings;
  return next;
}

/* ---------------------------------------------------------------- */
/* Founder call update (§65)                                          */
/* ---------------------------------------------------------------- */

export function applyFounderCall(c: CanonicalDeal, out: FounderCallOutput, transcriptSourceTitle: string, asOf = new Date()): { deal: CanonicalDeal; changes: { confirmed: number; changed: number; contradicted: number; unresolved: number; newClaims: number } } {
  const next = structuredClone(c);
  const srcId = seqIdFactory("SRC", next.sources.map((x) => x.id));
  const clmId = seqIdFactory("CLM", next.claims.map((x) => x.id));
  const metId = seqIdFactory("MET", next.metrics.map((x) => x.id));
  const src: Source = {
    id: srcId(),
    kind: "TRANSCRIPT",
    title: transcriptSourceTitle,
    url: null,
    documentId: null,
    publisher: null,
    publishedDate: asOf.toISOString().slice(0, 10),
    retrievedAt: asOf.toISOString(),
    origin: "COMPANY",
    independenceGroup: "COMPANY",
    citationVerified: true,
  };
  next.sources.push(src);
  const changes = { confirmed: 0, changed: 0, contradicted: 0, unresolved: 0, newClaims: 0 };

  for (const u of out.questionUpdates) {
    const q = next.questions.find((x) => x.id === u.questionId);
    if (!q) continue;
    q.status = u.status === "OPEN" ? "ASKED" : u.status;
    q.answer = u.answerSummary;
    q.answeredAt = asOf.toISOString();
    q.resolutionNote = u.implication;
  }
  for (const u of out.claimUpdates) {
    const cl = next.claims.find((x) => x.id === u.claimId);
    if (!cl) continue;
    cl.evidence.push({ sourceId: src.id, effect: u.change === "CONTRADICTED" ? "CONTRADICTS" : u.change === "CONFIRMED" ? "CONFIRMS" : "NEW_INFORMATION", excerpt: u.transcriptExcerpt, location: "founder call", note: u.note });
    cl.history.push({ at: asOf.toISOString(), change: u.change, note: u.note });
    // Founder statements never upgrade verification (company origin); contradictions are recorded.
    if (u.change === "CONTRADICTED") {
      cl.contradictions.push(`Founder call: ${u.note}`);
      changes.contradicted++;
    } else if (u.change === "CONFIRMED") changes.confirmed++;
    else if (u.change === "CHANGED") changes.changed++;
    else changes.unresolved++;
  }
  for (const n of out.newClaims) {
    changes.newClaims++;
    next.claims.push({
      id: clmId(),
      category: n.category,
      statement: n.statement,
      valueText: n.valueText,
      entity: "company",
      period: null,
      material: n.material,
      origin: "COMPANY",
      verification: "UNVERIFIED",
      freshness: "CURRENT",
      independence: "COMPANY_DERIVED",
      verificationMethod: "Stated by founder on call",
      limitations: null,
      contradictions: [],
      evidence: [{ sourceId: src.id, effect: "ORIGIN", excerpt: n.excerpt, location: "founder call", note: null }],
      history: [{ at: asOf.toISOString(), change: "CREATED", note: "Founder call" }],
    });
  }
  const newInstances = out.newMetrics
    .map((o) => normalizeObservation(o, { asOf, nextId: metId, sourceIdForPage: () => src.id }))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  next.metricObservations = [...next.metricObservations, ...out.newMetrics];
  next.metrics = deriveMetrics([...next.metrics.filter((m) => m.calculationMethod !== "DERIVED"), ...newInstances], metId);
  return { deal: next, changes };
}

export function openGaps(c: CanonicalDeal): InformationGap[] {
  return c.informationGaps.filter((g) => g.status === "OPEN");
}
