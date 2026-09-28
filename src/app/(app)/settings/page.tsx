import { integrationErrorMessage } from "@/lib/integration-errors";
import Link from "next/link";
import path from "node:path";
import { headers } from "next/headers";
import { requireSession } from "@/server/session";
import { auditActions, listAudit, listMembers, ROLE_DESCRIPTION } from "@/server/members";
import { backupDir, backupScheduleDescription, listBackups, offsiteDescription, RETENTION } from "@/server/backup";
import { storageDescription, storageKind } from "@/server/storage";
import { encryptionKeySource } from "@/server/crypto";
import { checkConsistency } from "@/server/consistency";
import { databasePath } from "@/db/client";
import { listCompanies } from "@/server/repo";
import { EMBEDDING_MODEL, PRIMARY_MODEL } from "@/ai/openai";
import { PageHeader } from "@/components/shell/page-header";
import { cx } from "@/components/ui";
import { MembersPanel } from "@/components/settings/members-panel";
import { AuditLog } from "@/components/settings/audit-log";
import { DataPolicy } from "@/components/settings/data-policy";
import { BackupPanel } from "@/components/settings/backup-panel";
import { AccountForm } from "@/components/settings/account-form";
import { IntegrationsPanel } from "@/components/settings/integrations-panel";
import { appOrigin, connectorStatuses, isConnectorId, SPECS } from "@/server/connectors/meeting-connectors";
import { viewerConnections } from "@/server/connectors/oauth";
import { TRANSCRIBE_MODEL } from "@/ai/transcribe";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

type Tab = "members" | "audit" | "data" | "integrations" | "account";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; action?: string; user?: string; q?: string; integration?: string; integration_result?: string; integration_error?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const isOwner = s.role === "OWNER";
  const canAudit = s.role === "OWNER" || s.role === "PARTNER";
  const tabs: { id: Tab; label: string }[] = [
    { id: "members", label: "Members" },
    ...(canAudit ? [{ id: "audit" as const, label: "Audit log" }] : []),
    { id: "data", label: "Data & backups" },
    { id: "integrations", label: "Integrations" },
    { id: "account", label: "Your account" },
  ];
  const tab: Tab = tabs.some((t) => t.id === sp.tab) ? (sp.tab as Tab) : "members";
  const members = listMembers(s.workspaceId);

  return (
    <main className="pb-16">
      <PageHeader title="Settings" meta={`${s.workspaceName} — members, audit trail, data policy, backups and export. You are signed in as ${s.email} (${s.role.toLowerCase()}).`} />
      <nav className="-mb-px flex gap-1 overflow-x-auto border-b border-line px-8">
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/settings?tab=${t.id}`}
            className={cx("whitespace-nowrap border-b-2 px-2.5 py-2 text-[13px]", tab === t.id ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
          >
            {t.label}
            {t.id === "members" && <span className="num ml-1.5 text-[11px] text-ink-3">{members.length}</span>}
          </Link>
        ))}
      </nav>
      <div className="max-w-[1080px] px-8 pt-8">
        {tab === "members" && <MembersPanel members={members} me={s.userId} isOwner={isOwner} roleDescriptions={ROLE_DESCRIPTION} />}
        {tab === "audit" && canAudit && (
          <AuditLog
            rows={listAudit(s.workspaceId, { action: sp.action || null, userId: sp.user || null, q: sp.q || null, limit: 200 })}
            actions={auditActions(s.workspaceId)}
            members={members.map((m) => ({ userId: m.userId, name: m.name }))}
            targets={Object.fromEntries([...listCompanies(s.workspaceId).map((c) => [c.id, c.name] as const), ...members.map((m) => [m.userId, m.name] as const)])}
            filter={{ action: sp.action ?? "", user: sp.user ?? "", q: sp.q ?? "" }}
          />
        )}
        {tab === "data" && <DataTab isOwner={isOwner} canAudit={canAudit} workspaceId={s.workspaceId} />}
        {tab === "integrations" && (
          <IntegrationsPanel
            connectors={connectorStatuses(process.env, { origin: appOrigin(await headers()), connection: viewerConnections(s.workspaceId, s.userId) })}
            transcriptionModel={TRANSCRIBE_MODEL}
            canConnect={s.role !== "VIEWER"}
            flash={
              isConnectorId(sp.integration) && (sp.integration_error || sp.integration_result === "connected")
                ? { provider: sp.integration, ok: !sp.integration_error, message: sp.integration_error ? integrationErrorMessage(sp.integration_error, SPECS[sp.integration].name) : `${SPECS[sp.integration].name} connected.` }
                : null
            }
          />
        )}
        {tab === "account" && <AccountForm name={s.name} email={s.email} />}
      </div>
    </main>
  );
}

function DataTab({ isOwner, canAudit, workspaceId }: { isOwner: boolean; canAudit: boolean; workspaceId: string }) {
  const kind = storageKind();
  const dir = backupDir();
  const consistency = canAudit ? checkConsistency(workspaceId) : null;
  return (
    <div className="space-y-12">
      <DataPolicy
        model={PRIMARY_MODEL}
        embeddingModel={EMBEDDING_MODEL}
        storage={{ kind, where: kind === "local" ? storageDescription() : `object storage (${storageDescription()})` }}
        encryption={encryptionKeySource()}
        database={path.resolve(databasePath())}
      />
      <BackupPanel
        isOwner={isOwner}
        dir={dir}
        schedule={backupScheduleDescription()}
        retention={`${RETENTION.daily} daily · ${RETENTION.manual} manual · ${RETENTION["pre-migration"]} pre-migration`}
        offsite={offsiteDescription()}
        backups={isOwner ? listBackups(dir).map((b) => ({ name: b.name, reason: b.reason, createdAt: b.createdAt, sizeBytes: b.sizeBytes, integrity: b.integrity, companies: b.counts.companies ?? null, documents: b.counts.documents ?? null, remote: b.remote ? ("key" in b.remote ? "uploaded" : `failed: ${b.remote.error}`) : null, detail: b.detail ?? null })) : []}
        consistency={consistency ? { checked: consistency.companiesChecked, inFlight: consistency.skippedInFlight.length, violations: consistency.violations.slice(0, 50).map((v) => ({ company: v.companyName, kind: v.kind, message: v.message })), total: consistency.violations.length } : null}
      />
    </div>
  );
}
