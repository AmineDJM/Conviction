/**
 * Repository layer. Every query is scoped by workspaceId (§116 isolation).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { CanonicalDeal } from "@/domain/canonical";
import { DEFAULT_FUND_PROFILE, FundProfile } from "@/domain/fund";
import type { DerivedAnalysis } from "@/engine/derive";
import { newId, normName, nowIso, slugify } from "./ids";
import type { CostEntry } from "@/ai/cost";

const s = schema;

export type CompanyRow = typeof s.companies.$inferSelect;
export type VersionRow = typeof s.companyVersions.$inferSelect;
export type RunRow = typeof s.analysisRuns.$inferSelect;
export type VersionReason = VersionRow["reason"];
export type HistoryType = (typeof s.historyEvents.$inferInsert)["type"];

/* ------------------------------ Funds ------------------------------ */

export function getDefaultFund(workspaceId: string, db: DB = getDb()): FundProfile {
  const row = db.select().from(s.funds).where(and(eq(s.funds.workspaceId, workspaceId), eq(s.funds.isDefault, true))).get();
  if (!row) return DEFAULT_FUND_PROFILE;
  const parsed = FundProfile.safeParse(row.profile);
  return parsed.success ? parsed.data : DEFAULT_FUND_PROFILE;
}

export function upsertDefaultFund(workspaceId: string, profile: FundProfile, db: DB = getDb()) {
  const existing = db.select().from(s.funds).where(and(eq(s.funds.workspaceId, workspaceId), eq(s.funds.isDefault, true))).get();
  const valid = FundProfile.parse(profile);
  if (existing) {
    db.update(s.funds).set({ profile: valid, name: valid.name, updatedAt: nowIso() }).where(eq(s.funds.id, existing.id)).run();
    return existing.id;
  }
  const id = valid.id === "default" ? newId("fund") : valid.id;
  db.insert(s.funds).values({ id, workspaceId, name: valid.name, profile: { ...valid, id }, isDefault: true, updatedAt: nowIso() }).run();
  return id;
}

/* ------------------------------ Companies ------------------------------ */

export function createCompany(workspaceId: string, name: string, db: DB = getDb()): CompanyRow {
  const id = newId("co");
  let slug = slugify(name);
  const clash = db.select({ n: sql<number>`count(*)` }).from(s.companies).where(and(eq(s.companies.workspaceId, workspaceId), sql`${s.companies.slug} like ${slug + "%"}`)).get();
  if (clash && clash.n > 0) slug = `${slug}-${id.slice(-4)}`;
  const row = {
    id,
    workspaceId,
    name,
    normName: normName(name),
    slug,
    status: "PROCESSING" as const,
    icDecision: "PENDING",
    executionStatus: "NOT_STARTED",
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  db.insert(s.companies).values(row).run();
  return db.select().from(s.companies).where(eq(s.companies.id, id)).get()!;
}

export function getCompany(workspaceId: string, idOrSlug: string, db: DB = getDb()): CompanyRow | undefined {
  return db
    .select()
    .from(s.companies)
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt), sql`(${s.companies.id} = ${idOrSlug} or ${s.companies.slug} = ${idOrSlug})`))
    .get();
}

export function listCompanies(workspaceId: string, db: DB = getDb()): CompanyRow[] {
  return db
    .select()
    .from(s.companies)
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)))
    .orderBy(desc(s.companies.updatedAt))
    .all();
}

/** Once the model has identified the company, replace the filename-based slug with the real name. */
export function renameFromIdentity(companyId: string, name: string, db: DB = getDb()) {
  const c = db.select().from(s.companies).where(eq(s.companies.id, companyId)).get();
  if (!c || !name.trim() || c.currentVersionId) return;
  let slug = slugify(name);
  const clash = db.select({ id: s.companies.id }).from(s.companies).where(and(eq(s.companies.workspaceId, c.workspaceId), eq(s.companies.slug, slug))).get();
  if (clash && clash.id !== companyId) slug = `${slug}-${companyId.slice(-4)}`;
  db.update(s.companies).set({ name, normName: normName(name), slug }).where(eq(s.companies.id, companyId)).run();
}

export function setCompanyStatus(companyId: string, status: CompanyRow["status"], db: DB = getDb()) {
  db.update(s.companies).set({ status, updatedAt: nowIso() }).where(eq(s.companies.id, companyId)).run();
}

/* ------------------------------ Versions ------------------------------ */

export interface LoadedVersion {
  row: VersionRow;
  canonical: CanonicalDeal;
  derived: DerivedAnalysis;
}

export function loadVersion(row: VersionRow): LoadedVersion {
  return { row, canonical: CanonicalDeal.parse(row.canonical), derived: row.derived as DerivedAnalysis };
}

export function getCurrentVersion(company: CompanyRow, db: DB = getDb()): LoadedVersion | null {
  if (!company.currentVersionId) return null;
  const row = db.select().from(s.companyVersions).where(eq(s.companyVersions.id, company.currentVersionId)).get();
  return row ? loadVersion(row) : null;
}

export function getVersion(companyId: string, versionId: string, db: DB = getDb()): LoadedVersion | null {
  const row = db.select().from(s.companyVersions).where(and(eq(s.companyVersions.companyId, companyId), eq(s.companyVersions.id, versionId))).get();
  return row ? loadVersion(row) : null;
}

export function listVersions(companyId: string, db: DB = getDb()) {
  return db
    .select({
      id: s.companyVersions.id,
      versionNo: s.companyVersions.versionNo,
      reason: s.companyVersions.reason,
      summary: s.companyVersions.summary,
      registryId: s.companyVersions.registryId,
      runId: s.companyVersions.runId,
      createdAt: s.companyVersions.createdAt,
    })
    .from(s.companyVersions)
    .where(eq(s.companyVersions.companyId, companyId))
    .orderBy(desc(s.companyVersions.versionNo))
    .all();
}

export interface SaveVersionInput {
  company: CompanyRow;
  canonical: CanonicalDeal;
  derived: DerivedAnalysis;
  reason: VersionReason;
  runId?: string | null;
  summary?: string;
  userId?: string | null;
  /** Preliminary versions do not flip the company to READY. */
  preliminary?: boolean;
}

export function saveVersion(input: SaveVersionInput, db: DB = getDb()): VersionRow {
  const canonical = CanonicalDeal.parse(input.canonical); // never persist an invalid canonical object
  const last = db
    .select({ n: sql<number>`coalesce(max(${s.companyVersions.versionNo}), 0)` })
    .from(s.companyVersions)
    .where(eq(s.companyVersions.companyId, input.company.id))
    .get();
  const versionNo = (last?.n ?? 0) + 1;
  const id = newId("ver");
  const row = {
    id,
    companyId: input.company.id,
    versionNo,
    runId: input.runId ?? null,
    registryId: input.derived.registryId,
    fundProfileId: input.derived.fundProfileId,
    canonical,
    derived: input.derived,
    reason: input.reason,
    summary: input.summary ?? null,
    createdBy: input.userId ?? null,
    createdAt: nowIso(),
  };
  db.transaction((tx) => {
    tx.insert(s.companyVersions).values(row).run();
    tx.update(s.companies).set(projection(canonical, input.derived, id, input.preliminary)).where(eq(s.companies.id, input.company.id)).run();
  });
  return db.select().from(s.companyVersions).where(eq(s.companyVersions.id, id)).get()!;
}

function projection(c: CanonicalDeal, d: DerivedAnalysis, versionId: string, preliminary?: boolean) {
  const base = d.returns.scenarios.find((x) => x.scenario === "BASE");
  return {
    currentVersionId: versionId,
    name: c.identity.name,
    normName: normName(c.identity.name),
    oneLiner: c.identity.oneLiner,
    sector: c.classification.industry[0] ?? null,
    stage: c.classification.financingStage,
    country: c.identity.hqCountry,
    peerGroup: d.peerGroup.name,
    decisionStatus: preliminary ? null : d.recommendation.status,
    icDecision: c.icDecision,
    executionStatus: c.executionStatus,
    exceptionalStrength: c.exceptionalStrengths[0]?.claim ?? null,
    oqi: d.operatingQuality.value,
    oqiLower: d.operatingQuality.lower,
    oqiUpper: d.operatingQuality.upper,
    oqiCoverage: d.operatingQuality.coverage,
    evidence: d.evidence.category,
    evidenceIndex: d.evidence.index,
    powerLaw: d.powerLaw.value,
    riskHeadline: d.risk.headline,
    riskIndex: d.risk.filterIndex,
    fundFit: d.fundFit.index,
    mandate: d.fundFit.mandate,
    roundUsd: d.returns.inputs.entry.raiseUsd,
    postMoneyUsd: d.returns.inputs.entry.postMoneyUsd,
    baseMoic: base?.grossMoic ?? null,
    analysisDepth: c.analysis.depth,
    analysisMode: c.analysis.mode,
    ...(preliminary ? {} : { status: "READY" as const }),
    updatedAt: nowIso(),
  };
}

/* ------------------------------ Runs & cost ------------------------------ */

export function createRun(
  v: { workspaceId: string; companyId: string; mode: RunRow["mode"]; kind?: RunRow["kind"]; model: string; promptVersions: Record<string, string>; registryId: string; budgetUsd: number; steps: { step: string; label: string }[] },
  db: DB = getDb(),
): RunRow {
  const id = newId("run");
  db.insert(s.analysisRuns)
    .values({
      id,
      workspaceId: v.workspaceId,
      companyId: v.companyId,
      mode: v.mode,
      kind: v.kind ?? "DECK",
      status: "QUEUED",
      model: v.model,
      promptVersions: v.promptVersions,
      registryId: v.registryId,
      budgetUsd: v.budgetUsd,
      progress: v.steps.map((x) => ({ ...x, status: "PENDING", at: nowIso() })),
      startedAt: nowIso(),
    })
    .run();
  return db.select().from(s.analysisRuns).where(eq(s.analysisRuns.id, id)).get()!;
}

export function updateRunStep(runId: string, step: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string, db: DB = getDb()) {
  const run = db.select().from(s.analysisRuns).where(eq(s.analysisRuns.id, runId)).get();
  if (!run) return;
  const progress = run.progress.map((p) => (p.step === step ? { ...p, status, at: nowIso(), ...(detail ? { detail } : {}) } : p));
  db.update(s.analysisRuns).set({ progress, status: "RUNNING" }).where(eq(s.analysisRuns.id, runId)).run();
}

export function finishRun(runId: string, status: RunRow["status"], spentUsd: number, depth: string | null, error?: string, db: DB = getDb()) {
  db.update(s.analysisRuns).set({ status, spentUsd, depth, error: error ?? null, finishedAt: nowIso() }).where(eq(s.analysisRuns.id, runId)).run();
}

export function getRun(workspaceId: string, runId: string, db: DB = getDb()) {
  return db.select().from(s.analysisRuns).where(and(eq(s.analysisRuns.workspaceId, workspaceId), eq(s.analysisRuns.id, runId))).get();
}

export function latestRun(companyId: string, db: DB = getDb()) {
  return db.select().from(s.analysisRuns).where(eq(s.analysisRuns.companyId, companyId)).orderBy(desc(s.analysisRuns.startedAt)).get();
}

export function recordCost(workspaceId: string, runId: string | null, scope: "ANALYSIS" | "CHAT" | "EMBEDDING", e: CostEntry, db: DB = getDb()) {
  db.insert(s.costRecords)
    .values({
      id: newId("cost"),
      workspaceId,
      runId,
      scope,
      step: e.step,
      model: e.model,
      promptVersion: e.promptVersion,
      inputTokens: e.usage.inputTokens,
      cachedTokens: e.usage.cachedTokens,
      outputTokens: e.usage.outputTokens,
      reasoningTokens: e.usage.reasoningTokens,
      webSearches: e.usage.webSearches,
      toolCalls: e.toolCalls,
      estimatedUsd: e.estimatedUsd,
      actualUsd: e.actualUsd,
      latencyMs: e.latencyMs,
      createdAt: nowIso(),
    })
    .run();
  if (runId) db.update(s.analysisRuns).set({ spentUsd: sql`${s.analysisRuns.spentUsd} + ${e.actualUsd}` }).where(eq(s.analysisRuns.id, runId)).run();
}

export function costRecordsForRun(runId: string, db: DB = getDb()) {
  return db.select().from(s.costRecords).where(eq(s.costRecords.runId, runId)).all();
}

export function costSummary(workspaceId: string, db: DB = getDb()) {
  return db
    .select({
      mode: s.analysisRuns.mode,
      runs: sql<number>`count(*)`,
      avgUsd: sql<number>`avg(${s.analysisRuns.spentUsd})`,
      maxUsd: sql<number>`max(${s.analysisRuns.spentUsd})`,
    })
    .from(s.analysisRuns)
    .where(and(eq(s.analysisRuns.workspaceId, workspaceId), eq(s.analysisRuns.kind, "DECK")))
    .groupBy(s.analysisRuns.mode)
    .all();
}

/* ------------------------------ Documents ------------------------------ */

export function saveDocument(
  v: { workspaceId: string; companyId: string; filename: string; mime: string; kind: typeof s.documents.$inferInsert.kind; sizeBytes: number; sha256: string; storagePath: string; pages: { pageNo: number; text: string }[] },
  db: DB = getDb(),
) {
  const id = newId("doc");
  db.transaction((tx) => {
    tx.insert(s.documents)
      .values({
        id,
        workspaceId: v.workspaceId,
        companyId: v.companyId,
        filename: v.filename,
        mime: v.mime,
        kind: v.kind,
        sizeBytes: v.sizeBytes,
        sha256: v.sha256,
        storagePath: v.storagePath,
        pages: v.pages.length,
        textChars: v.pages.reduce((a, p) => a + p.text.length, 0),
        createdAt: nowIso(),
      })
      .run();
    for (const p of v.pages) tx.insert(s.documentPages).values({ id: newId("pg"), documentId: id, companyId: v.companyId, pageNo: p.pageNo, text: p.text }).run();
  });
  return id;
}

export function listDocuments(companyId: string, db: DB = getDb()) {
  return db.select().from(s.documents).where(eq(s.documents.companyId, companyId)).all();
}

export function getDocumentPages(documentId: string, db: DB = getDb()) {
  return db.select().from(s.documentPages).where(eq(s.documentPages.documentId, documentId)).orderBy(s.documentPages.pageNo).all();
}

/* ------------------------------ History & audit ------------------------------ */

export function addHistory(
  v: { workspaceId: string; companyId: string; type: HistoryType; summary: string; versionId?: string | null; payload?: unknown; userId?: string | null },
  db: DB = getDb(),
) {
  db.insert(s.historyEvents)
    .values({
      id: newId("hist"),
      workspaceId: v.workspaceId,
      companyId: v.companyId,
      versionId: v.versionId ?? null,
      type: v.type,
      summary: v.summary,
      payload: (v.payload ?? null) as never,
      actorUserId: v.userId ?? null,
      createdAt: nowIso(),
    })
    .run();
}

export function listHistory(companyId: string, db: DB = getDb()) {
  return db.select().from(s.historyEvents).where(eq(s.historyEvents.companyId, companyId)).orderBy(desc(s.historyEvents.createdAt)).all();
}

export function audit(workspaceId: string, userId: string | null, action: string, target?: string, detail?: string, db: DB = getDb()) {
  db.insert(s.auditLog).values({ id: newId("aud"), workspaceId, userId, action, target: target ?? null, detail: detail ?? null, createdAt: nowIso() }).run();
}
