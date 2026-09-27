/**
 * Fund Brain ingestion: "heavy intelligence at ingestion".
 *
 * After every new company version: memory pack, structured metric facts,
 * entity graph, retrieval chunks with embeddings (re-using embeddings for
 * unchanged text). Fund knowledge, IC observations and meetings are indexed
 * the same way.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import type { CanonicalDeal } from "@/domain/canonical";
import type { DerivedAnalysis } from "@/engine/derive";
import { CostController } from "@/ai/cost";
import { embed, EMBEDDING_DIM, EMBEDDING_MODEL } from "@/ai/openai";
import { newId, normName, nowIso } from "@/server/ids";
import { evidenceLabel } from "@/engine/scoring/evidence";
import { buildMemoryPack, fmtMetric } from "./memory-pack";
import { metricDef } from "@/engine/metrics/dictionary";
import { invalidateVectors, toBlob } from "./vectors";
import * as repo from "@/server/repo";

const s = schema;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");

type ChunkKind = (typeof s.chunks.$inferInsert)["kind"];
interface ChunkDraft {
  kind: ChunkKind;
  refId: string | null;
  title: string;
  text: string;
  href: string;
  evidenceLabel: string | null;
}

function companyChunks(slug: string, c: CanonicalDeal, db: DB): ChunkDraft[] {
  const out: ChunkDraft[] = [];
  const base = `/deals/${slug}`;
  const name = c.identity.name;

  // Pages of original documents.
  for (const doc of c.documents) {
    for (const p of repo.getDocumentPages(doc.id, db)) {
      if (p.text.trim().length < 40) continue;
      out.push({ kind: "PAGE", refId: `${doc.id}#${p.pageNo}`, title: `${name} — ${doc.filename} p. ${p.pageNo}`, text: p.text.slice(0, 6000), href: `${base}/evidence?doc=${doc.id}&page=${p.pageNo}`, evidenceLabel: "COMPANY_REPORTED" });
    }
  }
  // Claims (the ledger is the most citation-friendly unit).
  for (const cl of c.claims) {
    const label = evidenceLabel(cl);
    const src = cl.evidence.map((e) => `${e.sourceId}${e.location ? ` ${e.location}` : ""}`).join(", ");
    out.push({
      kind: "CLAIM",
      refId: cl.id,
      title: `${name} ${cl.id} (${cl.category.toLowerCase()})`,
      text: `${cl.statement}${cl.valueText ? ` Value: ${cl.valueText}.` : ""} Status: ${label.toLowerCase().replace("_", "-")}; origin ${cl.origin.toLowerCase()}; ${cl.verificationMethod}. Sources: ${src}.${cl.contradictions.length ? ` Contradictions: ${cl.contradictions.join("; ")}` : ""}`,
      href: `${base}/evidence?claim=${cl.id}`,
      evidenceLabel: label,
    });
  }
  // Web sources with their titles (for "show me the source").
  for (const src of c.sources.filter((x) => x.kind === "WEB")) {
    out.push({ kind: "SOURCE", refId: src.id, title: `${name} source ${src.id}: ${src.title}`, text: `${src.title} — ${src.url} (${src.origin.toLowerCase()}, ${src.citationVerified ? "retrieved" : "unverified citation"})`, href: src.url ?? `${base}/evidence`, evidenceLabel: null });
  }
  const section = (key: string, title: string, text: string | null | undefined, tab: string) => {
    if (text && text.trim().length > 30) out.push({ kind: "SECTION", refId: key, title: `${name} — ${title}`, text, href: `${base}/${tab}`, evidenceLabel: "INFERRED" });
  };
  if (c.product) section("product", "Product", `${c.product.whatItIs}. ${c.product.plainExplanation} ${c.product.whatItDoes} Before: ${c.product.before.join(" → ")}. After: ${c.product.after.join(" → ")}. User: ${c.product.user}. Buyer: ${c.product.buyer}.`, "product");
  if (c.pain) section("pain", "Pain", `${c.pain.demandType}: ${c.pain.assessment} Severity: ${c.pain.severity}. Cost: ${c.pain.economicCost}. Alternative: ${c.pain.alternativeBehavior}.`, "product");
  if (c.pmf) section("pmf", "PMF", `${c.pmf.assessment} Signals: ${c.pmf.signals.map((x) => `${x.signal} ${x.direction}: ${x.evidence}`).join("; ")}`, "traction");
  if (c.market) section("market", "Market", `${c.market.currentMarket}. Wedge: ${c.market.wedge}. ${c.market.deckTamAssessment} Value capture: ${c.market.valueCaptureAnalysis.conclusion} Why now: ${c.market.whyNow}`, "market");
  if (c.competition) section("competition", "Competition", `${c.competition.competitors.map((x) => `${x.name} (${x.type}): ${x.description}`).join("; ")}. Tests: ${c.competition.adversarialTests.map((t) => `${t.test} → ${t.verdict}: ${t.outcome}`).join("; ")}`, "competition");
  if (c.moat.length) section("moat", "Moat", c.moat.map((m) => `${m.dimension}: now ${m.current}, 3y ${m.in3Years}; ${m.whatMustHappen}`).join("; "), "competition");
  if (c.gtm) section("gtm", "GTM", `${c.gtm.assessment} Motion: ${c.gtm.salesMotion}. ICP: ${c.gtm.icp}. ${c.gtm.founderLedAssessment}`, "gtm");
  if (c.financingPath) section("financing", "Financing path", `${c.financingPath.proofPurchased}; ${c.financingPath.financingRiskAssessment} Next round: ${c.financingPath.nextRoundConditions}`, "returns");
  for (const f of c.founders) section(`founder:${f.id}`, `Founder ${f.name}`, `${f.name}, ${f.role}. ${f.summary} FMF: ${f.founderMarketFit}. Timeline: ${f.timeline.map((t) => `${t.period} ${t.organization} ${t.role}`).join("; ")}. Capabilities: ${f.capabilities.filter((x) => x.relevant).map((x) => `${x.dimension} ${x.rating} (${x.observability}): ${x.evidence}`).join("; ")}`, "founders");
  if (c.thesis) section("thesis", "Thesis", `Bet: ${c.thesis.bet} Points: ${c.thesis.thesisPoints.join("; ")}. Could break: ${c.thesis.whatCouldBreak.join("; ")}. Fatal weakness: ${c.thesis.fatalWeakness}. Required: ${c.thesis.requiredConditions.map((r) => `${r.condition} [${r.status}]`).join("; ")}`, "");
  if (c.redTeam) section("redteam", "Red team", `Against investing: ${c.redTeam.caseAgainstInvesting.join("; ")}. Against passing: ${c.redTeam.caseAgainstPassing.join("; ")}. Pass regret: ${c.redTeam.passRegretScenario}`, "risks");
  if (c.exceptionalStrengths.length) section("exceptional", "Exceptional strength", c.exceptionalStrengths.map((x) => `${x.claim} (${x.rating}): ${x.evidence}. Invalidated if: ${x.invalidation}`).join("; "), "");
  if (c.executiveSummary) out.push({ kind: "MEMO", refId: "summary", title: `${name} — executive summary`, text: c.executiveSummary, href: `${base}/memo`, evidenceLabel: "INFERRED" });
  for (const r of c.risks) out.push({ kind: "RISK", refId: r.id, title: `${name} risk ${r.id}: ${r.title}`, text: `${r.category} ${r.severity}/${r.likelihood} ${r.weaknessClass}: ${r.description} Mitigation: ${r.mitigation}`, href: `${base}/risks`, evidenceLabel: "INFERRED" });
  for (const q of c.questions) out.push({ kind: "QUESTION", refId: q.id, title: `${name} question ${q.id}`, text: `${q.question} (${q.tier}, ${q.status}) ${q.answer ? `Answer: ${q.answer}` : ""} Why: ${q.whyItMatters}`, href: `${base}/questions`, evidenceLabel: null });
  return out;
}

async function writeChunks(workspaceId: string, companyId: string | null, versionId: string | null, drafts: ChunkDraft[], cost: CostController, db: DB, scopeKinds?: ChunkKind[]) {
  // Existing embeddings by text hash (workspace-wide) so unchanged text is never re-embedded.
  const hashes = drafts.map((d) => sha(`${d.title}\n${d.text}`));
  const existing = new Map<string, Buffer>();
  for (let i = 0; i < hashes.length; i += 500) {
    const batch = hashes.slice(i, i + 500);
    for (const r of db
      .select({ h: s.chunks.textHash, e: s.chunks.embedding })
      .from(s.chunks)
      .where(and(eq(s.chunks.workspaceId, workspaceId), inArray(s.chunks.textHash, batch), isNotNull(s.chunks.embedding)))
      .all())
      if (r.e) existing.set(r.h, r.e as Buffer);
  }
  const toEmbed = drafts.map((d, i) => ({ d, h: hashes[i]! })).filter((x) => !existing.has(x.h));
  let vectors: Float32Array[] = [];
  let embedError: string | null = null;
  try {
    vectors = await embed(toEmbed.map((x) => `${x.d.title}\n${x.d.text}`), cost, "EMBED");
  } catch (e) {
    // Retrieval degrades to lexical + structured; never blocks the analysis.
    embedError = (e as Error).message;
  }
  const fresh = new Map<string, Buffer>();
  toEmbed.forEach((x, i) => vectors[i] && fresh.set(x.h, toBlob(vectors[i]!)));

  db.transaction((tx) => {
    if (companyId) tx.delete(s.chunks).where(and(eq(s.chunks.workspaceId, workspaceId), eq(s.chunks.companyId, companyId))).run();
    else if (scopeKinds?.length) tx.delete(s.chunks).where(and(eq(s.chunks.workspaceId, workspaceId), inArray(s.chunks.kind, scopeKinds))).run();
    drafts.forEach((d, i) => {
      const h = hashes[i]!;
      const emb = existing.get(h) ?? fresh.get(h) ?? null;
      tx.insert(s.chunks)
        .values({
          id: newId("chk"),
          workspaceId,
          companyId,
          versionId,
          kind: d.kind,
          refId: d.refId,
          title: d.title,
          text: d.text,
          href: d.href,
          evidenceLabel: d.evidenceLabel,
          textHash: h,
          embedding: emb,
          embeddingModel: emb ? EMBEDDING_MODEL : null,
          embeddingDim: emb ? EMBEDDING_DIM : null,
          createdAt: nowIso(),
        })
        .run();
    });
  });
  invalidateVectors(workspaceId);
  return { chunks: drafts.length, embedded: fresh.size, reused: drafts.length - toEmbed.length, embedError };
}

function upsertEntity(tx: DB, workspaceId: string, type: (typeof s.entities.$inferInsert)["type"], name: string, companyId: string | null): string {
  const n = normName(name) || name.toLowerCase();
  const found = tx.select().from(s.entities).where(and(eq(s.entities.workspaceId, workspaceId), eq(s.entities.type, type), eq(s.entities.normName, n))).get();
  if (found) return found.id;
  const id = newId("ent");
  tx.insert(s.entities).values({ id, workspaceId, type, name, normName: n, companyId, aliases: [] }).run();
  return id;
}

export function writeGraph(workspaceId: string, companyId: string, c: CanonicalDeal, db: DB = getDb()) {
  db.transaction((tx) => {
    tx.delete(s.relations).where(and(eq(s.relations.workspaceId, workspaceId), eq(s.relations.companyId, companyId))).run();
    const t = tx as unknown as DB;
    const co = upsertEntity(t, workspaceId, "COMPANY", c.identity.name, companyId);
    const rel = (from: string, to: string, type: (typeof s.relations.$inferInsert)["type"], note?: string, sourceRef?: string) =>
      tx.insert(s.relations).values({ id: newId("rel"), workspaceId, fromEntity: from, toEntity: to, type, companyId, note: note ?? null, sourceRef: sourceRef ?? null }).run();
    const people = c.founders.length ? c.founders.map((f) => ({ name: f.name, role: f.role, orgs: f.timeline.map((x) => x.organization) })) : c.foundersFromDeck.map((f) => ({ name: f.name, role: f.role, orgs: f.priorOrganizations }));
    for (const p of people) {
      const pe = upsertEntity(t, workspaceId, "PERSON", p.name, null);
      rel(pe, co, "FOUNDED", p.role);
      for (const o of new Set(p.orgs)) if (o && normName(o) !== normName(c.identity.name)) rel(pe, upsertEntity(t, workspaceId, "COMPANY", o, null), "WORKED_AT");
    }
    for (const comp of c.competition?.competitors ?? []) rel(co, upsertEntity(t, workspaceId, "COMPETITOR", comp.name, null), "COMPETES_WITH", comp.type);
    const investors = [...(c.financing?.existingInvestors ?? []), ...(c.financing?.leadInvestor ? [c.financing.leadInvestor] : [])];
    for (const inv of new Set(investors)) rel(upsertEntity(t, workspaceId, "INVESTOR", inv, null), co, "INVESTED_IN");
    for (const ind of c.classification.industry) rel(co, upsertEntity(t, workspaceId, "MARKET", ind, null), "OPERATES_IN");
    if (c.market?.currentMarket) rel(co, upsertEntity(t, workspaceId, "MARKET", c.market.currentMarket.slice(0, 80), null), "OPERATES_IN");
    for (const cu of c.customers?.namedCustomers ?? []) rel(upsertEntity(t, workspaceId, "CUSTOMER", cu.name, null), co, "CUSTOMER_OF", cu.relationship);
  });
}

export function writeFacts(workspaceId: string, companyId: string, versionId: string, c: CanonicalDeal, db: DB = getDb()) {
  db.transaction((tx) => {
    tx.delete(s.metricFacts).where(eq(s.metricFacts.companyId, companyId)).run();
    for (const m of c.metrics.filter((x) => x.isPrimary)) {
      tx.insert(s.metricFacts)
        .values({
          id: newId("fact"),
          workspaceId,
          companyId,
          versionId,
          metricId: m.id,
          metricKey: m.metricKey,
          value: m.normalizedValue,
          unit: m.unit,
          state: m.state,
          verification: m.verification,
          calculationMethod: m.calculationMethod,
          periodEnd: m.periodEnd,
          sampleSize: m.sampleSize,
          flags: m.qualityFlags,
        })
        .run();
    }
  });
}

export async function indexCompanyForBrain(v: { workspaceId: string; companyId: string; versionId: string; canonical: CanonicalDeal; derived: DerivedAnalysis; cost?: CostController }, db: DB = getDb()) {
  const company = db.select().from(s.companies).where(eq(s.companies.id, v.companyId)).get()!;
  const cost = v.cost ?? new CostController(0.05, 0.05, (e) => repo.recordCost(v.workspaceId, null, "EMBEDDING", e));
  const { pack, tokens } = buildMemoryPack(company, v.versionId, v.canonical, v.derived);
  db.insert(s.memoryPacks)
    .values({ companyId: v.companyId, workspaceId: v.workspaceId, versionId: v.versionId, pack, text: pack.text, tokenEstimate: tokens, updatedAt: nowIso() })
    .onConflictDoUpdate({ target: s.memoryPacks.companyId, set: { versionId: v.versionId, pack, text: pack.text, tokenEstimate: tokens, updatedAt: nowIso() } })
    .run();
  writeFacts(v.workspaceId, v.companyId, v.versionId, v.canonical, db);
  writeGraph(v.workspaceId, v.companyId, v.canonical, db);
  const drafts = companyChunks(company.slug, v.canonical, db);
  drafts.unshift({ kind: "MEMO", refId: "memory-pack", title: `${v.canonical.identity.name} — deal memory`, text: pack.text.slice(0, 8000), href: `/deals/${company.slug}`, evidenceLabel: null });
  const res = await writeChunks(v.workspaceId, v.companyId, v.versionId, drafts, cost, db);
  return { ...res, facts: v.canonical.metrics.filter((m) => m.isPrimary).length, packTokens: tokens };
}

/** Re-index fund knowledge, IC members/observations and meetings (workspace-level memory). */
export async function indexFundMemory(workspaceId: string, db: DB = getDb()) {
  const cost = new CostController(0.05, 0.05, (e) => repo.recordCost(workspaceId, null, "EMBEDDING", e));
  const drafts: ChunkDraft[] = [];
  for (const k of db.select().from(s.fundKnowledge).where(eq(s.fundKnowledge.workspaceId, workspaceId)).all())
    drafts.push({ kind: "FUND_KNOWLEDGE", refId: k.id, title: `Fund ${k.kind.toLowerCase()}: ${k.title} [${k.provenance}]`, text: k.body, href: `/fund#${k.id}`, evidenceLabel: k.provenance });
  const members = db.select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all();
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const m of members) {
    upsertEntity(db, workspaceId, "IC_MEMBER", m.name, null);
    if (m.documentedPreferences)
      drafts.push({ kind: "FUND_KNOWLEDGE", refId: m.id, title: `IC member ${m.name} — documented preferences [DOCUMENTED]`, text: `${m.name} (${m.role}). ${m.bio ?? ""} Focus: ${m.focus.join(", ")}. Documented preferences: ${m.documentedPreferences}`, href: `/fund/ic#${m.id}`, evidenceLabel: "DOCUMENTED" });
  }
  for (const o of db.select().from(s.icObservations).where(eq(s.icObservations.workspaceId, workspaceId)).all()) {
    const m = byId.get(o.memberId);
    drafts.push({
      kind: "IC_OBSERVATION",
      refId: o.id,
      title: `${m?.name ?? "IC member"} — ${o.kind.toLowerCase()} [${o.provenance}] ${o.observedAt.slice(0, 10)}`,
      text: `${o.statement}${o.quote ? ` Quote: "${o.quote}"` : ""}${o.topic ? ` Topic: ${o.topic}` : ""}`,
      href: `/fund/ic#${o.memberId}`,
      evidenceLabel: o.provenance,
    });
  }
  for (const mt of db.select().from(s.meetings).where(eq(s.meetings.workspaceId, workspaceId)).all()) {
    const body = [mt.notes, mt.transcript].filter(Boolean).join("\n\n");
    // Long transcripts are split into ~3k character windows.
    for (let i = 0, part = 1; i < body.length; i += 3000, part++)
      drafts.push({ kind: "MEETING", refId: `${mt.id}#${part}`, title: `${mt.kind} ${mt.heldAt.slice(0, 10)} — ${mt.title} (part ${part}) [OBSERVED]`, text: body.slice(i, i + 3000), href: `/fund/meetings#${mt.id}`, evidenceLabel: "OBSERVED" });
  }
  return writeChunks(workspaceId, null, null, drafts, cost, db, ["FUND_KNOWLEDGE", "IC_OBSERVATION", "MEETING"]);
}

export { fmtMetric, metricDef };
