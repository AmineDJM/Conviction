/**
 * Quality & Reliability metrics — measured, never asserted.
 *
 * Operational numbers come from the workspace's own runs, chat messages and
 * current versions. Accuracy numbers come from the latest evaluation run on
 * fictional ground-truth decks (evals/results). Anything not measured is
 * reported as null ("not measured yet"), never estimated.
 */
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import type { CanonicalDeal } from "@/domain/canonical";
import { resolveOverrides } from "@/engine/overrides";
import { loadVersion } from "./repo";
import { feedbackReport } from "./question-feedback";

const s = schema;

export interface Stat {
  value: number | null;
  n: number;
  /** What exactly is counted. */
  basis: string;
}

export interface QualityReport {
  generatedAt: string;
  analyses: {
    runs: number;
    byStatus: Record<string, number>;
    failureRate: Stat;
    partialRate: Stat;
    avgCostUsd: Stat;
    p50LatencySec: Stat;
    p95LatencySec: Stat;
    byMode: { mode: string; runs: number; avgCostUsd: number | null; p50LatencySec: number | null }[];
  };
  chat: {
    answers: number;
    p50FirstTokenMs: Stat;
    p95FirstTokenMs: Stat;
    fastPathShare: Stat;
    avgCostUsd: Stat;
  };
  data: {
    companies: number;
    metricVerificationRate: Stat;
    unknownRate: Stat;
    contradictionRate: Stat;
    integrityFindingsPerDeal: Stat;
    humanCorrectionRate: Stat;
    /** Classification / identity / claim overrides in force per deal (not metric corrections). */
    otherOverridesPerDeal: Stat;
    webCitationRetrievedRate: Stat;
    verifiedClaimsWithIndependentSource: Stat;
    securityFlaggedDeals: Stat;
  };
  feedback: {
    usefulQuestionRate: Stat;
    usefulAfterMeetingRate: Stat;
    alreadyKnownRate: Stat;
    meetingAnsweredRate: Stat;
    analysisAnyValue: Stat;
    analysisBetterQuestions: Stat;
    analysisImportantRisks: Stat;
    analysisMissingEvidence: Stat;
    analysisMarketInsight: Stat;
    minutesSavedMedian: Stat;
  };
  evals: {
    file: string | null;
    at: string | null;
    passed: number;
    failed: number;
    warnings: number;
    spentUsd: number | null;
    extractionAccuracy: Stat;
    extractionPerDeck: { deck: string; archetype: string | null; ok: number; total: number }[];
    trapDetection: Stat;
    retrieval: { hit5: Stat; precision5: Stat; recall5: Stat; recall10: Stat; mrr: Stat; unscopedHit10: Stat; chatPathHit5: Stat } | null;
    citationSupport: (Stat & { ci95: { low: number; high: number } | null; judged: Stat; byOrigin: { origin: string; value: number | null; n: number }[] }) | null;
    suites: { suite: string; passed: number; total: number }[];
    failures: { suite: string; check: string; detail: string }[];
  };
}

function pctile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.ceil((p / 100) * a.length) - 1));
  return a[i]!;
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (num: number, den: number, basis: string): Stat => ({ value: den ? num / den : null, n: den, basis });

export function latestEvalFile(dir = path.join(process.cwd(), "evals", "results")): string | null {
  const committed = path.join(process.cwd(), "evals", "latest.json");
  try {
    const files = fs.readdirSync(dir).filter((f) => /^eval-.*\.json$/.test(f)).sort();
    const newest = files.length ? path.join(dir, files[files.length - 1]!) : null;
    // Prefer the newest local full run; fall back to the run committed with the code.
    if (newest && JSON.parse(fs.readFileSync(newest, "utf8")).suites !== undefined && JSON.parse(fs.readFileSync(newest, "utf8")).suites !== "all") return fs.existsSync(committed) ? committed : newest;
    if (newest) return newest;
  } catch {
    /* no local results */
  }
  if (fs.existsSync(committed)) return committed;
  try {
    const files = fs.readdirSync(dir).filter((f) => /^eval-.*\.json$/.test(f)).sort();
    return files.length ? path.join(dir, files[files.length - 1]!) : null;
  } catch {
    return null;
  }
}

type EvalResult = { suite: string; check: string; pass: boolean; detail: string; hard: boolean };

function evalMeasurements(m: any): Pick<QualityReport["evals"], "extractionPerDeck" | "trapDetection" | "retrieval" | "citationSupport"> & { extraction: Stat | null } {
  const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const ex = m?.extraction;
  const it = m?.integrity;
  const rt = m?.retrieval?.modes;
  const cs = m?.citationSupport;
  const retrievalStat = (mode: any, key: string, basis: string): Stat => ({ value: num(mode?.[key]), n: (mode?.queries ?? 0) - (mode?.unanswerable?.length ?? 0), basis });
  return {
    extraction: ex && num(ex.total) ? { value: num(ex.accuracy), n: ex.total, basis: `primary metrics within 1% of ground truth over ${ex.decks} fictional decks` } : null,
    extractionPerDeck: Array.isArray(ex?.perDeck) ? ex.perDeck.map((d: any) => ({ deck: String(d.deck), archetype: d.archetype ?? null, ok: Number(d.ok) || 0, total: Number(d.total) || 0 })) : [],
    trapDetection: { value: it ? num(it.detectionRate) : null, n: it ? Number(it.expected) || 0 : 0, basis: it ? `deliberate deck traps detected by the integrity engine (${it.decks} decks)` : "deliberate deck traps detected by the integrity engine" },
    retrieval: rt?.hybridScoped
      ? {
          hit5: retrievalStat(rt.hybridScoped, "hit5", "labelled questions with a relevant passage in the top 5 (hybrid, company-scoped)"),
          precision5: retrievalStat(rt.hybridScoped, "p5", "share of the top 5 passages that are relevant (hybrid, company-scoped)"),
          recall5: retrievalStat(rt.hybridScoped, "r5", "share of all relevant passages found in the top 5"),
          recall10: retrievalStat(rt.hybridScoped, "r10", "share of all relevant passages found in the top 10"),
          mrr: retrievalStat(rt.hybridScoped, "mrr", "mean reciprocal rank of the first relevant passage"),
          unscopedHit10: retrievalStat(rt.hybridUnscoped, "hit10", "relevant passage in the top 10 when searching the whole fund"),
          chatPathHit5: retrievalStat(rt.chatSingleDeal, "hit5", "single-deal chat path (lexical only) — relevant passage in the top 5"),
        }
      : null,
    citationSupport: cs?.overall
      ? {
          value: num(cs.overall.supportRate),
          n: Number(cs.overall.checkable) || 0,
          basis: "sampled citations whose cited text supports the statement (LLM judge, verbatim excerpt checked by code)",
          ci95: cs.overall.ci95 ?? null,
          judged: { value: num(cs.overall.judgedSupportRate), n: Number(cs.overall.checkable) || 0, basis: "SUPPORTS as judged, before the verbatim-excerpt check" },
          byOrigin: Object.entries(cs.byOrigin ?? {}).map(([origin, v]: [string, any]) => ({ origin, value: num(v?.supportRate), n: Number(v?.checkable) || 0 })),
        }
      : null,
  };
}

/**
 * Human correction counts for one version. The correction path is analyst
 * overrides (engine/overrides.ts); older versions may also carry USER_CORRECTED
 * metric copies. Counted once per corrected metric key:
 *   - only overrides actually in force (resolveOverrides → applied): stale or
 *     unanchored overrides and reverted ones (removed from the list) do not count;
 *   - stacked overrides on the same metric count once;
 *   - denominator = extracted (non-derived) primary observed metrics, the ones a
 *     human can correct; classification / identity / claim overrides are counted
 *     separately (`otherOverrides`) so the rate stays a metric rate (≤ 100%).
 */
export function correctionStats(c: CanonicalDeal): { primary: number; corrected: number; otherOverrides: number; staleOverrides: number } {
  const primary = c.metrics.filter((m) => m.isPrimary && m.state === "OBSERVED" && m.calculationMethod !== "DERIVED");
  const primaryKeys = new Set(primary.map((m) => m.metricKey));
  const keyOf = new Map(c.metrics.map((m) => [m.id, m.metricKey]));
  const corrected = new Set(primary.filter((m) => m.calculationMethod === "USER_CORRECTED").map((m) => m.metricKey));
  let applied: ReturnType<typeof resolveOverrides>["applied"] = [];
  let stale = 0;
  try {
    const r = resolveOverrides(c);
    applied = r.applied;
    stale = r.stale.length;
  } catch {
    /* malformed legacy overrides: counted as none rather than guessed */
  }
  const other = new Set<string>();
  for (const a of applied) {
    const o = a.override;
    if (o.target === "METRIC") {
      const k = keyOf.get(o.ref);
      if (k && primaryKeys.has(k)) corrected.add(k);
    } else other.add(`${o.target}|${o.ref}|${o.field}`);
  }
  return { primary: primaryKeys.size, corrected: corrected.size, otherOverrides: other.size, staleOverrides: stale };
}

export function evalSummary(file: string | null): QualityReport["evals"] {
  const empty: QualityReport["evals"] = {
    file: null,
    at: null,
    passed: 0,
    failed: 0,
    warnings: 0,
    spentUsd: null,
    extractionAccuracy: { value: null, n: 0, basis: "metric accuracy checks on fictional ground-truth decks" },
    extractionPerDeck: [],
    trapDetection: { value: null, n: 0, basis: "deliberate deck traps detected by the integrity engine" },
    retrieval: null,
    citationSupport: null,
    suites: [],
    failures: [],
  };
  if (!file) return empty;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { at: string; spentUsd: number; results: EvalResult[]; measurements?: unknown };
    const m = evalMeasurements(j.measurements);
    const suites = new Map<string, { passed: number; total: number }>();
    for (const r of j.results) {
      const x = suites.get(r.suite) ?? { passed: 0, total: 0 };
      x.total++;
      if (r.pass) x.passed++;
      suites.set(r.suite, x);
    }
    // "12/13 (92%)" details of the per-deck metric accuracy checks.
    let ok = 0;
    let total = 0;
    for (const r of j.results.filter((x) => x.suite === "extraction" && x.check.endsWith("metric accuracy"))) {
      const m = /(\d+)\/(\d+)/.exec(r.detail);
      if (m) {
        ok += Number(m[1]);
        total += Number(m[2]);
      }
    }
    return {
      file: path.basename(file),
      at: j.at,
      passed: j.results.filter((r) => r.pass).length,
      failed: j.results.filter((r) => !r.pass && r.hard).length,
      warnings: j.results.filter((r) => !r.pass && !r.hard).length,
      spentUsd: j.spentUsd ?? null,
      extractionAccuracy: m.extraction ?? rate(ok, total, "primary metrics matching ground truth within 1% on fictional decks"),
      extractionPerDeck: m.extractionPerDeck,
      trapDetection: m.trapDetection,
      retrieval: m.retrieval,
      citationSupport: m.citationSupport,
      suites: [...suites.entries()].map(([suite, v]) => ({ suite, ...v })),
      failures: j.results.filter((r) => !r.pass).map((r) => ({ suite: r.suite, check: r.check, detail: r.detail })),
    };
  } catch {
    return empty;
  }
}

export function qualityReport(workspaceId: string, db: DB = getDb()): QualityReport {
  /* ---------- analyses ---------- */
  const runs = db.select().from(s.analysisRuns).where(and(eq(s.analysisRuns.workspaceId, workspaceId), eq(s.analysisRuns.kind, "DECK"))).all();
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const finished = runs.filter((r) => r.status === "COMPLETED" || r.status === "PARTIAL" || r.status === "FAILED");
  const done = runs.filter((r) => (r.status === "COMPLETED" || r.status === "PARTIAL") && r.finishedAt);
  const secs = (r: (typeof runs)[number]) => (new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime()) / 1000;
  const lat = done.map(secs).filter((x) => Number.isFinite(x) && x >= 0);
  const costs = done.map((r) => r.spentUsd);
  const modes = [...new Set(done.map((r) => r.mode))];

  /* ---------- chat ---------- */
  const answers = db
    .select({ plan: s.chatMessages.plan, firstTokenMs: s.chatMessages.firstTokenMs, costUsd: s.chatMessages.costUsd })
    .from(s.chatMessages)
    .innerJoin(s.chatThreads, eq(s.chatThreads.id, s.chatMessages.threadId))
    .where(and(eq(s.chatThreads.workspaceId, workspaceId), eq(s.chatMessages.role, "assistant")))
    .all();
  const ttft = answers.map((a) => a.firstTokenMs).filter((x): x is number => typeof x === "number");
  const fast = answers.filter((a) => (a.plan as { intent?: string } | null)?.intent === "FAST_FACT").length;

  /* ---------- data quality over current versions ---------- */
  const rows = db
    .select({ v: s.companyVersions })
    .from(s.companies)
    .innerJoin(s.companyVersions, eq(s.companyVersions.id, s.companies.currentVersionId))
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)))
    .all();
  let primary = 0;
  let verified = 0;
  let corrected = 0;
  let correctable = 0;
  let otherOverrides = 0;
  let gaps = 0;
  let openGaps = 0;
  let material = 0;
  let contradicted = 0;
  let findings = 0;
  let web = 0;
  let retrieved = 0;
  let verifiedClaims = 0;
  let verifiedIndependent = 0;
  let flaggedDeals = 0;
  for (const { v } of rows) {
    let c;
    let d;
    try {
      ({ canonical: c, derived: d } = loadVersion(v));
    } catch {
      continue;
    }
    for (const m of c.metrics.filter((x) => x.isPrimary && x.state === "OBSERVED")) {
      primary++;
      if (m.verification === "VERIFIED" || m.verification === "PARTIALLY_VERIFIED") verified++;
    }
    const cs = correctionStats(c);
    correctable += cs.primary;
    corrected += cs.corrected;
    otherOverrides += cs.otherOverrides;
    gaps += c.informationGaps.length;
    openGaps += c.informationGaps.filter((g) => g.status !== "RESOLVED").length;
    for (const cl of c.claims.filter((x) => x.material)) {
      material++;
      if (cl.verification === "CONTRADICTED") contradicted++;
    }
    findings += d.integrity?.findings?.length ?? 0;
    const srcs = new Map(c.sources.map((x) => [x.id, x]));
    for (const src of c.sources.filter((x) => x.kind === "WEB")) {
      web++;
      if (src.citationVerified) retrieved++;
    }
    for (const cl of c.claims.filter((x) => x.verification === "VERIFIED")) {
      verifiedClaims++;
      if (cl.evidence.some((e) => {
        const src = srcs.get(e.sourceId);
        return !!src && src.citationVerified && src.origin !== "COMPANY";
      })) verifiedIndependent++;
    }
    if (c.analysis.securityFlags.length) flaggedDeals++;
  }

  return {
    generatedAt: new Date().toISOString(),
    analyses: {
      runs: runs.length,
      byStatus,
      failureRate: rate(finished.filter((r) => r.status === "FAILED").length, finished.length, "failed ÷ finished deck analyses"),
      partialRate: rate(done.filter((r) => r.status === "PARTIAL").length, done.length, "partial ÷ completed deck analyses"),
      avgCostUsd: { value: mean(costs), n: costs.length, basis: "model + search spend per completed analysis" },
      p50LatencySec: { value: pctile(lat, 50), n: lat.length, basis: "upload → final version, completed analyses" },
      p95LatencySec: { value: pctile(lat, 95), n: lat.length, basis: "upload → final version, completed analyses" },
      byMode: modes.map((mode) => {
        const rs = done.filter((r) => r.mode === mode);
        return { mode, runs: rs.length, avgCostUsd: mean(rs.map((r) => r.spentUsd)), p50LatencySec: pctile(rs.map(secs), 50) };
      }),
    },
    chat: {
      answers: answers.length,
      p50FirstTokenMs: { value: pctile(ttft, 50), n: ttft.length, basis: "question → first answer token" },
      p95FirstTokenMs: { value: pctile(ttft, 95), n: ttft.length, basis: "question → first answer token" },
      fastPathShare: rate(fast, answers.length, "answers served by the deterministic fact path (no model)"),
      avgCostUsd: { value: mean(answers.map((a) => a.costUsd ?? 0)), n: answers.length, basis: "model spend per answer" },
    },
    data: {
      companies: rows.length,
      metricVerificationRate: rate(verified, primary, "primary observed metrics verified or partially verified by an independent source"),
      unknownRate: rate(openGaps, gaps, "information gaps still open ÷ all gaps identified"),
      contradictionRate: rate(contradicted, material, "material claims contradicted by evidence"),
      integrityFindingsPerDeal: { value: rows.length ? findings / rows.length : null, n: rows.length, basis: "deterministic integrity findings per current version" },
      humanCorrectionRate: rate(corrected, correctable, "extracted primary metrics an analyst corrected (overrides in force, counted once per metric) ÷ extracted primary metrics"),
      otherOverridesPerDeal: { value: rows.length ? otherOverrides / rows.length : null, n: rows.length, basis: "classification, identity and claim overrides in force per current version" },
      webCitationRetrievedRate: rate(retrieved, web, "web sources actually returned by the search tool"),
      verifiedClaimsWithIndependentSource: rate(verifiedIndependent, verifiedClaims, "VERIFIED claims backed by a retrieved non-company source"),
      securityFlaggedDeals: rate(flaggedDeals, rows.length, "deals whose materials contained instruction-like text"),
    },
    feedback: feedbackStats(workspaceId, db),
    evals: evalSummary(latestEvalFile()),
  };
}

function feedbackStats(workspaceId: string, db: DB): QualityReport["feedback"] {
  const f = feedbackReport(workspaceId, db);
  const q = f.questions;
  const a = f.analyses;
  const share = (v: number | null, basis: string): Stat => ({ value: v, n: a.n, basis });
  return {
    usefulQuestionRate: { value: q.usefulRate, n: q.n, basis: "founder questions judged useful ÷ questions judged (already known counts as not useful)" },
    usefulAfterMeetingRate: { value: f.questionsAfterMeeting.usefulRate, n: f.questionsAfterMeeting.n, basis: "same, judged after a founder meeting" },
    alreadyKnownRate: { value: q.n ? q.alreadyKnown / q.n : null, n: q.n, basis: "questions whose answer the team already knew" },
    meetingAnsweredRate: { value: f.meetingSignal.answeredRate, n: f.meetingSignal.asked, basis: `open pre-meeting questions the meeting answered (automatic, ${f.meetingSignal.meetings} meeting(s); answered ≠ useful)` },
    analysisAnyValue: share(a.anyValue, "analyses where the reviewer ticked at least one kind of value"),
    analysisBetterQuestions: share(a.betterQuestions, "analyses that surfaced better questions"),
    analysisImportantRisks: share(a.importantRisks, "analyses that surfaced important risks"),
    analysisMissingEvidence: share(a.missingEvidence, "analyses that showed missing evidence"),
    analysisMarketInsight: share(a.marketInsight, "analyses that gave useful market insight"),
    minutesSavedMedian: { value: a.minutesSavedMedian, n: a.minutesSavedN, basis: "preparation minutes saved per analysis, as stated by the reviewer (median)" },
  };
}
