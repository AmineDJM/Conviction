"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Callout, Empty, Section } from "@/components/ui";
import { titleCase } from "@/lib/format";

interface BackupRow {
  name: string;
  reason: string;
  createdAt: string;
  sizeBytes: number;
  integrity: string;
  companies: number | null;
  documents: number | null;
  remote: string | null;
  detail: string | null;
}

interface Consistency {
  checked: number;
  inFlight: number;
  total: number;
  violations: { company: string; kind: string; message: string }[];
}

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} kB`);
const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-2.5 sm:grid-cols-[220px_1fr] sm:gap-6">
      <div className="text-ink-3">{k}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

export function BackupPanel({ isOwner, canBackup, dir, schedule, retention, offsite, backups, consistency }: { isOwner: boolean; canBackup: boolean; dir: string; schedule: string; retention: string; offsite: string | null; backups: BackupRow[]; consistency: Consistency | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "risk"; text: string } | null>(null);
  const [withFiles, setWithFiles] = useState(true);

  async function backupNow() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setMsg({ tone: "ok", text: `Backup ${json.backup.file} written and verified (integrity ${json.backup.integrity}).` });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "risk", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-12">
      <Section
        eyebrow="Backups"
        title="Database backups"
        action={
          canBackup && (
            <Button variant="primary" size="sm" onClick={backupNow} disabled={busy}>
              {busy ? "Backing up…" : "Create backup now"}
            </Button>
          )
        }
      >
        <div className="divide-y divide-line border-y border-line text-[13px]">
          <Row k="Schedule">{schedule}</Row>
          <Row k="Location">
            <span className="font-mono text-[12px]">{dir}</span> <span className="text-ink-3">(same persistent disk as the database)</span>
          </Row>
          <Row k="Off-site copy">{offsite ? <>Encrypted copies uploaded to <span className="font-mono text-[12px]">{offsite}/backups/</span></> : <span className="text-ink-3">Not configured — set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to keep copies off the disk.</span>}</Row>
          <Row k="Retention">{retention}</Row>
          <Row k="Verification">Each backup is opened read-only, must pass PRAGMA integrity_check, and its key table counts are recorded.</Row>
        </div>
        {msg && <div className={msg.tone === "ok" ? "mt-3 text-[12.5px] text-ok" : "mt-3 text-[12.5px] text-risk"}>{msg.text}</div>}
        {canBackup && (
          <div className="mt-6">
            {backups.length === 0 ? (
              <Empty title="No backups yet">The first daily backup runs shortly after the server starts. Use “Create backup now” before risky changes.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-[12.5px]">
                  <thead>
                    <tr className="text-left text-[11.5px] text-ink-3">
                      <th className="py-2 pr-4 font-medium">Created</th>
                      <th className="py-2 pr-4 font-medium">Kind</th>
                      <th className="py-2 pr-4 text-right font-medium">Size</th>
                      <th className="py-2 pr-4 text-right font-medium">Companies</th>
                      <th className="py-2 pr-4 text-right font-medium">Documents</th>
                      <th className="py-2 pr-4 font-medium">Integrity</th>
                      <th className="py-2 font-medium">Off-site</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.name} className="border-t border-line align-top" title={b.name}>
                        <td className="num whitespace-nowrap py-1.5 pr-4">{when(b.createdAt)}</td>
                        <td className="py-1.5 pr-4 text-ink-2">
                          {titleCase(b.reason.replace("-", "_"))}
                          {b.detail && <div className="text-[11.5px] text-ink-3">{b.detail}</div>}
                        </td>
                        <td className="num py-1.5 pr-4 text-right">{mb(b.sizeBytes)}</td>
                        <td className="num py-1.5 pr-4 text-right">{b.companies ?? "—"}</td>
                        <td className="num py-1.5 pr-4 text-right">{b.documents ?? "—"}</td>
                        <td className="py-1.5 pr-4">{b.integrity === "ok" ? <Badge tone="ok">Verified</Badge> : <Badge tone="warn">{b.integrity}</Badge>}</td>
                        <td className="py-1.5 text-ink-3">{b.remote === "uploaded" ? "Uploaded" : (b.remote ?? "—")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[12px] text-ink-3">
              Restore: in the service shell run <code className="font-mono">npx tsx scripts/restore.ts latest --force</code>, then restart the service. The current database is kept as a verified pre-restore copy. Details in the README, “Operations”.
            </p>
          </div>
        )}
      </Section>

      {isOwner && (
        <Section eyebrow="Portability" title="Export everything">
          <p className="max-w-2xl text-ink-2">
            One ZIP with every table of this workspace as JSON (deals, versions, documents metadata and page text, analyses, costs, history, fund memory, IC, meetings, chats, facts, graph, chunks without embeddings, audit log), a manifest with schema version and counts, and the original uploaded documents, decrypted. Treat the file as confidential.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <a href={`/api/admin/export${withFiles ? "" : "?files=0"}`} className="inline-flex h-8 items-center justify-center rounded-md border border-line bg-surface px-3 text-[13px] font-medium text-ink hover:bg-surface-2" download>
              Export everything (.zip)
            </a>
            <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={withFiles} onChange={(e) => setWithFiles(e.target.checked)} />
              Include original documents
            </label>
          </div>
        </Section>
      )}

      {consistency && (
        <Section eyebrow="Integrity" title="Consistency check">
          {consistency.total === 0 ? (
            <Callout tone="ok" title="No violations">
              {consistency.checked} compan{consistency.checked === 1 ? "y" : "ies"} checked: pipeline projections, metric facts, deal memory and retrieval chunks all match each company&apos;s current version.
              {consistency.inFlight > 0 && ` ${consistency.inFlight} with an analysis in progress were skipped.`}
            </Callout>
          ) : (
            <>
              <Callout tone="warn" title={`${consistency.total} violation${consistency.total === 1 ? "" : "s"}`}>
                Derived data disagrees with the current version. Re-running the analysis or Benchmarks → Recalculate portfolio rebuilds projections and memory.
              </Callout>
              <table className="mt-4 w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[11.5px] text-ink-3">
                    <th className="py-2 pr-4 font-medium">Company</th>
                    <th className="py-2 pr-4 font-medium">Area</th>
                    <th className="py-2 font-medium">Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {consistency.violations.map((v, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1.5 pr-4">{v.company}</td>
                      <td className="py-1.5 pr-4 text-ink-2">{titleCase(v.kind)}</td>
                      <td className="py-1.5 text-ink-2">{v.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
