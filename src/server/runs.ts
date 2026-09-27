/** Analysis runs for a company, with their cost records (§132 cost transparency). Workspace-scoped. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";

export function listRunsWithCost(workspaceId: string, companyId: string, db: DB = getDb()) {
  const runs = db
    .select()
    .from(schema.analysisRuns)
    .where(and(eq(schema.analysisRuns.workspaceId, workspaceId), eq(schema.analysisRuns.companyId, companyId)))
    .orderBy(desc(schema.analysisRuns.startedAt))
    .all();
  const ids = runs.map((r) => r.id);
  const records = ids.length
    ? db
        .select()
        .from(schema.costRecords)
        .where(and(eq(schema.costRecords.workspaceId, workspaceId), inArray(schema.costRecords.runId, ids)))
        .orderBy(schema.costRecords.createdAt)
        .all()
    : [];
  return runs.map((r) => ({ run: r, costs: records.filter((c) => c.runId === r.id) }));
}

export type RunWithCost = ReturnType<typeof listRunsWithCost>[number];
