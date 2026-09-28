/**
 * Deck v1 → v2 → v3 on the SAME company, duplicate detection (never a silent
 * merge), deck-diff wiring on stored versions, override carry-over through the
 * real ingestion path, and the legacy USER_CORRECTED upgrade on read.
 *
 * Temporary SQLite database + encrypted storage, real PDF fixtures. The model
 * pipeline is replaced by a deterministic stand-in that does what the pipeline
 * does around the model: records the documents read, re-anchors carried
 * overrides (withCarriedOverrides), derives and saves an immutable version.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-decks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  return dir;
});

vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async () => {
    throw new Error("no model calls in this test");
  }),
  embed: vi.fn(async () => {
    throw new Error("no network in tests");
  }),
}));
vi.mock("@/brain/indexer", async (orig) => ({
  ...(await orig<typeof import("@/brain/indexer")>()),
  indexCompanyForBrain: vi.fn(async () => ({ chunks: 0, embedded: 0, facts: 0 })),
}));

type Content = () => CanonicalDeal;
const queue: Content[] = [];
vi.mock("@/orchestration/pipeline", async (orig) => {
  const m = await orig<typeof import("@/orchestration/pipeline")>();
  return {
    ...m,
    runDeckAnalysis: vi.fn(async (inp: import("@/orchestration/pipeline").RunDeckAnalysisInput) => {
      const make = queue.shift();
      if (!make) throw new Error("no fake analysis queued");
      const at = new Date().toISOString();
      let deal = make();
      deal.documents = inp.documents.map((d) => ({ id: d.documentId, filename: d.filename, kind: d.kind, pages: d.pages.length }));
      deal.analysis.depth = "FULL";
      deal.analysis.provenance = { model: "fake", promptVersions: {}, engineVersion: "t", dictionaryVersion: "t", schemaVersion: "1.1", inputHash: m.inputHash(inp.documents, inp.mode), startedAt: at, durationMs: 1 };
      deal = withCarriedOverrides(deal, inp.carryOver, at);
      const company = repo.getCompany(inp.workspaceId, inp.companyId)!;
      repo.renameFromIdentity(company.id, deal.identity.name);
      repo.saveVersion({ company, canonical: deal, derived: derive(deal, getRegistry(), inp.fund), reason: "DECK_ANALYSIS", runId: inp.runId, summary: "fake analysis", userId: inp.userId });
      repo.finishRun(inp.runId, "COMPLETED", 0, "FULL");
    }),
  };
});

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import * as meetings from "@/server/meetings";
import { AnalysisRequestError, startAnalysis } from "@/server/analyze";
import { deckAnalysisRow, deckChangeLines, deckComparison, deckComparisonForVersion, deckLineage, deckView } from "@/server/deck-versions";
import { dismissDuplicate, duplicateSuggestions, mergeIntoCompany, sameCompanySignals, uploadMatches } from "@/server/company-merge";
import { commitOverride } from "@/server/overrides";
import { buildMemoryPack } from "@/brain/memory-pack";
import { DECK_CHANGE_QUESTION } from "@/brain/chat";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { applyOverrides } from "@/engine/overrides";
import { withCarriedOverrides } from "@/engine/override-carry";
import { companyNameKey, matchCompanies, nameFromFilename, personKey, registrableDomain } from "@/engine/company-match";
import { deckOfDocuments, nextDeckSeq, pickDeckIndex, resolveDeckLineage, type LineageDoc } from "@/engine/deck-lineage";
import { CanonicalDeal, type MetricInstance } from "@/domain/canonical";
import { makeDeal, metric } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

const FIX = path.join(process.cwd(), "evals/fixtures/decks");
const pdf = (rel: string, as?: string) => ({ filename: as ?? path.basename(rel), mime: "application/pdf", data: fs.readFileSync(path.join(FIX, rel)) });
const DECK1 = () => pdf("variants/ledgerline-clean.pdf");
const DECK2 = () => pdf("ledgerline-series-a.pdf");
const DECK3 = () => pdf("variants/ledgerline-marketing.pdf", "ledgerline-deck-v3.pdf");
const note = (text: string) => ({ filename: "financials.txt", mime: "text/plain", data: Buffer.from(text) });

/* ------------------------------------------------------------------ */
/* Deck contents the stand-in "extracts"                                */
/* ------------------------------------------------------------------ */

const founders = (names: string[]) => names.map((name) => ({ name, role: "Co-founder", backgroundFromDeck: "", priorOrganizations: [], publicProfileUrls: [] }));
const money = (amount: number, rawText: string) => ({ amount, currency: "USD", rawText });

function ledgerline(website: string | null, extra: (d: CanonicalDeal) => void): Content {
  return () => {
    const d = makeDeal();
    d.identity = { ...d.identity, name: "Ledgerline", website, oneLiner: "Reconciliation for mid-market finance teams." };
    d.foundersFromDeck = founders(["Maya Chen", "Tomás Ruiz"]);
    extra(d);
    return CanonicalDeal.parse(d);
  };
}

const m = (key: string, v: number, extra: Partial<MetricInstance>) => metric(key, v, { unit: key === "arr" ? "USD" : key === "nrr" || key === "gross_margin" ? "PERCENT" : "COUNT", ...extra });

/** Deck v1: ARR $3.84M (Jun 2026), 92 customers, NRR 118%, TAM $12B. */
const deckV1 = ledgerline("https://ledgerline.io", (d) => {
  d.metrics = [m("arr", 3_840_000, { id: "MET-001", periodEnd: "2026-06", rawValue: "$3.84M" }), m("paying_customers", 92, { id: "MET-002", periodEnd: "2026-06" }), m("nrr", 118, { id: "MET-003", periodEnd: "2026-06" })];
  d.deckMarket = { tam: money(12e9, "$12B"), sam: null, som: null, description: null };
});
/** Deck v2 (renumbered): June ARR restated to $3.6M, December ARR $5.1M, NRR no longer reported, gross margin new, TAM $30B. */
const deckV2 = ledgerline("https://www.ledgerline.io/", (d) => {
  d.metrics = [
    m("gross_margin", 74, { id: "MET-001", periodEnd: "2026-12" }),
    m("paying_customers", 131, { id: "MET-004", periodEnd: "2026-12" }),
    m("arr", 5_100_000, { id: "MET-007", periodEnd: "2026-12", rawValue: "$5.1M" }),
    m("arr", 3_600_000, { id: "MET-012", periodEnd: "2026-06", rawValue: "$3.6M", isPrimary: false }),
  ];
  d.deckMarket = { tam: money(30e9, "$30B"), sam: null, som: null, description: null };
});
const deckV3 = ledgerline("https://ledgerline.io", (d) => {
  d.metrics = [m("arr", 6_000_000, { id: "MET-001", periodEnd: "2027-03" }), m("paying_customers", 150, { id: "MET-002", periodEnd: "2027-03" })];
});

let ws: { workspaceId: string; userId: string };
beforeEach(() => {
  queue.length = 0;
  ws = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
});

async function upload(files: ReturnType<typeof pdf>[], content: Content | null, extra: Partial<Parameters<typeof startAnalysis>[0]> = {}) {
  if (content) queue.push(content);
  const r = await startAnalysis({ workspaceId: ws.workspaceId, userId: ws.userId, mode: "FAST_SCREEN", files, ...extra });
  await r.promise;
  return r;
}

/* ------------------------------------------------------------------ */
/* Pure: matching and lineage                                          */
/* ------------------------------------------------------------------ */

describe("company matching (pure)", () => {
  const cands = [
    { id: "a", name: "Ledgerline, Inc.", domain: "ledgerline.io", founders: ["Maya Chen", "Tomás Ruiz"] },
    { id: "b", name: "Acme Robotics", domain: null, founders: [] },
    { id: "c", name: "Nimbus", domain: "nimbus.ai", founders: ["Ada Park"] },
  ];

  it("normalizes names, domains, people and file names", () => {
    expect(companyNameKey("Ledgerline, Inc.")).toBe("ledgerline");
    expect(companyNameKey("Ledger Line")).toBe("ledgerline");
    expect(registrableDomain("https://app.Ledgerline.io/login?x=1")).toBe("ledgerline.io");
    expect(registrableDomain("www.acme.co.uk")).toBe("acme.co.uk");
    expect(registrableDomain("not a url")).toBeNull();
    expect(registrableDomain("https://www.linkedin.com/company/ledgerline")).toBeNull();
    expect(personKey("Dr. Tomás  Ruiz")).toBe(personKey("ruiz tomas"));
    expect(nameFromFilename("ledgerline-series-a.pdf")).toBe("ledgerline");
    expect(nameFromFilename("Ledgerline_Pitch_Deck_v3_FINAL_2026.pdf")).toBe("ledgerline");
    expect(nameFromFilename("AcmeRobotics-Q3-2026-investor-update.pptx")).toBe("acme robotics");
    expect(nameFromFilename("deck.pdf")).toBeNull();
  });

  it("hosting platforms are not a shared website: two companies on *.notion.site never match on domain; the same custom domain does", () => {
    const hosted = [
      { id: "n1", name: "Acme", website: "https://acme.notion.site", founders: [] },
      { id: "n2", name: "Kestrel Data", domain: registrableDomain("https://kestrel.vercel.app/about"), founders: [] },
      { id: "n3", name: "Plumline", domain: "plumline.com", founders: [] },
    ];
    expect(registrableDomain("https://acme.notion.site")).toBe("acme.notion.site");
    expect(registrableDomain("https://widgetly.notion.site")).not.toBe(registrableDomain("https://acme.notion.site"));
    expect(matchCompanies({ name: "Widgetly", nameSource: "IDENTITY", website: "https://widgetly.notion.site", founders: [] }, hosted)).toEqual([]);
    expect(matchCompanies({ name: "Orbital", nameSource: "IDENTITY", website: "https://orbital.vercel.app", founders: [] }, hosted)).toEqual([]);
    expect(matchCompanies({ name: "Acme Robotics", nameSource: "IDENTITY", website: "acme.notion.site/pricing", founders: [] }, hosted)[0]).toMatchObject({ companyId: "n1", verdict: "SAME_LIKELY" });
    expect(matchCompanies({ name: "Plumline Labs", nameSource: "IDENTITY", website: "https://app.plumline.com", founders: [] }, hosted)[0]).toMatchObject({ companyId: "n3", verdict: "SAME_LIKELY", signals: { domain: "SAME" } });
    // A profile URL is not a website: it never creates a domain signal.
    expect(matchCompanies({ name: "Other", nameSource: "IDENTITY", website: "https://linkedin.com/company/plumline", founders: [] }, hosted)).toEqual([]);
  });

  it("same website → likely the same company, even under a new name", () => {
    const r = matchCompanies({ name: "Ledgerline Payments", nameSource: "IDENTITY", website: "https://ledgerline.io", founders: [] }, cands);
    expect(r[0]).toMatchObject({ companyId: "a", verdict: "SAME_LIKELY" });
  });

  it("same name + a founder in common → likely the same; same name and nothing else → ask", () => {
    expect(matchCompanies({ name: "LEDGERLINE", nameSource: "IDENTITY", website: null, founders: ["Maya Chen"] }, cands)[0]).toMatchObject({ companyId: "a", verdict: "SAME_LIKELY" });
    expect(matchCompanies({ name: "Ledgerline", nameSource: "USER", website: null, founders: [] }, cands)[0]).toMatchObject({ companyId: "a", verdict: "POSSIBLE" });
  });

  it("homonyms: same name but a different domain, or disjoint founders → a different company is suggested", () => {
    const byDomain = matchCompanies({ name: "Ledgerline", nameSource: "IDENTITY", website: "https://ledgerline.de", founders: [] }, cands)[0]!;
    expect(byDomain).toMatchObject({ companyId: "a", verdict: "DIFFERENT_LIKELY" });
    expect(byDomain.reasons.join(" ")).toMatch(/different website \(ledgerline\.de vs ledgerline\.io\).*homonym/);
    const byFounders = matchCompanies({ name: "Ledgerline", nameSource: "IDENTITY", website: null, founders: ["Jane Smith"] }, cands)[0]!;
    expect(byFounders).toMatchObject({ verdict: "DIFFERENT_LIKELY", signals: { founders: "DIFFERENT" } });
    // A founder in common outweighs a different domain (rebrand / new site).
    expect(matchCompanies({ name: "Ledgerline", nameSource: "IDENTITY", website: "https://ledgerline.de", founders: ["Tomas Ruiz"] }, cands)[0]!.verdict).toBe("SAME_LIKELY");
  });

  it("file-name probes match on the name prefix only, and unrelated uploads match nothing", () => {
    expect(matchCompanies({ name: nameFromFilename("acme-robotics-seed-deck.pdf"), nameSource: "FILENAME", website: null, founders: [] }, cands)[0]).toMatchObject({ companyId: "b", verdict: "POSSIBLE" });
    expect(matchCompanies({ name: "acme", nameSource: "FILENAME", website: null, founders: [] }, cands)).toEqual([]);
    expect(matchCompanies({ name: "Orbital", nameSource: "IDENTITY", website: "https://orbital.dev", founders: ["Ada Park"] }, cands)).toEqual([]);
    expect(matchCompanies({ name: "Orbital", nameSource: "IDENTITY", website: null, founders: ["Maya Chen", "Tomás Ruiz"] }, cands)[0]).toMatchObject({ companyId: "a", verdict: "POSSIBLE" });
  });
});

describe("deck lineage (pure)", () => {
  const doc = (id: string, at: string, kind = "PDF", deckVersion: number | null = null): LineageDoc => ({ id, filename: `${id}.pdf`, kind, createdAt: at, deckVersion, supersedesDocumentId: null });

  it("infers v1 for documents stored before deck versions existed, then follows explicit versions", () => {
    const legacy = [doc("fin", "2026-01-01T00:00:00Z", "TEXT"), doc("d1", "2026-01-01T00:00:01Z"), doc("tx", "2026-02-01T00:00:00Z", "TRANSCRIPT")];
    expect(resolveDeckLineage(legacy)).toEqual([{ seq: 1, documentId: "d1", filename: "d1.pdf", createdAt: "2026-01-01T00:00:01Z", supersedesDocumentId: null, inferred: true }]);
    const withV2 = [...legacy, { ...doc("d2", "2026-03-01T00:00:00Z", "PDF", 2), supersedesDocumentId: "d1" }];
    const l = resolveDeckLineage(withV2);
    expect(l.map((e) => [e.seq, e.documentId, e.inferred])).toEqual([
      [1, "d1", true],
      [2, "d2", false],
    ]);
    expect(nextDeckSeq(l)).toBe(3);
    expect(deckOfDocuments(l, ["fin", "d1"])!.seq).toBe(1);
    expect(deckOfDocuments(l, ["d2", "fin"])!.seq).toBe(2);
    expect(deckOfDocuments(l, ["fin"])).toBeNull();
    expect(resolveDeckLineage([doc("t", "2026-01-01T00:00:00Z", "TRANSCRIPT")])).toEqual([]);
  });

  it("compares what the decks said: research findings and meeting statements are not deck claims", () => {
    const d = makeDeal();
    const src = (id: string, kind: "DOCUMENT" | "WEB" | "TRANSCRIPT") => ({ id, kind, title: id, url: null, documentId: null, publisher: null, publishedDate: null, retrievedAt: "2026-01-01", origin: "COMPANY" as const, independenceGroup: id, citationVerified: false });
    d.sources = [src("SRC-001", "DOCUMENT"), src("SRC-002", "WEB"), src("SRC-003", "TRANSCRIPT")];
    const cl = (id: string, sourceId: string | null) => ({ id, category: "PRODUCT" as const, statement: id, valueText: null, entity: "company", period: null, material: true, unusualness: 2, proposition: null, evidenceNeeded: null, origin: "COMPANY" as const, verification: "UNVERIFIED" as const, freshness: "CURRENT" as const, independence: "COMPANY_DERIVED" as const, verificationMethod: "", limitations: null, contradictions: [], evidence: sourceId ? [{ sourceId, effect: "ORIGIN" as const, excerpt: "", location: null, note: null }] : [], history: [] });
    d.claims = [cl("deck", "SRC-001"), cl("web", "SRC-002"), cl("call", "SRC-003"), cl("bare", null)];
    expect(deckView(CanonicalDeal.parse(d)).claims.map((c) => c.id)).toEqual(["deck", "bare"]);
  });

  it("picks the deck of an upload set: first PDF/PPTX, else an image", () => {
    expect(pickDeckIndex([{ kind: "TEXT" }, { kind: "PDF" }, { kind: "PPTX" }])).toBe(1);
    expect(pickDeckIndex([{ kind: "TEXT" }, { kind: "IMAGE" }])).toBe(1);
    expect(pickDeckIndex([])).toBe(-1);
  });
});

/* ------------------------------------------------------------------ */
/* DB: v1 → v2 → v3 on the same company                                 */
/* ------------------------------------------------------------------ */

describe("deck versions on the same company", () => {
  it("records lineage, keeps the company, carries the override, stages versions and diffs stored decks", async () => {
    const r1 = await upload([DECK1()], deckV1);
    expect(r1.outcome).toBe("STARTED");
    expect(r1.deckVersion).toBe(1);
    const company = repo.getCompany(ws.workspaceId, r1.company.id)!;
    const v1 = repo.getCurrentVersion(company)!;
    expect(meetings.stageOfVersion(company.id, v1.row.id)!.stage).toBe("PRE_MEETING_ANALYSIS");
    expect(deckLineage(company.id).map((e) => [e.seq, e.filename])).toEqual([[1, "ledgerline-clean.pdf"]]);
    expect(deckComparison(company.id, { id: v1.row.id, versionNo: v1.row.versionNo, documentIds: v1.canonical.documents.map((d) => d.id) })).toBeNull();

    // The analyst overrides June ARR (MET-001) before the new deck arrives.
    const o = commitOverride({ workspaceId: ws.workspaceId, userId: ws.userId, name: "GP" }, company.id, { target: "METRIC", ref: "MET-001", field: "normalizedValue", to: 3_500_000, reason: "Bank statements: June ARR is $3.5M" });
    expect(o.ok).toBe(true);

    // Deck v2 on the SAME company.
    const r2 = await upload([DECK2()], deckV2, { target: { companyId: company.id, intent: "NEW_DECK_VERSION" } });
    expect(r2.outcome).toBe("NEW_DECK_VERSION");
    expect(r2.company.id).toBe(company.id);
    expect(r2.deckVersion).toBe(2);
    expect(repo.listCompanies(ws.workspaceId)).toHaveLength(1);
    const docs = repo.listDocuments(company.id);
    const d1 = docs.find((d) => d.filename === "ledgerline-clean.pdf")!;
    const d2 = docs.find((d) => d.filename === "ledgerline-series-a.pdf")!;
    expect([d1.deckVersion, d2.deckVersion, d2.supersedesDocumentId]).toEqual([1, 2, d1.id]);

    const v2 = repo.getCurrentVersion(repo.getCompany(ws.workspaceId, company.id)!)!;
    expect(v2.canonical.documents.map((d) => d.id)).toEqual([d2.id]);
    expect(meetings.stageOfVersion(company.id, v2.row.id)!.stage).toBe("PRE_MEETING_ANALYSIS");
    // Override re-anchored: June ARR is MET-012 in the new analysis; MET-001 is now gross margin and untouched.
    const ovr = v2.canonical.overrides[0]!;
    expect(ovr).toMatchObject({ ref: "MET-012", to: 3_500_000, carry: { status: "REANCHORED", match: "EXACT", fromRef: "MET-001" } });
    expect(ovr.carry!.note).toMatch(/source changed: the new analysis reports 3600000 \(was 3840000/);
    const eff = applyOverrides(v2.canonical);
    expect(eff.metrics.find((x) => x.id === "MET-012")!.normalizedValue).toBe(3_500_000);
    expect(eff.metrics.find((x) => x.id === "MET-001")!.normalizedValue).toBe(74);
    const hist = repo.listHistory(company.id);
    expect(hist.find((h) => h.type === "DECK_VERSION_ADDED")!.summary).toBe("Deck v2: ledgerline-series-a.pdf (supersedes v1: ledgerline-clean.pdf)");
    expect(hist.find((h) => h.type === "OVERRIDES_CARRIED_OVER")!.summary).toBe("1 override re-applied");

    // deckDiff wired on the two stored analyses.
    const cmp = deckComparisonForVersion(company.id, v2.row.id)!;
    expect(cmp.current.seq).toBe(2);
    expect(cmp.previous.seq).toBe(1);
    expect(cmp.previousVersion!.versionNo).toBe(v1.row.versionNo);
    const diff = cmp.diff!;
    expect(diff.changedNumbers.find((x) => x.kind === "RESTATED")).toMatchObject({ metricKey: "arr", previous: { value: 3_840_000 }, current: { value: 3_600_000 } });
    expect(diff.metricsRemoved.map((x) => x.metricKey)).toContain("nrr");
    expect(diff.metricsAdded.map((x) => x.metricKey)).toContain("gross_margin");
    expect(diff.marketChanges.find((x) => x.field === "TAM")).toMatchObject({ previous: "$12B", current: "$30B" });
    expect(diff.stoppedTalkingAbout.some((t) => t.kind === "METRIC" && t.topic === "nrr")).toBe(true);
    // The comparison is of what the decks said — the analyst override does not leak into it.
    expect(diff.changedNumbers.find((x) => x.kind === "RESTATED")!.current.value).toBe(3_600_000);

    // The Fund Brain gets a compact, code-computed summary.
    const lines = deckChangeLines(cmp, 6);
    expect(lines[0]).toMatch(/^Deck v2 \(ledgerline-series-a\.pdf\) vs deck v1 \(ledgerline-clean\.pdf\), computed from the two stored analyses/);
    expect(lines.join("\n")).toMatch(/arr for 2026-06 was restated from \$3\.84M \(p\. 5\) to \$3\.6M/);
    const pack = buildMemoryPack(company, v2.row.id, eff, v2.derived, { deckChanges: lines }).pack.text;
    expect(pack).toContain("## Since the last deck");
    expect(DECK_CHANGE_QUESTION.test("What changed since the last deck?")).toBe(true);
    expect(DECK_CHANGE_QUESTION.test("Qu'est-ce qui a changé par rapport au dernier deck ?")).toBe(true);
    expect(DECK_CHANGE_QUESTION.test("What is the ARR?")).toBe(false);

    // A founder meeting, then deck v3 → DECK_REANALYSIS, lineage v3 supersedes v2; the ARR override cannot anchor (no June figure) and is reported.
    meetings.createMeeting({ workspaceId: ws.workspaceId, companyId: company.id, title: "Call", heldAt: new Date().toISOString(), participants: [], source: "PASTED_TRANSCRIPT", status: "READY", preAnalysisVersionId: v2.row.id, preBriefId: null, createdBy: ws.userId });
    const r3 = await upload([DECK3()], deckV3, { target: { companyId: company.id, intent: "NEW_DECK_VERSION" } });
    expect(r3.deckVersion).toBe(3);
    const v3 = repo.getCurrentVersion(repo.getCompany(ws.workspaceId, company.id)!)!;
    expect(meetings.stageOfVersion(company.id, v3.row.id)!.stage).toBe("DECK_REANALYSIS");
    expect(repo.listDocuments(company.id).find((d) => d.deckVersion === 3)!.supersedesDocumentId).toBe(d2.id);
    expect(v3.canonical.overrides).toHaveLength(1); // never dropped
    expect(v3.canonical.overrides[0]!.carry).toMatchObject({ status: "UNANCHORED", fromRef: "MET-012" });
    expect(applyOverrides(v3.canonical).metrics.every((x) => x.normalizedValue !== 3_500_000)).toBe(true);
    expect(repo.listHistory(company.id).find((h) => h.type === "OVERRIDES_CARRIED_OVER")!.summary).toMatch(/^0 overrides re-applied; 1 NOT re-applied — OVR-001 \(target not found in the new analysis — the new analysis reports arr for 2027-03, not for 2026-06\)/);
    expect(deckComparisonForVersion(company.id, v3.row.id)!.previous.seq).toBe(2);
    expect(deckAnalysisRow(company.id, d1.id, v3.row.versionNo)!.id).toBe(v1.row.id);
  });

  it("adds documents to the current deck (same deck version) and refuses a new deck while a run is going", async () => {
    const r1 = await upload([DECK1()], deckV1);
    const r2 = await upload([note("FY2026 revenue bridge")], deckV1, { target: { companyId: r1.company.id, intent: "ADD_DOCUMENTS" } });
    expect(r2.outcome).toBe("DOCUMENTS_ADDED");
    expect(r2.deckVersion).toBeNull();
    const v = repo.getCurrentVersion(repo.getCompany(ws.workspaceId, r1.company.id)!)!;
    expect(v.canonical.documents.map((d) => d.filename).sort()).toEqual(["financials.txt", "ledgerline-clean.pdf"]);
    expect(deckLineage(r1.company.id)).toHaveLength(1);
    expect(repo.listHistory(r1.company.id).some((h) => h.type === "DOCUMENTS_ADDED")).toBe(true);

    await expect(upload([note("x")], null, { target: { companyId: r1.company.id, intent: "NEW_DECK_VERSION" } })).rejects.toThrow(/No new deck/);
    await expect(upload([DECK2()], null, { target: { companyId: "co_missing", intent: "NEW_DECK_VERSION" } })).rejects.toBeInstanceOf(AnalysisRequestError);
    // A running analysis blocks a second one on the same company.
    const run = repo.createRun({ workspaceId: ws.workspaceId, companyId: r1.company.id, mode: "FAST_SCREEN", model: "x", promptVersions: {}, registryId: "r", budgetUsd: 1, steps: [] });
    const err = await upload([DECK2()], null, { target: { companyId: r1.company.id, intent: "NEW_DECK_VERSION" } }).catch((e) => e);
    expect(err).toBeInstanceOf(AnalysisRequestError);
    expect((err as AnalysisRequestError).status).toBe(409);
    repo.finishRun(run.id, "COMPLETED", 0, "FULL");
    // Re-uploading the current deck as a "new version" is the idempotent re-upload, not a v2.
    const same = await upload([DECK1()], deckV1, { target: { companyId: r1.company.id, intent: "NEW_DECK_VERSION" }, mode: "FAST_SCREEN" });
    expect(["ALREADY_ANALYZED", "REANALYZED"]).toContain(same.outcome);
    expect(deckLineage(r1.company.id)).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/* DB: duplicates — asked before and after triage, never merged silently */
/* ------------------------------------------------------------------ */

describe("duplicate companies", () => {
  it("asks before the upload (file name + URL) and remembers “different company”", async () => {
    const r1 = await upload([DECK1()], deckV1);
    expect(uploadMatches(ws.workspaceId, { filenames: ["ledgerline-series-a.pdf"] })[0]).toMatchObject({ companyId: r1.company.id, verdict: "POSSIBLE" });
    expect(uploadMatches(ws.workspaceId, { filenames: ["x.pdf"], url: "https://app.ledgerline.io" })[0]).toMatchObject({ verdict: "SAME_LIKELY" });
    expect(uploadMatches(ws.workspaceId, { filenames: ["ledgerline.pdf"], url: "https://ledgerline.de" })[0]).toMatchObject({ verdict: "DIFFERENT_LIKELY" });
    expect(uploadMatches(ws.workspaceId, { filenames: ["orbital-seed.pdf"] })).toEqual([]);

    // The user says "different company": a homonym is created and the question is not asked again on its page.
    const homonym = ledgerline("https://ledgerline.de", (d) => {
      d.foundersFromDeck = founders(["Jane Smith"]);
    });
    const r2 = await upload([DECK2()], homonym, { distinctFrom: [r1.company.id] });
    expect(r2.company.id).not.toBe(r1.company.id);
    expect(duplicateSuggestions(ws.workspaceId, r2.company.id)).toEqual([]);
    expect(repo.listHistory(r1.company.id).some((h) => h.type === "DUPLICATE_DISMISSED")).toBe(true);
  });

  it("after triage, suggests the older dossier on the newer one only; merge re-analyses there as the next deck version", async () => {
    const r1 = await upload([DECK1()], deckV1);
    const o = commitOverride({ workspaceId: ws.workspaceId, userId: ws.userId, name: "GP" }, r1.company.id, { target: "CLASSIFICATION", ref: "classification", field: "financingStage", to: "SEED", reason: "Seed extension" });
    expect(o.ok).toBe(true);
    // Uploaded from the generic page without answering the prompt → a new company; identity is only known after triage.
    const r2 = await upload([DECK2()], deckV2);
    expect(r2.company.id).not.toBe(r1.company.id);
    const sugg = duplicateSuggestions(ws.workspaceId, r2.company.id);
    expect(sugg[0]).toMatchObject({ companyId: r1.company.id, verdict: "SAME_LIKELY" });
    expect(sugg[0]!.reasons.join(" ")).toMatch(/same website \(ledgerline\.io\)/);
    expect(duplicateSuggestions(ws.workspaceId, r1.company.id)).toEqual([]); // never on the older dossier
    // Nothing merged until the user clicks.
    expect(repo.listCompanies(ws.workspaceId)).toHaveLength(2);

    queue.push(deckV2);
    const merged = await mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r2.company.id, targetId: r1.company.id });
    await merged.promise;
    expect(merged.company.id).toBe(r1.company.id);
    expect(merged.deckVersion).toBe(2);
    expect(repo.listCompanies(ws.workspaceId).map((c) => c.id)).toEqual([r1.company.id]);
    const src = getDb().select().from(schema.companies).where(eq(schema.companies.id, r2.company.id)).get()!;
    expect(src.mergedIntoId).toBe(r1.company.id);
    expect(src.deletedAt).not.toBeNull();
    expect(repo.mergedTarget(ws.workspaceId, src.slug)!.id).toBe(r1.company.id);
    // The duplicate's versions and documents are kept (audit), its Fund Brain memory is gone.
    expect(repo.listVersions(r2.company.id).length).toBeGreaterThan(0);
    expect(repo.listDocuments(r2.company.id)).toHaveLength(1);
    expect(getDb().select().from(schema.memoryPacks).where(eq(schema.memoryPacks.companyId, r2.company.id)).all()).toEqual([]);
    // Target: deck v2 recorded, overrides carried (classification by path), history on both sides.
    const t = repo.getCurrentVersion(repo.getCompany(ws.workspaceId, r1.company.id)!)!;
    expect(deckLineage(r1.company.id).map((e) => e.seq)).toEqual([1, 2]);
    expect(t.canonical.overrides[0]).toMatchObject({ target: "CLASSIFICATION", carry: { status: "REANCHORED", match: "FIELD" } });
    expect(applyOverrides(t.canonical).classification.financingStage).toBe("SEED");
    expect(repo.listHistory(r1.company.id).find((h) => h.type === "DECK_VERSION_ADDED")!.summary).toMatch(/merged from Ledgerline/);
    expect(repo.listHistory(r2.company.id).find((h) => h.type === "COMPANY_MERGED")!.summary).toMatch(/Merged into Ledgerline as deck v2/);
    // Re-uploading the merged file now resolves to the target (the soft-deleted duplicate is ignored).
    const again = await upload([DECK2()], deckV2);
    expect(again.company.id).toBe(r1.company.id);
  });

  it("dismissing a suggestion is remembered on both sides", async () => {
    const r1 = await upload([DECK1()], deckV1);
    const r2 = await upload([DECK2()], deckV2);
    expect(duplicateSuggestions(ws.workspaceId, r2.company.id)).toHaveLength(1);
    dismissDuplicate(ws.workspaceId, ws.userId, r2.company.id, r1.company.id);
    expect(duplicateSuggestions(ws.workspaceId, r2.company.id)).toEqual([]);
    await expect(mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r1.company.id, targetId: r1.company.id })).rejects.toThrow(/itself/);
  });

  it("merges once: two simultaneous merges of the same duplicate (or of each into the other) start one analysis", async () => {
    const r1 = await upload([DECK1()], deckV1);
    const r2 = await upload([DECK2()], deckV2);
    queue.push(deckV2, deckV2);
    const both = await Promise.allSettled([
      mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r2.company.id, targetId: r1.company.id }),
      mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r2.company.id, targetId: r1.company.id }),
      mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r1.company.id, targetId: r2.company.id }),
    ]);
    const ok = both.filter((x) => x.status === "fulfilled");
    expect(ok).toHaveLength(1);
    await (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof mergeIntoCompany>>>).value.promise;
    for (const x of both.filter((x) => x.status === "rejected")) expect((x as PromiseRejectedResult).reason).toBeInstanceOf(AnalysisRequestError);
    // Whichever merge claims first wins (the reverse merge can win under load); exactly one dossier survives with both decks.
    const survivor = both.indexOf(ok[0]!) === 2 ? r2.company.id : r1.company.id;
    expect(repo.listCompanies(ws.workspaceId).map((c) => c.id)).toEqual([survivor]);
    expect(deckLineage(survivor).map((e) => e.seq)).toEqual([1, 2]);
    expect(repo.listHistory(survivor).filter((h) => h.type === "COMPANY_MERGED")).toHaveLength(1);
    // A merge that cannot start (target busy) leaves the duplicate live.
    const r3 = await upload([DECK3()], deckV3);
    const run = repo.createRun({ workspaceId: ws.workspaceId, companyId: survivor, mode: "FAST_SCREEN", model: "m", promptVersions: {}, registryId: "r", budgetUsd: 0.1, steps: [] });
    await expect(mergeIntoCompany({ workspaceId: ws.workspaceId, userId: ws.userId, sourceId: r3.company.id, targetId: survivor })).rejects.toThrow(/running/);
    repo.finishRun(run.id, "COMPLETED", 0, "FULL");
    expect(repo.getCompany(ws.workspaceId, r3.company.id)).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/* DB: legacy USER_CORRECTED rows                                       */
/* ------------------------------------------------------------------ */

describe("legacy corrections stored before the consolidation", () => {
  it("are read as overrides, the stored row is untouched, and new edits persist the upgraded form", async () => {
    const r1 = await upload([DECK1()], deckV1);
    const company = repo.getCompany(ws.workspaceId, r1.company.id)!;
    const cur = repo.getCurrentVersion(company)!;
    // A version written by the old "Correct this metric" path.
    const legacy = structuredClone(cur.canonical);
    const orig = legacy.metrics.find((x) => x.id === "MET-001")!;
    orig.isPrimary = false;
    legacy.metrics.push({ ...orig, id: "MET-020", rawValue: "3200000 USD (analyst correction)", normalizedValue: 3_200_000, calculationMethod: "USER_CORRECTED", isPrimary: true, qualityFlags: ["USER_CORRECTED: was $3.84M"], notes: "Corrected by GP on 2026-04-02 (replaces MET-001, was $3.84M). Signed contracts only" });
    const saved = repo.saveVersion({ company, canonical: legacy, derived: derive(legacy, getRegistry(), repo.getDefaultFund(ws.workspaceId)), reason: "METRIC_CORRECTION", summary: "legacy correction" });

    const raw = getDb().select().from(schema.companyVersions).where(eq(schema.companyVersions.id, saved.id)).get()!;
    expect((raw.canonical as CanonicalDeal).metrics.some((x) => x.calculationMethod === "USER_CORRECTED")).toBe(true); // immutable row
    const read = repo.getVersion(company.id, saved.id)!;
    expect(read.canonical.metrics.some((x) => x.calculationMethod === "USER_CORRECTED")).toBe(false);
    expect(read.canonical.overrides[0]).toMatchObject({ ref: "MET-001", to: 3_200_000, by: "GP", reason: "Signed contracts only", legacy: { correctedInstanceId: "MET-020" } });
    expect(applyOverrides(read.canonical).metrics.find((x) => x.metricKey === "arr" && x.isPrimary)!.normalizedValue).toBe(3_200_000);

    // The next edit goes through the one path and persists the upgraded form; the legacy override is revertable.
    const rev = commitOverride({ workspaceId: ws.workspaceId, userId: ws.userId, name: "GP" }, company.id, { target: "ENTITY", ref: "identity", field: "hqCountry", to: "France", reason: "Registry" });
    expect(rev.ok).toBe(true);
    const next = getDb().select().from(schema.companyVersions).where(eq(schema.companyVersions.id, repo.getCompany(ws.workspaceId, company.id)!.currentVersionId!)).get()!;
    const stored = next.canonical as CanonicalDeal;
    expect(stored.metrics.some((x) => x.calculationMethod === "USER_CORRECTED")).toBe(false);
    expect(stored.overrides.map((x) => x.id)).toEqual(["OVR-001", "OVR-002"]);
  });
});

describe("deal header — one consistent view of same-company signals", () => {
  const link = (companyId: string, type: "ALIAS_OF" | "POSSIBLY_SAME_AS") => ({ companyId, slug: companyId, name: companyId.toUpperCase(), type, reasons: "" });
  const aliases = { formerNames: [], linked: [link("a", "ALIAS_OF"), link("b", "POSSIBLY_SAME_AS"), link("c", "POSSIBLY_SAME_AS")] };

  it("does not repeat a company already offered for merge as an unconfirmed link", () => {
    expect(sameCompanySignals(aliases, [{ companyId: "b" }], new Set()).linked.map((l) => l.companyId)).toEqual(["a", "c"]);
  });

  it("never shows a company the user confirmed as different", () => {
    expect(sameCompanySignals(aliases, [], new Set(["a", "c"])).linked.map((l) => l.companyId)).toEqual(["b"]);
  });

  it("keeps a confirmed alias even when a merge is offered for it", () => {
    expect(sameCompanySignals(aliases, [{ companyId: "a" }], new Set()).linked.map((l) => l.companyId)).toEqual(["a", "b", "c"]);
  });
});
