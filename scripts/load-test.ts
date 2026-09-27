/**
 * Concurrency load test of the analysis pipeline against the mock model server.
 *
 *   npx tsx scripts/load-test.ts [--n 20] [--latency 300] [--mode STANDARD] [--mock-url http://127.0.0.1:4010/v1] [--db <path>] [--keep] [--verbose]
 *
 *   --db <path>  use (and keep) a specific database file, e.g. to run several load-test
 *                processes against ONE database and exercise cross-process SQLite locking.
 *
 * - Starts scripts/mock-openai.ts in a child process (or uses --mock-url).
 * - Temp DATABASE_PATH / STORAGE_DIR / BACKUP_DIR; creates a workspace.
 * - Launches N analyses concurrently via startAnalysis() with the fictional decks
 *   in evals/fixtures/decks (each upload made byte-distinct so every upload is a
 *   distinct document), takes an online backup mid-run, awaits all runs.
 * - Reports: completed/partial/failed, wall time, per-run latency p50/p95,
 *   SQLite busy / unique-constraint errors, duplicate-row checks, vector-cache
 *   freshness, checkConsistency (0 violations required), and a re-upload
 *   idempotence probe (same bytes twice, sequential and concurrent).
 * Exit code 1 when a hard check fails.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { performance } from "node:perf_hooks";

const argv = process.argv.slice(2);
const arg = (name: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const N = Number(arg("--n") ?? process.env.LOAD_N ?? 20);
const LATENCY = Number(arg("--latency") ?? process.env.MOCK_LATENCY_MS ?? 300);
const MODE = (arg("--mode") ?? "STANDARD") as "FAST_SCREEN" | "STANDARD" | "DEEP_DD";
const VERBOSE = argv.includes("--verbose");
const KEEP = argv.includes("--keep");

const root = path.resolve(import.meta.dirname, "..");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "conviction-load-"));

/* ---- capture logs (pipeline logs JSON lines) to count SQLite errors without flooding the terminal ---- */
const captured: string[] = [];
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
const origWarn = console.warn.bind(console);
const capture =
  (orig: (...a: unknown[]) => void) =>
  (...a: unknown[]) => {
    const line = a.map((x) => (typeof x === "string" ? x : x instanceof Error ? `${x.message}\n${x.stack}` : JSON.stringify(x))).join(" ");
    captured.push(line);
    if (VERBOSE) orig(line);
  };
const out = (s = "") => origLog(s);

async function startMock(): Promise<{ url: string; child: ChildProcess | null; stats: () => Promise<Record<string, number>> }> {
  const given = arg("--mock-url") ?? process.env.MOCK_URL;
  const statsOf = (url: string) => async () => (await (await fetch(`${url}/stats`)).json()) as Record<string, number>;
  if (given) return { url: given.replace(/\/+$/, ""), child: null, stats: statsOf(given.replace(/\/+$/, "")) };
  const child = spawn(process.execPath, ["--import", "tsx", path.join(root, "scripts", "mock-openai.ts")], {
    cwd: root,
    env: { ...process.env, MOCK_PORT: "0", MOCK_LATENCY_MS: String(LATENCY) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mock server did not start")), 20_000);
    child.stdout!.on("data", (d: Buffer) => {
      const m = /listening on (\S+)/.exec(d.toString());
      if (m) {
        clearTimeout(t);
        resolve(m[1]!);
      }
    });
    child.stderr!.on("data", (d: Buffer) => VERBOSE && origErr(`[mock] ${d}`));
    child.on("exit", (code) => reject(new Error(`mock server exited (${code})`)));
  });
  return { url, child, stats: statsOf(url) };
}

function pct(values: number[], p: number) {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
}
const sec = (ms: number) => `${(ms / 1000).toFixed(2)}s`;

function decks(): { filename: string; data: Buffer }[] {
  const dir = path.join(root, "evals", "fixtures", "decks");
  const files = [...fs.readdirSync(dir).map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, "variants")).map((f) => path.join(dir, "variants", f))].filter((f) => f.endsWith(".pdf"));
  if (!files.length) throw new Error(`No PDF decks in ${dir}`);
  return files.map((f) => ({ filename: path.basename(f), data: fs.readFileSync(f) }));
}

async function main() {
  const mock = await startMock();
  process.env.OPENAI_BASE_URL = mock.url;
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY_FOR_LOADTEST ?? "sk-mock";
  process.env.DATABASE_PATH = arg("--db") ? path.resolve(arg("--db")!) : path.join(work, "conviction.db");
  process.env.STORAGE_DIR = path.join(work, "uploads");
  process.env.BACKUP_DIR = path.join(work, "backups");
  process.env.BACKUP_SCHEDULE = "off";

  console.log = capture(origLog);
  console.error = capture(origErr);
  console.warn = capture(origWarn);

  // Import after the environment is set (the model client reads OPENAI_BASE_URL at load).
  const { startAnalysis } = await import("../src/server/analyze");
  const { createWorkspaceWithOwner } = await import("../src/server/auth");
  const { getDb } = await import("../src/db/client");
  const { checkConsistency } = await import("../src/server/consistency");
  const { createBackup } = await import("../src/server/backup");
  const { vectorSearch } = await import("../src/brain/vectors");
  const { mockEmbedding } = await import("./mock-openai");

  const db = getDb();
  const sqlite = db.$client;
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `load-${process.pid}@test.example`, name: "Load", password: "load-test-password", workspaceName: "Load Test Fund" });
  vectorSearch(workspaceId, Float32Array.from(mockEmbedding("warm", 512)), 1); // warm the (empty) vector cache: must be invalidated by writes

  const pool = decks();
  out(`Load test: N=${N} ${MODE} analyses, mock latency ${LATENCY} ms/call, ${pool.length} fictional decks, mock ${mock.url}`);
  out(`Workdir ${work} · database ${process.env.DATABASE_PATH}`);

  type Result = { i: number; filename: string; companyId?: string; runId?: string; ms: number; error?: string };
  const t0 = performance.now();
  let backupReport = "not run";
  const backupTimer = setTimeout(() => {
    const b0 = performance.now();
    createBackup("manual", { detail: "load-test mid-run", upload: false })
      .then((m) => (backupReport = `ok in ${sec(performance.now() - b0)} while ${N} analyses were writing — integrity ${m.integrity}, companies ${m.counts.companies}, chunks ${m.counts.chunks}`))
      .catch((e: Error) => (backupReport = `FAILED: ${e.message}`));
  }, 1500);

  const results: Result[] = await Promise.all(
    Array.from({ length: N }, async (_, i): Promise<Result> => {
      const d = pool[i % pool.length]!;
      // Byte-distinct upload (a PDF comment after %%EOF): same content, distinct document.
      const data = Buffer.concat([d.data, Buffer.from(`\n% load-test upload ${i}\n`)]);
      const s = performance.now();
      try {
        const { company, run, promise } = await startAnalysis({ workspaceId, userId, files: [{ filename: d.filename, mime: "application/pdf", data }], mode: MODE });
        await promise;
        return { i, filename: d.filename, companyId: company.id, runId: run.id, ms: performance.now() - s };
      } catch (e) {
        return { i, filename: d.filename, ms: performance.now() - s, error: (e as Error).message };
      }
    }),
  );
  const wall = performance.now() - t0;
  clearTimeout(backupTimer);
  for (let i = 0; i < 100 && backupReport === "not run"; i++) await new Promise((r) => setTimeout(r, 100));

  /* ---------------- report ---------------- */
  const runIds = results.flatMap((r) => (r.runId ? [r.runId] : []));
  const runs = runIds.length ? (sqlite.prepare(`select id, status, error, progress from analysis_runs where id in (${runIds.map(() => "?").join(",")})`).all(...runIds) as { id: string; status: string; error: string | null; progress: string }[]) : [];
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const startErrors = results.filter((r) => r.error);
  const stepFailures = new Map<string, number>();
  for (const r of runs)
    for (const p of JSON.parse(r.progress) as { step: string; status: string; detail?: string }[])
      if (p.status === "FAILED") stepFailures.set(`${p.step}: ${p.detail ?? ""}`.slice(0, 160), (stepFailures.get(`${p.step}: ${p.detail ?? ""}`.slice(0, 160)) ?? 0) + 1);
  const runErrors = new Map<string, number>();
  for (const r of runs) if (r.error) runErrors.set(r.error.slice(0, 200), (runErrors.get(r.error.slice(0, 200)) ?? 0) + 1);

  const allText = [...captured, ...runs.map((r) => `${r.error ?? ""} ${r.progress}`), ...startErrors.map((r) => r.error!)];
  const busy = allText.filter((l) => /SQLITE_BUSY|database is locked/i.test(l)).length;
  const uniq = allText.filter((l) => /UNIQUE constraint failed|SQLITE_CONSTRAINT/i.test(l));

  const q = <T>(sql: string, ...p: unknown[]) => sqlite.prepare(sql).all(...p) as T[];
  const companyIds = results.flatMap((r) => (r.companyId ? [r.companyId] : []));
  const companiesInWs = (q<{ n: number }>("select count(*) n from companies where workspace_id = ?", workspaceId)[0]!).n;
  const dupCompanyIds = companyIds.length - new Set(companyIds).size;
  const dupSlugs = q<{ slug: string; n: number }>("select slug, count(*) n from companies where workspace_id = ? group by slug having n > 1", workspaceId);
  const dupChunks = q<{ company_id: string; kind: string; ref_id: string; n: number }>("select company_id, kind, ref_id, count(*) n from chunks where workspace_id = ? and company_id is not null group by company_id, kind, ref_id having n > 1", workspaceId);
  const dupFacts = q<{ company_id: string; metric_id: string; n: number }>("select company_id, metric_id, count(*) n from metric_facts where workspace_id = ? group by company_id, metric_id having n > 1", workspaceId);
  const dupEntities = q<{ n: number }>("select count(*) n from (select 1 from entities where workspace_id = ? group by type, norm_name having count(*) > 1)", workspaceId)[0]!.n;
  const dupDocs = q<{ n: number }>("select count(*) n from (select company_id, sha256 from documents where workspace_id = ? group by company_id, sha256 having count(*) > 1)", workspaceId)[0]!.n;
  const dupVersionNos = q<{ n: number }>("select count(*) n from (select company_id, version_no from company_versions group by company_id, version_no having count(*) > 1)")[0]!.n;
  const chunkTotal = q<{ n: number }>("select count(*) n from chunks where workspace_id = ? and embedding is not null", workspaceId)[0]!.n;
  const cacheSeen = vectorSearch(workspaceId, Float32Array.from(mockEmbedding("probe", 512)), 1_000_000).length;
  const consistency = checkConsistency(workspaceId);
  const lat = results.filter((r) => !r.error).map((r) => r.ms);
  const mockStats = await mock.stats().catch(() => ({}) as Record<string, number>);

  /* ---------------- idempotence probe ---------------- */
  const probeDeck = pool[0]!;
  const before = (q<{ n: number }>("select count(*) n from companies where workspace_id = ?", workspaceId)[0]!).n;
  const seqA = await startAnalysis({ workspaceId, userId, files: [{ filename: probeDeck.filename, mime: "application/pdf", data: probeDeck.data }], mode: MODE });
  const seqB = await startAnalysis({ workspaceId, userId, files: [{ filename: probeDeck.filename, mime: "application/pdf", data: probeDeck.data }], mode: MODE });
  await Promise.allSettled([seqA.promise, seqB.promise]);
  const afterSeq = (q<{ n: number }>("select count(*) n from companies where workspace_id = ?", workspaceId)[0]!).n;
  const conc = Buffer.concat([probeDeck.data, Buffer.from("\n% concurrent probe\n")]);
  const [cA, cB] = await Promise.all([0, 1].map(() => startAnalysis({ workspaceId, userId, files: [{ filename: probeDeck.filename, mime: "application/pdf", data: conc }], mode: MODE })));
  await Promise.allSettled([cA!.promise, cB!.promise]);
  const afterConc = (q<{ n: number }>("select count(*) n from companies where workspace_id = ?", workspaceId)[0]!).n;
  const consistencyAfterProbe = checkConsistency(workspaceId);

  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;

  const hardFailures: string[] = [];
  if (busy) hardFailures.push(`${busy} SQLITE_BUSY`);
  if (uniq.length) hardFailures.push(`${uniq.length} unique-constraint errors`);
  if (dupCompanyIds || dupSlugs.length || dupChunks.length || dupFacts.length || dupEntities || dupDocs || dupVersionNos) hardFailures.push("duplicate rows");
  if (consistency.violations.length || consistencyAfterProbe.violations.length) hardFailures.push("consistency violations");
  if (startErrors.length || (byStatus.FAILED ?? 0) > 0) hardFailures.push("failed analyses");
  if (cacheSeen !== chunkTotal) hardFailures.push("stale vector cache");

  out("");
  out("RESULTS");
  out(`  runs            completed ${byStatus.COMPLETED ?? 0} · partial ${byStatus.PARTIAL ?? 0} · failed ${byStatus.FAILED ?? 0} · start errors ${startErrors.length}${Object.keys(byStatus).some((k) => !["COMPLETED", "PARTIAL", "FAILED"].includes(k)) ? ` · other ${JSON.stringify(byStatus)}` : ""}`);
  out(`  wall time       ${sec(wall)} for ${N} concurrent analyses (${(N / (wall / 1000)).toFixed(2)} analyses/s)`);
  out(`  per-run latency p50 ${sec(pct(lat, 50))} · p95 ${sec(pct(lat, 95))} · max ${sec(Math.max(...lat))}`);
  out(`  model calls     ${mockStats.responses ?? "?"} responses (${mockStats.structured ?? "?"} structured), ${mockStats.embeddings ?? "?"} embedding requests / ${mockStats.embeddedInputs ?? "?"} inputs, peak in-flight ${mockStats.peakInFlight ?? "?"}`);
  out(`  SQLite          busy/locked errors ${busy} · unique-constraint errors ${uniq.length}`);
  out(`  duplicates      companies ${dupCompanyIds} (${companiesInWs} companies for ${N} uploads) · slugs ${dupSlugs.length} · chunks ${dupChunks.length} · metric_facts ${dupFacts.length} · entities ${dupEntities} · documents ${dupDocs} · version numbers ${dupVersionNos}`);
  out(`  vector cache    ${cacheSeen} of ${chunkTotal} embedded chunks visible after writes (${cacheSeen === chunkTotal ? "fresh" : "STALE"})`);
  out(`  consistency     ${consistency.violations.length} violations across ${consistency.companiesChecked} companies (${consistency.skippedInFlight.length} in flight)`);
  out(`  online backup   ${backupReport}`);
  out(`  re-upload probe same bytes twice, sequential: ${afterSeq - before === 1 ? "idempotent (1 company)" : `NOT idempotent (${afterSeq - before} companies)`}; concurrent: ${afterConc - afterSeq === 1 ? "idempotent (1 company)" : `NOT idempotent (${afterConc - afterSeq} companies)`}; consistency after probe ${consistencyAfterProbe.violations.length} violations`);
  if (runErrors.size) {
    out("  run errors:");
    for (const [m, n] of runErrors) out(`    ${n}× ${m}`);
  }
  if (stepFailures.size) {
    out("  failed steps:");
    for (const [m, n] of stepFailures) out(`    ${n}× ${m}`);
  }
  if (startErrors.length) for (const r of startErrors.slice(0, 5)) out(`  start error (${r.filename}): ${r.error}`);
  if (uniq.length) for (const l of uniq.slice(0, 3)) out(`  ${l.slice(0, 300)}`);
  for (const v of [...consistency.violations, ...consistencyAfterProbe.violations].slice(0, 10)) out(`  violation ${v.companyName} ${v.kind}: ${v.message}`);
  out(hardFailures.length ? `\nFAIL: ${hardFailures.join(", ")}` : "\nPASS");

  mock.child?.kill();
  db.$client.close();
  if (!KEEP) fs.rmSync(work, { recursive: true, force: true });
  process.exit(hardFailures.length ? 1 : 0);
}

main().catch((e) => {
  console.log = origLog;
  console.error = origErr;
  origErr(e);
  process.exit(1);
});
