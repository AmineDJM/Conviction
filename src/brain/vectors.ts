/**
 * In-process vector index over chunk embeddings (exact cosine, float32).
 * Loaded lazily per workspace and invalidated on writes. Exact search over
 * ~50k × 512-d vectors takes a few milliseconds; swap for sqlite-vec or
 * pgvector when the corpus outgrows memory.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";

interface Entry {
  id: string;
  companyId: string | null;
  kind: string;
  vec: Float32Array;
}

const cache = new Map<string, { entries: Entry[]; dirty: boolean; signature: string }>();

/** Cheap change detector so writes from another process (CLI, second instance) are seen too. */
function signatureOf(workspaceId: string) {
  const r = getDb()
    .select({ n: sql<number>`count(*)`, m: sql<number>`coalesce(max(rowid), 0)` })
    .from(schema.chunks)
    .where(eq(schema.chunks.workspaceId, workspaceId))
    .get();
  return `${r?.n ?? 0}:${r?.m ?? 0}`;
}

export function invalidateVectors(workspaceId: string) {
  const c = cache.get(workspaceId);
  if (c) c.dirty = true;
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n;
  return out;
}

function load(workspaceId: string): Entry[] {
  const c = cache.get(workspaceId);
  const signature = signatureOf(workspaceId);
  if (c && !c.dirty && c.signature === signature) return c.entries;
  const rows = getDb()
    .select({ id: schema.chunks.id, companyId: schema.chunks.companyId, kind: schema.chunks.kind, embedding: schema.chunks.embedding })
    .from(schema.chunks)
    .where(and(eq(schema.chunks.workspaceId, workspaceId), isNotNull(schema.chunks.embedding)))
    .all();
  const entries = rows.map((r) => ({ id: r.id, companyId: r.companyId, kind: r.kind, vec: normalize(fromBlob(r.embedding as Buffer)) }));
  cache.set(workspaceId, { entries, dirty: false, signature });
  return entries;
}

export function vectorSearch(
  workspaceId: string,
  query: Float32Array,
  k: number,
  filter?: { companyIds?: string[]; kinds?: string[]; excludeCompanyIds?: string[] },
): { id: string; score: number; companyId: string | null }[] {
  const q = normalize(query);
  const entries = load(workspaceId);
  const companies = filter?.companyIds?.length ? new Set(filter.companyIds) : null;
  const excluded = filter?.excludeCompanyIds?.length ? new Set(filter.excludeCompanyIds) : null;
  const kinds = filter?.kinds?.length ? new Set(filter.kinds) : null;
  const scored: { id: string; score: number; companyId: string | null }[] = [];
  for (const e of entries) {
    if (companies && (!e.companyId || !companies.has(e.companyId))) continue;
    if (excluded && e.companyId && excluded.has(e.companyId)) continue;
    if (kinds && !kinds.has(e.kind)) continue;
    if (e.vec.length !== q.length) continue;
    let dot = 0;
    for (let i = 0; i < q.length; i++) dot += q[i]! * e.vec[i]!;
    scored.push({ id: e.id, score: dot, companyId: e.companyId });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
