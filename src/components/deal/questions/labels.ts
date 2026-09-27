/** Client-safe question status labels. Factual states only — never psychological labels. */
import type { FounderQuestion } from "@/domain/canonical";
import type { Tone } from "@/lib/format";

export const QUESTION_STATUS_TEXT: Record<FounderQuestion["status"], string> = {
  OPEN: "Open",
  ASKED: "Asked",
  RESOLVED: "Resolved",
  NOT_FULLY_RESOLVED: "Not fully resolved",
};

export const questionStatusTone = (s: string): Tone => (s === "RESOLVED" ? "ok" : s === "NOT_FULLY_RESOLVED" ? "warn" : s === "ASKED" ? "accent" : "neutral");
