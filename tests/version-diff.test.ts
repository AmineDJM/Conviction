import { describe, expect, it } from "vitest";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { DEFAULT_FUND_PROFILE } from "@/domain/fund";
import type { CanonicalDeal, Claim, FounderQuestion } from "@/domain/canonical";
import { defaultComparison, diffVersions, founderCallChanges, type VersionSide } from "@/reports/version-diff";
import { applyMetricCorrection, applyQuestionUpdate } from "@/orchestration/corrections";
import { makeDeal } from "./fixtures";

const reg = getRegistry();
const now = new Date("2026-09-27T00:00:00Z");

function side(c: CanonicalDeal, versionNo: number, reason = "DECK_ANALYSIS"): VersionSide {
  return { id: `ver_${versionNo}`, versionNo, reason, createdAt: now.toISOString(), canonical: c, derived: derive(c, reg, DEFAULT_FUND_PROFILE, { now }) };
}

function claim(id: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    category: "METRIC",
    statement: `Claim ${id}`,
    valueText: null,
    entity: "company",
    period: null,
    material: true,
    origin: "COMPANY",
    verification: "UNVERIFIED",
    freshness: "CURRENT",
    independence: "COMPANY_DERIVED",
    verificationMethod: "Stated in company materials",
    limitations: null,
    contradictions: [],
    evidence: [{ sourceId: "SRC-001", effect: "ORIGIN", excerpt: "x", location: "p. 1", note: null }],
    history: [{ at: now.toISOString(), change: "CREATED", note: "Extracted from deck" }],
    ...extra,
  };
}

function question(id: string, status: FounderQuestion["status"] = "OPEN"): FounderQuestion {
  return { id, question: `Question ${id}?`, tier: "MUST_ASK", whyItMatters: "w", knownContext: "k", ifAnswerA: "answer A changes things", ifAnswerB: "answer B changes other things", affects: ["RECOMMENDATION"], status, answer: null, answeredAt: null, resolutionNote: null };
}

describe("diffVersions", () => {
  it("reports no changes for identical versions", () => {
    const d = makeDeal();
    const a = side(d, 1);
    const b = side(structuredClone(d), 2);
    const diff = diffVersions(a, b);
    expect(diff.changeCount).toBe(0);
    expect(diff.recommendation.changed).toBe(false);
    expect(diff.metrics).toHaveLength(0);
    expect(diff.dimensions.every((x) => !x.value.changed)).toBe(true);
  });

  it("detects a changed primary metric and the resulting score movement", () => {
    const d = makeDeal();
    const nrrId = d.metrics.find((m) => m.metricKey === "nrr")!.id;
    d.metrics = d.metrics.map((m, i) => ({ ...m, id: `MET-${String(i + 1).padStart(3, "0")}` }));
    const target = d.metrics.find((m) => m.metricKey === "nrr")!;
    expect(nrrId).toBeTruthy();
    const { deal } = applyMetricCorrection(d, { metricId: target.id, value: 85, note: "Cohort file shows 85%", actor: "Test" }, now);
    const diff = diffVersions(side(d, 1), side(deal, 2, "METRIC_CORRECTION"));
    const nrr = diff.metrics.find((m) => m.metricKey === "nrr");
    expect(nrr?.kind).toBe("CHANGED");
    expect(nrr?.from?.value).toBe(118);
    expect(nrr?.to?.value).toBe(85);
    expect(nrr?.to?.method).toBe("USER_CORRECTED");
    const changedDims = diff.dimensions.filter((x) => x.value.changed);
    expect(changedDims.length).toBeGreaterThan(0);
    expect(diff.changeCount).toBeGreaterThan(0);
  });

  it("lists added claims, verification changes and resolved questions", () => {
    const a = makeDeal({ claims: [claim("CLM-001"), claim("CLM-002")], questions: [question("Q-01"), question("Q-02")] });
    const b = structuredClone(a);
    b.claims[1]!.verification = "CONTRADICTED";
    b.claims.push(claim("CLM-003", { statement: "New from call" }));
    b.questions[0]!.status = "RESOLVED";
    b.questions[0]!.answer = "Yes, with cohort data";
    b.questions[1]!.status = "ASKED";
    const diff = diffVersions(side(a, 1), side(b, 2, "FOUNDER_CALL"));
    expect(diff.claims.added.map((c) => c.id)).toEqual(["CLM-003"]);
    expect(diff.claims.verificationChanged).toEqual([{ id: "CLM-002", statement: "Claim CLM-002", from: "UNVERIFIED", to: "CONTRADICTED" }]);
    expect(diff.questions.resolved.map((q) => q.id)).toEqual(["Q-01"]);
    expect(diff.questions.changed.map((q) => [q.id, q.from, q.to])).toEqual([["Q-02", "OPEN", "ASKED"]]);
  });

  it("reports added and removed primary metrics", () => {
    const a = makeDeal();
    const b = structuredClone(a);
    b.metrics = b.metrics.filter((m) => m.metricKey !== "runway_months");
    const diff = diffVersions(side(a, 1), side(b, 2));
    expect(diff.metrics.find((m) => m.metricKey === "runway_months")?.kind).toBe("REMOVED");
    const back = diffVersions(side(b, 2), side(a, 3));
    expect(back.metrics.find((m) => m.metricKey === "runway_months")?.kind).toBe("ADDED");
  });
});

describe("defaultComparison", () => {
  it("returns null with fewer than two versions", () => {
    expect(defaultComparison([{ id: "a", versionNo: 1, reason: "DECK_ANALYSIS" }])).toBeNull();
  });
  it("defaults to previous vs current", () => {
    const vs = [
      { id: "v3", versionNo: 3, reason: "QUESTION_UPDATE" },
      { id: "v1", versionNo: 1, reason: "DECK_ANALYSIS" },
      { id: "v2", versionNo: 2, reason: "DECK_ANALYSIS" },
    ];
    expect(defaultComparison(vs)).toEqual({ fromId: "v2", toId: "v3" });
  });
  it("prefers before vs after the latest founder call", () => {
    const vs = [
      { id: "v1", versionNo: 1, reason: "DECK_ANALYSIS" },
      { id: "v2", versionNo: 2, reason: "DECK_ANALYSIS" },
      { id: "v3", versionNo: 3, reason: "FOUNDER_CALL" },
      { id: "v4", versionNo: 4, reason: "METRIC_CORRECTION" },
    ];
    expect(defaultComparison(vs)).toEqual({ fromId: "v2", toId: "v3" });
  });
});

describe("founderCallChanges", () => {
  it("groups appended claim history and question outcomes", () => {
    const before = makeDeal({ claims: [claim("CLM-001"), claim("CLM-002"), claim("CLM-003")], questions: [question("Q-01"), question("Q-02"), question("Q-03")] });
    const after = structuredClone(before);
    after.claims[0]!.history.push({ at: now.toISOString(), change: "CONFIRMED", note: "Founder confirmed" });
    after.claims[1]!.history.push({ at: now.toISOString(), change: "CONTRADICTED", note: "Different number" });
    after.claims[2]!.history.push({ at: now.toISOString(), change: "CHANGED", note: "Updated value" });
    after.claims.push(claim("CLM-004"));
    after.questions[0]!.status = "RESOLVED";
    after.questions[1]!.status = "NOT_FULLY_RESOLVED";
    const ch = founderCallChanges(before, after);
    expect(ch.confirmed.map((x) => x.id)).toEqual(["CLM-001"]);
    expect(ch.contradicted.map((x) => x.id)).toEqual(["CLM-002"]);
    expect(ch.changed.map((x) => x.id)).toEqual(["CLM-003"]);
    expect(ch.newClaims.map((x) => x.id)).toEqual(["CLM-004"]);
    expect(ch.questionsResolved.map((q) => q.id)).toEqual(["Q-01"]);
    expect(ch.questionsNotFullyResolved.map((q) => q.id)).toEqual(["Q-02"]);
    expect(ch.stillUnresolved.map((q) => q.id)).toEqual(["Q-02", "Q-03"]);
  });
});

describe("analyst edits", () => {
  it("metric correction keeps the original, makes the correction primary and re-derives", () => {
    const d = makeDeal();
    d.metrics = d.metrics.map((m, i) => ({ ...m, id: `MET-${String(i + 1).padStart(3, "0")}` }));
    const arr = d.metrics.find((m) => m.metricKey === "arr")!;
    const { deal, corrected } = applyMetricCorrection(d, { metricId: arr.id, value: 3_000_000, note: "Excludes pilots", actor: "Test" }, now);
    expect(d.metrics.find((m) => m.id === arr.id)!.isPrimary).toBe(true); // input not mutated
    expect(deal.metrics.find((m) => m.id === arr.id)!.isPrimary).toBe(false);
    expect(corrected.isPrimary).toBe(true);
    expect(corrected.calculationMethod).toBe("USER_CORRECTED");
    expect(deal.metrics.filter((m) => m.metricKey === "arr" && m.isPrimary)).toHaveLength(1);
    // Correcting again supersedes the earlier correction for the same period.
    const again = applyMetricCorrection(deal, { metricId: arr.id, value: 3_100_000, note: "Final", actor: "Test" }, now);
    const arrs = again.deal.metrics.filter((m) => m.metricKey === "arr");
    expect(arrs.filter((m) => m.calculationMethod === "USER_CORRECTED")).toHaveLength(1);
    expect(arrs.find((m) => m.isPrimary)?.normalizedValue).toBe(3_100_000);
  });

  it("question update records status and answer without mutating input", () => {
    const d = makeDeal({ questions: [question("Q-01")] });
    const { deal, before, after } = applyQuestionUpdate(d, { questionId: "Q-01", status: "RESOLVED", answer: "Cohorts provided" }, now);
    expect(before.status).toBe("OPEN");
    expect(after.status).toBe("RESOLVED");
    expect(deal.questions[0]!.answeredAt).toBe(now.toISOString());
    expect(d.questions[0]!.status).toBe("OPEN");
  });
});
