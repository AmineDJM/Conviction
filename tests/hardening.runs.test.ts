/**
 * Run lifecycle and lost updates against a temporary SQLite database:
 *  - a failed deck analysis stays FAILED (outstanding research is aborted and settled first; a late step update never reopens a run);
 *  - re-analysis keeps the human decisions (IC decision, execution status) of the version current at save time;
 *  - portfolio recalculation never overwrites an edit made while it was running.
 * Model calls are mocked (no network).
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-runs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  return dir;
});

const h = vi.hoisted(() => ({ researchSignals: [] as AbortSignal[], onIndex: null as null | (() => void) }));

vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async (call: { step: string; signal?: AbortSignal }) => {
    if (call.step === "TRIAGE") return { data: { keyClaims: [], competitorsMentioned: [] }, usage: {}, searchSources: [], searchQueries: [], latencyMs: 0, attempts: 1, cached: false };
    if (call.step.startsWith("RESEARCH")) {
      h.researchSignals.push(call.signal!);
      // Slow research that honours cancellation (like the real client); without an abort it fails late.
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 400);
        call.signal?.addEventListener("abort", () => (clearTimeout(t), reject(new DOMException("Aborted", "AbortError"))), { once: true });
      });
      throw new Error("research upstream down");
    }
    await new Promise((r) => setTimeout(r, 20));
    throw new Error("upstream unavailable");
  }),
  embed: vi.fn(async () => {
    throw new Error("no network in tests");
  }),
}));
vi.mock("@/orchestration/assemble", async (orig) => {
  const m = await orig<typeof import("@/orchestration/assemble")>();
  return { ...m, applyTriage: (d: import("@/domain/canonical").CanonicalDeal) => ((d.identity.name = "Acme"), d) };
});
vi.mock("@/brain/indexer", async (orig) => ({
  ...(await orig<typeof import("@/brain/indexer")>()),
  indexCompanyForBrain: vi.fn(async () => {
    const f = h.onIndex;
    h.onIndex = null;
    f?.();
    await new Promise((r) => setTimeout(r, 10));
    return { chunks: 0, embedded: 0, facts: 0 };
  }),
}));

import fs from "node:fs";
import { getDb } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { runDeckAnalysis, PIPELINE_STEPS } from "@/orchestration/pipeline";
import { recalculatePortfolio } from "@/server/recalculate";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { makeDeal } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const ws = () => createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
const doc = { documentId: "doc_x", filename: "d.pdf", kind: "PDF", pages: [{ pageNo: 1, text: "hello world" }], sha256: "ab", mime: "application/pdf", sizeBytes: 1 } as never;
const newRun = (workspaceId: string, companyId: string) => repo.createRun({ workspaceId, companyId, mode: "DEEP_DD", model: "m", promptVersions: {}, registryId: "r", budgetUsd: 3, steps: [...PIPELINE_STEPS] });

describe("a failed run stays failed", () => {
  it("a late step update never reopens a finished run", () => {
    const { workspaceId } = ws();
    const c = repo.createCompany(workspaceId, "Acme");
    const run = newRun(workspaceId, c.id);
    repo.updateRunStep(run.id, "INGEST", "RUNNING");
    expect(repo.getRun(workspaceId, run.id)!.status).toBe("RUNNING");
    repo.finishRun(run.id, "FAILED", 0, null, "boom");
    repo.updateRunStep(run.id, "RESEARCH_MARKET", "FAILED", "late");
    const after = repo.getRun(workspaceId, run.id)!;
    expect(after.status).toBe("FAILED");
    expect(after.progress.find((p) => p.step === "RESEARCH_MARKET")!.status).toBe("PENDING");
  });

  it("research started after triage is aborted and settled before the run is marked FAILED", async () => {
    h.researchSignals.length = 0;
    const { workspaceId } = ws();
    const c = repo.createCompany(workspaceId, "Acme");
    const run = newRun(workspaceId, c.id);
    await runDeckAnalysis({ workspaceId, companyId: c.id, runId: run.id, mode: "DEEP_DD", documents: [doc], fund: DEFAULT_FUND_PROFILE, userId: null });
    expect(h.researchSignals.length).toBeGreaterThan(0);
    expect(h.researchSignals.every((s) => s.aborted)).toBe(true);
    expect(repo.getRun(workspaceId, run.id)!.status).toBe("FAILED");
    await new Promise((r) => setTimeout(r, 500)); // past the research mock's own timer
    const later = repo.getRun(workspaceId, run.id)!;
    expect(later.status).toBe("FAILED");
    expect(later.finishedAt).not.toBeNull();
  });
});

describe("re-analysis keeps human decisions", () => {
  it("the new analysis carries the IC decision and execution status of the current version", async () => {
    const { workspaceId, userId } = ws();
    const c = repo.createCompany(workspaceId, "Acme");
    const deal = makeDeal();
    deal.icDecision = "APPROVED" as never;
    deal.executionStatus = "TERM_SHEET" as never;
    repo.saveVersion({ company: c, canonical: deal, derived: derive(deal, getRegistry(), DEFAULT_FUND_PROFILE), reason: "STATUS_CHANGE", userId });
    const run = newRun(workspaceId, c.id);
    await runDeckAnalysis({ workspaceId, companyId: c.id, runId: run.id, mode: "DEEP_DD", documents: [doc], fund: DEFAULT_FUND_PROFILE, userId });
    const row = repo.getCompany(workspaceId, c.id)!;
    const cur = repo.getCurrentVersion(row)!;
    expect(cur.row.runId).toBe(run.id); // the re-analysis' own (preliminary) version
    expect([cur.canonical.icDecision, cur.canonical.executionStatus]).toEqual(["APPROVED", "TERM_SHEET"]);
    expect([row.icDecision, row.executionStatus]).toEqual(["APPROVED", "TERM_SHEET"]);
  });
});

describe("portfolio recalculation", () => {
  it("does not revert an edit made while it was running, and skips companies with a live run", async () => {
    const { workspaceId, userId } = ws();
    const fund = repo.getDefaultFund(workspaceId);
    const mk = (name: string) => {
      const c = repo.createCompany(workspaceId, name);
      const deal = makeDeal();
      deal.identity.name = name;
      repo.saveVersion({ company: c, canonical: deal, derived: { ...derive(deal, getRegistry(), fund), registryId: "OLD" }, reason: "DECK_ANALYSIS", userId });
      return c.id;
    };
    const busy = mk("Charlie");
    const b = mk("Bravo");
    await new Promise((r) => setTimeout(r, 5));
    mk("Alpha"); // most recently updated → recalculated first
    const liveRun = newRun(workspaceId, busy);
    h.onIndex = () => {
      const cb = repo.getCompany(workspaceId, b)!;
      const cur = repo.getCurrentVersion(cb)!;
      const canonical = structuredClone(cur.canonical);
      canonical.icDecision = "APPROVED" as never;
      repo.saveVersion({ company: cb, canonical, derived: cur.derived, reason: "STATUS_CHANGE", userId });
    };
    const rows = await recalculatePortfolio(workspaceId, userId);
    const final = repo.getCurrentVersion(repo.getCompany(workspaceId, b)!)!;
    expect(final.canonical.icDecision).toBe("APPROVED");
    expect(rows.map((r) => r.companyId)).not.toContain(busy);
    expect(repo.listVersions(busy)).toHaveLength(1);
    repo.finishRun(liveRun.id, "COMPLETED", 0, "FULL");
  });
});
