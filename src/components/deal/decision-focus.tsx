/**
 * DECISION FOCUS — the code-ranked counterpart of the decision core: out of
 * everything in the record, the few items with the highest decision leverage,
 * and where code and model disagree. Attention ranking, never a probability.
 */
import type { DecisionFocus } from "@/engine/focus";
import { Badge, cx } from "@/components/ui";
import { Refs } from "@/components/deal/v2/kit";
import type { Tone } from "@/lib/format";

const STATUS: Record<string, { text: string; tone: Tone }> = {
  VERIFIED: { text: "Verified", tone: "ok" },
  PARTIALLY_VERIFIED: { text: "Partly verified", tone: "ok" },
  COMPANY_REPORTED: { text: "Company-reported", tone: "neutral" },
  COMPUTED: { text: "Computed", tone: "accent" },
  UNKNOWN: { text: "Unknown", tone: "unknown" },
  CONTRADICTED: { text: "Contradicted", tone: "risk" },
};

const KIND: Record<string, string> = { SENSITIVITY: "Breakpoint", METRIC: "Metric", CLAIM: "Claim", GAP: "Unknown", RISK: "Risk", GATE: "Fund gate" };

export function DecisionFocusPanel({ focus, slug }: { focus: DecisionFocus | undefined; slug: string }) {
  if (!focus) return null;
  const a = focus.modelAgreement;
  return (
    <section aria-label="Decision focus" className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="t-eyebrow">What decides it · ranked by code</div>
        <div className="text-[11.5px] text-ink-3" title={focus.rule}>
          Decision Leverage Index — attention, not a probability
        </div>
      </div>
      <p className="max-w-[860px] text-[13.5px] text-ink-2">{focus.headline}</p>
      {focus.determinants.length > 0 && (
        <ol className="divide-y divide-line border-y border-line">
          {focus.determinants.map((d, i) => (
            <li key={d.key} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 py-2.5 sm:grid-cols-[20px_minmax(0,1fr)_120px]">
              <span className="num pt-0.5 text-[12px] text-ink-3">{i + 1}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] uppercase tracking-wide text-ink-3">{KIND[d.kind] ?? d.kind}</span>
                  <span className="font-medium">{d.label}</span>
                  <Badge tone={STATUS[d.status]?.tone ?? "neutral"}>{STATUS[d.status]?.text ?? d.status}</Badge>
                </div>
                <div className="mt-0.5 text-[12.5px] text-ink-3">{d.why.slice(0, 2).join(" · ")}</div>
                {d.refs.length > 0 && (
                  <div className="mt-1">
                    <Refs refs={d.refs.slice(0, 6)} slug={slug} />
                  </div>
                )}
              </div>
              <div className="col-start-2 mt-1 flex items-center gap-2 sm:col-start-3 sm:mt-0 sm:justify-end">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                  <div className={cx("h-full rounded-full", d.leverage >= 70 ? "bg-risk" : d.leverage >= 45 ? "bg-warn" : "bg-ink-3")} style={{ width: `${Math.min(100, d.leverage)}%` }} />
                </div>
                <span className="num text-[12px] text-ink-2">{d.leverage.toFixed(0)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <div className="t-eyebrow mb-1">Outlier candidates</div>
          {focus.outlierCandidates.length ? (
            <ul className="space-y-1.5 text-[13px]">
              {focus.outlierCandidates.map((o, i) => (
                <li key={i}>
                  <span className="font-medium">{o.label}</span> <span className="text-ink-3">— {o.basis}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-ink-3">None evidenced. Nothing is written in its place.</p>
          )}
        </div>
        <div className="min-w-0">
          <div className="t-eyebrow mb-1">Question that could reverse the decision</div>
          {focus.reversingQuestion ? (
            <p className="text-[13px]">
              {focus.reversingQuestion.question}
              <span className="text-ink-3"> {focus.reversingQuestion.source === "MODEL" ? "(model's question — no open question is tied to the top determinants)" : focus.reversingQuestion.linkedTo ? `(tied to: ${focus.reversingQuestion.linkedTo})` : ""}</span>
            </p>
          ) : (
            <p className="text-[13px] text-ink-3">No open question is tied to the determinants.</p>
          )}
        </div>
      </div>
      {a && (a.codeOnly.length > 0 || a.modelOnly.length > 0) && (
        <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px]">
          <span className="font-medium">Code and model disagree.</span>{" "}
          {a.codeOnly.length > 0 && <span className="text-ink-2">Ranked high by code, absent from the model&apos;s five: {a.codeOnly.join("; ")}. </span>}
          {a.modelOnly.length > 0 && <span className="text-ink-2">Named by the model, not in the code&apos;s top five: {a.modelOnly.join("; ")}.</span>}
        </div>
      )}
    </section>
  );
}
