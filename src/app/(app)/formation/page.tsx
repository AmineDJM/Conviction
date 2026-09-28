import Link from "next/link";
import { requireSession } from "@/server/session";
import { overview } from "@/formation/service";
import { Badge, Button, Empty, Section, cx } from "@/components/ui";
import { ReliabilityChart, RatingBar, ScoreTrend } from "@/components/formation/charts";
import { KIND_LABEL, PATTERN_LABEL, SKILL_GROUPS, SKILL_LABEL } from "@/formation/labels";
import { band } from "@/formation/skill-model";
import { MIN_MISSES, MIN_OPPORTUNITIES } from "@/formation/weaknesses";
import { MISTAKE_DRILL } from "@/formation/mistakes";
import { STAGE_LABEL } from "@/lib/format";

export const metadata = { title: "Formation" };

const DRILL = "max-w-full rounded-md border border-line bg-surface px-2.5 py-1 text-[12.5px] text-ink transition-colors hover:bg-surface-2";

const p = (x: number | null | undefined, digits = 0) => (x === null || x === undefined ? "—" : `${(x * 100).toFixed(digits)}%`);

function Metric({ label, value, note, n }: { label: string; value: string; note: string; n?: string }) {
  return (
    <div className="min-w-0">
      <div className="t-eyebrow mb-1">{label}</div>
      <div className="num text-[20px] font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-snug text-ink-3">{note}</div>
      {n && <div className="num text-[11px] text-ink-3">{n}</div>}
    </div>
  );
}

export default async function FormationPage() {
  const s = await requireSession();
  const o = overview(s);
  const m = o.mastery;
  const cal = m.calibration;
  const dc = m.decisionConsistency;
  const recurring = o.mistakes.filter((x) => x.recurring);
  const evidenced = o.tendencies.filter((t) => t.status === "EVIDENCED");
  const pending = o.tendencies.filter((t) => t.status === "INSUFFICIENT");

  if (!o.cases.length)
    return (
      <Empty title="No training cases yet" action={<Button href="/analyze" variant="primary">Analyze a company</Button>}>
        Every analysed deal in this workspace becomes a training case. Analyse a deck and it will appear here with its exercises.
      </Empty>
    );

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center gap-3">
        <Button href="/formation/practice" variant="primary">
          {m.attempts ? "Continue practice" : "Start practice"}
        </Button>
        {recurring[0] && (
          <Link href={`/formation/practice?drill=${recurring[0].kind}`} className={DRILL}>
            Drill: {recurring[0].label.toLowerCase()}
          </Link>
        )}
        <span className="text-[12.5px] text-ink-3">
          {o.cases.length} training case{o.cases.length === 1 ? "" : "s"} · {o.cases.reduce((a, c) => a + c.exercises, 0)} exercises · {m.graded} graded answer{m.graded === 1 ? "" : "s"}
          {o.expertMode ? " · expert mode" : ""}
        </span>
      </div>

      <Section eyebrow="Mastery" title="How you are doing — measured, not scored">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6 border-y border-line py-5 md:grid-cols-4">
          <Metric label="Accuracy" value={p(m.accuracy.meanScore)} note={`Mean score; ${p(m.accuracy.shareCorrect)} at or above 70`} n={`n = ${m.graded}`} />
          <Metric label="Calibration" value={cal.brier !== null ? cal.brier.toFixed(3) : "—"} note={cal.overconfidence === null ? "Brier score (lower is better)" : `Brier score · ${cal.overconfidence >= 0 ? "over" : "under"}confident by ${Math.abs(Math.round(cal.overconfidence * 100))} pts`} n={`n = ${cal.n}`} />
          <Metric label="Reasoning quality" value={p(m.reasoningQuality.mean)} note={`Rubric on open answers${m.reasoningQuality.heuristicShare ? ` · ${p(m.reasoningQuality.heuristicShare)} heuristic` : ""}`} n={`n = ${m.reasoningQuality.n}`} />
          <Metric label="Numerical accuracy" value={p(m.numericalAccuracy.withinTolerance)} note={`Within tolerance · median error ${p(m.numericalAccuracy.medianRelError, 1)}`} n={`n = ${m.numericalAccuracy.n}`} />
          <Metric label="Missed critical risks" value={p(m.missedCriticalRisks.rate)} note="Critical risks and decisive facts not addressed" n={`${m.missedCriticalRisks.missed} of ${m.missedCriticalRisks.total}`} />
          <Metric label="Missed outlier signals" value={p(m.missedOutlierSignals.rate)} note="Evidenced outlier signals not addressed" n={`${m.missedOutlierSignals.missed} of ${m.missedOutlierSignals.total}`} />
          <Metric label="Question efficiency" value={p(m.questionEfficiency.rate)} note={`Non-redundant, decision-relevant founder questions · ${m.questionEfficiency.redundant} redundant`} n={`n = ${m.questionEfficiency.questions}`} />
          <Metric
            label="Decision consistency"
            value={dc.kendallTau !== null ? dc.kendallTau.toFixed(2) : "—"}
            note={`Kendall τ with the analysis ranking${dc.repeatAgreement !== null ? ` · ${p(dc.repeatAgreement)} same call on repeats` : ""}`}
            n={`${dc.cases} case${dc.cases === 1 ? "" : "s"}`}
          />
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <Section eyebrow="Improvement over time" title="Score per exercise, rolling mean of five">
          <ScoreTrend series={m.improvement.series} />
          <p className="mt-2 text-[12px] text-ink-3">
            {m.improvement.delta !== null
              ? `Second half of your history averages ${p(m.improvement.secondHalf)} against ${p(m.improvement.firstHalf)} in the first (${m.improvement.delta >= 0 ? "+" : ""}${Math.round(m.improvement.delta * 100)} pts). Difficulty rises as you improve, so a flat line can still mean progress.`
              : "The comparison appears after six graded exercises."}
          </p>
        </Section>
        <Section eyebrow="Calibration" title="Confidence against results">
          <ReliabilityChart bins={cal.bins} />
          <p className="mt-2 text-[12px] text-ink-3">Points on the diagonal mean your stated confidence matches how often you are right.</p>
        </Section>
      </div>

      <Section eyebrow="Skill profile" title="Estimated skill by area" action={<span className="text-[11.5px] text-ink-3">Glicko-style estimate · band = ±2 uncertainty</span>}>
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
          {SKILL_GROUPS.map((grp) => (
            <div key={grp.label} className="min-w-0">
              <div className="mb-1 text-[12px] font-medium text-ink-2">{grp.label}</div>
              <div className="divide-y divide-line border-y border-line">
                {grp.skills.map((sk) => {
                  const st = o.profile[sk];
                  const b = band(st);
                  return (
                    <div key={sk} className="grid grid-cols-[minmax(0,1fr)_88px_84px_32px] items-center gap-3 py-2 text-[13px] sm:grid-cols-[minmax(0,1fr)_120px_96px_36px]">
                      <span className="truncate text-ink">{SKILL_LABEL[sk]}</span>
                      <RatingBar rating={st.rating} rd={st.rd} assessed={st.n > 0} width="100%" />
                      <span className={cx("text-right text-[12px]", st.n ? "text-ink-2" : "text-ink-3")}>{b}</span>
                      <span className="num text-right text-[11.5px] text-ink-3">{st.n ? `n ${st.n}` : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-10 lg:grid-cols-2">
        <Section eyebrow="Recurring weaknesses" title="Patterns in what you miss">
          {o.weaknesses.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              None detected. A weakness is reported only after at least {MIN_MISSES} misses in {MIN_OPPORTUNITIES}+ opportunities on the same concept.
              {o.concepts.length > 0 && ` Tracking ${o.concepts.length} concepts across your answers.`}
            </p>
          ) : (
            <ul className="space-y-3">
              {o.weaknesses.map((w) => (
                <li key={w.concept} className="border-l-2 border-risk/50 pl-3">
                  <div className="text-[13px] font-medium text-ink">{w.statement}</div>
                  <div className="mt-0.5 text-[12px] text-ink-3">
                    Recent: {w.examples.map((e) => `${e.caseName} · ${e.title}`).join("; ")}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {o.concepts.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {o.concepts.slice(0, 12).map((c) => (
                <span key={c.concept} className="num rounded-md bg-surface-2 px-1.5 py-0.5 text-[11.5px] text-ink-3" title={`${c.caught} caught, ${c.misses} missed`}>
                  {c.concept.toLowerCase().replace(/_/g, " ")} {c.caught}/{c.n}
                </span>
              ))}
            </div>
          )}
        </Section>

        <Section eyebrow="Investor development" title="What kind of investor are you becoming?">
          <ul className="space-y-3">
            {evidenced.map((t) => (
              <li key={t.id}>
                <div className="text-[11.5px] text-ink-3">{t.area}</div>
                <div className="text-[13px] text-ink">{t.statement}</div>
                {t.examples.length > 0 && <div className="mt-0.5 text-[12px] text-ink-3">{t.examples.join(" · ")}</div>}
              </li>
            ))}
            {pending.map((t) => (
              <li key={t.id} className="text-[12.5px] text-ink-3">
                <span className="text-ink-2">{t.area}:</span> {t.statement}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11.5px] text-ink-3">Only repeated, observed decisions count. Nothing here is a personality judgement.</p>
        </Section>
      </div>

      {recurring.length > 0 && (
        <Section eyebrow="Targeted drills" title="Recurring mistakes to work on" action={<Link href="/formation/mistakes" className="text-[12.5px] text-accent-text hover:underline">Mistake library</Link>}>
          <div className="flex flex-wrap gap-2">
            {recurring.slice(0, 4).map((r) => (
              <Link key={r.kind} href={`/formation/practice?drill=${r.kind}`} className={DRILL}>
                {r.label} · {r.count}× · {MISTAKE_DRILL[r.kind].kinds.slice(0, 2).map((k) => KIND_LABEL[k].toLowerCase()).join(", ")}
              </Link>
            ))}
          </div>
        </Section>
      )}

      <Section eyebrow="Training cases" title="Every analysed deal is a case">
        <div className="overflow-x-auto border-b border-line">
          <table className="w-full min-w-[720px] text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-2 pr-3 font-medium">Case</th>
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 text-right font-medium">Answered</th>
                <th className="py-2 pr-3 text-right font-medium">Expert items</th>
                <th className="py-2 pr-3 font-medium">Patterns</th>
                <th className="py-2 text-right font-medium" />
              </tr>
            </thead>
            <tbody>
              {o.cases.map((c) => (
                <tr key={c.companyId} className="border-t border-line align-top">
                  <td className="py-2.5 pr-3">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="text-[12px] text-ink-3">{STAGE_LABEL[c.stage] ?? c.stage}</div>
                  </td>
                  <td className="py-2.5 pr-3 text-ink-2">{c.domain ? SKILL_LABEL[c.domain] : "—"}</td>
                  <td className="num py-2.5 pr-3 text-right">
                    {c.answered} / {c.exercises}
                  </td>
                  <td className="num py-2.5 pr-3 text-right">{c.expertExercises}</td>
                  <td className="py-2.5 pr-3">
                    {c.patterns ? (
                      <div className="flex flex-wrap gap-1">
                        {c.patterns.map((pt) => (
                          <Badge key={pt.pattern} tone={pt.expert ? "accent" : "neutral"} title={pt.evidence}>
                            {PATTERN_LABEL[pt.pattern]}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-3">{c.patternCount} pattern{c.patternCount === 1 ? "" : "s"} · shown after three answers</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <Link href={`/formation/practice?case=${c.companyId}`} className="whitespace-nowrap text-[12.5px] text-accent-text hover:underline">
                      Practise this case
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
