/**
 * Analyst overrides (raw data is never overwritten) — the one correction path.
 *
 *   POST   /api/deals/:id/overrides  { target, ref, field, to, reason, versionId? }
 *   DELETE /api/deals/:id/overrides  { overrideId, reason?, versionId? }  (revert)
 *
 * Each call saves a NEW version (reason USER_OVERRIDE) through server/overrides.ts;
 * the Fund Brain is re-indexed after the response.
 */
import { after } from "next/server";
import { z } from "zod";
import { apiSession, canWrite } from "@/server/session";
import { commitOverride, revertOverride } from "@/server/overrides";

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Post.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const r = commitOverride({ workspaceId: s.workspaceId, userId: s.userId, name: s.name }, (await params).id, parsed.data);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  after(() => r.commit.reindex());
  return Response.json(r.body);
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Delete.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
  const r = revertOverride({ workspaceId: s.workspaceId, userId: s.userId, name: s.name }, (await params).id, parsed.data);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  after(() => r.commit.reindex());
  return Response.json(r.body);
}
