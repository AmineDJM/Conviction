/**
 * Entry point for starting an analysis from uploaded files (API + CLI).
 * Extraction and persistence happen synchronously; the model pipeline runs
 * in the background and reports progress through the analysis_runs row.
 */
import { extractDocument } from "@/ingestion/extract";
import { storeFile } from "./storage";
import * as repo from "./repo";
import { PROMPT_VERSIONS } from "@/ai/prompts";
import { PRIMARY_MODEL } from "@/ai/openai";
import { ACTIVE_REGISTRY_ID } from "@/engine/benchmarks";
import { PIPELINE_STEPS, budgetFor, runDeckAnalysis } from "@/orchestration/pipeline";
import type { AnalysisMode } from "@/domain/enums";

export interface UploadedFile {
  filename: string;
  mime: string;
  data: Buffer;
}

const MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function startAnalysis(v: {
  workspaceId: string;
  userId: string | null;
  files: UploadedFile[];
  mode: AnalysisMode;
  companyName?: string | null;
  companyUrl?: string | null;
  budgetUsd?: number;
}) {
  if (v.files.length === 0) throw new Error("No documents provided");
  for (const f of v.files) if (f.data.length > MAX_FILE_BYTES) throw new Error(`${f.filename} exceeds 50 MB`);

  const extracted = await Promise.all(v.files.map((f) => extractDocument(f.filename, f.mime, f.data)));
  for (const d of extracted) if (d.kind === "OTHER") throw new Error(`Unsupported file type: ${d.filename}`);

  const provisional = v.companyName?.trim() || v.files[0]!.filename.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").replace(/\b(deck|pitch|presentation|final|v\d+)\b/gi, "").trim() || "New company";
  const company = repo.createCompany(v.workspaceId, provisional);
  const docs = [];
  for (const [i, d] of extracted.entries()) {
    const storagePath = await storeFile(v.workspaceId, d.sha256, d.filename, v.files[i]!.data);
    const documentId = repo.saveDocument({ workspaceId: v.workspaceId, companyId: company.id, filename: d.filename, mime: d.mime, kind: d.kind, sizeBytes: d.sizeBytes, sha256: d.sha256, storagePath, pages: d.pages });
    docs.push({ ...d, documentId });
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
  repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "DECK_UPLOADED", summary: `${docs.length} document(s): ${docs.map((d) => d.filename).join(", ")}`, userId: v.userId });
  repo.addHistory({ workspaceId: v.workspaceId, companyId: company.id, type: "ANALYSIS_STARTED", summary: `${v.mode} analysis started (budget cap $${hardCapUsd.toFixed(2)})`, userId: v.userId });
  repo.audit(v.workspaceId, v.userId, "ANALYSIS_STARTED", company.id);

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
  });
  return { company, run, promise };
}
