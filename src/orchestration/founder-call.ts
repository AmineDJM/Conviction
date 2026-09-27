/**
 * §65 Founder call update — update, never restart, the analysis.
 *
 * One structured pass (founder_call_update_v1) reads the transcript against the
 * open questions and the claim ledger. Code applies the result
 * (assemble.applyFounderCall), recomputes the deterministic layer, saves a
 * FOUNDER_CALL version and re-indexes the Fund Brain. The transcript itself is
 * stored as a TRANSCRIPT document so every excerpt stays traceable.
 */
import { createHash } from "node:crypto";
import { CostController, BudgetExceededError } from "@/ai/cost";
import { structured, PRIMARY_MODEL } from "@/ai/openai";
import { detectInjection, wrapUntrusted } from "@/ai/untrusted";
import { FounderCallOutput, founderCallInstructions, FOUNDER_CALL_UPDATE } from "@/ai/prompts/founder-call";
import { applyFounderCall } from "./assemble";
import { claimsDigest } from "./context";
import * as repo from "@/server/repo";
import { storeFile } from "@/server/storage";
import { commitCanonicalUpdate } from "@/server/versioning";
import { logger } from "@/lib/log";

export const FOUNDER_CALL_STEPS = [
  { step: "CALL", label: "Reading call transcript" },
  { step: "UPDATE", label: "Updating analysis" },
  { step: "INDEX", label: "Updating deal memory" },
];

/** A founder call is a single pass: small, explicit budget. */
export const FOUNDER_CALL_BUDGET = { hardCapUsd: 0.1, targetUsd: 0.06 } as const;
export const MAX_TRANSCRIPT_CHARS = 200_000;
export const MIN_TRANSCRIPT_CHARS = 200;
const MAX_OUTPUT_TOKENS = 16_000;

export class FounderCallError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Split a transcript into ~3k-character "pages" on paragraph boundaries for the raw document viewer. */
export function transcriptPages(text: string, size = 3000): { pageNo: number; text: string }[] {
  const paras = text.replace(/\r\n/g, "\n").split(/\n{2,}|\n(?=[A-Z][\w .'-]{0,40}:)/);
  const pages: string[] = [];
  let cur = "";
  for (const p of paras) {
    const piece = p.trim();
    if (!piece) continue;
    if (cur && cur.length + piece.length + 2 > size) {
      pages.push(cur);
      cur = "";
    }
    if (piece.length > size) {
      for (let i = 0; i < piece.length; i += size) pages.push(piece.slice(i, i + size));
      continue;
    }
    cur = cur ? `${cur}\n\n${piece}` : piece;
  }
  if (cur) pages.push(cur);
  return pages.map((t, i) => ({ pageNo: i + 1, text: t }));
}

export interface StartFounderCallInput {
  workspaceId: string;
  userId: string | null;
  companyIdOrSlug: string;
  transcript: string;
  /** Original upload name, if the transcript came from a file. */
  filename?: string | null;
  callDate?: string | null;
}

/**
 * Validates, stores the transcript and creates the run synchronously; the
 * model pass runs in the returned promise (progress lives on the run row).
 */
export async function startFounderCall(inp: StartFounderCallInput) {
  const company = repo.getCompany(inp.workspaceId, inp.companyIdOrSlug);
  if (!company) throw new FounderCallError("Not found", 404);
  const current = repo.getCurrentVersion(company);
  if (!current) throw new FounderCallError("The deck analysis has not produced a version yet", 409);
  const latest = repo.latestRun(company.id);
  if (latest && (latest.status === "RUNNING" || latest.status === "QUEUED")) throw new FounderCallError("An analysis run is already in progress for this company", 409);

  const transcript = inp.transcript.replace(/\u0000/g, "").trim();
  if (transcript.length < MIN_TRANSCRIPT_CHARS) throw new FounderCallError(`Transcript is too short (${transcript.length} characters)`);
  if (transcript.length > MAX_TRANSCRIPT_CHARS) throw new FounderCallError(`Transcript exceeds ${MAX_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters`);

  const day = (inp.callDate && /^\d{4}-\d{2}-\d{2}$/.test(inp.callDate) ? inp.callDate : new Date().toISOString().slice(0, 10));
  const filename = inp.filename?.trim() || `founder-call-${day}.txt`;
  const buf = Buffer.from(transcript, "utf8");
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const storagePath = await storeFile(inp.workspaceId, sha256, filename.endsWith(".txt") ? filename : `${filename}.txt`, buf);
  const documentId = repo.saveDocument({
    workspaceId: inp.workspaceId,
    companyId: company.id,
    filename,
    mime: "text/plain",
    kind: "TRANSCRIPT",
    sizeBytes: buf.length,
    sha256,
    storagePath,
    pages: transcriptPages(transcript),
  });

  const run = repo.createRun({
    workspaceId: inp.workspaceId,
    companyId: company.id,
    kind: "FOUNDER_CALL",
    mode: "STANDARD",
    model: PRIMARY_MODEL,
    promptVersions: { [FOUNDER_CALL_UPDATE.id]: FOUNDER_CALL_UPDATE.version },
    registryId: current.row.registryId,
    budgetUsd: FOUNDER_CALL_BUDGET.hardCapUsd,
    steps: FOUNDER_CALL_STEPS,
  });
  repo.audit(inp.workspaceId, inp.userId, "FOUNDER_CALL_STARTED", company.id, `${run.id} ${filename} (${transcript.length} chars)`);

  const promise = runFounderCall({ workspaceId: inp.workspaceId, userId: inp.userId, companyId: company.id, runId: run.id, transcript, documentId, filename, callDate: day });
  return { company, run, documentId, promise };
}

export interface RunFounderCallInput {
  workspaceId: string;
  userId: string | null;
  companyId: string;
  runId: string;
  transcript: string;
  documentId: string;
  filename: string;
  callDate: string;
}

export async function runFounderCall(inp: RunFounderCallInput): Promise<void> {
  const log = logger.child({ runId: inp.runId, companyId: inp.companyId, kind: "FOUNDER_CALL" });
  const cost = new CostController(FOUNDER_CALL_BUDGET.hardCapUsd, FOUNDER_CALL_BUDGET.targetUsd, (e) => repo.recordCost(inp.workspaceId, inp.runId, "ANALYSIS", e));
  const step = (s: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string) => repo.updateRunStep(inp.runId, s, status, detail);
  let current = "CALL";
  try {
    const company0 = repo.getCompany(inp.workspaceId, inp.companyId);
    const version0 = company0 && repo.getCurrentVersion(company0);
    if (!company0 || !version0) throw new Error("Company version disappeared");

    /* ---------------- CALL (founder_call_update_v1) ---------------- */
    step("CALL", "RUNNING");
    const c0 = version0.canonical;
    const record = {
      company: { name: c0.identity.name, oneLiner: c0.identity.oneLiner },
      openQuestions: c0.questions.filter((q) => q.status !== "RESOLVED").map((q) => ({ id: q.id, question: q.question })),
      claimLedger: claimsDigest(c0),
    };
    const out = await structured({
      step: "CALL",
      promptVersion: FOUNDER_CALL_UPDATE.version,
      instructions: founderCallInstructions(),
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: wrapUntrusted("current deal record (contains excerpts from untrusted documents)", JSON.stringify(record)) },
            { type: "input_text", text: wrapUntrusted("founder call transcript", `Call date: ${inp.callDate}\n\n${inp.transcript}`) },
          ],
        },
      ],
      schema: FounderCallOutput,
      schemaName: "founder_call_update",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      effort: "low",
      cost,
    });
    step("CALL", "DONE", `${out.data.questionUpdates.length} question updates, ${out.data.claimUpdates.length} claim updates, ${out.data.newClaims.length} new claims`);

    /* ---------------- UPDATE: apply to the version current *now* ---------------- */
    current = "UPDATE";
    step("UPDATE", "RUNNING");
    const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
    const base = repo.getCurrentVersion(company) ?? version0;
    const { deal, changes } = applyFounderCall(base.canonical, out.data, `Founder call ${inp.callDate}`, new Date());
    // Link the transcript source to its stored document so excerpts are traceable.
    const src = [...deal.sources].reverse().find((s) => s.kind === "TRANSCRIPT");
    if (src) src.documentId = inp.documentId;
    if (!deal.documents.some((d) => d.id === inp.documentId)) {
      deal.documents.push({ id: inp.documentId, filename: inp.filename, kind: "TRANSCRIPT", pages: repo.getDocumentPages(inp.documentId).length });
    }
    const flags = detectInjection(inp.transcript, `${inp.filename}`);
    if (flags.length) {
      const seen = new Set(deal.analysis.securityFlags.map((f) => f.excerpt.slice(0, 60)));
      for (const f of flags) if (!seen.has(f.excerpt.slice(0, 60))) deal.analysis.securityFlags.push(f);
    }
    const qResolved = out.data.questionUpdates.filter((q) => q.status === "RESOLVED").length;
    const summary = `Founder call ${inp.callDate}: ${changes.confirmed} confirmed, ${changes.changed} changed, ${changes.contradicted} contradicted, ${changes.unresolved} unresolved, ${changes.newClaims} new claims; ${qResolved} question(s) resolved`;
    const res = commitCanonicalUpdate({
      workspaceId: inp.workspaceId,
      userId: inp.userId,
      company,
      previous: base,
      canonical: deal,
      reason: "FOUNDER_CALL",
      runId: inp.runId,
      summary,
      history: {
        type: "FOUNDER_CALL_ADDED",
        summary,
        payload: { runId: inp.runId, documentId: inp.documentId, changes, questionsResolved: qResolved, modelSummary: out.data.summary },
      },
      audit: { action: "FOUNDER_CALL_APPLIED", detail: `${inp.runId} → ${changes.confirmed}/${changes.changed}/${changes.contradicted}/${changes.unresolved}/${changes.newClaims}` },
    });
    step("UPDATE", "DONE", `v${res.version.versionNo} — ${res.derived.recommendation.status}${res.recommendationChanged ? " (changed)" : ""}`);

    /* ---------------- INDEX (Fund Brain) ---------------- */
    current = "INDEX";
    step("INDEX", "RUNNING");
    const idx = await res.reindex(cost);
    step("INDEX", idx.ok ? "DONE" : "FAILED", idx.detail);

    repo.finishRun(inp.runId, "COMPLETED", cost.spentUsd, deal.analysis.depth);
    log.info({ spentUsd: cost.spentUsd, changes }, "founder call applied");
  } catch (e) {
    const msg = e instanceof BudgetExceededError ? e.message : `Founder call update failed: ${(e as Error).message.slice(0, 300)}`;
    log.error({ err: (e as Error).message }, "founder call failed");
    step(current, "FAILED", msg.slice(0, 160));
    for (const s of FOUNDER_CALL_STEPS) if (s.step !== current && FOUNDER_CALL_STEPS.findIndex((x) => x.step === s.step) > FOUNDER_CALL_STEPS.findIndex((x) => x.step === current)) step(s.step, "SKIPPED", "Not reached");
    repo.finishRun(inp.runId, "FAILED", cost.spentUsd, null, msg);
  }
}
