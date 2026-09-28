/** The attempt record analytics run on (a stored attempt, decoupled from the DB row). */
import type { Answer, Exercise, Grade } from "./types";

export interface AttemptRecord {
  id: string;
  /** The full exercise as generated when the answer was stored (public part + key). */
  exercise: Exercise;
  answer: Answer;
  /** Stated confidence, 0–1, recorded with the answer. */
  confidence: number;
  answeredAt: string;
  grade: Grade | null;
  gradedAt: string | null;
}

export const graded = (xs: AttemptRecord[]) => xs.filter((a): a is AttemptRecord & { grade: Grade } => !!a.grade);

export function chronological<T extends { answeredAt: string }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (a.answeredAt < b.answeredAt ? -1 : a.answeredAt > b.answeredAt ? 1 : 0));
}

/** One-line description of what the user answered (journal, mistake evidence). */
export function answerSummary(a: Pick<AttemptRecord, "exercise" | "answer">): string {
  const ex = a.exercise;
  const ans = a.answer;
  switch (ans.type) {
    case "choice": {
      const opt = ex.input.type === "choice" ? ex.input.options.find((o) => o.id === ans.optionId) : null;
      return `Chose ${ans.optionId}${opt ? ` — ${opt.text}` : ""}${ans.justification ? ` Because: ${ans.justification}` : ""}`;
    }
    case "numeric":
      return `Answered ${ans.value}`;
    case "statements":
      return ans.flags.length ? `Flagged ${ans.flags.map((f) => `${f.statementId} (${f.category.toLowerCase().replace(/_/g, " ")})`).join(", ")}` : "Flagged nothing";
    case "multi":
      return `Selected ${ans.optionIds.join(", ") || "nothing"}`;
    case "questions":
      return ans.questions.filter(Boolean).map((q, i) => `${i + 1}. ${q}`).join(" ");
    case "decision":
      return `${ans.decision.replace(/_/g, " ").toLowerCase()} — ${ans.justification}`;
    case "bullbear":
      return `Bull: ${ans.bull} Bear: ${ans.bear}`;
    case "outlier":
      return `${ans.exceptional ? "Exceptional" : "Not exceptional"}${ans.signalIds.length ? ` (${ans.signalIds.join(", ")})` : ""} — ${ans.justification}`;
    case "text":
      return ans.text;
  }
}

/** What the reveal shows after an answer is stored (API payload; client-safe type). */
export interface RevealPayload {
  attemptId: string;
  exercise: import("./types").Exercise;
  answer: Answer;
  confidence: number;
  answeredAt: string;
  grade: Grade | null;
  gradeError: string | null;
  skillChanges: { skill: import("./types").Skill; before: number; after: number; rdBefore: number; rdAfter: number }[];
  mistakes: import("./mistakes").MistakeRecord[];
}
