import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, schema, type DB } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { analysisFeedbackForUser, feedbackReport, meetingAnswerSignal, questionFeedbackForUser, recordAnalysisFeedback, recordQuestionFeedback, summarizeAnalysisFeedback, summarizeQuestionFeedback } from "@/server/question-feedback";
import { correctionStats } from "@/server/quality";
import { addOverride, removeOverride } from "@/engine/overrides";
import { makeDeal, metric } from "./fixtures";

describe("question feedback summaries (pure)", () => {
  const row = (verdict: "USEFUL" | "NOT_USEFUL" | "ALREADY_KNOWN", o: Partial<{ companyId: string; questionText: string; userId: string; tier: string; updatedAt: string }> = {}) => ({
    companyId: "c1",
    questionText: "What is churn?",
    userId: "u1",
    tier: "MUST_ASK",
    updatedAt: "2026-09-01T00:00:00Z",
    verdict,
    ...o,
  });
  it("already known counts against usefulness; the latest judgement per user and question wins", () => {
    const s = summarizeQuestionFeedback([
      row("NOT_USEFUL", { updatedAt: "2026-09-01T00:00:00Z" }),
      row("USEFUL", { updatedAt: "2026-09-02T00:00:00Z", questionText: "  what is CHURN? " }), // same question on a later version
      row("ALREADY_KNOWN", { questionText: "ACV?", tier: "OPTIONAL" }),
      row("USEFUL", { userId: "u2" }),
    ]);
    expect(s.n).toBe(3);
    expect(s.useful).toBe(2);
    expect(s.alreadyKnown).toBe(1);
    expect(s.usefulRate).toBeCloseTo(2 / 3);
    expect(s.byTier.OPTIONAL).toEqual({ n: 1, useful: 0 });
  });
  it("no feedback → not measured", () => {
    expect(summarizeQuestionFeedback([]).usefulRate).toBeNull();
  });
});

describe("meeting answer signal (automatic, read-only)", () => {
  const q = (id: string, status: "OPEN" | "ASKED" | "RESOLVED" | "NOT_FULLY_RESOLVED", answer: string | null = null) => ({ id, question: `Question ${id}`, status, answer });
  it("counts open pre-meeting questions the post-meeting version answered; already-resolved ones are not re-counted", () => {
    const s = meetingAnswerSignal([
      {
        pre: [q("Q-01", "OPEN"), q("Q-02", "OPEN"), q("Q-03", "RESOLVED", "x"), q("Q-04", "ASKED")],
        post: [q("Q-01", "RESOLVED", "yes"), q("Q-02", "OPEN"), q("Q-03", "RESOLVED", "x"), q("Q-04", "ASKED", "partial answer")],
      },
    ]);
    expect(s).toMatchObject({ meetings: 1, asked: 3, answered: 2, resolved: 1 });
    expect(s.answeredRate).toBeCloseTo(2 / 3);
  });
});

describe("analysis feedback summary", () => {
  it("shares per kind of value and the median minutes saved", () => {
    const s = summarizeAnalysisFeedback([
      { betterQuestions: true, importantRisks: false, missingEvidence: false, marketInsight: false, minutesSaved: 30 },
      { betterQuestions: false, importantRisks: true, missingEvidence: true, marketInsight: false, minutesSaved: 90 },
      { betterQuestions: false, importantRisks: false, missingEvidence: false, marketInsight: false, minutesSaved: null },
    ]);
    expect(s.n).toBe(3);
    expect(s.anyValue).toBeCloseTo(2 / 3);
    expect(s.betterQuestions).toBeCloseTo(1 / 3);
    expect(s.minutesSavedMedian).toBe(60);
    expect(s.minutesSavedN).toBe(2);
  });
});

describe("feedback storage", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cv-feedback-"));
  const db: DB = openDb(path.join(tmp, "conviction.db"));
  afterAll(() => {
    db.$client.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const { userId, workspaceId } = createWorkspaceWithOwner({ email: "p@fund.example", name: "P", password: "partner-password-1", workspaceName: "Fund" }, db);
  const company = repo.createCompany(workspaceId, "Acme", db);

  it("one judgement per user per question per version (upsert), found again on a later version with the same question", () => {
    const question = { id: "Q-01", question: "What is gross margin including inference?", tier: "MUST_ASK" as const };
    recordQuestionFeedback({ workspaceId, companyId: company.id, versionId: "ver_1", userId, question, verdict: "NOT_USEFUL", source: "MANUAL" }, db);
    recordQuestionFeedback({ workspaceId, companyId: company.id, versionId: "ver_1", userId, question, verdict: "USEFUL", note: " asked in the meeting ", source: "AFTER_MEETING" }, db);
    const rows = db.select().from(schema.questionFeedback).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "USEFUL", note: "asked in the meeting", source: "AFTER_MEETING" });
    expect(questionFeedbackForUser(company.id, userId, [question], db)["Q-01"]?.verdict).toBe("USEFUL");
    expect(questionFeedbackForUser(company.id, userId, [{ id: "Q-01", question: "A different question" }], db)["Q-01"]).toBeUndefined();
    const r = feedbackReport(workspaceId, db);
    expect(r.questions).toMatchObject({ n: 1, useful: 1, usefulRate: 1 });
    expect(r.questionsAfterMeeting.n).toBe(1);
  });

  it("analysis feedback upserts per user and version", () => {
    const base = { workspaceId, companyId: company.id, versionId: "ver_1", userId, betterQuestions: true, importantRisks: false, missingEvidence: false, marketInsight: false, minutesSaved: 20 };
    recordAnalysisFeedback(base, db);
    recordAnalysisFeedback({ ...base, importantRisks: true, minutesSaved: 45 }, db);
    expect(db.select().from(schema.analysisFeedback).all()).toHaveLength(1);
    expect(analysisFeedbackForUser(company.id, "ver_1", userId, db)).toMatchObject({ importantRisks: true, minutesSaved: 45 });
    expect(feedbackReport(workspaceId, db).analyses).toMatchObject({ n: 1, importantRisks: 1, minutesSavedMedian: 45 });
  });
});

describe("human correction rate counts override-based corrections correctly", () => {
  const deal = () => {
    const d = makeDeal();
    d.metrics = [metric("arr", 3_840_000, { id: "MET-001" }), metric("paying_customers", 92, { id: "MET-002", unit: "COUNT" }), metric("nrr", 118, { id: "MET-003", unit: "PERCENT" }), metric("acv", 41_739, { id: "MET-004", calculationMethod: "DERIVED", inputs: ["MET-001", "MET-002"] })];
    return d;
  };
  const ov = (d: ReturnType<typeof deal>, ref: string, to: number) => addOverride(d, { target: "METRIC", ref, field: "normalizedValue", from: null, to, reason: "data room", by: "P", at: "2026-09-20T10:00:00.000Z" }).deal;

  it("no override → 0 of the extracted primary metrics (derived metrics are not correctable)", () => {
    expect(correctionStats(deal())).toMatchObject({ primary: 3, corrected: 0, otherOverrides: 0 });
  });
  it("stacked overrides on one metric count once; a second metric counts", () => {
    let d = ov(deal(), "MET-001", 3_500_000);
    d = ov(d, "MET-001", 3_400_000);
    expect(correctionStats(d).corrected).toBe(1);
    d = ov(d, "MET-003", 105);
    expect(correctionStats(d).corrected).toBe(2);
  });
  it("a reverted override no longer counts; an override whose target disappeared is stale, not a correction", () => {
    const d = ov(deal(), "MET-002", 80);
    const id = d.overrides[0]!.id;
    expect(correctionStats(removeOverride(d, id).deal).corrected).toBe(0);
    const gone = { ...structuredClone(d), metrics: d.metrics.filter((m) => m.id !== "MET-002") };
    const s = correctionStats(gone);
    expect(s.corrected).toBe(0);
    expect(s.staleOverrides).toBe(1);
  });
  it("classification overrides are reported separately and never inflate the metric rate", () => {
    const d = addOverride(deal(), { target: "CLASSIFICATION", ref: "classification", field: "financingStage", from: "SERIES_A", to: "SEED", reason: "term sheet", by: "P", at: "2026-09-20T10:00:00.000Z" }).deal;
    expect(correctionStats(d)).toMatchObject({ corrected: 0, otherOverrides: 1 });
  });
  it("legacy USER_CORRECTED metric copies still count", () => {
    const d = deal();
    d.metrics[0] = { ...d.metrics[0]!, calculationMethod: "USER_CORRECTED" };
    expect(correctionStats(d).corrected).toBe(1);
  });
});
