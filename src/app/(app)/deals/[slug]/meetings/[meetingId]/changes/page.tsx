import Link from "next/link";
import { notFound } from "next/navigation";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { applyOverrides } from "@/engine/overrides";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import type { MeetingGuard } from "@/orchestration/assemble";
import { meetingDiff, sortChanges } from "@/reports/meeting-diff";
import { FocusFrame } from "@/components/deal/reports/focus-frame";
import { ChangeTable } from "@/components/deal/meetings/change-table";
import { BRIEF_PRINT_CSS, StageBadge } from "@/components/deal/meetings/shared";
import { cx } from "@/components/ui";
import { date } from "@/lib/format";

/** "What changed after the meeting?" — the frozen PRE_MEETING_ANALYSIS vs the POST_MEETING_ANALYSIS it produced. */
export default async function MeetingChangesPage({ params, searchParams }: { params: Promise<{ slug: string; meetingId: string }>; searchParams: Promise<{ all?: string }> }) {
  const { slug, meetingId } = await params;
  const all = (await searchParams).all === "1";
  const { company, version } = await loadDeal(slug);
  if (!version) return null;
  const m = meetings.getMeeting(company.id, meetingId);
  if (!m || !m.postAnalysisVersionId) notFound();
  const preRaw = repo.getVersion(company.id, m.preAnalysisVersionId);
  const postRaw = repo.getVersion(company.id, m.postAnalysisVersionId);
  if (!preRaw || !postRaw) notFound();
  // Compare the effective deals (raw extraction + analyst overrides) — the objects each version's derived analysis scored.
  const pre = { ...preRaw, canonical: applyOverrides(preRaw.canonical) };
  const post = { ...postRaw, canonical: applyOverrides(postRaw.canonical) };
  const stages = meetings.versionStages(company.id);
  const ex = m.extraction as { promptVersion: string; output: FounderCallOutput; guards: MeetingGuard[] } | null;
  const rows = sortChanges(meetingDiff(pre, post, { extraction: ex?.output ?? null, segments: meetings.getSegments(m.id), guards: ex?.guards ?? [] }));
  const shown = all ? rows : rows.filter((r) => r.material);
  const s = company.slug;
  const base = `/deals/${s}/meetings/${m.id}`;
  const ps = stages.get(pre.row.id);
  const qs = stages.get(post.row.id);

  return (
    <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-8 sm:py-8">
      <style>{BRIEF_PRINT_CSS}</style>
      <FocusFrame
        label="What changed after the meeting?"
        meta={
          <Link href={`/deals/${s}/meetings`} className="hover:text-ink">
            ← Meetings
          </Link>
        }
      >
        <article className="brief-doc print-page text-[13.5px] leading-[1.5] text-ink">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-4 border-b border-line-strong pb-3">
            <div>
              <div className="t-eyebrow">What changed after the meeting?</div>
              <h1 className="mt-0.5 text-[1.5em] font-semibold tracking-tight">
                {company.name} · {m.title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.9em] text-ink-3">
                <Link href={`/deals/${s}/memo?v=${pre.row.id}`} className="hover:text-ink">
                  v{pre.row.versionNo}
                </Link>
                {ps && <StageBadge stage={ps.stage} label={ps.code} />}
                <span>→</span>
                <Link href={`/deals/${s}/memo?v=${post.row.id}`} className="hover:text-ink">
                  v{post.row.versionNo}
                </Link>
                {qs && <StageBadge stage={qs.stage} label={qs.code} />}
                <span>· {date(m.heldAt)}</span>
              </div>
            </div>
            <div className="no-print flex gap-1 text-[12.5px]">
              <Link href={base + "/changes"} className={cx("rounded-md px-2.5 py-1", !all ? "bg-surface-3 font-medium text-ink" : "text-ink-3 hover:text-ink")}>
                Material ({rows.filter((r) => r.material).length})
              </Link>
              <Link href={base + "/changes?all=1"} className={cx("rounded-md px-2.5 py-1", all ? "bg-surface-3 font-medium text-ink" : "text-ink-3 hover:text-ink")}>
                All changes ({rows.length})
              </Link>
            </div>
          </header>
          {shown.length ? (
            <ChangeTable rows={shown} transcriptHref={`${base}/transcript`} speakerNames={m.speakerNames} />
          ) : (
            <p className="py-6 text-ink-3">{all ? "Nothing changed between the two versions." : "No material dimension changed. Switch to “All changes” for minor movements."}</p>
          )}
          <footer className="mt-4 space-y-1 border-t border-line pt-2 text-[0.8em] text-ink-3">
            <p>Before and After are computed by code from the two stored versions (ratings, statuses, levels, metrics, gaps, questions, risks, recommendation). “Founder said” and “Reason” come from the post-meeting extraction ({ex ? ex.promptVersion : "not stored"}) and link to the transcript.</p>
            <p>Founder statements are company-reported: code limits what they alone can raise (one notch; never to Exceptional; conditions at most partially supported; risks reduced at most one level). Both versions remain available; nothing was overwritten. Indices are not probabilities.</p>
          </footer>
        </article>
      </FocusFrame>
    </main>
  );
}
