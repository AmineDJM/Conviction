/**
 * CLI: analyze a deck end-to-end against the local database.
 *   npm run analyze -- path/to/deck.pdf [FAST_SCREEN|STANDARD|DEEP_DD]
 */
import fs from "node:fs";
import path from "node:path";
import { ensureDevWorkspace } from "./seed-lib";
import { startAnalysis } from "../src/server/analyze";
import * as repo from "../src/server/repo";
import type { AnalysisMode } from "../src/domain/enums";

async function main() {
  const file = process.argv[2];
  const mode = (process.argv[3] ?? "STANDARD") as AnalysisMode;
  if (!file) throw new Error("Usage: npm run analyze -- <file> [mode]");
  const { workspaceId, userId } = ensureDevWorkspace();
  const data = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".pdf" ? "application/pdf" : ext === ".pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/octet-stream";
  const t0 = Date.now();
  const { company, run, promise } = await startAnalysis({ workspaceId, userId, files: [{ filename: path.basename(file), mime, data }], mode });
  console.log(`company ${company.id} run ${run.id}`);
  await promise;
  const r = repo.getRun(workspaceId, run.id)!;
  for (const p of r.progress) console.log(`  ${p.status.padEnd(8)} ${p.label}${p.detail ? ` — ${p.detail}` : ""}`);
  const costs = repo.costRecordsForRun(run.id);
  for (const c of costs) console.log(`  $${c.actualUsd.toFixed(4)}  ${c.step.padEnd(18)} in ${c.inputTokens} out ${c.outputTokens} (reasoning ${c.reasoningTokens}) searches ${c.webSearches} ${c.latencyMs}ms`);
  console.log(`status ${r.status} depth ${r.depth} spent $${r.spentUsd.toFixed(4)} in ${((Date.now() - t0) / 1000).toFixed(0)}s ${r.error ?? ""}`);
  const co = repo.getCompany(workspaceId, company.id)!;
  console.log(`${co.name}: ${co.decisionStatus} OQI ${co.oqi} [${co.oqiLower}-${co.oqiUpper}] evidence ${co.evidence} power-law ${co.powerLaw} base MOIC ${co.baseMoic}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
