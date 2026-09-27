/**
 * CLI: restore a database backup after verifying it.
 *
 *   npx tsx scripts/restore.ts <backup.db | backup.db.cve | latest> [--target <path>] [--force]
 *   npx tsx scripts/restore.ts --remote <name | latest> [--target <path>] [--force]
 *
 * - The source is verified (PRAGMA integrity_check, key tables) before anything changes.
 *   CVE1-encrypted backups (off-site copies) are decrypted with DATA_ENCRYPTION_KEY.
 * - The target defaults to DATABASE_PATH. An existing target is NEVER overwritten
 *   without --force; with --force a verified pre-restore copy is written next to it.
 * - Restoring over the live database: run it, then restart the service immediately
 *   (the running process still holds the old file open).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { backupDir, downloadRemoteBackup, listBackups, restoreBackup } from "../src/server/backup";
import { databasePath } from "../src/db/client";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const force = process.argv.includes("--force");
  const remote = arg("--remote");
  const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && all[i - 1] !== "--target" && all[i - 1] !== "--remote");
  const target = path.resolve(arg("--target") ?? databasePath());
  let source: string | undefined;
  let tmpDir: string | null = null;

  if (remote) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "conviction-restore-"));
    source = await downloadRemoteBackup(remote, tmpDir);
    console.log(`Downloaded ${path.basename(source)}`);
  } else if (positional[0] === "latest") {
    const latest = listBackups(backupDir(target))[0] ?? listBackups()[0];
    if (!latest) throw new Error(`No backups in ${backupDir(target)}`);
    source = latest.file;
  } else source = positional[0];
  if (!source) {
    console.error("Usage: npx tsx scripts/restore.ts <backup-file|latest> [--target <path>] [--force]\n       npx tsx scripts/restore.ts --remote <name|latest> [--target <path>] [--force]");
    process.exit(2);
  }

  console.log(`Restoring ${source}\n       → ${target}${force ? " (--force)" : ""}`);
  try {
    const r = await restoreBackup({ source, target, force });
    console.log(`OK restored and verified. Counts: ${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
    if (r.preRestoreCopy) console.log(`Previous database kept at ${r.preRestoreCopy}`);
    if (target === path.resolve(databasePath())) console.log("Restart the service now so it opens the restored database.");
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`Restore failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
