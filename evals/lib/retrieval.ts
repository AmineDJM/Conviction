/**
 * Retrieval evaluation — pure parts (relevance labels and aggregation). No I/O.
 * Labels are content-based (company + a pattern the passage must contain), so
 * they survive re-indexing, which renumbers chunk ids.
 */
import { hitAtK, mean, normalizedPrecisionAtK, precisionAtK, recallAtK, reciprocalRank } from "./metrics";

export interface RetrievalQuery {
  id: string;
  question: string;
  /** Company name as stored (several dossiers may share it, e.g. deck variants). */
  company: string;
  /** Case-insensitive regex a relevant chunk's text must match. */
  match: string;
}

export interface ChunkLite {
  id: string;
  companyId: string | null;
  text: string;
}

export function relevantChunkIds(chunks: ChunkLite[], companyIds: ReadonlySet<string>, match: string): Set<string> {
  const re = new RegExp(match, "i");
  return new Set(chunks.filter((c) => c.companyId !== null && companyIds.has(c.companyId) && re.test(c.text.replace(/\s+/g, " "))).map((c) => c.id));
}

export interface QueryResult {
  id: string;
  ranked: string[];
  relevant: Set<string>;
}

export interface RetrievalSummary {
  queries: number;
  /** Queries with no relevant chunk in the index (label or indexing problem — excluded from the means). */
  unanswerable: string[];
  p5: number | null;
  p10: number | null;
  r5: number | null;
  r10: number | null;
  np5: number | null;
  hit1: number | null;
  hit5: number | null;
  hit10: number | null;
  mrr: number | null;
  misses5: string[];
}

export function summarizeRetrieval(rs: QueryResult[]): RetrievalSummary {
  const ok = rs.filter((r) => r.relevant.size > 0);
  const m = (f: (r: QueryResult) => number | null) => mean(ok.map(f));
  return {
    queries: rs.length,
    unanswerable: rs.filter((r) => r.relevant.size === 0).map((r) => r.id),
    p5: m((r) => precisionAtK(r.ranked, r.relevant, 5)),
    p10: m((r) => precisionAtK(r.ranked, r.relevant, 10)),
    r5: m((r) => recallAtK(r.ranked, r.relevant, 5)),
    r10: m((r) => recallAtK(r.ranked, r.relevant, 10)),
    np5: m((r) => normalizedPrecisionAtK(r.ranked, r.relevant, 5)),
    hit1: m((r) => hitAtK(r.ranked, r.relevant, 1)),
    hit5: m((r) => hitAtK(r.ranked, r.relevant, 5)),
    hit10: m((r) => hitAtK(r.ranked, r.relevant, 10)),
    mrr: m((r) => reciprocalRank(r.ranked, r.relevant)),
    misses5: ok.filter((r) => !hitAtK(r.ranked, r.relevant, 5)).map((r) => r.id),
  };
}
