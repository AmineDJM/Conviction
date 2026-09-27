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
 */
import { extractDocument } from "@/ingestion/extract";
import { storeFile, storageKeyFor } from "./storage";
import * as repo from "./repo";
import { PROMPT_VERSIONS } from "@/ai/prompts";
import { PRIMARY_MODEL } from "@/ai/openai";
import { ACTIVE_REGISTRY_ID } from "@/engine/benchmarks";
import { PIPELINE_STEPS, budgetFor, inputHash, runDeckAnalysis } from "@/orchestration/pipeline";
import type { AnalysisMode } from "@/domain/enums";

export interface UploadedFile {
  filename: string;
  mime: string;
  data: Buffer;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type StartOutcome = "STARTED" | "REANALYZED" | "ALREADY_ANALYZED" | "ALREADY_RUNNING";

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
}) {
  if (v.files.length === 0) throw new Error("No documents provided");
  for (const f of v.files) if (f.data.length > MAX_FILE_BYTES) throw new Error(`${f.filename} exceeds 50 MB`);

  const extracted = await Promise.all(v.files.map((f) => extractDocument(f.filename, f.mime, f.data)));
  for (const d of extracted) if (d.kind === "OTHER") throw new Error(`Unsupported file type: ${d.filename}`);
  const hash = inputHash(extracted, v.mode);

  /* ---------- re-upload detection ---------- */
  const shas = [...new Set(extracted.map((d) => d.sha256))];
  const known = repo.findDocumentsBySha(v.workspaceId, shas);
  // A company qualifies only if it already holds every uploaded file.
  const byCompany = new Map<string, typeof known>();
  for (const d of known) byCompany.set(d.companyId, [...(byCompany.get(d.companyId) ?? []), d]);
  const matchId = [...byCompany.entries()].find(([, ds]) => shas.every((sh) => ds.some((d) => d.sha256 === sh)))?.[0];
  const existing = matchId ? repo.getCompany(v.workspaceId, matchId) : undefined;

  if (existing) {
    const last = repo.latestRun(existing.id);
    if (last && (last.status === "RUNNING" || last.status === "QUEUED")) {
      return { company: existing, run: last, promise: Promise.resolve(), outcome: "ALREADY_RUNNING" as StartOutcome };
    }
    const current = repo.getCurrentVersion(existing);
    const prov = current?.canonical.analysis.provenance;
    if (!v.force && last && current && prov?.inputHash === hash && current.canonical.analysis.depth === "FULL" && !current.canonical.analysis.cancelled) {
      repo.audit(v.workspaceId, v.userId, "REUPLOAD_DEDUPED", existing.id);
      return { company: existing, run: last, promise: Promise.resolve(), outcome: "ALREADY_ANALYZED" as StartOutcome };
    }
  }

  // From the duplicate check to the run row, everything below is synchronous (no await), so two
  // simultaneous uploads of the same deck cannot both miss each other and create two companies.
  const company = existing ?? repo.createCompany(v.workspaceId, provisionalName(v.companyName, v.files[0]!.filename));
  if (existing) repo.setCompanyStatus(existing.id, "PROCESSING");
  const stored = existing ? repo.listDocuments(existing.id) : [];
  const docs = [];
  const toStore: { sha256: string; filename: string; data: Buffer }[] = [];
  for (const [i, d] of extracted.entries()) {
    const reuse = stored.find((x) => x.sha256 === d.sha256);
    if (reuse) {
      docs.push({ ...d, documentId: reuse.id });
      continue;
    }
    const storagePath = storageKeyFor(v.workspaceId, d.sha256, d.filename);
    const documentId = repo.saveDocument({ workspaceId: v.workspaceId, companyId: company.id, filename: d.filename, mime: d.mime, kind: d.kind, sizeBytes: d.sizeBytes, sha256: d.sha256, storagePath, pages: d.pages });
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
  const previous = existing ? repo.getCurrentVersion(existing) : null;
  try {
    for (const f of toStore) await storeFile(v.workspaceId, f.sha256, f.filename, f.data);
  } catch (e) {
    repo.finishRun(run.id, "FAILED", 0, null, `Could not store the document: ${(e as Error).message}`);
    repo.setCompanyStatus(company.id, previous ? "READY" : "FAILED");
    throw e;
  }
  if (!existing) repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "DECK_UPLOADED", summary: `${docs.length} document(s): ${docs.map((d) => d.filename).join(", ")}`, userId: v.userId });
  repo.addHistory({
    workspaceId: v.workspaceId,
    companyId: company.id,
    type: "ANALYSIS_STARTED",
    summary: `${v.mode} ${existing ? "re-analysis of the same documents" : "analysis started"} (budget cap $${hardCapUsd.toFixed(2)})`,
    userId: v.userId,
  });
  repo.audit(v.workspaceId, v.userId, existing ? "ANALYSIS_RERUN" : "ANALYSIS_STARTED", company.id);

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
    carryOver: previous ? { overrides: previous.canonical.overrides } : null,
  });
  return { company, run, promise, outcome: (existing ? "REANALYZED" : "STARTED") as StartOutcome };
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
