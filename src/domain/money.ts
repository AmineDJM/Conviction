import { z } from "zod";

/**
 * A monetary amount as extracted. `amount` is the fully-scaled number in the
 * stated currency (e.g. 4200000 for "$4.2M"). `rawText` is kept for audit and
 * is cross-checked by code (see engine/metrics/normalize.ts).
 */
export const Money = z.object({
  amount: z.number().nullable(),
  currency: z.string().describe("ISO 4217 code, e.g. USD, EUR, GBP"),
  rawText: z.string().describe("Exact text as it appears in the source, e.g. '$4.2M'"),
});
export type Money = z.infer<typeof Money>;

export const UsdRange = z.object({
  lowUsd: z.number(),
  highUsd: z.number(),
});
export type UsdRange = z.infer<typeof UsdRange>;
