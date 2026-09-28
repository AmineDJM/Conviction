import { describe, expect, it } from "vitest";
import { claimPageRanges } from "@/orchestration/pipeline";

const doc = (f: string, n: number) => ({ filename: f, pages: Array.from({ length: n }, (_, i) => ({ pageNo: i + 1 })) });

describe("claim extraction page ranges", () => {
  it("short decks are one pass", () => expect(claimPageRanges([doc("a.pdf", 7)])).toEqual([null]));
  it("long decks split in two contiguous halves covering every page", () => {
    expect(claimPageRanges([doc("a.pdf", 11)])).toEqual(["a.pdf pages 1–6", "a.pdf pages 7–11"]);
  });
  it("multiple documents are described per document", () => {
    expect(claimPageRanges([doc("deck.pdf", 6), doc("memo.pdf", 4)])).toEqual(["deck.pdf pages 1–5", "deck.pdf pages 6–6; memo.pdf pages 1–4"]);
  });
});
