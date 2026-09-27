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
import { loadVersion } from "./repo";

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
    webCitationRetrievedRate: Stat;
    verifiedClaimsWithIndependentSource: Stat;
    securityFlaggedDeals: Stat;
  };
  evals: {
    file: string | null;
    at: string | null;
    passed: number;
    failed: number;
    warnings: number;
    spentUsd: number | null;
    extractionAccuracy: Stat;
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

export function evalSummary(file: string | null): QualityReport["evals"] {
  const empty: QualityReport["evals"] = { file: null, at: null, passed: 0, failed: 0, warnings: 0, spentUsd: null, extractionAccuracy: { value: null, n: 0, basis: "metric accuracy checks on fictional ground-truth decks" }, suites: [], failures: [] };
  if (!file) return empty;
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as { at: string; spentUsd: number; results: EvalResult[] };
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
      extractionAccuracy: rate(ok, total, "primary metrics matching ground truth within 1% on fictional decks"),
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
      if (m.calculationMethod === "USER_CORRECTED") corrected++;
    }
    corrected += c.overrides?.length ?? 0;
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
      humanCorrectionRate: rate(corrected, primary, "analyst corrections/overrides ÷ primary metrics"),
      webCitationRetrievedRate: rate(retrieved, web, "web sources actually returned by the search tool"),
      verifiedClaimsWithIndependentSource: rate(verifiedIndependent, verifiedClaims, "VERIFIED claims backed by a retrieved non-company source"),
      securityFlaggedDeals: rate(flaggedDeals, rows.length, "deals whose materials contained instruction-like text"),
    },
    evals: evalSummary(latestEvalFile()),
  };
}
