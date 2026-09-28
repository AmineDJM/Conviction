/**
 * §14 Recalculate portfolio: re-score every company under a registry version
 * (and the current fund profile) as NEW versions. Historical versions and
 * their scores are preserved untouched.
 */
import { applyOverrides } from "@/engine/overrides";
import { getRegistry } from "@/engine/benchmarks";
import { derive } from "@/engine/derive";
import { indexCompanyForBrain } from "@/brain/indexer";
import * as repo from "./repo";

export interface RecalcRow {
  companyId: string;
  name: string;
  slug: string;
  fromRegistry: string;
  toRegistry: string;
  oqiBefore: number | null;
  oqiAfter: number | null;
  statusBefore: string;
  statusAfter: string;
  changed: boolean;
}

export async function recalculatePortfolio(workspaceId: string, userId: string, registryId?: string, reason: "BENCHMARK_RECALC" | "FUND_PROFILE_CHANGE" = "BENCHMARK_RECALC"): Promise<RecalcRow[]> {
  const registry = getRegistry(registryId);
  const fund = repo.getDefaultFund(workspaceId);
  const out: RecalcRow[] = [];
  for (const company of repo.listCompanies(workspaceId)) {
    const current = repo.getCurrentVersion(company);
    if (!current || company.status === "PROCESSING") continue;
    const derived = derive(current.canonical, registry, fund);
    const before = current.derived;
    const changed =
      before.operatingQuality.value !== derived.operatingQuality.value ||
      before.recommendation.status !== derived.recommendation.status ||
      before.registryId !== derived.registryId ||
      before.fundFit.index !== derived.fundFit.index;
    const row: RecalcRow = {
      companyId: company.id,
      name: company.name,
      slug: company.slug,
      fromRegistry: before.registryId,
      toRegistry: registry.id,
      oqiBefore: before.operatingQuality.value,
      oqiAfter: derived.operatingQuality.value,
      statusBefore: before.recommendation.status,
      statusAfter: derived.recommendation.status,
      changed,
    };
    out.push(row);
    if (!changed) continue;
    const summary = `Recalculated under ${registry.id}: OQI ${before.operatingQuality.value ?? "n/s"} → ${derived.operatingQuality.value ?? "n/s"}; ${before.recommendation.status} → ${derived.recommendation.status}`;
    const version = repo.saveVersion({ company, canonical: current.canonical, derived, reason, runId: null, summary, userId });
    repo.addHistory({ workspaceId, companyId: company.id, type: "BENCHMARK_RECALCULATED", versionId: version.id, summary, userId, payload: row });
    if (before.recommendation.status !== derived.recommendation.status)
      repo.addHistory({ workspaceId, companyId: company.id, type: "RECOMMENDATION_CHANGED", versionId: version.id, summary: `${before.recommendation.status} → ${derived.recommendation.status} (recalculation)`, userId });
    await indexCompanyForBrain({ workspaceId, companyId: company.id, versionId: version.id, canonical: applyOverrides(current.canonical), derived });
  }
  repo.audit(workspaceId, userId, "PORTFOLIO_RECALCULATED", registry.id, `${out.filter((r) => r.changed).length} changed`);
  return out;
}
