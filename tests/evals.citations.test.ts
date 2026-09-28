import { describe, expect, it } from "vitest";
import { citedStatements, excerptInSource, JudgeOutput, pageFromLocation, summarizeSupport, type JudgedItem } from "../evals/lib/citations";

describe("cited statements from chat answers", () => {
  it("keeps sentences / bullets with markers, strips markers and markdown", () => {
    const a = "L’ARR de Ledgerline est de **3,84 M$ en août 2026** [6].\n\nÉvidence :\n- ARR août 2025 : **1,21 M$** [9][10].\n- Pas de source ici.\nNRR 118% on 41 customers [3, 4]. Opinion without a citation.";
    const s = citedStatements(a);
    expect(s.map((x) => x.refs)).toEqual([[6], [9, 10], [3, 4]]);
    expect(s[0]!.statement).toBe("L’ARR de Ledgerline est de 3,84 M$ en août 2026.");
    expect(s[1]!.statement).toBe("ARR août 2025 : 1,21 M$.");
    expect(citedStatements("1. 2025 revenue was $1.6M [2].")[0]!.statement).toBe("2025 revenue was $1.6M.");
  });
  it("drops fragments with no checkable content", () => {
    expect(citedStatements("Sources [1]")).toEqual([]);
  });
});

describe("verbatim excerpt check", () => {
  const page = "Traction\nMetric Value\nARR (Aug 2026) $3.84M\nNet revenue retention (trailing 12m, 41 customers) 118%";
  it("normalises whitespace, case, quotes and dashes", () => {
    expect(excerptInSource("arr (aug 2026)   $3.84M", page)).toBe(true);
    expect(excerptInSource("“Net revenue retention (trailing 12m, 41 customers) 118%”", page)).toBe(true);
  });
  it("ellipses require the parts in order; fabricated text fails", () => {
    expect(excerptInSource("ARR (Aug 2026) … 118%", page)).toBe(true);
    expect(excerptInSource("118% … ARR (Aug 2026)", page)).toBe(false);
    expect(excerptInSource("ARR (Aug 2026) $4.1M", page)).toBe(false);
    expect(excerptInSource("", page)).toBe(false);
  });
  it("reads page numbers from evidence locations", () => {
    expect(pageFromLocation("p. 7")).toBe(7);
    expect(pageFromLocation("page 12, table")).toBe(12);
    expect(pageFromLocation("document (visual)")).toBeNull();
  });
});

describe("support aggregation (strict)", () => {
  const it_ = (verdict: JudgedItem["verdict"], excerptVerified = true, origin: JudgedItem["origin"] = "ANALYSIS"): JudgedItem => ({ origin, verdict, excerptVerified });
  it("NOT_CHECKABLE leaves the denominator; SUPPORTS without a verbatim excerpt does not count", () => {
    const s = summarizeSupport([it_("SUPPORTS"), it_("SUPPORTS", false), it_("PARTIAL"), it_("DOES_NOT_SUPPORT"), it_("NOT_CHECKABLE", false)]);
    expect(s.n).toBe(5);
    expect(s.checkable).toBe(4);
    expect(s.supportRate).toBe(0.25);
    expect(s.judgedSupportRate).toBe(0.5);
    expect(s.judgeExcerptNotVerbatim).toBe(1);
    expect(s.ci95!.low).toBeLessThan(0.25);
  });
  it("empty sample is not measured", () => {
    expect(summarizeSupport([]).supportRate).toBeNull();
  });
  it("judge schema accepts only the four verdicts", () => {
    expect(JudgeOutput.safeParse({ verdict: "SUPPORTS", excerpt: "x", reason: "y" }).success).toBe(true);
    expect(JudgeOutput.safeParse({ verdict: "MOSTLY", excerpt: "x", reason: "y" }).success).toBe(false);
  });
});
