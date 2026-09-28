/**
 * Rebuild the Fund Brain entity graph with entity resolution (src/brain/entities.ts)
 * for every live company of every workspace — or of one workspace:
 *
 *   npx tsx scripts/reindex-entities.ts [--workspace <id>] [--dry-run]
 *
 * Graph only: no model calls, no embeddings, no new company versions. Rows written
 * before entity resolution (no resolution key) are adopted or pruned once orphaned.
 * The normal index after every new version does the same incrementally; this script
 * brings existing data up to date at once. Two passes, so that renamed-company links
 * see every other company's former names, domain and founders.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../src/db/client";
import { pruneOrphanEntities, writeGraph } from "../src/brain/indexer";
import { applyOverrides } from "../src/engine/overrides";
import * as repo from "../src/server/repo";

const args = process.argv.slice(2);
const only = args.includes("--workspace") ? args[args.indexOf("--workspace") + 1] : null;
const dry = args.includes("--dry-run");
const db = getDb();

const count = (where?: ReturnType<typeof sql>) => db.select({ n: sql<number>`count(*)` }).from(schema.entities).where(where).get()?.n ?? 0;
const before = { entities: count(), legacy: count(sql`resolution_key IS NULL`), relations: db.select({ n: sql<number>`count(*)` }).from(schema.relations).get()?.n ?? 0 };

const workspaces = db.select({ id: schema.workspaces.id }).from(schema.workspaces).all().filter((w) => !only || w.id === only);
let companies = 0;
let failed = 0;
for (const w of workspaces) {
  const rows = db.select().from(schema.companies).where(and(eq(schema.companies.workspaceId, w.id), isNull(schema.companies.deletedAt))).all();
  if (dry) {
    companies += rows.length;
    continue;
  }
  for (let pass = 1; pass <= 2; pass++)
    for (const company of rows) {
      const v = repo.getCurrentVersion(company, db);
      if (!v) continue;
      try {
        writeGraph(w.id, company.id, applyOverrides(v.canonical), db);
        if (pass === 1) companies++;
      } catch (e) {
        if (pass === 1) failed++;
        console.error(`  ${company.name} (${company.id}): ${(e as Error).message}`);
      }
    }
  pruneOrphanEntities(db, w.id);
}

const after = { entities: count(), legacy: count(sql`resolution_key IS NULL`), relations: db.select({ n: sql<number>`count(*)` }).from(schema.relations).get()?.n ?? 0 };
const byType = db.select({ type: schema.relations.type, n: sql<number>`count(*)` }).from(schema.relations).groupBy(schema.relations.type).all();
const ambiguous = db.select({ n: sql<number>`count(*)` }).from(schema.entities).where(sql`resolution_key LIKE 'org:ambiguous:%'`).get()?.n ?? 0;
console.log(
  JSON.stringify(
    { dryRun: dry, workspaces: workspaces.length, companies, failed, before, after, ambiguousEmployers: ambiguous, relationsByType: Object.fromEntries(byType.map((r) => [r.type, r.n])) },
    null,
    2,
  ),
);
