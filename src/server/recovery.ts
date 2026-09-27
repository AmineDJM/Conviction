/**
 * Analyses run in-process. If the server restarts (deploy, crash), runs that
 * were in flight can never finish: mark them explicitly instead of leaving
 * them "running" forever. Companies with a preliminary version stay usable.
 */
import { inArray, eq, and, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { nowIso } from "./ids";
import { logger } from "@/lib/log";

export function recoverInterruptedRuns() {
  const db = getDb();
  const stale = db.select().from(schema.analysisRuns).where(inArray(schema.analysisRuns.status, ["RUNNING", "QUEUED"])).all();
  for (const run of stale) {
    db.update(schema.analysisRuns)
      .set({ status: "FAILED", error: "Interrupted by a server restart before completion. No results were fabricated; re-run the analysis.", finishedAt: nowIso() })
      .where(eq(schema.analysisRuns.id, run.id))
      .run();
    const company = db.select().from(schema.companies).where(eq(schema.companies.id, run.companyId)).get();
    if (company?.status === "PROCESSING") {
      db.update(schema.companies)
        .set({ status: company.currentVersionId ? "READY" : "FAILED", updatedAt: nowIso() })
        .where(and(eq(schema.companies.id, company.id), isNull(schema.companies.deletedAt)))
        .run();
    }
  }
  if (stale.length) logger.warn({ count: stale.length }, "marked interrupted analysis runs as failed");
}
