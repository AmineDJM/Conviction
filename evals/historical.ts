/**
 * HISTORICAL EVALUATION HARNESS (§127).
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx evals/historical.ts <folder> [--budget 1.00] [--out <dir>] [--no-probe] [--fast-screen-cap 0.25]
 *
 *   --fast-screen-cap  explicit eval-only FAST_SCREEN cap (the product cap currently refuses uncached decks,
 *                      see docs/EVALUATION.md); recorded in the report
 *
 * <folder> contains dated decks (PDF) and `outcomes.csv`:
 *   company,deck_date,outcome,outcome_date,source[,deck_file][,famous]
 *   - deck_date   YYYY-MM or YYYY-MM-DD — the analysis is computed AS OF this date
 *   - outcome     RAISED_UP_ROUND | ACQUIRED_GOOD | IPO | ALIVE_FLAT | BRIDGE | ACQUIHIRE |
 *                 SHUT_DOWN | DOWN_ROUND | ACQUIRED_DISTRESSED (or free text, classified by keywords; else UNKNOWN)
 *   - source      where the outcome comes from (URL, filing, press) — required
 *   - deck_file   optional; otherwise the PDF whose name contains the company slug
 *   - famous      optional yes/no — your own hindsight-contamination judgement
 *
 * For each row: FAST_SCREEN analysis in a separate database (data/evals-historical.db;
 * no web research, so nothing after the deck date is fetched), re-anchored to the deck
 * date (metric staleness and the engine's reference date), prediction recorded
 * (recommendation → stance, OQI, power-law, base MOIC), a recognition probe asks the
 * model whether it knows the company and its fate (hindsight contamination, measured),
 * then calibration of stance vs outcome with and without contaminated rows.
 * Writes <out>/historical-<timestamp>.json and .md (default <folder>/results).
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

process.env.DATABASE_PATH ??= path.join(process.cwd(), "data", "evals-historical.db");
process.env.STORAGE_DIR ??= path.join(process.cwd(), "data", "evals-historical-uploads");

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!dir) {
  console.error("Usage: npx tsx evals/historical.ts <folder with decks + outcomes.csv> [--budget 1.00] [--out <dir>] [--no-probe]");
  process.exit(2);
}
const BUDGET = Number(flag("budget") ?? 1);
const OUT = path.resolve(flag("out") ?? path.join(dir, "results"));
const PROBE = !args.includes("--no-probe");
const CAP = flag("fast-screen-cap") ? Number(flag("fast-screen-cap")) : null;

const ProbeOutput = z.object({
  recognizes: z.boolean().describe("true only if you have specific knowledge of THIS company (not just the words in its name)"),
  whatYouKnow: z.string().describe("One sentence; empty if you do not recognise it"),
  statedOutcome: z.string().nullable().describe("What happened to the company after the given date, if you know; else null"),
});

const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

async function main() {
  const H = await import("./lib/historical");
  const { ensureDevWorkspace } = await import("../scripts/seed-lib");
  const { startAnalysis } = await import("../src/server/analyze");
  const repo = await import("../src/server/repo");
  const { derive } = await import("../src/engine/derive");
  const { getRegistry } = await import("../src/engine/benchmarks");
  const { structured } = await import("../src/ai/openai");
  const { CostController, MODE_BUDGETS } = await import("../src/ai/cost");
  if (CAP !== null) (MODE_BUDGETS.FAST_SCREEN as { hardCapUsd: number }).hardCapUsd = CAP;

  const csvPath = path.join(dir!, "outcomes.csv");
  if (!fs.existsSync(csvPath)) throw new Error(`${csvPath} not found`);
  const { rows, errors } = H.parseOutcomes(fs.readFileSync(csvPath, "utf8"));
  for (const e of errors) console.log(`CSV  ${e}`);
  const pdfs = fs.readdirSync(dir!, { recursive: true }).map(String).filter((f) => f.toLowerCase().endsWith(".pdf") && !f.startsWith("results"));
  const { workspaceId, userId } = ensureDevWorkspace();
  const fund = repo.getDefaultFund(workspaceId);
  let spent = 0;
  const probeCost = new CostController(0.05, 0.05);

  type Row = {
    company: string;
    deckDate: string;
    deckFile: string | null;
    outcome: string;
    outcomeClass: ReturnType<typeof H.outcomeClass>;
    outcomeDate: string | null;
    source: string;
    status: "ANALYSED" | "SKIPPED";
    skipReason?: string;
    recommendation?: string;
    stance?: ReturnType<typeof H.stanceOf>;
    recommendationNowVsAsOf?: string;
    oqi?: number | null;
    powerLaw?: number | null;
    baseMoic?: number | null;
    staleMetricsAtAsOf?: number;
    runCostUsd?: number;
    probe?: { recognizes: boolean; whatYouKnow: string; statedOutcome: string | null } | null;
    contaminated?: boolean;
    contaminationReasons?: string[];
  };
  const out: Row[] = [];

  for (const r of rows) {
    const base: Row = { company: r.company, deckDate: r.deckDate, deckFile: null, outcome: r.outcome, outcomeClass: H.outcomeClass(r.outcome), outcomeDate: r.outcomeDate, source: r.source, status: "SKIPPED" };
    if (!r.source) {
      out.push({ ...base, skipReason: "outcome has no source (required)" });
      continue;
    }
    const file = r.deckFile ? pdfs.find((f) => f === r.deckFile || path.basename(f) === r.deckFile) : pdfs.find((f) => slug(path.basename(f)).includes(slug(r.company)));
    if (!file) {
      out.push({ ...base, skipReason: `no deck found (${r.deckFile ?? `PDF name containing "${slug(r.company)}"`})` });
      continue;
    }
    base.deckFile = file;
    if (spent + MODE_BUDGETS.FAST_SCREEN.hardCapUsd > BUDGET) {
      out.push({ ...base, skipReason: `budget $${BUDGET} would be exceeded` });
      continue;
    }
    const asOf = H.asOfDate(r.deckDate);
    const { company, run, promise } = await startAnalysis({ workspaceId, userId, mode: "FAST_SCREEN", files: [{ filename: path.basename(file), mime: "application/pdf", data: fs.readFileSync(path.join(dir!, file)) }] });
    await promise;
    const runRow = repo.getRun(workspaceId, run.id)!;
    spent += runRow.spentUsd;
    const v = repo.getCurrentVersion(repo.getCompany(workspaceId, company.id)!);
    if (runRow.status === "FAILED" || !v) {
      out.push({ ...base, skipReason: `analysis failed: ${runRow.error ?? "no version"}` });
      continue;
    }
    // As of the deck date: re-normalise metrics and set the engine's reference date.
    const anchored = H.reanchorAsOf(v.canonical, asOf);
    const d = derive(anchored, getRegistry(v.row.registryId), fund, { now: asOf });
    const row: Row = {
      ...base,
      status: "ANALYSED",
      recommendation: d.recommendation.status,
      stance: H.stanceOf(d.recommendation.status),
      recommendationNowVsAsOf: v.derived.recommendation.status === d.recommendation.status ? "same" : `${v.derived.recommendation.status} when computed today`,
      oqi: d.operatingQuality.value,
      powerLaw: d.powerLaw?.value ?? null,
      baseMoic: d.returns.scenarios.find((x) => x.scenario === "BASE")?.grossMoic ?? null,
      staleMetricsAtAsOf: anchored.metrics.filter((m) => m.isPrimary && m.state === "STALE").length,
      runCostUsd: runRow.spentUsd,
      probe: null,
    };
    if (PROBE) {
      try {
        const p = await structured({
          step: "EVAL_HINDSIGHT_PROBE",
          promptVersion: "hindsight-probe-1",
          instructions:
            "You are checking for hindsight contamination in a historical evaluation. Answer only from your own knowledge (no tools). Say recognizes=false unless you have specific knowledge of this exact company; never infer from the name.",
          input: [{ role: "user", content: `Company: ${v.canonical.identity.name} (${r.company}). Deck dated ${r.deckDate}. One-liner: ${v.canonical.identity.oneLiner}. Do you know this company, and what happened to it after ${r.deckDate}?` }],
          schema: ProbeOutput,
          schemaName: "hindsight_probe",
          maxOutputTokens: 300,
          effort: "none",
          cost: probeCost,
          maxAttempts: 1,
        });
        row.probe = p.data;
      } catch (e) {
        console.log(`probe failed for ${r.company}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    const c = H.contamination(r, row.probe ? { recognizes: row.probe.recognizes, statedOutcome: row.probe.statedOutcome } : null);
    row.contaminated = c.contaminated;
    row.contaminationReasons = c.reasons;
    out.push(row);
    console.log(`${r.company} (${r.deckDate}) → ${row.recommendation} [${row.stance}] OQI ${row.oqi ?? "n/s"} · outcome ${r.outcome} (${row.outcomeClass})${row.contaminated ? " · HINDSIGHT-CONTAMINATED" : ""}`);
  }
  spent += probeCost.spentUsd;

  const analysed = out.filter((r) => r.status === "ANALYSED");
  const preds = analysed.map((r) => ({ company: r.company, outcome: r.outcomeClass, stance: r.stance!, oqi: r.oqi ?? null, contaminated: !!r.contaminated }));
  const calibration = { all: H.calibrate(preds), uncontaminated: H.calibrate(preds.filter((p) => !p.contaminated)) };
  const report = {
    at: new Date().toISOString(),
    folder: path.resolve(dir!),
    mode: "FAST_SCREEN (no web research)",
    asOf: "metrics re-normalised and engine reference date set to each deck date; claim freshness labels are from extraction time",
    probe: PROBE,
    fastScreenCapOverrideUsd: CAP,
    spentUsd: spent,
    csvErrors: errors,
    rows: out,
    calibration,
    caveats: [
      "Hindsight contamination: the model may know famous companies' outcomes. Contaminated rows are flagged and calibration is also reported without them.",
      "A later valuation or round is not proof of investment quality; outcomes are coarse classes.",
      "Small samples: descriptive only (see calibration.warning).",
    ],
  };
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonFile = path.join(OUT, `historical-${stamp}.json`);
  fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2) + "\n");
  const pctx = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const md = [
    `# Historical evaluation — ${report.at.slice(0, 10)}`,
    "",
    `Folder \`${report.folder}\` · ${analysed.length}/${out.length} analysed · spend $${spent.toFixed(3)} · ${report.mode}.`,
    "",
    "| Company | Deck date | Recommendation (as of) | Stance | OQI | Outcome | Class | Contaminated |",
    "|---|---|---|---|---|---|---|---|",
    ...out.map((r) =>
      r.status === "ANALYSED"
        ? `| ${r.company} | ${r.deckDate} | ${r.recommendation} | ${r.stance} | ${r.oqi ?? "n/s"} | ${r.outcome}${r.outcomeDate ? ` (${r.outcomeDate})` : ""} | ${r.outcomeClass} | ${r.contaminated ? `yes — ${r.contaminationReasons!.join("; ")}` : "no"} |`
        : `| ${r.company} | ${r.deckDate} | skipped: ${r.skipReason} | | | ${r.outcome} | ${r.outcomeClass} | |`,
    ),
    "",
    "## Calibration",
    "",
    ...(["all", "uncontaminated"] as const).flatMap((k) => {
      const c = calibration[k];
      return [
        `**${k}** (n = ${c.n})${c.warning ? ` — ${c.warning}` : ""}`,
        "",
        `- P(positive outcome | stance): ADVANCE ${pctx(c.positiveRateByStance.ADVANCE)} · DILIGENCE ${pctx(c.positiveRateByStance.DILIGENCE)} · PASS ${pctx(c.positiveRateByStance.PASS)} (base rate ${pctx(c.baseRatePositive)})`,
        `- P(ADVANCE | outcome): positive ${pctx(c.advanceRateByOutcome.POSITIVE)} · neutral ${pctx(c.advanceRateByOutcome.NEUTRAL)} · negative ${pctx(c.advanceRateByOutcome.NEGATIVE)}`,
        `- Mean OQI: positive ${c.oqiByOutcome.POSITIVE?.toFixed(1) ?? "—"} · neutral ${c.oqiByOutcome.NEUTRAL?.toFixed(1) ?? "—"} · negative ${c.oqiByOutcome.NEGATIVE?.toFixed(1) ?? "—"} · AUC(OQI, positive vs negative) ${c.oqiAuc?.toFixed(2) ?? "—"}`,
        "",
      ];
    }),
    "## Caveats",
    "",
    ...report.caveats.map((c) => `- ${c}`),
    "",
  ].join("\n");
  fs.writeFileSync(jsonFile.replace(/\.json$/, ".md"), md);
  console.log(`\nwrote ${jsonFile} (+ .md) · spend $${spent.toFixed(3)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
