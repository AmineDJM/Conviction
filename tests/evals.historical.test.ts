import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { asOfDate, calibrate, contamination, outcomeClass, parseCsv, parseOutcomes, reanchorAsOf, stanceOf } from "../evals/lib/historical";
import { makeDeal } from "./fixtures";

describe("outcomes CSV", () => {
  it("parses quoted fields, doubled quotes and CRLF", () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });
  it("validates required columns, dates and chronology", () => {
    const { rows, errors } = parseOutcomes(
      "company,deck_date,outcome,outcome_date,source,famous\nA,2021-06,SHUT_DOWN,2023-04,filing,no\nB,June 2021,IPO,,x,\nC,2022-02,IPO,2021-01,x,yes\nD,2022-02,,2023-01,x,\n",
    );
    expect(rows.map((r) => r.company)).toEqual(["A"]);
    expect(rows[0]!.famous).toBe(false);
    expect(errors).toHaveLength(3);
    expect(parseOutcomes("company,outcome\nA,IPO\n").errors[0]).toMatch(/deck_date/);
  });
  it("the shipped fictional sample parses cleanly", () => {
    const txt = fs.readFileSync(path.join(__dirname, "..", "evals", "fixtures", "historical-sample", "outcomes.csv"), "utf8");
    const { rows, errors } = parseOutcomes(txt);
    expect(errors).toEqual([]);
    expect(rows.length).toBe(3);
    for (const r of rows) expect(fs.existsSync(path.join(__dirname, "..", "evals", "fixtures", "historical-sample", r.deckFile!))).toBe(true);
  });
});

describe("classes", () => {
  it("maps outcome labels and free text; unknown text is never guessed", () => {
    expect(outcomeClass("RAISED_UP_ROUND")).toBe("POSITIVE");
    expect(outcomeClass("acquihire")).toBe("NEUTRAL");
    expect(outcomeClass("Shut down in 2023")).toBe("NEGATIVE");
    expect(outcomeClass("Raised a Series B at 3x")).toBe("POSITIVE");
    expect(outcomeClass("pivoted")).toBe("UNKNOWN");
  });
  it("maps recommendations to stances", () => {
    expect(stanceOf("IC_READY")).toBe("ADVANCE");
    expect(stanceOf("SCREEN_OUT")).toBe("PASS");
    expect(stanceOf("NEEDS_FOUNDER_CALL")).toBe("DILIGENCE");
  });
});

describe("calibration", () => {
  it("confusion, conditional rates, OQI AUC and the small-sample warning", () => {
    const c = calibrate([
      { company: "a", outcome: "POSITIVE", stance: "ADVANCE", oqi: 70, contaminated: false },
      { company: "b", outcome: "NEGATIVE", stance: "PASS", oqi: 40, contaminated: false },
      { company: "c", outcome: "NEGATIVE", stance: "ADVANCE", oqi: 70, contaminated: false },
      { company: "d", outcome: "UNKNOWN", stance: "DILIGENCE", oqi: null, contaminated: false },
    ]);
    expect(c.confusion.ADVANCE.POSITIVE).toBe(1);
    expect(c.positiveRateByStance.ADVANCE).toBe(0.5);
    expect(c.advanceRateByOutcome.NEGATIVE).toBe(0.5);
    expect(c.oqiAuc).toBe(0.75);
    expect(c.baseRatePositive).toBeCloseTo(1 / 3);
    expect(c.warning).toMatch(/n = 4/);
  });
});

describe("hindsight contamination", () => {
  it("declared fame or a recognising probe flags the row", () => {
    expect(contamination({ famous: true }, null).contaminated).toBe(true);
    expect(contamination({ famous: null }, { recognizes: false, statedOutcome: null }).contaminated).toBe(false);
    const c = contamination({ famous: false }, { recognizes: false, statedOutcome: "acquired in 2023" });
    expect(c.contaminated).toBe(true);
    expect(c.reasons[0]).toMatch(/states an outcome/);
  });
});

describe("as-of re-anchoring", () => {
  it("end of month for YYYY-MM, end of day for a full date", () => {
    expect(asOfDate("2021-06").toISOString()).toBe("2021-06-30T23:59:59.000Z");
    expect(asOfDate("2022-02-15").toISOString()).toBe("2022-02-15T23:59:59.000Z");
  });
  it("sets the engine reference date and never mutates the input", () => {
    const d = makeDeal();
    const before = JSON.stringify(d);
    const r = reanchorAsOf(d, new Date("2021-06-30T23:59:59Z"));
    expect(JSON.stringify(d)).toBe(before);
    if (r.analysis.provenance) expect(r.analysis.provenance.startedAt).toBe("2021-06-30T23:59:59.000Z");
  });
});
