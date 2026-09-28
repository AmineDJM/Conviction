/**
 * Formation persistence. Every query is scoped by workspace AND user: training
 * data is private to the person who answered.
 *
 * Immutability: `insertAttempt` writes the answer, confidence and timestamp
 * once. There is deliberately no function that updates them; `setGrade`
 * writes grade columns only. `answerHash` makes any out-of-band edit visible
 * (`verifyAnswerHash`).
 */
import { createHash } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { newId, nowIso } from "@/server/ids";
import type { AttemptRecord } from "./records";
import type { MistakeRecord } from "./mistakes";
import type { Answer, Exercise, Grade } from "./types";

const s = schema;
export type AttemptRow = typeof s.formationAttempts.$inferSelect;

export function answerHash(answer: Answer, confidence: number, answeredAt: string): string {
  return createHash("sha256").update(JSON.stringify({ answer, confidence, answeredAt })).digest("hex");
}

export function verifyAnswerHash(row: Pick<AttemptRow, "answer" | "confidence" | "answeredAt" | "answerHash">): boolean {
  return answerHash(row.answer as Answer, row.confidence, row.answeredAt) === row.answerHash;
}

export function insertAttempt(v: { workspaceId: string; userId: string; exercise: Exercise; answer: Answer; confidence: number; answeredAt?: string }, db: DB = getDb()): AttemptRow {
  const id = newId("fat");
  const answeredAt = v.answeredAt ?? nowIso();
  const ex = v.exercise;
  db.insert(s.formationAttempts)
    .values({
      id,
      workspaceId: v.workspaceId,
      userId: v.userId,
      companyId: ex.case.companyId,
      versionId: ex.case.versionId,
      exerciseId: ex.id,
      kind: ex.kind,
      variant: ex.variant,
      skills: ex.skills,
      difficulty: ex.difficulty,
      level: ex.level,
      expert: ex.expert,
      patterns: ex.patterns,
      exercise: ex as never,
      answer: v.answer as never,
      confidence: v.confidence,
      answeredAt,
      answerHash: answerHash(v.answer, v.confidence, answeredAt),
      status: "ANSWERED",
    })
    .run();
  return db.select().from(s.formationAttempts).where(eq(s.formationAttempts.id, id)).get()!;
}

/** Writes the grade. Never touches the answer columns. */
export function setGrade(attemptId: string, grade: Grade, costUsd: number, db: DB = getDb()) {
  db.update(s.formationAttempts)
    .set({ status: "GRADED", grade: grade as never, score: grade.score, correct: grade.correct, gradeMethod: grade.method, gradeCostUsd: costUsd, gradedAt: nowIso() })
    .where(eq(s.formationAttempts.id, attemptId))
    .run();
}

export function markGradeFailed(attemptId: string, db: DB = getDb()) {
  db.update(s.formationAttempts).set({ status: "GRADE_FAILED" }).where(eq(s.formationAttempts.id, attemptId)).run();
}

export function toRecord(row: AttemptRow): AttemptRecord {
  return {
    id: row.id,
    exercise: row.exercise as Exercise,
    answer: row.answer as Answer,
    confidence: row.confidence,
    answeredAt: row.answeredAt,
    grade: (row.grade as Grade | null) ?? null,
    gradedAt: row.gradedAt,
  };
}

export function listAttemptRows(workspaceId: string, userId: string, db: DB = getDb()): AttemptRow[] {
  return db
    .select()
    .from(s.formationAttempts)
    .where(and(eq(s.formationAttempts.workspaceId, workspaceId), eq(s.formationAttempts.userId, userId)))
    .orderBy(asc(s.formationAttempts.answeredAt))
    .all();
}

export function listAttempts(workspaceId: string, userId: string, db: DB = getDb()): AttemptRecord[] {
  return listAttemptRows(workspaceId, userId, db).map(toRecord);
}

export function getAttemptRow(workspaceId: string, userId: string, id: string, db: DB = getDb()): AttemptRow | undefined {
  return db
    .select()
    .from(s.formationAttempts)
    .where(and(eq(s.formationAttempts.workspaceId, workspaceId), eq(s.formationAttempts.userId, userId), eq(s.formationAttempts.id, id)))
    .get();
}

export function insertMistakes(workspaceId: string, userId: string, records: MistakeRecord[], db: DB = getDb()) {
  for (const r of records)
    db.insert(s.formationMistakes)
      .values({ id: newId("fmk"), workspaceId, userId, attemptId: r.attemptId, companyId: r.companyId, kind: r.kind, evidence: r.evidence, createdAt: r.at })
      .onConflictDoNothing()
      .run();
}

export function listMistakeRows(workspaceId: string, userId: string, db: DB = getDb()) {
  return db
    .select()
    .from(s.formationMistakes)
    .where(and(eq(s.formationMistakes.workspaceId, workspaceId), eq(s.formationMistakes.userId, userId)))
    .orderBy(asc(s.formationMistakes.createdAt))
    .all();
}
