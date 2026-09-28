/**
 * Formation persistence on a real (temporary) SQLite database: the answer is
 * stored before grading and never changes; data is private per user; grading
 * cost is recorded with the FORMATION scope.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { openDb, schema, type DB } from "@/db/client";
import { createWorkspaceWithOwner, hashPassword } from "@/server/auth";
import { createCompany, recordCost } from "@/server/repo";
import * as store from "@/formation/store";
import { grade } from "@/formation/grade";
import { classifyMistakes } from "@/formation/mistakes";
import { gradeOpenAnswer } from "@/formation/ai-grader";
import { caseFrom, cleanDeal, kindOf, withAnalysis } from "./formation.helpers";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "formation-"));
const db: DB = openDb(path.join(tmp, "conviction.db"));
afterAll(() => {
  db.$client.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const { userId, workspaceId } = createWorkspaceWithOwner({ email: "gp@fund.example", name: "GP", password: "correct horse battery", workspaceName: "Fund" }, db);
const other = "usr_other";
db.insert(schema.users).values({ id: other, email: "analyst@fund.example", name: "Analyst", passwordHash: hashPassword("x".repeat(12)), createdAt: new Date().toISOString() }).run();
db.insert(schema.memberships).values({ userId: other, workspaceId, role: "ANALYST" }).run();
const company = createCompany(workspaceId, "Acme AI", db);
const c = caseFrom(withAnalysis(cleanDeal()), { companyId: company.id, slug: company.slug });
const ex = kindOf(c, "NUMERIC", "RUNWAY");

describe("attempt storage", () => {
  it("stores the answer, confidence and a verifiable hash before any grade", () => {
    const row = store.insertAttempt({ workspaceId, userId, exercise: ex, answer: { type: "numeric", value: "9" }, confidence: 0.7 }, db);
    expect(row.status).toBe("ANSWERED");
    expect(row.grade).toBeNull();
    expect(store.verifyAnswerHash(row)).toBe(true);
    expect((row.exercise as typeof ex).key.numeric!.value).toBe(ex.key.numeric!.value);
  });
  it("grading never changes the answer columns", () => {
    const row = store.insertAttempt({ workspaceId, userId, exercise: ex, answer: { type: "numeric", value: "8.6" }, confidence: 0.8 }, db);
    const g = grade({ ex, answer: row.answer as never, c });
    store.setGrade(row.id, g, 0, db);
    const after = store.getAttemptRow(workspaceId, userId, row.id, db)!;
    expect(after.status).toBe("GRADED");
    expect(after.score).toBe(g.score);
    expect(after.answer).toEqual(row.answer);
    expect(after.confidence).toBe(row.confidence);
    expect(after.answeredAt).toBe(row.answeredAt);
    expect(after.answerHash).toBe(row.answerHash);
    expect(store.verifyAnswerHash(after)).toBe(true);
  });
  it("an out-of-band edit of the answer is detectable", () => {
    const row = store.insertAttempt({ workspaceId, userId, exercise: ex, answer: { type: "numeric", value: "5" }, confidence: 0.5 }, db);
    db.update(schema.formationAttempts).set({ answer: { type: "numeric", value: "8.6" } as never }).where(eq(schema.formationAttempts.id, row.id)).run();
    expect(store.verifyAnswerHash(store.getAttemptRow(workspaceId, userId, row.id, db)!)).toBe(false);
  });
  it("the store exposes no function that updates an answer", () => {
    expect(Object.keys(store).filter((k) => /update|edit|setAnswer|patch/i.test(k))).toEqual([]);
  });
  it("attempts are private to the user who answered", () => {
    store.insertAttempt({ workspaceId, userId: other, exercise: ex, answer: { type: "numeric", value: "1" }, confidence: 0.2 }, db);
    const mine = store.listAttempts(workspaceId, userId, db);
    const theirs = store.listAttempts(workspaceId, other, db);
    expect(theirs.length).toBe(1);
    expect(mine.every((a) => a.id !== theirs[0]!.id)).toBe(true);
    expect(store.getAttemptRow(workspaceId, userId, theirs[0]!.id, db)).toBeUndefined();
  });
  it("records round-trip to analytics records in answer order", () => {
    const recs = store.listAttempts(workspaceId, userId, db);
    expect(recs.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < recs.length; i++) expect(recs[i]!.answeredAt >= recs[i - 1]!.answeredAt).toBe(true);
  });
});

describe("mistake storage", () => {
  it("stores classified mistakes once per attempt and kind", () => {
    const row = store.insertAttempt({ workspaceId, userId, exercise: ex, answer: { type: "numeric", value: "30" }, confidence: 0.95 }, db);
    const g = grade({ ex, answer: row.answer as never, c });
    store.setGrade(row.id, g, 0, db);
    const ms = classifyMistakes(store.toRecord(store.getAttemptRow(workspaceId, userId, row.id, db)!));
    expect(ms.map((m) => m.kind)).toEqual(expect.arrayContaining(["MATH_ERROR", "OVERCONFIDENT_ERROR"]));
    store.insertMistakes(workspaceId, userId, ms, db);
    store.insertMistakes(workspaceId, userId, ms, db);
    expect(store.listMistakeRows(workspaceId, userId, db).filter((m) => m.attemptId === row.id).length).toBe(ms.length);
    expect(store.listMistakeRows(workspaceId, other, db)).toEqual([]);
  });
});

describe("grading cost", () => {
  it("records model-grading cost with the FORMATION scope, under the per-attempt cap", async () => {
    const open = kindOf(c, "OPEN_THESIS");
    const out = await gradeOpenAnswer(open, "We bet that automation replaces manual AP work; retention must hold above 110%.", {
      workspaceId,
      db,
      onCost: (e) => recordCost(workspaceId, null, "FORMATION", e, db),
      call: async ({ cost }) => {
        const est = cost.authorize("formation_grade", "gpt-5.6-luna", 9000, 1400);
        await cost.record({ step: "formation_grade", model: "gpt-5.6-luna", promptVersion: "formation_rubric_v1", usage: { inputTokens: 2800, cachedTokens: 0, outputTokens: 500, reasoningTokens: 300, webSearches: 0 }, estimatedUsd: est, latencyMs: 5, toolCalls: 0 });
        return { reasoningQuality: 3, evidenceUse: 2, caughtIds: ["T1"], pedigreeReliance: false, strongestPoint: "", biggestGap: "", feedback: "" };
      },
    });
    expect(out.rubric.method).toBe("MODEL");
    const costs = db.select().from(schema.costRecords).where(eq(schema.costRecords.workspaceId, workspaceId)).all();
    expect(costs.length).toBe(1);
    expect(costs[0]!.scope).toBe("FORMATION");
    expect(costs[0]!.actualUsd).toBeLessThan(0.01);
  });
  it("an identical answer is served from the cache at zero cost", async () => {
    const open = kindOf(c, "OPEN_THESIS");
    let called = 0;
    const out = await gradeOpenAnswer(open, "We bet that automation replaces manual AP work; retention must hold above 110%.", {
      workspaceId,
      db,
      onCost: (e) => recordCost(workspaceId, null, "FORMATION", e, db),
      call: async () => {
        called++;
        throw new Error("should not be called");
      },
    });
    expect(called).toBe(0);
    expect(out.rubric.cached).toBe(true);
    expect(out.costUsd).toBe(0);
  });
});

describe("deleting a company removes its training attempts", () => {
  it("cascades", () => {
    const co2 = createCompany(workspaceId, "Beta", db);
    const c2 = caseFrom(cleanDeal(), { companyId: co2.id });
    const e2 = kindOf(c2, "NUMERIC", "RUNWAY");
    const row = store.insertAttempt({ workspaceId, userId, exercise: e2, answer: { type: "numeric", value: "1" }, confidence: 0.5 }, db);
    db.delete(schema.companies).where(eq(schema.companies.id, co2.id)).run();
    expect(store.getAttemptRow(workspaceId, userId, row.id, db)).toBeUndefined();
  });
});
