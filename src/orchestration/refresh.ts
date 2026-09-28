/**
 * REFRESH ONLY STALE DATA — update, never re-run, the analysis.
 *
 *   SELECT    engine/refresh.ts decides deterministically which items are stale
 *             (material claims, old/undated web sources backing them, stale metrics,
 *             open web questions not researched for a while). Nothing stale → no run.
 *   RESEARCH  one budgeted web-research call (research_refresh_v1) whose focus is
 *             exactly those items. Cost-controlled (REFRESH_BUDGET_USD, default $0.06),
 *             cancellable (run-control), recorded per call.
 *   APPLY     code scopes the output to the selected items (anything else is discarded
 *             and counted; "nothing found" is never evidence), applies it through
 *             assemble.applyResearch (verification recomputed from evidence links),
 *             recomputes freshness of the touched claims, logs the refresh in
 *             canonical.analysis.refreshes and commits a NEW immutable version
 *             (reason RESEARCH_REFRESH) with history + audit.
 *   INDEX     Fund Brain re-index of the new version.
 * The deck analysis, the thesis and every non-stale item are left exactly as they were.
 */
import { BudgetExceededError, CostController } from "@/ai/cost";
import { PRIMARY_MODEL, structured, type StructuredResult } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { RESEARCH_REFRESH, ResearchOutput, researchRefreshInstructions } from "@/ai/prompts/research";
import type { CanonicalDeal, RefreshRecord } from "@/domain/canonical";
import { claimFreshness, selectStaleItems, type StaleItem, type StalePlan } from "@/engine/refresh";
import { applyResearchDetailed, NEGATIVE_FINDING } from "./assemble";
import { CancelledError, registerRun, releaseRun, throwIfCancelled } from "./run-control";
import { commitCanonicalUpdate } from "@/server/versioning";
import * as repo from "@/server/repo";
import { logger } from "@/lib/log";

export const REFRESH_STEPS = [
  { step: "SELECT", label: "Selecting stale items" },
  { step: "RESEARCH", label: "Researching only the stale items" },
  { step: "APPLY", label: "Applying findings as a new version" },
  { step: "INDEX", label: "Updating deal memory" },
];

/** Default hard cap of one refresh (one research call + re-index). Configurable, bounded. */
export const REFRESH_BUDGET_USD = Math.min(0.25, Math.max(0.02, Number(process.env.REFRESH_BUDGET_USD ?? 0.06) || 0.06));
export const REFRESH_MAX_BUDGET_USD = 0.25;
const MAX_OUTPUT_TOKENS = 6_000;
const SEARCH_CEILING = 4;
/** Held back for the re-index embeddings so research cannot starve it. */
const INDEX_RESERVE_USD = 0.004;

export class RefreshError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Pure parts (tested without a model)                                  */
/* ------------------------------------------------------------------ */

/** The model's input: the stale items only, with what the record currently holds for each. */
export function refreshInput(deal: CanonicalDeal, plan: StalePlan): string {
  return JSON.stringify({
    company: { name: deal.identity.name, website: deal.identity.website, hq: deal.identity.hqCountry, oneLiner: deal.identity.oneLiner },
    referenceDate: plan.asOf.slice(0, 10),
    items: plan.items.map((it, i) => ({
      ref: `I${i + 1}`,
      kind: it.kind,
      claimId: it.claimIds.length === 1 ? it.claimIds[0] : null,
      claimIds: it.claimIds.length > 1 ? it.claimIds : undefined,
      metricId: it.metricId && !it.claimIds.length ? it.metricId : null,
      gapRef: it.gapRef,
      statement: it.kind === "SOURCE" ? it.claimIds.map((id) => `${id}: ${deal.claims.find((c) => c.id === id)?.statement ?? ""}`).join(" | ") : it.label,
      why: it.reason,
      currentEvidence: it.currentEvidence.slice(0, 4).map((e) => ({ url: e.url, publishedDate: e.publishedDate, retrievedAt: e.retrievedAt.slice(0, 10) })),
      suggestedQueries: it.suggestedQueries.length ? it.suggestedQueries : undefined,
    })),
  });
}

export interface ScopedOutput {
  scoped: ResearchOutput;
  /** Findings / sections about items outside the stale set, discarded. */
  discarded: number;
  /** "Nothing newer found" statements per item key — recorded as NOT_FOUND, never as evidence. */
  negatives: Map<string, string[]>;
  /** Finding ref → metric id, for metric items without a claim. */
  metricRefs: Map<string, string>;
}

/** Keep only what concerns the selected items; turn absence-of-evidence statements into NOT_FOUND notes. */
export function scopeRefreshOutput(out: ResearchOutput, plan: StalePlan): ScopedOutput {
  const byClaim = new Map<string, string[]>();
  const metricOnly = new Map<string, string>();
  const byGap = new Map<string, string>();
  for (const it of plan.items) {
    for (const id of it.claimIds) byClaim.set(id, [...(byClaim.get(id) ?? []), it.key]);
    if (it.metricId && !it.claimIds.length) metricOnly.set(it.metricId, it.key);
    if (it.gapRef) byGap.set(it.gapRef, it.key);
  }
  const negatives = new Map<string, string[]>();
  const metricRefs = new Map<string, string>();
  let discarded = out.founderFindings.length + out.competitors.length + out.marketEstimates.length;
  const findings: ResearchOutput["findings"] = [];
  for (const f of out.findings) {
    const rel = f.relatesToClaimRef;
    const keys = [...(rel ? (byClaim.get(rel) ?? []) : []), ...(rel && metricOnly.has(rel) ? [metricOnly.get(rel)!] : []), ...(f.gapRef && byGap.has(f.gapRef) ? [byGap.get(f.gapRef)!] : [])];
    if (!keys.length) {
      discarded++;
      continue;
    }
    if (NEGATIVE_FINDING.test(f.finding)) {
      for (const k of keys) negatives.set(k, [...(negatives.get(k) ?? []), f.finding]);
      continue;
    }
    if (rel && metricOnly.has(rel)) {
      metricRefs.set(f.ref, rel);
      findings.push({ ...f, relatesToClaimRef: null, effect: "NEW_INFORMATION" });
    } else if (rel && !byClaim.has(rel)) findings.push({ ...f, relatesToClaimRef: null, effect: "NEW_INFORMATION" }); // gap finding: never attached to a non-stale claim
    else findings.push(f);
  }
  const gapUpdates = out.gapUpdates.filter((u) => {
    const ok = byGap.has(u.gapRef);
    if (!ok) discarded++;
    return ok;
  });
  return { scoped: { findings, founderFindings: [], competitors: [], marketEstimates: [], gapUpdates, suspectedInstructions: out.suspectedInstructions }, discarded, negatives, metricRefs };
}

export interface ApplyRefreshInput {
  base: CanonicalDeal;
  plan: StalePlan;
  out: ResearchOutput;
  searchSources: { url: string; title?: string }[];
  /** Wall-clock time of the refresh (retrieval timestamps, history). */
  at: Date;
  runId: string | null;
  searches: number;
  costUsd: number;
}

const FRESH_RANK = { CURRENT: 0, AGING: 1, STALE: 2 } as const;
const urlKey = (u: string) => {
  try {
    const x = new URL(u);
    return (x.hostname.replace(/^www\./, "") + x.pathname.replace(/\/$/, "")).toLowerCase();
  } catch {
    return u.toLowerCase();
  }
};

/** Apply a scoped refresh to the base canonical object. Pure: returns a new object and the refresh record. */
export function applyRefresh(inp: ApplyRefreshInput): { deal: CanonicalDeal; record: RefreshRecord; summary: string } {
  const { base, plan, at } = inp;
  const asOf = new Date(plan.asOf);
  const day = at.toISOString().slice(0, 10);
  const { scoped, discarded, negatives, metricRefs } = scopeRefreshOutput(inp.out, plan);
  const { deal: next, refMap } = applyResearchDetailed(base, scoped, { searchSources: inp.searchSources, companyWebsite: base.identity.website }, at);
  const baseIds = new Set(base.claims.map((c) => c.id));
  const claim = (id: string) => next.claims.find((c) => c.id === id);

  // Claims created by this refresh: freshness at the reference date.
  for (const c of next.claims) if (!baseIds.has(c.id)) c.freshness = claimFreshness(c, next, asOf);

  // An undated stale source gets its publication date when a finding cites that same page with one.
  for (const it of plan.items.filter((x) => x.kind === "SOURCE")) {
    const s = next.sources.find((x) => x.id === it.ref);
    if (!s || s.publishedDate || !s.url) continue;
    const dated = scoped.findings.find((f) => f.publishedDate && urlKey(f.sourceUrl) === urlKey(s.url!));
    if (dated) s.publishedDate = dated.publishedDate;
  }

  const touched = new Set<string>();
  const items: RefreshRecord["items"] = plan.items.map((it) => {
    const fs = scoped.findings.filter((f) => (f.relatesToClaimRef && it.claimIds.includes(f.relatesToClaimRef)) || (it.gapRef && f.gapRef === it.gapRef) || (it.metricId && metricRefs.get(f.ref) === it.metricId));
    const newClaimIds = [...new Set(fs.map((f) => refMap.get(f.ref)).filter((id): id is string => !!id && !baseIds.has(id)))];
    const gu = it.gapRef ? scoped.gapUpdates.find((u) => u.gapRef === it.gapRef) : undefined;
    const has = (e: string) => fs.some((f) => f.effect === e && f.relatesToClaimRef && it.claimIds.includes(f.relatesToClaimRef));

    // Newer information about a stale claim: the old claim records it was superseded (its own evidence is kept).
    for (const f of fs.filter((x) => x.effect === "NEW_INFORMATION" && x.relatesToClaimRef && it.claimIds.includes(x.relatesToClaimRef))) {
      const old = claim(f.relatesToClaimRef!);
      const nid = refMap.get(f.ref);
      if (old && nid && !old.history.some((h) => h.note.includes(nid))) old.history.push({ at: at.toISOString(), change: "CHANGED", note: `Newer information (refresh ${day}): ${nid} — ${f.finding.slice(0, 160)}` });
    }
    // Freshness of the stale claims, from their evidence as it now stands.
    for (const id of it.claimIds) {
      const c = claim(id);
      if (!c || (it.kind !== "CLAIM" && !fs.some((f) => f.relatesToClaimRef === id))) continue;
      c.freshness = claimFreshness(c, next, asOf);
      touched.add(id);
    }
    if (it.metricId && !it.claimIds.length && newClaimIds.length) {
      const m = next.metrics.find((x) => x.id === it.metricId);
      if (m) m.notes = [m.notes, `Refresh ${day}: newer public information in ${newClaimIds.join(", ")} — the reported value is unchanged; correct it explicitly if it applies`].filter(Boolean).join(" | ");
    }
    if (gu) {
      const g = next.informationGaps.find((x) => x.id === gu.gapRef);
      if (g) g.resolutionNote = `Refresh ${day}: ${gu.note}`;
    }

    const outcome: RefreshRecord["items"][number]["outcome"] = has("CONTRADICTS")
      ? "CONTRADICTED"
      : newClaimIds.length
        ? "UPDATED"
        : has("CONFIRMS") || has("PARTIALLY_CONFIRMS")
          ? "CONFIRMED"
          : gu?.status === "RESOLVED"
            ? "RESOLVED"
            : gu?.status === "PARTIAL"
              ? "UPDATED"
              : gu || negatives.has(it.key)
                ? "NOT_FOUND"
                : "NO_RESULT";
    const after = it.claimIds.map((id) => claim(id)?.freshness).filter((x): x is NonNullable<typeof x> => !!x);
    const worst = after.length ? after.reduce((a, b) => (FRESH_RANK[b] > FRESH_RANK[a] ? b : a)) : null;
    const note = [
      ...fs.slice(0, 2).map((f) => `${f.effect.toLowerCase().replace(/_/g, " ")}: ${f.finding.slice(0, 200)}`),
      ...(gu ? [`${gu.status.toLowerCase().replace(/_/g, " ")}: ${gu.note.slice(0, 200)}`] : []),
      ...(negatives.get(it.key) ?? []).slice(0, 1).map((n) => `nothing newer found: ${n.slice(0, 200)}`),
    ].join(" · ");
    return { key: it.key, kind: it.kind, ref: it.ref, reason: it.reason, outcome, note: note || null, newClaimIds, freshnessBefore: it.freshness, freshnessAfter: it.kind === "GAP" ? null : worst };
  });

  const record: RefreshRecord = { at: at.toISOString(), asOf: plan.asOf, runId: inp.runId, promptVersion: RESEARCH_REFRESH.version, items, searches: inp.searches, costUsd: Math.round(inp.costUsd * 1e6) / 1e6, discardedOutOfScope: discarded };
  next.analysis.refreshes = [...(base.analysis.refreshes ?? []), record];
  const n = (o: string) => items.filter((x) => x.outcome === o).length;
  const newClaims = new Set(items.flatMap((x) => x.newClaimIds)).size;
  const summary = `Refreshed ${items.length} stale item(s): ${n("CONFIRMED")} confirmed, ${n("UPDATED")} updated, ${n("CONTRADICTED")} contradicted, ${n("RESOLVED")} resolved, ${n("NOT_FOUND")} not found, ${n("NO_RESULT")} without result; ${newClaims} new claim(s)`;
  return { deal: next, record, summary };
}

/* ------------------------------------------------------------------ */
/* Run lifecycle                                                        */
/* ------------------------------------------------------------------ */

export interface StartRefreshInput {
  workspaceId: string;
  userId: string | null;
  companyIdOrSlug: string;
  budgetUsd?: number | null;
  /** Reference date for staleness (default now). Scripts / tests only — the API does not expose it. */
  asOf?: Date;
}

export type StartRefreshResult =
  | { noop: true; plan: StalePlan; message: string }
  | { noop: false; plan: StalePlan; run: repo.RunRow; promise: Promise<void> };

export function nothingStaleMessage(plan: StalePlan): string {
  const c = plan.considered;
  return `Nothing is stale as of ${plan.asOf.slice(0, 10)}: ${c.materialClaims} material claim(s), ${c.webSources} web source(s), ${c.primaryMetrics} primary metric(s) and ${c.openWebGaps} open web question(s) checked${plan.deferred.length ? `; ${plan.deferred.length} item(s) re-checked recently` : ""}.`;
}

export async function startRefresh(inp: StartRefreshInput): Promise<StartRefreshResult> {
  const company = repo.getCompany(inp.workspaceId, inp.companyIdOrSlug);
  if (!company) throw new RefreshError("Not found", 404);
  const current = repo.getCurrentVersion(company);
  if (!current) throw new RefreshError("The deck analysis has not produced a version yet", 409);
  const latest = repo.latestRun(company.id);
  if (latest && (latest.status === "RUNNING" || latest.status === "QUEUED")) throw new RefreshError("An analysis run is already in progress for this company", 409);
  const budget = Math.min(REFRESH_MAX_BUDGET_USD, Math.max(0.02, inp.budgetUsd ?? REFRESH_BUDGET_USD));
  const asOf = inp.asOf ?? new Date();
  const plan = selectStaleItems(current.canonical, { asOf });
  if (!plan.items.length) return { noop: true, plan, message: nothingStaleMessage(plan) };

  const run = repo.createRun({
    workspaceId: inp.workspaceId,
    companyId: company.id,
    kind: "RESEARCH",
    mode: current.canonical.analysis.mode,
    model: PRIMARY_MODEL,
    promptVersions: { [RESEARCH_REFRESH.id]: RESEARCH_REFRESH.version, refresh_policy: plan.policy },
    registryId: current.row.registryId,
    budgetUsd: budget,
    steps: REFRESH_STEPS,
  });
  const c = plan.counts;
  repo.updateRunStep(run.id, "SELECT", "DONE", `${plan.items.length} stale item(s): ${c.CLAIM} claims, ${c.SOURCE} sources, ${c.METRIC} metrics, ${c.GAP} questions${plan.deferred.length ? `; ${plan.deferred.length} deferred` : ""}`);
  repo.audit(inp.workspaceId, inp.userId, "RESEARCH_REFRESH_STARTED", company.id, `${run.id} ${plan.items.map((x) => x.key).join(" ")}`.slice(0, 900));
  const promise = runRefresh({ workspaceId: inp.workspaceId, userId: inp.userId, companyId: company.id, runId: run.id, baseVersionId: current.row.id, plan, budgetUsd: budget });
  return { noop: false, plan, run, promise };
}

export interface RunRefreshInput {
  workspaceId: string;
  userId: string | null;
  companyId: string;
  runId: string;
  baseVersionId: string;
  plan: StalePlan;
  budgetUsd: number;
}

export async function runRefresh(inp: RunRefreshInput): Promise<void> {
  const log = logger.child({ runId: inp.runId, companyId: inp.companyId, kind: "RESEARCH_REFRESH" });
  const signal = registerRun(inp.runId);
  const cost = new CostController(inp.budgetUsd, inp.budgetUsd, (e) => repo.recordCost(inp.workspaceId, inp.runId, "ANALYSIS", e));
  const step = (s: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string) => repo.updateRunStep(inp.runId, s, status, detail);
  const order = REFRESH_STEPS.map((s) => s.step);
  let current = "RESEARCH";
  const t0 = Date.now();
  try {
    const company0 = repo.getCompany(inp.workspaceId, inp.companyId);
    const base0 = company0 ? repo.getVersion(inp.companyId, inp.baseVersionId) : null;
    if (!company0 || !base0) throw new Error("Company or version disappeared");

    /* ---------------- RESEARCH (one call) ---------------- */
    step("RESEARCH", "RUNNING");
    throwIfCancelled(signal);
    const reserve = cost.reserve(INDEX_RESERVE_USD);
    const instructionsFor = (n: number) => researchRefreshInstructions(n, inp.plan.asOf.slice(0, 10));
    const input = wrapUntrusted("stale items of a company record (contains excerpts from untrusted documents and web pages)", refreshInput(base0.canonical, inp.plan));
    const maxSearches = cost.maxSearchesWithin(PRIMARY_MODEL, cost.remainingUsd, input.length + instructionsFor(SEARCH_CEILING).length, MAX_OUTPUT_TOKENS, SEARCH_CEILING);
    if (maxSearches < 1) throw new BudgetExceededError("RESEARCH_REFRESH", cost.spentUsd, inp.budgetUsd);
    const res: StructuredResult<ResearchOutput> = await structured({
      step: "RESEARCH_REFRESH",
      promptVersion: RESEARCH_REFRESH.version,
      instructions: instructionsFor(maxSearches),
      input: [{ role: "user", content: input }],
      schema: ResearchOutput,
      schemaName: "research",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      effort: "low",
      webSearch: { maxCalls: maxSearches },
      cost,
      signal,
      maxAttempts: 1,
    });
    cost.release(reserve);
    step("RESEARCH", "DONE", `${res.usage.webSearches} search(es) of ${maxSearches} allowed, ${res.data.findings.length} finding(s), ${res.data.gapUpdates.length} question update(s) · $${cost.spentUsd.toFixed(4)} · ${(res.latencyMs / 1000).toFixed(1)} s`);

    /* ---------------- APPLY: new version on the version current *now* ---------------- */
    throwIfCancelled(signal);
    current = "APPLY";
    step("APPLY", "RUNNING");
    const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
    const base = repo.getCurrentVersion(company) ?? base0;
    // If another version landed meanwhile, only items still stale in it — and researched here — are applied.
    let plan = inp.plan;
    if (base.row.id !== base0.row.id) {
      const researched = new Set(inp.plan.items.map((x) => x.key));
      const again = selectStaleItems(base.canonical, { asOf: new Date(inp.plan.asOf) });
      plan = { ...again, items: again.items.filter((x: StaleItem) => researched.has(x.key)) };
    }
    const at = new Date();
    const { deal, record, summary } = applyRefresh({ base: base.canonical, plan, out: res.data, searchSources: res.searchSources, at, runId: inp.runId, searches: res.usage.webSearches, costUsd: cost.spentUsd });
    const commit = commitCanonicalUpdate({
      workspaceId: inp.workspaceId,
      userId: inp.userId,
      company,
      previous: base,
      canonical: deal,
      reason: "RESEARCH_REFRESH",
      runId: inp.runId,
      summary,
      history: {
        type: "RESEARCH_RUN",
        summary: `Stale data refresh — ${summary}`,
        payload: { runId: inp.runId, kind: "RESEARCH_REFRESH", fromVersionId: base.row.id, promptVersion: RESEARCH_REFRESH.version, policy: plan.policy, asOf: plan.asOf, items: record.items.map((x) => ({ key: x.key, outcome: x.outcome, newClaimIds: x.newClaimIds })), deferred: plan.deferred.length, discardedOutOfScope: record.discardedOutOfScope, searches: record.searches, costUsd: record.costUsd },
      },
      audit: { action: "RESEARCH_REFRESH_APPLIED", detail: `${inp.runId} ${base.row.id} → new version; ${record.items.length} items` },
    });
    step("APPLY", "DONE", `v${commit.version.versionNo} — ${summary}${commit.recommendationChanged ? `; recommendation now ${commit.derived.recommendation.status}` : ""}`);

    /* ---------------- INDEX ---------------- */
    current = "INDEX";
    step("INDEX", "RUNNING");
    const idx = await commit.reindex(cost);
    step("INDEX", idx.ok ? "DONE" : "FAILED", idx.detail);
    repo.finishRun(inp.runId, "COMPLETED", cost.spentUsd, deal.analysis.depth);
    log.info({ spentUsd: cost.spentUsd, ms: Date.now() - t0, items: record.items.length, version: commit.version.versionNo }, "stale refresh applied");
  } catch (e) {
    const cancelled = signal.aborted || e instanceof CancelledError;
    const msg = cancelled ? "Cancelled by user — no version was created" : e instanceof BudgetExceededError ? e.message : `Refresh failed: ${(e as Error).message.slice(0, 300)}`;
    if (!cancelled) log.error({ err: (e as Error).message }, "stale refresh failed");
    step(current, cancelled ? "SKIPPED" : "FAILED", msg.slice(0, 160));
    for (const s of order.slice(order.indexOf(current) + 1)) step(s, "SKIPPED", cancelled ? "Cancelled" : "Not reached");
    repo.finishRun(inp.runId, cancelled ? "CANCELLED" : "FAILED", cost.spentUsd, null, msg);
  } finally {
    releaseRun(inp.runId);
  }
}
