/**
 * DECK LINEAGE (pure, deterministic): which document is deck v1, v2, v3 of a
 * company, and which deck a given analysis read.
 *
 * `documents.deck_version` is set at insert for every deck uploaded since deck
 * versions exist. Companies analysed before that have no explicit v1: their
 * earliest deck-like document (PDF, then PPTX, then image) is resolved as v1 at
 * read time — nothing is rewritten.
 */

export interface LineageDoc {
  id: string;
  filename: string;
  kind: string;
  createdAt: string;
  deckVersion: number | null;
  supersedesDocumentId: string | null;
}

export interface DeckVersionEntry {
  seq: number;
  documentId: string;
  filename: string;
  createdAt: string;
  supersedesDocumentId: string | null;
  /** True for a v1 resolved from a document stored before deck versions existed. */
  inferred: boolean;
}

const DECK_RANK: Record<string, number> = { PDF: 0, PPTX: 0, IMAGE: 1 };
const deckRank = (kind: string) => DECK_RANK[kind] ?? 9;
/**
 * Instant of a stored timestamp. Rows mix ISO strings with offsets ("…T09:00:00+02:00", "…Z") and SQLite
 * "YYYY-MM-DD HH:MM:SS" (UTC): comparing the strings orders them wrongly. Unparseable → +∞ (sorted last).
 */
export function timeOf(s: string): number {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? `${s.replace(" ", "T")}${/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? "" : "Z"}` : s);
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}
const cmpTime = (a: string, b: string) => {
  const ta = timeOf(a);
  const tb = timeOf(b);
  return ta === tb ? a.localeCompare(b) : ta < tb ? -1 : 1;
};
const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) => cmpTime(a.createdAt, b.createdAt) || a.id.localeCompare(b.id);

/** Index of the pitch deck in an upload set: the first PDF or PPTX, else the first image, else the first file. */
export function pickDeckIndex(files: { kind: string }[]): number {
  if (!files.length) return -1;
  let best = 0;
  for (let i = 1; i < files.length; i++) if (deckRank(files[i]!.kind) < deckRank(files[best]!.kind)) best = i;
  return best;
}

export function resolveDeckLineage(docs: LineageDoc[]): DeckVersionEntry[] {
  const explicit = docs.filter((d) => d.deckVersion !== null).sort(byTime);
  const out = new Map<number, DeckVersionEntry>();
  for (const d of explicit) if (!out.has(d.deckVersion!)) out.set(d.deckVersion!, { seq: d.deckVersion!, documentId: d.id, filename: d.filename, createdAt: d.createdAt, supersedesDocumentId: d.supersedesDocumentId, inferred: false });
  if (!out.has(1)) {
    const firstExplicit = explicit[0]?.createdAt ?? null;
    const legacy = docs
      .filter((d) => d.deckVersion === null && (firstExplicit === null || cmpTime(d.createdAt, firstExplicit) <= 0))
      .sort((a, b) => deckRank(a.kind) - deckRank(b.kind) || byTime(a, b));
    const v1 = legacy[0];
    if (v1 && deckRank(v1.kind) < 9) out.set(1, { seq: 1, documentId: v1.id, filename: v1.filename, createdAt: v1.createdAt, supersedesDocumentId: null, inferred: true });
  }
  return [...out.values()].sort((a, b) => a.seq - b.seq);
}

/** The deck an analysis read: the highest deck version among its documents (null when none is a deck). */
export function deckOfDocuments(lineage: DeckVersionEntry[], documentIds: string[]): DeckVersionEntry | null {
  const ids = new Set(documentIds);
  return [...lineage].reverse().find((e) => ids.has(e.documentId)) ?? null;
}

/** The next deck version number for a company. */
export function nextDeckSeq(lineage: DeckVersionEntry[]): number {
  return (lineage.at(-1)?.seq ?? 0) + 1;
}
