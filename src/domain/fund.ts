/** §51 FUND_PROFILE */
import { z } from "zod";
import { FinancingStage, Industry } from "./enums";

export const PortfolioCompany = z.object({
  name: z.string(),
  industry: z.array(Industry),
  description: z.string(),
});

export const FundProfile = z.object({
  id: z.string(),
  name: z.string(),
  fundSizeUsd: z.number().positive(),
  vintage: z.number().int(),
  strategy: z.string(),
  stages: z.array(FinancingStage).min(1),
  sectors: z.array(Industry).describe("Focus sectors; empty = generalist"),
  sectorExpertise: z.array(Industry),
  geographies: z.array(z.string()).describe("Allowed HQ countries or regions; empty = global"),
  geographicExpertise: z.array(z.string()),
  checkMinUsd: z.number().nonnegative(),
  checkMaxUsd: z.number().positive(),
  initialCheckDefaultUsd: z.number().positive(),
  ownershipTargetPct: z.number().min(0).max(100),
  reserveRatio: z.number().min(0).max(5).describe("Follow-on reserves per $1 of initial check"),
  maxConcentrationPct: z.number().min(0).max(100).describe("Max % of fund in one company"),
  targetFundMultiple: z.number().positive().describe("Target net fund multiple, e.g. 3"),
  targetDealReturnUsd: z.number().positive().describe("Desired contribution of a winning deal, e.g. fund size"),
  portfolio: z.array(PortfolioCompany),
  excludedCategories: z.array(z.string()),
  excludedIndustries: z.array(Industry),
});
export type FundProfile = z.infer<typeof FundProfile>;

export const DEFAULT_FUND_PROFILE: FundProfile = {
  id: "default",
  name: "Default Fund Profile",
  fundSizeUsd: 150_000_000,
  vintage: 2026,
  strategy: "Early-stage generalist technology fund",
  stages: ["PRE_SEED", "SEED", "SERIES_A"],
  sectors: [],
  sectorExpertise: ["ENTERPRISE_SOFTWARE", "FINANCIAL_SERVICES"],
  geographies: [],
  geographicExpertise: ["United States", "Europe"],
  checkMinUsd: 500_000,
  checkMaxUsd: 5_000_000,
  initialCheckDefaultUsd: 2_000_000,
  ownershipTargetPct: 10,
  reserveRatio: 1,
  maxConcentrationPct: 10,
  targetFundMultiple: 3,
  targetDealReturnUsd: 150_000_000,
  portfolio: [],
  excludedCategories: [],
  excludedIndustries: [],
};
