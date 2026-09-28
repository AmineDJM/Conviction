import { requireSession } from "@/server/session";
import { getDefaultFund, listCompanies } from "@/server/repo";
import { listFundMemory } from "@/server/fund-memory";
import { PageHeader } from "@/components/shell/page-header";
import { FundWorkspace, type FundTab } from "@/components/fund/fund-workspace";

// Kept here, not imported from the client module: a server component only sees client references for its values.
const TABS: readonly FundTab[] = ["profile", "knowledge", "ic", "meetings"];

/** The Fund workspace, shared by /fund, /fund/ic and /fund/meetings (Fund Brain citations link to the latter two with #<id>). */
export async function FundPage({ tab, welcome }: { tab?: string | null; welcome?: boolean }) {
  const s = await requireSession();
  const memory = listFundMemory(s.workspaceId);
  const companies = listCompanies(s.workspaceId).map((c) => ({ id: c.id, name: c.name }));
  const initialTab: FundTab = (TABS as readonly string[]).includes(tab ?? "") ? (tab as FundTab) : welcome ? "profile" : "knowledge";
  return (
    <main className="pb-16">
      <PageHeader
        title={`${s.workspaceName} — fund memory`}
        meta="What the Fund Brain knows natively: strategy, criteria, verticals, IC preferences and what was actually said in meetings. Each item is labelled DOCUMENTED, OBSERVED or INFERRED."
      />
      <FundWorkspace profile={getDefaultFund(s.workspaceId)} memory={memory} companies={companies} welcome={!!welcome} initialTab={initialTab} canWrite={s.role !== "VIEWER"} />
    </main>
  );
}
