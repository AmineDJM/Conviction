/**
 * VUVP Brain — documented knowledge from the fund's own documents and
 * inferred patterns from its own record.
 *
 *   DOCUMENTED  what a fund document states, with a verbatim quote that code
 *               has found in the document (quotes not found are dropped).
 *   INFERRED    deterministic associations over recorded IC observations and
 *               decisions, with counts and thresholds (src/brain/patterns.ts).
 *   OBSERVED    what members said in recorded meetings (fund-memory.ts).
 */
import { and, eq, isNull, like } from "drizzle-orm";
import { getDb, schema, type DB } from "@/db/client";
import { CostController } from "@/ai/cost";
import { structured } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { FUND_DOCUMENT, FundDocumentOutput, fundDocumentInstructions } from "@/ai/prompts/fund-document";
import { extractDocument, renderPagesForModel } from "@/ingestion/extract";
import { computePatterns, dealTraits, PATTERN_VERSION, type FundPattern } from "@/brain/patterns";
import { indexFundMemory } from "@/brain/indexer";
import { storeFile } from "./storage";
import { newId, nowIso } from "./ids";
import { audit, getDefaultFund, loadVersion, recordCost } from "./repo";
import { logger } from "@/lib/log";

const s = schema;
const IMPORT_BUDGET_USD = 0.04;

/** Whitespace/quote/case-insensitive containment — the quote must really be in the document. */
export function quoteFound(quote: string, docText: string): boolean {
  const norm = (x: string) =>
    x
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[’‘`´]/g, "'")
      .replace(/[“”«»]/g, '"')
      .replace(/[‐-―]/g, "-")
      .replace(/\s+/g, " ")
      .replace(/^["' ]+|["' .]+$/g, "")
      .trim();
  const q = norm(quote);
  return q.length >= 12 && norm(docText).includes(q);
}

export interface ImportResult {
  documentSha: string;
  added: number;
  droppedUnverified: { title: string; quote: string }[];
  profileSuggestions: { field: string; value: string; quote: string }[];
  costUsd: number;
}

export async function importFundDocument(workspaceId: string, userId: string, file: { filename: string; mime: string; data: Buffer }, db: DB = getDb()): Promise<ImportResult> {
  const doc = await extractDocument(file.filename, file.mime, file.data);
  if (doc.kind === "OTHER" || doc.kind === "IMAGE") throw new Error("Upload a PDF, PPTX or text document");
  const text = doc.pages.map((p) => p.text).join("\n");
  if (text.trim().length < 200) throw new Error("The document has no readable text layer");
  await storeFile(workspaceId, doc.sha256, doc.filename, file.data);

  const fund = getDefaultFund(workspaceId, db);
  const members = db.select().from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all();
  const cost = new CostController(IMPORT_BUDGET_USD, IMPORT_BUDGET_USD, (e) => recordCost(workspaceId, null, "ANALYSIS", e, db));
  const res = await structured({
    step: "FUND_DOCUMENT",
    promptVersion: FUND_DOCUMENT.version,
    instructions: fundDocumentInstructions(fund.name, members.map((m) => m.name)),
    input: [{ role: "user", content: wrapUntrusted("fund document", renderPagesForModel([{ filename: doc.filename, pages: doc.pages }], 60_000)) }],
    schema: FundDocumentOutput,
    schemaName: "fund_document",
    maxOutputTokens: 6000,
    effort: "low",
    cost,
    cache: true,
  });

  const ref = `doc:${doc.sha256.slice(0, 16)}`;
  const kept = res.data.items.filter((it) => quoteFound(it.quote, text));
  const dropped = res.data.items.filter((it) => !quoteFound(it.quote, text)).map((it) => ({ title: it.title, quote: it.quote }));
  db.transaction((tx) => {
    // Re-importing the same document replaces its items (idempotent).
    tx.delete(s.fundKnowledge).where(and(eq(s.fundKnowledge.workspaceId, workspaceId), like(s.fundKnowledge.sourceRef, `${ref}%`))).run();
    for (const it of kept) {
      tx.insert(s.fundKnowledge)
        .values({
          id: newId("fk"),
          workspaceId,
          kind: it.kind,
          title: it.member ? `${it.member} — ${it.title}` : it.title,
          body: `${it.body}\n\n“${it.quote}” — ${doc.filename}${it.page ? `, p. ${it.page}` : ""}`,
          provenance: "DOCUMENTED",
          sourceRef: `${ref}:${doc.filename}${it.page ? `:p${it.page}` : ""}`,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .run();
    }
  });
  // Documented member preferences are appended to the member profile (never replacing what is there).
  for (const it of kept.filter((x) => x.kind === "IC_PREFERENCE" && x.member)) {
    const m = members.find((mm) => mm.name.toLowerCase() === it.member!.toLowerCase());
    if (!m) continue;
    const line = `${it.body} (${doc.filename}${it.page ? ` p. ${it.page}` : ""})`;
    if ((m.documentedPreferences ?? "").includes(line)) continue;
    db.update(s.icMembers)
      .set({ documentedPreferences: [m.documentedPreferences, line].filter(Boolean).join("\n") })
      .where(eq(s.icMembers.id, m.id))
      .run();
  }
  audit(workspaceId, userId, "FUND_DOCUMENT_IMPORTED", ref, `${doc.filename}: ${kept.length} items, ${dropped.length} unverified dropped`, db);
  indexFundMemory(workspaceId, db).catch((e) => logger.warn({ err: (e as Error).message }, "fund memory reindex failed"));
  return {
    documentSha: doc.sha256,
    added: kept.length,
    droppedUnverified: dropped,
    profileSuggestions: res.data.profileSuggestions.filter((p) => quoteFound(p.quote, text)),
    costUsd: cost.spentUsd,
  };
}

/** Recompute INFERRED patterns from the record and replace the previous set. */
export function refreshPatterns(workspaceId: string, db: DB = getDb()): FundPattern[] {
  const members = db.select({ id: s.icMembers.id, name: s.icMembers.name }).from(s.icMembers).where(eq(s.icMembers.workspaceId, workspaceId)).all();
  const observations = db.select().from(s.icObservations).where(eq(s.icObservations.workspaceId, workspaceId)).all();
  const rows = db
    .select({ c: s.companies, v: s.companyVersions })
    .from(s.companies)
    .innerJoin(s.companyVersions, eq(s.companyVersions.id, s.companies.currentVersionId))
    .where(and(eq(s.companies.workspaceId, workspaceId), isNull(s.companies.deletedAt)))
    .all();
  const deals = rows.map(({ c, v }) => {
    let traits: string[] = [];
    try {
      const { canonical, derived } = loadVersion(v);
      traits = dealTraits({
        stage: canonical.classification.financingStage,
        sectors: canonical.classification.industry,
        highRiskCategories: [...new Set(canonical.risks.filter((r) => r.severity === "HIGH" || r.severity === "CRITICAL").map((r) => r.category))],
        failedGates: derived.fundFit.gates.filter((g) => g.result === "FAIL").map((g) => g.label),
        weakDimensions: derived.dimensions.filter((d) => d.value !== null && d.value < 40).map((d) => d.id),
        evidenceCategory: derived.evidence.category,
      });
    } catch {
      /* unreadable version: no traits */
    }
    return { companyId: c.id, name: c.name, icDecision: c.icDecision, traits };
  });
  const patterns = computePatterns(members, observations, deals);
  db.transaction((tx) => {
    tx.delete(s.fundKnowledge).where(and(eq(s.fundKnowledge.workspaceId, workspaceId), eq(s.fundKnowledge.provenance, "INFERRED"), like(s.fundKnowledge.sourceRef, "pattern:%"))).run();
    for (const p of patterns)
      tx.insert(s.fundKnowledge)
        .values({
          id: newId("fk"),
          workspaceId,
          kind: p.scope === "MEMBER" ? "IC_PREFERENCE" : "LESSON",
          title: p.title,
          body: p.body,
          provenance: "INFERRED",
          sourceRef: `pattern:${PATTERN_VERSION}:${p.key}:k=${p.k}/n=${p.n}${p.memberId ? `:member=${p.memberId}` : ""}`,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        })
        .run();
  });
  return patterns;
}
