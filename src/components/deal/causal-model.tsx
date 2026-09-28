/**
 * CAUSAL BUSINESS MODEL — acquisition → … → reinvestment, with the binding
 * bottleneck. Model-authored reading of the business (canonical.causalModel);
 * stages the model did not assess are listed as such, never filled in.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { CAUSAL_STAGES } from "@/domain/sections";
import { Badge, cx } from "@/components/ui";
import { titleCase, type Tone } from "@/lib/format";
import { RichText } from "@/components/deal/rich-text";

const HEALTH: Record<string, { tone: Tone; bar: string }> = {
  STRONG: { tone: "ok", bar: "bg-ok" },
  ADEQUATE: { tone: "neutral", bar: "bg-ink-3" },
  WEAK: { tone: "risk", bar: "bg-risk" },
  UNKNOWN: { tone: "unknown", bar: "bg-line-strong" },
};

export function CausalModelView({ c, slug }: { c: CanonicalDeal; slug: string }) {
  const cm = c.causalModel;
  if (!cm) return <p className="text-[13px] text-ink-3">No causal model was produced for this version. The bottleneck is unknown — not assumed.</p>;
  const byStage = new Map(cm.stages.map((s) => [s.stage, s]));
  const missing = CAUSAL_STAGES.filter((s) => !byStage.has(s));
  const ordered = CAUSAL_STAGES.filter((s) => byStage.has(s)).map((s) => byStage.get(s)!);
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-risk/30 bg-risk-soft/40 px-4 py-3">
        <div className="t-eyebrow mb-1 !text-risk">Binding bottleneck · {titleCase(cm.bottleneck.stage)}</div>
        <p className="text-[15px] font-medium leading-snug text-ink">
          <RichText text={cm.bottleneck.statement} slug={slug} />
        </p>
        <p className="mt-1 text-[12.5px] text-ink-2">
          <RichText text={cm.bottleneck.evidence} slug={slug} />
        </p>
      </div>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {ordered.map((s, i) => {
          const h = HEALTH[s.health] ?? HEALTH.UNKNOWN!;
          const isB = s.stage === cm.bottleneck.stage;
          return (
            <li key={s.stage} className={cx("relative min-w-0 rounded-md border bg-surface px-3 py-2.5", isB ? "border-risk/50" : "border-line")}>
              <span className={cx("absolute inset-x-0 top-0 h-[3px] rounded-t-md", h.bar)} aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">
                  {i + 1}. {titleCase(s.stage)}
                </span>
                <Badge tone={h.tone}>{titleCase(s.health)}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] text-ink">{s.mechanism}</p>
              <p className={cx("mt-1 text-[11.5px]", /^no evidence/i.test(s.evidence.trim()) ? "italic text-unknown" : "text-ink-3")}>
                <RichText text={s.evidence} slug={slug} />
              </p>
            </li>
          );
        })}
      </ol>
      {missing.length > 0 && <p className="text-[11.5px] text-ink-3">Not assessed: {missing.map((m) => titleCase(m)).join(", ")}.</p>}
      <p className="text-[11.5px] text-ink-3">Model reading of the business mechanics (labelled, not scored). Health labels are qualitative; numbers cited link to their evidence.</p>
    </div>
  );
}
