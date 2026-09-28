import Link from "next/link";
import { requireSession } from "@/server/session";
import { journal } from "@/formation/service";
import { Badge, Button, Empty, cx } from "@/components/ui";
import { DECISION_LABEL_F } from "@/formation/labels";

export const metadata = { title: "Journal · Formation" };

const TONE = { agree: "ok", diverge: "risk", neutral: "neutral" } as const;
const KIND = { IC: "IC", ANALYSIS: "Analysis", FOUNDER_MEETING: "Founder meeting", PROGRESS: "Progress" } as const;

export default async function JournalPage() {
  const s = await requireSession();
  const entries = journal(s);
  if (!entries.length)
    return (
      <Empty title="Your journal is empty" action={<Button href="/formation/practice" variant="primary">Start practice</Button>}>
        Every answer is recorded here before the reveal, exactly as you gave it, and compared later with the founder meeting, the IC decision and the company&apos;s progress.
      </Empty>
    );
  const divergences = entries.flatMap((e) => e.since.filter((d) => d.tone === "diverge")).length;
  const agreements = entries.flatMap((e) => e.since.filter((d) => d.tone === "agree")).length;
  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-[13px] text-ink-2">
        What you believed at the time — recorded before the answer was revealed and never edited — against what happened afterwards.{" "}
        <span className="text-ink-3">
          {entries.length} entries · {divergences} divergence{divergences === 1 ? "" : "s"} · {agreements} confirmation{agreements === 1 ? "" : "s"}.
        </span>
      </p>
      <ol className="space-y-4">
        {entries.map((e) => (
          <li key={e.attemptId} className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Link href={`/deals/${e.slug}`} className="font-medium text-ink hover:text-accent-text">
                {e.caseName}
              </Link>
              <span className="text-[12.5px] text-ink-2">{e.title}</span>
              <span className="num ml-auto text-[11.5px] text-ink-3">
                {e.at.slice(0, 10)} · deal v{e.versionNo} · {Math.round(e.confidence * 100)}% confident
              </span>
            </div>
            <div className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <div className="t-eyebrow mb-1">What you believed</div>
                <p className="line-clamp-5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{e.belief}</p>
                {e.decision && e.analysisAtTime && (
                  <p className={cx("mt-1 text-[12px]", e.decision === e.analysisAtTime ? "text-ink-3" : "text-ink-2")}>
                    You: {DECISION_LABEL_F[e.decision].toLowerCase()} · analysis at the time: {DECISION_LABEL_F[e.analysisAtTime].toLowerCase()}
                  </p>
                )}
              </div>
              <div>
                <div className="t-eyebrow mb-1">Since then</div>
                {e.since.length === 0 ? (
                  <p className="text-[12.5px] text-ink-3">Nothing new yet — no founder meeting, IC decision or later version since this answer.</p>
                ) : (
                  <ul className="space-y-1.5 text-[12.5px]">
                    {e.since.map((d, i) => (
                      <li key={i} className="flex gap-2">
                        <Badge tone={TONE[d.tone]} className="shrink-0">
                          {KIND[d.kind]}
                        </Badge>
                        <span className="text-ink-2">{d.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <div className="mt-2 text-right">
              <Link href={`/formation/review/${e.attemptId}`} className="text-[12px] text-accent-text hover:underline">
                Review the reveal
              </Link>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
