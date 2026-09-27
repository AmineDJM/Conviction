/**
 * Integrity engine — 11. source reliability, 8. information density.
 */
import { describe, expect, it } from "vitest";
import { classifySource, domainOf, effectiveIndependentConfirmations } from "@/engine/integrity/sources";
import { buildContext } from "@/engine/integrity/context";
import { claim, cleanDeal, findingsOf, link, one, REG, run, webSource } from "./fixtures/integrity/builders";
import { resolvePeerGroup } from "@/engine/scoring/peer";

const S = (url: string, title = "Some article") => ({ url, title, origin: "INDEPENDENT_SECONDARY" as const, independenceGroup: domainOf(url) ?? "x" });

describe("source classification", () => {
  it.each([
    ["https://www.sec.gov/Archives/edgar/data/1/0001.htm", "PRIMARY_RECORD"],
    ["https://find-and-update.company-information.service.gov.uk/company/123", "PRIMARY_RECORD"],
    ["https://patents.google.com/patent/US123", "PRIMARY_RECORD"],
    ["https://arxiv.org/abs/2401.00001", "PRIMARY_RECORD"],
    ["https://github.com/acme/engine", "PRIMARY_RECORD"],
    ["https://www.nsf.gov/awards/1", "PRIMARY_RECORD"],
    ["https://cs.stanford.edu/paper.pdf", "PRIMARY_RECORD"],
    ["https://www.ox.ac.uk/news", "PRIMARY_RECORD"],
    ["https://annuaire-entreprises.data.gouv.fr/entreprise/123", "PRIMARY_RECORD"],
    ["https://www.prnewswire.com/news-releases/acme-raises", "COMPANY_DERIVED"],
    ["https://www.businesswire.com/news/home/1", "COMPANY_DERIVED"],
    ["https://www.globenewswire.com/news-release/1", "COMPANY_DERIVED"],
    ["https://www.accesswire.com/1", "COMPANY_DERIVED"],
    ["https://www.einpresswire.com/article/1", "COMPANY_DERIVED"],
    ["https://blog.acme.example/launch", "COMPANY_DERIVED"],
    ["https://www.marketsandmarkets.com/Market-Reports/ap-automation.html", "COMMERCIAL_ESTIMATE"],
    ["https://www.grandviewresearch.com/industry-analysis/x", "COMMERCIAL_ESTIMATE"],
    ["https://www.mordorintelligence.com/industry-reports/x", "COMMERCIAL_ESTIMATE"],
    ["https://www.linkedin.com/in/ada", "SELF_AUTHORED_PROFILE"],
    ["https://x.com/acme", "SELF_AUTHORED_PROFILE"],
    ["https://www.crunchbase.com/organization/acme", "SELF_AUTHORED_PROFILE"],
    ["https://www.g2.com/products/acme/reviews", "LOW_QUALITY"],
    ["https://best-ap-tools.com/acme", "LOW_QUALITY"],
    ["https://www.reuters.com/technology/acme", "SECONDARY"],
    ["https://www.canvas-news.com/acme", "SECONDARY"], // "vs" inside a word is not an SEO signal
    ["https://www.bestbuy.com/x", "SECONDARY"],
    ["not a url at all", "SECONDARY"],
  ])("%s → %s", (url, tier) => {
    expect(classifySource(S(url), "acme.example").tier).toBe(tier);
  });
  it.each([
    ["Top 10 AP automation tools in 2026", "LOW_QUALITY"],
    ["The 7 best invoice software alternatives", "LOW_QUALITY"],
    ["Best AP automation software for mid-market", "LOW_QUALITY"],
    ["Alternatives to Acme", "LOW_QUALITY"],
    ["Acme raises $12M to automate invoices", "SECONDARY"],
  ])("title %j → %s", (title, tier) => {
    expect(classifySource(S("https://www.somesite.com/a", title), null).tier).toBe(tier);
  });
  it("no URL → UNKNOWN", () => {
    expect(classifySource({ url: null, title: "x", origin: "INDEPENDENT_SECONDARY", independenceGroup: "x" }, null)).toEqual({ tier: "UNKNOWN", flags: ["NO_URL"] });
  });
});

describe("stale sources and dates", () => {
  it.each([
    ["2026-06-01", []],
    ["2025-06-01", []], // ~16 months
    ["2024-12-01", ["STALE"]], // ~22 months
    [null, ["UNKNOWN_DATE"]],
    ["not a date", ["UNKNOWN_DATE"]],
  ])("published %s → %j", (date, flags) => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-050", "https://www.reuters.com/a", { publishedDate: date }));
    const rel = run(d).sourceReliability.find((s) => s.sourceId === "SRC-050")!;
    expect(rel.flags.filter((f) => f === "STALE" || f === "UNKNOWN_DATE")).toEqual(flags);
  });

  it("staleness is measured from the deal's own analysis date, never the wall clock", () => {
    const d = cleanDeal();
    d.analysis.provenance!.startedAt = "2024-01-01T00:00:00Z";
    d.sources.push(webSource("SRC-050", "https://www.reuters.com/a", { publishedDate: "2023-01-01" }));
    expect(run(d).sourceReliability.find((s) => s.sourceId === "SRC-050")!.flags).not.toContain("STALE");
  });

  it("a VERIFIED material claim resting only on a stale source → HIGH", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-050", "https://www.reuters.com/a", { publishedDate: "2023-01-01", origin: "PRIMARY_EXTERNAL" }));
    d.claims.push(claim("CLM-V", { verification: "VERIFIED", evidence: [link("SRC-001", "ORIGIN"), link("SRC-050", "CONFIRMS")] }));
    const f = one(run(d), "VERIFICATION_RESTS_ON_WEAK_SOURCE");
    expect([f.severity, f.claimIds, f.sourceIds]).toEqual(["HIGH", ["CLM-V"], ["SRC-050"]]);
  });

  it.each([
    ["https://www.prnewswire.com/x", "VERIFIED", "HIGH"],
    ["https://www.linkedin.com/in/x", "PARTIALLY_VERIFIED", "MODERATE"],
    ["https://top10tools.io/x", "VERIFIED", "HIGH"],
    ["https://www.reuters.com/x", "VERIFIED", null],
  ] as const)("claim %s via %s → %s", (url, verification, sev) => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-050", url));
    d.claims.push(claim("CLM-V", { verification, evidence: [link("SRC-050", "CONFIRMS")] }));
    expect(findingsOf(run(d), "VERIFICATION_RESTS_ON_WEAK_SOURCE").map((f) => f.severity)).toEqual(sev ? [sev] : []);
  });

  it("an unverified citation is weak support", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-050", "https://www.reuters.com/x", { citationVerified: false }));
    d.claims.push(claim("CLM-V", { verification: "PARTIALLY_VERIFIED", evidence: [link("SRC-050", "CONFIRMS")] }));
    const r = run(d);
    expect(r.sourceReliability[0]!.flags).toContain("CITATION_UNVERIFIED");
    expect(findingsOf(r, "VERIFICATION_RESTS_ON_WEAK_SOURCE").length).toBe(1);
  });
});

describe("duplicated press", () => {
  const dup = () => {
    const d = cleanDeal();
    d.sources.push(
      webSource("SRC-060", "https://www.techsite-a.com/acme", { title: "Acme raises $12M Series A to automate accounts payable" }),
      webSource("SRC-061", "https://www.newsdaily-b.com/acme", { title: "Acme raises $12M Series A to automate accounts payable invoices" }),
      webSource("SRC-062", "https://www.reuters.com/acme", { title: "Payables software maker lands big-bank customer" }),
    );
    d.claims.push(claim("CLM-R", { category: "FUNDING", verification: "VERIFIED", evidence: [link("SRC-060", "CONFIRMS"), link("SRC-061", "CONFIRMS")] }));
    return d;
  };
  it("near-duplicate titles on different domains form one story cluster", () => {
    const rel = run(dup()).sourceReliability;
    const c = (id: string) => rel.find((s) => s.sourceId === id)!.cluster;
    expect(c("SRC-060")).toBe("STORY-1");
    expect(c("SRC-061")).toBe("STORY-1");
    expect(c("SRC-062")).toBeNull();
  });
  it("counts as one confirmation, not two", () => {
    const d = dup();
    const f = one(run(d), "DUPLICATED_PRESS");
    expect(f.sourceIds).toEqual(["SRC-060", "SRC-061"]);
    const ctx = buildContext(d, REG, resolvePeerGroup(d.classification));
    const rel = run(d).sourceReliability;
    expect(effectiveIndependentConfirmations(d.claims.find((c) => c.id === "CLM-R")!, rel, ctx)).toBe(1);
  });
  it("near-duplicate findings text (excerpts) also clusters", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-070", "https://www.one.com/a", { title: "Story one" }), webSource("SRC-071", "https://www.two.com/b", { title: "Different headline" }));
    const txt = "Acme announced that Globex signed a three year enterprise agreement worth two million dollars";
    d.claims.push(claim("CLM-D", { verification: "VERIFIED", evidence: [link("SRC-070", "CONFIRMS", { excerpt: txt }), link("SRC-071", "CONFIRMS", { excerpt: `${txt} per the company` })] }));
    expect(findingsOf(run(d), "DUPLICATED_PRESS").length).toBe(1);
  });
  it("same-domain duplicates are not a press cluster", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-080", "https://www.ft.com/a", { title: "Acme raises $12M Series A to automate payables" }), webSource("SRC-081", "https://www.ft.com/b", { title: "Acme raises $12M Series A to automate payables" }));
    expect(run(d).sourceReliability.every((s) => s.cluster === null)).toBe(true);
  });
  it("market size resting only on commercial estimates is LOW and says 'not fake'", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-090", "https://www.fortunebusinessinsights.com/x"));
    d.claims.push(claim("CLM-MK", { category: "MARKET", verification: "PARTIALLY_VERIFIED", evidence: [link("SRC-090", "CONFIRMS")] }));
    const f = one(run(d), "COMMERCIAL_MARKET_ESTIMATE");
    expect(f.severity).toBe("LOW");
    expect(f.detail).toContain("not fake");
  });
  it("document and transcript sources are not classified as web sources", () => {
    expect(run(cleanDeal()).sourceReliability).toEqual([]);
  });
});

describe("information density (communication signal)", () => {
  it("is labelled as a communication signal, not company quality", () => {
    expect(run(cleanDeal()).density.label).toBe("Communication signal, not company quality");
  });
  it("never produces findings or changes severity counts", () => {
    const d = cleanDeal();
    d.documents = [{ id: "doc-1", filename: "deck.pdf", kind: "DECK", pages: 60 }];
    const r = run(d);
    expect(r.density.shareOfPagesWithoutDecisionFacts).toBeGreaterThan(0.8);
    expect(r.findings).toEqual([]);
  });
  it("computes per-page ratios from document page counts", () => {
    const r = run(cleanDeal());
    expect(r.density.pages).toBe(12);
    expect(r.density.materialClaims).toBe(3);
    expect(r.density.materialClaimsPerPage).toBeCloseTo(0.25, 3);
    expect(r.density.quantitativeObservations).toBe(2);
  });
  it("transcripts are excluded from the page count", () => {
    const d = cleanDeal();
    d.documents.push({ id: "doc-2", filename: "call.txt", kind: "TRANSCRIPT", pages: 40 });
    expect(run(d).density.pages).toBe(12);
  });
  it("falls back to the highest referenced page when page counts are unknown", () => {
    const d = cleanDeal();
    d.documents = [];
    expect(run(d).density.pages).toBe(10); // team claim on p. 10
  });
  it("unsupported-claim ratio = material claims resting on the company only", () => {
    const d = cleanDeal();
    d.sources.push(webSource("SRC-020", "https://www.ft.com/a"));
    d.claims[0]!.evidence.push(link("SRC-020", "CONFIRMS"));
    expect(run(d).density.unsupportedClaimRatio).toBeCloseTo(2 / 3, 3);
  });
  it.each([
    ["ARR grew to $3.8M in August 2026", "ARR grew to $3.8M in August 2026 across all regions", true],
    ["ARR grew to $3.8M in August 2026", "Our NRR is 118% measured over trailing twelve months", false],
    ["We are the leading AI platform for finance teams", "We are the leading AI platform for finance teams worldwide", true],
  ])("redundancy: %j vs %j → %s", (a, b, dup) => {
    const d = cleanDeal();
    d.claims = [claim("CLM-A", { statement: a }), claim("CLM-B", { statement: b })];
    const r = run(d);
    expect(r.density.redundantClaimPairs.length > 0).toBe(dup);
    if (dup) expect(r.density.redundancyRatio).toBeCloseTo(0.5, 3);
  });
  it("pages without decision-relevant facts", () => {
    const r = run(cleanDeal());
    expect(r.density.pagesWithoutDecisionFacts).toEqual([1, 11, 12]);
  });
});
