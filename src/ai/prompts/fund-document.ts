/** fund_document_v1 — extract what a fund's own documents state (DOCUMENTED only, verbatim-backed). */
import { z } from "zod";
import { UNTRUSTED_POLICY } from "../untrusted";

export const FUND_DOCUMENT = { id: "fund_document", version: "fund_document_v1" } as const;

export const FUND_PROFILE_FIELDS = [
  "strategy",
  "stages",
  "sectors",
  "sectorExpertise",
  "geographies",
  "checkMinUsd",
  "checkMaxUsd",
  "initialCheckDefaultUsd",
  "ownershipTargetPct",
  "reserveRatio",
  "fundSizeUsd",
  "targetFundMultiple",
  "excludedIndustries",
  "excludedCategories",
] as const;

export const FundDocumentOutput = z.object({
  items: z.array(
    z.object({
      kind: z.enum(["STRATEGY", "CRITERIA", "VERTICAL", "IC_PREFERENCE", "POLICY", "LESSON", "NOTE"]),
      title: z.string().describe("Short title, e.g. 'Minimum retention evidence at Series A'"),
      body: z.string().describe("Faithful restatement of what the document says — no interpretation, no generalisation"),
      quote: z.string().describe("Verbatim sentence(s) from the document that state it, copied exactly"),
      page: z.number().int().nullable(),
      member: z.string().nullable().describe("If the statement is a named IC member's documented preference, their name; else null"),
    }),
  ),
  profileSuggestions: z.array(
    z.object({
      field: z.enum(FUND_PROFILE_FIELDS),
      value: z.string().describe("Value as stated (numbers fully scaled, lists comma-separated)"),
      quote: z.string().describe("Verbatim supporting text"),
    }),
  ),
});
export type FundDocumentOutput = z.infer<typeof FundDocumentOutput>;

export function fundDocumentInstructions(fundName: string, members: string[]) {
  return `You read an internal document of the venture fund ${fundName} (strategy memo, investment criteria, IC guidelines, policy, post-mortem…) and record what it STATES.
IC members: ${members.join(", ") || "(none registered)"}.
Rules:
- Record only what the document explicitly states, each with a verbatim quote copied exactly from the text (code checks it). No quote → no item.
- Never infer preferences, never generalise, never add best practices the document does not contain.
- A named member's preference goes to kind IC_PREFERENCE with member set; fund-level rules go to STRATEGY / CRITERIA / VERTICAL / POLICY; lessons from past deals to LESSON.
- profileSuggestions only for explicit, quantitative or list statements matching a fund profile field.
${UNTRUSTED_POLICY}`;
}
