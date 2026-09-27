import Link from "next/link";
import { and, eq, sql } from "drizzle-orm";
import { requireSession } from "@/server/session";
import { costSummary, getDefaultFund, listCompanies } from "@/server/repo";
import { getDb, schema } from "@/db/client";
import { PageHeader } from "@/components/shell/page-header";
import { Badge, Empty, Section } from "@/components/ui";
import { DECISION_LABEL, decisionTone, titleCase, usd } from "@/lib/format";

export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const s = await requireSession();
  const fund = getDefaultFund(s.workspaceId);
  const companies = listCompanies(s.workspaceId);
  const invested = companies.filter((c) => c.executionStatus === "FUNDED" || c.executionStatus === "SIGNED");
  const byStatus = new Map<string, number>();
  for (const c of companies) byStatus.set(c.decisionStatus ?? "PROCESSING", (byStatus.get(c.decisionStatus ?? "PROCESSING") ?? 0) + 1);
  const bySector = new Map<string, number>();
  for (const c of companies) bySector.set(c.sector ?? "UNKNOWN", (bySector.get(c.sector ?? "UNKNOWN") ?? 0) + 1);
  const costs = costSummary(s.workspaceId);
  const db = getDb();
  const chat = db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${schema.costRecords.actualUsd}),0)`, avgLatency: sql<number>`avg(${schema.costRecords.latencyMs})` })
    .from(schema.costRecords)
    .where(and(eq(schema.costRecords.workspaceId, s.workspaceId), eq(schema.costRecords.scope, "CHAT"), eq(schema.costRecords.step, "BRAIN_ANSWER")))
    .get();
  const total = db.select({ total: sql<number>`coalesce(sum(${schema.costRecords.actualUsd}),0)` }).from(schema.costRecords).where(eq(schema.costRecords.workspaceId, s.workspaceId)).get();
  const exposure = invested.length * fund.initialCheckDefaultUsd;

  return (
    <main className="pb-16">
      <PageHeader title="Portfolio" meta={`${fund.name} · ${usd(fund.fundSizeUsd)} fund, vintage ${fund.vintage}`} />
      <div className="max-w-[1180px] space-y-12 px-8">
        <Section eyebrow="Invested" title={`${invested.length} signed or funded`}>
          {invested.length === 0 ? (
            <Empty title="No investments recorded">Record execution status (term sheet, signed, funded) from the IC page. Portfolio companies from before this system can be listed in the fund profile.</Empty>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {invested.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-2 pr-3">
                      <Link href={`/deals/${c.slug}`} className="font-medium hover:text-accent-text">
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-ink-2">{titleCase(c.sector)}</td>
                    <td className="py-2 pr-3 text-ink-2">{titleCase(c.stage)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone="accent">{titleCase(c.executionStatus)}</Badge>
                    </td>
                    <td className="num py-2 text-right">{c.baseMoic !== null ? `${c.baseMoic.toFixed(1)}× base (at entry)` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {invested.length > 0 && <p className="mt-2 text-[12px] text-ink-3">Indicative exposure at default check size: {usd(exposure)} ({((exposure / fund.fundSizeUsd) * 100).toFixed(1)}% of fund, before reserves).</p>}
          {fund.portfolio.length > 0 && <p className="mt-1 text-[12px] text-ink-3">Also in portfolio (fund profile): {fund.portfolio.map((p) => p.name).join(", ")}.</p>}
        </Section>

        <div className="grid gap-12 md:grid-cols-2">
          <Section eyebrow="Pipeline" title={`${companies.length} companies analyzed`}>
            <ul className="divide-y divide-line border-y border-line text-[13px]">
              {[...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <li key={k} className="flex items-center justify-between py-2">
                  {k === "PROCESSING" ? <span className="text-ink-3">Processing</span> : <Badge tone={decisionTone(k)} dot>{DECISION_LABEL[k] ?? k}</Badge>}
                  <span className="num">{n}</span>
                </li>
              ))}
            </ul>
          </Section>
          <Section eyebrow="Concentration" title="Dealflow by sector">
            <ul className="divide-y divide-line border-y border-line text-[13px]">
              {[...bySector.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                <li key={k} className="flex items-center justify-between py-2">
                  <span>{titleCase(k)}</span>
                  <span className="num">{n}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <Section eyebrow="Cost control (§132)" title="What the analysis costs">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] text-ink-3">
                <th className="py-2 pr-3 font-medium">Mode</th>
                <th className="py-2 pr-3 text-right font-medium">Runs</th>
                <th className="py-2 pr-3 text-right font-medium">Average cost</th>
                <th className="py-2 pr-3 text-right font-medium">Max cost</th>
                <th className="py-2 font-medium">Budget</th>
              </tr>
            </thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.mode} className="border-t border-line">
                  <td className="py-2 pr-3">{titleCase(c.mode)}</td>
                  <td className="num py-2 pr-3 text-right">{c.runs}</td>
                  <td className="num py-2 pr-3 text-right">${(c.avgUsd ?? 0).toFixed(3)}</td>
                  <td className="num py-2 pr-3 text-right">${(c.maxUsd ?? 0).toFixed(3)}</td>
                  <td className="py-2 text-ink-3">{c.mode === "STANDARD" ? "target ≤ $0.25 · hard cap $0.50 (enforced in code)" : c.mode === "FAST_SCREEN" ? "hard cap $0.10" : "explicit cap $3"}</td>
                </tr>
              ))}
              <tr className="border-t border-line">
                <td className="py-2 pr-3">Fund Brain answers</td>
                <td className="num py-2 pr-3 text-right">{chat?.n ?? 0}</td>
                <td className="num py-2 pr-3 text-right">${chat?.n ? ((chat.total ?? 0) / chat.n).toFixed(4) : "0"}</td>
                <td className="py-2 pr-3" />
                <td className="py-2 text-ink-3">avg latency {chat?.avgLatency ? `${(chat.avgLatency / 1000).toFixed(1)}s` : "—"}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[12px] text-ink-3">Total model and search spend in this workspace: ${(total?.total ?? 0).toFixed(3)}.</p>
        </Section>
      </div>
    </main>
  );
}
