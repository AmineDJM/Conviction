import Link from "next/link";
import type { NumChange, VersionDiff } from "@/reports/version-diff";
import { Badge, cx } from "@/components/ui";
import { DECISION_LABEL, metricValue, titleCase } from "@/lib/format";
import { metricDef } from "@/engine/metrics/dictionary";
import { VERIFICATION_TEXT, verificationTone } from "@/components/deal/evidence/labels";
import { QUESTION_STATUS_TEXT, questionStatusTone } from "@/components/deal/questions/labels";

const f1 = (n: number | null) => (n === null ? "—" : n.toFixed(1));
const fPct = (n: number | null) => (n === null ? "—" : `${Math.round(n * 100)}%`);

function Delta({ c, fmt = f1, invert }: { c: NumChange; fmt?: (n: number | null) => string; invert?: boolean }) {
  if (!c.changed) return <span className="text-ink-3">no change</span>;
  if (c.delta === null) return <span className="text-ink-2">{c.from === null ? "now scored" : "no longer scored"}</span>;
  const up = c.delta > 0;
  const good = invert ? !up : up;
  const sign = up ? "+" : "−";
  const abs = Math.abs(c.delta);
  return (
    <span className={cx("num font-medium", good ? "text-ok" : "text-risk")}>
      {up ? "▲" : "▼"} {sign}
      {fmt === fPct ? `${Math.round(abs * 100)} pts` : abs.toFixed(1)}
    </span>
  );
}

function ScoreRow({ label, from, to, change, note }: { label: string; from: React.ReactNode; to: React.ReactNode; change: React.ReactNode; note?: string }) {
  return (
    <tr className="align-top">
      <td className="border-t border-line px-3 py-2 text-ink-2">
        {label}
        {note && <div className="text-[11px] text-ink-3">{note}</div>}
      </td>
      <td className="num border-t border-line px-3 py-2 text-ink-2">{from}</td>
      <td className="num border-t border-line px-3 py-2 text-ink">{to}</td>
      <td className="border-t border-line px-3 py-2 text-[12.5px]">{change}</td>
    </tr>
  );
}

const Changed = ({ yes }: { yes: boolean }) => (yes ? <span className="font-medium text-accent-text">changed</span> : <span className="text-ink-3">no change</span>);

function Head({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-[11.5px] font-medium text-ink-3">{children}</th>;
}

export function VersionDiffView({ diff, slug }: { diff: VersionDiff; slug: string }) {
  const oqiBounds = (lo: number | null, hi: number | null) => (lo === null || hi === null ? "—" : `${lo.toFixed(0)}–${hi.toFixed(0)}`);
  const dimsChanged = diff.dimensions.filter((d) => d.value.changed || d.coverage.changed || d.status.changed);
  const noChange = diff.changeCount === 0;
  const evLink = (id: string, kind: "claim" | "metric") => (
    <Link href={`/deals/${slug}/evidence?${kind}=${id}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
      {id}
    </Link>
  );

  return (
    <div className="space-y-8">
      {noChange && <p className="rounded-lg border border-dashed border-line px-4 py-3 text-ink-3">These two versions produce the same scores, metrics, claims and question states.</p>}

      <div className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <div className="t-eyebrow mb-2">Scores and recommendation</div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <Head> </Head>
                  <Head>v{diff.from.versionNo}</Head>
                  <Head>v{diff.to.versionNo}</Head>
                  <Head>Change</Head>
                </tr>
              </thead>
              <tbody>
                <ScoreRow
                  label="Recommendation"
                  from={DECISION_LABEL[diff.recommendation.from] ?? diff.recommendation.from}
                  to={<span className={diff.recommendation.changed ? "font-medium" : ""}>{DECISION_LABEL[diff.recommendation.to] ?? diff.recommendation.to}</span>}
                  change={<Changed yes={diff.recommendation.changed} />}
                />
                <ScoreRow label="Operating quality (OQI)" note="Conventional index, not a probability" from={f1(diff.oqi.value.from)} to={f1(diff.oqi.value.to)} change={<Delta c={diff.oqi.value} />} />
                <ScoreRow label="OQI bounds" from={oqiBounds(diff.oqi.lower.from, diff.oqi.upper.from)} to={oqiBounds(diff.oqi.lower.to, diff.oqi.upper.to)} change={<Changed yes={diff.oqi.lower.changed || diff.oqi.upper.changed} />} />
                <ScoreRow label="OQI coverage" from={fPct(diff.oqi.coverage.from)} to={fPct(diff.oqi.coverage.to)} change={<Delta c={diff.oqi.coverage} fmt={fPct} />} />
                <ScoreRow
                  label="Evidence quality"
                  from={`${titleCase(diff.evidence.category.from)} · ${f1(diff.evidence.index.from)}`}
                  to={`${titleCase(diff.evidence.category.to)} · ${f1(diff.evidence.index.to)}`}
                  change={<Delta c={diff.evidence.index} />}
                />
                <ScoreRow label="Power-law potential" from={f1(diff.powerLaw.from)} to={f1(diff.powerLaw.to)} change={<Delta c={diff.powerLaw} />} />
                <ScoreRow label="Risk headline" from={titleCase(diff.riskHeadline.from)} to={titleCase(diff.riskHeadline.to)} change={<Changed yes={diff.riskHeadline.changed} />} />
                <ScoreRow label="Fund mandate" from={titleCase(diff.mandate.from)} to={titleCase(diff.mandate.to)} change={<Changed yes={diff.mandate.changed} />} />
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="t-eyebrow mb-2">
            Dimensions {dimsChanged.length > 0 ? `· ${dimsChanged.length} moved` : "· none moved"}
          </div>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <Head>Dimension</Head>
                  <Head>v{diff.from.versionNo}</Head>
                  <Head>v{diff.to.versionNo}</Head>
                  <Head>Change</Head>
                </tr>
              </thead>
              <tbody>
                {diff.dimensions.map((d) => {
                  const moved = d.value.changed || d.coverage.changed || d.status.changed;
                  return (
                    <tr key={d.id} className={moved ? "" : "text-ink-3"}>
                      <td className={cx("border-t border-line px-3 py-1.5", moved ? "text-ink" : "")}>{d.name}</td>
                      <td className="num border-t border-line px-3 py-1.5">
                        {f1(d.value.from)} <span className="text-[11px] text-ink-3">{fPct(d.coverage.from)}</span>
                      </td>
                      <td className="num border-t border-line px-3 py-1.5">
                        {f1(d.value.to)} <span className="text-[11px] text-ink-3">{fPct(d.coverage.to)}</span>
                      </td>
                      <td className="border-t border-line px-3 py-1.5 text-[12.5px]">{d.value.changed ? <Delta c={d.value} /> : d.coverage.changed ? <span className="text-ink-2">coverage {fPct(d.coverage.from)} → {fPct(d.coverage.to)}</span> : d.status.changed ? <span className="text-ink-2">{titleCase(d.status.from)} → {titleCase(d.status.to)}</span> : <span className="text-ink-3">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-3">Small figures are coverage — the share of the dimension backed by observed data.</p>
        </div>
      </div>

      <div>
        <div className="t-eyebrow mb-2">Primary metrics · {diff.metrics.length} changed</div>
        {diff.metrics.length === 0 ? (
          <p className="text-[13px] text-ink-3">No primary metric changed.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr>
                  <Head>Metric</Head>
                  <Head>v{diff.from.versionNo}</Head>
                  <Head>v{diff.to.versionNo}</Head>
                  <Head>What changed</Head>
                </tr>
              </thead>
              <tbody>
                {diff.metrics.map((m) => (
                  <tr key={m.metricKey} className="align-top">
                    <td className="border-t border-line px-3 py-2">
                      <span className="text-ink">{metricDef(m.metricKey)?.shortName ?? m.label}</span> <span className="font-mono text-[10.5px] text-ink-3">{m.metricKey}</span>
                    </td>
                    <td className="num border-t border-line px-3 py-2 text-ink-2">
                      {m.from ? (
                        <>
                          {metricValue(m.unit, m.from.value)} <span className="text-[11px] text-ink-3">{m.from.periodEnd ?? ""}</span> {evLink(m.from.id, "metric")}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num border-t border-line px-3 py-2 text-ink">
                      {m.to ? (
                        <>
                          {metricValue(m.unit, m.to.value)} <span className="text-[11px] text-ink-3">{m.to.periodEnd ?? ""}</span> {evLink(m.to.id, "metric")}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="border-t border-line px-3 py-2 text-[12.5px] text-ink-2">
                      {m.kind === "ADDED" ? "New metric" : m.kind === "REMOVED" ? "No longer reported" : [m.from!.value !== m.to!.value && "value", m.from!.method !== m.to!.method && `${m.from!.method.toLowerCase().replace("_", "-")} → ${m.to!.method.toLowerCase().replace("_", "-")}`, !m.from!.corrected && m.to!.corrected && "analyst override", m.from!.corrected && !m.to!.corrected && "override removed", m.from!.state !== m.to!.state && `${m.from!.state.toLowerCase()} → ${m.to!.state.toLowerCase()}`].filter(Boolean).join(" · ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div>
          <div className="t-eyebrow mb-2">
            Claims · {diff.claims.added.length} added · {diff.claims.verificationChanged.length} verification changed
          </div>
          {diff.claims.added.length + diff.claims.verificationChanged.length + diff.claims.removed.length === 0 ? (
            <p className="text-[13px] text-ink-3">No claim was added or changed verification.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {diff.claims.verificationChanged.map((c) => (
                <li key={`v-${c.id}`} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {evLink(c.id, "claim")}
                    <Badge tone={verificationTone(c.from)}>{VERIFICATION_TEXT[c.from]}</Badge>
                    <span className="text-ink-3">→</span>
                    <Badge tone={verificationTone(c.to)}>{VERIFICATION_TEXT[c.to]}</Badge>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-ink-2">{c.statement}</div>
                </li>
              ))}
              {diff.claims.added.map((c) => (
                <li key={`a-${c.id}`} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {evLink(c.id, "claim")}
                    <Badge tone="accent">Added</Badge>
                    <span className="text-[11.5px] text-ink-3">
                      {titleCase(c.category)}
                      {c.material ? " · material" : ""} · {VERIFICATION_TEXT[c.verification].toLowerCase()}
                    </span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-ink-2">{c.statement}</div>
                </li>
              ))}
              {diff.claims.removed.map((c) => (
                <li key={`r-${c.id}`} className="px-3 py-2 text-[13px]">
                  <span className="font-mono text-[10.5px] text-ink-3">{c.id}</span> <Badge tone="unknown">Removed</Badge>
                  <div className="mt-0.5 line-clamp-2 text-ink-3">{c.statement}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="t-eyebrow mb-2">
            Questions · {diff.questions.resolved.length} resolved · {diff.questions.changed.length} other changes
          </div>
          {diff.questions.resolved.length + diff.questions.changed.length + diff.questions.added.length === 0 ? (
            <p className="text-[13px] text-ink-3">No question changed status.</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {[...diff.questions.resolved, ...diff.questions.changed, ...diff.questions.added].map((q) => (
                <li key={q.id} className="px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/deals/${slug}/questions#${q.id}`} className="rounded bg-surface-3 px-1 font-mono text-[10.5px] text-ink-2 hover:text-accent-text">
                      {q.id}
                    </Link>
                    {q.from ? <Badge tone={questionStatusTone(q.from)}>{QUESTION_STATUS_TEXT[q.from]}</Badge> : <Badge tone="accent">New</Badge>}
                    <span className="text-ink-3">→</span>
                    <Badge tone={questionStatusTone(q.to)}>{QUESTION_STATUS_TEXT[q.to]}</Badge>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-ink-2">{q.question}</div>
                  {q.answer && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3">Answer: {q.answer}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
