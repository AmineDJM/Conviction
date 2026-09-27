/**
 * Backup primitives shared by the database client (pre-migration snapshot)
 * and src/server/backup.ts (scheduled / manual backups). No dependency on the
 * client module, so it can run while the connection is being opened.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type BackupReason = "daily" | "manual" | "pre-migration" | "pre-restore";

/** Tables whose row counts are recorded with every backup and compared on restore. */
export const KEY_TABLES = [
  "users",
  "workspaces",
  "memberships",
  "companies",
  "company_versions",
  "documents",
  "document_pages",
  "analysis_runs",
  "history_events",
  "metric_facts",
  "memory_packs",
  "chunks",
  "fund_knowledge",
  "audit_log",
] as const;

export interface BackupMeta {
  file: string;
  reason: BackupReason;
  createdAt: string;
  sizeBytes: number;
  integrity: string;
  counts: Record<string, number>;
  migrations: { applied: number; latestTag: string | null };
  detail?: string;
  remote?: { key: string; uploadedAt: string } | { error: string };
}

export function backupDirFor(dbPath: string) {
  return process.env.BACKUP_DIR?.trim() || path.join(path.dirname(path.resolve(dbPath)), "backups");
}

/** conviction-2026-09-27T22-40-05-123Z.db (colons and dots replaced so the name is portable). */
export function backupFileName(now = new Date()) {
  return `conviction-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

export function uniqueBackupPath(dir: string, now = new Date()) {
  let file = path.join(dir, backupFileName(now));
  for (let i = 1; fs.existsSync(file) || fs.existsSync(`${file}.partial`); i++) file = path.join(dir, backupFileName(now).replace(/\.db$/, `-${i}.db`));
  return file;
}

export function metaPath(file: string) {
  return `${file}.json`;
}

export function writeMeta(meta: BackupMeta) {
  const tmp = `${metaPath(meta.file)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2));
  fs.renameSync(tmp, metaPath(meta.file));
}

export function readMeta(file: string): BackupMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(file), "utf8")) as BackupMeta;
  } catch {
    return null;
  }
}

export interface Verification {
  ok: boolean;
  integrity: string;
  counts: Record<string, number>;
  migrations: { applied: number; latestTag: string | null };
  error?: string;
}

function journal(migrationsFolder: string): { tag: string; when: number }[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: { tag: string; when: number }[] };
    return j.entries;
  } catch {
    return [];
  }
}

function tableExists(db: Database.Database, name: string) {
  return !!db.prepare("select 1 from sqlite_master where type in ('table','view') and name = ?").get(name);
}

function appliedMigrations(db: Database.Database, migrationsFolder: string) {
  if (!tableExists(db, "__drizzle_migrations")) return { applied: 0, lastMillis: null as number | null, latestTag: null as string | null };
  const row = db.prepare("select count(*) as n, max(created_at) as last from __drizzle_migrations").get() as { n: number; last: number | string | null };
  const lastMillis = row.last === null ? null : Number(row.last);
  const latestTag = lastMillis === null ? null : (journal(migrationsFolder).find((e) => e.when === lastMillis)?.tag ?? null);
  return { applied: row.n, lastMillis, latestTag };
}

/**
 * Migrations drizzle will run on this database: journal entries newer than the
 * last applied migration (the same rule drizzle's SQLite migrator uses).
 */
export function pendingMigrations(db: Database.Database, migrationsFolder: string) {
  const { applied, lastMillis } = appliedMigrations(db, migrationsFolder);
  const pending = journal(migrationsFolder).filter((e) => lastMillis === null || e.when > lastMillis);
  return { applied, pending: pending.map((e) => e.tag) };
}

/** Open a backup read-only and check it: integrity_check must be "ok" and the key tables readable. */
export function verifyBackupFile(file: string, migrationsFolder = path.join(process.cwd(), "drizzle")): Verification {
  let db: Database.Database | null = null;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const integrity = rows.map((r) => r.integrity_check).join("; ");
    const counts: Record<string, number> = {};
    for (const t of KEY_TABLES) if (tableExists(db, t)) counts[t] = (db.prepare(`select count(*) as n from "${t}"`).get() as { n: number }).n;
    const m = appliedMigrations(db, migrationsFolder);
    const missing = KEY_TABLES.filter((t) => counts[t] === undefined);
    const ok = integrity === "ok" && missing.length === 0;
    return { ok, integrity, counts, migrations: { applied: m.applied, latestTag: m.latestTag }, ...(missing.length ? { error: `missing tables: ${missing.join(", ")}` } : {}) };
  } catch (e) {
    return { ok: false, integrity: "unreadable", counts: {}, migrations: { applied: 0, latestTag: null }, error: (e as Error).message };
  } finally {
    db?.close();
  }
}

/** Consistent synchronous snapshot (VACUUM INTO). Used where the caller cannot await (opening the DB). */
export function snapshotSync(db: Database.Database, dest: string) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  db.prepare("VACUUM INTO ?").run(dest);
  makeStandalone(dest);
}

/**
 * A copy of a WAL database is itself flagged WAL; switch it to a rollback journal so the
 * backup is one self-contained file (no -wal/-shm appear when it is opened or verified).
 */
export function makeStandalone(file: string) {
  const db = new Database(file, { fileMustExist: true });
  try {
    db.pragma("journal_mode = DELETE");
  } finally {
    db.close();
  }
}

/**
 * Called by openDb() before drizzle migrates: when an existing database has
 * pending migrations, snapshot it first. Fresh databases are skipped. If the
 * snapshot cannot be verified the migration is refused (set
 * CONVICTION_SKIP_PREMIGRATION_BACKUP=1 to override deliberately).
 */
export function backupBeforeMigrations(db: Database.Database, dbFile: string, migrationsFolder: string): BackupMeta | null {
  if (dbFile === ":memory:" || process.env.CONVICTION_SKIP_PREMIGRATION_BACKUP === "1") return null;
  const { applied, pending } = pendingMigrations(db, migrationsFolder);
  if (applied === 0 || pending.length === 0) return null;
  const dir = backupDirFor(dbFile);
  const file = uniqueBackupPath(dir);
  const partial = `${file}.partial`;
  snapshotSync(db, partial);
  const v = verifyBackupFile(partial, migrationsFolder);
  if (!v.ok) {
    fs.rmSync(partial, { force: true });
    throw new Error(`Pre-migration backup failed verification (${v.integrity}${v.error ? `; ${v.error}` : ""}). Migrations not applied. Set CONVICTION_SKIP_PREMIGRATION_BACKUP=1 to override.`);
  }
  fs.renameSync(partial, file);
  const meta: BackupMeta = {
    file,
    reason: "pre-migration",
    createdAt: new Date().toISOString(),
    sizeBytes: fs.statSync(file).size,
    integrity: v.integrity,
    counts: v.counts,
    migrations: v.migrations,
    detail: `before applying ${pending.join(", ")}`,
  };
  writeMeta(meta);
  console.log(JSON.stringify({ t: meta.createdAt, level: "info", app: "conviction", msg: "pre-migration backup written", file, pending }));
  return meta;
}
