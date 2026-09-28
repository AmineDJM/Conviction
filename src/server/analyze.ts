/**
 * Entry point for starting an analysis from uploaded files (API + CLI).
 * Extraction and persistence happen synchronously; the model pipeline runs
 * in the background and reports progress through the analysis_runs row.
 *
 * Ingestion is idempotent: re-uploading the same deck never duplicates
 * companies, documents, claims, metrics or embeddings.
 *  - same content + mode + engine/prompt versions, already analysed in full → the existing analysis is returned;
 *  - same content currently being analysed → the running analysis is returned;
 *  - same content otherwise (new mode, new versions, partial result, or `force`) → re-analysed on the same
 *    company, reusing the stored documents and carrying over human overrides.
 *
 * Deck versions (v1 → v2 → v3). With `target`, the upload is analysed on an EXISTING company:
 *  - NEW_DECK_VERSION: the uploaded deck becomes deck v(n+1) of the company (documents.deck_version,
 *    superseding v(n)); the analysis reads the uploaded files;
 *  - ADD_DOCUMENTS: the uploaded files are added to the documents the current version read (same deck
 *    version) and the company is re-analysed on all of them.
 * Either way the new version is saved with reason DECK_ANALYSIS, so its meetings-workflow stage follows
 * repo.saveVersion: PRE_MEETING_ANALYSIS, or DECK_REANALYSIS once a founder meeting exists. Overrides are
 * carried over and re-anchored on the new analysis (engine/override-carry.ts); the outcome is recorded.
 * A company is never merged silently: a different company is only targeted when the user chose it.
 */
import { extractDocument, type ExtractedDocument } from "@/ingestion/extract";
import { readStoredFile, storeFile, storageKeyFor } from "./storage";
import { createHash } from "node:crypto";
import * as repo from "./repo";
import { PROMPT_VERSIONS } from "@/ai/prompts";
import { PRIMARY_MODEL } from "@/ai/openai";
import { ACTIVE_REGISTRY_ID } from "@/engine/benchmarks";
import { nextDeckSeq, pickDeckIndex, resolveDeckLineage } from "@/engine/deck-lineage";
import { PIPELINE_STEPS, budgetFor, inputHash, runDeckAnalysis } from "@/orchestration/pipeline";
import type { AnalysisMode } from "@/domain/enums";

export interface UploadedFile {
  filename: string;
  mime: string;
  data: Buffer;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type StartOutcome = "STARTED" | "REANALYZED" | "ALREADY_ANALYZED" | "ALREADY_RUNNING" | "NEW_DECK_VERSION" | "DOCUMENTS_ADDED";
export type TargetIntent = "NEW_DECK_VERSION" | "ADD_DOCUMENTS";

/** A request that cannot be served as asked (maps to an HTTP status in the route). */
export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409,
  ) {
    super(message);
  }
}

type Doc = ExtractedDocument & { documentId: string };

/** Re-reads a stored document for analysis (same bytes → same extraction); refuses a file whose hash changed. */
export async function loadStoredDocument(d: ReturnType<typeof repo.listDocuments>[number]): Promise<Doc> {
  const buf = await readStoredFile(d.storagePath);
  const x = await extractDocument(d.filename, d.mime, buf);
  if (x.sha256 !== d.sha256) throw new Error(`Stored file for ${d.filename} does not match its recorded hash`);
  return { ...x, documentId: d.id };
}

export async function startAnalysis(v: {
  workspaceId: string;
  userId: string | null;
  files: UploadedFile[];
  mode: AnalysisMode;
  companyName?: string | null;
  companyUrl?: string | null;
  budgetUsd?: number;
  /** Re-run even when an identical analysis exists. */
  force?: boolean;
  /** Evaluation only (no route sets it): stop after extraction and the deterministic layer. */
  extractionOnly?: boolean;
  /** Analyse on this existing company (deck-version flow). */
  target?: { companyId: string; intent: TargetIntent } | null;
  /** Companies the user said this upload is NOT (duplicate prompt answered "different company"). */
  distinctFrom?: string[];
  /** Set by the merge flow: the duplicate company whose documents are being re-analysed here. */
  mergedFrom?: { companyId: string; name: string } | null;
}) {
  if (v.files.length === 0) throw new AnalysisRequestError("No documents provided", 400);
  for (const f of v.files) if (f.data.length > MAX_FILE_BYTES) throw new AnalysisRequestError(`${f.filename} exceeds 50 MB`, 400);

  const extracted = await Promise.all(v.files.map((f) => extractDocument(f.filename, f.mime, f.data)));
  for (const d of extracted) if (d.kind === "OTHER") throw new AnalysisRequestError(`Unsupported file type: ${d.filename}`, 400);

  /* ---------- explicit target company (deck-version flow) ---------- */
  let targetCompany: repo.CompanyRow | undefined;
  let intent: TargetIntent | null = null;
  let carriedDocs: Doc[] = [];
  if (v.target) {
    targetCompany = repo.getCompany(v.workspaceId, v.target.companyId);
    if (!targetCompany) throw new AnalysisRequestError("Company not found", 404);
    const stored = repo.listDocuments(targetCompany.id);
    const known = new Set(stored.map((d) => d.sha256));
    const fresh = extracted.filter((d) => !known.has(d.sha256));
    if (fresh.length === 0) {
      // Every file is already on record: this is a re-upload, handled by the idempotent path below.
      intent = null;
    } else if (v.target.intent === "NEW_DECK_VERSION") {
      if (pickDeckIndex(fresh) < 0 || !["PDF", "PPTX", "IMAGE"].includes(fresh[pickDeckIndex(fresh)]!.kind)) throw new AnalysisRequestError("No new deck in the upload (PDF, PPTX or slide images). To add supporting documents, use “Add documents”.", 400);
      intent = "NEW_DECK_VERSION";
    } else {
      intent = "ADD_DOCUMENTS";
      const current = repo.getCurrentVersion(targetCompany);
      const ids = new Set((current?.canonical.documents ?? []).map((d) => d.id));
      const uploaded = new Set(extracted.map((d) => d.sha256));
      carriedDocs = await Promise.all(stored.filter((d) => ids.has(d.id) && !uploaded.has(d.sha256)).map(loadStoredDocument));
    }
  }

  const all = [...carriedDocs, ...extracted];
  const hash = inputHash(all, v.mode);

  /* ---------- re-upload detection ---------- */
  let existing: repo.CompanyRow | undefined;
  if (targetCompany && intent === null) existing = targetCompany;
  else if (!targetCompany) {
    const shas = [...new Set(extracted.map((d) => d.sha256))];
    const known = repo.findDocumentsBySha(v.workspaceId, shas);
    // A company qualifies only if it already holds every uploaded file.
    const byCompany = new Map<string, typeof known>();
    for (const d of known) byCompany.set(d.companyId, [...(byCompany.get(d.companyId) ?? []), d]);
    const matchId = [...byCompany.entries()].find(([, ds]) => shas.every((sh) => ds.some((d) => d.sha256 === sh)))?.[0];
    existing = matchId ? repo.getCompany(v.workspaceId, matchId) : undefined;
  }

  if (existing && !intent) {
    const last = repo.latestRun(existing.id);
    if (last && (last.status === "RUNNING" || last.status === "QUEUED")) {
      return { company: existing, run: last, promise: Promise.resolve(), outcome: "ALREADY_RUNNING" as StartOutcome, deckVersion: null };
    }
    const current = repo.getCurrentVersion(existing);
    const prov = current?.canonical.analysis.provenance;
    if (!v.force && last && current && prov?.inputHash === hash && current.canonical.analysis.depth === "FULL" && !current.canonical.analysis.cancelled) {
      repo.audit(v.workspaceId, v.userId, "REUPLOAD_DEDUPED", existing.id);
      return { company: existing, run: last, promise: Promise.resolve(), outcome: "ALREADY_ANALYZED" as StartOutcome, deckVersion: null };
    }
  }

  // From the duplicate check to the run row, everything below is synchronous (no await), so two
  // simultaneous uploads of the same deck cannot both miss each other and create two companies.
  if (targetCompany && intent) {
    const last = repo.latestRun(targetCompany.id);
    if (last && (last.status === "RUNNING" || last.status === "QUEUED")) throw new AnalysisRequestError(`An analysis is already running for ${targetCompany.name}. Wait for it to finish (or cancel it) before adding a deck.`, 409);
  }
  const onCompany = targetCompany && intent ? targetCompany : existing;
  const company = onCompany ?? repo.createCompany(v.workspaceId, provisionalName(v.companyName, v.files[0]!.filename));
  if (onCompany) repo.setCompanyStatus(onCompany.id, "PROCESSING");
  const stored = onCompany ? repo.listDocuments(onCompany.id) : [];
  const lineage = resolveDeckLineage(stored);

  // The deck of this upload: v1 of a new company, v(n+1) of a company that receives a new deck version.
  const freshIdx = extracted.map((d, i) => ({ d, i })).filter(({ d }) => !stored.some((x) => x.sha256 === d.sha256));
  const deckAt = !onCompany || intent === "NEW_DECK_VERSION" ? freshIdx[pickDeckIndex(freshIdx.map((x) => x.d))]?.i ?? -1 : -1;
  const deckSeq = deckAt < 0 ? null : onCompany ? nextDeckSeq(lineage) : 1;
  const supersedes = deckSeq && deckSeq > 1 ? (lineage.at(-1)?.documentId ?? null) : null;

  const docs: Doc[] = [...carriedDocs];
  const toStore: { sha256: string; filename: string; data: Buffer }[] = [];
  for (const [i, d] of extracted.entries()) {
    const reuse = stored.find((x) => x.sha256 === d.sha256);
    if (reuse) {
      docs.push({ ...d, documentId: reuse.id });
      continue;
    }
    const storagePath = storageKeyFor(v.workspaceId, d.sha256, d.filename);
    const isDeck = i === deckAt;
    const documentId = repo.saveDocument({
      workspaceId: v.workspaceId,
      companyId: company.id,
      filename: d.filename,
      mime: d.mime,
      kind: d.kind,
      sizeBytes: d.sizeBytes,
      sha256: d.sha256,
      storagePath,
      pages: d.pages,
      deckVersion: isDeck ? deckSeq : null,
      supersedesDocumentId: isDeck ? supersedes : null,
    });
    docs.push({ ...d, documentId });
    toStore.push({ sha256: d.sha256, filename: d.filename, data: v.files[i]!.data });
  }
  const { hardCapUsd } = budgetFor(v.mode, v.budgetUsd);
  const run = repo.createRun({
    workspaceId: v.workspaceId,
    companyId: company.id,
    mode: v.mode,
    model: PRIMARY_MODEL,
    promptVersions: PROMPT_VERSIONS,
    registryId: ACTIVE_REGISTRY_ID,
    budgetUsd: hardCapUsd,
    steps: [...PIPELINE_STEPS],
  });
  const previous = onCompany ? repo.getCurrentVersion(onCompany) : null;
  try {
    for (const f of toStore) await storeFile(v.workspaceId, f.sha256, f.filename, f.data);
  } catch (e) {
    repo.finishRun(run.id, "FAILED", 0, null, `Could not store the document: ${(e as Error).message}`);
    repo.setCompanyStatus(company.id, previous ? "READY" : "FAILED");
    throw e;
  }

  const names = (xs: { filename: string }[]) => xs.map((d) => d.filename).join(", ");
  const deckDoc = deckAt >= 0 ? extracted[deckAt]! : null;
  if (!onCompany) {
    repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "DECK_UPLOADED", summary: `${docs.length} document(s): ${names(docs)}${deckDoc ? ` — deck v1: ${deckDoc.filename}` : ""}`, userId: v.userId });
    for (const other of v.distinctFrom ?? []) recordDistinct(v.workspaceId, v.userId, company.id, other, "at upload");
  } else if (intent === "NEW_DECK_VERSION") {
    const prev = lineage.at(-1);
    repo.addHistory({
      workspaceId: v.workspaceId,
      companyId: company.id,
      type: "DECK_VERSION_ADDED",
      summary: `Deck v${deckSeq}: ${deckDoc?.filename ?? "?"}${prev ? ` (supersedes v${prev.seq}: ${prev.filename})` : ""}${v.mergedFrom ? ` — merged from ${v.mergedFrom.name}` : ""}${docs.length > 1 ? `; with ${names(docs.filter((d) => d.filename !== deckDoc?.filename))}` : ""}`,
      payload: { deckVersion: deckSeq, documentId: docs.find((d) => d.sha256 === deckDoc?.sha256)?.documentId ?? null, supersedesDocumentId: supersedes, mergedFrom: v.mergedFrom ?? null },
      userId: v.userId,
    });
  } else if (intent === "ADD_DOCUMENTS") {
    repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "DOCUMENTS_ADDED", summary: `Added ${names(extracted)} to the documents of the current deck (${carriedDocs.length} kept: ${names(carriedDocs) || "none"})`, userId: v.userId });
  }
  const what = intent === "NEW_DECK_VERSION" ? `analysis of deck v${deckSeq}` : intent === "ADD_DOCUMENTS" ? "re-analysis with the added documents" : onCompany ? "re-analysis of the same documents" : "analysis started";
  repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "ANALYSIS_STARTED", summary: `${v.mode} ${what} (budget cap $${hardCapUsd.toFixed(2)})`, userId: v.userId });
  repo.audit(v.workspaceId, v.userId, intent ?? (onCompany ? "ANALYSIS_RERUN" : "ANALYSIS_STARTED"), company.id, deckSeq ? `deck v${deckSeq}` : undefined);

  const carryOver = previous?.canonical.overrides.length ? { overrides: previous.canonical.overrides, source: previous.canonical, fromVersionId: previous.row.id } : null;
  const promise = runDeckAnalysis({
    workspaceId: v.workspaceId,
    companyId: company.id,
    runId: run.id,
    mode: v.mode,
    documents: docs,
    fund: repo.getDefaultFund(v.workspaceId),
    userId: v.userId,
    companyUrl: v.companyUrl,
    budgetUsd: v.budgetUsd,
    carryOver,
    extractionOnly: v.extractionOnly,
  }).then(() => {
    if (carryOver) recordCarryOver(v.workspaceId, v.userId, company.id, run.id, carryOver.fromVersionId);
  });
  const outcome: StartOutcome = intent === "NEW_DECK_VERSION" ? "NEW_DECK_VERSION" : intent === "ADD_DOCUMENTS" ? "DOCUMENTS_ADDED" : onCompany ? "REANALYZED" : "STARTED";
  return { company, run, promise, outcome, deckVersion: deckSeq };
}

/** "Not the same company": remembered on both sides so the duplicate prompt never asks again for this pair. */
export function recordDistinct(workspaceId: string, userId: string | null, companyId: string, otherId: string, when: string) {
  const a = repo.getCompany(workspaceId, companyId);
  const b = repo.getCompany(workspaceId, otherId);
  if (!a || !b || a.id === b.id) return;
  repo.addHistory({ workspaceId, companyId: a.id, type: "DUPLICATE_DISMISSED", summary: `Confirmed a different company from ${b.name} (${when})`, payload: { otherCompanyId: b.id }, userId });
  repo.addHistory({ workspaceId, companyId: b.id, type: "DUPLICATE_DISMISSED", summary: `Confirmed a different company from ${a.name} (${when})`, payload: { otherCompanyId: a.id }, userId });
  repo.audit(workspaceId, userId, "DUPLICATE_DISMISSED", a.id, b.id);
}

/** After a re-analysis: record which overrides were re-applied and which could not be (never silent). */
function recordCarryOver(workspaceId: string, userId: string | null, companyId: string, runId: string, fromVersionId: string) {
  const company = repo.getCompany(workspaceId, companyId);
  const current = company ? repo.getCurrentVersion(company) : null;
  if (!current || current.row.runId !== runId) return;
  const carried = current.canonical.overrides.filter((o) => o.carry?.fromVersionId === fromVersionId);
  if (!carried.length) return;
  const lost = carried.filter((o) => o.carry!.status === "UNANCHORED");
  const moved = carried.filter((o) => o.carry!.status === "REANCHORED");
  repo.addHistory({
    workspaceId,
    companyId,
    type: "OVERRIDES_CARRIED_OVER",
    versionId: current.row.id,
    summary: `${moved.length} override${moved.length === 1 ? "" : "s"} re-applied${lost.length ? `; ${lost.length} NOT re-applied — ${lost.map((o) => `${o.id} (${o.carry!.note.replace(/^not re-applied: /, "")})`).join("; ")}` : ""}`,
    payload: carried.map((o) => ({ id: o.id, target: o.target, field: o.field, status: o.carry!.status, fromRef: o.carry!.fromRef, toRef: o.carry!.status === "REANCHORED" ? o.ref : null, note: o.carry!.note })),
    userId,
  });
}

function provisionalName(given: string | null | undefined, filename: string) {
  return (
    given?.trim() ||
    filename
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b(deck|pitch|presentation|final|v\d+)\b/gi, "")
      .trim() ||
    "New company"
  );
}

/**
 * Re-runs the analysis of a company on the documents already on record (after a failed or interrupted run, or to
 * re-analyse with the current engine and prompts). Stored bytes are verified against their recorded hash; no upload.
 */
export async function retryAnalysis(v: { workspaceId: string; userId: string | null; companyIdOrSlug: string; mode?: AnalysisMode }) {
  const company = repo.getCompany(v.workspaceId, v.companyIdOrSlug);
  if (!company) throw new AnalysisRequestError("Company not found", 404);
  const last = repo.latestRun(company.id);
  if (last && (last.status === "RUNNING" || last.status === "QUEUED")) throw new AnalysisRequestError("An analysis is already running for this company", 409);
  const current = repo.getCurrentVersion(company);
  const ids = new Set((current?.canonical.documents ?? []).map((d) => d.id));
  const stored = repo.listDocuments(company.id).filter((d) => (ids.size ? ids.has(d.id) : ["PDF", "PPTX", "IMAGE", "TEXT"].includes(d.kind)));
  if (!stored.length) throw new AnalysisRequestError("No stored documents to analyse — upload the deck", 400);
  const files = await Promise.all(
    stored.map(async (d) => {
      const data = await readStoredFile(d.storagePath);
      if (createHash("sha256").update(data).digest("hex") !== d.sha256) throw new AnalysisRequestError(`Stored file for ${d.filename} does not match its recorded hash`, 409);
      return { filename: d.filename, mime: d.mime, data };
    }),
  );
  const mode = v.mode ?? current?.canonical.analysis.mode ?? (last?.mode as AnalysisMode | undefined) ?? "STANDARD";
  return startAnalysis({ workspaceId: v.workspaceId, userId: v.userId, mode, files, target: { companyId: company.id, intent: "ADD_DOCUMENTS" } });
}
