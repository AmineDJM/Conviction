import { requireSession } from "@/server/session";
import { getDefaultFund, listCompanies } from "@/server/repo";
import { listFundMemory } from "@/server/fund-memory";
import { PageHeader } from "@/components/shell/page-header";
import { FundWorkspace } from "@/components/fund/fund-workspace";

export const metadata = { title: "Fund" };

export default async function FundPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const s = await requireSession();
  const { welcome } = await searchParams;
  const memory = listFundMemory(s.workspaceId);
  const companies = listCompanies(s.workspaceId).map((c) => ({ id: c.id, name: c.name }));
  return (
    <main className="pb-16">
      <PageHeader
        title={`${s.workspaceName} — fund memory`}
        meta="What the Fund Brain knows natively: strategy, criteria, verticals, IC preferences and what was actually said in meetings. Each item is labelled DOCUMENTED, OBSERVED or INFERRED."
      />
      <FundWorkspace profile={getDefaultFund(s.workspaceId)} memory={memory} companies={companies} welcome={welcome === "1"} canWrite={s.role !== "VIEWER"} />
    </main>
  );
}
