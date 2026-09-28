/**
 * Route-level hardening, called as route handlers against a temporary SQLite database (the session is stubbed):
 * role checks (IC decisions, merges, backups), upload size / file-count limits, multipart field types, deletion
 * cancelling the live run, generic health errors, workspace-scoped company references in fund memory, login
 * throttling and constant-time unknown-email logins.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  process.env.BACKUP_DIR = `${dir}/backups`;
  return dir;
});
const h = vi.hoisted(() => ({ session: null as null | import("@/server/auth").SessionContext }));

vi.mock("server-only", () => ({}));
vi.mock("@/server/session", () => ({
  apiSession: async () => h.session ?? Response.json({ error: "Unauthorized" }, { status: 401 }),
  getSession: async () => h.session,
  requireSession: async () => h.session,
  canWrite: (s: { role: string }) => s.role !== "VIEWER",
}));
vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async () => {
    throw new Error("no model calls in this test");
  }),
  embed: vi.fn(async () => {
    throw new Error("no network in tests");
  }),
}));

import fs from "node:fs";
import { getDb } from "@/db/client";
import { createWorkspaceWithOwner, isInstanceOwner, login, LoginThrottledError, LOGIN_MAX_FAILURES, type SessionContext } from "@/server/auth";
import * as repo from "@/server/repo";
import * as fm from "@/server/fund-memory";
import { registerRun, releaseRun } from "@/orchestration/run-control";
import { readFormData, BodyLimitError } from "@/server/upload-limits";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import { makeDeal } from "./fixtures";
import * as dealRoute from "@/app/api/deals/[id]/route";
import * as duplicatesRoute from "@/app/api/deals/[id]/duplicates/route";
import * as meetingsRoute from "@/app/api/deals/[id]/meetings/route";
import * as analyzeRoute from "@/app/api/analyze/route";
import * as backupRoute from "@/app/api/admin/backup/route";
import * as healthRoute from "@/app/api/health/route";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

// The instance's setup workspace is created first.
const first = createWorkspaceWithOwner({ email: "setup@fund.example", name: "Setup", password: "correct horse battery", workspaceName: "Setup Fund" });
const second = createWorkspaceWithOwner({ email: "other@fund.example", name: "Other", password: "correct horse battery", workspaceName: "Other Fund" });

const as = (w: { workspaceId: string; userId: string }, role: SessionContext["role"]) => (h.session = { userId: w.userId, workspaceId: w.workspaceId, email: "x@fund.example", name: "X", role, workspaceName: "W" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function company(workspaceId: string, name = "Acme AI") {
  const c = repo.createCompany(workspaceId, name);
  const deal = makeDeal();
  repo.saveVersion({ company: c, canonical: deal, derived: derive(deal, getRegistry(), DEFAULT_FUND_PROFILE), reason: "DECK_ANALYSIS" });
  return repo.getCompany(workspaceId, c.id)!;
}
const json = (method: string, body: unknown) => new Request("http://x/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("roles", () => {
  it("only owners and partners record IC decisions; analysts still set execution status", async () => {
    const c = company(first.workspaceId);
    as(first, "ANALYST");
    expect((await dealRoute.PATCH(json("PATCH", { icDecision: "APPROVED" }), params(c.id))).status).toBe(403);
    expect((await dealRoute.PATCH(json("PATCH", { executionStatus: "TERM_SHEET" }), params(c.id))).status).toBe(200);
    as(first, "PARTNER");
    expect((await dealRoute.PATCH(json("PATCH", { icDecision: "APPROVED" }), params(c.id))).status).toBe(200);
    expect(repo.getCompany(first.workspaceId, c.id)!.icDecision).toBe("APPROVED");
  });

  it("merging (a soft deletion) requires owner or partner", async () => {
    const a = company(first.workspaceId, "Dup A");
    const b = company(first.workspaceId, "Dup B");
    as(first, "ANALYST");
    const res = await duplicatesRoute.POST(json("POST", { action: "merge", targetId: b.id }), params(a.id));
    expect(res.status).toBe(403);
    expect(repo.getCompany(first.workspaceId, a.id)).toBeDefined();
  });

  it("backups are for owners of the setup workspace only", async () => {
    expect(isInstanceOwner({ role: "OWNER", workspaceId: first.workspaceId })).toBe(true);
    expect(isInstanceOwner({ role: "PARTNER", workspaceId: first.workspaceId })).toBe(false);
    expect(isInstanceOwner({ role: "OWNER", workspaceId: second.workspaceId })).toBe(false);
    as(second, "OWNER");
    expect((await backupRoute.GET()).status).toBe(403);
    expect((await backupRoute.POST()).status).toBe(403);
    as(first, "OWNER");
    expect((await backupRoute.GET()).status).toBe(200);
  });
});

describe("deletion stops in-flight work", () => {
  it("DELETE cancels the company's live run before removing it", async () => {
    const c = company(first.workspaceId, "Doomed");
    const run = repo.createRun({ workspaceId: first.workspaceId, companyId: c.id, mode: "STANDARD", model: "m", promptVersions: {}, registryId: "r", budgetUsd: 0.5, steps: [] });
    const signal = registerRun(run.id);
    as(first, "OWNER");
    expect((await dealRoute.DELETE(new Request("http://x", { method: "DELETE" }), params(c.id))).status).toBe(200);
    expect(signal.aborted).toBe(true);
    releaseRun(run.id);
    expect(repo.getCompany(first.workspaceId, c.id)).toBeUndefined();
  });
});

describe("upload limits", () => {
  const form = (n: number) => {
    const f = new FormData();
    for (let i = 0; i < n; i++) f.append("files", new File([`deck ${i}`], `d${i}.txt`, { type: "text/plain" }));
    return new Request("http://x", { method: "POST", body: f });
  };

  it("refuses a declared Content-Length above the cap before reading the body (413)", async () => {
    as(first, "ANALYST");
    const req = new Request("http://x/api/analyze", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(300 * 1024 * 1024) }, body: "--x--" });
    const res = await analyzeRoute.POST(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error).toMatch(/exceeds 200 MB/);
  });

  it("counts a body without Content-Length while reading it, and caps the number of files", async () => {
    const big = new ReadableStream({
      start(c) {
        for (let i = 0; i < 5; i++) c.enqueue(new Uint8Array(1024));
        c.close();
      },
    });
    const chunked = new Request("http://x", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: big, duplex: "half" } as RequestInit);
    await expect(readFormData(chunked, 4096)).rejects.toMatchObject({ status: 413 });
    await expect(readFormData(form(21), 10 * 1024 * 1024)).rejects.toBeInstanceOf(BodyLimitError);
    expect((await readFormData(form(3), 10 * 1024 * 1024)).getAll("files")).toHaveLength(3);
    as(first, "ANALYST");
    const res = await analyzeRoute.POST(form(21));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Too many files/);
  });

  it("a meeting `transcript` sent as a file part is a 400, not a 500", async () => {
    const c = company(first.workspaceId, "Meet Co");
    as(first, "ANALYST");
    const f = new FormData();
    f.append("transcript", new File(["Founder: hello"], "t.bin", { type: "application/octet-stream" }));
    const res = await meetingsRoute.POST(new Request("http://x", { method: "POST", body: f }), params(c.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/transcript must be text/);
  });
});

describe("health", () => {
  it("reports status only", async () => {
    const res = await healthRoute.GET();
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(["ok", "openaiConfigured"]);
  });
});

describe("fund memory references are workspace-scoped", () => {
  it("an observation or meeting cannot point at another workspace's company", async () => {
    const theirs = company(second.workspaceId, "Theirs");
    const mine = company(first.workspaceId, "Mine");
    const member = fm.addMember(first.workspaceId, first.userId, { name: "Pat", role: "GP", focus: [] });
    expect(() => fm.addObservation(first.workspaceId, first.userId, { memberId: member, kind: "CONCERN", statement: "x", companyId: theirs.id, provenance: "OBSERVED" })).toThrow(/Unknown company/);
    await expect(fm.addMeeting(first.workspaceId, first.userId, { kind: "IC", title: "IC", heldAt: "2026-09-01", companyId: theirs.id, extractObservations: false })).rejects.toThrow(/Unknown company/);
    expect(fm.addObservation(first.workspaceId, first.userId, { memberId: member, kind: "CONCERN", statement: "x", companyId: mine.id, provenance: "OBSERVED" })).toMatch(/^obs/);
  });
});

describe("login", () => {
  it("throttles repeated failures per email and client IP; a success clears the count", () => {
    const w = createWorkspaceWithOwner({ email: "throttle@fund.example", name: "T", password: "correct horse battery", workspaceName: "T" });
    void w;
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect(login("throttle@fund.example", "wrong", undefined, { ip: "1.1.1.1" })).toBeNull();
    expect(() => login("throttle@fund.example", "correct horse battery", undefined, { ip: "1.1.1.1" })).toThrow(LoginThrottledError);
    expect(login("throttle@fund.example", "correct horse battery", undefined, { ip: "2.2.2.2" })).not.toBeNull();
    expect(login("throttle@fund.example", "wrong", undefined, { ip: "2.2.2.2" })).toBeNull();
    expect(login("throttle@fund.example", "correct horse battery", undefined, { ip: "2.2.2.2" })).not.toBeNull();
  });

  it("an unknown email costs a password hash like a known one", () => {
    const time = (email: string) => {
      const t = process.hrtime.bigint();
      for (let i = 0; i < 3; i++) login(email, "wrong password", undefined, { ip: `t-${email}` });
      return Number(process.hrtime.bigint() - t);
    };
    time("nobody@fund.example"); // warm the dummy hash
    const known = time("setup@fund.example");
    const unknown = time("nobody-else@fund.example");
    expect(unknown).toBeGreaterThan(known * 0.4);
  });
});
