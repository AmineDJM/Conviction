/**
 * The ONE analyst-correction path: overrides (engine/overrides.ts).
 *
 * Adding or reverting an override appends to / removes from
 * `canonical.overrides` and saves a NEW version (reason USER_OVERRIDE) through
 * the shared commit (server/versioning.ts): derive() applies the overrides,
 * history + audit record who changed what, the Fund Brain is re-indexed.
 * The raw extraction is never overwritten.
 *
 * Used by POST/DELETE /api/deals/:id/overrides and by the legacy
 * POST /api/deals/:id/metrics ("Correct this metric"), which now records an
 * override instead of a USER_CORRECTED metric copy.
 */
import * as repo from "./repo";
import { commitCanonicalUpdate, type CommitResult } from "./versioning";
import { addOverride, removeOverride, validateOverride, type OverrideTarget } from "@/engine/overrides";

const show = (v: unknown) => (v === null || v === undefined ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v));

export type OverrideCommit = { ok: true; status: 200; body: Record<string, unknown>; commit: CommitResult } | { ok: false; status: 400 | 404 | 409 | 500; error: string };

interface Actor {
  workspaceId: string;
  userId: string | null;
  name: string;
}

type Loaded = { company: repo.CompanyRow; current: repo.LoadedVersion } | { error: string; status: 404 | 409 };

function load(actor: Actor, companyId: string, versionId?: string): Loaded {
  const company = repo.getCompany(actor.workspaceId, companyId);
  if (!company) return { error: "Not found", status: 404 };
  if (company.status === "PROCESSING") return { error: "An analysis is running for this deal. Try again when it completes.", status: 409 };
  const current = repo.getCurrentVersion(company);
  if (!current) return { error: "No analysis version to override", status: 409 };
  if (versionId && versionId !== current.row.id) return { error: "This deal changed since you loaded it. Reload and try again.", status: 409 };
  return { company, current };
}

const describe = (target: OverrideTarget, ref: string, field: string) => `${target === "METRIC" || target === "CLAIM" ? ref : target.toLowerCase()}.${field}`;

export function commitOverride(actor: Actor, companyId: string, body: { target: OverrideTarget; ref: string; field: string; to: unknown; reason: string; versionId?: string }): OverrideCommit {
  const loaded = load(actor, companyId, body.versionId);
  if ("error" in loaded) return { ok: false, status: loaded.status, error: loaded.error };
  const { company, current } = loaded;
  const v = validateOverride(current.canonical, body);
  if (!v.ok) return { ok: false, status: 400, error: v.error };
  const { deal, override } = addOverride(current.canonical, { target: body.target, ref: body.ref, field: body.field, from: v.from, to: v.value, reason: body.reason, by: actor.name, at: new Date().toISOString() });
  const what = describe(body.target, body.ref, body.field);
  try {
    const res = commitCanonicalUpdate({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "USER_OVERRIDE",
      summary: `${override.id} ${what}: ${show(v.from)} → ${show(v.value)} (analyst override)`,
      history: { type: "OVERRIDE_ADDED", summary: `${what} overridden: ${show(v.from)} → ${show(v.value)} — ${body.reason}`, payload: override },
      audit: { action: "OVERRIDE_ADDED", detail: `${override.id} ${what}: ${show(v.from)} → ${show(v.value)}` },
    });
    return {
      ok: true,
      status: 200,
      commit: res,
      body: { ok: true, override, versionId: res.version.id, versionNo: res.version.versionNo, recommendation: res.derived.recommendation.status, recommendationChanged: res.recommendationChanged },
    };
  } catch (e) {
    return { ok: false, status: 500, error: `Could not save override: ${(e as Error).message.slice(0, 200)}` };
  }
}

export function revertOverride(actor: Actor, companyId: string, body: { overrideId: string; reason?: string; versionId?: string }): OverrideCommit {
  const loaded = load(actor, companyId, body.versionId);
  if ("error" in loaded) return { ok: false, status: loaded.status, error: loaded.error };
  const { company, current } = loaded;
  const { deal, removed } = removeOverride(current.canonical, body.overrideId);
  if (!removed) return { ok: false, status: 404, error: `Unknown override ${body.overrideId}` };
  const what = describe(removed.target, removed.ref, removed.field);
  try {
    const res = commitCanonicalUpdate({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "USER_OVERRIDE",
      summary: `${removed.id} reverted: ${what} back to ${show(removed.from)}`,
      history: { type: "OVERRIDE_REVERTED", summary: `${what} override reverted (${show(removed.to)} → ${show(removed.from)})${body.reason ? ` — ${body.reason}` : ""}`, payload: { ...removed, revertedBy: actor.name, revertReason: body.reason ?? null } },
      audit: { action: "OVERRIDE_REVERTED", detail: `${removed.id} ${what}` },
    });
    return { ok: true, status: 200, commit: res, body: { ok: true, versionId: res.version.id, versionNo: res.version.versionNo, recommendation: res.derived.recommendation.status, recommendationChanged: res.recommendationChanged } };
  } catch (e) {
    return { ok: false, status: 500, error: `Could not revert override: ${(e as Error).message.slice(0, 200)}` };
  }
}
