import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { loadDeal } from "@/server/deal";
import * as meetings from "@/server/meetings";
import { PostMeetingBrief, type TranscriptRefView } from "@/domain/meetings";
import { FocusFrame } from "@/components/deal/reports/focus-frame";
import { RichText } from "@/components/deal/rich-text";
import { Badge } from "@/components/ui";
import { DECISION_LABEL, date, decisionTone } from "@/lib/format";
import { enumLabel } from "@/reports/text";
import { BRIEF_PRINT_CSS, Empty, SheetSection, TranscriptRefs } from "@/components/deal/meetings/shared";
import { ChangeTable } from "@/components/deal/meetings/change-table";

const CONFLICT_TEXT = { DECK: "the deck", PRIOR_FOUNDER_STATEMENT: "an earlier founder statement", EXTERNAL_EVIDENCE: "external evidence", EXISTING_METRIC: "an existing metric", WITHIN_MEETING: "another statement in this meeting" } as const;

export default async function PostMeetingBriefPage({ params }: { params: Promise<{ slug: string; meetingId: string }> }) {
  const { slug, meetingId } = await params;
  const { company, version } = await loadDeal(slug);
  if (!version) return null;
  const m = meetings.getMeeting(company.id, meetingId);
  if (!m || !m.postBriefId) notFound();
  const row = meetings.getBrief(company.id, m.postBriefId)!;
  const parsed = PostMeetingBrief.safeParse(row.content);
  if (!parsed.success) notFound();
  const b = parsed.data;
  const s = company.slug;
  const tHref = `/deals/${s}/meetings/${m.id}/transcript`;
  const names = m.speakerNames;
  const Refs = ({ refs }: { refs: TranscriptRefView[] }) => <TranscriptRefs refs={refs} href={tHref} speakerNames={names} className="ml-1 align-baseline" />;

  return (
    <main className="mx-auto max-w-[1120px] px-4 py-6 sm:px-8 sm:py-8">
      <style>{BRIEF_PRINT_CSS}</style>
      <FocusFrame
        label="Post-meeting brief"
        meta={
          <span className="flex gap-3">
            <Link href={`/deals/${s}/meetings`} className="hover:text-ink">
              ← Meetings
            </Link>
            <Link href={`/deals/${s}/meetings/${m.id}/changes`} className="hover:text-ink">
              Full change view →
            </Link>
          </span>
        }
      >
        <article className="brief-doc print-page text-[13.5px] leading-[1.5] text-ink">
          <header className="border-b border-line-strong pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="t-eyebrow">Post-meeting brief · meeting {b.meeting.seq}</div>
                <h1 className="mt-0.5 text-[1.75em] font-semibold leading-tight tracking-tight">{b.company.name}</h1>
                <div className="mt-0.5 text-[0.92em] text-ink-2">
                  {b.meeting.title} · {date(b.meeting.heldAt)}
                  {b.meeting.participants.length > 0 && <> · {b.meeting.participants.map((p) => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}</>}
                </div>
              </div>
              <div className="flex flex-col items-start gap-1 sm:items-end">
                <span className="flex items-center gap-1.5">
                  <Badge tone={decisionTone(b.recommendation.before)}>{DECISION_LABEL[b.recommendation.before]}</Badge>
                  <span className="text-ink-3">→</span>
                  <Badge tone={decisionTone(b.recommendation.after)} dot>
                    {DECISION_LABEL[b.recommendation.after]}
                  </Badge>
                </span>
                <span className="text-[0.85em] text-ink-3">
                  v{b.preAnalysis.versionNo} ({b.preAnalysis.stageCode}) → v{b.postAnalysis.versionNo} ({b.postAnalysis.stageCode})
                </span>
              </div>
            </div>
            <p className="mt-2 max-w-[900px] text-[1.02em] leading-relaxed text-ink-2">{b.summary}</p>
          </header>

          <SheetSection n={1} title="What we discussed" className="!border-t-0">
            {b.discussed.length ? (
              <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2 print:grid-cols-2">
                {b.discussed.map((d, i) => (
                  <li key={i} className="brief-item leading-snug">
                    <span className="font-medium">{d.topic}.</span> <span className="text-ink-2">{d.summary}</span>
                    <Refs refs={d.refs} />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Not recorded.</Empty>
            )}
          </SheetSection>

          <div className="grid gap-x-8 md:grid-cols-2 print:grid-cols-2">
            <SheetSection n={2} title="New information" note="company-reported">
              {b.newInformation.length ? (
                <ul className="space-y-1">
                  {b.newInformation.map((x, i) => (
                    <Item key={i} refs={<Refs refs={x.refs} />} id={x.targetId} slug={s}>
                      {x.statement} <span className="text-[0.82em] text-ink-3">· {x.category.toLowerCase()}</span>
                    </Item>
                  ))}
                </ul>
              ) : (
                <Empty>Nothing that was not already in the deck or research.</Empty>
              )}
            </SheetSection>
            <SheetSection n={3} title="Clarifications" note="existed, now better defined">
              {b.clarifications.length ? (
                <ul className="space-y-1.5">
                  {b.clarifications.map((x, i) => (
                    <Item key={i} refs={<Refs refs={x.refs} />} id={x.targetId} slug={s}>
                      <span className="font-medium">{x.subject}</span>
                      <div className="text-[0.95em] text-ink-2">
                        <span className="text-ink-3">Before:</span> {x.before} <span className="text-ink-3">→ Founder:</span> {x.clarified}
                      </div>
                      <div className="text-[0.92em] text-ink-3">{x.implication}</div>
                    </Item>
                  ))}
                </ul>
              ) : (
                <Empty>No definitions were clarified.</Empty>
              )}
            </SheetSection>
          </div>

          <div className="grid gap-x-8 md:grid-cols-2 print:grid-cols-2">
            <SheetSection n={4} title="Confirmations" note="still company-reported, not verified">
              {b.confirmations.length ? (
                <ul className="space-y-1">
                  {b.confirmations.map((x, i) => (
                    <Item key={i} refs={<Refs refs={x.refs} />} id={x.claimId} slug={s}>
                      {x.statement} <span className="text-ink-2">— {x.detail}</span>
                    </Item>
                  ))}
                </ul>
              ) : (
                <Empty>None.</Empty>
              )}
            </SheetSection>
            <SheetSection n={5} title="Contradictions">
              {b.contradictions.length ? (
                <ul className="space-y-1.5">
                  {b.contradictions.map((x, i) => (
                    <Item key={i} refs={<Refs refs={x.refs} />} id={x.targetId} slug={s} tone="risk">
                      <span className="font-medium">{x.statement}</span>
                      {!x.material && <span className="text-[0.82em] text-ink-3"> · minor</span>}
                      <div className="text-[0.95em] text-ink-2">
                        <span className="text-ink-3">Conflicts with {CONFLICT_TEXT[x.conflictsWith]}:</span> {x.priorStatement}
                      </div>
                    </Item>
                  ))}
                </ul>
              ) : (
                <Empty>No contradiction identified.</Empty>
              )}
            </SheetSection>
          </div>

          <SheetSection n={6} title="What remains unanswered" note={`${b.unanswered.length} open`}>
            {b.unanswered.length ? (
              <ul className="grid gap-x-8 gap-y-1 md:grid-cols-2 print:grid-cols-2">
                {b.unanswered.map((u) => (
                  <li key={u.id} className="brief-item flex gap-2 leading-snug">
                    <span className="shrink-0 font-mono text-[0.8em] leading-[1.9] text-ink-3">{u.id}</span>
                    <span>
                      {u.text} <span className="text-[0.82em] text-ink-3">· {enumLabel(u.status).toLowerCase()}</span>
                      {u.note && <span className="block text-[0.9em] text-ink-3">{u.note}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>Every briefed question was resolved.</Empty>
            )}
          </SheetSection>

          <SheetSection n={7} title="What changed" note="material dimension changes · Before and After computed from the two versions">
            {b.whatChanged.length ? <ChangeTable rows={b.whatChanged} transcriptHref={tHref} speakerNames={names} compact /> : <Empty>No material dimension changed. The meeting did not move the analysis.</Empty>}
          </SheetSection>

          <SheetSection n={8} title="Next action">
            <p className="text-[1.08em] font-medium leading-snug">{b.nextAction.action}</p>
            <p className="text-ink-2">
              {b.nextAction.rationale} <span className="text-[0.85em] text-ink-3">· {enumLabel(b.nextAction.type).toLowerCase()}</span>
            </p>
          </SheetSection>

          <footer className="mt-4 flex flex-wrap justify-between gap-2 border-t border-line pt-2 text-[0.8em] text-ink-3">
            <span>
              {b.company.name} · Post-meeting brief · {row.id} · {date(row.createdAt)} · immutable · {row.generation.promptVersion}
            </span>
            <span>
              {b.anchoring.anchored}/{b.anchoring.items} items anchored to the verbatim transcript
              {b.anchoring.unanchored.length > 0 && ` · not anchored: ${b.anchoring.unanchored.slice(0, 3).join("; ")}`}. Founder statements remain company-reported.
            </span>
          </footer>
        </article>
      </FocusFrame>
    </main>
  );
}

function Item({ children, refs, id, slug, tone }: { children: ReactNode; refs: ReactNode; id: string | null; slug: string; tone?: "risk" }) {
  return (
    <li className={tone === "risk" ? "brief-item border-l-2 border-risk/50 pl-2.5 leading-snug" : "brief-item leading-snug"}>
      {id && (
        <span className="mr-1 align-baseline">
          <RichText text={id} slug={slug} className="font-mono text-[0.78em]" />
        </span>
      )}
      {children}
      {refs}
    </li>
  );
}
