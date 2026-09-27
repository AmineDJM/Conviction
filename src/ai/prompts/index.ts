/** Versioned prompt registry — stored with every analysis run (§144). */
import { TRIAGE } from "./triage";
import { EXTRACT_METRICS, EXTRACT_CLAIMS, EXTRACT_PROFILE } from "./extract";
import { DECK_FORENSICS } from "./forensics";
import { LATENT_SIGNALS } from "./latent";
import { RESEARCH } from "./research";
import { INVESTMENT_ANALYSIS } from "./investment-analysis";
import { DECISION_THESIS, DECISION_CHALLENGE, DECISION_ACTIONS } from "./decision";
import { FOUNDER_CALL_UPDATE } from "./founder-call";
import { BRAIN_PLANNER, BRAIN_ANSWER } from "./brain";
import { IC_OBSERVATIONS } from "./ic-observations";

export const PROMPT_VERSIONS = {
  [TRIAGE.id]: TRIAGE.version,
  [EXTRACT_METRICS.id]: EXTRACT_METRICS.version,
  [EXTRACT_CLAIMS.id]: EXTRACT_CLAIMS.version,
  [EXTRACT_PROFILE.id]: EXTRACT_PROFILE.version,
  [DECK_FORENSICS.id]: DECK_FORENSICS.version,
  [LATENT_SIGNALS.id]: LATENT_SIGNALS.version,
  [RESEARCH.id]: RESEARCH.version,
  [INVESTMENT_ANALYSIS.id]: INVESTMENT_ANALYSIS.version,
  [DECISION_THESIS.id]: DECISION_THESIS.version,
  [DECISION_CHALLENGE.id]: DECISION_CHALLENGE.version,
  [DECISION_ACTIONS.id]: DECISION_ACTIONS.version,
  [FOUNDER_CALL_UPDATE.id]: FOUNDER_CALL_UPDATE.version,
  [BRAIN_PLANNER.id]: BRAIN_PLANNER.version,
  [BRAIN_ANSWER.id]: BRAIN_ANSWER.version,
  [IC_OBSERVATIONS.id]: IC_OBSERVATIONS.version,
};
