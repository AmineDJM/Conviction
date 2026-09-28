/**
 * Commit an edit of the canonical object as a new company version (§102).
 *
 * Shared by the metric-correction, question-update and founder-call flows:
 * the deterministic layer is recomputed against the version's own benchmark
 * registry and the workspace fund profile, the version is persisted with a
 * reason, and the history/audit trail records who changed what. Fund Brain
 * re-indexing is returned as a thunk so route handlers can defer it until
 * after the response and background jobs can await it.
 */
import type { CanonicalDeal } from "@/domain/canonical";
import { derive, type DerivedAnalysis } from "@/engine/derive";
import { applyOverrides } from "@/engine/overrides";
import { getRegistry } from "@/engine/benchmarks";
import { indexCompanyForBrain } from "@/brain/indexer";
import type { CostController } from "@/ai/cost";
import { logger } from "@/lib/log";
import * as repo from "./repo";

export interface CommitInput {
  workspaceId: string;
  userId: string | null;
  company: repo.CompanyRow;
  previous: repo.LoadedVersion;
  canonical: CanonicalDeal;
  reason: repo.VersionReason;
  summary: string;
  history: { type: repo.HistoryType; summary: string; payload?: unknown };
  audit: { action: string; detail?: string };
  runId?: string | null;
  /** Meetings workflow stage of the new version (see repo.saveVersion). */
  stage?: repo.SaveVersionInput["stage"];
  stageSeq?: number | null;
}

export interface CommitResult {
  version: repo.VersionRow;
  derived: DerivedAnalysis;
  recommendationChanged: boolean;
  /** Re-index the Fund Brain for the new version. Never throws. */
  reindex: (cost?: CostController) => Promise<{ ok: boolean; detail: string }>;
}

export function commitCanonicalUpdate(v: CommitInput): CommitResult {
  const registry = getRegistry(v.previous.row.registryId);
  const fund = repo.getDefaultFund(v.workspaceId);
  const derived = derive(v.canonical, registry, fund);
  const version = repo.saveVersion({
    company: v.company,
    canonical: v.canonical,
    derived,
    reason: v.reason,
    runId: v.runId ?? null,
    summary: v.summary,
    userId: v.userId,
    stage: v.stage,
    stageSeq: v.stageSeq,
  });
  repo.addHistory({ workspaceId: v.workspaceId, companyId: v.company.id, type: v.history.type, versionId: version.id, summary: v.history.summary, payload: v.history.payload, userId: v.userId });

  const before = v.previous.derived.recommendation.status;
  const after = derived.recommendation.status;
  const recommendationChanged = before !== after;
  if (recommendationChanged) {
    repo.addHistory({
      workspaceId: v.workspaceId,
      companyId: v.company.id,
      type: "RECOMMENDATION_CHANGED",
      versionId: version.id,
      summary: `${before} → ${after} (after ${v.reason.toLowerCase().replace(/_/g, " ")})`,
      payload: { from: before, to: after, reason: v.reason },
      userId: v.userId,
    });
  }
  repo.audit(v.workspaceId, v.userId, v.audit.action, v.company.id, v.audit.detail);

  const reindex = async (cost?: CostController) => {
    try {
      const stats = await indexCompanyForBrain({ workspaceId: v.workspaceId, companyId: v.company.id, versionId: version.id, canonical: applyOverrides(v.canonical), derived, cost });
      return { ok: true, detail: `${stats.chunks} chunks, ${stats.embedded} embedded, ${stats.facts} facts` };
    } catch (e) {
      logger.error({ err: (e as Error).message, companyId: v.company.id, versionId: version.id }, "re-index failed");
      return { ok: false, detail: (e as Error).message.slice(0, 160) };
    }
  };
  return { version, derived, recommendationChanged, reindex };
}
