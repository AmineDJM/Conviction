/**
 * Duplicate companies: detection, the user's answer, and merging.
 *
 * Nothing is merged silently. Detection (engine/company-match.ts) only produces
 * suggestions; the user either confirms "different company" (remembered on both
 * sides) or merges. A merge re-analyses the duplicate's documents on the target
 * company as its next deck version (same code path as uploading a new deck
 * version there: deck lineage, stage, carried and re-anchored overrides, a new
 * immutable version). The duplicate is soft-deleted with `merged_into_id` — its
 * versions, documents and history stay for audit, its slug redirects to the
 * target — and its Fund Brain memory is removed so chat never sees two dossiers.
 */
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { applyOverrides } from "@/engine/overrides";
import { matchCompanies, nameFromFilename, registrableDomain, type CompanyCandidate, type CompanyMatch } from "@/engine/company-match";
import { invalidateVectors } from "@/brain/vectors";
import { cancelRun } from "@/orchestration/run-control";
import type { AnalysisMode } from "@/domain/enums";
import * as repo from "./repo";
import { readStoredFile } from "./storage";
import { AnalysisRequestError, recordDistinct, startAnalysis } from "./analyze";

const s = schema;

/** Live companies as match candidates. Rows projected before identity columns existed are read from their current version. */
function candidates(workspaceId: string, exclude: string | null, db: DB = getDb()): (CompanyCandidate & { createdAt: string; slug: string })[] {
  return repo
    .listCompanyIdentities(workspaceId, db)
    .filter((c) => c.id !== exclude)
    .map((c) => {
      let domain = c.websiteDomain;
      let founders = c.founderNames;
      if (founders === null && c.currentVersionId) {
        const row = repo.getCompany(workspaceId, c.id, db);
        const v = row ? repo.getCurrentVersion(row, db) : null;
        if (v) {
          const eff = applyOverrides(v.canonical);
          domain = registrableDomain(eff.identity.website);
          founders = (eff.founders.length ? eff.founders : eff.foundersFromDeck).map((f) => f.name);
        }
      }
      return { id: c.id, name: c.name, domain, founders: founders ?? [], createdAt: c.createdAt, slug: c.slug };
    });
}

/** Company ids the user confirmed as different from `companyId`. */
export function distinctFrom(companyId: string, db: DB = getDb()): Set<string> {
  const out = new Set<string>();
  for (const h of repo.listHistory(companyId, db)) if (h.type === "DUPLICATE_DISMISSED") out.add(String((h.payload as { otherCompanyId?: string } | null)?.otherCompanyId ?? ""));
  return out;
}

export interface DuplicateSuggestion extends CompanyMatch {
  slug: string;
}

/**
 * After triage (identity known): companies this one may duplicate. Shown on the NEWER
 * company only, so a merge always folds the newer dossier into the older one.
 */
export function duplicateSuggestions(workspaceId: string, companyId: string, db: DB = getDb()): DuplicateSuggestion[] {
  const company = repo.getCompany(workspaceId, companyId, db);
  const v = company ? repo.getCurrentVersion(company, db) : null;
  if (!company || !v) return [];
  const eff = applyOverrides(v.canonical);
  const dismissed = distinctFrom(company.id, db);
  const pool = candidates(workspaceId, company.id, db).filter((c) => !dismissed.has(c.id) && c.createdAt <= company.createdAt);
  const bySlug = new Map(pool.map((c) => [c.id, c.slug]));
  return matchCompanies({ name: eff.identity.name, nameSource: "IDENTITY", website: eff.identity.website, founders: (eff.founders.length ? eff.founders : eff.foundersFromDeck).map((f) => f.name) }, pool).map((m) => ({ ...m, slug: bySlug.get(m.companyId)! }));
}

/** Before an upload starts: the name (typed, else from the file name) and URL against existing companies. */
export function uploadMatches(workspaceId: string, probe: { name?: string | null; url?: string | null; filenames: string[] }, db: DB = getDb()): DuplicateSuggestion[] {
  const typed = probe.name?.trim() || null;
  const fromFile = typed ? null : (probe.filenames.map(nameFromFilename).find((n) => n) ?? null);
  const pool = candidates(workspaceId, null, db);
  const bySlug = new Map(pool.map((c) => [c.id, c.slug]));
  return matchCompanies({ name: typed ?? fromFile, nameSource: typed ? "USER" : "FILENAME", website: probe.url?.trim() || null, founders: [] }, pool).map((m) => ({ ...m, slug: bySlug.get(m.companyId)! }));
}

export function dismissDuplicate(workspaceId: string, userId: string | null, companyId: string, otherId: string) {
  recordDistinct(workspaceId, userId, companyId, otherId, "duplicate prompt");
}

/** Removes a company's Fund Brain memory (pack, facts, graph, chunks). Its versions and documents are untouched. */
function forgetCompanyMemory(workspaceId: string, companyId: string, db: DB) {
  db.transaction((tx) => {
    tx.delete(s.chunks).where(and(eq(s.chunks.workspaceId, workspaceId), eq(s.chunks.companyId, companyId))).run();
    tx.delete(s.relations).where(and(eq(s.relations.workspaceId, workspaceId), eq(s.relations.companyId, companyId))).run();
    tx.delete(s.entities).where(and(eq(s.entities.workspaceId, workspaceId), eq(s.entities.companyId, companyId))).run();
    tx.delete(s.metricFacts).where(eq(s.metricFacts.companyId, companyId)).run();
    tx.delete(s.memoryPacks).where(eq(s.memoryPacks.companyId, companyId)).run();
  });
  invalidateVectors(workspaceId);
}

/**
 * Merges `sourceId` (the duplicate) into `targetId` as the target's next deck version.
 * The source's documents (those its current version read) are re-analysed on the target.
 */
export async function mergeIntoCompany(v: { workspaceId: string; userId: string | null; sourceId: string; targetId: string; mode?: AnalysisMode }) {
  const db = getDb();
  const source = repo.getCompany(v.workspaceId, v.sourceId, db);
  const target = repo.getCompany(v.workspaceId, v.targetId, db);
  if (!source || !target) throw new AnalysisRequestError("Company not found", 404);
  if (source.id === target.id) throw new AnalysisRequestError("A company cannot be merged into itself", 400);
  const tRun = repo.latestRun(target.id, db);
  if (tRun && (tRun.status === "RUNNING" || tRun.status === "QUEUED")) throw new AnalysisRequestError(`An analysis is running for ${target.name}. Merge when it completes.`, 409);

  const current = repo.getCurrentVersion(source, db);
  const docIds = new Set((current?.canonical.documents ?? []).map((d) => d.id));
  const stored = repo.listDocuments(source.id, db).filter((d) => (docIds.size ? docIds.has(d.id) : ["PDF", "PPTX", "IMAGE", "TEXT"].includes(d.kind)));
  if (!stored.length) throw new AnalysisRequestError(`${source.name} has no documents to merge`, 400);
  // The deck goes first so it is the one recorded as the new deck version.
  const deckFirst = [...stored].sort((a, b) => (b.deckVersion ?? 0) - (a.deckVersion ?? 0) || a.createdAt.localeCompare(b.createdAt));
  // Same bytes as stored (re-extracted on the target); a file whose hash changed is refused.
  const bytes = await Promise.all(
    deckFirst.map(async (d) => {
      const buf = await readStoredFile(d.storagePath);
      if (createHash("sha256").update(buf).digest("hex") !== d.sha256) throw new AnalysisRequestError(`Stored file for ${d.filename} does not match its recorded hash`, 409);
      return buf;
    }),
  );
  // The duplicate's run (if still going) is cancelled: its result would be discarded anyway.
  const sRun = repo.latestRun(source.id, db);
  if (sRun && (sRun.status === "RUNNING" || sRun.status === "QUEUED")) cancelRun(sRun.id);
  const started = await startAnalysis({
    workspaceId: v.workspaceId,
    userId: v.userId,
    mode: v.mode ?? (current?.canonical.analysis.mode ?? "STANDARD"),
    files: deckFirst.map((d, i) => ({ filename: d.filename, mime: d.mime, data: bytes[i]! })),
    target: { companyId: target.id, intent: "NEW_DECK_VERSION" },
    mergedFrom: { companyId: source.id, name: source.name },
  });

  repo.markCompanyMerged(source.id, target.id, db);
  forgetCompanyMemory(v.workspaceId, source.id, db);
  const as = started.deckVersion ? `as deck v${started.deckVersion}` : "(its documents were already on record here)";
  repo.addHistory({ workspaceId: v.workspaceId, companyId: source.id, type: "COMPANY_MERGED", summary: `Merged into ${target.name} ${as}. This dossier is kept for audit and redirects there.`, payload: { targetId: target.id, runId: started.run.id }, userId: v.userId });
  repo.addHistory({ workspaceId: v.workspaceId, companyId: target.id, type: "COMPANY_MERGED", summary: `${source.name} merged in ${as}`, payload: { sourceId: source.id, runId: started.run.id }, userId: v.userId });
  repo.audit(v.workspaceId, v.userId, "COMPANY_MERGED", target.id, `${source.id} → ${target.id}`);
  return started;
}
