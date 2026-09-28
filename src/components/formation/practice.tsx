"use client";

/**
 * Practice runner: one exercise at a time. The user answers and states a
 * confidence; the answer is stored (immutably) and only then is the reveal
 * returned and shown.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, cx } from "@/components/ui";
import { FORENSIC_LABEL, KIND_LABEL, MISTAKE_LABEL, SKILL_LABEL } from "@/formation/labels";
import type { RevealPayload } from "@/formation/records";
import type { Answer, DeckFact, ExerciseKind, ForensicCategory, PublicExercise } from "@/formation/types";
import { RevealView } from "./reveal-view";

interface NextPayload {
  exercise: PublicExercise;
  reason: string;
  drill: string | null;
  expertMode: boolean;
  progress: { answered: number; available: number };
}

export interface PracticeProps {
  cases: { id: string; name: string }[];
  initial: { caseId: string | null; kind: string | null; drill: string | null; expert: boolean | null };
}

const KINDS: ExerciseKind[] = ["MCQ_CONCERN", "MCQ_PMF_SIGNAL", "MCQ_MISSING_METRIC", "NUMERIC", "FORENSICS_STATEMENTS", "FORENSICS_OMISSIONS", "FOUNDER_QUESTIONS", "DECISION", "BULL_BEAR", "OUTLIER", "OPEN_THESIS", "OPEN_NEXT_METRIC", "OPEN_PASS_TRIGGER", "OPEN_TWENTY_X"];

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus-visible:border-accent";
const select = "h-7 rounded-md border border-line bg-surface px-1.5 text-[12.5px] text-ink outline-none focus-visible:border-accent";

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function Practice({ cases, initial }: PracticeProps) {
  const [caseId, setCaseId] = useState(initial.caseId ?? "");
  const [kind, setKind] = useState(initial.kind ?? "");
  const [drill, setDrill] = useState(initial.drill ?? "");
  const [expert, setExpert] = useState<"" | "1" | "0">(initial.expert === null ? "" : initial.expert ? "1" : "0");
  const [next, setNext] = useState<NextPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [confidence, setConfidence] = useState(60);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReveal(null);
    setAnswer(null);
    setConfidence(60);
    const q = new URLSearchParams();
    if (caseId) q.set("case", caseId);
    if (kind) q.set("kind", kind);
    if (drill) q.set("drill", drill);
    if (expert) q.set("expert", expert);
    try {
      const r = await fetch(`/api/formation/next?${q}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load an exercise");
      setNext(j);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setNext(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [caseId, kind, drill, expert]);

  useEffect(() => {
    // Loading the next exercise is a fetch whose result is stored in state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const ex = next?.exercise ?? null;
  // Flagging no statement is a legitimate forensics answer ("all sound").
  const effective = useMemo<Answer | null>(() => answer ?? (ex?.input.type === "statements" ? { type: "statements", flags: [] } : null), [answer, ex]);
  const ready = useMemo(() => (ex && effective ? isComplete(ex, effective) : false), [ex, effective]);

  async function submit() {
    const answer = effective;
    if (!ex || !answer) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/formation/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId: ex.id, companyId: ex.case.companyId, versionId: ex.case.versionId, answer, confidence: confidence / 100 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not submit");
      setReveal(j);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-3">
        <select className={select} value={caseId} onChange={(e) => setCaseId(e.target.value)} aria-label="Case">
          <option value="">All cases</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={select} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Exercise type">
          <option value="">Adaptive mix</option>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={select} value={expert} onChange={(e) => setExpert(e.target.value as "" | "1" | "0")} aria-label="Expert mode">
          <option value="">Expert mode: automatic</option>
          <option value="1">Expert mode: on</option>
          <option value="0">Expert mode: off</option>
        </select>
        {drill && (
          <button className="rounded-md border border-accent/30 bg-accent-soft px-2 py-0.5 text-accent-text" onClick={() => setDrill("")} title="Stop the drill">
            Drill: {MISTAKE_LABEL[drill as keyof typeof MISTAKE_LABEL] ?? drill} ×
          </button>
        )}
        {next && (
          <span className="num ml-auto">
            {next.progress.answered} of {next.progress.available} exercises answered
          </span>
        )}
      </div>

      {loading && <div className="h-40 animate-pulse rounded-lg bg-surface-2" />}
      {!loading && error && !ex && <p className="text-[13px] text-ink-3">{error}</p>}

      {!loading && ex && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-5">
            <header className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{KIND_LABEL[ex.kind]}</Badge>
                <Badge tone="neutral">Level {ex.level}</Badge>
                {ex.expert && <Badge tone="accent">Expert case</Badge>}
                {ex.skills.slice(0, 3).map((s) => (
                  <span key={s} className="text-[11.5px] text-ink-3">
                    {SKILL_LABEL[s]}
                  </span>
                ))}
              </div>
              <h2 className="t-section text-[17px]">{ex.title}</h2>
              <p className="text-[12px] text-ink-3">{next!.reason}</p>
            </header>
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink">{ex.prompt}</p>

            {ex.context.length > 0 && (
              <details className="rounded-lg border border-line lg:hidden">
                <summary className="cursor-pointer px-3 py-2 text-[12.5px] text-ink-2">What the deck shows ({ex.context.length})</summary>
                <FactList facts={ex.context} />
              </details>
            )}

            {!reveal ? (
              <>
                <AnswerInput ex={ex} value={answer} onChange={setAnswer} />
                <div className="space-y-2 rounded-lg border border-line bg-surface px-4 py-3">
                  <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
                    <span>How likely is it that your answer is right?</span>
                    <input type="range" min={0} max={100} step={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="w-48 accent-[var(--accent)]" aria-label="Confidence" />
                    <span className="num w-10 font-medium text-ink">{confidence}%</span>
                  </label>
                  <p className="text-[11.5px] text-ink-3">Your answer and confidence are saved before anything is revealed and cannot be edited afterwards — they become your journal entry.</p>
                  <div className="flex items-center gap-3">
                    <Button variant="primary" onClick={submit} disabled={!ready || busy}>
                      {busy ? "Saving and grading…" : "Submit and reveal"}
                    </Button>
                    <Button variant="ghost" onClick={load} disabled={busy}>
                      Skip
                    </Button>
                    {error && <span className="text-[12.5px] text-risk">{error}</span>}
                  </div>
                </div>
              </>
            ) : (
              <>
                <RevealView reveal={reveal} />
                <div className="flex gap-2 border-t border-line pt-4">
                  <Button variant="primary" onClick={load}>
                    Next exercise
                  </Button>
                  <Button href={`/formation/review/${reveal.attemptId}`} variant="ghost">
                    Permalink
                  </Button>
                </div>
              </>
            )}
          </div>
          {ex.context.length > 0 && (
            <aside className="hidden lg:block">
              <div className="sticky top-4 rounded-lg border border-line bg-surface">
                <div className="t-eyebrow border-b border-line px-3 py-2">What the deck shows</div>
                <FactList facts={ex.context} />
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function FactList({ facts }: { facts: DeckFact[] }) {
  return (
    <dl className="max-h-[70vh] overflow-y-auto px-3 py-1.5 text-[12.5px]">
      {facts.map((f, i) => {
        const head = i === 0 || facts[i - 1]!.group !== f.group ? f.group : null;
        return (
          <div key={f.id}>
            {head && <div className="t-eyebrow pb-1 pt-2.5">{head}</div>}
            <div className="grid grid-cols-[minmax(92px,38%)_1fr] gap-2 border-t border-line/60 py-1.5 first:border-t-0">
              <dt className="text-ink-3">{f.label}</dt>
              <dd className="text-ink">
                {f.value}
                {(f.detail || f.page) && <div className="text-[11.5px] text-ink-3">{[f.detail, f.page ? `p. ${f.page}` : null].filter(Boolean).join(" · ")}</div>}
              </dd>
            </div>
          </div>
        );
      })}
    </dl>
  );
}

function isComplete(ex: PublicExercise, a: Answer): boolean {
  const i = ex.input;
  switch (i.type) {
    case "choice":
      return a.type === "choice" && !!a.optionId;
    case "numeric":
      return a.type === "numeric" && /\d/.test(a.value);
    case "statements":
      return a.type === "statements";
    case "multi":
      return a.type === "multi" && a.optionIds.length >= i.minPicks;
    case "questions":
      return a.type === "questions" && a.questions.filter((q) => q.trim()).length === i.count;
    case "decision":
      return a.type === "decision" && words(a.justification) >= 8;
    case "bullbear":
      return a.type === "bullbear" && words(a.bull) >= 8 && words(a.bear) >= 8;
    case "outlier":
      return a.type === "outlier" && words(a.justification) >= 8;
    case "text":
      return a.type === "text" && words(a.text) >= Math.min(12, i.minWords);
  }
}

function AnswerInput({ ex, value, onChange }: { ex: PublicExercise; value: Answer | null; onChange: (a: Answer) => void }) {
  const i = ex.input;
  switch (i.type) {
    case "choice": {
      const v = value?.type === "choice" ? value : { type: "choice" as const, optionId: "", justification: "" };
      return (
        <div className="space-y-3">
          <div role="radiogroup" className="space-y-2">
            {i.options.map((o) => (
              <button
                key={o.id}
                role="radio"
                aria-checked={v.optionId === o.id}
                onClick={() => onChange({ ...v, optionId: o.id })}
                className={cx("flex w-full items-baseline gap-3 rounded-lg border px-3 py-2.5 text-left text-[13px] transition-colors", v.optionId === o.id ? "border-ink bg-surface" : "border-line hover:bg-surface-2")}
              >
                <span className="num font-medium text-ink-3">{o.id}</span>
                <span className="text-ink">{o.text}</span>
              </button>
            ))}
          </div>
          {i.justification && <textarea rows={2} className={field} placeholder="Why? (optional — saved in your journal)" value={v.justification ?? ""} onChange={(e) => onChange({ ...v, justification: e.target.value })} />}
        </div>
      );
    }
    case "numeric": {
      const v = value?.type === "numeric" ? value.value : "";
      return (
        <label className="block space-y-1.5">
          <input className={cx(field, "num max-w-xs text-[15px]")} value={v} onChange={(e) => onChange({ type: "numeric", value: e.target.value })} placeholder={i.hint} inputMode="decimal" autoFocus />
          <span className="block text-[11.5px] text-ink-3">{i.hint}. Compute it by hand — the worked solution is shown after you answer.</span>
        </label>
      );
    }
    case "statements": {
      const flags = value?.type === "statements" ? value.flags : [];
      const set = (id: string, cat: ForensicCategory | "") =>
        onChange({ type: "statements", flags: [...flags.filter((f) => f.statementId !== id), ...(cat ? [{ statementId: id, category: cat }] : [])] });
      return (
        <ul className="divide-y divide-line border-y border-line">
          {i.statements.map((s) => {
            const cur = flags.find((f) => f.statementId === s.id)?.category ?? "";
            return (
              <li key={s.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-baseline">
                <span className="num w-7 shrink-0 text-[12px] font-medium text-ink-3">{s.id}</span>
                <span className="min-w-0 flex-1 text-[13px] text-ink">{s.text}</span>
                <select className={cx(select, "shrink-0", cur ? "border-ink" : "")} value={cur} onChange={(e) => set(s.id, e.target.value as ForensicCategory | "")} aria-label={`Flag ${s.id}`}>
                  <option value="">Sound</option>
                  {i.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {FORENSIC_LABEL[c.id]}
                    </option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      );
    }
    case "multi": {
      const ids = value?.type === "multi" ? value.optionIds : [];
      return (
        <div className="space-y-1.5">
          {i.options.map((o) => (
            <label key={o.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-1 py-1 text-[13px] hover:bg-surface-2">
              <input type="checkbox" checked={ids.includes(o.id)} onChange={(e) => onChange({ type: "multi", optionIds: e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id) })} />
              <span className="text-ink">{o.text}</span>
            </label>
          ))}
        </div>
      );
    }
    case "questions": {
      const qs = value?.type === "questions" ? value.questions : Array.from({ length: i.count }, () => "");
      return (
        <div className="space-y-2">
          {qs.map((q, k) => (
            <textarea key={k} rows={2} className={field} placeholder={`Question ${k + 1}`} value={q} onChange={(e) => onChange({ type: "questions", questions: qs.map((x, j) => (j === k ? e.target.value : x)) })} />
          ))}
        </div>
      );
    }
    case "decision": {
      const v = value?.type === "decision" ? value : { type: "decision" as const, decision: "" as never, justification: "" };
      return (
        <div className="space-y-2.5">
          <div className="inline-flex flex-wrap overflow-hidden rounded-lg border border-line">
            {i.options.map((o) => (
              <button key={o.id} onClick={() => onChange({ ...v, decision: o.id })} className={cx("border-r border-line px-3 py-1.5 text-[13px] last:border-r-0", v.decision === o.id ? "bg-ink text-bg" : "bg-surface text-ink-2 hover:bg-surface-2")}>
                {o.label}
              </button>
            ))}
          </div>
          <textarea rows={5} className={field} placeholder="The facts that decide it, and what would change your mind." value={v.justification} onChange={(e) => onChange({ ...v, justification: e.target.value })} />
        </div>
      );
    }
    case "bullbear": {
      const v = value?.type === "bullbear" ? value : { type: "bullbear" as const, bull: "", bear: "" };
      return (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Best case for investing</span>
            <textarea rows={7} className={field} value={v.bull} onChange={(e) => onChange({ ...v, bull: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-[12px] font-medium text-ink-2">Best case for passing</span>
            <textarea rows={7} className={field} value={v.bear} onChange={(e) => onChange({ ...v, bear: e.target.value })} />
          </label>
        </div>
      );
    }
    case "outlier": {
      const v = value?.type === "outlier" ? value : { type: "outlier" as const, exceptional: false, signalIds: [] as string[], justification: "" };
      const touched = value?.type === "outlier";
      return (
        <div className="space-y-3">
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            {[true, false].map((b) => (
              <button key={String(b)} onClick={() => onChange({ ...v, exceptional: b })} className={cx("border-r border-line px-3 py-1.5 text-[13px] last:border-r-0", touched && v.exceptional === b ? "bg-ink text-bg" : "bg-surface text-ink-2 hover:bg-surface-2")}>
                {b ? "Yes — something is exceptional" : "No — nothing outweighs the weaknesses"}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <div className="text-[12px] text-ink-3">Signals that carry your view</div>
            {i.signals.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-baseline gap-2.5 rounded-md px-1 py-0.5 text-[13px] hover:bg-surface-2">
                <input type="checkbox" checked={v.signalIds.includes(o.id)} onChange={(e) => onChange({ ...v, signalIds: e.target.checked ? [...v.signalIds, o.id] : v.signalIds.filter((x) => x !== o.id) })} />
                <span className="text-ink">{o.text}</span>
              </label>
            ))}
          </div>
          <textarea rows={4} className={field} placeholder="What would make the outcome nonlinear — or why nothing does." value={v.justification} onChange={(e) => onChange({ ...v, justification: e.target.value })} />
        </div>
      );
    }
    case "text": {
      const t = value?.type === "text" ? value.text : "";
      return (
        <div className="space-y-1">
          <textarea rows={7} className={field} placeholder={i.placeholder} value={t} onChange={(e) => onChange({ type: "text", text: e.target.value })} />
          <div className="num text-right text-[11.5px] text-ink-3">{words(t)} words</div>
        </div>
      );
    }
  }
}
