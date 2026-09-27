import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { openDb, schema, type DB } from "@/db/client";
import { createSession, createWorkspaceWithOwner, login, resolveSession } from "@/server/auth";
import * as members from "@/server/members";
import * as repo from "@/server/repo";
import { buildExport, ExportTooLargeError } from "@/server/export";
import { LocalDiskStorage, setStorageAdapter, storeFile } from "@/server/storage";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-members-"));
const db: DB = openDb(path.join(tmp, "conviction.db"));
afterAll(() => {
  db.$client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("members & roles", () => {
  const { userId: owner, workspaceId } = createWorkspaceWithOwner({ email: "owner@fund.example", name: "Owner", password: "owner-password-1", workspaceName: "Fund" }, db);

  it("invites with a one-time temporary password that works for login and is stored hashed", () => {
    const r = members.inviteMember(workspaceId, owner, { email: "  Analyst@Fund.example ", name: "Ana", role: "ANALYST" }, db);
    expect(r.email).toBe("analyst@fund.example");
    expect(r.temporaryPassword).toMatch(/^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){3}$/);
    const stored = db.select().from(schema.users).all().find((u) => u.id === r.userId)!;
    expect(stored.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(stored.passwordHash).not.toContain(r.temporaryPassword);
    const session = login("analyst@fund.example", r.temporaryPassword, db);
    expect(session).not.toBeNull();
    expect(resolveSession(session!.cookie, db)?.role).toBe("ANALYST");
    expect(() => members.inviteMember(workspaceId, owner, { email: "analyst@fund.example", name: "Dup", role: "VIEWER" }, db)).toThrow(/already a member/);
  });

  it("changes roles, never demotes or removes the last owner, and audits every action", () => {
    const list = members.listMembers(workspaceId, db);
    const ana = list.find((m) => m.email === "analyst@fund.example")!;
    expect(() => members.changeRole(workspaceId, owner, owner, "PARTNER", db)).toThrow(/at least one owner/);
    expect(() => members.removeMember(workspaceId, owner, owner, db)).toThrow(/last owner/);
    members.changeRole(workspaceId, owner, ana.userId, "OWNER", db);
    members.changeRole(workspaceId, owner, owner, "PARTNER", db); // now allowed: another owner exists
    expect(() => members.removeMember(workspaceId, owner, ana.userId, db)).toThrow(/last owner/);
    members.changeRole(workspaceId, ana.userId, owner, "OWNER", db);
    members.removeMember(workspaceId, owner, ana.userId, db);
    expect(members.listMembers(workspaceId, db).map((m) => m.email)).toEqual(["owner@fund.example"]);
    expect(login("analyst@fund.example", "anything", db)).toBeNull();
    const actions = members.listAudit(workspaceId, {}, db).map((a) => a.action);
    expect(actions.filter((a) => a === "MEMBER_ROLE_CHANGED")).toHaveLength(3);
    expect(actions).toContain("MEMBER_INVITED");
    expect(actions).toContain("MEMBER_REMOVED");
    expect(members.listAudit(workspaceId, { action: "MEMBER_INVITED" }, db)).toHaveLength(1);
    expect(members.listAudit(workspaceId, { q: "analyst@fund" }, db).length).toBeGreaterThanOrEqual(2);
  });

  it("password reset signs the member out; self-service change requires the current password", () => {
    const inv = members.inviteMember(workspaceId, owner, { email: "viewer@fund.example", name: "Vi", role: "VIEWER" }, db);
    const s1 = createSession(inv.userId, workspaceId, db);
    const reset = members.resetPassword(workspaceId, owner, inv.userId, db);
    expect(resolveSession(s1.cookie, db)).toBeNull();
    expect(login("viewer@fund.example", inv.temporaryPassword, db)).toBeNull();
    expect(login("viewer@fund.example", reset.temporaryPassword, db)).not.toBeNull();
    expect(() => members.changeOwnPassword(workspaceId, inv.userId, null, { current: "wrong", next: "a-long-new-password" }, db)).toThrow(/incorrect/);
    members.changeOwnPassword(workspaceId, inv.userId, null, { current: reset.temporaryPassword, next: "a-long-new-password" }, db);
    expect(login("viewer@fund.example", "a-long-new-password", db)).not.toBeNull();
  });
});

describe("full export", () => {
  it("exports every workspace table (no other workspace, no embeddings, no password hashes) plus decrypted documents", async () => {
    setStorageAdapter(new LocalDiskStorage(path.join(tmp, "uploads")));
    try {
      const a = createWorkspaceWithOwner({ email: "a@fund.example", name: "A", password: "password-aaaa", workspaceName: "Alpha" }, db);
      const b = createWorkspaceWithOwner({ email: "b@fund.example", name: "B", password: "password-bbbb", workspaceName: "Beta" }, db);
      for (const ws of [a, b]) {
        const c = repo.createCompany(ws.workspaceId, `Co ${ws.workspaceId}`, db);
        const bytes = Buffer.from(`%PDF deck of ${ws.workspaceId}`);
        const key = await storeFile(ws.workspaceId, `sha${ws.workspaceId}`, "deck.pdf", bytes);
        repo.saveDocument({ workspaceId: ws.workspaceId, companyId: c.id, filename: "deck.pdf", mime: "application/pdf", kind: "PDF", sizeBytes: bytes.length, sha256: "x", storagePath: key, pages: [{ pageNo: 1, text: "page one" }] }, db);
        db.insert(schema.chunks).values({ id: `chk_${ws.workspaceId}`, workspaceId: ws.workspaceId, companyId: c.id, kind: "PAGE", title: "t", text: "page one", textHash: "h", embedding: Buffer.alloc(16), embeddingDim: 4, createdAt: "2026-01-01" }).run();
      }
      repo.saveDocument({ workspaceId: a.workspaceId, companyId: repo.listCompanies(a.workspaceId, db)[0]!.id, filename: "gone.pdf", mime: "application/pdf", kind: "PDF", sizeBytes: 3, sha256: "y", storagePath: `${a.workspaceId}/missing.pdf`, pages: [] }, db);

      const { zip, manifest } = await buildExport(a.workspaceId, { db, exportedBy: "a@fund.example" });
      const loaded = await JSZip.loadAsync(await zip.generateAsync({ type: "nodebuffer" }));
      const read = async (p: string) => JSON.parse(await loaded.file(p)!.async("string"));

      const m = await read("manifest.json");
      expect(m.format).toBe("conviction-export/1");
      expect(m.schema.migrations_applied).toBeGreaterThan(0);
      expect(m.counts.companies).toBe(1);
      expect(m.documents.files).toBe(1);
      expect(m.documents.missing).toHaveLength(1);
      expect(manifest.counts.document_pages).toBe(1);
      for (const t of ["companies", "company_versions", "documents", "document_pages", "analysis_runs", "cost_records", "history_events", "fund_knowledge", "ic_members", "ic_observations", "meetings", "chat_threads", "chat_messages", "funds", "memory_packs", "metric_facts", "entities", "relations", "audit_log", "chunks"])
        expect(loaded.file(`tables/${t}.json`), t).not.toBeNull();

      const companies = await read("tables/companies.json");
      expect(companies.every((c: { workspaceId: string }) => c.workspaceId === a.workspaceId)).toBe(true);
      const chunks = await read("tables/chunks.json");
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).not.toHaveProperty("embedding");
      const mem = await read("members.json");
      expect(JSON.stringify(mem)).not.toContain("scrypt");
      expect(mem.map((x: { email: string }) => x.email)).toEqual(["a@fund.example"]);
      const docs = Object.keys(loaded.files).filter((f) => f.startsWith("documents/") && !f.endsWith("/"));
      expect(docs).toHaveLength(1);
      expect(await loaded.file(docs[0]!)!.async("string")).toBe(`%PDF deck of ${a.workspaceId}`); // decrypted

      await expect(buildExport(a.workspaceId, { db, maxBytes: 1000 })).rejects.toThrow(ExportTooLargeError);
      const noFiles = await buildExport(a.workspaceId, { db, includeFiles: false });
      expect(noFiles.manifest.documents.included).toBe(false);
    } finally {
      setStorageAdapter(null);
    }
  });
});
