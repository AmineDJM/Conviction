/**
 * INVESTOR JOURNAL — "What did you believe at the time?"
 *
 * Every answer is stored before the reveal and never edited. The journal
 * compares that belief with what happened afterwards: the founder meeting
 * (questions answered after the attempt), the IC decision, the analysis on
 * later versions, and the company's reported progress. Pure.
 */
import { bucketOf, bucketRank } from "./gen-judgment";
import { DECISION_LABEL_F } from "./labels";
import { answerSummary, type AttemptRecord } from "./records";
import { contentTokens, jaccard, topicsOf } from "./topics";
import type { DecisionBucket } from "./types";

export interface VersionSnapshot {
  id: string;
  versionNo: number;
  createdAt: string;
  reason: string;
  recommendation: string | null;
  metrics: Record<string, number>;
}

export interface CompanyTimeline {
  companyId: string;
  name: string;
  slug: string;
  icDecision: "PENDING" | "APPROVED" | "REJECTED";
  icDecidedAt: string | null;
  executionStatus: string;
  versions: VersionSnapshot[];
  /** Founder questions with their answers, as of the latest version. */
  answeredQuestions: { id: string; question: string; answer: string | null; status: string; answeredAt: string | null }[];
}

export interface Divergence {
  kind: "IC" | "ANALYSIS" | "FOUNDER_MEETING" | "PROGRESS";
  tone: "agree" | "diverge" | "neutral";
  text: string;
}

export interface JournalEntry {
  attemptId: string;
  at: string;
  caseName: string;
  slug: string;
  versionNo: number;
  title: string;
  kind: string;
  belief: string;
  confidence: number;
  decision: DecisionBucket | null;
  analysisAtTime: DecisionBucket | null;
  since: Divergence[];
}

/** Metrics shown as company progress. */
export const PROGRESS_KEYS: { key: string; label: string; unit: "USD" | "PCT" | "COUNT" | "MONTHS" }[] = [
  { key: "arr", label: "ARR", unit: "USD" },
  { key: "revenue_ttm", label: "Revenue (TTM)", unit: "USD" },
  { key: "gmv", label: "GMV", unit: "USD" },
  { key: "paying_customers", label: "Paying customers", unit: "COUNT" },
  { key: "nrr", label: "NRR", unit: "PCT" },
  { key: "grr", label: "GRR", unit: "PCT" },
  { key: "runway_months", label: "Runway", unit: "MONTHS" },
];

const fmt = (unit: string, v: number) =>
  unit === "USD" ? (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${(v / 1e3).toFixed(0)}k`) : unit === "PCT" ? `${v.toFixed(0)}%` : unit === "MONTHS" ? `${v.toFixed(1)} mo` : v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** What the user's belief implies as a decision bucket, when the exercise carries one. */
export function beliefBucket(a: AttemptRecord): DecisionBucket | null {
  if (a.answer.type === "decision") return a.answer.decision;
  if (a.answer.type === "outlier") return a.answer.exceptional ? "CONTINUE_DD" : null;
  return null;
}

export function journalEntry(a: AttemptRecord, t: CompanyTimeline | null): JournalEntry {
  const ex = a.exercise;
  const decision = beliefBucket(a);
  const since: Divergence[] = [];
  if (t) {
    // IC decision taken after the belief was recorded (or at any time, if no date is known).
    if (t.icDecision !== "PENDING" && (!t.icDecidedAt || t.icDecidedAt >= a.answeredAt)) {
      const approved = t.icDecision === "APPROVED";
      if (decision) {
        const positive = bucketRank(decision) >= bucketRank("CONTINUE_DD");
        const agree = positive === approved;
        since.push({ kind: "IC", tone: agree ? "agree" : "diverge", text: `IC ${approved ? "approved" : "rejected"} the deal${t.icDecidedAt ? ` on ${t.icDecidedAt.slice(0, 10)}` : ""}; you said “${DECISION_LABEL_F[decision].toLowerCase()}”.` });
      } else since.push({ kind: "IC", tone: "neutral", text: `IC ${approved ? "approved" : "rejected"} the deal${t.icDecidedAt ? ` on ${t.icDecidedAt.slice(0, 10)}` : ""}.` });
    }
    // Analysis on the latest version versus the belief.
    const atTime = t.versions.find((v) => v.id === ex.case.versionId) ?? null;
    const latest = t.versions[t.versions.length - 1] ?? null;
    const nowBucket = bucketOf(latest?.recommendation ?? null);
    if (latest && atTime && latest.id !== atTime.id) {
      const thenBucket = bucketOf(atTime.recommendation);
      if (nowBucket && thenBucket && nowBucket !== thenBucket)
        since.push({ kind: "ANALYSIS", tone: decision ? (Math.abs(bucketRank(decision) - bucketRank(nowBucket)) < Math.abs(bucketRank(decision) - bucketRank(thenBucket)) ? "agree" : "diverge") : "neutral", text: `The analysis moved from “${DECISION_LABEL_F[thenBucket].toLowerCase()}” to “${DECISION_LABEL_F[nowBucket].toLowerCase()}” (v${atTime.versionNo} → v${latest.versionNo}, ${latest.reason.replace(/_/g, " ").toLowerCase()}).` });
      // Progress: reported metrics that changed between the version you judged and the latest.
      for (const p of PROGRESS_KEYS) {
        const before = atTime.metrics[p.key];
        const after = latest.metrics[p.key];
        if (before === undefined || after === undefined || Math.abs(after - before) < 1e-9) continue;
        const pct = before !== 0 ? ((after - before) / Math.abs(before)) * 100 : null;
        since.push({ kind: "PROGRESS", tone: "neutral", text: `${p.label}: ${fmt(p.unit, before)} → ${fmt(p.unit, after)}${pct !== null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}.` });
      }
    } else if (decision && nowBucket && nowBucket !== decision) {
      since.push({ kind: "ANALYSIS", tone: "diverge", text: `The analysis says “${DECISION_LABEL_F[nowBucket].toLowerCase()}”; you said “${DECISION_LABEL_F[decision].toLowerCase()}”.` });
    }
    // Founder meeting outcome: questions answered after the belief.
    const later = t.answeredQuestions.filter((q) => q.answer && q.answeredAt && q.answeredAt >= a.answeredAt);
    if (later.length) {
      if (a.answer.type === "questions") {
        const mine = a.answer.questions.filter(Boolean);
        const covered = mine.filter((q) => later.some((l) => topicsOf(q).some((tp) => topicsOf(l.question).includes(tp)) || jaccard(contentTokens(q), contentTokens(l.question)) >= 0.25)).length;
        since.push({ kind: "FOUNDER_MEETING", tone: covered ? "agree" : "neutral", text: `The founder meeting answered ${later.length} question${later.length > 1 ? "s" : ""}; ${covered} of your ${mine.length} were on the same topics.` });
      }
      for (const q of later.slice(0, 3))
        since.push({ kind: "FOUNDER_MEETING", tone: q.status === "RESOLVED" ? "agree" : "neutral", text: `${q.id} ${q.status.replace(/_/g, " ").toLowerCase()}: “${q.question.slice(0, 140)}” — ${q.answer!.slice(0, 220)}` });
    }
  }
  return {
    attemptId: a.id,
    at: a.answeredAt,
    caseName: ex.case.name,
    slug: ex.case.slug,
    versionNo: ex.case.versionNo,
    title: ex.title,
    kind: ex.kind,
    belief: answerSummary(a),
    confidence: a.confidence,
    decision,
    analysisAtTime: ex.key.decisionBucket,
    since,
  };
}

export function buildJournal(attempts: AttemptRecord[], timelines: CompanyTimeline[]): JournalEntry[] {
  const byId = new Map(timelines.map((t) => [t.companyId, t]));
  return [...attempts].sort((a, b) => (a.answeredAt < b.answeredAt ? 1 : -1)).map((a) => journalEntry(a, byId.get(a.exercise.case.companyId) ?? null));
}
