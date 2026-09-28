/**
 * Analyst overrides (raw data is never overwritten).
 *
 *   POST   /api/deals/:id/overrides  { target, ref, field, to, reason, versionId? }
 *   DELETE /api/deals/:id/overrides  { overrideId, reason?, versionId? }  (revert)
 *
 * Each call appends to / removes from `canonical.overrides` and saves a NEW
 * version (reason USER_OVERRIDE) through the shared correction path
 * (server/versioning.commitCanonicalUpdate): derive() applies the overrides,
 * history + audit record who changed what, the Fund Brain is re-indexed.
 */
import { after } from "next/server";
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { commitCanonicalUpdate } from "@/server/versioning";
import { addOverride, removeOverride, validateOverride } from "@/engine/overrides";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Post = z.object({
  target: z.enum(["METRIC", "CLASSIFICATION", "ENTITY", "CLAIM"]),
  ref: z.string().trim().min(1).max(64),
  field: z.string().trim().min(1).max(64),
  to: z.unknown(),
  reason: z.string().trim().min(3, "Explain the override (source or reason)").max(2000),
  versionId: z.string().optional(),
});

const Delete = z.object({
  overrideId: z.string().regex(/^OVR-\d{3,}$/, "Invalid override id"),
  reason: z.string().trim().max(2000).optional(),
  versionId: z.string().optional(),
});

const show = (v: unknown) => (v === null || v === undefined ? "none" : Array.isArray(v) ? v.join(", ") || "none" : String(v));

async function load(s: Exclude<Awaited<ReturnType<typeof apiSession>>, Response>, id: string, versionId?: string) {
  const company = repo.getCompany(s.workspaceId, id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  if (company.status === "PROCESSING") return Response.json({ error: "An analysis is running for this deal. Try again when it completes." }, { status: 409 });
  const current = repo.getCurrentVersion(company);
  if (!current) return Response.json({ error: "No analysis version to override" }, { status: 409 });
  if (versionId && versionId !== current.row.id) return Response.json({ error: "This deal changed since you loaded it. Reload and try again." }, { status: 409 });
  return { company, current };
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Post.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;
  const loaded = await load(s, (await params).id, body.versionId);
  if (loaded instanceof Response) return loaded;
  const { company, current } = loaded;

  const v = validateOverride(current.canonical, body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const { deal, override } = addOverride(current.canonical, { target: body.target, ref: body.ref, field: body.field, from: v.from, to: v.value, reason: body.reason, by: s.name, at: new Date().toISOString() });
  const what = `${body.target === "METRIC" || body.target === "CLAIM" ? body.ref : body.target.toLowerCase()}.${body.field}`;
  try {
    const res = commitCanonicalUpdate({
      workspaceId: s.workspaceId,
      userId: s.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "USER_OVERRIDE",
      summary: `${override.id} ${what}: ${show(v.from)} → ${show(v.value)} (analyst override)`,
      history: { type: "OVERRIDE_ADDED", summary: `${what} overridden: ${show(v.from)} → ${show(v.value)} — ${body.reason}`, payload: override },
      audit: { action: "OVERRIDE_ADDED", detail: `${override.id} ${what}: ${show(v.from)} → ${show(v.value)}` },
    });
    after(() => res.reindex());
    return Response.json({ ok: true, override, versionId: res.version.id, versionNo: res.version.versionNo, recommendation: res.derived.recommendation.status, recommendationChanged: res.recommendationChanged });
  } catch (e) {
    return Response.json({ error: `Could not save override: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Delete.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const body = parsed.data;
  const loaded = await load(s, (await params).id, body.versionId);
  if (loaded instanceof Response) return loaded;
  const { company, current } = loaded;

  const { deal, removed } = removeOverride(current.canonical, body.overrideId);
  if (!removed) return Response.json({ error: `Unknown override ${body.overrideId}` }, { status: 404 });
  const what = `${removed.target === "METRIC" || removed.target === "CLAIM" ? removed.ref : removed.target.toLowerCase()}.${removed.field}`;
  try {
    const res = commitCanonicalUpdate({
      workspaceId: s.workspaceId,
      userId: s.userId,
      company,
      previous: current,
      canonical: deal,
      reason: "USER_OVERRIDE",
      summary: `${removed.id} reverted: ${what} back to ${show(removed.from)}`,
      history: { type: "OVERRIDE_REVERTED", summary: `${what} override reverted (${show(removed.to)} → ${show(removed.from)})${body.reason ? ` — ${body.reason}` : ""}`, payload: { ...removed, revertedBy: s.name, revertReason: body.reason ?? null } },
      audit: { action: "OVERRIDE_REVERTED", detail: `${removed.id} ${what}` },
    });
    after(() => res.reindex());
    return Response.json({ ok: true, versionId: res.version.id, versionNo: res.version.versionNo, recommendation: res.derived.recommendation.status, recommendationChanged: res.recommendationChanged });
  } catch (e) {
    return Response.json({ error: `Could not revert override: ${(e as Error).message.slice(0, 200)}` }, { status: 500 });
  }
}
