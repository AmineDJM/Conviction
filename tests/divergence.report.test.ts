/**
 * Divergence report: OQI invariance, robustness (empty / malformed input),
 * determinism, latency, no blended score, schema/upgrade compatibility, the
 * model hand-off (mocked output → applyDivergence → derive), prompt digests
 * and the Fund Brain memory pack.
 */
import { describe, expect, it } from "vitest";
import { CanonicalDeal, CANONICAL_SCHEMA_VERSION, emptyCanonical, upgradeCanonical } from "@/domain/canonical";
import { DivergenceDraft } from "@/domain/sections";
import { toStrictJsonSchema } from "@/ai/json-schema";
import { PROMPT_VERSIONS } from "@/ai/prompts";
import { DIVERGENCE_SIGNALS, DivergenceSignalsOutput, divergenceSignalsInstructions } from "@/ai/prompts/divergence";
import { DECISION_CHALLENGE, DECISION_THESIS, challengeInstructions, thesisInstructions } from "@/ai/prompts/decision";
import { applyDivergence } from "@/orchestration/assemble";
import { derivedDigest } from "@/orchestration/context";
import { buildMemoryPack } from "@/brain/memory-pack";
import { divergenceReport, factorOf, DIVERGENCE_ENGINE_VERSION, DIVERGENCE_QUESTION, FACTOR_IDS } from "@/engine/divergence";
import { resolvePeerGroup } from "@/engine/scoring/peer";
import type { DerivedAnalysis } from "@/engine/derive";
import { makeDeal } from "./fixtures";
import { AS_OF, FUND, LEVELS, REG, dealWith, derived, emptyDraft, report, richDeal, usd } from "./divergence.helpers";

describe("divergence · the Operating Quality Index never sees divergence", () => {
  it("OQI, dimensions, evidence, power-law, fund fit, risk and recommendation are identical with and without divergence data", () => {
    // One base object: fixtures number metric ids globally, so both variants must share them.
    const base = makeDeal();
    const without = derived(base);
    const withDiv = derived({ ...base, divergence: richDeal().divergence });
    expect(withDiv.operatingQuality).toEqual(without.operatingQuality);
    expect(withDiv.dimensions).toEqual(without.dimensions);
    expect(withDiv.evidence).toEqual(without.evidence);
    expect(withDiv.powerLaw).toEqual(without.powerLaw);
    expect(withDiv.fundFit).toEqual(without.fundFit);
    expect(withDiv.risk).toEqual(without.risk);
    expect(withDiv.recommendation).toEqual(without.recommendation);
    expect(withDiv.returns).toEqual(without.returns);
    // …while the divergence report itself did change.
    expect(withDiv.divergence.factors.map((f) => f.level)).not.toEqual(without.divergence.factors.map((f) => f.level));
  });

  it("a hostile divergence reading (every factor WEAK-leaning) leaves the OQI unchanged too", () => {
    const hostile = dealWith((d) => {
      d.dependencies = [{ kind: "MODEL_PROVIDER", provider: "OpenAI", whatItProvides: "all inference", criticality: "CORE", substitutability: "HARD", switchingTimeMonths: 12, mitigationStated: null, evidence: "100% OpenAI", page: 3 }];
      d.focus = { products: [1, 2, 3, 4, 5].map((i) => ({ name: `P${i}`, status: "LIVE" as const, page: 2 })), customerSegments: [], markets: [1, 2, 3, 4].map((i) => ({ name: `C${i}`, status: "ACTIVE" as const, page: 2 })), channels: [] };
      d.loops = [];
    });
    expect(derived(hostile).operatingQuality).toEqual(derived({ ...hostile, divergence: null }).operatingQuality);
  });

  it("the report is marked secondary and carries no blended score", () => {
    const r = derived(richDeal()).divergence;
    expect(r.secondary).toBe(true);
    const keys = Object.keys(r);
    expect(keys).not.toContain("score");
    expect(keys).not.toContain("index");
    expect(JSON.stringify(r.summary)).not.toMatch(/probabilit(y|ies) of/i);
    for (const f of r.factors) expect(LEVELS).toContain(f.level);
  });
});

describe("divergence · robustness", () => {
  it("never throws on emptyCanonical and reports every factor as INSUFFICIENT_EVIDENCE", () => {
    const d = emptyCanonical("STANDARD");
    const r = divergenceReport(d, REG, resolvePeerGroup(d.classification), { asOf: AS_OF });
    expect(r.factors).toHaveLength(10);
    expect(r.factors.every((f) => f.level === "INSUFFICIENT_EVIDENCE")).toBe(true);
    expect(r.diagnostics).toEqual([]);
    expect(r.headline.sentence).toMatch(/cannot be read yet/);
  });

  it("works without a registry", () => {
    const d = makeDeal();
    expect(() => divergenceReport(d, null, resolvePeerGroup(d.classification), { asOf: AS_OF })).not.toThrow();
  });

  it("derive() on emptyCanonical includes a divergence report", () => {
    const r = derived(emptyCanonical("FAST_SCREEN")).divergence;
    expect(r.version).toBe(DIVERGENCE_ENGINE_VERSION);
    expect(r.coverage.assessed).toBe(0);
  });

  it("an empty divergence draft on an empty deal never throws", () => {
    const d = { ...emptyCanonical("STANDARD"), divergence: emptyDraft() };
    const r = report(d);
    expect(r.draftAvailable).toBe(true);
    expect(r.factors.find((f) => f.id === "COMPOUNDING_LOOPS")!.reading).toBe("NO_LOOP");
  });

  it("a malformed stored draft degrades the affected factors to MODULE_ERROR with diagnostics — never a throw", () => {
    const d = makeDeal();
    (d as unknown as { divergence: unknown }).divergence = { ...emptyDraft(), focus: null, loops: [{ kind: "DATA", description: "x", links: null }], capTable: 42 };
    const r = report(d);
    expect(r.factors).toHaveLength(10);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    const errs = r.factors.filter((f) => f.reading === "MODULE_ERROR");
    expect(errs.length).toBeGreaterThan(0);
    for (const f of errs) expect(f.level).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("is deterministic for a given asOf", () => {
    const deal = richDeal();
    expect(report(deal)).toEqual(report(structuredClone(deal)));
    expect(derived(deal).divergence).toEqual(derived(structuredClone(deal)).divergence);
  });

  it("runs well under 20 ms including the economics counterfactual", () => {
    const deal = richDeal();
    const d = derived(deal);
    const ctx = { asOf: AS_OF, market: d.market, financing: d.financing, economics: d.economics, latent: d.latent, economicsContext: { deal, registry: REG, fund: FUND, returns: d.returns, backwards: d.backwards, market: d.market } };
    divergenceReport(deal, REG, d.peerGroup, ctx); // warm-up
    // Median of per-run timings: robust to GC pauses and CPU contention from parallel test files.
    const times: number[] = [];
    for (let i = 0; i < 11; i++) {
      const t0 = performance.now();
      divergenceReport(deal, REG, d.peerGroup, ctx);
      times.push(performance.now() - t0);
    }
    expect([...times].sort((a, b) => a - b)[5]!).toBeLessThan(20);
  });
});

describe("divergence · report shape", () => {
  const r = derived(richDeal()).divergence;

  it("has the ten factors in order with names, questions and rules", () => {
    expect(r.factors.map((f) => f.id)).toEqual([...FACTOR_IDS]);
    expect(r.factors.map((f) => f.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const f of r.factors) {
      expect(f.name.length).toBeGreaterThan(5);
      expect(f.question).toMatch(/\?$/);
      expect(f.rule.length).toBeGreaterThan(40);
      expect(f.why.length).toBeGreaterThan(10);
    }
  });

  it("every factor has coherent coverage, sorted pages and evidence pages within the factor's pages", () => {
    for (const f of r.factors) {
      expect(f.coverage.ratio).toBeGreaterThanOrEqual(0);
      expect(f.coverage.ratio).toBeLessThanOrEqual(1);
      expect(f.pages).toEqual([...new Set(f.pages)].sort((a, b) => a - b));
      for (const e of f.evidence) for (const p of e.pages) expect(f.pages).toContain(p);
      for (const e of f.evidence) expect(["MODEL_OBSERVED", "COMPUTED", "MODEL_ASSUMPTION", "RESEARCH"]).toContain(e.basis);
    }
  });

  it("the rich deal reads as expected factor by factor", () => {
    expect(factorOf(r, "AMBITION_CEILING").ambitionClass).toBe("GLOBAL_PLATFORM");
    expect(factorOf(r, "CAP_TABLE_ALIGNMENT").level).toBe("STRONG");
    expect(factorOf(r, "SYNDICATE_QUALITY").level).toBe("STRONG");
    expect(factorOf(r, "MARKET_STRUCTURE").level).toBe("STRONG");
    expect(factorOf(r, "DEPENDENCY_SURFACE").level).not.toBe("WEAK");
    expect(factorOf(r, "ORGANIZATIONAL_FOCUS").level).toBe("STRONG");
    expect(factorOf(r, "COMPOUNDING_LOOPS").level).toBe("ADEQUATE");
    expect(factorOf(r, "SCALABILITY_ARCHITECTURE").level).toBe("STRONG");
  });

  it("the headline answers the divergence question from the levels", () => {
    expect(r.headline.question).toBe(DIVERGENCE_QUESTION);
    expect(r.headline.upward.length).toBeGreaterThan(0);
    expect(r.headline.sentence).toMatch(/pull away from lookalikes/);
    expect(r.headline.upward.every((id) => factorOf(r, id).level === "STRONG")).toBe(true);
    expect(r.headline.downward.every((id) => factorOf(r, id).level === "WEAK")).toBe(true);
  });

  it("the summary is compact: ten factors, ≤ 3 numbers and ≤ 3 missing inputs each", () => {
    expect(r.summary.factors).toHaveLength(10);
    for (const f of r.summary.factors) {
      expect(f.numbers.length).toBeLessThanOrEqual(3);
      expect(f.missing.length).toBeLessThanOrEqual(3);
    }
    expect(JSON.stringify(r.summary).length).toBeLessThan(8_000);
    expect(r.summary.basisNote).toMatch(/not part of the OQI/);
  });

  it("lists its versioned assumptions, labelled MODEL_ASSUMPTION or REGISTRY", () => {
    expect(r.assumptionsVersion).toMatch(/^divergence-assumptions-/);
    expect(r.assumptions.length).toBeGreaterThanOrEqual(8);
    for (const a of r.assumptions) expect(["MODEL_ASSUMPTION", "REGISTRY"]).toContain(a.kind);
    expect(r.assumptions.find((a) => a.id === "FOUNDER_OWNERSHIP")!.kind).toBe("MODEL_ASSUMPTION");
  });
});

describe("divergence · schema, upgrade and prompt", () => {
  it("DivergenceDraft is OpenAI-strict compatible (every property required, no additional properties)", () => {
    const schema = toStrictJsonSchema(DivergenceDraft) as Record<string, unknown>;
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      const o = n as Record<string, unknown>;
      if (o.properties) {
        expect(o.additionalProperties).toBe(false);
        expect((o.required as string[]).sort()).toEqual(Object.keys(o.properties as object).sort());
      }
      expect(o).not.toHaveProperty("default");
      Object.values(o).forEach(walk);
    };
    walk(schema);
  });

  it("the prompt's output schema is the canonical draft", () => {
    expect(DivergenceSignalsOutput).toBe(DivergenceDraft);
    expect(DivergenceDraft.safeParse(emptyDraft()).success).toBe(true);
    expect(DivergenceDraft.safeParse(richDeal().divergence).success).toBe(true);
  });

  it("the canonical object gains `divergence` with a null default; the schema version is unchanged", () => {
    expect(CANONICAL_SCHEMA_VERSION).toBe("1.1");
    expect(emptyCanonical("STANDARD").divergence).toBeNull();
    const { divergence: _omit, ...legacy } = emptyCanonical("STANDARD");
    void _omit;
    expect(CanonicalDeal.parse(legacy).divergence).toBeNull();
  });

  it("upgradeCanonical: old versions get null, valid drafts survive, malformed drafts are dropped", () => {
    const { divergence: _o, ...legacy } = makeDeal();
    void _o;
    expect(upgradeCanonical(legacy).divergence).toBeNull();
    expect(upgradeCanonical(richDeal()).divergence).toEqual(richDeal().divergence);
    expect(upgradeCanonical({ ...makeDeal(), divergence: { nonsense: true } }).divergence).toBeNull();
  });

  it("upgradeCanonical of a 1.0 object also initialises divergence", () => {
    const { divergence: _o, ...legacy } = makeDeal();
    void _o;
    const v10 = { ...legacy, schemaVersion: "1.0" };
    const up = upgradeCanonical(v10);
    expect(up.schemaVersion).toBe("1.1");
    expect(up.divergence).toBeNull();
  });

  it("prompt versions are registered and bumped", () => {
    expect(PROMPT_VERSIONS.divergence_signals).toBe("divergence_signals_v1");
    expect(DIVERGENCE_SIGNALS.version).toBe("divergence_signals_v1");
    expect(DECISION_THESIS.version).toBe("decision_thesis_v5");
    expect(DECISION_CHALLENGE.version).toBe("decision_challenge_v2");
    expect(PROMPT_VERSIONS.decision_thesis).toBe("decision_thesis_v5");
  });

  it("the extraction prompt forbids psychology, honesty judgements and pedigree, and asks for pages", () => {
    const p = divergenceSignalsInstructions();
    expect(p).toMatch(/Never describe personality, motives or honesty/);
    expect(p).toMatch(/fame of a person, school, employer or investor/);
    expect(p).toMatch(/page/);
    expect(p).toMatch(/Code computes every number/);
  });

  it("thesis and challenge instructions ask to use the divergence factors", () => {
    expect(thesisInstructions("STANDARD")).toMatch(/DIVERGENCE FACTORS/);
    expect(challengeInstructions("STANDARD")).toMatch(/DIVERGENCE FACTORS/);
    expect(thesisInstructions("STANDARD")).toMatch(/INSUFFICIENT_EVIDENCE factors as unknowns/);
  });
});

describe("divergence · model hand-off (mocked output) and digests", () => {
  const mocked = () => {
    const d = emptyDraft();
    d.capTable.founderOwnershipPct = 140; // impossible → null
    d.capTable.optionPoolPct = -5; // impossible → null
    d.capTable.founders = [{ name: " ", role: "", status: "UNKNOWN", ownershipPct: 30, evidence: "", page: null }, { name: "Ada", role: "CEO", status: "ACTIVE_FULL_TIME", ownershipPct: 180, evidence: "x", page: 2 }];
    d.marketStructure.topBuyersSharePct = 250;
    d.marketStructure.addressableBuyerCount = -3;
    d.dependencies = [{ kind: "CLOUD_INFRASTRUCTURE", provider: "AWS", whatItProvides: "hosting", criticality: "IMPORTANT", substitutability: "EASY", switchingTimeMonths: -1, mitigationStated: null, evidence: "AWS", page: 3 }];
    d.scalability.headcountByFunction = [{ function: "OTHER", count: 0, page: null }, { function: "ENGINEERING_PRODUCT", count: 7, page: 4 }];
    d.syndicate = [{ name: "", kind: "UNKNOWN", roundRole: "EXISTING_PARTICIPATION_UNSTATED", behaviours: [], evidence: "", page: null }];
    d.ambition.signals = Array.from({ length: 12 }, (_, i) => ({ kind: "OTHER" as const, direction: "EXPANSIVE" as const, evidence: `s${i}`, page: i }));
    return d;
  };

  it("applyDivergence sanitizes impossible values and never derives a level", () => {
    const out = applyDivergence(makeDeal(), mocked()).divergence!;
    expect(out.capTable.founderOwnershipPct).toBeNull();
    expect(out.capTable.optionPoolPct).toBeNull();
    expect(out.capTable.founders.map((f) => f.name)).toEqual(["Ada"]);
    expect(out.capTable.founders[0]!.ownershipPct).toBeNull();
    expect(out.marketStructure.topBuyersSharePct).toBeNull();
    expect(out.marketStructure.addressableBuyerCount).toBeNull();
    expect(out.dependencies[0]!.switchingTimeMonths).toBeNull();
    expect(out.scalability.headcountByFunction).toHaveLength(1);
    expect(out.syndicate).toHaveLength(0);
    expect(out.ambition.signals).toHaveLength(8);
    expect(out).not.toHaveProperty("level");
  });

  it("applyDivergence does not mutate its inputs", () => {
    const deal = makeDeal();
    const m = mocked();
    const snapshot = JSON.stringify(m);
    applyDivergence(deal, m);
    expect(JSON.stringify(m)).toBe(snapshot);
    expect(deal.divergence).toBeNull();
  });

  it("mocked model output → applyDivergence → derive yields a read factor", () => {
    const d = emptyDraft();
    d.dependencies = [{ kind: "MODEL_PROVIDER", provider: "OpenAI", whatItProvides: "100% of inference", criticality: "CORE", substitutability: "HARD", switchingTimeMonths: null, mitigationStated: null, evidence: "Built on GPT", page: 9 }];
    const r = derived(applyDivergence(makeDeal(), d)).divergence;
    expect(factorOf(r, "DEPENDENCY_SURFACE").level).toBe("WEAK");
    expect(factorOf(r, "DEPENDENCY_SURFACE").pages).toEqual([9]);
    expect(r.draftAvailable).toBe(true);
  });

  it("derivedDigest carries the headline and one line per factor; null for versions without the engine", () => {
    const d = derived(richDeal());
    const dig = derivedDigest(d);
    expect(dig.divergence!.headline).toBe(d.divergence.summary.headline);
    expect(dig.divergence!.factors).toHaveLength(10);
    expect(dig.divergence!.factors[0]).toMatch(/^1\. Founder ambition ceiling: /);
    const legacy = { ...d, divergence: undefined } as unknown as DerivedAnalysis;
    expect(derivedDigest(legacy).divergence).toBeNull();
  });

  it("the Fund Brain memory pack includes the divergence factors in a few lines and tolerates old versions", () => {
    const c = richDeal();
    const d = derived(c);
    const { pack } = buildMemoryPack({ id: "co1", slug: "acme" }, "v1", c, d);
    expect(pack.text).toMatch(/## Divergence factors \(ordinal, not a score\)/);
    const lines = pack.text.split("\n").filter((l) => /Divergence factors/.test(l));
    expect(lines.length).toBeLessThanOrEqual(2);
    const legacy = { ...d, divergence: undefined } as unknown as DerivedAnalysis;
    expect(() => buildMemoryPack({ id: "co1", slug: "acme" }, "v1", c, legacy)).not.toThrow();
    expect(buildMemoryPack({ id: "co1", slug: "acme" }, "v1", c, legacy).pack.text).not.toMatch(/Divergence factors/);
  });

  it("a SAFE entry round still produces a founder path (conversion at the next priced round)", () => {
    const base = makeDeal();
    base.financing = { ...base.financing!, instrument: "SAFE", valuationCap: usd(30e6), preMoney: null, raiseAmount: usd(3e6) };
    const r = derived(dealWith((d) => { d.capTable.founderOwnershipPct = 75; d.capTable.optionPoolPct = 10; }, base)).divergence;
    const path = factorOf(r, "CAP_TABLE_ALIGNMENT").path;
    expect(path.length).toBeGreaterThan(2);
    expect(path[path.length - 1]!.activeFounderPct).toBeLessThan(path[0]!.activeFounderPct);
  });
});
