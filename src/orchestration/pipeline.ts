/**
 * §133 Analysis workflow orchestration — v3 (parallel).
 *
 *   T0  triage ‖ extract metrics ‖ extract claims ‖ forensics (visual) ‖ latent
 *       research (company ‖ market) starts as soon as triage lands
 *   T1  analysis A ‖ analysis B ‖ thesis ‖ actions  (on the same record + deterministic layer)
 *   T2  deterministic layer (scores, returns, integrity, economics) → version → Fund Brain index
 *
 * Luna-first. Every call is budget-authorized (parallel calls hold their worst
 * case in flight), cached on identical inputs for reproducibility, and
 * cancellable. Failures and budget limits degrade to an explicit PARTIAL
 * analysis — never to invented results.
 */
import { createHash } from "node:crypto";
import { CostController, BudgetExceededError, MODE_BUDGETS, ABSOLUTE_STANDARD_CAP_USD, type Reservation } from "@/ai/cost";
import { structured, PRIMARY_MODEL, type InputMessage, type Effort } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { worstCaseCost } from "@/ai/pricing";
import { PROMPT_VERSIONS } from "@/ai/prompts";
import { TriageOutput, triageInstructions, TRIAGE } from "@/ai/prompts/triage";
import { MetricsExtractionOutput, ClaimsOnlyOutput, ProfileExtractionOutput, metricsExtractionInstructions, claimsExtractionInstructions, profileExtractionInstructions, EXTRACT_METRICS, EXTRACT_CLAIMS, EXTRACT_PROFILE } from "@/ai/prompts/extract";
import { ForensicsOutput, forensicsInstructions, DECK_FORENSICS } from "@/ai/prompts/forensics";
import { LatentSignalsOutput, latentSignalsInstructions, LATENT_SIGNALS } from "@/ai/prompts/latent";
import { ResearchOutput, researchInstructions, RESEARCH } from "@/ai/prompts/research";
import { AnalysisPartSchemas, ANALYSIS_PARTS, analysisPartInstructions, INVESTMENT_ANALYSIS, type AnalysisPartId, type InvestmentAnalysisOutput } from "@/ai/prompts/investment-analysis";
import { ThesisCoreOutput, ChallengeOutput, ActionsOutput, thesisInstructions, challengeInstructions, actionsInstructions, DECISION_THESIS, DECISION_CHALLENGE, DECISION_ACTIONS } from "@/ai/prompts/decision";
import { emptyCanonical, CANONICAL_SCHEMA_VERSION, ANALYSIS_ENGINE_VERSION, type CanonicalDeal } from "@/domain/canonical";
import type { AnalysisMode } from "@/domain/enums";
import type { FundProfile } from "@/domain/fund";
import { derive, researchPriorityIndex, type DerivedAnalysis } from "@/engine/derive";
import { METRIC_DICTIONARY_VERSION } from "@/engine/metrics/dictionary";
import { getRegistry } from "@/engine/benchmarks";
import { renderPagesForModel, type ExtractedDocument } from "@/ingestion/extract";
import {
  applyDocuments,
  applyTriage,
  applyClaimsExtraction,
  applyMetricsExtraction,
  applyForensics,
  applyLatent,
  applyResearch,
  applyInvestmentAnalysis,
  applyThesis,
  applyActions,
  linkKeyClaims,
  type IngestedDoc,
} from "./assemble";
import { canonicalForAnalysis, derivedDigest } from "./context";
import { registerRun, releaseRun, acquireSlot, releaseSlot, throwIfCancelled, CancelledError } from "./run-control";
import * as repo from "@/server/repo";
import { indexCompanyForBrain } from "@/brain/indexer";
import { logger } from "@/lib/log";

export const PIPELINE_STEPS = [
  { step: "INGEST", label: "Reading deck" },
  { step: "TRIAGE", label: "Understanding the company" },
  { step: "EXTRACT", label: "Extracting metrics, claims and customers" },
  { step: "FORENSICS", label: "Reading charts and the deck's narrative" },
  { step: "RESEARCH_COMPANY", label: "Researching founders and claims" },
  { step: "RESEARCH_MARKET", label: "Sizing the market independently" },
  { step: "RESEARCH_COMPETITION", label: "Mapping competitors" },
  { step: "ANALYZE", label: "Analyzing founders, product, market and risks" },
  { step: "DECIDE", label: "Building and stress-testing the thesis" },
  { step: "MEMO", label: "Scores, returns and integrity checks" },
  { step: "INDEX", label: "Building deal memory" },
] as const;

const OUTPUT_TOKENS = {
  FAST_SCREEN: { triage: 3_000, metrics: 9_000, claims: 7_000, profile: 5_000, forensics: 7_000, latent: 4_500, research: 0, analysisPart: 5_000, thesis: 7_000, challenge: 5_000, actions: 6_000 },
  STANDARD: { triage: 4_000, metrics: 14_000, claims: 10_000, profile: 7_000, forensics: 10_000, latent: 6_000, research: 6_000, analysisPart: 8_000, thesis: 9_000, challenge: 7_000, actions: 9_000 },
  DEEP_DD: { triage: 5_000, metrics: 20_000, claims: 14_000, profile: 10_000, forensics: 14_000, latent: 8_000, research: 10_000, analysisPart: 12_000, thesis: 14_000, challenge: 10_000, actions: 12_000 },
} as const;

const EFFORT: Record<AnalysisMode, { fast: Effort; extract: Effort; analysis: Effort; decide: Effort }> = {
  FAST_SCREEN: { fast: "none", extract: "low", analysis: "low", decide: "low" },
  STANDARD: { fast: "none", extract: "low", analysis: "low", decide: "medium" },
  DEEP_DD: { fast: "low", extract: "medium", analysis: "high", decide: "high" },
};

const RESEARCH_STEPS = ["RESEARCH_COMPANY", "RESEARCH_MARKET", "RESEARCH_COMPETITION"] as const;
/** Per research round. */
const SEARCH_CEILING = { FAST_SCREEN: 0, STANDARD: 4, DEEP_DD: 10 } as const;
const RESEARCH_BUDGET_USD = { FAST_SCREEN: 0, STANDARD: 0.15, DEEP_DD: 0.9 } as const;
/** Worst-case input size assumed when reserving the T1 calls. */
const T1_INPUT_CHARS = 110_000;

export interface RunDeckAnalysisInput {
  workspaceId: string;
  companyId: string;
  runId: string;
  mode: AnalysisMode;
  documents: (ExtractedDocument & { documentId: string })[];
  fund: FundProfile;
  userId: string | null;
  companyUrl?: string | null;
  budgetUsd?: number;
  /** Human overrides carried over from the previous version (never lost on re-analysis). */
  carryOver?: Pick<CanonicalDeal, "overrides"> | null;
}

export function budgetFor(mode: AnalysisMode, requested?: number) {
  const b = MODE_BUDGETS[mode];
  const hard = Math.min(requested ?? b.hardCapUsd, mode === "STANDARD" ? ABSOLUTE_STANDARD_CAP_USD : b.hardCapUsd);
  return { hardCapUsd: hard, targetUsd: Math.min(b.targetUsd, hard) };
}

/** Identity of an analysis input: same documents + mode + versions ⇒ same hash. */
export function inputHash(docs: { sha256: string }[], mode: AnalysisMode) {
  return createHash("sha256")
    .update(JSON.stringify({ docs: docs.map((d) => d.sha256).sort(), mode, prompts: PROMPT_VERSIONS, engine: ANALYSIS_ENGINE_VERSION, dictionary: METRIC_DICTIONARY_VERSION, schema: CANONICAL_SCHEMA_VERSION }))
    .digest("hex");
}

export async function runDeckAnalysis(inp: RunDeckAnalysisInput): Promise<void> {
  const signal = registerRun(inp.runId);
  try {
    try {
      await acquireSlot(signal);
    } catch {
      repo.finishRun(inp.runId, "CANCELLED", 0, null, "Cancelled while queued");
      repo.setCompanyStatus(inp.companyId, repo.getCompany(inp.workspaceId, inp.companyId)?.currentVersionId ? "READY" : "FAILED");
      return;
    }
    try {
      await execute(inp, signal);
    } finally {
      releaseSlot();
    }
  } finally {
    releaseRun(inp.runId);
  }
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(p: Promise<T>): Promise<Settled<T>> => p.then((value) => ({ ok: true as const, value }), (error) => ({ ok: false as const, error }));

const errReason = (e: unknown) => (e instanceof BudgetExceededError ? "Budget limit" : `Model failure: ${(e as Error).message.slice(0, 160)}`);
const isCancel = (e: unknown, signal: AbortSignal) => e instanceof CancelledError || signal.aborted;

/** Keep deterministic reports small in model context: large reports collapse to their summary. */
function compactReport(r: unknown, max = 12_000): unknown {
  const s = JSON.stringify(r ?? null);
  if (s.length <= max) return r;
  const summary = (r as { summary?: unknown } | null)?.summary;
  return summary ?? { truncated: true, excerpt: s.slice(0, max) };
}

async function execute(inp: RunDeckAnalysisInput, signal: AbortSignal): Promise<void> {
  const log = logger.child({ runId: inp.runId, companyId: inp.companyId, mode: inp.mode });
  const t0 = Date.now();
  const registry = getRegistry();
  const { hardCapUsd, targetUsd } = budgetFor(inp.mode, inp.budgetUsd);
  const cost = new CostController(hardCapUsd, targetUsd, (e) => repo.recordCost(inp.workspaceId, inp.runId, "ANALYSIS", e));
  const step = (s: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string) => repo.updateRunStep(inp.runId, s, status, detail);
  const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
  const tokens = OUTPUT_TOKENS[inp.mode];
  const effort = EFFORT[inp.mode];
  const reservations: Reservation[] = [];
  const reserve = (usd: number) => {
    const r = cost.reserve(usd);
    reservations.push(r);
    return r;
  };

  let deal: CanonicalDeal = emptyCanonical(inp.mode);
  deal.analysis.provenance = {
    model: PRIMARY_MODEL,
    promptVersions: { ...PROMPT_VERSIONS },
    engineVersion: ANALYSIS_ENGINE_VERSION,
    dictionaryVersion: METRIC_DICTIONARY_VERSION,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    inputHash: inputHash(inp.documents, inp.mode),
    startedAt: new Date(t0).toISOString(),
    durationMs: null,
  };
  if (inp.carryOver?.overrides?.length) deal.overrides = structuredClone(inp.carryOver.overrides);
  const skipped: { step: string; reason: string }[] = [];
  const researchNotCompleted: string[] = [];
  let identified = false;

  const saveProgress = (summary: string) => {
    const d = derive(deal, registry, inp.fund);
    repo.saveVersion({ company, canonical: deal, derived: d, reason: "DECK_ANALYSIS", runId: inp.runId, summary, userId: inp.userId, preliminary: true });
    return d;
  };

  try {
    /* ---------------- INGEST ---------------- */
    step("INGEST", "RUNNING");
    const docs: IngestedDoc[] = inp.documents.map((d) => ({ documentId: d.documentId, filename: d.filename, kind: d.kind, pages: d.pages }));
    deal = applyDocuments(deal, docs);
    const pagesText = renderPagesForModel(docs);
    const urlNote = inp.companyUrl ? `\n\nCompany URL provided by the analyst: ${inp.companyUrl}` : "";
    const deckContent = (purpose: "extraction" | "forensics"): InputMessage["content"] => {
      const content: InputMessage["content"] = [{ type: "input_text", text: wrapUntrusted("startup document", pagesText + urlNote) }];
      for (const d of inp.documents) {
        const payload = purpose === "forensics" ? d.forensicsPayload : d.visualPayload;
        if (!payload) continue;
        if (payload.type === "file") content.push({ type: "input_file", filename: payload.filename, file_data: payload.dataUrl });
        else for (const u of payload.dataUrls) content.push({ type: "input_image", image_url: u });
      }
      return content;
    };
    const extraction: InputMessage[] = [{ role: "user", content: deckContent("extraction") }];
    step("INGEST", "DONE", `${docs.length} document(s), ${docs.reduce((a, d) => a + d.pages.length, 0)} pages`);

    // Reserve the T1 calls and indexing up-front so T0 and research cannot starve them.
    const t1Reserve = (maxOut: number) => reserve(worstCaseCost(PRIMARY_MODEL, T1_INPUT_CHARS, maxOut));
    const partIds = Object.keys(ANALYSIS_PARTS) as AnalysisPartId[];
    const resParts = partIds.map(() => t1Reserve(tokens.analysisPart));
    const resThesis = t1Reserve(tokens.thesis);
    const resChallenge = t1Reserve(tokens.challenge);
    const resActions = t1Reserve(tokens.actions);
    const resIndex = reserve(0.004);

    /* ---------------- T0: five parallel reads of the deck ---------------- */
    step("TRIAGE", "RUNNING");
    step("EXTRACT", "RUNNING");
    step("FORENSICS", "RUNNING");
    const common = { cost, signal, cache: true } as const;
    const triageP = structured({ ...common, step: "TRIAGE", promptVersion: TRIAGE.version, instructions: triageInstructions(), input: extraction, schema: TriageOutput, schemaName: "triage", maxOutputTokens: tokens.triage, effort: effort.fast });
    const metricsP = structured({ ...common, step: "EXTRACT_METRICS", promptVersion: EXTRACT_METRICS.version, instructions: metricsExtractionInstructions(), input: extraction, schema: MetricsExtractionOutput, schemaName: "extract_metrics", maxOutputTokens: tokens.metrics, effort: effort.extract });
    const claimsOnlyP = structured({ ...common, step: "EXTRACT_CLAIMS", promptVersion: EXTRACT_CLAIMS.version, instructions: claimsExtractionInstructions(), input: extraction, schema: ClaimsOnlyOutput, schemaName: "extract_claims", maxOutputTokens: tokens.claims, effort: effort.extract });
    const profileP = structured({ ...common, step: "EXTRACT_PROFILE", promptVersion: EXTRACT_PROFILE.version, instructions: profileExtractionInstructions(), input: extraction, schema: ProfileExtractionOutput, schemaName: "extract_profile", maxOutputTokens: tokens.profile, effort: effort.extract });
    // Claims and profile are one logical extraction: both are required for the merged result.
    const claimsP = Promise.all([claimsOnlyP, profileP]).then(([c, p]) => ({ data: { ...c.data, ...p.data } }));
    claimsP.catch(() => undefined);
    const forensicsP = structured({ ...common, step: "FORENSICS", promptVersion: DECK_FORENSICS.version, instructions: forensicsInstructions(), input: [{ role: "user", content: deckContent("forensics") }], schema: ForensicsOutput, schemaName: "deck_forensics", maxOutputTokens: tokens.forensics, effort: effort.extract });
    const latentP = structured({ ...common, step: "LATENT", promptVersion: LATENT_SIGNALS.version, instructions: latentSignalsInstructions(), input: extraction, schema: LatentSignalsOutput, schemaName: "latent_signals", maxOutputTokens: tokens.latent, effort: effort.extract });
    const restT0 = Promise.allSettled([claimsP, metricsP, forensicsP, latentP]);

    let triage: Awaited<typeof triageP>;
    try {
      triage = await triageP;
    } catch (e) {
      await restT0; // let in-flight calls settle so their cost is recorded
      throw e;
    }
    deal = applyTriage(deal, triage.data);
    if (inp.companyUrl && !deal.identity.website) deal.identity.website = inp.companyUrl;
    deal.analysis.completedSteps.push("TRIAGE");
    identified = true;
    repo.renameFromIdentity(inp.companyId, deal.identity.name);
    const prelim = saveProgress("Preliminary: company identified");
    step("TRIAGE", "DONE", `${deal.identity.name} — ${deal.informationGaps.length} information gaps`);

    /* ---------------- RESEARCH (parallel with the rest of T0) ---------------- */
    const clearlyOut = prelim.fundFit.mandate === "FAIL";
    const keyClaims = triage.data.keyClaims;
    const researchP = runResearch();

    async function runResearch() {
      const out: { step: string; result: Awaited<ReturnType<typeof structured<typeof ResearchOutput>>> }[] = [];
      if (inp.mode === "FAST_SCREEN") {
        for (const s of RESEARCH_STEPS) step(s, "SKIPPED", "Fast screen: no external research");
        researchNotCompleted.push("External research not performed (fast screen).");
        return out;
      }
      if (clearlyOut) {
        for (const s of RESEARCH_STEPS) step(s, "SKIPPED", "Outside fund mandate");
        researchNotCompleted.push("External research skipped: company fails a fund mandate gate.");
        skipped.push({ step: "RESEARCH", reason: "Mandate fail — stopping rule" });
        return out;
      }
      const allowance = Math.min(RESEARCH_BUDGET_USD[inp.mode], cost.remainingUsd);
      const rounds = [
        { step: "RESEARCH_COMPANY", targets: ["FOUNDER", "COMPANY", "CUSTOMER", "PRODUCT", "FINANCING"], focus: "founders (findings + founderFindings), material company claims, customers, product, financing" },
        { step: "RESEARCH_MARKET", targets: ["MARKET", "REGULATORY"], focus: "independent market estimates with scope (marketEstimates), market growth, regulation" },
        { step: "RESEARCH_COMPETITION", targets: ["COMPETITOR"], focus: "real competitors — direct, indirect, incumbents, emerging (competitors), and evidence on the company's differentiation claims" },
      ];
      const share = allowance / rounds.length;
      const planned = rounds.map((r) => {
        const gaps = deal.informationGaps
          .filter((g) => g.status === "OPEN" && r.targets.includes(g.target) && g.researchability !== "FOUNDER_ONLY" && g.researchability !== "DATA_ROOM")
          .map((g) => ({ g, idx: researchPriorityIndex(g) }))
          .sort((a, b) => b.idx - a.idx);
        // Stopping rule (§135): low-value research is not run.
        const worth = gaps.filter((x) => x.idx >= 20);
        const alwaysUseful = r.step !== "RESEARCH_COMPANY" || deal.foundersFromDeck.length > 0;
        const input = JSON.stringify({
          focus: r.focus,
          company: { name: deal.identity.name, website: deal.identity.website, hq: deal.identity.hqCountry, oneLiner: deal.identity.oneLiner, classification: deal.classification },
          founders: r.step === "RESEARCH_COMPANY" ? deal.foundersFromDeck : undefined,
          competitorsMentioned: triage.data.competitorsMentioned,
          materialClaims: r.step === "RESEARCH_MARKET" ? undefined : keyClaims.map((k) => ({ id: k.ref, statement: k.statement, unusualness: k.unusualness })),
          prioritizedQuestions: worth.slice(0, 10).map((x) => ({ gapRef: x.g.id, question: x.g.question, why: x.g.whyItMatters, suggestedQueries: x.g.suggestedQueries, researchPriorityIndex: x.idx })),
        });
        const maxSearches = cost.maxSearchesWithin(PRIMARY_MODEL, share, input.length + 6_000, tokens.research, SEARCH_CEILING[inp.mode]);
        return { ...r, worth, input, maxSearches, run: worth.length > 0 || alwaysUseful };
      });
      const results = await Promise.allSettled(
        planned.map(async (r) => {
          if (!r.run) {
            step(r.step, "SKIPPED", "No high-value researchable questions remain");
            return null;
          }
          if (r.maxSearches < 2) {
            step(r.step, "SKIPPED", `Budget: $${share.toFixed(3)} available for this round`);
            skipped.push({ step: r.step, reason: "Budget limit" });
            researchNotCompleted.push(...r.worth.map((x) => x.g.question));
            return null;
          }
          step(r.step, "RUNNING");
          return structured({
            step: r.step,
            promptVersion: RESEARCH.version,
            instructions: researchInstructions(r.maxSearches, r.focus),
            input: [{ role: "user", content: wrapUntrusted("company record extracted from the deck", r.input) }],
            schema: ResearchOutput,
            schemaName: "research",
            maxOutputTokens: tokens.research,
            effort: effort.extract,
            webSearch: { maxCalls: r.maxSearches },
            cost,
            signal,
            maxAttempts: 1,
          });
        }),
      );
      results.forEach((res, i) => {
        const r = planned[i]!;
        if (res.status === "fulfilled") {
          if (res.value) out.push({ step: r.step, result: res.value });
        } else if (!signal.aborted) {
          const reason = res.reason instanceof BudgetExceededError ? "Budget limit" : `Research failed: ${(res.reason as Error).message.slice(0, 160)}`;
          log.warn({ err: (res.reason as Error).message }, "research round failed");
          step(r.step, "FAILED", reason);
          skipped.push({ step: r.step, reason });
          researchNotCompleted.push(...r.worth.map((x) => x.g.question));
        }
      });
      return out;
    }

    /* ---------------- T0 results: claims → metrics → forensics → latent ---------------- */
    const [claimsR, metricsR, forensicsR, latentR] = await restT0;
    throwIfCancelled(signal);
    if (claimsR.status === "rejected" && metricsR.status === "rejected") throw claimsR.reason;
    if (claimsR.status === "fulfilled") deal = applyClaimsExtraction(deal, claimsR.value.data);
    else skipped.push({ step: "EXTRACT_CLAIMS", reason: errReason(claimsR.reason) });
    if (metricsR.status === "fulfilled") deal = applyMetricsExtraction(deal, metricsR.value.data);
    else skipped.push({ step: "EXTRACT_METRICS", reason: errReason(metricsR.reason) });
    const extractOk = claimsR.status === "fulfilled" && metricsR.status === "fulfilled";
    if (extractOk) deal.analysis.completedSteps.push("EXTRACT");
    step("EXTRACT", extractOk ? "DONE" : "FAILED", `${deal.metrics.filter((m) => m.isPrimary).length} metrics, ${deal.claims.length} claims${extractOk ? "" : " (partial)"}`);
    if (forensicsR.status === "fulfilled") deal = applyForensics(deal, forensicsR.value.data);
    else skipped.push({ step: "FORENSICS", reason: errReason(forensicsR.reason) });
    if (latentR.status === "fulfilled") deal = applyLatent(deal, latentR.value.data);
    else skipped.push({ step: "LATENT", reason: errReason(latentR.reason) });
    const t0Ok = forensicsR.status === "fulfilled" && latentR.status === "fulfilled";
    if (t0Ok) deal.analysis.completedSteps.push("FORENSICS");
    step("FORENSICS", t0Ok ? "DONE" : "FAILED", t0Ok ? `${deal.forensics?.visualElements.length ?? 0} visuals read, ${deal.forensics?.crossSlideInconsistencies.length ?? 0} cross-slide inconsistencies` : "Partial: " + skipped.filter((s) => s.step === "FORENSICS" || s.step === "LATENT").map((s) => s.reason).join("; "));
    saveProgress("Preliminary: extraction");

    /* ---------------- research results ---------------- */
    const research = await researchP;
    throwIfCancelled(signal);
    const keyToClaim = linkKeyClaims(keyClaims, deal.claims);
    for (const { step: s, result } of research) {
      const data = {
        ...result.data,
        findings: result.data.findings.map((f) => ({ ...f, relatesToClaimRef: f.relatesToClaimRef ? (keyToClaim.get(f.relatesToClaimRef) ?? f.relatesToClaimRef) : f.relatesToClaimRef })),
      };
      deal = applyResearch(deal, data, { searchSources: result.searchSources, companyWebsite: deal.identity.website });
      deal.analysis.completedSteps.push(s);
      step(s, "DONE", `${result.usage.webSearches} searches, ${result.data.findings.length + result.data.founderFindings.length} findings`);
    }

    /* ---------------- T1: analysis A ‖ B ‖ thesis ‖ actions ---------------- */
    const pre = derive(deal, registry, inp.fund);
    step("ANALYZE", "RUNNING");
    step("DECIDE", "RUNNING");
    const record = wrapUntrusted("canonical record (contains excerpts from untrusted documents and web pages)", JSON.stringify(canonicalForAnalysis(deal)));
    const decisionInput = wrapUntrusted(
      "canonical record, deck forensics, latent signals and deterministic results",
      JSON.stringify({
        record: canonicalForAnalysis(deal),
        forensics: deal.forensics,
        latentSignals: deal.latentSignals,
        deterministic: { ...derivedDigest(pre), integrity: compactReport(pre.integrity), latent: pre.latent.summary, economics: compactReport(pre.economics) },
      }),
    );
    const partCalls = partIds.map((id, k) =>
      structured({ ...common, step: `ANALYZE_${id}`, promptVersion: INVESTMENT_ANALYSIS.version, instructions: analysisPartInstructions(id), input: [{ role: "user", content: record }], schema: AnalysisPartSchemas[id], schemaName: `investment_analysis_${id.toLowerCase()}`, maxOutputTokens: tokens.analysisPart, effort: effort.analysis, reservation: resParts[k] }),
    );
    const thesisC = settle(
      structured({ ...common, step: "DECIDE_THESIS", promptVersion: DECISION_THESIS.version, instructions: thesisInstructions(inp.mode), input: [{ role: "user", content: decisionInput }], schema: ThesisCoreOutput, schemaName: "decision_thesis", maxOutputTokens: tokens.thesis, effort: effort.decide, reservation: resThesis }),
    );
    const challengeC = settle(
      structured({ ...common, step: "DECIDE_CHALLENGE", promptVersion: DECISION_CHALLENGE.version, instructions: challengeInstructions(inp.mode), input: [{ role: "user", content: decisionInput }], schema: ChallengeOutput, schemaName: "decision_challenge", maxOutputTokens: tokens.challenge, effort: effort.decide, reservation: resChallenge }),
    );
    const actionsC = settle(
      structured({ ...common, step: "DECIDE_ACTIONS", promptVersion: DECISION_ACTIONS.version, instructions: actionsInstructions(inp.mode), input: [{ role: "user", content: decisionInput }], schema: ActionsOutput, schemaName: "decision_actions", maxOutputTokens: tokens.actions, effort: effort.decide, reservation: resActions }),
    );
    const [partsR, thesisR, challengeR, actionsR] = await Promise.all([Promise.allSettled(partCalls), thesisC, challengeC, actionsC]);
    for (const r of [...resParts, resThesis, resChallenge, resActions]) cost.release(r);
    throwIfCancelled(signal);

    // Merge the analysis parts. A failed part leaves its sections empty and is reported — never invented.
    const merged = mergeAnalysisParts(deal, partIds.map((id, k) => ({ id, result: partsR[k]! })));
    deal = applyInvestmentAnalysis(deal, merged.output);
    if (merged.failed.length === 0) {
      deal.analysis.completedSteps.push("ANALYZE");
      step("ANALYZE", "DONE", `${deal.risks.length} risks, ${deal.rubric.length} rubric ratings`);
    } else {
      const reason = merged.failed.map((f) => `${f.id}: ${f.reason}`).join("; ");
      step("ANALYZE", "FAILED", reason);
      skipped.push({ step: "ANALYZE", reason });
    }
    if (thesisR.ok && challengeR.ok) deal = applyThesis(deal, { ...thesisR.value.data, ...challengeR.value.data });
    else if (thesisR.ok) deal = applyThesis(deal, { ...thesisR.value.data, revealedBeyondPitch: [], redTeam: deal.redTeam as never, alternativeExplanations: [] });
    if (!thesisR.ok) skipped.push({ step: "DECIDE_THESIS", reason: errReason(thesisR.error) });
    if (!challengeR.ok) skipped.push({ step: "DECIDE_CHALLENGE", reason: errReason(challengeR.error) });
    if (actionsR.ok) deal = applyActions(deal, actionsR.value.data);
    else skipped.push({ step: "DECIDE_ACTIONS", reason: errReason(actionsR.error) });
    const decideOk = thesisR.ok && challengeR.ok && actionsR.ok;
    if (decideOk) deal.analysis.completedSteps.push("DECIDE");
    step("DECIDE", decideOk ? "DONE" : "FAILED", decideOk ? `${deal.questions.length} founder questions, ${deal.sensitivityDrivers.length} sensitivity drivers` : skipped.filter((s) => s.step.startsWith("DECIDE")).map((s) => s.reason).join("; "));

    /* ---------------- MEMO: finalize canonical + deterministic layer ---------------- */
    step("MEMO", "RUNNING");
    const derived = finalize(deal, { inp, skipped, researchNotCompleted, clearlyOut, t0 });
    const version = repo.saveVersion({
      company,
      canonical: deal,
      derived,
      reason: "DECK_ANALYSIS",
      runId: inp.runId,
      summary: `${inp.mode} analysis (${deal.analysis.depth}) — ${derived.recommendation.status}`,
      userId: inp.userId,
    });
    repo.addHistory({
      workspaceId: inp.workspaceId,
      companyId: inp.companyId,
      type: "ANALYSIS_COMPLETED",
      versionId: version.id,
      summary: `${inp.mode.replace("_", " ").toLowerCase()} analysis ${deal.analysis.depth.toLowerCase()} → ${derived.recommendation.status}`,
      userId: inp.userId,
      payload: { spentUsd: cost.spentUsd, durationMs: deal.analysis.provenance?.durationMs ?? null },
    });
    step("MEMO", "DONE");

    /* ---------------- INDEX (Fund Brain) ---------------- */
    step("INDEX", "RUNNING");
    cost.release(resIndex);
    try {
      const stats = await indexCompanyForBrain({ workspaceId: inp.workspaceId, companyId: inp.companyId, versionId: version.id, canonical: deal, derived, cost });
      step("INDEX", "DONE", `${stats.chunks} chunks, ${stats.embedded} embedded, ${stats.facts} facts`);
    } catch (e) {
      log.error({ err: (e as Error).message }, "indexing failed");
      step("INDEX", "FAILED", (e as Error).message.slice(0, 160));
    }

    repo.finishRun(inp.runId, deal.analysis.depth === "FULL" ? "COMPLETED" : "PARTIAL", cost.spentUsd, deal.analysis.depth);
    log.info({ spentUsd: cost.spentUsd, depth: deal.analysis.depth, ms: Date.now() - t0 }, "analysis finished");
  } catch (e) {
    for (const r of reservations) cost.release(r);
    if (isCancel(e, signal)) {
      log.info("analysis cancelled");
      if (identified) {
        deal.analysis.cancelled = true;
        const d = finalize(deal, { inp, skipped: [...skipped, { step: "RUN", reason: "Cancelled by user" }], researchNotCompleted, clearlyOut: false, t0 });
        repo.saveVersion({ company, canonical: deal, derived: d, reason: "DECK_ANALYSIS", runId: inp.runId, summary: `${inp.mode} analysis cancelled (partial)`, userId: inp.userId, preliminary: true });
      }
      repo.finishRun(inp.runId, "CANCELLED", cost.spentUsd, identified ? "PARTIAL" : null, "Cancelled by user");
      repo.setCompanyStatus(inp.companyId, company.currentVersionId || identified ? "READY" : "FAILED");
      return;
    }
    const msg = e instanceof BudgetExceededError ? e.message : `Analysis failed: ${(e as Error).message}`;
    log.error({ err: (e as Error).message }, "analysis failed");
    repo.finishRun(inp.runId, "FAILED", cost.spentUsd, null, msg);
    repo.setCompanyStatus(inp.companyId, company.currentVersionId || identified ? "READY" : "FAILED");
  }
}

const MANDATORY = new Set(["ANALYZE", "DECIDE_THESIS", "DECIDE_CHALLENGE", "DECIDE_ACTIONS", "EXTRACT_CLAIMS", "EXTRACT_METRICS", "RUN"]);

/** Mutates the analysis state (depth, partial reasons, unknowns, duration) and returns the deterministic layer. */
function finalize(
  deal: CanonicalDeal,
  ctx: { inp: RunDeckAnalysisInput; skipped: { step: string; reason: string }[]; researchNotCompleted: string[]; clearlyOut: boolean; t0: number },
): DerivedAnalysis {
  const { inp, skipped } = ctx;
  const mandatorySkipped = skipped.some((s) => MANDATORY.has(s.step));
  const researchIncomplete = inp.mode !== "FAST_SCREEN" && !ctx.clearlyOut && skipped.some((s) => s.step.startsWith("RESEARCH"));
  deal.analysis.depth = !mandatorySkipped && !researchIncomplete && inp.mode !== "FAST_SCREEN" ? "FULL" : "PARTIAL";
  deal.analysis.skippedSteps = skipped;
  deal.analysis.partialReasons = [...(inp.mode === "FAST_SCREEN" ? ["Fast screen — not full diligence"] : []), ...skipped.map((s) => `${s.step}: ${s.reason}`)];
  deal.analysis.researchNotCompleted = [...new Set(ctx.researchNotCompleted)];
  deal.analysis.unresolved = deal.informationGaps.filter((g) => g.status !== "RESOLVED").map((g) => g.question);
  deal.analysis.expectedNextActions = [
    ...(deal.nextBestAction ? [deal.nextBestAction.action] : []),
    ...(deal.analysis.depth === "PARTIAL" && inp.mode === "STANDARD" ? ["Re-run research with additional budget or proceed to founder call"] : []),
  ];
  if (deal.analysis.provenance) deal.analysis.provenance.durationMs = Date.now() - ctx.t0;
  return derive(deal, getRegistry(), inp.fund);
}

/** Assemble the four analysis parts into one output; missing sections stay empty/null and are reported. */
function mergeAnalysisParts(deal: CanonicalDeal, parts: { id: AnalysisPartId; result: PromiseSettledResult<{ data: Partial<InvestmentAnalysisOutput> }> }[]) {
  const out: InvestmentAnalysisOutput = {
    founders: [],
    product: deal.product as never,
    pain: null as never,
    customers: deal.customers as never,
    pmf: null as never,
    market: null as never,
    competition: null as never,
    moat: [],
    gtm: null as never,
    economicsNotes: "",
    financingPath: null as never,
    risks: [],
    rubric: [],
    exitAssumptions: [],
    arpaAssumptionUsd: null,
  };
  const failed: { id: AnalysisPartId; reason: string }[] = [];
  for (const { id, result } of parts) {
    if (result.status === "rejected") {
      failed.push({ id, reason: errReason(result.reason) });
      continue;
    }
    const allowed = new Set<string>(ANALYSIS_PARTS[id].rubric);
    const { rubric = [], ...sections } = result.value.data;
    Object.assign(out, sections);
    // Each part may only rate its own criteria; the first rating of a criterion wins.
    for (const r of rubric) if (allowed.has(r.criterion) && !out.rubric.some((x) => x.criterion === r.criterion)) out.rubric.push(r);
  }
  return { output: out, failed };
}
