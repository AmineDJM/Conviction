/** Props of the "Refresh stale sources" panel, computed on the server from the stored (raw) version. */
import type { CanonicalDeal } from "@/domain/canonical";
import { selectStaleItems } from "@/engine/refresh";
import { nothingStaleMessage, REFRESH_BUDGET_USD } from "@/orchestration/refresh";
import type { RefreshPanelData } from "@/components/deal/refresh-stale";
import * as repo from "./repo";

export function refreshPanelData(company: repo.CompanyRow, raw: CanonicalDeal, run: repo.RunRow | undefined, asOf = new Date()): RefreshPanelData {
  const plan = selectStaleItems(raw, { asOf });
  const live = !!run && (run.status === "RUNNING" || run.status === "QUEUED");
  const last = raw.analysis.refreshes?.at(-1) ?? null;
  let diffHref: string | null = null;
  let versionLabel: string | null = null;
  if (last?.runId) {
    const versions = repo.listVersions(company.id);
    const to = versions.find((v) => v.runId === last.runId);
    const from = to ? versions.find((v) => v.versionNo === to.versionNo - 1) : undefined;
    if (to && from) {
      diffHref = `/deals/${company.slug}/history?from=${from.id}&to=${to.id}`;
      versionLabel = `v${from.versionNo} → v${to.versionNo}`;
    }
  }
  const lite = (x: { key: string; kind: string; ref: string; label: string; reason: string }) => ({ key: x.key, kind: x.kind, ref: x.ref, label: x.label, reason: x.reason });
  return {
    companyId: company.id,
    asOf: plan.asOf,
    items: plan.items.map(lite),
    deferred: plan.deferred.map(lite),
    counts: plan.counts,
    nothingMessage: plan.items.length ? null : nothingStaleMessage(plan),
    budgetUsd: REFRESH_BUDGET_USD,
    refreshRunning: live && run!.kind === "RESEARCH",
    otherRunRunning: live && run!.kind !== "RESEARCH",
    last: last
      ? {
          at: last.at,
          asOf: last.asOf,
          searches: last.searches,
          costUsd: last.costUsd,
          discardedOutOfScope: last.discardedOutOfScope,
          items: last.items.map((x) => ({ key: x.key, kind: x.kind, ref: x.ref, outcome: x.outcome, note: x.note, newClaimIds: x.newClaimIds, freshnessBefore: x.freshnessBefore, freshnessAfter: x.freshnessAfter })),
          diffHref,
          versionLabel,
        }
      : null,
  };
}
