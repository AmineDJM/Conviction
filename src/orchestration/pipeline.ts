/**
 * §133 Analysis workflow orchestration.
 *
 * Luna-first: four structured passes (understanding, adaptive research,
 * investment analysis, red team) + deterministic Layer A + Fund Brain
 * indexing. Every call is budget-authorized; failures and budget limits
 * degrade to an explicit PARTIAL analysis — never to hallucinated results.
 */
import { CostController, BudgetExceededError, MODE_BUDGETS, ABSOLUTE_STANDARD_CAP_USD } from "@/ai/cost";
import { structured, PRIMARY_MODEL, type InputMessage } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { worstCaseCost } from "@/ai/pricing";
import { DeckUnderstandingOutput, deckUnderstandingInstructions, DECK_UNDERSTANDING } from "@/ai/prompts/deck-understanding";
import { ResearchOutput, researchInstructions, RESEARCH } from "@/ai/prompts/research";
import { AnalysisPartA, AnalysisPartB, analysisPartInstructions, INVESTMENT_ANALYSIS } from "@/ai/prompts/investment-analysis";
import { RedTeamOutput, redTeamInstructions, RED_TEAM } from "@/ai/prompts/red-team";
import { emptyCanonical, type CanonicalDeal } from "@/domain/canonical";
import type { AnalysisMode } from "@/domain/enums";
import type { FundProfile } from "@/domain/fund";
import { derive, researchPriorityIndex } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { renderPagesForModel, type ExtractedDocument } from "@/ingestion/extract";
import { applyDeckUnderstanding, applyInvestmentAnalysis, applyRedTeam, applyResearch, type IngestedDoc } from "./assemble";
import { canonicalForAnalysis, derivedDigest } from "./context";
import * as repo from "@/server/repo";
import { indexCompanyForBrain } from "@/brain/indexer";
import { logger } from "@/lib/log";

export const PIPELINE_STEPS = [
  { step: "INGEST", label: "Reading deck" },
  { step: "EXTRACT", label: "Extracting metrics and claims" },
  { step: "RESEARCH_COMPANY", label: "Researching founders and claims" },
  { step: "RESEARCH_MARKET", label: "Mapping market and competitors" },
  { step: "ANALYZE", label: "Analyzing founders, product and market" },
  { step: "RETURNS", label: "Modeling returns" },
  { step: "RED_TEAM", label: "Stress-testing the thesis" },
  { step: "MEMO", label: "Preparing Quick Memo" },
  { step: "INDEX", label: "Building deal memory" },
] as const;

const OUTPUT_TOKENS = {
  FAST_SCREEN: { extract: 16_000, research: 0, analysis: 16_000, redTeam: 9_000 },
  STANDARD: { extract: 24_000, research: 10_000, analysis: 26_000, redTeam: 14_000 },
  DEEP_DD: { extract: 32_000, research: 14_000, analysis: 32_000, redTeam: 18_000 },
} as const;

const EFFORT = {
  FAST_SCREEN: { extract: "low", research: "low", analysis: "low", redTeam: "low" },
  STANDARD: { extract: "low", research: "low", analysis: "medium", redTeam: "medium" },
  DEEP_DD: { extract: "medium", research: "medium", analysis: "high", redTeam: "high" },
} as const;

const SEARCH_CEILING = { FAST_SCREEN: 0, STANDARD: 8, DEEP_DD: 24 } as const;

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
}

export function budgetFor(mode: AnalysisMode, requested?: number) {
  const b = MODE_BUDGETS[mode];
  const hard = Math.min(requested ?? b.hardCapUsd, mode === "STANDARD" ? ABSOLUTE_STANDARD_CAP_USD : b.hardCapUsd);
  return { hardCapUsd: hard, targetUsd: Math.min(b.targetUsd, hard) };
}

export async function runDeckAnalysis(inp: RunDeckAnalysisInput): Promise<void> {
  const log = logger.child({ runId: inp.runId, companyId: inp.companyId, mode: inp.mode });
  const registry = getRegistry();
  const { hardCapUsd, targetUsd } = budgetFor(inp.mode, inp.budgetUsd);
  const cost = new CostController(hardCapUsd, targetUsd, (e) => repo.recordCost(inp.workspaceId, inp.runId, "ANALYSIS", e));
  const step = (s: string, status: "RUNNING" | "DONE" | "SKIPPED" | "FAILED", detail?: string) => repo.updateRunStep(inp.runId, s, status, detail);
  const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
  const tokens = OUTPUT_TOKENS[inp.mode];
  const effort = EFFORT[inp.mode];

  let deal: CanonicalDeal = emptyCanonical(inp.mode);
  const skipped: { step: string; reason: string }[] = [];
  const researchNotCompleted: string[] = [];

  try {
    /* ---------------- INGEST ---------------- */
    step("INGEST", "RUNNING");
    const docs: IngestedDoc[] = inp.documents.map((d) => ({ documentId: d.documentId, filename: d.filename, kind: d.kind, pages: d.pages }));
    const pagesText = renderPagesForModel(docs);
    step("INGEST", "DONE", `${docs.length} document(s), ${docs.reduce((a, d) => a + d.pages.length, 0)} pages`);

    // Reserve budget for the mandatory later passes so research cannot starve them.
    const partTokens = Math.ceil(tokens.analysis * 0.6);
    const reserveAnalysisA = cost.reserve(worstCaseCost(PRIMARY_MODEL, 72_000, partTokens));
    const reserveAnalysisB = cost.reserve(worstCaseCost(PRIMARY_MODEL, 72_000, partTokens));
    const reserveRedTeam = cost.reserve(worstCaseCost(PRIMARY_MODEL, 60_000, tokens.redTeam));
    const reserveIndex = cost.reserve(0.004);

    /* ---------------- EXTRACT (deck_understanding_v1) ---------------- */
    step("EXTRACT", "RUNNING");
    const content: InputMessage["content"] = [
      { type: "input_text", text: wrapUntrusted("startup document", pagesText + (inp.companyUrl ? `\n\nCompany URL provided by the analyst: ${inp.companyUrl}` : "")) },
    ];
    for (const d of inp.documents) {
      if (!d.visualPayload) continue;
      if (d.visualPayload.type === "file") content.push({ type: "input_file", filename: d.visualPayload.filename, file_data: d.visualPayload.dataUrl });
      else for (const u of d.visualPayload.dataUrls) content.push({ type: "input_image", image_url: u });
    }
    const understanding = await structured({
      step: "EXTRACT",
      promptVersion: DECK_UNDERSTANDING.version,
      instructions: deckUnderstandingInstructions(),
      input: [{ role: "user", content }],
      schema: DeckUnderstandingOutput,
      schemaName: "deck_understanding",
      maxOutputTokens: tokens.extract,
      effort: effort.extract,
      cost,
    });
    deal = applyDeckUnderstanding(deal, understanding.data, docs);
    if (inp.companyUrl && !deal.identity.website) deal.identity.website = inp.companyUrl;
    deal.analysis.completedSteps.push("EXTRACT");
    step("EXTRACT", "DONE", `${deal.metrics.filter((m) => m.isPrimary).length} metrics, ${deal.claims.length} claims`);

    // Preliminary version: the user sees company understanding before the full analysis finishes (§110).
    repo.renameFromIdentity(inp.companyId, deal.identity.name);
    const prelim = derive(deal, registry, inp.fund);
    repo.saveVersion({ company, canonical: deal, derived: prelim, reason: "DECK_ANALYSIS", runId: inp.runId, summary: "Preliminary: deck understanding", userId: inp.userId, preliminary: true });

    /* ---------------- RESEARCH (research_v1), adaptive and budgeted ---------------- */
    const clearlyOut = prelim.fundFit.mandate === "FAIL";
    if (inp.mode === "FAST_SCREEN") {
      for (const s of ["RESEARCH_COMPANY", "RESEARCH_MARKET"]) step(s, "SKIPPED", "Fast screen: no external research");
      researchNotCompleted.push("External research not performed (fast screen).");
    } else if (clearlyOut) {
      for (const s of ["RESEARCH_COMPANY", "RESEARCH_MARKET"]) step(s, "SKIPPED", "Outside fund mandate");
      researchNotCompleted.push("External research skipped: company fails a fund mandate gate.");
      skipped.push({ step: "RESEARCH", reason: "Mandate fail — stopping rule" });
    } else {
      const rounds = [
        { step: "RESEARCH_COMPANY", targets: ["FOUNDER", "COMPANY", "CUSTOMER", "PRODUCT", "FINANCING"], share: 0.5 },
        { step: "RESEARCH_MARKET", targets: ["MARKET", "COMPETITOR", "REGULATORY"], share: 0.5 },
      ];
      // Plan both rounds against the same budget snapshot, then run them in parallel.
      const researchAllowance = cost.remainingTargetUsd;
      const planned = rounds.map((r) => {
        const gaps = deal.informationGaps
          .filter((g) => g.status === "OPEN" && r.targets.includes(g.target) && g.researchability !== "FOUNDER_ONLY" && g.researchability !== "DATA_ROOM")
          .map((g) => ({ g, idx: researchPriorityIndex(g) }))
          .sort((a, b) => b.idx - a.idx);
        // Stopping rule (§135): low-value research is not run.
        const worth = gaps.filter((x) => x.idx >= 20);
        const alwaysUseful = r.step === "RESEARCH_MARKET" || deal.foundersFromDeck.length > 0;
        const input = JSON.stringify({
          focus: r.step === "RESEARCH_COMPANY" ? "Founders, company claims, customers, product, financing" : "Market sizing, competitors, regulation",
          company: { name: deal.identity.name, website: deal.identity.website, hq: deal.identity.hqCountry, oneLiner: deal.identity.oneLiner, classification: deal.classification },
          founders: r.step === "RESEARCH_COMPANY" ? deal.foundersFromDeck : deal.foundersFromDeck.map((f) => f.name),
          competitorsMentioned: understanding.data.competitorsMentioned,
          materialClaims: deal.claims.filter((c) => c.material).map((c) => ({ id: c.id, category: c.category, statement: c.statement })).slice(0, 60),
          prioritizedQuestions: worth.slice(0, 10).map((x) => ({ gapRef: x.g.id, question: x.g.question, why: x.g.whyItMatters, suggestedQueries: x.g.suggestedQueries, researchPriorityIndex: x.idx })),
        });
        const maxSearches = cost.maxSearchesWithin(PRIMARY_MODEL, researchAllowance * r.share, input.length + 6_000, tokens.research, SEARCH_CEILING[inp.mode]);
        return { ...r, worth, input, maxSearches, run: worth.length > 0 || alwaysUseful };
      });
      const results = await Promise.allSettled(
        planned.map(async (r) => {
          if (!r.run) {
            step(r.step, "SKIPPED", "No high-value researchable questions remain");
            return null;
          }
          if (r.maxSearches < 2) {
            step(r.step, "SKIPPED", `Budget: $${(researchAllowance * r.share).toFixed(3)} available for this round`);
            skipped.push({ step: r.step, reason: "Budget limit" });
            researchNotCompleted.push(...r.worth.map((x) => x.g.question));
            return null;
          }
          step(r.step, "RUNNING");
          return structured({
            step: r.step,
            promptVersion: RESEARCH.version,
            instructions: researchInstructions(r.maxSearches),
            input: [{ role: "user", content: wrapUntrusted("company record extracted from the deck", r.input) }],
            schema: ResearchOutput,
            schemaName: "research",
            maxOutputTokens: tokens.research,
            effort: effort.research,
            webSearch: { maxCalls: r.maxSearches },
            cost,
            maxAttempts: 1,
          });
        }),
      );
      results.forEach((res, i) => {
        const r = planned[i]!;
        if (res.status === "fulfilled") {
          if (!res.value) return;
          deal = applyResearch(deal, res.value.data, { searchSources: res.value.searchSources, companyWebsite: deal.identity.website });
          deal.analysis.completedSteps.push(r.step);
          step(r.step, "DONE", `${res.value.usage.webSearches} searches, ${res.value.data.findings.length + res.value.data.founderFindings.length} findings`);
        } else {
          const e = res.reason as Error;
          const reason = e instanceof BudgetExceededError ? "Budget limit" : `Research failed: ${e.message.slice(0, 160)}`;
          log.warn({ err: e.message }, "research round failed");
          step(r.step, "FAILED", reason);
          skipped.push({ step: r.step, reason });
          researchNotCompleted.push(...r.worth.map((x) => x.g.question));
        }
      });
    }

    /* ---------------- ANALYZE (investment_analysis_v2: two parallel parts) ---------------- */
    step("ANALYZE", "RUNNING");
    const record = wrapUntrusted("canonical record (contains excerpts from untrusted documents and web pages)", JSON.stringify(canonicalForAnalysis(deal)));
    const [partA, partB] = await Promise.allSettled([
      structured({
        step: "ANALYZE_A",
        promptVersion: INVESTMENT_ANALYSIS.version,
        instructions: analysisPartInstructions("A"),
        input: [{ role: "user", content: record }],
        schema: AnalysisPartA,
        schemaName: "investment_analysis_a",
        maxOutputTokens: partTokens,
        effort: effort.analysis,
        cost,
        reservation: reserveAnalysisA,
      }),
      structured({
        step: "ANALYZE_B",
        promptVersion: INVESTMENT_ANALYSIS.version,
        instructions: analysisPartInstructions("B"),
        input: [{ role: "user", content: record }],
        schema: AnalysisPartB,
        schemaName: "investment_analysis_b",
        maxOutputTokens: partTokens,
        effort: effort.analysis,
        cost,
        reservation: reserveAnalysisB,
      }),
    ]);
    cost.release(reserveAnalysisA);
    cost.release(reserveAnalysisB);
    if (partA.status === "fulfilled" && partB.status === "fulfilled") {
      const a = partA.value.data;
      const b = partB.value.data;
      deal = applyInvestmentAnalysis(deal, { ...a, ...b, rubric: [...a.rubric, ...b.rubric.filter((r) => !a.rubric.some((x) => x.criterion === r.criterion))] });
      deal.analysis.completedSteps.push("ANALYZE");
      step("ANALYZE", "DONE", `${deal.risks.length} risks, ${deal.rubric.length} rubric ratings`);
    } else {
      const errs = [partA, partB].filter((p): p is PromiseRejectedResult => p.status === "rejected").map((p) => p.reason as Error);
      const reason = errs.some((e) => e instanceof BudgetExceededError) ? "Budget limit" : `Model failure: ${errs.map((e) => e.message.slice(0, 120)).join("; ")}`;
      // Keep whichever half succeeded — partial analysis is labelled, never invented.
      if (partA.status === "fulfilled") {
        const a = partA.value.data;
        deal = applyInvestmentAnalysis(deal, { ...a, market: null as never, competition: null as never, moat: [], financingPath: null as never, risks: [], exitAssumptions: [], arpaAssumptionUsd: null });
      } else if (partB.status === "fulfilled") {
        const b = partB.value.data;
        deal = applyInvestmentAnalysis(deal, { ...b, founders: [], product: deal.product as never, pain: null as never, customers: deal.customers as never, pmf: null as never, gtm: null as never, economicsNotes: "" });
      }
      step("ANALYZE", "FAILED", reason);
      skipped.push({ step: "ANALYZE", reason });
    }

    /* ---------------- RETURNS (deterministic) ---------------- */
    step("RETURNS", "RUNNING");
    let derived = derive(deal, registry, inp.fund);
    step("RETURNS", "DONE", derived.returns.modelable ? `Base case ${derived.returns.scenarios.find((s) => s.scenario === "BASE")?.grossMoic?.toFixed(1)}x gross` : "Entry valuation unknown");

    /* ---------------- RED TEAM (red_team_v1) ---------------- */
    step("RED_TEAM", "RUNNING");
    try {
      const rt = await structured({
        step: "RED_TEAM",
        promptVersion: RED_TEAM.version,
        instructions: redTeamInstructions(inp.mode),
        input: [
          {
            role: "user",
            content: wrapUntrusted(
              "canonical record and deterministic results",
              JSON.stringify({
                record: canonicalForAnalysis(deal),
                analysis: {
                  founders: deal.founders.map((f) => ({ name: f.name, role: f.role, summary: f.summary, fit: f.founderMarketFit })),
                  product: deal.product,
                  pain: deal.pain,
                  pmf: deal.pmf,
                  market: deal.market,
                  competition: deal.competition,
                  moat: deal.moat,
                  gtm: deal.gtm,
                  financingPath: deal.financingPath,
                  risks: deal.risks,
                },
                deterministic: derivedDigest(derived),
              }),
            ),
          },
        ],
        schema: RedTeamOutput,
        schemaName: "red_team",
        maxOutputTokens: tokens.redTeam,
        effort: effort.redTeam,
        cost,
        reservation: reserveRedTeam,
      });
      deal = applyRedTeam(deal, rt.data);
      deal.analysis.completedSteps.push("RED_TEAM");
      step("RED_TEAM", "DONE", `${deal.questions.length} founder questions`);
    } catch (e) {
      cost.release(reserveRedTeam);
      const reason = e instanceof BudgetExceededError ? "Budget limit" : `Model failure: ${(e as Error).message.slice(0, 160)}`;
      step("RED_TEAM", "FAILED", reason);
      skipped.push({ step: "RED_TEAM", reason });
    }

    /* ---------------- MEMO: finalize canonical + deterministic layer ---------------- */
    step("MEMO", "RUNNING");
    const mandatorySkipped = skipped.filter((s) => s.step === "ANALYZE" || s.step === "RED_TEAM");
    const researchIncomplete = inp.mode !== "FAST_SCREEN" && !clearlyOut && skipped.some((s) => s.step.startsWith("RESEARCH"));
    deal.analysis.depth = mandatorySkipped.length === 0 && !researchIncomplete && inp.mode !== "FAST_SCREEN" ? "FULL" : "PARTIAL";
    deal.analysis.skippedSteps = skipped;
    deal.analysis.partialReasons = [
      ...(inp.mode === "FAST_SCREEN" ? ["Fast screen — not full diligence"] : []),
      ...skipped.map((s) => `${s.step}: ${s.reason}`),
    ];
    deal.analysis.researchNotCompleted = [...new Set(researchNotCompleted)];
    deal.analysis.unresolved = deal.informationGaps.filter((g) => g.status !== "RESOLVED").map((g) => g.question);
    deal.analysis.expectedNextActions = [
      ...(deal.nextBestAction ? [deal.nextBestAction.action] : []),
      ...(deal.analysis.depth === "PARTIAL" && inp.mode === "STANDARD" ? ["Re-run research with additional budget or proceed to founder call"] : []),
    ];
    derived = derive(deal, registry, inp.fund);
    const version = repo.saveVersion({
      company,
      canonical: deal,
      derived,
      reason: "DECK_ANALYSIS",
      runId: inp.runId,
      summary: `${inp.mode} analysis (${deal.analysis.depth}) — ${derived.recommendation.status}`,
      userId: inp.userId,
    });
    repo.addHistory({ workspaceId: inp.workspaceId, companyId: inp.companyId, type: "ANALYSIS_COMPLETED", versionId: version.id, summary: `${inp.mode.replace("_", " ").toLowerCase()} analysis ${deal.analysis.depth.toLowerCase()} → ${derived.recommendation.status}`, userId: inp.userId, payload: { spentUsd: cost.spentUsd } });
    step("MEMO", "DONE");

    /* ---------------- INDEX (Fund Brain) ---------------- */
    step("INDEX", "RUNNING");
    cost.release(reserveIndex);
    try {
      const stats = await indexCompanyForBrain({ workspaceId: inp.workspaceId, companyId: inp.companyId, versionId: version.id, canonical: deal, derived, cost });
      step("INDEX", "DONE", `${stats.chunks} chunks, ${stats.embedded} embedded, ${stats.facts} facts`);
    } catch (e) {
      log.error({ err: (e as Error).message }, "indexing failed");
      step("INDEX", "FAILED", (e as Error).message.slice(0, 160));
    }

    repo.finishRun(inp.runId, deal.analysis.depth === "FULL" ? "COMPLETED" : "PARTIAL", cost.spentUsd, deal.analysis.depth);
    log.info({ spentUsd: cost.spentUsd, depth: deal.analysis.depth }, "analysis finished");
  } catch (e) {
    const msg = e instanceof BudgetExceededError ? e.message : `Analysis failed: ${(e as Error).message}`;
    log.error({ err: (e as Error).message }, "analysis failed");
    repo.finishRun(inp.runId, "FAILED", cost.spentUsd, null, msg);
    repo.setCompanyStatus(inp.companyId, company.currentVersionId || deal.analysis.completedSteps.length ? "READY" : "FAILED");
  }
}
