/**
 * PATCH  {icDecision?, executionStatus?, note?}  → new version with the decision recorded
 * DELETE                                         → permanent deletion (documents, versions, memory, files)
 */
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { apiSession, canWrite } from "@/server/session";
import * as repo from "@/server/repo";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { getDb, schema } from "@/db/client";
import { deleteStoredFile } from "@/server/storage";
import { invalidateVectors } from "@/brain/vectors";
import { indexCompanyForBrain } from "@/brain/indexer";
import { IcDecision, ExecutionStatus } from "@/domain/enums";
import { refreshPatterns } from "@/server/fund-brain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Patch = z.object({ icDecision: IcDecision.optional(), executionStatus: ExecutionStatus.optional(), note: z.string().max(2000).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (!canWrite(s)) return Response.json({ error: "Read-only role" }, { status: 403 });
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid body" }, { status: 400 });
  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const current = repo.getCurrentVersion(company);
  if (!current) return Response.json({ error: "No analysis yet" }, { status: 409 });
  const canonical = structuredClone(current.canonical);
  const changes: string[] = [];
  if (parsed.data.icDecision && parsed.data.icDecision !== canonical.icDecision) {
    changes.push(`IC decision ${canonical.icDecision} → ${parsed.data.icDecision}`);
    canonical.icDecision = parsed.data.icDecision;
  }
  if (parsed.data.executionStatus && parsed.data.executionStatus !== canonical.executionStatus) {
    changes.push(`Execution ${canonical.executionStatus} → ${parsed.data.executionStatus}`);
    canonical.executionStatus = parsed.data.executionStatus;
  }
  if (!changes.length) return Response.json({ ok: true, unchanged: true });
  // Decisions never alter the analytical recommendation: re-derive under the version's own registry.
  const derived = derive(canonical, getRegistry(current.row.registryId), repo.getDefaultFund(s.workspaceId));
  const summary = changes.join("; ") + (parsed.data.note ? ` — ${parsed.data.note}` : "");
  const version = repo.saveVersion({ company, canonical, derived, reason: "STATUS_CHANGE", summary, userId: s.userId });
  if (parsed.data.icDecision) repo.addHistory({ workspaceId: s.workspaceId, companyId: company.id, type: "IC_DECISION", versionId: version.id, summary, userId: s.userId });
  if (parsed.data.executionStatus) repo.addHistory({ workspaceId: s.workspaceId, companyId: company.id, type: "EXECUTION_STATUS", versionId: version.id, summary, userId: s.userId });
  repo.audit(s.workspaceId, s.userId, "DECISION_RECORDED", company.id, summary);
  await indexCompanyForBrain({ workspaceId: s.workspaceId, companyId: company.id, versionId: version.id, canonical, derived });
  // Decision associations are part of the INFERRED fund memory.
  if (parsed.data.icDecision) refreshPatterns(s.workspaceId);
  return Response.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiSession();
  if (s instanceof Response) return s;
  if (s.role !== "OWNER" && s.role !== "PARTNER") return Response.json({ error: "Only owners and partners can delete" }, { status: 403 });
  const company = repo.getCompany(s.workspaceId, (await params).id);
  if (!company) return Response.json({ error: "Not found" }, { status: 404 });
  const db = getDb();
  const docs = repo.listDocuments(company.id);
  db.transaction((tx) => {
    tx.delete(schema.chunks).where(and(eq(schema.chunks.workspaceId, s.workspaceId), eq(schema.chunks.companyId, company.id))).run();
    tx.delete(schema.relations).where(and(eq(schema.relations.workspaceId, s.workspaceId), eq(schema.relations.companyId, company.id))).run();
    tx.delete(schema.entities).where(and(eq(schema.entities.workspaceId, s.workspaceId), eq(schema.entities.companyId, company.id))).run();
    tx.update(schema.icObservations).set({ companyId: null }).where(eq(schema.icObservations.companyId, company.id)).run();
    tx.delete(schema.companies).where(eq(schema.companies.id, company.id)).run(); // cascades versions, documents, pages, runs, history, packs, facts
  });
  for (const d of docs) {
    const stillUsed = db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.storagePath, d.storagePath)).get();
    if (!stillUsed) await deleteStoredFile(d.storagePath);
  }
  invalidateVectors(s.workspaceId);
  repo.audit(s.workspaceId, s.userId, "COMPANY_DELETED", company.id, company.name);
  return Response.json({ ok: true });
}
