/**
 * Database backups.
 *
 *  - createBackup(reason): online backup with better-sqlite3's db.backup()
 *    (consistent while the app keeps writing), verified read-only
 *    (PRAGMA integrity_check + key table counts), described by a sidecar
 *    JSON, pruned (14 daily, 10 manual, 10 pre-migration, 5 pre-restore) and,
 *    when S3_* is configured, uploaded encrypted to object storage.
 *  - startBackupScheduler(): hourly check from instrumentation; takes a daily
 *    backup when the newest one is ≥ 24h old (survives restarts/redeploys).
 *  - restoreBackup(): verified restore to a target path; refuses to overwrite
 *    an existing database without force, and keeps a pre-restore copy.
 *
 * Location: BACKUP_DIR, default <dirname(DATABASE_PATH)>/backups
 * (on Render: /var/data/backups, on the persistent disk).
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getDb, databasePath, type DB } from "@/db/client";
import { backupDirFor, makeStandalone, metaPath, readMeta, uniqueBackupPath, verifyBackupFile, writeMeta, type BackupMeta, type BackupReason } from "@/db/backup-core";
import { decryptFile, encryptFile, MAGIC } from "./crypto";
import { S3Client, s3ConfigFromEnv } from "./s3";
import { logger } from "@/lib/log";

export type { BackupMeta, BackupReason };

export const RETENTION: Record<BackupReason, number> = { daily: 14, manual: 10, "pre-migration": 10, "pre-restore": 5 };
const DAY_MS = 24 * 3600 * 1000;

export function backupDir(dbPath = databasePath()) {
  return backupDirFor(dbPath);
}

function remote(): S3Client | null {
  const cfg = s3ConfigFromEnv();
  return cfg ? new S3Client(cfg) : null;
}

export function offsiteDescription(): string | null {
  return remote()?.description ?? null;
}

let running: Promise<BackupMeta> | null = null;

export interface BackupOptions {
  db?: DB;
  dir?: string;
  detail?: string;
  /** Skip the object-storage upload (tests). */
  upload?: boolean;
}

/** Create, verify, describe, upload (optional) and prune. Serialized: concurrent calls share one run. */
export function createBackup(reason: BackupReason = "manual", opts: BackupOptions = {}): Promise<BackupMeta> {
  if (running) return running;
  running = doBackup(reason, opts).finally(() => {
    running = null;
  });
  return running;
}

async function doBackup(reason: BackupReason, opts: BackupOptions): Promise<BackupMeta> {
  const db = opts.db ?? getDb();
  const dir = opts.dir ?? backupDir(db.$client.name);
  fs.mkdirSync(dir, { recursive: true });
  const file = uniqueBackupPath(dir);
  const partial = `${file}.partial`;
  const t0 = Date.now();
  try {
    await db.$client.backup(partial);
    makeStandalone(partial);
    const v = verifyBackupFile(partial);
    if (!v.ok) throw new Error(`backup verification failed: ${v.integrity}${v.error ? ` (${v.error})` : ""}`);
    fs.renameSync(partial, file);
    const meta: BackupMeta = {
      file,
      reason,
      createdAt: new Date().toISOString(),
      sizeBytes: fs.statSync(file).size,
      integrity: v.integrity,
      counts: v.counts,
      migrations: v.migrations,
      ...(opts.detail ? { detail: opts.detail } : {}),
    };
    writeMeta(meta);
    const r = opts.upload === false ? null : remote();
    if (r) {
      try {
        meta.remote = await uploadBackup(r, file, meta);
      } catch (e) {
        meta.remote = { error: (e as Error).message };
        logger.error({ err: (e as Error).message, file }, "backup upload failed");
      }
      writeMeta(meta);
    }
    await pruneBackups(dir, opts.upload === false ? null : r);
    logger.info({ file, reason, sizeBytes: meta.sizeBytes, ms: Date.now() - t0 }, "backup created");
    return meta;
  } catch (e) {
    fs.rmSync(partial, { force: true });
    logger.error({ err: (e as Error).message, reason }, "backup failed");
    throw e;
  }
}

async function uploadBackup(r: S3Client, file: string, meta: BackupMeta) {
  const enc = `${file}.cve.tmp`;
  try {
    await encryptFile(file, enc);
    const key = `backups/${path.basename(file)}.cve`;
    await r.put(key, fs.readFileSync(enc));
    await r.put(`backups/${path.basename(file)}.json`, Buffer.from(JSON.stringify({ ...meta, file: path.basename(file) }, null, 2)), "application/json");
    return { key, uploadedAt: new Date().toISOString() };
  } finally {
    fs.rmSync(enc, { force: true });
  }
}

export interface BackupListing extends BackupMeta {
  name: string;
}

/** Backups in the directory, newest first. Files without a sidecar are listed with reason "manual". */
export function listBackups(dir = backupDir()): BackupListing[] {
  if (!fs.existsSync(dir)) return [];
  const out: BackupListing[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!/^conviction-.*\.db$/.test(name)) continue;
    const file = path.join(dir, name);
    const meta = readMeta(file);
    const st = fs.statSync(file);
    out.push({
      name,
      ...(meta ?? { reason: "manual" as const, createdAt: st.mtime.toISOString(), integrity: "unknown", counts: {}, migrations: { applied: 0, latestTag: null } }),
      file,
      sizeBytes: st.size,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** Keep the newest N per reason (RETENTION); remove older local files and their remote copies. */
export async function pruneBackups(dir = backupDir(), r: S3Client | null = remote()): Promise<string[]> {
  const removed: string[] = [];
  const byReason = new Map<BackupReason, BackupListing[]>();
  for (const b of listBackups(dir)) byReason.set(b.reason, [...(byReason.get(b.reason) ?? []), b]);
  for (const [reason, list] of byReason) {
    for (const b of list.slice(RETENTION[reason] ?? 10)) {
      fs.rmSync(b.file, { force: true });
      fs.rmSync(metaPath(b.file), { force: true });
      removed.push(b.name);
      if (r && b.remote && "key" in b.remote) {
        await r.delete(b.remote.key).catch(() => undefined);
        await r.delete(`backups/${b.name}.json`).catch(() => undefined);
      }
    }
  }
  return removed;
}

/* ------------------------------ Schedule ------------------------------ */

const g = globalThis as unknown as { __convictionBackupTimer?: NodeJS.Timeout };

/** Hourly check; creates a daily backup when the newest backup is ≥ 24h old. Idempotent. */
export function startBackupScheduler() {
  if (g.__convictionBackupTimer || process.env.BACKUP_SCHEDULE === "off") return;
  const tick = async () => {
    try {
      const newest = listBackups().find((b) => b.reason === "daily");
      if (!newest || Date.now() - new Date(newest.createdAt).getTime() >= DAY_MS - 5 * 60 * 1000) await createBackup("daily");
    } catch (e) {
      logger.error({ err: (e as Error).message }, "scheduled backup failed");
    }
  };
  // First check shortly after boot (not during it), then hourly.
  setTimeout(tick, 90_000).unref();
  g.__convictionBackupTimer = setInterval(tick, 3600_000);
  g.__convictionBackupTimer.unref();
}

export function backupScheduleDescription() {
  return process.env.BACKUP_SCHEDULE === "off" ? "Disabled (BACKUP_SCHEDULE=off)" : "Daily (checked hourly; a backup is taken when the newest daily one is 24 h old), plus automatically before database migrations";
}

/* ------------------------------ Restore ------------------------------ */

export interface RestoreResult {
  target: string;
  preRestoreCopy: string | null;
  counts: Record<string, number>;
}

/**
 * Restore a backup file (plain SQLite or CVE1-encrypted) to `target`.
 * The source is verified before anything is touched. An existing target is
 * never overwritten without `force`; with `force`, a consistent copy of the
 * current target is written next to it first (<target>.pre-restore-<iso>.db).
 */
export async function restoreBackup(v: { source: string; target: string; force?: boolean }): Promise<RestoreResult> {
  if (!fs.existsSync(v.source)) throw new Error(`Backup not found: ${v.source}`);
  const target = path.resolve(v.target);
  if (path.resolve(v.source) === target) throw new Error("Source and target are the same file");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const staging = `${target}.restoring-${process.pid}`;
  try {
    // 1. Materialize (decrypting when needed) and verify.
    const head = Buffer.alloc(4);
    const fd = fs.openSync(v.source, "r");
    fs.readSync(fd, head, 0, 4, 0);
    fs.closeSync(fd);
    if (head.equals(MAGIC)) await decryptFile(v.source, staging);
    else fs.copyFileSync(v.source, staging);
    try {
      makeStandalone(staging);
    } catch (e) {
      throw new Error(`Backup failed verification: ${(e as Error).message}`);
    }
    const check = verifyBackupFile(staging);
    if (!check.ok) throw new Error(`Backup failed verification: ${check.integrity}${check.error ? ` (${check.error})` : ""}`);

    // 2. Protect the existing target.
    let preRestoreCopy: string | null = null;
    if (fs.existsSync(target)) {
      if (!v.force) throw new Error(`Refusing to overwrite existing database ${target} (pass --force; a pre-restore copy is kept)`);
      preRestoreCopy = `${target}.pre-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
      const live = new Database(target, { fileMustExist: true });
      try {
        await live.backup(preRestoreCopy); // includes committed WAL content
      } finally {
        live.close();
      }
      makeStandalone(preRestoreCopy);
      const pre = verifyBackupFile(preRestoreCopy);
      if (!pre.ok) throw new Error(`Could not write a verified pre-restore copy (${pre.integrity}); nothing was changed`);
    }

    // 3. Swap in atomically; stale WAL/SHM of the old database must not be replayed onto the restored one.
    fs.rmSync(`${target}-wal`, { force: true });
    fs.rmSync(`${target}-shm`, { force: true });
    fs.renameSync(staging, target);
    return { target, preRestoreCopy, counts: check.counts };
  } finally {
    for (const f of [staging, `${staging}-wal`, `${staging}-shm`, `${staging}-journal`]) fs.rmSync(f, { force: true });
  }
}

/** Download an encrypted backup from object storage (disaster recovery when the disk is gone). */
export async function downloadRemoteBackup(name: string, destDir: string): Promise<string> {
  const r = remote();
  if (!r) throw new Error("Object storage is not configured (S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)");
  let key = name.startsWith("backups/") ? name : `backups/${name}`;
  if (name === "latest") {
    const all = (await r.list("backups/")).filter((o) => o.key.endsWith(".db.cve")).sort((a, b) => (a.key < b.key ? 1 : -1));
    if (!all.length) throw new Error("No remote backups found");
    key = all[0]!.key;
  } else if (!key.endsWith(".cve")) key = `${key}.cve`;
  const data = await r.get(key);
  if (!data) throw new Error(`Remote backup not found: ${key}`);
  fs.mkdirSync(destDir, { recursive: true });
  const out = path.join(destDir, path.basename(key));
  fs.writeFileSync(out, data);
  return out;
}

export async function listRemoteBackups() {
  const r = remote();
  if (!r) return [];
  return (await r.list("backups/")).filter((o) => o.key.endsWith(".db.cve"));
}
