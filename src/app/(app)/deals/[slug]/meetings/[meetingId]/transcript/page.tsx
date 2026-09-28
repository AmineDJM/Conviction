import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDeal } from "@/server/deal";
import * as meetings from "@/server/meetings";
import { canWrite } from "@/server/session";
import { formatTimestamp } from "@/domain/meetings";
import { PrintButton } from "@/components/deal/reports/print-button";
import { SpeakerNames } from "@/components/deal/meetings/speaker-names";
import { date } from "@/lib/format";

/** Verbatim transcript. Every turn is addressable (#T-12) so briefs and claims link to the exact moment. */
export default async function TranscriptPage({ params }: { params: Promise<{ slug: string; meetingId: string }> }) {
  const { slug, meetingId } = await params;
  const { session, company, version } = await loadDeal(slug);
  if (!version) return null;
  const m = meetings.getMeeting(company.id, meetingId);
  if (!m) notFound();
  const segs = meetings.getSegments(m.id);
  const labels = [...new Set(segs.map((x) => x.speaker).filter((x): x is string => !!x))];
  const name = (l: string | null) => (l ? (m.speakerNames[l] ?? l) : null);
  return (
    <main className="mx-auto max-w-[920px] px-4 py-6 sm:px-8 sm:py-8">
      <div className="no-print mb-5 flex flex-wrap items-center justify-between gap-3 text-[12px] text-ink-3">
        <span className="flex gap-3">
          <span className="t-eyebrow">Transcript</span>
          <Link href={`/deals/${company.slug}/meetings`} className="hover:text-ink">
            ← Meetings
          </Link>
          {m.postBriefId && (
            <Link href={`/deals/${company.slug}/meetings/${m.id}/post-brief`} className="hover:text-ink">
              Post-meeting brief →
            </Link>
          )}
        </span>
        <PrintButton />
      </div>
      <header className="mb-5 border-b border-line-strong pb-3">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{m.title}</h1>
        <div className="mt-1 text-[12.5px] text-ink-3">
          {company.name} · {date(m.heldAt)} · {segs.length} turns
          {m.transcription && ` · transcribed with ${m.transcription.model}${m.transcription.diarized ? " (speakers + timestamps)" : " (timestamps only)"}`}
          {m.participants.length > 0 && ` · ${m.participants.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}`}
        </div>
      </header>
      {labels.length > 0 && m.source === "RECORDING_UPLOAD" && (
        <div className="mb-6">
          <SpeakerNames companyId={company.id} meetingId={m.id} labels={labels} initial={m.speakerNames} canWrite={canWrite(session)} />
        </div>
      )}
      {segs.length === 0 ? (
        <p className="text-[13px] text-ink-3">{m.status === "TRANSCRIBING" ? "Transcription in progress." : "No transcript."}</p>
      ) : (
        <ol className="space-y-3">
          {segs.map((x) => (
            <li key={x.ref} id={x.ref} className="grid scroll-mt-28 grid-cols-[64px_1fr] gap-3 rounded-md px-2 py-1 target:bg-accent-soft/50">
              <div className="pt-[2px] text-right">
                <a href={`#${x.ref}`} className="num block font-mono text-[11px] text-ink-3 hover:text-ink">
                  {x.ref}
                </a>
                {x.startSec !== null && <span className="num block text-[11px] text-ink-3">{formatTimestamp(x.startSec)}</span>}
              </div>
              <div className="min-w-0">
                {x.speaker && <div className="text-[12px] font-medium text-ink-2">{name(x.speaker)}{m.speakerNames[x.speaker] && <span className="ml-1 font-mono text-[10.5px] font-normal text-ink-3">{x.speaker}</span>}</div>}
                <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-ink">{x.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-6 border-t border-line pt-2 text-[11.5px] text-ink-3">Verbatim as provided or transcribed. Stored encrypted as a transcript document; speaker names are display labels and never rewrite the text.</p>
    </main>
  );
}
