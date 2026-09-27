import { apiSession } from "@/server/session";
import { getRun, getCompany } from "@/server/repo";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  const run = getRun(s.workspaceId, (await params).id);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  const company = getCompany(s.workspaceId, run.companyId);
  return Response.json({
    id: run.id,
    status: run.status,
    mode: run.mode,
    depth: run.depth,
    progress: run.progress,
    spentUsd: run.spentUsd,
    budgetUsd: run.budgetUsd,
    error: run.error,
    slug: company?.slug,
    name: company?.name,
    hasVersion: !!company?.currentVersionId,
  });
}
