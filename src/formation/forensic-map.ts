/**
 * Maps deterministic integrity findings onto the deck-forensics categories
 * used in training (misleading metric, omission, contradiction, inflated TAM,
 * pilots as customers, forecast as actual). Findings that are not about how
 * the deck presents information (security, source quality) are not mapped.
 */
import type { IntegrityFinding } from "@/engine/integrity";
import type { ForensicCategory } from "./types";
import { FORECAST_FINDINGS, PILOT_FINDINGS, TAM_FINDINGS } from "./patterns";

const MISLEADING = new Set([
  "GROWTH_ON_TINY_BASE",
  "CUMULATIVE_AS_RUN_RATE",
  "CUMULATIVE_NOT_RUN_RATE",
  "GMV_AS_REVENUE",
  "MONTHLY_FIGURE_AS_ARR",
  "MONTHLY_FIGURE_LABELLED_ARR",
  "SERVICES_AS_SAAS",
  "CAC_INCOMPLETE",
  "CAC_NOT_FULLY_LOADED",
  "CAC_LOADING_UNVERIFIED",
  "GROSS_MARGIN_EXCLUDES_COGS",
  "GROSS_MARGIN_COMPOSITION_UNKNOWN",
  "SMALL_SAMPLE_RATE",
  "SELF_SERVE_WITH_ENTERPRISE_SIGNALS",
]);
const OMISSION = new Set(["RATE_WITHOUT_DENOMINATOR", "RETENTION_WITHOUT_COHORTS", "NO_COHORT_DEFINITION", "BASE_NOT_DISCLOSED", "REVENUE_BASIS_UNDISCLOSED", "NO_DENOMINATOR", "EXPECTED_EVIDENCE_MISSING"]);
const CONTRADICTION = new Set(["CROSS_SLIDE_VALUE_CONFLICT", "CROSS_SLIDE_TYPO", "CROSS_SLIDE_MODEL", "CLAIM_SELF_CONTRADICTED", "CLAIM_CONTRADICTED", "DERIVED_VS_REPORTED", "NARRATIVE_INCONSISTENCY", "INCONSISTENT_WITH_INPUTS", "HIRING_PLAN_VS_BURN"]);

export function forensicCategory(f: Pick<IntegrityFinding, "kind" | "module">): ForensicCategory | null {
  if (TAM_FINDINGS.includes(f.kind)) return "INFLATED_TAM";
  if (PILOT_FINDINGS.includes(f.kind)) return "PILOTS_AS_CUSTOMERS";
  if (FORECAST_FINDINGS.includes(f.kind)) return "FORECAST_AS_ACTUAL";
  if (MISLEADING.has(f.kind)) return "MISLEADING_METRIC";
  if (OMISSION.has(f.kind)) return "OMISSION";
  if (CONTRADICTION.has(f.kind)) return "CONTRADICTION";
  if (f.module === "IMPLIED_METRICS" || f.module === "CROSS_SLIDE" || f.module === "CONTRADICTIONS") return "CONTRADICTION";
  if (f.module === "MODEL_FORENSICS") return "MISLEADING_METRIC";
  if (f.module === "CHRONOLOGY") return "FORECAST_AS_ACTUAL";
  return null;
}
