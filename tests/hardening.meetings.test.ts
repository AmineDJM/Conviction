/**
 * Founder meetings and Fund Brain memory under concurrency and failure, against a temporary SQLite database:
 *  - two simultaneous meeting submissions start one run; a founder-meeting run is cancellable;
 *  - a failure after the POST_MEETING_ANALYSIS is committed leaves the meeting done (noted), and re-submitting it is refused;
 *  - one PRE_MEETING_BRIEF per (version, builder version), also when two requests race (unique index + migration dedupe);
 *  - a company deleted or merged while it is being indexed gets no memory back.
 * Model calls are mocked (no network).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-hmeet-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  return dir;
});

type Behaviour = "hang" | "ok" | "brief-slow-fail";
const h = vi.hoisted(() => ({ behaviour: "ok" as string, failBrief: false, duringEmbed: null as null | (() => void) }));
const EXTRACTION = { summary: "s", questionUpdates: [], claimUpdates: [], newClaims: [], contradictions: [] };

vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async (call: { schemaName: string; signal?: AbortSignal }) => {
    if (h.behaviour === "hang")
      return new Promise((_, reject) => call.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    if (call.schemaName === "pre_meeting_brief") {
      await new Promise((r) => setTimeout(r, 30));
      throw new Error("model unavailable");
    }
    return { data: EXTRACTION, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, searchSources: [], searchQueries: [], latencyMs: 1, attempts: 1, cached: false };
  }),
  embed: vi.fn(async () => {
    const f = h.duringEmbed;
    h.duringEmbed = null;
    f?.();
    throw new Error("no network in tests");
  }),
}));
vi.mock("@/orchestration/assemble", async (orig) => ({
  ...(await orig<typeof import("@/orchestration/assemble")>()),
  applyFounderCall: (base: import("@/domain/canonical").CanonicalDeal) => ({ deal: structuredClone(base), changes: { confirmed: 1, clarified: 0, changed: 0, contradicted: 0, unresolved: 0, newClaims: 0 }, guards: [] }),
}));
vi.mock("@/reports/meeting-briefs", async (orig) => {
  const m = await orig<typeof import("@/reports/meeting-briefs")>();
  return {
    ...m,
    buildPostMeetingBrief: (...a: Parameters<typeof m.buildPostMeetingBrief>) => {
      if (h.failBrief) throw new Error("brief builder crashed");
      return m.buildPostMeetingBrief(...a);
    },
  };
});

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { startFounderCall, FounderCallError } from "@/orchestration/founder-call";
import { ensurePreMeetingBrief } from "@/orchestration/pre-meeting-brief";
import { cancelRun, isRunLive } from "@/orchestration/run-control";
import { indexCompanyForBrain } from "@/brain/indexer";
import { PRE_MEETING_BRIEF_BUILDER } from "@/domain/meetings";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { makeDeal } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const TRANSCRIPT = "Sam (Partner): Walk me through revenue.\n\nMaya (CEO): We grew revenue a lot this year and plan to expand into Germany next quarter with two hires.\n\n".repeat(4);

function setup() {
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
  const company = repo.createCompany(workspaceId, "Acme AI");
  const deal = makeDeal();
  const version = repo.saveVersion({ company, canonical: deal, derived: derive(deal, getRegistry(), DEFAULT_FUND_PROFILE), reason: "DECK_ANALYSIS", summary: "deck" });
  return { workspaceId, userId, company: repo.getCompany(workspaceId, company.id)!, version };
}
const set = (b: Behaviour) => (h.behaviour = b);

beforeEach(() => {
  h.behaviour = "ok";
  h.failBrief = false;
  h.duringEmbed = null;
});

describe("founder meeting runs", () => {
  it("two simultaneous submissions start exactly one run", async () => {
    set("hang");
    const ctx = setup();
    const start = (t: string) => startFounderCall({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, transcript: t });
    const r = await Promise.allSettled([start(TRANSCRIPT), start(TRANSCRIPT + " Also churn.")]);
    const ok = r.filter((x) => x.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof startFounderCall>>>[];
    expect(ok).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ status: 409 });
    expect(meetings.listMeetings(ctx.company.id)).toHaveLength(1);
    cancelRun(ok[0]!.value.run.id);
    await ok[0]!.value.promise;
  });

  it("POST /runs/:id/cancel stops a founder meeting: the run is CANCELLED, no version is created", async () => {
    set("hang");
    const ctx = setup();
    const s = await startFounderCall({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, transcript: TRANSCRIPT });
    await new Promise((r) => setTimeout(r, 20));
    expect(isRunLive(s.run.id)).toBe(true);
    expect(cancelRun(s.run.id)).toBe(true);
    await s.promise;
    expect(repo.getRun(ctx.workspaceId, s.run.id)!.status).toBe("CANCELLED");
    expect(meetings.getMeeting(ctx.company.id, s.meeting.id)!).toMatchObject({ status: "FAILED", postAnalysisVersionId: null });
    expect(repo.listVersions(ctx.company.id)).toHaveLength(1);
    expect(isRunLive(s.run.id)).toBe(false);
  });

  it("a failure after the post-meeting analysis is committed leaves the meeting done; re-submitting it is refused", async () => {
    const ctx = setup();
    h.failBrief = true;
    const s = await startFounderCall({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, transcript: TRANSCRIPT, callDate: "2026-09-20" });
    await s.promise;
    const m = meetings.getMeeting(ctx.company.id, s.meeting.id)!;
    expect(m.status).toBe("READY");
    expect(m.postAnalysisVersionId).not.toBeNull();
    expect(m.error).toMatch(/was saved; the brief step failed/);
    expect(repo.getRun(ctx.workspaceId, s.run.id)!.status).toBe("PARTIAL");
    const versions = repo.listVersions(ctx.company.id).length;
    const again = await startFounderCall({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, transcript: TRANSCRIPT, callDate: "2026-09-20" }).catch((e) => e);
    expect(again).toBeInstanceOf(FounderCallError);
    expect(again.status).toBe(409);
    expect(repo.listVersions(ctx.company.id)).toHaveLength(versions);
  });
});

describe("PRE_MEETING_BRIEF uniqueness", () => {
  it("two racing requests for the same version produce one brief", async () => {
    const ctx = setup();
    const [a, b] = await Promise.all([
      ensurePreMeetingBrief({ workspaceId: ctx.workspaceId, userId: ctx.userId, company: ctx.company }),
      ensurePreMeetingBrief({ workspaceId: ctx.workspaceId, userId: ctx.userId, company: ctx.company }),
    ]);
    expect(a.id).toBe(b.id);
    const rows = getDb().select().from(schema.meetingBriefs).where(eq(schema.meetingBriefs.versionId, ctx.version.id)).all();
    expect(rows).toHaveLength(1);
    // A direct second insert (another process) converges on the existing row.
    const dup = meetings.insertBrief({ workspaceId: ctx.workspaceId, companyId: ctx.company.id, kind: "PRE_MEETING_BRIEF", versionId: ctx.version.id, meetingId: null, builderVersion: PRE_MEETING_BRIEF_BUILDER, content: rows[0]!.content, generation: rows[0]!.generation, createdBy: null });
    expect(dup.id).toBe(a.id);
  });

  it("the migration keeps the earliest of existing duplicates and re-points meetings to it", () => {
    const ctx = setup();
    const db = getDb();
    const raw = db.$client;
    raw.exec("DROP INDEX meeting_briefs_pre_unique_idx");
    const ins = (id: string, at: string) =>
      raw.prepare("INSERT INTO meeting_briefs (id, workspace_id, company_id, kind, version_id, builder_version, content, generation, created_at) VALUES (?, ?, ?, 'PRE_MEETING_BRIEF', ?, 'b1', '{}', '{}', ?)").run(id, ctx.workspaceId, ctx.company.id, ctx.version.id, at);
    ins("brf_keep", "2026-01-01T00:00:00Z");
    ins("brf_dup", "2026-01-02T00:00:00Z");
    raw.prepare("INSERT INTO meeting_briefs (id, workspace_id, company_id, kind, version_id, builder_version, content, generation, created_at) VALUES ('brf_post', ?, ?, 'POST_MEETING_BRIEF', 'ver_post', 'p1', ?, '{}', '2026-01-03')").run(ctx.workspaceId, ctx.company.id, JSON.stringify({ preBriefId: "brf_dup" }));
    const mt = meetings.createMeeting({ workspaceId: ctx.workspaceId, companyId: ctx.company.id, title: "t", heldAt: "2026-01-02", participants: [], source: "PASTED_TRANSCRIPT", status: "READY", preAnalysisVersionId: ctx.version.id, preBriefId: "brf_dup", transcriptDocumentId: null, recordingDocumentId: null, runId: null, createdBy: null });
    for (const f of ["0009_dedupe_pre_meeting_briefs.sql", "0010_meeting_briefs_pre_unique.sql"])
      for (const stmt of fs.readFileSync(path.join(process.cwd(), "drizzle", f), "utf8").split("--> statement-breakpoint")) if (stmt.replace(/--.*$/gm, "").trim()) raw.exec(stmt);
    const left = db.select().from(schema.meetingBriefs).where(eq(schema.meetingBriefs.versionId, ctx.version.id)).all();
    expect(left.map((b) => b.id)).toEqual(["brf_keep"]);
    expect(meetings.getMeeting(ctx.company.id, mt.id)!.preBriefId).toBe("brf_keep");
    expect((meetings.getBrief(ctx.company.id, "brf_post")!.content as { preBriefId: string }).preBriefId).toBe("brf_keep");
    expect(() => ins("brf_again", "2026-01-04")).toThrow(/UNIQUE/);
  });
});

describe("Fund Brain memory follows the company's lifecycle", () => {
  it("a company deleted or merged before or during indexing gets no memory back", async () => {
    const ctx = setup();
    const cur = repo.getCurrentVersion(ctx.company)!;
    const db = getDb();
    const memory = (id: string) => ({
      chunks: db.select().from(schema.chunks).where(eq(schema.chunks.companyId, id)).all().length,
      facts: db.select().from(schema.metricFacts).where(eq(schema.metricFacts.companyId, id)).all().length,
      packs: db.select().from(schema.memoryPacks).where(eq(schema.memoryPacks.companyId, id)).all().length,
    });
    // Merged while its embeddings were being computed: no chunks are written.
    const other = repo.createCompany(ctx.workspaceId, "Target");
    h.duringEmbed = () => repo.markCompanyMerged(ctx.company.id, other.id);
    const r = await indexCompanyForBrain({ workspaceId: ctx.workspaceId, companyId: ctx.company.id, versionId: cur.row.id, canonical: cur.canonical, derived: cur.derived });
    expect(r.chunks).toBe(0);
    expect(memory(ctx.company.id).chunks).toBe(0);
    // Already merged: nothing at all.
    db.delete(schema.memoryPacks).where(eq(schema.memoryPacks.companyId, ctx.company.id)).run();
    db.delete(schema.metricFacts).where(eq(schema.metricFacts.companyId, ctx.company.id)).run();
    await indexCompanyForBrain({ workspaceId: ctx.workspaceId, companyId: ctx.company.id, versionId: cur.row.id, canonical: cur.canonical, derived: cur.derived });
    expect(memory(ctx.company.id)).toEqual({ chunks: 0, facts: 0, packs: 0 });
    // A live company is indexed as before.
    const live = setup();
    const v = repo.getCurrentVersion(live.company)!;
    await indexCompanyForBrain({ workspaceId: live.workspaceId, companyId: live.company.id, versionId: v.row.id, canonical: v.canonical, derived: v.derived });
    expect(memory(live.company.id).chunks).toBeGreaterThan(0);
    expect(memory(live.company.id).packs).toBe(1);
  });
});
