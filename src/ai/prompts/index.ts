/** Versioned prompt registry — stored with every analysis run (§144). */
import { DECK_UNDERSTANDING } from "./deck-understanding";
import { RESEARCH } from "./research";
import { INVESTMENT_ANALYSIS } from "./investment-analysis";
import { RED_TEAM } from "./red-team";
import { FOUNDER_CALL_UPDATE } from "./founder-call";
import { BRAIN_PLANNER, BRAIN_ANSWER } from "./brain";
import { IC_OBSERVATIONS } from "./ic-observations";

export const PROMPT_VERSIONS = {
  [DECK_UNDERSTANDING.id]: DECK_UNDERSTANDING.version,
  [RESEARCH.id]: RESEARCH.version,
  [INVESTMENT_ANALYSIS.id]: INVESTMENT_ANALYSIS.version,
  [RED_TEAM.id]: RED_TEAM.version,
  [FOUNDER_CALL_UPDATE.id]: FOUNDER_CALL_UPDATE.version,
  [BRAIN_PLANNER.id]: BRAIN_PLANNER.version,
  [BRAIN_ANSWER.id]: BRAIN_ANSWER.version,
  [IC_OBSERVATIONS.id]: IC_OBSERVATIONS.version,
};
