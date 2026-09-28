import Link from "next/link";
import { requireSession } from "@/server/session";
import { listCompanies } from "@/server/repo";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Empty, Section } from "@/components/ui";
import { DECISION_LABEL, STAGE_LABEL, decisionTone, evidenceTone, relative, titleCase, usd } from "@/lib/format";
import { DecisionControls } from "@/components/ic/decision-controls";

export const metadata = { title: "IC" };

const IC_STAGE = new Set(["IC_READY", "ANALYTICAL_RECOMMEND_INVEST", "DEEP_DD", "NEEDS_TARGETED_DILIGENCE"]);

export default async function IcPage() {
  const s = await requireSession();
  const all = listCompanies(s.workspaceId).filter((c) => c.currentVersionId);
  const agenda = all.filter((c) => IC_STAGE.has(c.decisionStatus ?? "") && c.icDecision === "PENDING");
  const decided = all.filter((c) => c.icDecision !== "PENDING" || c.executionStatus !== "NOT_STARTED");
  const canWrite = s.role !== "VIEWER";
  return (
    <main className="pb-16">
      <PageHeader title="Investment committee" meta="The analytical recommendation, the IC decision and execution status are separate records. Recording a decision never changes the analysis." />
      <div className="max-w-[1180px] space-y-12 px-8">
        <Section eyebrow="Agenda" title="Deals the analysis considers ready for IC or deep diligence">
          {agenda.length === 0 ? (
            <Empty title="Nothing on the agenda">Deals reach this list when the recommendation gates admit Targeted diligence, Deep DD, IC ready or Recommend invest.</Empty>
          ) : (
            <DealTable rows={agenda} canWrite={canWrite} />
          )}
        </Section>
        <Section eyebrow="Decisions" title="Recorded IC decisions and execution">
          {decided.length === 0 ? <p className="text-ink-3">No decisions recorded yet.</p> : <DealTable rows={decided} canWrite={canWrite} />}
        </Section>
        <Section eyebrow="All deals" title="Record a decision on any deal">
          <DealTable rows={all.filter((c) => !agenda.includes(c) && !decided.includes(c))} canWrite={canWrite} />
        </Section>
      </div>
    </main>
  );
}

function DealTable({ rows, canWrite }: { rows: ReturnType<typeof listCompanies>; canWrite: boolean }) {
  if (!rows.length) return <p className="text-ink-3">—</p>;
  return (
    <div className="overflow-x-auto">
    <table className="w-full min-w-[640px] text-[13px]">
      <thead>
        <tr className="text-left text-[11.5px] text-ink-3">
          <th className="py-2 pr-3 font-medium">Company</th>
          <th className="py-2 pr-3 font-medium">Recommendation</th>
          <th className="py-2 pr-3 font-medium">Evidence</th>
          <th className="py-2 pr-3 text-right font-medium">Round</th>
          <th className="py-2 pr-3 text-right font-medium">Base MOIC</th>
          <th className="py-2 pr-3 font-medium">IC decision · Execution</th>
          <th className="py-2 text-right font-medium">Updated</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-line align-top">
            <td className="py-2.5 pr-3">
              <Link href={`/deals/${c.slug}`} className="font-medium hover:text-accent-text">
                {c.name}
              </Link>
              <div className="text-[12px] text-ink-3">
                {STAGE_LABEL[c.stage ?? ""] ?? "—"} · {titleCase(c.sector)}
                {c.analysisDepth === "PARTIAL" && <span className="text-warn"> · partial analysis</span>}
              </div>
            </td>
            <td className="py-2.5 pr-3">
              {c.decisionStatus && (
                <Badge tone={decisionTone(c.decisionStatus)} dot>
                  {DECISION_LABEL[c.decisionStatus]}
                </Badge>
              )}
            </td>
            <td className="py-2.5 pr-3">{c.evidence && <Badge tone={evidenceTone(c.evidence)}>{titleCase(c.evidence)}</Badge>}</td>
            <td className="num py-2.5 pr-3 text-right">{usd(c.roundUsd)}</td>
            <td className="num py-2.5 pr-3 text-right">{c.baseMoic !== null ? `${c.baseMoic.toFixed(1)}×` : "—"}</td>
            <td className="py-2.5 pr-3">
              <DecisionControls companyId={c.id} icDecision={c.icDecision} executionStatus={c.executionStatus} canWrite={canWrite} />
            </td>
            <td className="num py-2.5 text-right text-[12px] text-ink-3">{relative(c.updatedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}
