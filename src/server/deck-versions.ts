/**
 * Deck versions of a company (v1 → v2 → v3) and "what changed since the last
 * deck": engine/latent/deck-diff.ts run on the stored analyses of two
 * consecutive decks. Computed on read from immutable versions (deterministic),
 * shared by the overview, History, the Fund Brain memory pack and chat.
 *
 * The comparison uses the RAW canonical objects (what each deck said), not the
 * analyst-overridden view: a restatement is the founder's, an override is ours.
 */
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import type { CanonicalDeal } from "@/domain/canonical";
import { deckDiff, type DeckDiff } from "@/engine/latent/deck-diff";
import { deckOfDocuments, resolveDeckLineage, type DeckVersionEntry } from "@/engine/deck-lineage";
import * as repo from "./repo";

const s = schema;

/**
 * What a deck said: the analysis restricted to claims that originate in the company's documents.
 * Research findings (web sources) and meeting statements (transcripts) are not "what the founder
 * stopped talking about"; metrics, market, customers and round terms are deck extractions already.
 */
export function deckView(c: CanonicalDeal): CanonicalDeal {
  const docSources = new Set(c.sources.filter((x) => x.kind === "DOCUMENT").map((x) => x.id));
  const fromDeck = (cl: CanonicalDeal["claims"][number]) => (cl.evidence.length ? cl.evidence.some((e) => e.effect === "ORIGIN" && docSources.has(e.sourceId)) : cl.origin === "COMPANY");
  return { ...c, claims: c.claims.filter(fromDeck) };
}

export function deckLineage(companyId: string, db: DB = getDb()): DeckVersionEntry[] {
  return resolveDeckLineage(repo.listDocuments(companyId, db));
}

/** Latest DECK_ANALYSIS version (at or before `maxVersionNo`) that read `documentId`. */
export function deckAnalysisRow(companyId: string, documentId: string, maxVersionNo: number, db: DB = getDb()): repo.VersionRow | undefined {
  return db
    .select()
    .from(s.companyVersions)
    .where(
      and(
        eq(s.companyVersions.companyId, companyId),
        eq(s.companyVersions.reason, "DECK_ANALYSIS"),
        lte(s.companyVersions.versionNo, maxVersionNo),
        sql`exists (select 1 from json_each(${s.companyVersions.canonical}, '$.documents') where json_extract(value, '$.id') = ${documentId})`,
      ),
    )
    .orderBy(desc(s.companyVersions.versionNo))
    .get();
}

export interface DeckComparison {
  current: DeckVersionEntry;
  previous: DeckVersionEntry;
  currentVersion: { id: string; versionNo: number } | null;
  previousVersion: { id: string; versionNo: number } | null;
  diff: DeckDiff | null;
  /** Why there is no diff (e.g. the previous deck was never analysed). */
  unavailable: string | null;
}

/**
 * The deck the given version read and, when it is v2 or later, the diff against the
 * previous deck's analysis. Null when the version read no deck or deck v1.
 */
export function deckComparison(companyId: string, version: { id: string; versionNo: number; documentIds: string[] }, db: DB = getDb()): DeckComparison | null {
  const lineage = deckLineage(companyId, db);
  const current = deckOfDocuments(lineage, version.documentIds);
  if (!current || current.seq < 2) return null;
  const previous = [...lineage].reverse().find((e) => e.seq < current.seq);
  if (!previous) return null;
  const curRow = deckAnalysisRow(companyId, current.documentId, version.versionNo, db);
  if (!curRow) return { current, previous, currentVersion: null, previousVersion: null, diff: null, unavailable: `deck v${current.seq} has no completed analysis yet` };
  const prevRow = deckAnalysisRow(companyId, previous.documentId, curRow.versionNo - 1, db);
  const currentVersion = { id: curRow.id, versionNo: curRow.versionNo };
  if (!prevRow) return { current, previous, currentVersion, previousVersion: null, diff: null, unavailable: `deck v${previous.seq} (${previous.filename}) was never analysed` };
  const prev = repo.loadVersion(prevRow);
  const cur = repo.loadVersion(curRow);
  return { current, previous, currentVersion, previousVersion: { id: prevRow.id, versionNo: prevRow.versionNo }, diff: deckDiff(deckView(prev.canonical), deckView(cur.canonical)), unavailable: null };
}

/** Comparison for a stored version id. */
export function deckComparisonForVersion(companyId: string, versionId: string, db: DB = getDb()): DeckComparison | null {
  const v = repo.getVersion(companyId, versionId, db);
  if (!v) return null;
  return deckComparison(companyId, { id: v.row.id, versionNo: v.row.versionNo, documentIds: v.canonical.documents.map((d) => d.id) }, db);
}

/** Number of findings in a diff (restated/updated numbers, removals, market, logos, terms, milestones). */
export function deckChangeCount(d: DeckDiff): number {
  return (
    d.changedNumbers.length +
    d.metricsRemoved.length +
    d.metricsAdded.length +
    d.marketChanges.length +
    d.logosRemoved.length +
    d.logosAdded.length +
    d.logoStatusChanges.length +
    d.termChanges.length +
    d.milestones.filter((m) => m.status !== "NOT_DUE").length
  );
}

/** Compact lines for the Fund Brain (memory pack, chat context). Code-computed; the headlines are the diff's own. */
export function deckChangeLines(c: DeckComparison | null, max = 8): string[] {
  if (!c) return [];
  const head = `Deck v${c.current.seq} (${c.current.filename}) vs deck v${c.previous.seq} (${c.previous.filename})`;
  if (!c.diff) return [`${head}: comparison unavailable — ${c.unavailable}.`];
  const d = c.diff;
  const lines = [`${head}, computed from the two stored analyses (v${c.previousVersion?.versionNo} → v${c.currentVersion?.versionNo}); ${deckChangeCount(d)} change(s).`];
  lines.push(...d.headlines.slice(0, max));
  if (d.headlines.length > max) lines.push(`… ${d.headlines.length - max} more in History.`);
  if (!d.headlines.length) lines.push("No material change between the two decks.");
  return lines;
}
