import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";
import { openDb, schema, type DB } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { createBackup, listBackups, pruneBackups, restoreBackup, RETENTION } from "@/server/backup";
import { KEY_TABLES, pendingMigrations, verifyBackupFile, writeMeta, type BackupMeta } from "@/db/backup-core";
import { encryptFile } from "@/server/crypto";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-backup-"));
const opened: DB[] = [];
afterAll(() => {
  for (const d of opened) d.$client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function open(file: string) {
  const db = openDb(file);
  opened.push(db);
  return db;
}

function seed(db: DB) {
  const { userId, workspaceId } = createWorkspaceWithOwner({ email: "gp@fund.example", name: "GP", password: "correct horse battery", workspaceName: "Test Fund" }, db);
  const ids: string[] = [];
  for (const name of ["Acme AI", "Parcelo", "Ledgerline"]) {
    const c = repo.createCompany(workspaceId, name, db);
    ids.push(c.id);
    repo.saveDocument({ workspaceId, companyId: c.id, filename: `${name}.pdf`, mime: "application/pdf", kind: "PDF", sizeBytes: 1234, sha256: `sha-${c.id}`, storagePath: `${workspaceId}/sha-${c.id}.pdf`, pages: [1, 2, 3].map((n) => ({ pageNo: n, text: `${name} page ${n}: ARR $3.8M, NRR 131%` })) }, db);
    repo.addHistory({ workspaceId, companyId: c.id, type: "DECK_UPLOADED", summary: "1 document", userId }, db);
    repo.audit(workspaceId, userId, "ANALYSIS_STARTED", c.id, undefined, db);
  }
  return { userId, workspaceId, companyIds: ids };
}

function counts(db: DB) {
  return Object.fromEntries(KEY_TABLES.map((t) => [t, (db.$client.prepare(`select count(*) as n from "${t}"`).get() as { n: number }).n]));
}

describe("backup → restore", () => {
  it("backs up online, verifies, restores into another path with identical counts and rows", async () => {
    const live = open(path.join(tmp, "live", "conviction.db"));
    const { workspaceId, companyIds } = seed(live);
    const dir = path.join(tmp, "live", "backups");

    const meta = await createBackup("manual", { db: live, dir, upload: false });
    expect(path.basename(meta.file)).toMatch(/^conviction-\d{4}-\d{2}-\d{2}T[\d-]+Z\.db$/);
    expect(meta.integrity).toBe("ok");
    expect(meta.counts.companies).toBe(3);
    expect(meta.counts.document_pages).toBe(9);
    expect(meta.migrations.applied).toBeGreaterThan(0);
    expect(fs.existsSync(`${meta.file}.json`)).toBe(true);
    expect(fs.readdirSync(dir).filter((f) => /-(wal|shm)$/.test(f))).toEqual([]); // one self-contained file
    expect(listBackups(dir)[0]!.name).toBe(path.basename(meta.file));

    // Writes after the backup must not appear in the restored copy.
    repo.createCompany(workspaceId, "Written after backup", live);

    const target = path.join(tmp, "restored", "conviction.db");
    const r = await restoreBackup({ source: meta.file, target });
    expect(r.preRestoreCopy).toBeNull();
    const restored = open(target);
    const before = { ...counts(live), companies: counts(live).companies! - 1 };
    expect(counts(restored)).toEqual(before);
    expect(r.counts).toEqual(before);

    const sample = (db: DB) => db.select().from(schema.companies).where(eq(schema.companies.id, companyIds[1]!)).get();
    expect(sample(restored)).toEqual(sample(live));
    const pages = (db: DB) => db.select().from(schema.documentPages).where(eq(schema.documentPages.companyId, companyIds[2]!)).orderBy(schema.documentPages.pageNo).all();
    expect(pages(restored)).toEqual(pages(live));
    expect(restored.select().from(schema.users).all()).toEqual(live.select().from(schema.users).all());
  });

  it("never overwrites an existing database without force, and keeps a verified pre-restore copy with force", async () => {
    const a = open(path.join(tmp, "a.db"));
    seed(a);
    const meta = await createBackup("manual", { db: a, dir: path.join(tmp, "a-backups"), upload: false });

    const targetPath = path.join(tmp, "b.db");
    const b = open(targetPath);
    createWorkspaceWithOwner({ email: "other@fund.example", name: "Other", password: "x".repeat(12), workspaceName: "Other" }, b);
    b.$client.close();
    opened.splice(opened.indexOf(b), 1);

    await expect(restoreBackup({ source: meta.file, target: targetPath })).rejects.toThrow(/Refusing to overwrite/);
    const r = await restoreBackup({ source: meta.file, target: targetPath, force: true });
    expect(r.preRestoreCopy).toBeTruthy();
    expect(verifyBackupFile(r.preRestoreCopy!).counts.workspaces).toBe(1);
    const restored = open(targetPath);
    expect(restored.select().from(schema.users).all().map((u) => u.email)).toEqual(["gp@fund.example"]);
  });

  it("restores an encrypted (off-site format) backup and rejects a corrupt one", async () => {
    const a = open(path.join(tmp, "enc.db"));
    seed(a);
    const meta = await createBackup("manual", { db: a, dir: path.join(tmp, "enc-backups"), upload: false });
    await encryptFile(meta.file, `${meta.file}.cve`);
    const r = await restoreBackup({ source: `${meta.file}.cve`, target: path.join(tmp, "enc-restored.db") });
    expect(r.counts.companies).toBe(3);

    const corrupt = path.join(tmp, "corrupt.db");
    fs.writeFileSync(corrupt, Buffer.concat([fs.readFileSync(meta.file).subarray(0, 4096), Buffer.alloc(8192, 0xab)]));
    await expect(restoreBackup({ source: corrupt, target: path.join(tmp, "never.db") })).rejects.toThrow(/verification/);
    expect(fs.existsSync(path.join(tmp, "never.db"))).toBe(false);
  });

  it("prunes per kind: 14 daily, 10 manual", async () => {
    const dir = path.join(tmp, "prune");
    fs.mkdirSync(dir);
    const mk = (i: number, reason: BackupMeta["reason"]) => {
      const file = path.join(dir, `conviction-2026-01-${String(i).padStart(2, "0")}T00-00-00-000Z${reason === "manual" ? "-m" : ""}.db`);
      fs.writeFileSync(file, "x");
      writeMeta({ file, reason, createdAt: `2026-01-${String(i).padStart(2, "0")}T00:00:00.000Z`, sizeBytes: 1, integrity: "ok", counts: {}, migrations: { applied: 3, latestTag: null } });
    };
    for (let i = 1; i <= 20; i++) mk(i, "daily");
    for (let i = 1; i <= 12; i++) mk(i, "manual");
    const removed = await pruneBackups(dir, null);
    expect(removed.length).toBe(6 + 2);
    const left = listBackups(dir);
    expect(left.filter((b) => b.reason === "daily").length).toBe(RETENTION.daily);
    expect(left.filter((b) => b.reason === "manual").length).toBe(RETENTION.manual);
    expect(left.filter((b) => b.reason === "daily").at(-1)!.createdAt).toBe("2026-01-07T00:00:00.000Z"); // oldest kept
  });
});

describe("pre-migration backup", () => {
  it("snapshots an existing database before applying pending migrations; skips fresh and up-to-date databases", () => {
    const folder = path.join(process.cwd(), "drizzle");
    const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta", "_journal.json"), "utf8"));
    expect(journal.entries.length).toBeGreaterThan(1);

    // An "old" deployment: all migrations but the last applied.
    const oldFolder = path.join(tmp, "old-migrations");
    fs.cpSync(folder, oldFolder, { recursive: true });
    fs.writeFileSync(path.join(oldFolder, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }));
    const file = path.join(tmp, "premig", "conviction.db");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = new Database(file);
    migrate(drizzle(raw), { migrationsFolder: oldFolder });
    raw.prepare("insert into workspaces (id, name, created_at) values ('ws_old', 'Old', '2026-01-01')").run();
    expect(pendingMigrations(raw, folder).pending).toEqual([journal.entries.at(-1).tag]);
    raw.close();

    const db = open(file); // real openDb → backup, then migrate
    const backups = listBackups(path.join(tmp, "premig", "backups"));
    expect(backups.length).toBe(1);
    expect(backups[0]!.reason).toBe("pre-migration");
    expect(backups[0]!.detail).toContain(journal.entries.at(-1).tag);
    expect(backups[0]!.counts.workspaces).toBe(1);
    expect(verifyBackupFile(backups[0]!.file).migrations.applied).toBe(journal.entries.length - 1);
    expect(pendingMigrations(db.$client, folder).pending).toEqual([]);

    // Re-opening an up-to-date DB takes no backup; neither does creating a fresh one.
    db.$client.close();
    opened.splice(opened.indexOf(db), 1);
    open(file);
    expect(listBackups(path.join(tmp, "premig", "backups")).length).toBe(1);
    open(path.join(tmp, "fresh", "conviction.db"));
    expect(fs.existsSync(path.join(tmp, "fresh", "backups"))).toBe(false);
  });
});
