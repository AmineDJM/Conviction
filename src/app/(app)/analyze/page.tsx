import { requireSession } from "@/server/session";
import { PageHeader } from "@/components/shell/page-header";
import { UploadForm } from "@/components/deals/upload-form";
import { getDefaultFund } from "@/server/repo";

export const metadata = { title: "Analyze company" };

export default async function AnalyzePage() {
  const s = await requireSession();
  const fund = getDefaultFund(s.workspaceId);
  return (
    <main className="pb-16">
      <PageHeader title="Analyze company" meta={`Scored against ${fund.name} · benchmark registry VC_BENCHMARK_V1_0`} />
      <div className="px-8">
        <UploadForm />
      </div>
    </main>
  );
}
