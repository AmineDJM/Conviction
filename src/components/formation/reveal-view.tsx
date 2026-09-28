/**
 * The reveal: what you answered (immutable) against the answer key, the
 * worked solution, the AI analysis, evidence links into the deal, alternative
 * reasoning and what an experienced investor would focus on. Pure render
 * (usable from server pages and the client runner).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, cx } from "@/components/ui";
import { FORENSIC_LABEL, DECISION_LABEL_F, KIND_LABEL, MISTAKE_LABEL, PATTERN_LABEL, SKILL_LABEL } from "@/formation/labels";
import type { RevealPayload } from "@/formation/records";
import type { Exercise } from "@/formation/types";

function Block({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border-t border-line pt-4", className)}>
      <div className="t-eyebrow mb-2">{title}</div>
      {children}
    </section>
  );
}

function List({ items, ordered }: { items: string[]; ordered?: boolean }) {
  if (!items.length) return <p className="text-[13px] text-ink-3">—</p>;
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={cx("space-y-1.5 text-[13px] leading-relaxed text-ink-2", ordered ? "list-decimal pl-5" : "")}>
      {items.map((x, i) =>
        ordered ? (
          <li key={i}>{x}</li>
        ) : (
          <li key={i} className="flex gap-2.5">
            <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-ink-3" />
            <span>{x}</span>
          </li>
        ),
      )}
    </Tag>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}`;

export function RevealView({ reveal }: { reveal: RevealPayload }) {
  const { exercise: ex, grade: g, answer } = reveal;
  const k = ex.key;
  const tone = !g ? "unknown" : g.score >= 0.7 ? "ok" : g.score >= 0.4 ? "warn" : "risk";
  const verdict = !g ? "Not graded" : g.score >= 0.7 ? "Correct" : g.score >= 0.4 ? "Partly right" : "Missed";
  return (
    <div className="anim-in space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
        <Badge tone={tone} dot>
          {verdict}
        </Badge>
        {g && (
          <span className="num text-[22px] font-semibold tracking-tight text-ink">
            {pct(g.score)}
            <span className="text-[13px] font-normal text-ink-3"> / 100</span>
          </span>
        )}
        <span className="text-[13px] text-ink-2">{g?.summary ?? reveal.gradeError}</span>
        <span className="ml-auto text-[12px] text-ink-3">
          You stated {pct(reveal.confidence)}% confidence · answer recorded {reveal.answeredAt.slice(0, 16).replace("T", " ")} UTC, before the reveal
        </span>
      </div>

      <AnswerComparison ex={ex} reveal={reveal} />

      {g && g.details.length > 0 && (
        <Block title="How it was graded">
          <List items={g.details} />
          {g.rubric?.feedback && g.rubric.method === "MODEL" && <p className="mt-2 text-[13px] leading-relaxed text-ink">{g.rubric.feedback}</p>}
        </Block>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Block title={ex.family === "NUMERIC" ? "Worked solution" : "Reasoning"}>
          <List items={k.workedSolution} ordered={ex.family === "NUMERIC"} />
        </Block>
        <Block title="What the AI analysis concluded">
          <List items={k.aiAnalysis} />
        </Block>
        <Block title="Alternative reasoning">
          <List items={k.alternativeReasoning} />
        </Block>
        <Block title="What an experienced investor would focus on">
          <List items={k.expertFocus} />
        </Block>
      </div>

      {k.keyPoints.length > 0 && (
        <Block title="Key points">
          <ul className="space-y-1.5 text-[13px]">
            {k.keyPoints.map((p) => {
              const caught = g?.rubric ? [...g.rubric.caughtRiskIds, ...g.rubric.caughtOutlierIds].includes(p.id) : null;
              return (
                <li key={p.id} className="flex gap-2.5">
                  <span className={cx("mt-[2px] w-16 shrink-0 text-[11px] font-medium", caught === null ? "text-ink-3" : caught ? "text-ok" : p.critical ? "text-risk" : "text-ink-3")}>
                    {caught === null ? p.kind.toLowerCase() : caught ? "covered" : "missed"}
                  </span>
                  <span className="text-ink-2">
                    {p.text}
                    {p.critical && <span className="text-ink-3"> · critical</span>}
                    {p.href && (
                      <>
                        {" "}
                        <Link href={p.href} className="text-accent-text hover:underline">
                          evidence
                        </Link>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </Block>
      )}

      {k.evidence.length > 0 && (
        <Block title="Evidence in the deal">
          <ul className="space-y-1 text-[13px]">
            {k.evidence.slice(0, 10).map((e) => (
              <li key={e.href + e.label}>
                <Link href={e.href} className="text-accent-text hover:underline">
                  {e.label}
                </Link>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <div className="flex flex-wrap gap-x-8 gap-y-4 border-t border-line pt-4">
        {ex.casePatterns.length > 0 && (
          <div>
            <div className="t-eyebrow mb-1.5">Case patterns</div>
            <div className="flex flex-wrap gap-1.5">
              {ex.casePatterns.map((p) => (
                <Badge key={p} tone={ex.patterns.includes(p) ? "accent" : "neutral"}>
                  {PATTERN_LABEL[p]}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {reveal.skillChanges.length > 0 && (
          <div>
            <div className="t-eyebrow mb-1.5">Skill estimate</div>
            <ul className="space-y-0.5 text-[12.5px] text-ink-2">
              {reveal.skillChanges.map((s) => (
                <li key={s.skill}>
                  {SKILL_LABEL[s.skill]} <span className={cx("num", s.after >= s.before ? "text-ok" : "text-risk")}>{s.after >= s.before ? "↑" : "↓"}</span>{" "}
                  <span className="num text-ink-3">
                    {Math.round(s.before)} → {Math.round(s.after)} · uncertainty ±{Math.round(2 * s.rdAfter)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {reveal.mistakes.length > 0 && (
          <div className="min-w-0 max-w-xl">
            <div className="t-eyebrow mb-1.5">Added to your mistake library</div>
            <ul className="space-y-1 text-[12.5px] text-ink-2">
              {reveal.mistakes.map((m) => (
                <li key={m.kind}>
                  <span className="font-medium text-ink">{MISTAKE_LABEL[m.kind]}</span> — {m.evidence}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="text-[11.5px] text-ink-3">
        {KIND_LABEL[ex.kind]} · level {ex.level}
        {ex.expert ? " · expert case" : ""} · {ex.case.name} v{ex.case.versionNo} ·{" "}
        <Link href={`/deals/${ex.case.slug}`} className="hover:text-ink">
          open the deal
        </Link>
        {answer.type === "decision" && k.decisionBucket ? ` · analysis: ${DECISION_LABEL_F[k.decisionBucket].toLowerCase()}` : ""}
      </p>
    </div>
  );
}

function AnswerComparison({ ex, reveal }: { ex: Exercise; reveal: RevealPayload }) {
  const a = reveal.answer;
  const k = ex.key;
  const g = reveal.grade;
  if (ex.input.type === "choice" && a.type === "choice") {
    return (
      <Block title="Options">
        <ul className="space-y-2">
          {ex.input.options.map((o) => {
            const mine = o.id === a.optionId;
            const right = k.correctOptionIds.includes(o.id);
            const partial = k.partialOptionIds.includes(o.id);
            return (
              <li key={o.id} className={cx("rounded-lg border px-3 py-2", right ? "border-ok/40 bg-ok-soft/40" : mine ? "border-risk/30 bg-risk-soft/40" : "border-line")}>
                <div className="flex items-baseline gap-2 text-[13px]">
                  <span className="num font-medium text-ink-3">{o.id}</span>
                  <span className="text-ink">{o.text}</span>
                  <span className="ml-auto flex shrink-0 gap-1">
                    {mine && <Badge>your answer</Badge>}
                    {right && <Badge tone="ok">best answer</Badge>}
                    {partial && <Badge tone="warn">defensible</Badge>}
                  </span>
                </div>
                {k.optionNotes[o.id] && <p className="mt-1 pl-5 text-[12.5px] leading-relaxed text-ink-3">{k.optionNotes[o.id]}</p>}
              </li>
            );
          })}
        </ul>
        {a.justification && <p className="mt-2 text-[12.5px] text-ink-2">Your reasoning: “{a.justification}”</p>}
      </Block>
    );
  }
  if (ex.input.type === "numeric" && a.type === "numeric" && k.numeric) {
    return (
      <Block title="Your number against the engine">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="You answered" value={a.value} />
          <Stat label="Engine value" value={k.numeric.display} />
          <Stat label="Off by" value={g?.numeric?.relError !== null && g?.numeric?.relError !== undefined ? `${(g.numeric.relError * 100).toFixed(1)}%` : "—"} hint={`tolerance ±${(k.numeric.tolerance * 100).toFixed(0)}%`} />
        </div>
      </Block>
    );
  }
  if (ex.input.type === "statements" && a.type === "statements") {
    const mine = new Map(a.flags.map((f) => [f.statementId, f.category]));
    return (
      <Block title="Statements">
        <ul className="divide-y divide-line border-y border-line">
          {ex.input.statements.map((s) => {
            const key = k.flagged?.[s.id] ?? null;
            const my = mine.get(s.id) ?? null;
            return (
              <li key={s.id} className="py-2 text-[13px]">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="num font-medium text-ink-3">{s.id}</span>
                  <span className="min-w-0 flex-1 text-ink">{s.text}</span>
                  <span className="flex shrink-0 gap-1">
                    {my && <Badge tone={key ? (key.includes(my) ? "ok" : "warn") : "risk"}>you: {FORENSIC_LABEL[my].toLowerCase()}</Badge>}
                    {key ? <Badge tone="accent">{key.map((c) => FORENSIC_LABEL[c].toLowerCase()).join(" · ")}</Badge> : <Badge>sound</Badge>}
                  </span>
                </div>
                {key && k.optionNotes[s.id] && <p className="mt-1 pl-6 text-[12.5px] leading-relaxed text-ink-3">{k.optionNotes[s.id]}</p>}
              </li>
            );
          })}
        </ul>
      </Block>
    );
  }
  if (ex.input.type === "multi" && a.type === "multi") {
    return (
      <Block title="What the deck leaves out">
        <ul className="space-y-1.5 text-[13px]">
          {ex.input.options.map((o) => {
            const right = k.correctOptionIds.includes(o.id);
            const mine = a.optionIds.includes(o.id);
            return (
              <li key={o.id} className="flex flex-wrap items-baseline gap-2">
                <span className={cx("w-20 shrink-0 text-[11.5px] font-medium", right ? (mine ? "text-ok" : "text-risk") : mine ? "text-warn" : "text-ink-3")}>{right ? (mine ? "found" : "missed") : mine ? "is on the deck" : "on the deck"}</span>
                <span className="text-ink">{o.text}</span>
                <span className="text-[12px] text-ink-3">{k.optionNotes[o.id]}</span>
              </li>
            );
          })}
        </ul>
      </Block>
    );
  }
  if (a.type === "questions") {
    return (
      <Block title="Your questions, scored">
        <ul className="space-y-2 text-[13px]">
          {(g?.questions ?? a.questions.map((q) => ({ question: q, impact: 0, redundant: false, redundantWith: null, infoGain: 0, matched: null, score: 0 }))).map((q, i) => (
            <li key={i} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="text-ink">{q.question}</span>
                <span className="num ml-auto shrink-0 text-[12px] text-ink-3">{Math.round(q.score * 100)}</span>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {q.redundant ? q.redundantWith : `Decision impact ${q.impact.toFixed(2)} · information gain ${q.infoGain.toFixed(2)}`}
                {q.matched && !q.redundant ? ` · closest decision-critical question: “${q.matched.slice(0, 160)}”` : ""}
              </p>
            </li>
          ))}
        </ul>
        {k.questionBank && (
          <div className="mt-3">
            <div className="text-[12px] font-medium text-ink-2">The highest-value questions for this deal</div>
            <List items={k.questionBank.slice(0, 3).map((b) => `${b.question}${b.ifA ? ` — if yes: ${b.ifA}` : ""}${b.ifB ? ` — if no: ${b.ifB}` : ""}`)} ordered />
          </div>
        )}
      </Block>
    );
  }
  const yours =
    a.type === "decision"
      ? `${DECISION_LABEL_F[a.decision]} — ${a.justification}`
      : a.type === "bullbear"
        ? `Bull: ${a.bull}\n\nBear: ${a.bear}`
        : a.type === "outlier"
          ? `${a.exceptional ? "Yes, exceptional" : "No"}${a.signalIds.length ? ` (signals ${a.signalIds.join(", ")})` : ""} — ${a.justification}`
          : a.type === "text"
            ? a.text
            : "";
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Block title="What you believed">
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{yours}</p>
      </Block>
      <Block title="The answer">
        <p className="text-[13px] leading-relaxed text-ink">{k.answer}</p>
      </Block>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11.5px] text-ink-3">{label}</div>
      <div className="num text-[16px] font-medium text-ink">{value}</div>
      {hint && <div className="text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}
