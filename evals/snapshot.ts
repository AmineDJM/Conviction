/**
 * §128 Prospective evaluation: record what the system believed at time T so
 * it can be compared with real outcomes at 6 / 12 / 24 months (new round,
 * revenue progress, shutdown, acquisition). Later valuation alone is not proof
 * of investment quality — record outcomes with their evidence.
 *
 *   npx tsx evals/snapshot.ts            → evals/results/snapshot-<date>.json
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "../src/db/client";
import { isNull } from "drizzle-orm";

const rows = getDb().select().from(schema.companies).where(isNull(schema.companies.deletedAt)).all();
const snapshot = {
  takenAt: new Date().toISOString(),
  note: "Hindsight-free record. Fill `outcome` fields later: {date, event: NEW_ROUND|SHUTDOWN|ACQUIRED|REVENUE_UPDATE, detail, source}.",
  companies: rows.map((c) => ({
    companyId: c.id,
    name: c.name,
    versionId: c.currentVersionId,
    recommendation: c.decisionStatus,
    icDecision: c.icDecision,
    operatingQuality: { value: c.oqi, lower: c.oqiLower, upper: c.oqiUpper, coverage: c.oqiCoverage },
    evidence: c.evidence,
    powerLaw: c.powerLaw,
    baseMoic: c.baseMoic,
    stage: c.stage,
    outcome: [] as unknown[],
  })),
};
const out = path.join(process.cwd(), "evals", "results");
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `snapshot-${snapshot.takenAt.slice(0, 10)}.json`);
fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
console.log(`wrote ${file} (${snapshot.companies.length} companies)`);
