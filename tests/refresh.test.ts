/**
 * "Refresh only stale data": deterministic selection (engine/refresh.ts), scoped
 * application (orchestration/refresh.ts#applyRefresh) and the run lifecycle against
 * a temporary SQLite database. The model is mocked: `structured` goes through the
 * real cost controller (authorize + record) and returns a fixed research output.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-refresh-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
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
import { structured, type StructuredCall } from "@/ai/openai";
import { worstCaseCost } from "@/ai/pricing";
import { getDb, schema } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { buildContext } from "@/engine/integrity/context";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import type { CanonicalDeal, Claim, Source } from "@/domain/canonical";
import type { ResearchOutput } from "@/ai/prompts/research";
import { claimFreshness, selectStaleItems, REFRESH_POLICY } from "@/engine/refresh";
import { applyRefresh, refreshInput, scopeRefreshOutput, startRefresh } from "@/orchestration/refresh";
import { cancelRun } from "@/orchestration/run-control";
import { indexCompanyForBrain } from "@/brain/indexer";
import { makeDeal, metric } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const ASOF = new Date("2026-09-28T00:00:00Z");
const ANALYZED = "2026-09-20T10:00:00.000Z";

function src(id: string, extra: Partial<Source> = {}): Source {
  return { id, kind: "WEB", title: `Article ${id}`, url: `https://news.example/${id.toLowerCase()}`, documentId: null, publisher: "News", publishedDate: null, retrievedAt: ANALYZED, origin: "INDEPENDENT_SECONDARY", independenceGroup: `news-${id}`, citationVerified: true, ...extra };
}

function claim(id: string, statement: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    category: "CUSTOMER",
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
    evidence: [{ sourceId: "SRC-001", effect: "ORIGIN", excerpt: statement, location: "p. 3", note: null }],
    history: [{ at: ANALYZED, change: "CREATED", note: "Extracted from deck" }],
    ...extra,
  };
}

/**
 * CLM-001 stale (period 2023-11) · CLM-002 fresh deck statement · CLM-003 fresh deck statement confirmed only by a
 * 2023 article (SRC-002 → SOURCE item) · CLM-004 stale but not material · CLM-005 aging (period 2025-10) ·
 * CLM-006 fresh, backed by an undated article retrieved 14 months ago (SRC-003 → SOURCE item) ·
 * MET stale metric without claim · GAP-01 web question researched 5 months ago · GAP-02 founder-only.
 */
function staleDeal(): CanonicalDeal {
  const d = makeDeal();
  d.analysis.provenance = { model: "m", promptVersions: {}, engineVersion: "3.1", dictionaryVersion: "d", schemaVersion: "1.1", inputHash: null, startedAt: "2026-04-20T00:00:00.000Z", durationMs: 1 };
  d.sources = [
    { id: "SRC-001", kind: "DOCUMENT", title: "deck.pdf", url: null, documentId: null, publisher: "Acme AI", publishedDate: null, retrievedAt: ANALYZED, origin: "COMPANY", independenceGroup: "COMPANY", citationVerified: true },
    src("SRC-002", { publishedDate: "2023-05-02" }),
    src("SRC-003", { retrievedAt: "2025-07-15T00:00:00.000Z" }),
  ];
  d.claims = [
    claim("CLM-001", "Acme signed Globex as a customer in November 2023", { period: "2023-11", freshness: "STALE" }),
    claim("CLM-002", "Acme processes 1.2M invoices per month"),
    claim("CLM-003", "Acme is SOC 2 Type II certified", { evidence: [claim("x", "Acme is SOC 2 Type II certified").evidence[0]!, { sourceId: "SRC-002", effect: "CONFIRMS", excerpt: "Acme achieved SOC 2", location: "https://news.example/src-002", note: null }], verification: "PARTIALLY_VERIFIED" }),
    claim("CLM-004", "Acme's office moved to Austin in 2022", { period: "2022", material: false, freshness: "STALE" }),
    claim("CLM-005", "Acme partnered with Initech in October 2025", { period: "2025-10", category: "PARTNERSHIP" }),
    claim("CLM-006", "Acme integrates with NetSuite", { evidence: [claim("y", "Acme integrates with NetSuite").evidence[0]!, { sourceId: "SRC-003", effect: "CONFIRMS", excerpt: "NetSuite integration listed", location: "https://news.example/src-003", note: null }] }),
  ];
  d.metrics = [metric("arr", 3_840_000, { id: "MET-ARR", periodEnd: "2026-08" }), metric("paying_customers", 92, { id: "MET-CUST", unit: "COUNT", state: "STALE", periodEnd: "2025-01", qualityFlags: ["STALE: 20 months old (max 6)"] })];
  d.informationGaps = [
    { id: "GAP-01", question: "Has Acme raised since its seed?", whyItMatters: "Financing risk", target: "FINANCING", decisionImportance: 4, uncertainty: 4, researchability: "PUBLIC_WEB", suggestedQueries: ["Acme AI funding 2026"], status: "OPEN", resolutionNote: null },
    { id: "GAP-02", question: "Quota attainment of the AEs", whyItMatters: "GTM", target: "COMPANY", decisionImportance: 5, uncertainty: 5, researchability: "FOUNDER_ONLY", suggestedQueries: [], status: "NEEDS_FOUNDER", resolutionNote: null },
  ];
  return d;
}

function freshDeal(): CanonicalDeal {
  const d = staleDeal();
  d.analysis.provenance!.startedAt = ANALYZED;
  d.claims = d.claims.filter((c) => c.id === "CLM-002");
  d.sources = d.sources.slice(0, 1);
  d.metrics = d.metrics.filter((m) => m.id === "MET-ARR");
  return d;
}

const emptyOut = (): ResearchOutput => ({ findings: [], founderFindings: [], competitors: [], marketEstimates: [], gapUpdates: [], suspectedInstructions: [] });
const finding = (ref: string, relatesToClaimRef: string | null, effect: ResearchOutput["findings"][number]["effect"], text: string, extra: Partial<ResearchOutput["findings"][number]> = {}): ResearchOutput["findings"][number] => ({
  ref,
  gapRef: null,
  topic: "CUSTOMER",
  finding: text,
  sourceUrl: `https://press.example/${ref}`,
  sourceTitle: `Report ${ref}`,
  publisher: "Press",
  publishedDate: "2026-08-10",
  origin: "INDEPENDENT_SECONDARY",
  derivedFromCompany: false,
  relatesToClaimRef,
  effect,
  ...extra,
});
const retrieved = (out: ResearchOutput) => out.findings.map((f) => ({ url: f.sourceUrl }));

/* ------------------------------------------------------------------ */
/* Selection                                                            */
/* ------------------------------------------------------------------ */

describe("stale selection (deterministic)", () => {
  it("selects exactly the stale / aging material items, sources, metrics and web questions", () => {
    const plan = selectStaleItems(staleDeal(), { asOf: ASOF });
    expect(plan.items.map((x) => x.key).sort()).toEqual(["CLAIM:CLM-001", "CLAIM:CLM-005", "GAP:GAP-01", "METRIC:MET-CUST", "SOURCE:SRC-002", "SOURCE:SRC-003"].sort());
    expect(plan.counts).toEqual({ CLAIM: 2, SOURCE: 2, METRIC: 1, GAP: 1 });
    const s2 = plan.items.find((x) => x.key === "SOURCE:SRC-002")!;
    expect(s2.claimIds).toEqual(["CLM-003"]);
    expect(s2.reason).toMatch(/published 2023-05/);
    expect(plan.items.find((x) => x.key === "SOURCE:SRC-003")!.reason).toMatch(/Undated source last retrieved 2025-07/);
    expect(plan.items.find((x) => x.key === "CLAIM:CLM-005")!.freshness).toBe("AGING");
    // Stale claims first; the order and every field are a pure function of (deal, asOf).
    expect(plan.items[0]!.key).toBe("CLAIM:CLM-001");
    expect(selectStaleItems(staleDeal(), { asOf: ASOF })).toEqual(plan);
    expect(selectStaleItems(structuredClone(staleDeal()), { asOf: new Date(ASOF) })).toEqual(plan);
  });

  it("never selects non-material claims, fresh claims, founder-only questions or derived metrics", () => {
    const keys = selectStaleItems(staleDeal(), { asOf: ASOF }).items.map((x) => x.key);
    for (const k of ["CLAIM:CLM-002", "CLAIM:CLM-003", "CLAIM:CLM-004", "CLAIM:CLM-006", "GAP:GAP-02", "METRIC:MET-ARR"]) expect(keys).not.toContain(k);
  });

  it("dates an undated deck statement by the deck, not by an old article that confirms it", () => {
    const d = staleDeal();
    expect(claimFreshness(d.claims.find((c) => c.id === "CLM-003")!, d, ASOF)).toBe("CURRENT");
    expect(claimFreshness(d.claims.find((c) => c.id === "CLM-001")!, d, ASOF)).toBe("STALE");
  });

  it("is a no-op on a fresh record, and says what was checked", () => {
    const plan = selectStaleItems(freshDeal(), { asOf: ASOF });
    expect(plan.items).toEqual([]);
    expect(plan.considered.materialClaims).toBe(1);
  });

  it("defers items re-checked within the cooldown, and those over the per-refresh cap", () => {
    const d = staleDeal();
    d.analysis.refreshes = [{ at: "2026-09-20T00:00:00.000Z", asOf: "2026-09-20T00:00:00.000Z", runId: null, promptVersion: "research_refresh_v1", items: [{ key: "CLAIM:CLM-001", kind: "CLAIM", ref: "CLM-001", reason: "", outcome: "NOT_FOUND", note: null, newClaimIds: [], freshnessBefore: "STALE", freshnessAfter: "STALE" }], searches: 1, costUsd: 0.01, discardedOutOfScope: 0 }];
    const plan = selectStaleItems(d, { asOf: ASOF });
    expect(plan.items.map((x) => x.key)).not.toContain("CLAIM:CLM-001");
    expect(plan.deferred.find((x) => x.key === "CLAIM:CLM-001")!.reason).toMatch(/Re-checked 2026-09-20 \(not found\); next check after 2026-10-20/);
    const capped = selectStaleItems(staleDeal(), { asOf: ASOF, policy: { maxItems: 2 } });
    expect(capped.items).toHaveLength(2);
    expect(capped.deferred.filter((x) => /cap/.test(x.reason))).toHaveLength(4);
    // A claim created by a refresh counts as re-checked by it.
    const d2 = staleDeal();
    d2.claims.push(claim("CLM-099", "Newer but still aging fact", { period: "2025-10" }));
    d2.analysis.refreshes = [{ ...d.analysis.refreshes[0]!, items: [{ ...d.analysis.refreshes[0]!.items[0]!, newClaimIds: ["CLM-099"] }] }];
    expect(selectStaleItems(d2, { asOf: ASOF }).deferred.find((x) => x.key === "CLAIM:CLM-099")!.reason).toMatch(/created by refresh/);
    // After the cooldown the item is due again.
    expect(selectStaleItems(d, { asOf: new Date("2026-11-01T00:00:00Z") }).items.map((x) => x.key)).toContain("CLAIM:CLM-001");
  });

  it("ranks company-reported figures without a web trace after what search can refresh", () => {
    const d = staleDeal();
    d.claims.push(claim("CLM-010", "Gross margin is 74%", { category: "FINANCIAL", period: "2023-06" }));
    const plan = selectStaleItems(d, { asOf: ASOF });
    const it = plan.items.find((x) => x.key === "CLAIM:CLM-010")!;
    expect(it.reason).toMatch(/company-reported figure/);
    expect(plan.items.indexOf(it)).toBe(plan.items.length - 1);
  });

  it("uses the reference date: the same record is fresh today and stale later", () => {
    expect(selectStaleItems(freshDeal(), { asOf: new Date("2028-12-01T00:00:00Z") }).items.map((x) => x.key)).toContain("CLAIM:CLM-002");
    expect(REFRESH_POLICY.staleMonths).toBe(18);
  });

  it("sends the model only the stale items", () => {
    const d = staleDeal();
    const input = refreshInput(d, selectStaleItems(d, { asOf: ASOF }));
    for (const id of ["CLM-001", "CLM-005", "CLM-003", "CLM-006", "GAP-01", "MET-CUST"]) expect(input).toContain(id);
    for (const id of ["CLM-002", "CLM-004", "GAP-02", "MET-ARR"]) expect(input).not.toContain(`"${id}`);
  });
});

/* ------------------------------------------------------------------ */
/* Application                                                          */
/* ------------------------------------------------------------------ */

describe("applying a refresh", () => {
  const at = new Date("2026-09-28T12:00:00Z");
  const run = (out: ResearchOutput, base = staleDeal()) => {
    const plan = selectStaleItems(base, { asOf: ASOF });
    return { base, plan, ...applyRefresh({ base, plan, out, searchSources: retrieved(out), at, runId: "run_x", searches: 2, costUsd: 0.031 }) };
  };

  it("touches only stale items; out-of-scope output is discarded and counted", () => {
    const out = emptyOut();
    out.findings = [
      finding("r1", "CLM-001", "CONFIRMS", "Globex lists Acme as its AP vendor in its 2026 annual report."),
      finding("r2", "CLM-002", "CONFIRMS", "Acme processes over a million invoices monthly."),
      finding("r3", "CLM-004", "CONTRADICTS", "Acme's office is in Denver."),
    ];
    out.competitors = [{ name: "Bill.com", type: "DIRECT", description: "AP automation", scale: null, url: "https://bill.com" }] as ResearchOutput["competitors"];
    out.gapUpdates = [{ gapRef: "GAP-02", status: "RESOLVED", note: "should be ignored" }];
    const { base, deal, record } = run(out);
    for (const id of ["CLM-002", "CLM-004", "CLM-006"]) expect(deal.claims.find((c) => c.id === id)).toEqual(base.claims.find((c) => c.id === id));
    // CLM-005 is itself a selected (aging) item: only its stored freshness is brought to the reference date.
    expect(deal.claims.find((c) => c.id === "CLM-005")).toEqual({ ...base.claims.find((c) => c.id === "CLM-005"), freshness: "AGING" });
    expect(deal.metrics).toEqual(base.metrics);
    expect(deal.informationGaps.find((g) => g.id === "GAP-02")).toEqual(base.informationGaps.find((g) => g.id === "GAP-02"));
    for (const s of base.sources) expect(deal.sources.find((x) => x.id === s.id)).toEqual(s);
    expect(deal.claims).toHaveLength(base.claims.length); // no competitor claim, no claim from r2/r3
    expect(record.discardedOutOfScope).toBe(4);
    // Everything outside the refresh (thesis, rubric, risks, market…) is the base object.
    const strip = (c: CanonicalDeal) => ({ ...c, claims: [], sources: [], informationGaps: [], metrics: [], analysis: { ...c.analysis, refreshes: undefined, securityFlags: [] } });
    expect(strip(deal)).toEqual(strip(base));
  });

  it("confirms a stale claim: evidence added, verification recomputed, freshness current, outcome recorded", () => {
    const out = emptyOut();
    out.findings = [finding("r1", "CLM-001", "CONFIRMS", "Globex lists Acme as its AP vendor in its 2026 annual report.", { origin: "PRIMARY_EXTERNAL" })];
    const { deal, record } = run(out);
    const c = deal.claims.find((x) => x.id === "CLM-001")!;
    expect(c.evidence.at(-1)).toMatchObject({ effect: "CONFIRMS" });
    expect(c.verification).toBe("VERIFIED");
    expect(c.freshness).toBe("CURRENT");
    expect(record.items.find((x) => x.key === "CLAIM:CLM-001")).toMatchObject({ outcome: "CONFIRMED", freshnessBefore: "STALE", freshnessAfter: "CURRENT" });
    expect(deal.analysis.refreshes).toHaveLength(1);
    expect(deal.analysis.refreshes![0]).toMatchObject({ runId: "run_x", promptVersion: "research_refresh_v1", searches: 2, costUsd: 0.031 });
  });

  it("a negative finding is recorded as NOT_FOUND, never as verification", () => {
    const out = emptyOut();
    out.findings = [finding("r1", "CLM-001", "CONFIRMS", "No public evidence found of a Globex contract in 2026.")];
    out.gapUpdates = [{ gapRef: "GAP-01", status: "NOT_FOUND", note: "No funding announcement found" }];
    const { base, deal, record } = run(out);
    const c = deal.claims.find((x) => x.id === "CLM-001")!;
    expect(c.evidence).toEqual(base.claims.find((x) => x.id === "CLM-001")!.evidence);
    expect(c.verification).toBe("UNVERIFIED");
    expect(deal.claims).toHaveLength(base.claims.length);
    expect(record.items.find((x) => x.key === "CLAIM:CLM-001")).toMatchObject({ outcome: "NOT_FOUND" });
    expect(record.items.find((x) => x.key === "GAP:GAP-01")).toMatchObject({ outcome: "NOT_FOUND" });
    expect(deal.informationGaps.find((g) => g.id === "GAP-01")!.resolutionNote).toMatch(/^Refresh 2026-09-28: No funding/);
  });

  it("newer information creates a new claim and marks the stale one as superseded; contradictions stay contradictions", () => {
    const out = emptyOut();
    out.findings = [
      finding("r1", "CLM-005", "NEW_INFORMATION", "Acme and Initech expanded their partnership to Europe in August 2026.", { topic: "COMPANY" }),
      finding("r2", "CLM-001", "CONTRADICTS", "Globex replaced Acme with Bill.com in June 2026."),
    ];
    const { deal, record } = run(out);
    const it5 = record.items.find((x) => x.key === "CLAIM:CLM-005")!;
    expect(it5.outcome).toBe("UPDATED");
    expect(it5.newClaimIds).toHaveLength(1);
    const fresh = deal.claims.find((c) => c.id === it5.newClaimIds[0])!;
    expect(fresh).toMatchObject({ freshness: "CURRENT", period: "2026-08-10" });
    expect(deal.claims.find((c) => c.id === "CLM-005")!.history.at(-1)).toMatchObject({ change: "CHANGED" });
    expect(deal.claims.find((c) => c.id === "CLM-001")!.verification).toBe("CONTRADICTED");
    expect(record.items.find((x) => x.key === "CLAIM:CLM-001")!.outcome).toBe("CONTRADICTED");
  });

  it("an undated stale source learns its date when the finding cites the same page", () => {
    const out = emptyOut();
    out.findings = [finding("r1", "CLM-006", "CONFIRMS", "Acme appears in the NetSuite app marketplace.", { sourceUrl: "https://news.example/src-003", publishedDate: "2026-07-01" })];
    const { deal, record } = run(out);
    expect(deal.sources.find((s) => s.id === "SRC-003")!.publishedDate).toBe("2026-07-01");
    expect(record.items.find((x) => x.key === "SOURCE:SRC-003")!.outcome).toBe("CONFIRMED");
    // The same URL is one source, not two.
    expect(deal.sources.filter((s) => s.url === "https://news.example/src-003")).toHaveLength(1);
  });

  it("an unretrieved citation never verifies a stale claim", () => {
    const out = emptyOut();
    out.findings = [finding("r1", "CLM-001", "CONFIRMS", "Globex lists Acme as vendor.", { origin: "PRIMARY_EXTERNAL" })];
    const base = staleDeal();
    const plan = selectStaleItems(base, { asOf: ASOF });
    const { deal } = applyRefresh({ base, plan, out, searchSources: [], at, runId: null, searches: 1, costUsd: 0.01 });
    expect(deal.claims.find((c) => c.id === "CLM-001")!.verification).toBe("UNVERIFIED");
  });

  it("metric items without a claim get a note and a new claim, never a changed value", () => {
    const out = emptyOut();
    out.findings = [finding("r1", "MET-CUST", "NEW_INFORMATION", "Acme says it serves 140 customers (company blog, August 2026).", { derivedFromCompany: true })];
    const { base, deal, record } = run(out);
    const m = deal.metrics.find((x) => x.id === "MET-CUST")!;
    const m0 = base.metrics.find((x) => x.id === "MET-CUST")!;
    expect(m.normalizedValue).toBe(m0.normalizedValue);
    expect(m.state).toBe("STALE");
    expect(m.notes).toMatch(/newer public information in CLM-/);
    expect(record.items.find((x) => x.key === "METRIC:MET-CUST")!.outcome).toBe("UPDATED");
  });

  it("scoping drops founder findings, competitors and market estimates", () => {
    const out = emptyOut();
    out.founderFindings = [{ founderName: "Maya", kind: "ROLE", finding: "x", sourceUrl: "https://a.example", relevance: "" }];
    out.marketEstimates = [{ description: "AP market", lowUsd: 1, highUsd: 2, year: 2026, scope: "US", sourceUrl: "https://m.example" }];
    const s = scopeRefreshOutput(out, selectStaleItems(staleDeal(), { asOf: ASOF }));
    expect(s.scoped.founderFindings).toEqual([]);
    expect(s.scoped.marketEstimates).toEqual([]);
    expect(s.discarded).toBe(2);
  });

  it("moves the integrity reference date to the refresh", () => {
    const { deal } = run(emptyOut());
    expect(buildContext(deal, getRegistry(), null).asOf!.toISOString()).toBe(ASOF.toISOString());
    expect(buildContext(staleDeal(), getRegistry(), null).asOf!.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });
});

/* ------------------------------------------------------------------ */
/* Run lifecycle (temporary database, mocked model)                     */
/* ------------------------------------------------------------------ */

const mocked = vi.mocked(structured);
const usage = { inputTokens: 4_000, cachedTokens: 0, outputTokens: 1_500, reasoningTokens: 600, webSearches: 2 };

function stub(out: ResearchOutput | "hang") {
  mocked.mockImplementation((async (call: StructuredCall<never>) => {
    // Same contract as the real client: authorize the worst case, then record the actual usage.
    const est = call.cost.authorize(call.step, "gpt-5.6-luna", call.instructions.length + JSON.stringify(call.input).length, call.maxOutputTokens, call.webSearch?.maxCalls ?? 0, call.reservation);
    if (out === "hang")
      await new Promise((_, reject) => {
        const fail = () => reject(new DOMException("Aborted", "AbortError"));
        if (call.signal?.aborted) fail();
        call.signal?.addEventListener("abort", fail, { once: true });
      });
    await call.cost.record({ step: call.step, model: "gpt-5.6-luna", promptVersion: call.promptVersion, usage, estimatedUsd: est, latencyMs: 5, toolCalls: 2 });
    return { data: out, usage, searchSources: retrieved(out as ResearchOutput), searchQueries: [], latencyMs: 5, attempts: 1, cached: false };
  }) as never);
}

function setup(d = staleDeal()) {
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
  const company = repo.createCompany(workspaceId, "Acme AI");
  const pre = repo.saveVersion({ company, canonical: d, derived: derive(d, getRegistry(), DEFAULT_FUND_PROFILE), reason: "DECK_ANALYSIS", summary: "deck" });
  return { workspaceId, userId, company: repo.getCompany(workspaceId, company.id)!, pre };
}

beforeEach(() => {
  mocked.mockReset();
  vi.mocked(indexCompanyForBrain).mockClear();
});

describe("refresh run", () => {
  it("one budgeted call → new immutable version, history, audit, re-index", async () => {
    const out = emptyOut();
    out.findings = [finding("r1", "CLM-001", "CONFIRMS", "Globex lists Acme as its AP vendor in its 2026 annual report.")];
    stub(out);
    const ctx = setup();
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF });
    if (r.noop) throw new Error("expected a run");
    await r.promise;

    expect(mocked).toHaveBeenCalledTimes(1);
    const call = mocked.mock.calls[0]![0] as StructuredCall<never>;
    expect(call.promptVersion).toBe("research_refresh_v1");
    expect(call.webSearch!.maxCalls).toBeGreaterThanOrEqual(1);
    expect(call.webSearch!.maxCalls).toBeLessThanOrEqual(4);
    expect(JSON.stringify(call.input)).not.toContain("CLM-002");

    const run = repo.getRun(ctx.workspaceId, r.run.id)!;
    expect(run).toMatchObject({ kind: "RESEARCH", status: "COMPLETED" });
    expect(run.progress.map((p) => p.status)).toEqual(["DONE", "DONE", "DONE", "DONE"]);
    expect(run.spentUsd).toBeGreaterThan(0);
    expect(run.spentUsd).toBeLessThanOrEqual(run.budgetUsd);
    expect(run.budgetUsd).toBe(0.06);

    const versions = repo.listVersions(ctx.company.id);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ reason: "RESEARCH_REFRESH", runId: r.run.id, versionNo: 2 });
    // The previous version is untouched (immutable).
    const prev = repo.getVersion(ctx.company.id, ctx.pre.id)!;
    expect(prev.canonical.claims.find((c) => c.id === "CLM-001")!.evidence).toHaveLength(1);
    expect(prev.canonical.analysis.refreshes).toBeUndefined();
    const cur = repo.getCurrentVersion(repo.getCompany(ctx.workspaceId, ctx.company.id)!)!;
    expect(cur.canonical.analysis.refreshes![0]!.items.find((x) => x.key === "CLAIM:CLM-001")!.outcome).toBe("CONFIRMED");

    const hist = repo.listHistory(ctx.company.id);
    expect(hist.some((h) => h.type === "RESEARCH_RUN" && h.versionId === cur.row.id)).toBe(true);
    const audit = getDb().select().from(schema.auditLog).where(eq(schema.auditLog.target, ctx.company.id)).all();
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["RESEARCH_REFRESH_STARTED", "RESEARCH_REFRESH_APPLIED"]));
    expect(vi.mocked(indexCompanyForBrain)).toHaveBeenCalledWith(expect.objectContaining({ versionId: cur.row.id }));
    const costs = repo.costRecordsForRun(r.run.id);
    expect(costs).toHaveLength(1);
    expect(costs[0]!.step).toBe("RESEARCH_REFRESH");
  });

  it("honours the budget: the authorized worst case fits under the cap", async () => {
    stub(emptyOut());
    const ctx = setup();
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF, budgetUsd: 0.04 });
    if (r.noop) throw new Error("expected a run");
    await r.promise;
    const call = mocked.mock.calls[0]![0] as StructuredCall<never>;
    const worst = worstCaseCost("gpt-5.6-luna", call.instructions.length + JSON.stringify(call.input).length, call.maxOutputTokens, call.webSearch!.maxCalls);
    expect(worst).toBeLessThanOrEqual(0.04);
    expect(repo.getRun(ctx.workspaceId, r.run.id)!.status).toBe("COMPLETED");
  });

  it("a budget too small for one search fails without calling the model and creates no version", async () => {
    stub(emptyOut());
    const ctx = setup();
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF, budgetUsd: 0.001 });
    if (r.noop) throw new Error("expected a run");
    await r.promise;
    expect(mocked).not.toHaveBeenCalled();
    expect(repo.getRun(ctx.workspaceId, r.run.id)).toMatchObject({ status: "FAILED", budgetUsd: 0.02 });
    expect(repo.getRun(ctx.workspaceId, r.run.id)!.error).toMatch(/Budget/);
    expect(repo.listVersions(ctx.company.id)).toHaveLength(1);
  });

  it("is a no-op when nothing is stale: no run, no model call, no version", async () => {
    const ctx = setup(freshDeal());
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF });
    expect(r.noop).toBe(true);
    if (r.noop) expect(r.message).toMatch(/^Nothing is stale as of 2026-09-28/);
    expect(mocked).not.toHaveBeenCalled();
    expect(repo.latestRun(ctx.company.id)).toBeUndefined();
    expect(repo.listVersions(ctx.company.id)).toHaveLength(1);
  });

  it("can be cancelled: run CANCELLED, no version", async () => {
    stub("hang");
    const ctx = setup();
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF });
    if (r.noop) throw new Error("expected a run");
    await vi.waitFor(() => expect(mocked).toHaveBeenCalled());
    expect(cancelRun(r.run.id)).toBe(true);
    await r.promise;
    expect(repo.getRun(ctx.workspaceId, r.run.id)).toMatchObject({ status: "CANCELLED" });
    expect(repo.listVersions(ctx.company.id)).toHaveLength(1);
  });

  it("refuses to start while another run is in progress", async () => {
    stub("hang");
    const ctx = setup();
    const r = await startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF });
    if (r.noop) throw new Error("expected a run");
    await expect(startRefresh({ workspaceId: ctx.workspaceId, userId: ctx.userId, companyIdOrSlug: ctx.company.id, asOf: ASOF })).rejects.toMatchObject({ status: 409 });
    cancelRun(r.run.id);
    await r.promise;
  });
});
