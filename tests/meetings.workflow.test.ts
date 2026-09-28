/**
 * Founder meeting workflow, end to end against a temporary SQLite database and
 * encrypted storage. Model calls are mocked (no network): `structured` returns a
 * fixed founder_call_update_v3 extraction, or fails, per test.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-meetings-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  for (const k of ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]) delete process.env[k];
  return dir;
});

vi.mock("@/ai/openai", async (orig) => {
  const m = await orig<typeof import("@/ai/openai")>();
  return {
    ...m,
    structured: vi.fn(async () => {
      throw new Error("structured() not stubbed for this test");
    }),
    embed: vi.fn(async () => {
      throw new Error("no network in tests");
    }),
  };
});
vi.mock("@/brain/indexer", async (orig) => ({
  ...(await orig<typeof import("@/brain/indexer")>()),
  indexCompanyForBrain: vi.fn(async () => ({ chunks: 0, embedded: 0, facts: 0 })),
}));

import fs from "node:fs";
import { eq } from "drizzle-orm";
import { structured } from "@/ai/openai";
import { getDb, schema } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { readStoredFile } from "@/server/storage";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import type { CanonicalDeal, Claim } from "@/domain/canonical";
import { PostMeetingBrief, PreMeetingBrief } from "@/domain/meetings";
import type { FounderCallOutput } from "@/ai/prompts/founder-call";
import { startFounderCall } from "@/orchestration/founder-call";
import { ensurePreMeetingBrief } from "@/orchestration/pre-meeting-brief";
import { applyFounderCall, guardRating, recomputeVerification, type MeetingGuard } from "@/orchestration/assemble";
import { parseTranscript } from "@/ingestion/transcript";
import { meetingDiff } from "@/reports/meeting-diff";
import { buildPreMeetingBrief, orientAnswers } from "@/reports/meeting-briefs";
import { connectorStatuses } from "@/server/connectors/meeting-connectors";
import { makeDeal, metric } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const mocked = vi.mocked(structured);
const at = "2026-09-01T00:00:00.000Z";

function claim(id: string, statement: string, category: Claim["category"] = "METRIC"): Claim {
  return {
    id,
    category,
    statement,
    valueText: null,
    entity: "company",
    period: null,
    material: true,
    unusualness: 2,
    proposition: null,
    evidenceNeeded: null,
    origin: "COMPANY",
    verification: "UNVERIFIED",
    freshness: "CURRENT",
    independence: "COMPANY_DERIVED",
    verificationMethod: "Stated in company materials",
    limitations: null,
    contradictions: [],
    evidence: [{ sourceId: "SRC-001", effect: "ORIGIN", excerpt: statement, location: "p. 6", note: null }],
    history: [{ at, change: "CREATED", note: "Extracted from deck" }],
  };
}

/** A deal with the objects a meeting touches: claims, CAC metric, questions, gaps, risks, founders, thesis. */
function richDeal(): CanonicalDeal {
  const d = makeDeal();
  d.sources = [{ id: "SRC-001", kind: "DOCUMENT", title: "deck.pdf", url: null, documentId: null, publisher: "Acme AI", publishedDate: null, retrievedAt: at, origin: "COMPANY", independenceGroup: "COMPANY", citationVerified: true }];
  d.claims = [claim("CLM-001", "Blended CAC is $18k per new customer"), claim("CLM-002", "Enterprise pipeline of $4M", "CUSTOMER"), claim("CLM-003", "No customer churned in 2025", "CUSTOMER"), claim("CLM-004", "Gross margin is 76%", "FINANCIAL")];
  d.metrics.push(metric("cac", 18_000, { id: "MET-CAC", claimId: "CLM-001", rawValue: "$18k", definitionUsed: "blended" }));
  d.rubric = d.rubric.map((r) => (r.criterion === "CHANNEL_SCALABILITY" ? { ...r, rating: "INSUFFICIENT_EVIDENCE" } : r));
  d.founders = [
    {
      id: "FDR-01",
      name: "Maya Chen",
      role: "CEO",
      summary: "Former operator",
      timeline: [],
      publicWork: [],
      capabilities: [
        { dimension: "COMMERCIAL_CAPABILITY", relevant: true, rating: "ADEQUATE", observability: "INFERRED", evidence: "deck", claimRefs: [] },
        { dimension: "COMMUNICATION_INTELLECTUAL_HONESTY", relevant: true, rating: "INSUFFICIENT_EVIDENCE", observability: "NOT_OBSERVABLE", evidence: "not observable", claimRefs: [] },
      ],
      founderMarketFit: "Ran AP at a mid-market firm",
      notObservableWithoutInterview: ["candour"],
      backgroundFromDeck: "Ran AP at a mid-market firm",
      priorOrganizations: [],
      publicProfileUrls: [],
      researchFindingSourceIds: [],
    },
  ];
  d.questions = [
    {
      id: "Q-01",
      question: "Who closes enterprise deals today?",
      tier: "MUST_ASK",
      whyItMatters: "Enterprise GTM scalability decides the Series A thesis.",
      knownContext: "Deck shows 92 paying customers; no sales team slide.",
      ifAnswerA: "A repeatable AE-led motion supports scaling; proceed to DEEP_DD.",
      ifAnswerB: "CEO-dependent sales is a concern and lowers conviction on GTM scalability.",
      affects: ["RECOMMENDATION"],
      status: "OPEN",
      answer: null,
      answeredAt: null,
      resolutionNote: null,
    },
    {
      id: "Q-02",
      question: "What does the $18k CAC include?",
      tier: "IMPORTANT",
      whyItMatters: "Payback depends on the CAC definition.",
      knownContext: "Deck states CAC $18k, definition not given.",
      ifAnswerA: "Fully loaded CAC confirms 14-month payback; supports the economics case.",
      ifAnswerB: "Partial CAC means payback is longer; weakens the economics case.",
      affects: ["VALUATION"],
      status: "OPEN",
      answer: null,
      answeredAt: null,
      resolutionNote: null,
    },
  ];
  d.informationGaps = [
    { id: "GAP-01", question: "Sales team composition and quota attainment", whyItMatters: "GTM scalability", target: "COMPANY", decisionImportance: 5, uncertainty: 5, researchability: "FOUNDER_ONLY", suggestedQueries: [], status: "NEEDS_FOUNDER", resolutionNote: null },
  ];
  const risk = (id: string, title: string, category: "GTM" | "FINANCING", severity: "HIGH" | "MODERATE", likelihood: "HIGH" | "MODERATE", weaknessClass: "THESIS_KILLING" | "REPAIRABLE") => ({
    id,
    category,
    title,
    description: `${title} description`,
    severity,
    likelihood,
    timing: "NEXT_12_MONTHS" as const,
    mitigation: "",
    evidence: "deck",
    claimRefs: [],
    weaknessClass,
    repair: null,
  });
  d.risks = [risk("RSK-01", "Founder-led sales dependency", "GTM", "HIGH", "MODERATE", "THESIS_KILLING"), risk("RSK-02", "Bridge financing need", "FINANCING", "HIGH", "HIGH", "REPAIRABLE")];
  d.thesis = {
    bet: "AP automation for the mid-market with a self-serve wedge",
    requiredConditions: [{ condition: "Enterprise sales scale without the CEO", currentEvidence: "Unknown", status: "HYPOTHETICAL" }],
    thesisPoints: ["a", "b", "c"],
    whatCouldBreak: ["a", "b", "c"],
    fatalWeakness: "Sales depend on the CEO",
    fatalQuestion: "Can anyone but the CEO close enterprise deals?",
    returnPath: "…",
    nextProof: "…",
  };
  d.sensitivityDrivers = [{ variable: "Fully-loaded CAC", metricKey: "cac", currentAssumption: "$18k blended", breaksAt: "$30k", why: "Payback exceeds 24 months" }];
  d.aiRecommendation = { suggestedStatus: "NEEDS_FOUNDER_CALL", rationale: "Decisive questions need the founder", watch: null };
  return d;
}

const TRANSCRIPT = `[00:00:05] Sam Ortiz (Partner): Walk me through CAC.
[00:00:12] Maya Chen (CEO): The $18k CAC in the deck excludes founder time and sales engineering. Fully loaded it is closer to $26k.
[00:01:03] Sam Ortiz (Partner): Who closes enterprise deals today?
[00:01:09] Maya Chen (CEO): Honestly, I still close every enterprise deal myself. Our first account executive started in July.
[00:02:40] Maya Chen (CEO): We did lose one customer in 2025, Northwind, after their acquisition.
[00:03:10] Maya Chen (CEO): Gross margin is 76% as in the deck, and we host on our own AWS account.`;

function extraction(): FounderCallOutput {
  return {
    discussed: [
      { topic: "CAC definition", summary: "Deck CAC excludes founder time and sales engineering.", transcriptRefs: ["T-2"] },
      { topic: "Enterprise sales", summary: "The CEO closes every enterprise deal; first AE hired in July.", transcriptRefs: ["T-4"] },
    ],
    questionUpdates: [
      { questionId: "Q-01", status: "RESOLVED", answerSummary: "The CEO closes every enterprise deal; the first AE started in July.", transcriptExcerpt: "I still close every enterprise deal myself", transcriptRefs: ["T-4"], implication: "GTM is CEO-dependent." },
    ],
    claimUpdates: [
      { claimId: "CLM-001", change: "CLARIFIED", before: "CAC = $18k", founderSaid: "$18k excludes founder time and sales engineering; fully loaded ≈ $26k", note: "Same figure, narrower definition; fully loaded CAC is ~45% higher.", transcriptExcerpt: "The $18k CAC in the deck excludes founder time and sales engineering", transcriptRefs: ["T-2"] },
      { claimId: "CLM-003", change: "CONTRADICTED", before: "No customer churned in 2025", founderSaid: "Lost Northwind in 2025 after its acquisition", note: "Direct conflict with the deck.", transcriptExcerpt: "We did lose one customer in 2025, Northwind", transcriptRefs: ["T-5"] },
      { claimId: "CLM-004", change: "CONFIRMED", before: "Gross margin 76%", founderSaid: "76% gross margin, self-hosted on AWS", note: "Founder repeated the figure with hosting detail.", transcriptExcerpt: "Gross margin is 76% as in the deck", transcriptRefs: ["T-6"] },
    ],
    metricClarifications: [
      { metricId: "MET-CAC", deckValue: "$18k", clarifiedDefinition: "excludes founder time and sales engineering", implication: "Payback is understated.", transcriptExcerpt: "excludes founder time and sales engineering", transcriptRefs: ["T-2"] },
    ],
    newClaims: [{ category: "TEAM", statement: "First account executive started in July 2026", valueText: null, excerpt: "Our first account executive started in July", transcriptRefs: ["T-4"], material: true }],
    newMetrics: [],
    contradictions: [
      { statement: "Lost Northwind in 2025", conflictsWith: "DECK", targetId: "CLM-003", priorStatement: "No customer churned in 2025", material: true, transcriptExcerpt: "We did lose one customer in 2025, Northwind", transcriptRefs: ["T-5"] },
    ],
    gapUpdates: [{ gapId: "GAP-01", status: "NEEDS_FOUNDER", note: "Quota data promised", transcriptRefs: ["T-4"] }],
    rubricUpdates: [
      { criterion: "CHANNEL_SCALABILITY", rating: "BELOW_BAR", founderSaid: "I still close every enterprise deal myself", reason: "Enterprise motion depends on the CEO", transcriptRefs: ["T-4"] },
      { criterion: "SALES_MOTION_FIT", rating: "EXCEPTIONAL", founderSaid: "Our first AE started in July", reason: "Founder describes the motion as proven", transcriptRefs: ["T-4"] },
      // Cites a turn that does not exist: must not change the analysis.
      { criterion: "PRICING_POWER", rating: "EXCEPTIONAL", founderSaid: "We never discount", reason: "Pricing power", transcriptRefs: ["T-99"] },
    ],
    capabilityUpdates: [
      { founderName: "Maya Chen", dimension: "COMMUNICATION_INTELLECTUAL_HONESTY", rating: "STRONG", founderSaid: "Volunteered the churned customer and CEO dependency", reason: "Candid on negatives", transcriptRefs: ["T-4", "T-5"] },
    ],
    conditionUpdates: [{ conditionIndex: 0, status: "CONTRADICTED", founderSaid: "CEO closes every enterprise deal", reason: "No evidence yet of sales without the CEO", transcriptRefs: ["T-4"] }],
    riskUpdates: [
      { riskId: "RSK-01", title: "Founder-led sales dependency", category: "GTM", severity: "CRITICAL", likelihood: "HIGH", weaknessClass: "THESIS_KILLING", description: "CEO closes all enterprise deals", founderSaid: "I still close every enterprise deal myself", reason: "Confirmed dependency", transcriptRefs: ["T-4"] },
      { riskId: "RSK-02", title: "Bridge financing need", category: "FINANCING", severity: "LOW", likelihood: "LOW", weaknessClass: "REPAIRABLE", description: "Founder says runway is fine", founderSaid: "Gross margin is 76% as in the deck", reason: "Founder reassurance", transcriptRefs: ["T-6"] },
    ],
    recommendation: { suggestedStatus: "NEEDS_TARGETED_DILIGENCE", rationale: "Verify CAC and the sales motion with references.", watch: null },
    nextAction: { action: "Call two enterprise customers closed by the new AE", rationale: "Tests whether sales scale without the CEO", type: "REFERENCE_CALLS" },
    summary: "The meeting clarified CAC, surfaced a contradicted churn claim and confirmed CEO-dependent enterprise sales.",
  };
}

function stubModel(opts: { founderCall?: FounderCallOutput | "fail"; preBrief?: "fail" | "ok" }) {
  mocked.mockImplementation((async (call: { schemaName: string }) => {
    if (call.schemaName === "founder_call_update") {
      if (!opts.founderCall || opts.founderCall === "fail") throw new Error("model unavailable");
      return { data: opts.founderCall, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, searchSources: [], searchQueries: [], latencyMs: 1, attempts: 1, cached: false };
    }
    if (call.schemaName === "pre_meeting_brief") {
      if (opts.preBrief !== "ok") throw new Error("model unavailable");
      return {
        data: { objectives: [{ objective: "Determine whether enterprise sales can scale without the CEO", why: "Tests RSK-01, the thesis-killing risk", refs: ["RSK-01", "Q-01"] }, { objective: "Establish the fully-loaded CAC", why: "Payback depends on it", refs: ["MET-CAC"] }], questions: [{ questionId: "Q-01", alreadyKnow: "92 paying customers (company-reported); no sales team disclosed." }] },
        usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 },
        searchSources: [],
        searchQueries: [],
        latencyMs: 1,
        attempts: 1,
        cached: false,
      };
    }
    throw new Error(`unexpected schema ${call.schemaName}`);
  }) as never);
}

function setup() {
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
  const company = repo.createCompany(workspaceId, "Acme AI");
  const deal = richDeal();
  const derived = derive(deal, getRegistry(), DEFAULT_FUND_PROFILE);
  const pre = repo.saveVersion({ company, canonical: deal, derived, reason: "DECK_ANALYSIS", summary: "deck" });
  return { workspaceId, userId, company: repo.getCompany(workspaceId, company.id)!, pre };
}

async function meet(ctx: ReturnType<typeof setup>, date = "2026-09-20") {
  const r = await startFounderCall({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, transcript: TRANSCRIPT, callDate: date, participants: [{ name: "Maya Chen", role: "CEO", side: "COMPANY" }] });
  await r.promise;
  return meetings.getMeeting(ctx.company.id, r.meeting.id)!;
}

const rawRow = (id: string) => getDb().select().from(schema.companyVersions).where(eq(schema.companyVersions.id, id)).get();

beforeEach(() => {
  mocked.mockReset();
});

describe("meetings workflow — the four objects", () => {
  it("freezes the PRE_MEETING_ANALYSIS: the row is byte-identical after the meeting and never relabelled", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const before = JSON.stringify(rawRow(ctx.pre.id));
    expect(rawRow(ctx.pre.id)!.stage).toBe("PRE_MEETING_ANALYSIS");
    const m = await meet(ctx);
    expect(m.status).toBe("READY");
    expect(m.preAnalysisVersionId).toBe(ctx.pre.id);
    expect(JSON.stringify(rawRow(ctx.pre.id))).toBe(before);
    expect(meetings.stageOfVersion(ctx.company.id, ctx.pre.id)!.code).toBe("PRE_MEETING_ANALYSIS");
    // Four distinct objects, separately addressable.
    const preBrief = meetings.getBrief(ctx.company.id, m.preBriefId!)!;
    const postBrief = meetings.getBrief(ctx.company.id, m.postBriefId!)!;
    expect(preBrief.kind).toBe("PRE_MEETING_BRIEF");
    expect(preBrief.versionId).toBe(ctx.pre.id);
    expect(postBrief.kind).toBe("POST_MEETING_BRIEF");
    expect(postBrief.versionId).toBe(m.postAnalysisVersionId);
    expect(new Set([ctx.pre.id, m.postAnalysisVersionId, preBrief.id, postBrief.id]).size).toBe(4);
    expect(PreMeetingBrief.safeParse(preBrief.content).success).toBe(true);
    expect(PostMeetingBrief.safeParse(postBrief.content).success).toBe(true);
  });

  it("numbers post-meeting analyses V1, V2; deck re-analysis after a meeting is a separate stage; edits inherit", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    // Re-analysing the deck before any meeting is still a PRE_MEETING_ANALYSIS.
    const c = repo.getCurrentVersion(ctx.company)!;
    const again = repo.saveVersion({ company: ctx.company, canonical: c.canonical, derived: c.derived, reason: "DECK_ANALYSIS", summary: "re-run" });
    expect(again.stage).toBe("PRE_MEETING_ANALYSIS");
    const m1 = await meet(ctx, "2026-09-20");
    const m2 = await meet(ctx, "2026-09-27");
    expect(meetings.stageOfVersion(ctx.company.id, m1.postAnalysisVersionId!)!.code).toBe("POST_MEETING_ANALYSIS_V1");
    expect(meetings.stageOfVersion(ctx.company.id, m2.postAnalysisVersionId!)!.code).toBe("POST_MEETING_ANALYSIS_V2");
    expect(m2.preAnalysisVersionId).toBe(m1.postAnalysisVersionId); // meeting 2 was held against V1
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    const company = repo.getCompany(ctx.workspaceId, ctx.company.id)!;
    const cur = repo.getCurrentVersion(company)!;
    const edit = repo.saveVersion({ company, canonical: cur.canonical, derived: cur.derived, reason: "METRIC_CORRECTION", summary: "fix" });
    expect([edit.stage, edit.stageSeq]).toEqual(["POST_MEETING_ANALYSIS", 2]);
    const deck = repo.saveVersion({ company, canonical: cur.canonical, derived: cur.derived, reason: "DECK_ANALYSIS", summary: "deck again" });
    expect(deck.stage).toBe("DECK_REANALYSIS");
  });

  it("founder statements stay COMPANY_REPORTED and never flip UNVERIFIED → VERIFIED", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    const post = repo.getVersion(ctx.company.id, m.postAnalysisVersionId!)!;
    const transcriptSrc = post.canonical.sources.find((s) => s.kind === "TRANSCRIPT")!;
    expect(transcriptSrc).toMatchObject({ origin: "COMPANY", independenceGroup: "COMPANY" });
    const confirmed = post.canonical.claims.find((c) => c.id === "CLM-004")!;
    expect(confirmed.evidence.at(-1)).toMatchObject({ effect: "CONFIRMS", sourceId: transcriptSrc.id });
    expect(confirmed.verification).toBe("UNVERIFIED");
    recomputeVerification(confirmed, post.canonical);
    expect(confirmed.verification).toBe("UNVERIFIED");
    const created = post.canonical.claims.find((c) => c.statement.startsWith("First account executive"))!;
    expect(created).toMatchObject({ origin: "COMPANY", verification: "UNVERIFIED", independence: "COMPANY_DERIVED" });
    const preClaims = new Map(repo.getVersion(ctx.company.id, ctx.pre.id)!.canonical.claims.map((c) => [c.id, c.verification]));
    for (const cl of post.canonical.claims) if (preClaims.get(cl.id) !== "VERIFIED") expect(cl.verification, cl.id).not.toBe("VERIFIED");
    expect(post.derived.evidence.index).toBeLessThanOrEqual(repo.getVersion(ctx.company.id, ctx.pre.id)!.derived.evidence.index);
    const brief = PostMeetingBrief.parse(meetings.getBrief(ctx.company.id, m.postBriefId!)!.content);
    expect(brief.confirmations.every((x) => x.evidenceLabel === "COMPANY_REPORTED")).toBe(true);
    expect(brief.newInformation.every((x) => x.evidenceLabel === "COMPANY_REPORTED")).toBe(true);
  });

  it("detects the clarification (deck CAC $18k → founder definition) and keeps the reported value", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    const brief = PostMeetingBrief.parse(meetings.getBrief(ctx.company.id, m.postBriefId!)!.content);
    const clar = brief.clarifications.find((c) => c.targetId === "CLM-001")!;
    expect(clar).toMatchObject({ before: "CAC = $18k" });
    expect(clar.clarified).toContain("excludes founder time and sales engineering");
    expect(clar.refs[0]).toMatchObject({ ref: "T-2", startSec: 12, speaker: "Maya Chen (CEO)" });
    // The CAC metric restates the clarified CAC claim: shown once, but the metric is still flagged.
    expect(brief.clarifications.filter((c) => c.targetId === "MET-CAC")).toHaveLength(0);
    const post = repo.getVersion(ctx.company.id, m.postAnalysisVersionId!)!;
    expect(post.canonical.claims.find((c) => c.id === "CLM-001")!.history.at(-1)!.change).toBe("CLARIFIED");
    const cac = post.canonical.metrics.find((x) => x.id === "MET-CAC")!;
    expect(cac.normalizedValue).toBe(18_000);
    expect(cac.qualityFlags).toContain("DEFINITION_CLARIFIED_IN_MEETING");
  });

  it("surfaces contradictions with refs, on the claim and in the brief", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    const brief = PostMeetingBrief.parse(meetings.getBrief(ctx.company.id, m.postBriefId!)!.content);
    expect(brief.contradictions).toHaveLength(1);
    expect(brief.contradictions[0]).toMatchObject({ targetId: "CLM-003", conflictsWith: "DECK", priorStatement: "No customer churned in 2025" });
    expect(brief.contradictions[0]!.refs[0]).toMatchObject({ ref: "T-5", startSec: 160 });
    const post = repo.getVersion(ctx.company.id, m.postAnalysisVersionId!)!;
    const cl = post.canonical.claims.find((c) => c.id === "CLM-003")!;
    expect(cl.contradictions.length).toBe(1);
    expect(cl.contradictions[0]).toContain("T-5");
    expect(brief.unanswered.some((u) => u.id === "Q-02" && u.status === "OPEN")).toBe(true);
    expect(brief.nextAction.action).toBe("Call two enterprise customers closed by the new AE");
  });

  it("preserves the verbatim transcript, speakers and timestamps (segments + encrypted TRANSCRIPT document)", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    const segs = meetings.getSegments(m.id);
    expect(segs.map((s) => s.startSec)).toEqual([5, 12, 63, 69, 160, 190]);
    expect(segs[3]).toMatchObject({ ref: "T-4", speaker: "Maya Chen (CEO)", text: "Honestly, I still close every enterprise deal myself. Our first account executive started in July." });
    const doc = repo.listDocuments(ctx.company.id).find((d) => d.id === m.transcriptDocumentId)!;
    expect(doc.kind).toBe("TRANSCRIPT");
    const raw = fs.readFileSync(`${process.env.STORAGE_DIR}/${doc.storagePath}`);
    expect(raw.includes(Buffer.from("Northwind"))).toBe(false); // encrypted at rest
    expect((await readStoredFile(doc.storagePath)).toString("utf8")).toBe(TRANSCRIPT);
    const post = repo.getVersion(ctx.company.id, m.postAnalysisVersionId!)!;
    const ev = post.canonical.claims.find((c) => c.id === "CLM-003")!.evidence.at(-1)!;
    expect(ev.location).toBe("Meeting 1 (2026-09-20) · T-5 · 02:40");
  });

  it("a failed post-meeting pass leaves the PRE version untouched and saves nothing", async () => {
    stubModel({ founderCall: "fail" });
    const ctx = setup();
    const before = JSON.stringify(rawRow(ctx.pre.id));
    const m = await meet(ctx);
    expect(m.status).toBe("FAILED");
    expect(m.postAnalysisVersionId).toBeNull();
    expect(repo.listVersions(ctx.company.id)).toHaveLength(1);
    expect(JSON.stringify(rawRow(ctx.pre.id))).toBe(before);
    expect(meetings.getSegments(m.id)).toHaveLength(6);
  });
});

describe("What changed after the meeting? — deterministic Before / After", () => {
  it("diffs ratings, conditions, risks, questions and recommendation; joins what the founder said with refs; shows guards", async () => {
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    const pre = repo.getVersion(ctx.company.id, ctx.pre.id)!;
    const post = repo.getVersion(ctx.company.id, m.postAnalysisVersionId!)!;
    const ex = m.extraction as unknown as { output: FounderCallOutput; guards: MeetingGuard[] };
    const rows = meetingDiff(pre, post, { extraction: ex.output, segments: meetings.getSegments(m.id), guards: ex.guards });
    const row = (k: string) => rows.find((r) => r.key === k);
    expect(row("RUBRIC:CHANNEL_SCALABILITY")).toMatchObject({ area: "GTM", before: "Insufficient evidence", after: "Below bar", beforeLevel: "UNKNOWN", afterLevel: "CONCERN", material: true, founderSaid: "I still close every enterprise deal myself" });
    expect(row("RUBRIC:CHANNEL_SCALABILITY")!.refs[0]).toMatchObject({ ref: "T-4", startSec: 69 });
    // Founder statements alone raise a rating at most one notch and never to EXCEPTIONAL.
    expect(row("RUBRIC:SALES_MOTION_FIT")).toMatchObject({ before: "Adequate", after: "Strong" });
    expect(row("RUBRIC:SALES_MOTION_FIT")!.guard).toContain("Proposed Exceptional");
    expect(row("FOUNDER:FDR-01:COMMUNICATION_INTELLECTUAL_HONESTY")).toMatchObject({ after: "Adequate (observable)" });
    expect(row("CONDITION:0")).toMatchObject({ before: "Hypothetical", after: "Contradicted", beforeLevel: "UNKNOWN", afterLevel: "CONCERN" });
    expect(row("RSK-01")!.after).toContain("Critical severity");
    // Founder reassurance: severity is not lowered, likelihood by one level at most.
    expect(row("RSK-02")).toMatchObject({ before: expect.stringContaining("High severity · high likelihood"), after: expect.stringContaining("High severity · moderate likelihood") });
    expect(row("RSK-02")!.guard).not.toBeNull();
    // An update citing no real transcript turn is not applied, and says so.
    expect(row("RUBRIC:PRICING_POWER")).toBeUndefined();
    expect(post.canonical.rubric.find((r) => r.criterion === "PRICING_POWER")!.rating).toBe("ADEQUATE");
    expect(ex.guards).toContainEqual(expect.objectContaining({ key: "RUBRIC:PRICING_POWER", applied: "not applied" }));
    expect(row("Q-01")).toMatchObject({ before: "Open", after: "Resolved", material: true });
    expect(row("CLM-003")).toMatchObject({ after: expect.stringContaining("contradicted by founder statement") });
    expect(row("METRIC:cac")!.after).toContain("definition clarified");
    // Before/After come from the stored versions only.
    expect(meetingDiff(pre, pre)).toEqual([]);
    const rec = row("RECOMMENDATION");
    if (pre.derived.recommendation.status !== post.derived.recommendation.status) expect(rec).toBeDefined();
    else expect(rec).toBeUndefined();
    // The brief's WHAT CHANGED is the material subset of the same diff.
    const brief = PostMeetingBrief.parse(meetings.getBrief(ctx.company.id, m.postBriefId!)!.content);
    expect(brief.whatChanged.every((r) => r.material)).toBe(true);
    expect(brief.whatChanged.some((r) => r.key === "RUBRIC:CHANNEL_SCALABILITY")).toBe(true);
  });
});

describe("PRE_MEETING_BRIEF", () => {
  it("builds deterministically when the model call fails, and keeps the reason", async () => {
    stubModel({ preBrief: "fail" });
    const ctx = setup();
    const row = await ensurePreMeetingBrief({ workspaceId: ctx.workspaceId, userId: ctx.userId, company: ctx.company });
    expect(row.generation).toMatchObject({ mode: "DETERMINISTIC", costUsd: 0 });
    expect(row.generation.fallbackReason).toContain("Model phrasing unavailable");
    const b = PreMeetingBrief.parse(row.content);
    expect(b.objectives.length).toBeGreaterThanOrEqual(2);
    expect(b.objectives.every((o) => o.origin === "DETERMINISTIC")).toBe(true);
    expect(b.whatMattersMost.thesisKiller?.text).toContain("Founder-led sales dependency");
    expect(b.whatMattersMost.keyUnknowns.length).toBeGreaterThanOrEqual(3);
    const q1 = b.questions.find((q) => q.id === "Q-01")!;
    expect(q1).toMatchObject({ orientationKnown: true, strongAnswer: expect.stringContaining("repeatable AE-led"), weakAnswer: expect.stringContaining("CEO-dependent") });
    expect(b.quickMemo.keyTraction.length).toBeGreaterThan(0);
    // Idempotent per version (cached): no second row, no second call.
    const again = await ensurePreMeetingBrief({ workspaceId: ctx.workspaceId, userId: ctx.userId, company: ctx.company });
    expect(again.id).toBe(row.id);
    // Pure builder is deterministic.
    const v = { id: ctx.pre.id, versionNo: 1, createdAt: at, stageCode: "PRE_MEETING_ANALYSIS", stageLabel: "Pre-meeting analysis" };
    const loaded = repo.getVersion(ctx.company.id, ctx.pre.id)!;
    expect(buildPreMeetingBrief(loaded.canonical, loaded.derived, v)).toEqual(buildPreMeetingBrief(loaded.canonical, loaded.derived, v));
  });

  it("merges the model's objectives and 'what we already know' when available", async () => {
    stubModel({ preBrief: "ok" });
    const ctx = setup();
    const row = await ensurePreMeetingBrief({ workspaceId: ctx.workspaceId, userId: ctx.userId, company: ctx.company });
    const b = PreMeetingBrief.parse(row.content);
    expect(row.generation.mode).toBe("DETERMINISTIC_PLUS_MODEL");
    expect(b.objectives[0]).toMatchObject({ objective: "Determine whether enterprise sales can scale without the CEO", origin: "MODEL" });
    expect(b.questions.find((q) => q.id === "Q-01")).toMatchObject({ alreadyKnowOrigin: "MODEL" });
    expect(b.questions.find((q) => q.id === "Q-02")).toMatchObject({ alreadyKnowOrigin: "DETERMINISTIC" });
  });

  it("says 'Answer A / B' when it cannot tell which answer is favourable", () => {
    expect(orientAnswers("Customers are in the US.", "Customers are in Europe.").known).toBe(false);
    // "favorable customers" / "lower human effort" must not flip the reading.
    const o = orientAnswers("If the metric covers small or favorable customers or has weak accuracy, underwrite it as another vendor facing substitution.", "If logs show lower human effort than competitors, it has a defensible performance advantage.");
    expect(o).toMatchObject({ known: true, strong: expect.stringContaining("defensible") });
  });
});

describe("integrations are optional", () => {
  it("every connector is NOT_CONFIGURED by default and the workflow ran without one", async () => {
    const st = connectorStatuses({});
    expect(st.map((s) => [s.id, s.state, s.importEnabled])).toEqual([
      ["zoom", "NOT_CONFIGURED", false],
      ["google_meet", "NOT_CONFIGURED", false],
    ]);
    // Credentials alone do not enable import: the user must connect their own account (tests/integrations.*.test.ts).
    const withCreds = connectorStatuses({ ZOOM_CLIENT_ID: "x", ZOOM_CLIENT_SECRET: "y" });
    expect(withCreds[0]).toMatchObject({ state: "CONFIGURED", importEnabled: false, connection: null });
    stubModel({ founderCall: extraction() });
    const ctx = setup();
    const m = await meet(ctx);
    expect(m.status).toBe("READY");
    expect(connectorStatuses().every((s) => s.state === "NOT_CONFIGURED")).toBe(true);
  });
});

describe("applyFounderCall guards (pure)", () => {
  it("rating upgrades from founder statements are capped; downgrades are free", () => {
    expect(guardRating("ADEQUATE", "EXCEPTIONAL")).toEqual({ applied: "STRONG", capped: true });
    expect(guardRating("STRONG", "EXCEPTIONAL")).toEqual({ applied: "STRONG", capped: true });
    expect(guardRating("INSUFFICIENT_EVIDENCE", "STRONG")).toEqual({ applied: "ADEQUATE", capped: true });
    expect(guardRating("STRONG", "WEAK")).toEqual({ applied: "WEAK", capped: false });
  });

  it("a question not discussed keeps its earlier status and answer", () => {
    const deal = richDeal();
    deal.questions[0]!.status = "NOT_FULLY_RESOLVED";
    deal.questions[0]!.answer = "Partial answer from meeting 1";
    const x = extraction();
    x.questionUpdates = [{ questionId: "Q-01", status: "OPEN", answerSummary: "Not discussed", transcriptExcerpt: "", transcriptRefs: [], implication: "" }];
    const { deal: next } = applyFounderCall(deal, x, "Meeting 2", new Date(at), { segments: parseTranscript(TRANSCRIPT), label: "Meeting 2" });
    expect(next.questions[0]).toMatchObject({ status: "NOT_FULLY_RESOLVED", answer: "Partial answer from meeting 1" });
  });
});
