"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ConnectorStatus } from "@/server/connectors/meeting-connectors";
import { Badge, Button, cx } from "@/components/ui";

/**
 * Meeting platform connectors. Optional: the meetings workflow works fully by
 * upload. Client credentials come from the server environment; each member
 * connects their own account (OAuth). Tokens never reach this component — it
 * only receives the connection's status, account email and scopes.
 */
export function IntegrationsPanel({
  connectors,
  transcriptionModel,
  canConnect,
  flash,
}: {
  connectors: ConnectorStatus[];
  transcriptionModel: string;
  canConnect: boolean;
  flash: { provider: string; ok: boolean; message: string } | null;
}) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[15px] font-semibold text-ink">Meeting recordings</h2>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-ink-2">
          Founder meetings are added on each deal&apos;s <span className="font-medium text-ink">Meetings</span> tab: paste a transcript, upload a transcript file (.txt, .md, .vtt, .srt — Zoom and Google Meet exports work as they are), or upload the recording. Recordings are
          transcribed with <span className="font-mono text-[12px]">{transcriptionModel}</span> (speaker labels and timestamps), stored encrypted, and cost is recorded per meeting. No integration is required: connecting Zoom or Google Meet only adds
          an <span className="font-medium text-ink">Import from …</span> option.
        </p>
      </section>
      {flash && (
        <div role="status" className={cx("max-w-[760px] rounded-lg border px-4 py-2.5 text-[12.5px]", flash.ok ? "border-ok/30 bg-ok-soft text-ok" : "border-risk/30 bg-risk-soft text-risk")}>
          {flash.message}
        </div>
      )}
      <section className="space-y-3">
        {connectors.map((c) => (
          <ConnectorCard key={c.id} c={c} canConnect={canConnect} />
        ))}
      </section>
      <p className="max-w-[760px] text-[12px] leading-relaxed text-ink-3">
        Client credentials are read from the server environment (never stored in the database or shown). Access and refresh tokens are stored encrypted (AES-256-GCM) per workspace member, are only used for that member&apos;s own imports, are never sent
        to the browser, and are deleted on disconnect or when the member is removed. Connections, imports and disconnections are written to the audit log.
      </p>
    </div>
  );
}

function stateBadge(c: ConnectorStatus) {
  if (c.state === "NOT_CONFIGURED") return <Badge tone="unknown">Not configured</Badge>;
  if (!c.connection) return <Badge tone="neutral">Not connected</Badge>;
  if (c.connection.status === "NEEDS_REAUTH") return <Badge tone="warn">Reconnect needed</Badge>;
  return (
    <Badge tone="ok" dot>
      Connected
    </Badge>
  );
}

const when = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";

function ConnectorCard({ c, canConnect }: { c: ConnectorStatus; canConnect: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const connectHref = `/api/integrations/${c.id}/connect?returnTo=${encodeURIComponent("/settings?tab=integrations")}`;

  async function disconnect() {
    if (!confirm(`Disconnect ${c.name}? The authorization is revoked at ${c.name} and your stored tokens are deleted. Meetings already imported stay.`)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/integrations/${c.id}/disconnect`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const conn = c.connection;
  return (
    <div className="rounded-lg border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium text-ink">{c.name}</span>
          {stateBadge(c)}
        </div>
        <div className="flex items-center gap-2">
          <a href={c.docs} target="_blank" rel="noreferrer" className="text-[12px] text-ink-3 hover:text-ink">
            API documentation ↗
          </a>
          {c.state === "CONFIGURED" && canConnect && (!conn || conn.status === "NEEDS_REAUTH") && (
            // A plain navigation: the server redirects to the provider's consent screen.
            <a href={connectHref} className="inline-flex h-7 items-center rounded-md bg-ink px-2.5 text-[12.5px] font-medium text-bg hover:bg-ink/85">
              {conn ? `Reconnect ${c.name}` : `Connect ${c.name}`}
            </a>
          )}
          {conn && (
            <Button size="sm" variant="danger" onClick={disconnect} disabled={busy}>
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
        </div>
      </div>
      <p className="mt-1.5 max-w-[820px] text-[12.5px] leading-relaxed text-ink-2">{c.detail}</p>
      {c.state === "CONFIGURED" && !canConnect && !conn && <p className="mt-1 text-[12px] text-ink-3">Your role is read-only; a partner or analyst can connect an account.</p>}
      {err && <p className="mt-1.5 text-[12.5px] text-risk">{err}</p>}

      {conn && (
        <dl className="mt-3 grid gap-x-8 gap-y-1 text-[12px] sm:grid-cols-[160px_1fr]">
          <dt className="text-ink-3">Account</dt>
          <dd className="text-ink">{conn.accountEmail ?? "— (profile scope not granted)"}</dd>
          <dt className="text-ink-3">Connected</dt>
          <dd className="num text-ink-2">{when(conn.connectedAt)}</dd>
          <dt className="text-ink-3">Last import</dt>
          <dd className="text-ink-2">
            {conn.lastImport ? (
              <>
                <a href={`/deals/${conn.lastImport.companyId}/meetings/${conn.lastImport.meetingId}/transcript`} className="text-ink hover:text-accent-text">
                  {conn.lastImport.title}
                </a>{" "}
                <span className="num text-ink-3">· {when(conn.lastImport.at)}</span>
              </>
            ) : (
              "none yet — use “Import from " + c.name + "” on a deal's Meetings tab"
            )}
          </dd>
          <dt className="text-ink-3">Granted scopes</dt>
          <dd className="break-words font-mono text-[11.5px] text-ink-2">{conn.scopes.join(" ") || "—"}</dd>
          {conn.missingScopes.length > 0 && (
            <>
              <dt className="text-warn">Missing</dt>
              <dd className="text-warn">
                <span className="break-all font-mono text-[11.5px]">{conn.missingScopes.join(" ")}</span>
                {c.id === "google_meet" ? " — transcripts older than 30 days cannot be exported. Reconnect and allow it." : " — listing recordings will fail. Add it to the Zoom app and reconnect."}
              </dd>
            </>
          )}
        </dl>
      )}

      <details className="group mt-3" open={c.state === "NOT_CONFIGURED"}>
        <summary className="cursor-pointer select-none text-[12px] text-ink-3 hover:text-ink">Setup{c.state === "NOT_CONFIGURED" ? "" : " details"}</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-ink-2">
          {c.setup.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
        <dl className="mt-3 grid gap-x-8 gap-y-1.5 text-[12px] sm:grid-cols-[160px_1fr]">
          <dt className="text-ink-3">Environment</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1">
            {c.envVars.map((e) => (
              <span key={e.name} className="font-mono text-[11.5px]">
                {e.name} <span className={e.present ? "text-ok" : "text-ink-3"}>{e.present ? (e.secret ? "set (hidden)" : "set") : "not set"}</span>
              </span>
            ))}
          </dd>
          <dt className="text-ink-3">Redirect URI to register</dt>
          <dd className="break-all font-mono text-[11.5px] text-ink">{c.redirectUri ?? `<APP_URL>${c.redirectPath}`}</dd>
          <dt className="text-ink-3">Scopes</dt>
          <dd className="space-y-0.5">
            {c.scopes.map((s) => (
              <div key={s.scope}>
                <span className="break-all font-mono text-[11.5px] text-ink">{s.scope}</span> <span className="text-ink-3">— {s.why}</span>
              </div>
            ))}
          </dd>
        </dl>
      </details>
    </div>
  );
}
