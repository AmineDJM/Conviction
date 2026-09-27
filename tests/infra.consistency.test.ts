import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { openDb, schema, type DB } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { writeFacts, writeGraph } from "@/brain/indexer";
import { buildMemoryPack } from "@/brain/memory-pack";
import { checkConsistency } from "@/server/consistency";
import { makeDeal } from "./fixtures";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-consistency-"));
const db: DB = openDb(path.join(tmp, "conviction.db"));
afterAll(() => {
  db.$client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const now = new Date("2026-09-01T00:00:00Z");

function build() {
  const { workspaceId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" }, db);
  const company = repo.createCompany(workspaceId, "Acme AI", db);
  const deal = makeDeal();
  const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE, { now });
  const version = repo.saveVersion({ company, canonical: deal, derived, reason: "DECK_ANALYSIS", summary: "test" }, db);
  writeFacts(workspaceId, company.id, version.id, deal, db);
  writeGraph(workspaceId, company.id, deal, db);
  const { pack, tokens } = buildMemoryPack(repo.getCompany(workspaceId, company.id, db)!, version.id, deal, derived);
  db.insert(schema.memoryPacks).values({ companyId: company.id, workspaceId, versionId: version.id, pack, text: pack.text, tokenEstimate: tokens, updatedAt: now.toISOString() }).run();
  db.insert(schema.chunks).values({ id: `chk_${company.id}`, workspaceId, companyId: company.id, versionId: version.id, kind: "MEMO", title: "Acme AI — deal memory", text: pack.text.slice(0, 500), textHash: "h", createdAt: now.toISOString() }).run();
  return { workspaceId, company, deal, derived, version };
}

describe("checkConsistency", () => {
  it("reports zero violations for a company built through saveVersion + writeFacts/writeGraph", () => {
    const { workspaceId, deal } = build();
    expect(deal.metrics.filter((m) => m.isPrimary).length).toBeGreaterThan(0);
    const r = checkConsistency(workspaceId, db);
    expect(r.companiesChecked).toBe(1);
    expect(r.violations).toEqual([]);
  });

  it("flags a tampered projection column (exactly one violation)", () => {
    const { workspaceId, company, derived } = build();
    db.update(schema.companies).set({ oqi: (derived.operatingQuality.value ?? 0) + 7 }).where(eq(schema.companies.id, company.id)).run();
    const r = checkConsistency(workspaceId, db);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({ companyId: company.id, kind: "PROJECTION", field: "oqi" });
  });

  it("flags stale metric facts, memory pack and chunks after a new version that was not re-indexed", () => {
    const { workspaceId, company, deal } = build();
    const next = structuredClone(deal);
    const arr = next.metrics.find((m) => m.metricKey === "arr")!;
    arr.normalizedValue = 5_000_000;
    const derived2 = derive(next, getRegistry(), DEFAULT_FUND_PROFILE, { now });
    repo.saveVersion({ company, canonical: next, derived: derived2, reason: "METRIC_CORRECTION", summary: "ARR corrected" }, db);
    const kinds = new Set(checkConsistency(workspaceId, db).violations.map((v) => v.kind));
    expect(kinds).toEqual(new Set(["METRIC_FACTS", "MEMORY_PACK", "CHUNKS"]));
  });

  it("skips companies with an analysis in flight", () => {
    const { workspaceId, company } = build();
    db.update(schema.companies).set({ name: "Tampered" }).where(eq(schema.companies.id, company.id)).run();
    const run = repo.createRun({ workspaceId, companyId: company.id, mode: "STANDARD", model: "m", promptVersions: {}, registryId: getRegistry().id, budgetUsd: 0.5, steps: [] }, db);
    expect(checkConsistency(workspaceId, db).skippedInFlight).toEqual([company.id]);
    repo.finishRun(run.id, "COMPLETED", 0, "FULL", undefined, db);
    expect(checkConsistency(workspaceId, db).violations.map((v) => v.field)).toEqual(["name"]);
  });
});
