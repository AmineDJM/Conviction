/** Deterministic peer-group resolution from the independent classification axes (§4 Level 2, §11). */
import type { Classification } from "@/domain/sections";
import type { ProfileId, StageBand } from "../benchmarks/types";

export const PROFILE_LABELS: Record<ProfileId, string> = {
  ENTERPRISE_SAAS: "Enterprise SaaS",
  SMB_PLG_SAAS: "SMB / PLG SaaS",
  DEVELOPER_INFRA: "Developer & AI infrastructure",
  CONSUMER: "Consumer",
  MARKETPLACE: "Marketplace",
  FINTECH: "Fintech",
  HARDWARE_ROBOTICS: "Hardware & robotics",
  BIOTECH_MEDTECH: "Biotech & medtech",
  GENERAL: "General technology",
};

export const STAGE_BAND_LABELS: Record<StageBand, string> = {
  EARLY: "Pre-seed / Seed",
  GROWTH: "Series A",
  LATE: "Series B+",
};

export function resolveProfile(c: Classification): ProfileId {
  const pt = new Set(c.productType);
  const rm = new Set(c.revenueModel);
  const gtm = new Set(c.gtm);
  const ind = new Set(c.industry);
  if (pt.has("THERAPEUTIC") || pt.has("DIAGNOSTIC") || pt.has("MEDICAL_DEVICE") || rm.has("DRUG_ECONOMICS")) return "BIOTECH_MEDTECH";
  if (pt.has("HARDWARE") || pt.has("ROBOTICS") || rm.has("HARDWARE_MARGIN")) return "HARDWARE_ROBOTICS";
  if (pt.has("MARKETPLACE") || rm.has("TAKE_RATE")) return "MARKETPLACE";
  if (pt.has("FINTECH_PRODUCT") || (ind.has("FINANCIAL_SERVICES") && rm.has("TRANSACTION"))) return "FINTECH";
  if (pt.has("CONSUMER_APP") || (ind.has("CONSUMER") && (rm.has("ADVERTISING") || gtm.has("CONSUMER_PAID") || gtm.has("ORGANIC_VIRAL"))))
    return "CONSUMER";
  if ((pt.has("API_PLATFORM") || pt.has("SOFTWARE_INFRASTRUCTURE")) && (rm.has("USAGE") || gtm.has("PLG"))) return "DEVELOPER_INFRA";
  if (pt.has("SAAS") || pt.has("AI_AGENT") || pt.has("API_PLATFORM") || pt.has("SOFTWARE_INFRASTRUCTURE")) {
    if (gtm.has("ENTERPRISE_SALES") || gtm.has("MID_MARKET")) return "ENTERPRISE_SAAS";
    if (gtm.has("PLG") || gtm.has("SELF_SERVE") || gtm.has("SMB_SALES")) return "SMB_PLG_SAAS";
    return "ENTERPRISE_SAAS";
  }
  return "GENERAL";
}

export function resolveStageBand(c: Classification): StageBand {
  switch (c.financingStage) {
    case "PRE_SEED":
    case "SEED":
      return "EARLY";
    case "SERIES_A":
      return "GROWTH";
    case "SERIES_B":
    case "SERIES_C_PLUS":
      return "LATE";
    default: {
      const m = c.operationalMaturity;
      if (m === "SCALED_GTM" || m === "GROWTH") return "LATE";
      if (m === "PMF_EMERGING") return "GROWTH";
      return "EARLY";
    }
  }
}

export interface PeerGroupRef {
  id: string;
  profile: ProfileId;
  stageBand: StageBand;
  name: string;
}

export function resolvePeerGroup(c: Classification): PeerGroupRef {
  const profile = resolveProfile(c);
  const stageBand = resolveStageBand(c);
  return {
    id: `${stageBand}__${profile}`,
    profile,
    stageBand,
    name: `${STAGE_BAND_LABELS[stageBand]} · ${PROFILE_LABELS[profile]}`,
  };
}
