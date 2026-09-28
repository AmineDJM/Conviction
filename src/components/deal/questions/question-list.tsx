"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FounderQuestion } from "@/domain/canonical";
import { Badge, Button, cx } from "@/components/ui";
import { date, titleCase } from "@/lib/format";
import { QUESTION_STATUS_TEXT, questionStatusTone } from "./labels";
import { QuestionFeedback, type GivenFeedback } from "./question-feedback";


const TIERS: { tier: FounderQuestion["tier"]; label: string; note: string }[] = [
  { tier: "MUST_ASK", label: "Must ask", note: "The answer can change the recommendation" },
  { tier: "IMPORTANT", label: "Important", note: "Changes the next diligence step, valuation or risk" },
  { tier: "OPTIONAL", label: "Optional", note: "Ask if time allows" },
];

export function QuestionList({
  questions,
  companyId,
  versionId,
  canWrite,
  feedback = {},
  meetingId = null,
}: {
  questions: FounderQuestion[];
  companyId: string;
  versionId: string;
  canWrite: boolean;
  /** The viewer's usefulness judgements, by question id. */
  feedback?: Record<string, GivenFeedback>;
  /** Latest processed founder meeting, if any: feedback on asked questions is then recorded against it. */
  meetingId?: string | null;
}) {
  if (!questions.length) return <p className="text-ink-3">No founder questions passed the decision test (each must change something depending on the answer).</p>;
  return (
    <div className="space-y-10">
      {TIERS.map(({ tier, label, note }) => {
        const qs = questions.filter((q) => q.tier === tier);
        if (!qs.length) return null;
        const done = qs.filter((q) => q.status === "RESOLVED").length;
        return (
          <section key={tier}>
            <div className="mb-2 flex items-baseline gap-3 border-b border-line pb-2">
              <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
              <span className="text-[12px] text-ink-3">{note}</span>
              <span className="num ml-auto text-[12px] text-ink-3">
                {done}/{qs.length} resolved
              </span>
            </div>
            <ol className="divide-y divide-line">
              {qs.map((q) => (
                <QuestionItem key={q.id} q={q} companyId={companyId} versionId={versionId} canWrite={canWrite} feedback={feedback[q.id] ?? null} meetingId={meetingId} />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function QuestionItem({ q, companyId, versionId, canWrite, feedback, meetingId }: { q: FounderQuestion; companyId: string; versionId: string; canWrite: boolean; feedback: GivenFeedback | null; meetingId: string | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [answer, setAnswer] = useState(q.answer ?? "");
  const [note, setNote] = useState(q.resolutionNote ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const post = async (status: FounderQuestion["status"], withAnswer: boolean, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const body: Record<string, unknown> = { questionId: q.id, status, versionId };
      if (withAnswer) {
        body.answer = answer.trim() || null;
        body.note = note.trim() || null;
      }
      const r = await fetch(`/api/deals/${companyId}/questions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <li id={q.id} className="scroll-mt-40 py-5">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <span className="num mt-[3px] font-mono text-[11px] text-ink-3">{q.id}</span>
        <p className="min-w-0 flex-1 text-[14.5px] font-medium leading-snug text-ink">{q.question}</p>
        <Badge tone={questionStatusTone(q.status)} dot>
          {QUESTION_STATUS_TEXT[q.status]}
        </Badge>
      </div>
      <div className="mt-3 grid gap-x-8 gap-y-3 pl-[46px] text-[13px] md:grid-cols-2">
        <div>
          <div className="t-eyebrow mb-0.5">Why it matters</div>
          <p className="leading-relaxed text-ink-2">{q.whyItMatters}</p>
        </div>
        <div>
          <div className="t-eyebrow mb-0.5">What we already know</div>
          <p className="leading-relaxed text-ink-2">{q.knownContext}</p>
        </div>
        <div className="rounded-md border border-line bg-surface px-3 py-2">
          <div className="mb-0.5 text-[12px] font-medium text-ink">If answer A →</div>
          <p className="leading-relaxed text-ink-2">{q.ifAnswerA}</p>
        </div>
        <div className="rounded-md border border-line bg-surface px-3 py-2">
          <div className="mb-0.5 text-[12px] font-medium text-ink">If answer B →</div>
          <p className="leading-relaxed text-ink-2">{q.ifAnswerB}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-[46px]">
        <span className="text-[11.5px] text-ink-3">Affects</span>
        {q.affects.map((a) => (
          <span key={a} className="rounded-[5px] bg-surface-3 px-1.5 py-[1px] text-[11.5px] text-ink-2">
            {titleCase(a)}
          </span>
        ))}
      </div>

      {(q.answer || q.resolutionNote) && !editing && (
        <div className="mt-3 ml-[46px] border-l-2 border-line-strong pl-3 text-[13px]">
          {q.answer && (
            <p className="text-ink">
              <span className="text-ink-3">Answer{q.answeredAt ? ` (${date(q.answeredAt)})` : ""}: </span>
              {q.answer}
            </p>
          )}
          {q.resolutionNote && <p className="mt-1 text-ink-2"><span className="text-ink-3">Implication: </span>{q.resolutionNote}</p>}
        </div>
      )}

      {canWrite && (
        <div className="mt-3 pl-[46px]">
          {editing ? (
            <div className="max-w-[760px] space-y-2 rounded-lg border border-line bg-surface px-3 py-3">
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-3">Answer as given (factual — what was and was not answered)</span>
                <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={3} autoFocus className="w-full resize-y rounded-md border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus-visible:border-accent" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] text-ink-3">Implication for the analysis (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} className="h-8 w-full rounded-md border border-line bg-bg px-2 text-[13px] outline-none focus-visible:border-accent" />
              </label>
              {error && <p className="text-[12px] text-risk">{error}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" disabled={!!busy || !answer.trim()} onClick={() => post("RESOLVED", true, "res")}>
                  {busy === "res" ? "Saving…" : "Save · resolved"}
                </Button>
                <Button size="sm" disabled={!!busy || !answer.trim()} onClick={() => post("NOT_FULLY_RESOLVED", true, "nfr")}>
                  {busy === "nfr" ? "Saving…" : "Save · not fully resolved"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post(q.status === "OPEN" ? "ASKED" : q.status, true, "ans")}>
                  {busy === "ans" ? "Saving…" : "Save answer only"}
                </Button>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className={cx("flex flex-wrap items-center gap-1.5")}>
              {q.status === "OPEN" && (
                <Button size="sm" disabled={!!busy} onClick={() => post("ASKED", false, "ask")}>
                  {busy === "ask" ? "Saving…" : "Mark asked"}
                </Button>
              )}
              <Button size="sm" variant={q.status === "OPEN" ? "ghost" : "secondary"} onClick={() => setEditing(true)}>
                {q.answer ? "Edit answer" : "Record answer"}
              </Button>
              {q.status !== "RESOLVED" && q.status !== "OPEN" && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post("RESOLVED", false, "res")}>
                  {busy === "res" ? "Saving…" : "Mark resolved"}
                </Button>
              )}
              {q.status !== "OPEN" && (
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => post("OPEN", false, "open")}>
                  {busy === "open" ? "Saving…" : "Reopen"}
                </Button>
              )}
              {error && <span className="text-[12px] text-risk">{error}</span>}
            </div>
          )}
          <div className="mt-2.5">
            <QuestionFeedback companyId={companyId} versionId={versionId} questionId={q.id} meetingId={q.status !== "OPEN" ? meetingId : null} initial={feedback} />
          </div>
        </div>
      )}
    </li>
  );
}
