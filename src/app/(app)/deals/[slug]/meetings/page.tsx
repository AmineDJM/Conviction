import Link from "next/link";
import type { ReactNode } from "react";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { canWrite } from "@/server/session";
import { PRE_MEETING_BRIEF_BUILDER, PostMeetingBrief, formatTimestamp } from "@/domain/meetings";
import { Badge, Section, cx } from "@/components/ui";
import { DECISION_LABEL, date, decisionTone, titleCase } from "@/lib/format";
import { MeetingForm } from "@/components/deal/meetings/meeting-form";
import { PreBriefButton } from "@/components/deal/meetings/pre-brief-button";
import { MeetingRun } from "@/components/deal/meetings/meeting-run";
import { StageBadge } from "@/components/deal/meetings/shared";

const SOURCE_TEXT: Record<string, string> = { PASTED_TRANSCRIPT: "Pasted transcript", TRANSCRIPT_FILE: "Transcript file", RECORDING_UPLOAD: "Recording (transcribed)", ZOOM: "Zoom", GOOGLE_MEET: "Google Meet" };
const STATUS_TONE = { TRANSCRIBING: "accent", PROCESSING: "accent", READY: "ok", FAILED: "risk" } as const;

type StepState = "done" | "current" | "pending" | "optional";

export default async function MeetingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { session, company, version, run } = await loadDeal(slug);
  if (!version) return null;
  const s = company.slug;
  const writable = canWrite(session);
  const stages = meetings.versionStages(company.id);
  const curStage = stages.get(version.row.id);
  const list = meetings.listMeetings(company.id);
  const latest = list[list.length - 1] ?? null;
  const running = !!run && (run.status === "RUNNING" || run.status === "QUEUED");
  const activeMeeting = running ? list.find((m) => m.runId === run!.id) : undefined;
  const nextPreBrief = meetings.preBriefForVersion(version.row.id, PRE_MEETING_BRIEF_BUILDER);
  const versions = new Map(repo.listVersions(company.id).map((v) => [v.id, v]));
  const vNo = (id: string | null) => (id ? (versions.get(id)?.versionNo ?? null) : null);
  const docs = repo.listDocuments(company.id);
  const hasDeck = docs.some((d) => d.kind !== "TRANSCRIPT" && d.kind !== "OTHER");

  // Canonical workflow for the cycle in view: the latest meeting, or the meeting being prepared.
  const cycleDone = latest && latest.status === "READY" && latest.postAnalysisVersionId === version.row.id;
  const inFlight = latest && latest.status !== "READY" && latest.status !== "FAILED";
  const m = cycleDone || inFlight ? latest : null;
  const decision = version.derived.recommendation.status;
  const flow: { label: string; state: StepState; detail: ReactNode }[] = [
    { label: "Deck uploaded", state: hasDeck ? "done" : "pending", detail: hasDeck ? `${docs.filter((d) => d.kind !== "TRANSCRIPT" && d.kind !== "OTHER").length} document(s)` : "—" },
    { label: "Pre-meeting analysis", state: "done", detail: m ? `v${vNo(m.preAnalysisVersionId)}` : `v${version.row.versionNo} · ${curStage?.label ?? ""}` },
    { label: "Pre-meeting brief", state: (m ? m.preBriefId : nextPreBrief) ? "done" : "current", detail: (m ? m.preBriefId : nextPreBrief) ? "ready" : "to prepare" },
    { label: "Founder meeting", state: m ? "done" : (nextPreBrief ? "current" : "pending"), detail: m ? date(m.heldAt) : "—" },
    { label: "Transcription", state: m ? (m.status === "TRANSCRIBING" ? "current" : "done") : "pending", detail: m ? (m.source === "RECORDING_UPLOAD" ? (m.transcription ? `${m.transcription.diarized ? "speakers + " : ""}timestamps` : "running") : "transcript provided") : "—" },
    { label: "Post-meeting brief", state: m?.postBriefId ? "done" : m?.status === "PROCESSING" ? "current" : "pending", detail: m?.postBriefId ? "ready" : "—" },
    { label: "Post-meeting analysis", state: m?.postAnalysisVersionId ? "done" : m?.status === "PROCESSING" ? "current" : "pending", detail: m?.postAnalysisVersionId ? (stages.get(m.postAnalysisVersionId)?.code.replace("POST_MEETING_ANALYSIS_", "") ?? "") : "—" },
    { label: "Deep DD / IC", state: "optional", detail: decision === "DEEP_DD" || decision === "IC_READY" ? DECISION_LABEL[decision] : "optional" },
  ];

  return (
    <main className="mx-auto max-w-[1180px] space-y-12 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div className="max-w-[760px]">
          <div className="t-eyebrow mb-1.5">Founder meetings</div>
          <p className="text-[14px] leading-relaxed text-ink-2">
            Each meeting produces four separate, immutable objects: the <strong className="font-medium text-ink">pre-meeting analysis</strong> it was held against (frozen), the <strong className="font-medium text-ink">pre-meeting brief</strong>, the{" "}
            <strong className="font-medium text-ink">post-meeting brief</strong> and a new <strong className="font-medium text-ink">post-meeting analysis</strong>. Earlier conclusions are never overwritten: the change view shows Before, what the founder said, and After.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span className="text-[12px] text-ink-3">Current version</span>
          <span className="flex items-center gap-2">
            <span className="num text-[13px] text-ink-2">v{version.row.versionNo}</span>
            {curStage && <StageBadge stage={curStage.stage} label={curStage.label} />}
          </span>
        </div>
      </div>

      {/* Canonical workflow */}
      <ol className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 lg:grid-cols-8" aria-label="Meeting workflow">
        {flow.map((f, i) => (
          <li key={f.label} className={cx("bg-surface px-3 py-2.5", f.state === "current" && "bg-accent-soft/40")}>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
              <span className={cx("h-1.5 w-1.5 rounded-full", f.state === "done" && "bg-ok", f.state === "current" && "bg-accent", f.state === "pending" && "bg-line-strong", f.state === "optional" && "bg-ink-3/40")} />
              <span className="num">{i + 1}</span>
            </div>
            <div className={cx("mt-0.5 text-[12.5px] leading-tight", f.state === "pending" ? "text-ink-3" : "font-medium text-ink")}>{f.label}</div>
            <div className="num mt-0.5 truncate text-[11.5px] text-ink-3">{f.detail}</div>
          </li>
        ))}
      </ol>

      {running && run && (
        <Section eyebrow="In progress" title={activeMeeting ? `${activeMeeting.title} — processing` : "An analysis run is in progress"}>
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <MeetingRun runId={run.id} initial={run.progress} />
          </div>
        </Section>
      )}

      <Section
        id="next"
        eyebrow={list.length ? `Meeting ${list.length + 1}` : "First meeting"}
        title="Prepare, then record the meeting"
        action={
          nextPreBrief ? (
            <Link href={`/deals/${s}/meetings/pre-brief/${nextPreBrief.id}`} className="text-[12.5px] text-ink-2 hover:text-ink">
              Open pre-meeting brief →
            </Link>
          ) : null
        }
      >
        <div className="grid gap-8 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">
            <p>
              The meeting will be held against <span className="font-medium text-ink">v{version.row.versionNo}</span>
              {curStage && <> ({curStage.label.toLowerCase()})</>}. It is frozen as this meeting&apos;s pre-meeting analysis when the transcript is added.
            </p>
            {nextPreBrief ? (
              <p>
                Pre-meeting brief ready · {date(nextPreBrief.createdAt)} ·{" "}
                {nextPreBrief.generation.mode === "DETERMINISTIC_PLUS_MODEL" ? `objectives phrased by the model ($${nextPreBrief.generation.costUsd.toFixed(4)})` : "rendered from the analysis"}.
              </p>
            ) : (
              <p>One page, 1–2 minutes: what the company is, what matters most, the meeting objectives and the questions whose answers change the decision.</p>
            )}
            {!nextPreBrief && writable && <PreBriefButton companyId={company.id} slug={s} />}
            <p className="text-[12px] text-ink-3">
              Zoom and Google Meet import are optional and not required — see <Link href="/settings?tab=integrations" className="text-ink-2 hover:text-ink">Settings → Integrations</Link>. Upload the recording or its transcript here.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-surface px-5 py-4">
            <MeetingForm companyId={company.id} canWrite={writable} busy={running} />
          </div>
        </div>
      </Section>

      <Section eyebrow="Timeline" title={list.length ? `${list.length} founder meeting${list.length > 1 ? "s" : ""}` : "No founder meeting yet"}>
        {list.length === 0 ? (
          <p className="text-[13px] text-ink-3">The pre-meeting analysis (v{version.row.versionNo}) is the current state. Add the first meeting above.</p>
        ) : (
          <ol className="space-y-4">
            {[...list].reverse().map((mt) => {
              const pre = stages.get(mt.preAnalysisVersionId);
              const post = mt.postAnalysisVersionId ? stages.get(mt.postAnalysisVersionId) : null;
              const brief = mt.postBriefId ? meetings.getBrief(company.id, mt.postBriefId) : null;
              const pb = brief ? PostMeetingBrief.safeParse(brief.content) : null;
              const content = pb?.success ? pb.data : null;
              const base = `/deals/${s}/meetings/${mt.id}`;
              return (
                <li key={mt.id} className="rounded-lg border border-line bg-surface">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="num text-[12px] text-ink-3">#{mt.seq}</span>
                        <span className="text-[14px] font-medium text-ink">{mt.title}</span>
                        <Badge tone={STATUS_TONE[mt.status]}>{titleCase(mt.status)}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                        <span>{date(mt.heldAt)}</span>
                        <span>{SOURCE_TEXT[mt.source]}</span>
                        {mt.transcription && (
                          <span className="num">
                            {mt.transcription.durationSec ? `${formatTimestamp(mt.transcription.durationSec)} audio · ` : ""}
                            {mt.transcription.diarized ? "speakers identified" : "no speaker labels"} · {mt.transcription.model}
                          </span>
                        )}
                        {mt.participants.length > 0 && <span>{mt.participants.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}</span>}
                      </div>
                    </div>
                    <div className="flex gap-3 text-[12.5px]">
                      <Link href={`${base}/transcript`} className="text-ink-2 hover:text-ink">
                        Transcript
                      </Link>
                      {mt.postAnalysisVersionId && (
                        <Link href={`${base}/changes`} className="font-medium text-ink hover:text-accent-text">
                          What changed after the meeting? →
                        </Link>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
                    <ObjectCell n={1} title="Pre-meeting analysis" href={`/deals/${s}/memo?v=${mt.preAnalysisVersionId}`} meta={`v${vNo(mt.preAnalysisVersionId)} · ${pre?.code ?? "—"} · frozen`} />
                    <ObjectCell n={2} title="Pre-meeting brief" href={mt.preBriefId ? `/deals/${s}/meetings/pre-brief/${mt.preBriefId}` : null} meta={mt.preBriefId ? "1 page" : "—"} />
                    <ObjectCell n={3} title="Post-meeting brief" href={mt.postBriefId ? `${base}/post-brief` : null} meta={content ? `${content.whatChanged.length} material change(s) · ${content.contradictions.length} contradiction(s)` : mt.status === "FAILED" ? "not produced" : "pending"} />
                    <ObjectCell n={4} title={post ? post.label : "Post-meeting analysis"} href={mt.postAnalysisVersionId ? `/deals/${s}/memo?v=${mt.postAnalysisVersionId}` : null} meta={mt.postAnalysisVersionId ? `v${vNo(mt.postAnalysisVersionId)} · ${post?.code}` : mt.status === "FAILED" ? "not produced" : "pending"} />
                  </div>
                  {content && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[12.5px]">
                      <span className="text-ink-3">Recommendation</span>
                      <Badge tone={decisionTone(content.recommendation.before)}>{DECISION_LABEL[content.recommendation.before]}</Badge>
                      <span className="text-ink-3">→</span>
                      <Badge tone={decisionTone(content.recommendation.after)} dot>
                        {DECISION_LABEL[content.recommendation.after]}
                      </Badge>
                      <span className="text-ink-3">· Next:</span>
                      <span className="min-w-0 flex-1 truncate text-ink-2" title={content.nextAction.action}>
                        {content.nextAction.action}
                      </span>
                    </div>
                  )}
                  {mt.status === "FAILED" && mt.error && <div className="border-t border-line px-5 py-2.5 text-[12.5px] text-risk">{mt.error}</div>}
                </li>
              );
            })}
          </ol>
        )}
        {[...stages.values()].some((x) => x.stage === "DECK_REANALYSIS") && (
          <p className="mt-3 text-[12px] text-warn">The deck was re-analysed after a meeting. That version is labelled “Deck re-analysis” and does not include the founder discussion.</p>
        )}
      </Section>
    </main>
  );
}

function ObjectCell({ n, title, href, meta }: { n: number; title: string; href: string | null; meta: string }) {
  const body = (
    <>
      <div className="num text-[11px] text-ink-3">{String(n).padStart(2, "0")}</div>
      <div className={cx("text-[13px] font-medium", href ? "text-ink group-hover:text-accent-text" : "text-ink-3")}>{title}</div>
      <div className="num mt-0.5 truncate text-[11.5px] text-ink-3">{meta}</div>
    </>
  );
  return href ? (
    <Link href={href} className="group block bg-surface px-5 py-3 hover:bg-surface-2">
      {body}
    </Link>
  ) : (
    <div className="bg-surface px-5 py-3">{body}</div>
  );
}
