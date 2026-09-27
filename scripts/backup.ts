/**
 * CLI: create a verified backup of the database now (same code path as the
 * daily schedule and the Settings button), or list backups.
 *   npx tsx scripts/backup.ts            → create (reason "manual")
 *   npx tsx scripts/backup.ts --list     → list local (and remote, when S3_* is set) backups
 */
import path from "node:path";
import { backupDir, createBackup, listBackups, listRemoteBackups } from "../src/server/backup";
import { databasePath } from "../src/db/client";

async function main() {
  if (process.argv.includes("--list")) {
    console.log(`Backups in ${backupDir()}`);
    for (const b of listBackups()) console.log(`  ${b.name}  ${b.reason.padEnd(13)} ${(b.sizeBytes / 1e6).toFixed(2).padStart(8)} MB  integrity ${b.integrity}  companies ${b.counts.companies ?? "?"}${b.remote && "key" in b.remote ? "  (off-site)" : ""}`);
    const remote = await listRemoteBackups().catch((e: Error) => {
      console.log(`  remote listing failed: ${e.message}`);
      return [];
    });
    if (remote.length) {
      console.log("Remote (encrypted):");
      for (const r of remote) console.log(`  ${r.key}  ${(r.size / 1e6).toFixed(2)} MB  ${r.lastModified}`);
    }
    return;
  }
  console.log(`Backing up ${path.resolve(databasePath())}`);
  const meta = await createBackup("manual", { detail: "CLI" });
  console.log(`OK ${meta.file}`);
  console.log(`  integrity ${meta.integrity}, ${(meta.sizeBytes / 1e6).toFixed(2)} MB, migrations applied ${meta.migrations.applied} (${meta.migrations.latestTag ?? "?"})`);
  console.log(`  counts ${Object.entries(meta.counts).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  if (meta.remote) console.log("key" in meta.remote ? `  uploaded ${meta.remote.key}` : `  upload FAILED: ${meta.remote.error}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
