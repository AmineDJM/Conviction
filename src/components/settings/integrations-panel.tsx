import type { ConnectorStatus } from "@/server/connectors/meeting-connectors";
import { Badge } from "@/components/ui";

/**
 * Meeting platform connectors. Optional: the meetings workflow works fully by
 * upload. Configuration is environment-based (read-only here); no connector is
 * enabled in this build, and none pretends to be.
 */
export function IntegrationsPanel({ connectors, transcriptionModel }: { connectors: ConnectorStatus[]; transcriptionModel: string }) {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-[15px] font-semibold text-ink">Meeting recordings</h2>
        <p className="mt-1 max-w-[760px] text-[13px] leading-relaxed text-ink-2">
          Founder meetings are added on each deal&apos;s <span className="font-medium text-ink">Meetings</span> tab: paste a transcript, upload a transcript file (.txt, .md, .vtt, .srt — Zoom and Google Meet exports work as they are), or upload the recording. Recordings are
          transcribed with <span className="font-mono text-[12px]">{transcriptionModel}</span> (speaker labels and timestamps), stored encrypted, and cost is recorded per meeting. No integration is required.
        </p>
      </section>
      <section className="space-y-3">
        {connectors.map((c) => (
          <div key={c.id} className="rounded-lg border border-line bg-surface px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-medium text-ink">{c.name}</span>
                <Badge tone={c.state === "NOT_CONFIGURED" ? "unknown" : "warn"}>{c.state === "NOT_CONFIGURED" ? "Not configured" : "Credentials present · import not enabled"}</Badge>
              </div>
              <a href={c.docs} target="_blank" rel="noreferrer" className="text-[12px] text-ink-3 hover:text-ink">
                API documentation ↗
              </a>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">{c.detail}</p>
            <dl className="mt-3 grid gap-x-8 gap-y-1 text-[12px] sm:grid-cols-[160px_1fr]">
              <dt className="text-ink-3">Environment</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {c.envVars.map((e) => (
                  <span key={e.name} className="font-mono text-[11.5px]">
                    {e.name} <span className={e.present ? "text-ok" : "text-ink-3"}>{e.present ? (e.secret ? "set (hidden)" : "set") : "not set"}</span>
                  </span>
                ))}
              </dd>
              <dt className="text-ink-3">OAuth redirect path</dt>
              <dd className="font-mono text-[11.5px] text-ink-2">{c.redirectPath}</dd>
              <dt className="text-ink-3">Scopes</dt>
              <dd className="font-mono text-[11.5px] text-ink-2">{c.scopes.join(" ")}</dd>
            </dl>
          </div>
        ))}
      </section>
      <p className="max-w-[760px] text-[12px] leading-relaxed text-ink-3">
        Credentials are read from the server environment (never stored in the database or shown). Automatic import from Zoom or Google Meet is a documented extension point (src/server/connectors/meeting-connectors.ts); until it is implemented behind a real OAuth flow, download the recording or transcript and upload it.
      </p>
    </div>
  );
}
