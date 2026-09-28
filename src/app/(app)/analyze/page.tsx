import { requireSession } from "@/server/session";
import { PageHeader } from "@/components/shell/page-header";
import { UploadForm } from "@/components/deals/upload-form";
import { getDefaultFund } from "@/server/repo";
import { ACTIVE_REGISTRY_ID } from "@/engine/benchmarks";

export const metadata = { title: "Analyze company" };

export default async function AnalyzePage() {
  const s = await requireSession();
  const fund = getDefaultFund(s.workspaceId);
  return (
    <main className="pb-16">
      <PageHeader title="Analyze company" meta={`Scored against ${fund.name} · benchmark registry ${ACTIVE_REGISTRY_ID}`} />
      <div className="px-8">
        <UploadForm />
      </div>
    </main>
  );
}
