import Link from "next/link";
import { loadDeal } from "@/server/deal";
import * as repo from "@/server/repo";
import { canWrite } from "@/server/session";
import { founderCallChanges } from "@/reports/version-diff";
import { Badge, Button, IndexBar, Section } from "@/components/ui";
import { titleCase } from "@/lib/format";
import { QuestionList } from "@/components/deal/questions/question-list";
import { FounderCallForm } from "@/components/deal/questions/founder-call-form";
import { WhatChanged } from "@/components/deal/questions/what-changed";

const CHANNEL_TEXT = { WEB: "Web research", FOUNDER: "Founder", DATA_ROOM: "Data room" } as const;
const GAP_STATUS_TEXT: Record<string, string> = { OPEN: "Open", NEEDS_FOUNDER: "Needs founder", RESEARCHED: "Researched", RESOLVED: "Resolved" };

export default async function QuestionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { session, company, version, run } = await loadDeal(slug);
  // Pages render alongside the layout; while the first analysis is running there is no version yet.
  if (!version) return null;
  const c = version!.canonical;
  const d = version!.derived;
  const writable = canWrite(session);

  // "What changed" after the latest founder call: that version vs the one before it.
  const versions = repo.listVersions(company.id); // newest first
  const callIdx = versions.findIndex((v) => v.reason === "FOUNDER_CALL");
  let whatChanged: React.ReactNode = null;
  if (callIdx >= 0 && callIdx < versions.length - 1) {
    const after = repo.getVersion(company.id, versions[callIdx]!.id);
    const before = repo.getVersion(company.id, versions[callIdx + 1]!.id);
    if (after && before) {
      const ev = repo.listHistory(company.id).find((h) => h.type === "FOUNDER_CALL_ADDED" && h.versionId === after.row.id);
      const payload = (ev?.payload ?? null) as { modelSummary?: string } | null;
      whatChanged = (
        <WhatChanged
          changes={founderCallChanges(before.canonical, after.canonical)}
          slug={company.slug}
          versionNo={after.row.versionNo}
          prevVersionNo={before.row.versionNo}
          createdAt={after.row.createdAt}
          modelSummary={payload?.modelSummary ?? null}
        />
      );
    }
  }
  const activeCallRun = run && run.kind === "FOUNDER_CALL" && (run.status === "RUNNING" || run.status === "QUEUED") ? run.id : null;

  const qs = c.questions;
  const count = (s: string) => qs.filter((q) => q.status === s).length;
  const priority = d.researchPriority;
  const gapById = new Map(c.informationGaps.map((g) => [g.id, g]));
  const closedGaps = c.informationGaps.filter((g) => g.status === "RESOLVED" || g.status === "RESEARCHED");

  return (
    <main className="mx-auto max-w-[1180px] space-y-14 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6 border-b border-line pb-6">
        <div>
          <div className="t-eyebrow mb-1.5">Founder questions</div>
          <p className="max-w-[720px] text-[14px] leading-relaxed text-ink-2">
            Each question passed the decision test: the two plausible answers lead to different actions. Status records what happened on the call, not a judgement of the founder.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <dl className="num flex flex-wrap gap-x-6 gap-y-2 text-[12.5px]">
            {(
              [
                ["Open", count("OPEN")],
                ["Asked", count("ASKED")],
                ["Not fully resolved", count("NOT_FULLY_RESOLVED")],
                ["Resolved", count("RESOLVED")],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-ink-3">{k}</dt>
                <dd className="text-[15px] font-medium text-ink">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <Button href={`/deals/${company.slug}/brief`} variant="secondary">
              Founder call brief
            </Button>
            {writable && (
              <Button href="#call" variant="ghost">
                Add call transcript
              </Button>
            )}
          </div>
        </div>
      </div>

      <QuestionList questions={qs} companyId={company.id} versionId={version!.row.id} canWrite={writable} />

      <Section id="call" eyebrow="Founder call update" title="Update the analysis from a call — without restarting it">
        <p className="mb-4 max-w-[820px] text-[13px] leading-relaxed text-ink-2">
          The transcript is read against the open questions and the claim ledger. Answers are recorded, claims are marked confirmed, changed, contradicted or unresolved, and new claims and metrics are added as company-reported.
          Founder statements never upgrade verification on their own. Scores are then recomputed and a new version is saved.
        </p>
        {whatChanged && <div className="mb-6">{whatChanged}</div>}
        <FounderCallForm companyId={company.id} canWrite={writable} activeRunId={activeCallRun} />
      </Section>

      <Section
        id="gaps"
        eyebrow="Open information gaps"
        title="What we still do not know, and where to find it"
        action={<span className="text-[12px] text-ink-3">Research priority index — not a probability</span>}
      >
        {priority.length === 0 ? (
          <p className="text-ink-3">No open information gaps.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="text-left text-[11.5px] text-ink-3">
                  <th className="px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--line)]" title="Decision importance × uncertainty × researchability. A conventional ranking index (0–100), not a probability.">
                    Priority index
                  </th>
                  <th className="w-[50%] px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--line)]">Gap</th>
                  <th className="px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--line)]">About</th>
                  <th className="px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--line)]">Channel</th>
                  <th className="px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--line)]">Status</th>
                </tr>
              </thead>
              <tbody>
                {priority.map((p) => {
                  const g = gapById.get(p.gapId);
                  return (
                    <tr key={p.gapId} className="align-top">
                      <td className="border-t border-line px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="num w-7 text-right font-medium text-ink">{p.index}</span>
                          <IndexBar value={p.index} width={56} />
                        </div>
                      </td>
                      <td className="border-t border-line px-3 py-2.5">
                        <div className="flex gap-2">
                          <span className="num mt-[2px] shrink-0 font-mono text-[11px] text-ink-3">{p.gapId}</span>
                          <div>
                            <div className="text-ink">{p.question}</div>
                            {g?.whyItMatters && <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-3" title={g.whyItMatters}>{g.whyItMatters}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="border-t border-line px-3 py-2.5 text-ink-2">{g ? titleCase(g.target) : "—"}</td>
                      <td className="border-t border-line px-3 py-2.5">
                        <Badge tone={p.channel === "FOUNDER" ? "accent" : "neutral"}>{CHANNEL_TEXT[p.channel]}</Badge>
                      </td>
                      <td className="border-t border-line px-3 py-2.5 text-[12.5px] text-ink-2">
                        {g ? GAP_STATUS_TEXT[g.status] : "—"}
                        {g && (
                          <div className="num text-[11px] text-ink-3">
                            importance {g.decisionImportance}/5 · uncertainty {g.uncertainty}/5
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {closedGaps.length > 0 && (
          <details className="mt-3 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink">
              {closedGaps.length} gap{closedGaps.length === 1 ? "" : "s"} researched or resolved
            </summary>
            <ul className="mt-2 space-y-1.5">
              {closedGaps.map((g) => (
                <li key={g.id} className="grid grid-cols-[64px_110px_1fr] gap-3">
                  <span className="font-mono text-[11px] text-ink-3">{g.id}</span>
                  <span className="text-ink-3">{GAP_STATUS_TEXT[g.status]}</span>
                  <span className="text-ink-2">
                    {g.question}
                    {g.resolutionNote && <span className="text-ink-3"> — {g.resolutionNote}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        <p className="mt-3 text-[12px] text-ink-3">
          Web gaps are researched automatically within budget; founder and data-room gaps feed the <Link href={`/deals/${company.slug}/brief`} className="text-ink-2 hover:text-ink">founder call brief</Link>.
        </p>
      </Section>
    </main>
  );
}
