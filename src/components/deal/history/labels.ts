/** Labels for versions and history events (client-safe, server-safe). */
const REASON: Record<string, string> = {
  DECK_ANALYSIS: "Deck analysis",
  RESEARCH: "Research",
  RESEARCH_REFRESH: "Stale data refresh",
  FOUNDER_CALL: "Founder call",
  METRIC_CORRECTION: "Metric correction (legacy)",
  BENCHMARK_RECALC: "Benchmark recalculation",
  QUESTION_UPDATE: "Question update",
  STATUS_CHANGE: "Status change",
  FUND_PROFILE_CHANGE: "Fund profile change",
  USER_OVERRIDE: "Analyst override",
};
export const reasonText = (r: string) => REASON[r] ?? r;

export const HISTORY_TYPE_TEXT: Record<string, string> = {
  DECK_UPLOADED: "Deck uploaded",
  ANALYSIS_STARTED: "Analysis started",
  ANALYSIS_COMPLETED: "Analysis completed",
  RESEARCH_RUN: "Research run",
  FOUNDER_CALL_ADDED: "Founder call added",
  METRIC_CORRECTED: "Metric corrected",
  BENCHMARK_RECALCULATED: "Benchmark recalculated",
  RECOMMENDATION_CHANGED: "Recommendation changed",
  QUESTION_UPDATED: "Question updated",
  IC_DECISION: "IC decision",
  EXECUTION_STATUS: "Execution status",
  REPORT_EXPORTED: "Report exported",
  OVERRIDE_ADDED: "Override added",
  OVERRIDE_REVERTED: "Override reverted",
  OVERRIDES_CARRIED_OVER: "Overrides carried over",
  DECK_VERSION_ADDED: "New deck version",
  DOCUMENTS_ADDED: "Documents added",
  COMPANY_MERGED: "Merged",
  DUPLICATE_DISMISSED: "Different company confirmed",
};

export const RUN_KIND_TEXT: Record<string, string> = { DECK: "Deck analysis", FOUNDER_CALL: "Founder call", RESEARCH: "Research", RECALC: "Recalculation" };
