"use client";

import { integrationErrorMessage } from "@/lib/integration-errors";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Badge, Button, cx } from "@/components/ui";

type ProviderId = "zoom" | "google_meet";

interface RemoteItem {
  id: string;
  kind: "TRANSCRIPT" | "AUDIO";
  label: string;
  sizeBytes: number | null;
  importable: boolean;
  note: string | null;
}
interface RemoteMeeting {
  provider: ProviderId;
  externalId: string;
  title: string;
  startTime: string | null;
  localDate: string;
  durationSec: number | null;
  items: RemoteItem[];
  imported: { companyId: string; companyName: string; meetingId: string; at: string }[];
}

export interface ImportProvider {
  id: ProviderId;
  name: string;
  status: "CONNECTED" | "NEEDS_REAUTH";
  accountEmail: string | null;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const clock = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const mins = (s: number | null) => (s ? `${Math.round(s / 60)} min` : null);

/**
 * "Import from Zoom / Google Meet" on a deal's Meetings tab. Rendered only for
 * providers the viewer has connected. Lists the viewer's own recordings in a
 * date range and imports the chosen transcript (preferred) or audio file into
 * the same founder-meeting workflow as an upload.
 */
export function CloudImport({ companyId, slug, providers, busy }: { companyId: string; slug: string; providers: ImportProvider[]; busy: boolean }) {
  const [open, setOpen] = useState<ImportProvider | null>(null);
  const sp = useSearchParams();
  const flashErr = sp.get("integration_error");
  const flashOk = sp.get("integration_result") === "connected";
  if (!providers.length) return null;
  const returnTo = encodeURIComponent(`/deals/${slug}/meetings`);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {providers.map((p) =>
          p.status === "CONNECTED" ? (
            <Button key={p.id} size="sm" onClick={() => setOpen(p)} disabled={busy} title={p.accountEmail ? `Connected as ${p.accountEmail}` : undefined}>
              Import from {p.name}
            </Button>
          ) : (
            <a key={p.id} href={`/api/integrations/${p.id}/connect?returnTo=${returnTo}`} className="inline-flex h-7 items-center rounded-md border border-warn/40 bg-surface px-2.5 text-[12.5px] font-medium text-warn hover:bg-warn-soft">
              Reconnect {p.name} to import
            </a>
          ),
        )}
      </div>
      {flashErr && <p className="text-[12px] text-risk">{integrationErrorMessage(flashErr, providers.find((p) => p.id === sp.get("integration"))?.name ?? "The provider")}</p>}
      {flashOk && !flashErr && <p className="text-[12px] text-ok">Connected.</p>}
      {open && <ImportDialog companyId={companyId} provider={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ImportDialog({ companyId, provider, onClose }: { companyId: string; provider: ImportProvider; onClose: () => void }) {
  const router = useRouter();
  const [from, setFrom] = useState(() => day(new Date(Date.now() - 29 * 864e5)));
  const [to, setTo] = useState(() => day(new Date()));
  const [list, setList] = useState<RemoteMeeting[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; reauth: boolean } | null>(null);
  const [pick, setPick] = useState<{ meeting: RemoteMeeting; item: RemoteItem } | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const fetchList = useCallback(async (): Promise<{ meetings: RemoteMeeting[] } | { error: { message: string; reauth: boolean } }> => {
    try {
      const r = await fetch(`/api/integrations/${provider.id}/recordings?from=${from}&to=${to}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return { error: { message: j.error ?? `Request failed (${r.status})`, reauth: !!j.reauth } };
      return { meetings: j.meetings as RemoteMeeting[] };
    } catch (e) {
      return { error: { message: (e as Error).message, reauth: false } };
    }
  }, [provider.id, from, to]);

  const apply = (r: Awaited<ReturnType<typeof fetchList>>) => {
    if ("error" in r) {
      setError(r.error);
      setList(null);
    } else setList(r.meetings);
    setLoading(false);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    setPick(null);
    apply(await fetchList());
  };

  // First search on open (the default range); later searches are explicit.
  const first = useRef(fetchList);
  useEffect(() => {
    let alive = true;
    void first.current().then((r) => {
      if (!alive) return;
      if ("error" in r) setError(r.error);
      else setList(r.meetings);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const choose = (meeting: RemoteMeeting, item: RemoteItem) => {
    setPick({ meeting, item });
    setTitle(meeting.title);
    setDate(meeting.localDate);
  };

  const submit = async () => {
    if (!pick) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/integrations/${provider.id}/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId, externalId: pick.meeting.externalId, itemId: pick.item.id, startTime: pick.meeting.startTime, title: title.trim() || null, callDate: date || null }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError({ message: j.error ?? `Import failed (${r.status})`, reauth: !!j.reauth });
        return;
      }
      onClose();
      router.refresh();
    } catch (e) {
      setError({ message: (e as Error).message, reauth: false });
    } finally {
      setSubmitting(false);
    }
  };

  const input = "h-8 rounded-md border border-line bg-surface px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 px-4 py-10" onMouseDown={(e) => e.target === e.currentTarget && !submitting && onClose()}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`Import from ${provider.name}`} className="w-full max-w-[760px] rounded-xl border border-line bg-surface shadow-[var(--shadow-pop)] outline-none">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Import from {provider.name}</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              Your recordings{provider.accountEmail ? ` (${provider.accountEmail})` : ""}.{" "}
              {provider.id === "zoom"
                ? "The transcript is preferred — it keeps Zoom's speaker names and timestamps; audio is transcribed only when no transcript exists."
                : "Meet transcripts are imported with each participant's name and timestamps (transcription must have been on in the meeting)."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-1.5 py-1 text-[12px] text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
            ✕
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2 border-b border-line px-5 py-3">
          <label className="flex flex-col gap-1 text-[12px] text-ink-3">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-3">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={input} />
          </label>
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Search"}
          </Button>
          <span className="text-[11.5px] text-ink-3">At most 31 days per search.</span>
        </div>

        <div className="max-h-[48vh] overflow-y-auto px-5 py-3">
          {loading && !list && <p className="text-[12.5px] text-ink-3">Loading recordings from {provider.name}…</p>}
          {list && list.length === 0 && <p className="text-[12.5px] text-ink-3">No recordings in this range.</p>}
          {list && list.length > 0 && (
            <ul className="space-y-2">
              {list.map((m) => (
                <li key={m.externalId} className={cx("rounded-lg border px-3.5 py-2.5", pick?.meeting.externalId === m.externalId ? "border-accent/50 bg-accent-soft/30" : "border-line")}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{m.title}</span>
                    <span className="num text-[11.5px] text-ink-3">
                      {clock(m.startTime)}
                      {mins(m.durationSec) ? ` · ${mins(m.durationSec)}` : ""}
                    </span>
                  </div>
                  {m.imported.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {m.imported.map((x) => (
                        <Badge key={x.meetingId} tone="neutral">
                          Imported to {x.companyName}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {m.items.length === 0 ? (
                    <p className="mt-1 text-[12px] text-ink-3">No transcript or audio available{provider.id === "google_meet" ? " (transcription was not turned on in this meeting)" : ""}.</p>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      {m.items.map((it) => (
                        <label key={it.id} className={cx("flex items-start gap-2 text-[12.5px]", it.importable ? "cursor-pointer text-ink-2" : "cursor-not-allowed text-ink-3")}>
                          <input type="radio" name="remote-item" className="mt-[3px]" disabled={!it.importable} checked={pick?.item.id === it.id && pick.meeting.externalId === m.externalId} onChange={() => choose(m, it)} />
                          <span>
                            {it.label}
                            {it.note && <span className={cx("block text-[11.5px]", it.importable ? "text-ink-3" : "text-warn")}>{it.note}</span>}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-3 border-t border-line px-5 py-3">
          {pick && (
            <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
              <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                Meeting
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={input} maxLength={200} />
              </label>
              <label className="flex flex-col gap-1 text-[12px] text-ink-3">
                Date
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
              </label>
            </div>
          )}
          {error && (
            <p className="text-[12.5px] text-risk">
              {error.message}
              {error.reauth && (
                <>
                  {" "}
                  <a href="/settings?tab=integrations" className="font-medium underline">
                    Reconnect in Settings
                  </a>
                </>
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11.5px] leading-snug text-ink-3">
              {pick?.item.kind === "AUDIO" ? "Audio is transcribed (≈ $0.02–0.03 / min, cap $3), then" : "The transcript is"} processed like an upload: freezes the current version as the pre-meeting analysis · one model pass (cap $0.10).
            </span>
            <Button variant="primary" className="ml-auto" onClick={() => void submit()} disabled={!pick || submitting}>
              {submitting ? "Importing…" : "Import meeting"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
