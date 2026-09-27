/**
 * Consistency checker: every denormalized projection must agree with the
 * company's CURRENT version (companies.currentVersionId → company_versions).
 *
 *  - companies projection columns (see projection() in ./repo) = values of the current version
 *  - metric_facts = primary metrics of the current version (same ids, values, versionId)
 *  - memory_packs.versionId = currentVersionId
 *  - company chunks: versionId = currentVersionId
 *
 * Companies with an analysis in flight (run QUEUED/RUNNING) are reported as
 * skipped: their derived data is legitimately being rebuilt. Reads raw JSON so
 * it keeps working while the canonical schema evolves.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema as s, type DB } from "@/db/client";

export interface Violation {
  companyId: string;
  companyName: string;
  kind: "PROJECTION" | "VERSION_MISSING" | "METRIC_FACTS" | "MEMORY_PACK" | "CHUNKS";
  field?: string;
  expected?: unknown;
  actual?: unknown;
  message: string;
}

export interface ConsistencyReport {
  workspaceId: string;
  checkedAt: string;
  companiesChecked: number;
  skippedInFlight: string[];
  violations: Violation[];
}

type Json = Record<string, unknown>;
const get = (o: unknown, p: string): unknown => p.split(".").reduce<unknown>((a, k) => (a && typeof a === "object" ? (a as Json)[k] : undefined), o);

function same(a: unknown, b: unknown) {
  const na = a === undefined ? null : a;
  const nb = b === undefined ? null : b;
  if (typeof na === "number" && typeof nb === "number") return Math.abs(na - nb) <= 1e-9 * Math.max(1, Math.abs(na), Math.abs(nb));
  return na === nb;
}

/** Expected projection values from a version (mirror of repo.projection for the checked columns). */
export function expectedProjection(canonical: unknown, derived: unknown) {
  const scenarios = (get(derived, "returns.scenarios") as { scenario: string; grossMoic?: number | null }[] | undefined) ?? [];
  return {
    name: get(canonical, "identity.name"),
    oqi: get(derived, "operatingQuality.value"),
    oqiLower: get(derived, "operatingQuality.lower"),
    oqiUpper: get(derived, "operatingQuality.upper"),
    evidence: get(derived, "evidence.category"),
    powerLaw: get(derived, "powerLaw.value"),
    decisionStatus: get(derived, "recommendation.status"),
    roundUsd: get(derived, "returns.inputs.entry.raiseUsd"),
    postMoneyUsd: get(derived, "returns.inputs.entry.postMoneyUsd"),
    baseMoic: scenarios.find((x) => x.scenario === "BASE")?.grossMoic ?? null,
  } as Record<string, unknown>;
}

export function checkConsistency(workspaceId: string, db: DB = getDb()): ConsistencyReport {
  const violations: Violation[] = [];
  const skippedInFlight: string[] = [];
  const companies = db
    .select()
    .from(s.companies)
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)))
    .all();
  const inFlight = new Set(
    db
      .select({ c: s.analysisRuns.companyId })
      .from(s.analysisRuns)
      .where(and(eq(s.analysisRuns.workspaceId, workspaceId), inArray(s.analysisRuns.status, ["QUEUED", "RUNNING"])))
      .all()
      .map((r) => r.c),
  );
  let checked = 0;

  for (const c of companies) {
    if (!c.currentVersionId) continue;
    if (inFlight.has(c.id)) {
      skippedInFlight.push(c.id);
      continue;
    }
    checked++;
    const v = (kind: Violation["kind"], message: string, extra: Partial<Violation> = {}) => violations.push({ companyId: c.id, companyName: c.name, kind, message, ...extra });
    const version = db.select().from(s.companyVersions).where(and(eq(s.companyVersions.id, c.currentVersionId), eq(s.companyVersions.companyId, c.id))).get();
    if (!version) {
      v("VERSION_MISSING", `currentVersionId ${c.currentVersionId} does not exist for this company`);
      continue;
    }
    const preliminary = (version.summary ?? "").startsWith("Preliminary");

    // 1. Projection columns.
    const expected = expectedProjection(version.canonical, version.derived);
    for (const [field, exp] of Object.entries(expected)) {
      const actual = (c as unknown as Json)[field];
      if (field === "decisionStatus" && preliminary && actual === null) continue; // preliminary versions do not project a decision
      if (!same(actual, exp)) v("PROJECTION", `companies.${field} = ${JSON.stringify(actual)} but current version has ${JSON.stringify(exp)}`, { field, expected: exp, actual });
    }

    // Preliminary versions are not indexed yet (the Fund Brain is fed at the end of the run).
    const facts = db.select().from(s.metricFacts).where(eq(s.metricFacts.companyId, c.id)).all();
    const pack = db.select({ versionId: s.memoryPacks.versionId }).from(s.memoryPacks).where(eq(s.memoryPacks.companyId, c.id)).get();
    const chunkVersions = db
      .select({ versionId: s.chunks.versionId, n: sql<number>`count(*)` })
      .from(s.chunks)
      .where(and(eq(s.chunks.workspaceId, workspaceId), eq(s.chunks.companyId, c.id)))
      .groupBy(s.chunks.versionId)
      .all();
    if (preliminary && !facts.length && !pack && !chunkVersions.length) continue;

    // 2. Metric facts = primary metrics of the current version.
    const metrics = ((get(version.canonical, "metrics") as { id: string; isPrimary?: boolean; normalizedValue?: number | null }[] | undefined) ?? []).filter((m) => m.isPrimary);
    const expIds = new Map(metrics.map((m) => [m.id, m.normalizedValue ?? null]));
    const factIds = new Map<string, number>();
    for (const f of facts) factIds.set(f.metricId, (factIds.get(f.metricId) ?? 0) + 1);
    for (const [id, n] of factIds) if (n > 1) v("METRIC_FACTS", `metric_facts has ${n} rows for ${id}`, { field: id });
    for (const f of facts) {
      if (f.versionId !== c.currentVersionId) v("METRIC_FACTS", `metric_facts ${f.metricId} points to version ${f.versionId}, current is ${c.currentVersionId}`, { field: f.metricId, expected: c.currentVersionId, actual: f.versionId });
      if (!expIds.has(f.metricId)) v("METRIC_FACTS", `metric_facts ${f.metricId} is not a primary metric of the current version`, { field: f.metricId });
      else if (!same(f.value, expIds.get(f.metricId))) v("METRIC_FACTS", `metric_facts ${f.metricId} = ${f.value} but current version has ${expIds.get(f.metricId)}`, { field: f.metricId, expected: expIds.get(f.metricId), actual: f.value });
    }
    for (const id of expIds.keys()) if (!factIds.has(id)) v("METRIC_FACTS", `primary metric ${id} of the current version has no metric_facts row`, { field: id });

    // 3. Memory pack.
    if (pack && pack.versionId !== c.currentVersionId) v("MEMORY_PACK", `memory pack built from ${pack.versionId}, current is ${c.currentVersionId}`, { expected: c.currentVersionId, actual: pack.versionId });

    // 4. Chunks.
    for (const cv of chunkVersions)
      if (cv.versionId !== c.currentVersionId) v("CHUNKS", `${cv.n} chunk(s) from version ${cv.versionId ?? "null"}, current is ${c.currentVersionId}`, { expected: c.currentVersionId, actual: cv.versionId });
  }
  return { workspaceId, checkedAt: new Date().toISOString(), companiesChecked: checked, skippedInFlight, violations };
}
