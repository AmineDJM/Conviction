/**
 * GET  /api/admin/backup  → backups (local + remote), location, schedule   (OWNER)
 * POST /api/admin/backup  → create a verified backup now                    (OWNER)
 */
import path from "node:path";
import { backupDir, backupScheduleDescription, createBackup, listBackups, listRemoteBackups, offsiteDescription } from "@/server/backup";
import { audit } from "@/server/repo";
import { requireRole } from "../guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  const remote = await listRemoteBackups().catch((e: Error) => ({ error: e.message }));
  return Response.json({
    dir: backupDir(),
    schedule: backupScheduleDescription(),
    offsite: offsiteDescription(),
    backups: listBackups().map((b) => ({ ...b, file: path.basename(b.file) })),
    remote,
  });
}

export async function POST() {
  const s = await requireRole("OWNER");
  if (s instanceof Response) return s;
  try {
    const meta = await createBackup("manual", { detail: `requested by ${s.email}` });
    audit(s.workspaceId, s.userId, "BACKUP_CREATED", path.basename(meta.file), `${(meta.sizeBytes / 1e6).toFixed(1)} MB, integrity ${meta.integrity}${meta.remote ? ("key" in meta.remote ? ", uploaded" : `, upload failed: ${meta.remote.error}`) : ""}`);
    return Response.json({ ok: true, backup: { ...meta, file: path.basename(meta.file) } });
  } catch (e) {
    audit(s.workspaceId, s.userId, "BACKUP_FAILED", undefined, (e as Error).message.slice(0, 500));
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
