import { describe, expect, it } from "vitest";
import { applyVerification, citedUnits, joinAnswer, splitAnswer, verifyInput } from "@/brain/verify-citations";

const ANSWER = `**Ledgerline — runway.** Cash is $3.1M and net burn $365k per month [1]. The engine derives 8.5 months of pre-round runway [2].

- It excludes GPU inference costs, the core delivery cost, covered by credits through 2027 [3].
- Convertibles create a material overhang for the next round [4].

Next action: ask for the monthly burn bridge.`;

describe("answer splitting is lossless", () => {
  it.each([ANSWER, "One sentence [1].", "A. B [2].\n\n| a | b |\n|---|---|\n| x [1] | y |", "No citations at all."])("split → join returns the same text", (a) => {
    const { pieces, seps } = splitAnswer(a);
    expect(joinAnswer(pieces, seps)).toBe(a);
  });
  it("finds the cited sentences with their refs", () => {
    const units = citedUnits(splitAnswer(ANSWER).pieces);
    expect(units.map((u) => u.refs)).toEqual([[1], [2], [3], [4]]);
    expect(units[2]!.statement).toBe("It excludes GPU inference costs, the core delivery cost, covered by credits through 2027.");
  });
  it("the verifier sees only the cited items, as untrusted data", () => {
    const units = citedUnits(splitAnswer(ANSWER).pieces);
    const input = verifyInput(units.slice(0, 1), [{ n: 1, text: "Cash $3.1M; net burn $365k/month" }, { n: 9, text: "unrelated" }]);
    expect(input).toContain("Cash $3.1M");
    expect(input).not.toContain("unrelated");
    expect(input).toMatch(/trust="untrusted"/);
  });
});

describe("applying verdicts: code rewrites, the verifier can only remove support", () => {
  it("SUPPORTED keeps, TRIM reduces, INFERENCE uncites and labels", () => {
    const { text, stats } = applyVerification(
      ANSWER,
      {
        sentences: [
          { id: 0, verdict: "SUPPORTED", supported: "" },
          { id: 1, verdict: "TRIM", supported: "The engine derives 8.5 months of runway" },
          { id: 2, verdict: "TRIM", supported: "It excludes GPU inference costs, covered by credits through 2027" },
          { id: 3, verdict: "INFERENCE", supported: "" },
        ],
      },
      "en",
    );
    expect(text).toContain("Cash is $3.1M and net burn $365k per month [1].");
    expect(text).toContain("The engine derives 8.5 months of runway [2].");
    expect(text).not.toContain("pre-round");
    expect(text).toContain("- It excludes GPU inference costs, covered by credits through 2027 [3].");
    expect(text).toContain("- Inference: Convertibles create a material overhang for the next round.");
    expect(text).not.toContain("[4]");
    expect(text).toContain("Next action: ask for the monthly burn bridge.");
    expect(stats).toEqual({ checked: 4, supported: 1, trimmed: 2, inference: 1, refused: 0 });
  });

  it("a TRIM that introduces a new number is refused and applied as an uncited inference", () => {
    const { text, stats } = applyVerification(ANSWER, { sentences: [{ id: 1, verdict: "TRIM", supported: "The engine derives 9.5 months of runway" }] }, "en");
    expect(text).not.toContain("9.5");
    expect(text).toContain("Inference: The engine derives 8.5 months of pre-round runway.");
    expect(stats.refused).toBe(1);
  });

  it("a TRIM longer than the sentence is refused (it would add content)", () => {
    const { stats } = applyVerification("Ledgerline reports cash of $3.1M [1].", { sentences: [{ id: 0, verdict: "TRIM", supported: "Ledgerline reports cash of $3.1M, which is a very comfortable position for the company" }] }, "en");
    expect(stats.refused).toBe(1);
  });

  it("French answers get the French label; an existing inference label is not doubled", () => {
    const fr = applyVerification("Lecture : le burn va doubler [2].", { sentences: [{ id: 0, verdict: "INFERENCE", supported: "" }] }, "fr");
    expect(fr.text).toBe("Lecture : le burn va doubler.");
    const fr2 = applyVerification("Le burn va doubler après la levée [2].", { sentences: [{ id: 0, verdict: "INFERENCE", supported: "" }] }, "fr");
    expect(fr2.text).toBe("Lecture : Le burn va doubler après la levée.");
  });

  it("a table row keeps its layout when uncited", () => {
    const t = "| Metric | Value |\n|---|---|\n| ARR growth due to channel partners | 217% [2] |";
    const { text } = applyVerification(t, { sentences: [{ id: 0, verdict: "INFERENCE", supported: "" }] }, "en");
    expect(text).toBe("| Metric | Value |\n|---|---|\n| ARR growth due to channel partners | 217% |");
  });

  it("no verdict for a sentence keeps it as written", () => {
    expect(applyVerification(ANSWER, { sentences: [] }, "en").text).toBe(ANSWER);
  });
});
