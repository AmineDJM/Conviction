/**
 * Hybrid retrieval for the Fund Brain. Each method is a small, fast,
 * independent function; the chat orchestrator runs the ones the plan asks
 * for in parallel and fuses the results.
 *
 *   structured  → metric_facts / companies (numbers, filters, rankings)
 *   packs       → pre-computed Deal Memory Packs
 *   lexical     → SQLite FTS5 (bm25) over chunks
 *   semantic    → cosine over chunk embeddings
 *   graph       → entities / relations (founders, competitors, investors, markets)
 *   fund memory → fund profile, documented knowledge, IC members & observations
 *   history     → version and decision history
 */
import { and, asc, desc, eq, inArray, isNull, like, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { getDefaultFund } from "@/server/repo";
import { metricDef } from "@/engine/metrics/dictionary";
import { fmtMetric, fmtUsd } from "./memory-pack";
import { normName } from "@/server/ids";
import { vectorSearch } from "./vectors";
import type { BrainPlan } from "@/ai/prompts/brain";

const s = schema;

/* ------------------------------ Catalog & entity resolution ------------------------------ */

export interface CatalogEntry {
  id: string;
  slug: string;
  name: string;
  normName: string;
  sector: string | null;
  stage: string | null;
  status: string | null;
  oneLiner: string | null;
}

export function catalog(workspaceId: string): CatalogEntry[] {
  return getDb()
    .select({ id: s.companies.id, slug: s.companies.slug, name: s.companies.name, normName: s.companies.normName, sector: s.companies.sector, stage: s.companies.stage, status: s.companies.decisionStatus, oneLiner: s.companies.oneLiner })
    .from(s.companies)
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)))
    .orderBy(desc(s.companies.updatedAt))
    .all();
}

export function icMembers(workspaceId: string) {
  return getDb().select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all();
}

export interface AliasHit {
  /** The name as it appears in the question. */
  mention: string;
  /** Dossier the mention resolved to. */
  companyId: string;
  name: string;
  relation: "FORMER_NAME" | "ALIAS_OF";
  evidence: string;
}

interface DealEntity {
  id: string;
  companyId: string;
  name: string;
  aliases: string[];
  attributes: Record<string, unknown> | null;
}

function dealEntities(workspaceId: string, live: Set<string>): DealEntity[] {
  return getDb()
    .select({ id: s.entities.id, companyId: s.entities.companyId, name: s.entities.name, aliases: s.entities.aliases, attributes: s.entities.attributes })
    .from(s.entities)
    .where(and(eq(s.entities.workspaceId, workspaceId), eq(s.entities.type, "COMPANY"), like(s.entities.resolutionKey, "company:%")))
    .all()
    .filter((e): e is DealEntity => !!e.companyId && live.has(e.companyId));
}

function aliasRelations(workspaceId: string, types: ("ALIAS_OF" | "POSSIBLY_SAME_AS")[]) {
  return getDb()
    .select({ from: s.relations.fromEntity, to: s.relations.toEntity, type: s.relations.type, note: s.relations.note })
    .from(s.relations)
    .where(and(eq(s.relations.workspaceId, workspaceId), inArray(s.relations.type, types)))
    .all();
}

/**
 * Deterministic pre-resolution: company names (incl. former names and alias-linked
 * dossiers), founder names and IC members mentioned in the question.
 * A renamed company is found by its former name; dossiers linked as ALIAS_OF
 * resolve to the most recently updated one, said explicitly (`aliases`).
 * POSSIBLY_SAME_AS links never resolve a mention.
 */
export function resolveMentions(workspaceId: string, question: string, cat: CatalogEntry[]) {
  const q = normName(question);
  const qWords = question.toLowerCase();
  const companyIds = new Set<string>();
  for (const c of cat) if (c.normName.length >= 3 && q.includes(c.normName)) companyIds.add(c.id);
  const byId = new Map(cat.map((c) => [c.id, c]));
  const aliases: AliasHit[] = [];

  // Former names recorded on the deal-company entity.
  const deals = dealEntities(workspaceId, new Set(byId.keys()));
  for (const e of deals)
    for (const a of e.aliases) {
      const n = normName(a);
      if (n.length < 3 || !q.includes(n)) continue;
      const former = ((e.attributes?.formerNames as { name: string; evidence: string }[] | undefined) ?? []).find((f) => normName(f.name) === n);
      // The alias is also the current name of another dossier: that dossier is kept too (ALIAS_OF below decides).
      companyIds.add(e.companyId);
      if (!aliases.some((x) => x.companyId === e.companyId && normName(x.mention) === n)) aliases.push({ mention: a, companyId: e.companyId, name: byId.get(e.companyId)?.name ?? e.name, relation: "FORMER_NAME", evidence: former?.evidence ?? "recorded former name" });
    }

  // ALIAS_OF groups collapse to the most recently updated dossier (catalog order = updatedAt desc).
  if (companyIds.size) {
    const entityCompany = new Map(deals.map((e) => [e.id, e.companyId]));
    const parent = new Map<string, string>();
    const find = (x: string): string => (parent.get(x) ?? x) === x ? x : find(parent.get(x)!);
    const notes = new Map<string, string>();
    for (const r of aliasRelations(workspaceId, ["ALIAS_OF"])) {
      const a = entityCompany.get(r.from);
      const b = entityCompany.get(r.to);
      if (!a || !b) continue;
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) parent.set(ra, rb);
      notes.set(`${a}|${b}`, r.note ?? "");
      notes.set(`${b}|${a}`, r.note ?? "");
    }
    const rank = new Map(cat.map((c, i) => [c.id, i]));
    for (const id of [...companyIds]) {
      const root = find(id);
      const group = cat.filter((c) => find(c.id) === root).map((c) => c.id);
      if (group.length < 2) continue;
      const rep = [...group].sort((x, y) => (rank.get(x) ?? 1e9) - (rank.get(y) ?? 1e9))[0]!;
      if (rep === id) continue;
      companyIds.delete(id);
      companyIds.add(rep);
      aliases.push({ mention: byId.get(id)?.name ?? id, companyId: rep, name: byId.get(rep)?.name ?? rep, relation: "ALIAS_OF", evidence: notes.get(`${id}|${rep}`) || notes.get(`${rep}|${id}`) || "linked dossiers" });
    }
  }

  // People → companies they founded. Homonyms stay separate entities, each shown with its own company.
  const people = getDb()
    .select({ id: s.entities.id, name: s.entities.name, normName: s.entities.normName })
    .from(s.entities)
    .where(and(eq(s.entities.workspaceId, workspaceId), eq(s.entities.type, "PERSON")))
    .all();
  const personHits = people.filter((p) => {
    const last = p.name.split(/\s+/).pop()!.toLowerCase();
    return (p.normName.length >= 5 && q.includes(p.normName)) || (last.length >= 4 && new RegExp(`\\b${last}\\b`, "i").test(qWords));
  });
  const personLabels: string[] = [];
  if (personHits.length) {
    const rels = getDb()
      .select({ from: s.relations.fromEntity, companyId: s.relations.companyId })
      .from(s.relations)
      .where(and(inArray(s.relations.fromEntity, personHits.map((p) => p.id)), eq(s.relations.type, "FOUNDED")))
      .all();
    for (const r of rels) if (r.companyId && byId.has(r.companyId)) companyIds.add(r.companyId);
    const sameName = new Map<string, number>();
    for (const p of personHits) sameName.set(p.normName, (sameName.get(p.normName) ?? 0) + 1);
    for (const p of personHits) {
      const cos = [...new Set(rels.filter((r) => r.from === p.id && r.companyId).map((r) => byId.get(r.companyId!)?.name).filter(Boolean))];
      const homonym = (sameName.get(p.normName) ?? 0) > 1 ? " — a different person from the other(s) of that name (no shared profile)" : "";
      personLabels.push(cos.length ? `${p.name} (${cos.join(", ")})${homonym}` : p.name);
    }
  }
  const members = icMembers(workspaceId).filter((m) => {
    const last = m.name.split(/\s+/).pop()!.toLowerCase();
    return q.includes(m.normName) || (last.length >= 3 && new RegExp(`\\b${last}\\b`, "i").test(qWords));
  });
  return { companyIds: [...companyIds], people: [...new Set(personLabels)], icMemberIds: members.map((m) => m.id), aliases };
}

/** "Also known as / formerly" for a deal: former names stated about it and dossiers linked to it. */
export function companyAliases(workspaceId: string, companyId: string) {
  const cat = catalog(workspaceId);
  const byId = new Map(cat.map((c) => [c.id, c]));
  const deals = dealEntities(workspaceId, new Set(byId.keys()));
  const self = deals.find((e) => e.companyId === companyId);
  if (!self) return { formerNames: [] as { name: string; evidence: string }[], linked: [] as { companyId: string; slug: string; name: string; type: "ALIAS_OF" | "POSSIBLY_SAME_AS"; reasons: string }[] };
  const formerNames = ((self.attributes?.formerNames as { name: string; evidence: string }[] | undefined) ?? []).slice(0, 5);
  const entityCompany = new Map(deals.map((e) => [e.id, e.companyId]));
  const linked = new Map<string, { companyId: string; slug: string; name: string; type: "ALIAS_OF" | "POSSIBLY_SAME_AS"; reasons: string }>();
  for (const r of aliasRelations(workspaceId, ["ALIAS_OF", "POSSIBLY_SAME_AS"])) {
    const other = r.from === self.id ? entityCompany.get(r.to) : r.to === self.id ? entityCompany.get(r.from) : undefined;
    const c = other ? byId.get(other) : undefined;
    if (!c || c.id === companyId) continue;
    const type = r.type as "ALIAS_OF" | "POSSIBLY_SAME_AS";
    const prev = linked.get(c.id);
    // A strong link from either side wins over a possible one.
    if (!prev || (prev.type === "POSSIBLY_SAME_AS" && type === "ALIAS_OF")) linked.set(c.id, { companyId: c.id, slug: c.slug, name: c.name, type, reasons: r.note ?? "" });
  }
  return { formerNames, linked: [...linked.values()] };
}

export type CompanyAliases = ReturnType<typeof companyAliases>;

/* ------------------------------ Context items ------------------------------ */

export interface ContextItem {
  kind: "PACK" | "TABLE" | "PASSAGE" | "FUND" | "IC" | "GRAPH" | "HISTORY";
  title: string;
  text: string;
  href: string | null;
  label: string | null; // evidence label or provenance
  companyId?: string | null;
}

/* ------------------------------ Structured ------------------------------ */

const OPS = { GT: ">", GTE: ">=", LT: "<", LTE: "<=" } as const;

export function structuredQuery(workspaceId: string, plan: BrainPlan, cat: CatalogEntry[]): ContextItem | null {
  const db = getDb();
  const byId = new Map(cat.map((c) => [c.id, c]));
  const rows: { companyId: string; cells: Record<string, string> }[] = [];
  let title = "";

  if (plan.metricFilters.length) {
    const matched = new Set<string>();
    let first = true;
    const cells = new Map<string, Record<string, string>>();
    for (const f of plan.metricFilters) {
      const hits = db
        .select({ companyId: s.metricFacts.companyId, value: s.metricFacts.value, unit: s.metricFacts.unit, state: s.metricFacts.state, verification: s.metricFacts.verification, sampleSize: s.metricFacts.sampleSize, periodEnd: s.metricFacts.periodEnd })
        .from(s.metricFacts)
        .where(and(eq(s.metricFacts.workspaceId, workspaceId), eq(s.metricFacts.metricKey, f.metricKey), sql`${s.metricFacts.value} ${sql.raw(OPS[f.op])} ${f.value}`))
        .all();
      const set = new Set(hits.map((h) => h.companyId));
      if (first) set.forEach((x) => matched.add(x));
      else for (const x of [...matched]) if (!set.has(x)) matched.delete(x);
      first = false;
      for (const h of hits) {
        const cellMap = cells.get(h.companyId) ?? {};
        cellMap[metricDef(f.metricKey)?.shortName ?? f.metricKey] = `${fmtMetric(h.unit, h.value)} (${h.verification === "VERIFIED" ? "verified" : h.state === "OBSERVED" ? "company-reported" : h.state.toLowerCase()}${h.sampleSize ? `, n=${h.sampleSize}` : ""}${h.periodEnd ? `, ${h.periodEnd}` : ""})`;
        cells.set(h.companyId, cellMap);
      }
    }
    // Companies that have no value for a filtered metric are listed separately as unknown.
    const unknown = cat.filter((c) => !matched.has(c.id) && !db.select({ n: sql<number>`count(*)` }).from(s.metricFacts).where(and(eq(s.metricFacts.companyId, c.id), inArray(s.metricFacts.metricKey, plan.metricFilters.map((f) => f.metricKey)))).get()?.n);
    for (const id of matched) rows.push({ companyId: id, cells: cells.get(id)! });
    title = `Structured query: ${plan.metricFilters.map((f) => `${f.metricKey} ${OPS[f.op]} ${f.value}`).join(" AND ")} — ${rows.length} match(es); ${unknown.length} compan(ies) with no disclosed value: ${unknown.map((u) => u.name).join(", ") || "none"}`;
  }

  if (plan.rank) {
    const r = plan.rank;
    const col = {
      OPERATING_QUALITY: s.companies.oqi,
      POWER_LAW: s.companies.powerLaw,
      BASE_MOIC: s.companies.baseMoic,
      EVIDENCE: s.companies.evidenceIndex,
      FUND_FIT: s.companies.fundFit,
      RISK: s.companies.riskIndex,
      RECENCY: s.companies.updatedAt,
      METRIC: null,
    }[r.field];
    const filters = [eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)];
    const af = plan.attributeFilters;
    if (af.industry) filters.push(sql`${s.companies.sector} like ${"%" + af.industry.toUpperCase().replace(/\s+/g, "_") + "%"}`);
    if (af.stage) filters.push(sql`${s.companies.stage} like ${"%" + af.stage.toUpperCase().replace(/[\s-]+/g, "_") + "%"}`);
    if (af.decisionStatus) filters.push(eq(s.companies.decisionStatus, af.decisionStatus));
    let ranked: { id: string; value: number | string | null }[] = [];
    if (col) {
      ranked = db
        .select({ id: s.companies.id, value: col })
        .from(s.companies)
        .where(and(...filters, sql`${col} is not null`))
        .orderBy(r.direction === "ASC" ? asc(col) : desc(col))
        .limit(Math.min(20, Math.max(1, r.limit)))
        .all();
    } else if (r.metricKey) {
      ranked = db
        .select({ id: s.metricFacts.companyId, value: s.metricFacts.value })
        .from(s.metricFacts)
        .where(and(eq(s.metricFacts.workspaceId, workspaceId), eq(s.metricFacts.metricKey, r.metricKey), sql`${s.metricFacts.value} is not null`))
        .orderBy(r.direction === "ASC" ? asc(s.metricFacts.value) : desc(s.metricFacts.value))
        .limit(Math.min(20, Math.max(1, r.limit)))
        .all();
    }
    // Technology filter uses the canonical classification via memory packs text.
    if (af.technology) {
      const packs = db.select({ id: s.memoryPacks.companyId, text: s.memoryPacks.text }).from(s.memoryPacks).where(eq(s.memoryPacks.workspaceId, workspaceId)).all();
      const ok = new Set(packs.filter((p) => new RegExp(af.technology!, "i").test(p.text.split("\n").slice(0, 5).join(" "))).map((p) => p.id));
      ranked = ranked.filter((x) => ok.has(x.id));
    }
    const full = db.select().from(s.companies).where(inArray(s.companies.id, ranked.map((x) => x.id).concat(["-"]))).all();
    const fullById = new Map(full.map((c) => [c.id, c]));
    for (const x of ranked) {
      const c = fullById.get(x.id);
      if (!c) continue;
      rows.push({
        companyId: x.id,
        cells: {
          Status: c.decisionStatus ?? "n/a",
          "Operating Quality": c.oqi !== null ? `${c.oqi} [${c.oqiLower}–${c.oqiUpper}] cov ${Math.round((c.oqiCoverage ?? 0) * 100)}%` : "n/s",
          "Power-Law": c.powerLaw?.toFixed(0) ?? "n/a",
          "Base gross MOIC": c.baseMoic ? `${c.baseMoic.toFixed(1)}x` : "n/a",
          Evidence: c.evidence ?? "n/a",
          "Peer group": c.peerGroup ?? "n/a",
          ...(r.field === "METRIC" && r.metricKey ? { [metricDef(r.metricKey)?.shortName ?? r.metricKey]: String(x.value) } : {}),
        },
      });
    }
    title = `Ranking by ${r.field}${r.metricKey ? ` (${r.metricKey})` : ""} ${r.direction} — indices are conventional, not probabilities; peer groups may differ`;
  }

  if (!rows.length && !title) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r.cells)))];
  const table = [
    `| Company | ${cols.join(" | ")} |`,
    `|---|${cols.map(() => "---").join("|")}|`,
    ...rows.map((r) => {
      const c = byId.get(r.companyId);
      return `| [${c?.name ?? r.companyId}](/deals/${c?.slug}) | ${cols.map((k) => r.cells[k] ?? "—").join(" | ")} |`;
    }),
  ].join("\n");
  return { kind: "TABLE", title, text: rows.length ? table : "No matching companies.", href: null, label: "STRUCTURED" };
}

/* ------------------------------ Memory packs ------------------------------ */

export function memoryPacks(workspaceId: string, companyIds: string[], maxChars = 7000): ContextItem[] {
  if (!companyIds.length) return [];
  const rows = getDb().select().from(s.memoryPacks).where(and(eq(s.memoryPacks.workspaceId, workspaceId), inArray(s.memoryPacks.companyId, companyIds))).all();
  const order = new Map(companyIds.map((id, i) => [id, i]));
  return rows
    .sort((a, b) => order.get(a.companyId)! - order.get(b.companyId)!)
    .map((r) => {
      const pack = r.pack as { slug: string; name: string };
      return { kind: "PACK" as const, title: `Deal memory — ${pack.name} (version ${r.versionId}, updated ${r.updatedAt.slice(0, 10)})`, text: r.text.slice(0, maxChars), href: `/deals/${pack.slug}`, label: "MEMORY_PACK", companyId: r.companyId };
    });
}

/* ------------------------------ Lexical (FTS5) ------------------------------ */

function ftsQuery(terms: string[]): string | null {
  const toks = terms
    .flatMap((t) => t.split(/\s+/))
    .map((t) => t.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((t) => t.length >= 3)
    .slice(0, 12);
  if (!toks.length) return null;
  return toks.map((t) => `"${t}"`).join(" OR ");
}

export interface Hit {
  id: string;
  score: number;
  companyId?: string | null;
}

export function lexicalSearch(workspaceId: string, terms: string[], opts: { companyIds?: string[]; kinds?: string[]; k?: number }): Hit[] {
  const q = ftsQuery(terms);
  if (!q) return [];
  const client = getDb().$client;
  const params: unknown[] = [q, workspaceId];
  let where = "chunks_fts MATCH ? AND c.workspace_id = ?";
  if (opts.companyIds?.length) {
    where += ` AND c.company_id IN (${opts.companyIds.map(() => "?").join(",")})`;
    params.push(...opts.companyIds);
  }
  if (opts.kinds?.length) {
    where += ` AND c.kind IN (${opts.kinds.map(() => "?").join(",")})`;
    params.push(...opts.kinds);
  }
  params.push(opts.k ?? 12);
  try {
    const rows = client
      .prepare(`SELECT c.id AS id, bm25(chunks_fts) AS score FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid WHERE ${where} ORDER BY score LIMIT ?`)
      .all(...params) as { id: string; score: number }[];
    return rows.map((r) => ({ id: r.id, score: -r.score }));
  } catch {
    return [];
  }
}

/* ------------------------------ Semantic ------------------------------ */

export function semanticSearch(workspaceId: string, vec: Float32Array, opts: { companyIds?: string[]; kinds?: string[]; excludeCompanyIds?: string[]; k?: number; distinctCompanies?: boolean }): Hit[] {
  const raw = vectorSearch(workspaceId, vec, opts.distinctCompanies ? 200 : (opts.k ?? 12), opts);
  if (!opts.distinctCompanies) return raw;
  const seen = new Set<string>();
  const out: Hit[] = [];
  for (const h of raw) {
    const key = h.companyId ?? h.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= (opts.k ?? 6)) break;
  }
  return out;
}

/** Reciprocal rank fusion — robust, parameter-light hybrid ranking. */
export function fuse(lists: Hit[][], k = 60, limit = 10): string[] {
  const score = new Map<string, number>();
  for (const list of lists) list.forEach((h, rank) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + rank + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id]) => id);
}

export function chunkItems(ids: string[]): ContextItem[] {
  if (!ids.length) return [];
  const rows = getDb().select().from(s.chunks).where(inArray(s.chunks.id, ids)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      kind: r.kind === "FUND_KNOWLEDGE" ? ("FUND" as const) : r.kind === "IC_OBSERVATION" || r.kind === "MEETING" ? ("IC" as const) : ("PASSAGE" as const),
      title: r.title,
      text: r.text.slice(0, 1800),
      href: r.href,
      label: r.evidenceLabel,
      companyId: r.companyId,
    }));
}

/* ------------------------------ Graph ------------------------------ */

export function graphContext(workspaceId: string, companyIds: string[], cat: CatalogEntry[]): ContextItem | null {
  if (!companyIds.length) return null;
  const db = getDb();
  const rels = db.select().from(s.relations).where(and(eq(s.relations.workspaceId, workspaceId), inArray(s.relations.companyId, companyIds))).all();
  if (!rels.length) return null;
  const ents = db.select().from(s.entities).where(inArray(s.entities.id, [...new Set(rels.flatMap((r) => [r.fromEntity, r.toEntity]))])).all();
  const name = new Map(ents.map((e) => [e.id, e.name]));
  const byCompany = new Map(cat.map((c) => [c.id, c.name]));
  // Cross-deal links: the same competitor, investor, person or market appearing in other deals.
  const targetIds = [...new Set(rels.map((r) => (r.type === "FOUNDED" || r.type === "INVESTED_IN" || r.type === "CUSTOMER_OF" ? r.fromEntity : r.toEntity)))];
  const cross = db
    .select({ entity: s.relations.fromEntity, to: s.relations.toEntity, companyId: s.relations.companyId, type: s.relations.type })
    .from(s.relations)
    .where(and(eq(s.relations.workspaceId, workspaceId), sql`(${s.relations.fromEntity} in ${targetIds.length ? targetIds : ["-"]} or ${s.relations.toEntity} in ${targetIds.length ? targetIds : ["-"]})`))
    .all()
    .filter((r) => r.companyId && !companyIds.includes(r.companyId));
  const lines = rels.map((r) => `${byCompany.get(r.companyId ?? "") ?? ""}: ${name.get(r.fromEntity)} —${r.type}→ ${name.get(r.toEntity)}${r.note ? ` (${r.note})` : ""}`);
  const crossLines = cross.map((r) => `also linked in ${byCompany.get(r.companyId!) ?? r.companyId}: ${name.get(r.entity) ?? ""} ${r.type} ${name.get(r.to) ?? ""}`);
  return { kind: "GRAPH", title: "Entity graph (founders, competitors, investors, markets, customers)", text: [...lines, ...crossLines].slice(0, 80).join("\n"), href: null, label: "STRUCTURED" };
}

/* ------------------------------ Fund memory ------------------------------ */

export function fundMemory(workspaceId: string, icMemberIds: string[], includeKnowledge: boolean): ContextItem[] {
  const db = getDb();
  const out: ContextItem[] = [];
  const f = getDefaultFund(workspaceId);
  out.push({
    kind: "FUND",
    title: `Fund profile — ${f.name} [DOCUMENTED]`,
    text: `Size ${fmtUsd(f.fundSizeUsd)}, vintage ${f.vintage}. Strategy: ${f.strategy}. Stages: ${f.stages.join(", ")}. Sectors: ${f.sectors.join(", ") || "generalist"}; expertise ${f.sectorExpertise.join(", ")}. Geographies: ${f.geographies.join(", ") || "global"}. Checks ${fmtUsd(f.checkMinUsd)}–${fmtUsd(f.checkMaxUsd)} (default ${fmtUsd(f.initialCheckDefaultUsd)}), ownership target ${f.ownershipTargetPct}%, reserves ${f.reserveRatio}:1, max concentration ${f.maxConcentrationPct}%. Target fund multiple ${f.targetFundMultiple}x; a winning deal should return ${fmtUsd(f.targetDealReturnUsd)}. Excluded: ${[...f.excludedIndustries, ...f.excludedCategories].join(", ") || "none"}. Portfolio: ${f.portfolio.map((p) => p.name).join(", ") || "none recorded"}.`,
    href: "/fund",
    label: "DOCUMENTED",
  });
  if (includeKnowledge) {
    for (const k of db.select().from(s.fundKnowledge).where(eq(s.fundKnowledge.workspaceId, workspaceId)).orderBy(desc(s.fundKnowledge.updatedAt)).limit(12).all())
      out.push({ kind: "FUND", title: `${k.kind.replace("_", " ").toLowerCase()}: ${k.title} [${k.provenance}]`, text: k.body.slice(0, 2000), href: `/fund?tab=knowledge#${k.id}`, label: k.provenance });
  }
  const members = icMemberIds.length ? db.select().from(s.icMembers).where(inArray(s.icMembers.id, icMemberIds)).all() : [];
  for (const m of members) {
    out.push({
      kind: "IC",
      title: `IC member ${m.name} — profile [DOCUMENTED]`,
      text: `${m.name}, ${m.role}. ${m.bio ?? ""} Focus: ${m.focus.join(", ") || "n/a"}. Documented preferences: ${m.documentedPreferences ?? "none documented"}.`,
      href: `/fund?tab=ic#${m.id}`,
      label: "DOCUMENTED",
    });
    const obs = db.select().from(s.icObservations).where(eq(s.icObservations.memberId, m.id)).orderBy(desc(s.icObservations.observedAt)).limit(25).all();
    out.push({
      kind: "IC",
      title: `IC member ${m.name} — ${obs.length} recorded observation(s)`,
      text: obs.length ? obs.map((o) => `${o.observedAt.slice(0, 10)} [${o.provenance}] ${o.kind}: ${o.statement}${o.quote ? ` — "${o.quote}"` : ""}`).join("\n") : "No meeting observations recorded for this member. Do not speculate about their views.",
      href: `/fund?tab=ic#${m.id}`,
      label: obs.length ? "OBSERVED" : "NONE",
    });
  }
  return out;
}

/* ------------------------------ History ------------------------------ */

export function historyContext(workspaceId: string, companyIds: string[], cat: CatalogEntry[]): ContextItem[] {
  const db = getDb();
  const out: ContextItem[] = [];
  const ids = companyIds.length ? companyIds : cat.filter((c) => c.status === "ANALYTICAL_RECOMMEND_PASS" || c.status === "SCREEN_OUT").map((c) => c.id).slice(0, 8);
  for (const id of ids) {
    const c = cat.find((x) => x.id === id);
    const events = db.select().from(s.historyEvents).where(and(eq(s.historyEvents.workspaceId, workspaceId), eq(s.historyEvents.companyId, id))).orderBy(desc(s.historyEvents.createdAt)).limit(20).all();
    const versions = db.select({ no: s.companyVersions.versionNo, reason: s.companyVersions.reason, summary: s.companyVersions.summary, at: s.companyVersions.createdAt }).from(s.companyVersions).where(eq(s.companyVersions.companyId, id)).orderBy(desc(s.companyVersions.versionNo)).limit(10).all();
    const company = db.select({ ic: s.companies.icDecision, exec: s.companies.executionStatus, status: s.companies.decisionStatus }).from(s.companies).where(eq(s.companies.id, id)).get();
    out.push({
      kind: "HISTORY",
      title: `History — ${c?.name ?? id}`,
      text: [
        `Current: recommendation ${company?.status ?? "n/a"}, IC decision ${company?.ic}, execution ${company?.exec}.`,
        ...events.map((e) => `${e.createdAt.slice(0, 10)} ${e.type}: ${e.summary}`),
        ...versions.map((v) => `v${v.no} ${v.at.slice(0, 10)} ${v.reason}: ${v.summary ?? ""}`),
      ].join("\n"),
      href: `/deals/${c?.slug}/history`,
      label: "RECORD",
      companyId: id,
    });
  }
  return out;
}
