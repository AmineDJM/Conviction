/**
 * Full workspace export (portability, exit, audit).
 *
 * ZIP layout
 *   manifest.json                 format, exported_at, schema/migration versions, counts, files
 *   workspace.json, members.json  workspace and members (never password hashes or sessions)
 *   tables/<table>.json           every workspace-scoped table (chunks without embeddings)
 *   documents/<company>/<file>    original uploaded documents, decrypted
 *
 * Built in memory with a size guard (EXPORT_MAX_BYTES, default 400 MB).
 */
import JSZip from "jszip";
import fs from "node:fs";
import path from "node:path";
import { eq, getTableColumns, inArray } from "drizzle-orm";
import { getDb, schema as s, type DB } from "@/db/client";
import { readStoredFile } from "./storage";

export const EXPORT_FORMAT = "conviction-export/1";

export class ExportTooLargeError extends Error {}

export interface ExportManifest {
  format: string;
  exported_at: string;
  exported_by: string | null;
  workspace: { id: string; name: string };
  schema: { migrations_applied: number; latest_migration: string | null; journal: string[] };
  counts: Record<string, number>;
  documents: { included: boolean; files: number; bytes: number; missing: { documentId: string; storagePath: string; error: string }[] };
  notes: string[];
}

function inChunks<T>(ids: string[], fn: (batch: string[]) => T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 500) out.push(...fn(ids.slice(i, i + 500)));
  return out;
}

function schemaInfo(db: DB) {
  let journal: string[] = [];
  try {
    journal = (JSON.parse(fs.readFileSync(path.join(process.cwd(), "drizzle", "meta", "_journal.json"), "utf8")) as { entries: { tag: string }[] }).entries.map((e) => e.tag);
  } catch {
    /* journal unavailable */
  }
  const row = db.$client.prepare("select count(*) as n from __drizzle_migrations").get() as { n: number } | undefined;
  const applied = row?.n ?? 0;
  return { migrations_applied: applied, latest_migration: journal[applied - 1] ?? null, journal };
}

/** Collect every workspace-scoped table. */
export function exportTables(workspaceId: string, db: DB = getDb()): Record<string, unknown[]> {
  const companies = db.select().from(s.companies).where(eq(s.companies.workspaceId, workspaceId)).all();
  const companyIds = companies.map((c) => c.id);
  const documents = db.select().from(s.documents).where(eq(s.documents.workspaceId, workspaceId)).all();
  const docIds = documents.map((d) => d.id);
  const threads = db.select().from(s.chatThreads).where(eq(s.chatThreads.workspaceId, workspaceId)).all();
  const threadIds = threads.map((t) => t.id);
  const { embedding, ...chunkCols } = getTableColumns(s.chunks); // embeddings are not portable data
  void embedding;
  return {
    funds: db.select().from(s.funds).where(eq(s.funds.workspaceId, workspaceId)).all(),
    companies,
    company_versions: inChunks(companyIds, (b) => db.select().from(s.companyVersions).where(inArray(s.companyVersions.companyId, b)).all()),
    documents,
    document_pages: inChunks(docIds, (b) => db.select().from(s.documentPages).where(inArray(s.documentPages.documentId, b)).all()),
    analysis_runs: db.select().from(s.analysisRuns).where(eq(s.analysisRuns.workspaceId, workspaceId)).all(),
    cost_records: db.select().from(s.costRecords).where(eq(s.costRecords.workspaceId, workspaceId)).all(),
    history_events: db.select().from(s.historyEvents).where(eq(s.historyEvents.workspaceId, workspaceId)).all(),
    reports: inChunks(companyIds, (b) => db.select().from(s.reports).where(inArray(s.reports.companyId, b)).all()),
    fund_knowledge: db.select().from(s.fundKnowledge).where(eq(s.fundKnowledge.workspaceId, workspaceId)).all(),
    ic_members: db.select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all(),
    ic_observations: db.select().from(s.icObservations).where(eq(s.icObservations.workspaceId, workspaceId)).all(),
    meetings: db.select().from(s.meetings).where(eq(s.meetings.workspaceId, workspaceId)).all(),
    chat_threads: threads,
    chat_messages: inChunks(threadIds, (b) => db.select().from(s.chatMessages).where(inArray(s.chatMessages.threadId, b)).all()),
    memory_packs: db.select().from(s.memoryPacks).where(eq(s.memoryPacks.workspaceId, workspaceId)).all(),
    metric_facts: db.select().from(s.metricFacts).where(eq(s.metricFacts.workspaceId, workspaceId)).all(),
    entities: db.select().from(s.entities).where(eq(s.entities.workspaceId, workspaceId)).all(),
    relations: db.select().from(s.relations).where(eq(s.relations.workspaceId, workspaceId)).all(),
    chunks: db.select(chunkCols).from(s.chunks).where(eq(s.chunks.workspaceId, workspaceId)).all(),
    audit_log: db.select().from(s.auditLog).where(eq(s.auditLog.workspaceId, workspaceId)).all(),
  };
}

function safeName(v: string) {
  return v.replace(/[^a-zA-Z0-9_. -]/g, "_").slice(0, 120) || "file";
}

export interface BuildExportOptions {
  includeFiles?: boolean;
  exportedBy?: string | null;
  maxBytes?: number;
  db?: DB;
}

export async function buildExport(workspaceId: string, opts: BuildExportOptions = {}): Promise<{ zip: JSZip; manifest: ExportManifest; filename: string }> {
  const db = opts.db ?? getDb();
  const maxBytes = opts.maxBytes ?? Number(process.env.EXPORT_MAX_BYTES ?? 400 * 1024 * 1024);
  const includeFiles = opts.includeFiles ?? true;
  const ws = db.select().from(s.workspaces).where(eq(s.workspaces.id, workspaceId)).get();
  if (!ws) throw new Error("Workspace not found");
  const members = db
    .select({ userId: s.users.id, email: s.users.email, name: s.users.name, role: s.memberships.role, createdAt: s.users.createdAt })
    .from(s.memberships)
    .innerJoin(s.users, eq(s.users.id, s.memberships.userId))
    .where(eq(s.memberships.workspaceId, workspaceId))
    .all();

  const tables = exportTables(workspaceId, db);
  const zip = new JSZip();
  let bytes = 0;
  const guard = (n: number) => {
    bytes += n;
    if (bytes > maxBytes) throw new ExportTooLargeError(`Export exceeds ${Math.round(maxBytes / 1e6)} MB${includeFiles ? " — retry without original files (?files=0)" : ""}`);
  };
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(tables)) {
    const json = JSON.stringify(rows, null, 1);
    guard(json.length);
    zip.file(`tables/${name}.json`, json);
    counts[name] = rows.length;
  }
  zip.file("workspace.json", JSON.stringify({ id: ws.id, name: ws.name, createdAt: ws.createdAt }, null, 2));
  zip.file("members.json", JSON.stringify(members, null, 2));

  const docInfo: ExportManifest["documents"] = { included: includeFiles, files: 0, bytes: 0, missing: [] };
  if (includeFiles) {
    const slugs = new Map((tables.companies as { id: string; slug: string }[]).map((c) => [c.id, c.slug]));
    const docs = tables.documents as (typeof s.documents.$inferSelect)[];
    guard(docs.reduce((a, d) => a + d.sizeBytes, 0)); // refuse early, before reading anything
    bytes -= docs.reduce((a, d) => a + d.sizeBytes, 0);
    for (const d of docs) {
      try {
        const data = await readStoredFile(d.storagePath);
        guard(data.length);
        zip.file(`documents/${safeName(slugs.get(d.companyId) ?? d.companyId)}/${d.id}-${safeName(d.filename)}`, data, { binary: true });
        docInfo.files++;
        docInfo.bytes += data.length;
      } catch (e) {
        if (e instanceof ExportTooLargeError) throw e;
        docInfo.missing.push({ documentId: d.id, storagePath: d.storagePath, error: (e as Error).message });
      }
    }
  }

  const manifest: ExportManifest = {
    format: EXPORT_FORMAT,
    exported_at: new Date().toISOString(),
    exported_by: opts.exportedBy ?? null,
    workspace: { id: ws.id, name: ws.name },
    schema: schemaInfo(db),
    counts: { members: members.length, ...counts },
    documents: docInfo,
    notes: [
      "Rows are JSON with camelCase column names; JSON columns are parsed.",
      "chunks are exported without embeddings (re-computable from text).",
      "members.json never contains password hashes or sessions.",
      "Original documents are decrypted in this archive — store it encrypted.",
    ],
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  const filename = `conviction-export-${safeName(ws.name).replace(/\s+/g, "-").toLowerCase()}-${manifest.exported_at.slice(0, 10)}.zip`;
  return { zip, manifest, filename };
}
