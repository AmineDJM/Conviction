/** Client-safe labels for Formation. */
import type { CasePattern, Concept, DecisionBucket, ExerciseKind, ForensicCategory, NumericTask, Skill } from "./types";

export const SKILL_LABEL: Record<Skill, string> = {
  SAAS_METRICS: "SaaS metrics",
  MARKETPLACE_ECONOMICS: "Marketplace economics",
  CONSUMER_METRICS: "Consumer metrics",
  BIOTECH: "Biotech",
  DEEPTECH: "Deep tech",
  FOUNDER_ASSESSMENT: "Founder assessment",
  GTM: "Go-to-market",
  MARKET_SIZING: "Market sizing",
  CAP_TABLES: "Cap tables",
  RETURN_MODELING: "Return modeling",
  PMF: "Product-market fit",
  COMPETITION: "Competition",
  MOAT: "Moat",
  DECK_FORENSICS: "Deck forensics",
  FOUNDER_QUESTIONING: "Founder questioning",
  OUTLIER_DETECTION: "Outlier detection",
  RISK_DETECTION: "Risk detection",
  INVESTMENT_JUDGMENT: "Investment judgment",
};

/** Skill groups for the profile view. */
export const SKILL_GROUPS: { label: string; skills: Skill[] }[] = [
  { label: "Business models", skills: ["SAAS_METRICS", "MARKETPLACE_ECONOMICS", "CONSUMER_METRICS", "BIOTECH", "DEEPTECH"] },
  { label: "Company", skills: ["FOUNDER_ASSESSMENT", "GTM", "PMF", "COMPETITION", "MOAT", "MARKET_SIZING"] },
  { label: "Economics", skills: ["CAP_TABLES", "RETURN_MODELING"] },
  { label: "Judgment", skills: ["DECK_FORENSICS", "FOUNDER_QUESTIONING", "RISK_DETECTION", "OUTLIER_DETECTION", "INVESTMENT_JUDGMENT"] },
];

export const KIND_LABEL: Record<ExerciseKind, string> = {
  MCQ_CONCERN: "Which variable matters most",
  MCQ_PMF_SIGNAL: "Signal versus noise",
  MCQ_MISSING_METRIC: "The missing number",
  NUMERIC: "Numerical exercise",
  FORENSICS_STATEMENTS: "Deck forensics",
  FORENSICS_OMISSIONS: "What the deck leaves out",
  FOUNDER_QUESTIONS: "Three questions for the founder",
  DECISION: "Investment decision",
  BULL_BEAR: "Bull and bear case",
  OUTLIER: "Outlier detection",
  OPEN_THESIS: "State the thesis",
  OPEN_NEXT_METRIC: "Next metric to request",
  OPEN_PASS_TRIGGER: "What would make you pass",
  OPEN_TWENTY_X: "What must be true for 20×",
};

export const NUMERIC_LABEL: Record<NumericTask, string> = {
  RUNWAY: "Runway",
  IMPLIED_ACV: "Implied ACV",
  ENTRY_OWNERSHIP: "Entry ownership",
  ROUND_DILUTION: "Round dilution",
  CAC_PAYBACK: "CAC payback",
  BURN_MULTIPLE: "Burn multiple",
  EXIT_FOR_20X: "Exit value for 20×",
  FUND_RETURN_EXIT: "Exit value to return the fund target",
  REQUIRED_CAGR: "Required revenue CAGR",
  NET_REVENUE_FROM_GMV: "Net revenue from GMV",
};

export const PATTERN_LABEL: Record<CasePattern, string> = {
  OBVIOUS_ANSWER_WRONG: "Obvious answer is wrong",
  CONFLICTING_METRICS: "Conflicting metrics",
  EXTRAORDINARY_FOUNDER_WEAK_TRACTION: "Extraordinary founder, weak traction",
  GREAT_COMPANY_BAD_PRICE: "Good company, demanding price",
  POOR_LOOKING_WITH_OUTLIER: "Imperfect company with an outlier signal",
  GROWTH_HIDING_RETENTION: "Growth hiding retention",
  WEAK_MARKET_CAN_EXPAND: "Small market that can expand",
  INFLATED_TAM: "Inflated TAM",
  PILOTS_AS_CUSTOMERS: "Pilots presented as customers",
  FORECAST_AS_ACTUAL: "Forecast presented as actual",
  CAPITAL_INTENSIVE: "Capital intensive",
  FOUNDER_DEPENDENT_SALES: "Founder-dependent sales",
  SHORT_RUNWAY: "Short runway",
  CUSTOMER_CONCENTRATION: "Customer concentration",
  UNIT_ECONOMICS_STRAIN: "Unit economics under strain",
};

export const CONCEPT_LABEL: Record<Concept, string> = {
  RETENTION_RISK: "retention risk",
  UNIT_ECONOMICS: "unit economics",
  CAPITAL_EFFICIENCY: "capital efficiency",
  RUNWAY_FINANCING: "runway and financing risk",
  CAPITAL_INTENSITY: "capital intensity",
  CUSTOMER_CONCENTRATION: "customer concentration",
  FOUNDER_DEPENDENCE: "founder dependence",
  GROWTH_QUALITY: "growth quality",
  MARKET_SIZE_INFLATION: "market-size inflation",
  CUSTOMER_QUALITY: "customer quality (pilots, logos)",
  FORECAST_VS_ACTUAL: "forecast versus actual",
  METRIC_DEFINITION: "metric definitions",
  INTERNAL_CONSISTENCY: "internal consistency",
  MISSING_EVIDENCE: "missing evidence",
  ENTRY_PRICE: "entry price",
  DILUTION: "dilution",
  RETURN_PATH: "the return path",
  OUTLIER_SIGNAL: "outlier signals",
  TECHNICAL_ADVANTAGE: "technical advantage",
  FOUNDER_CAPABILITY: "founder capability",
  COMPETITION: "competition",
  PMF_EVIDENCE: "PMF evidence",
  QUESTION_TARGETING: "question targeting",
};

export const DECISION_LABEL_F: Record<DecisionBucket, string> = {
  PASS: "Pass",
  WATCH: "Watch",
  CONTINUE_DD: "Continue diligence",
  IC: "Take to IC",
};

export const FORENSIC_LABEL: Record<ForensicCategory, string> = {
  MISLEADING_METRIC: "Misleading metric",
  OMISSION: "Omission / undefined",
  CONTRADICTION: "Contradiction",
  INFLATED_TAM: "Inflated TAM",
  PILOTS_AS_CUSTOMERS: "Pilots or logos as customers",
  FORECAST_AS_ACTUAL: "Forecast as actual",
};

export const MISTAKE_KINDS = [
  "OVERVALUED_TAM",
  "IGNORED_CHURN",
  "OVERWEIGHTED_PEDIGREE",
  "UNDERESTIMATED_FOUNDER",
  "MISSED_CAPITAL_INTENSITY",
  "CONFUSED_GROWTH_WITH_PMF",
  "PASSED_ON_TECH_ADVANTAGE",
  "OVERLOOKED_ENTRY_PRICE",
  "TOOK_METRICS_AT_FACE_VALUE",
  "ASKED_WHAT_DECK_ANSWERED",
  "MATH_ERROR",
  "OVERCONFIDENT_ERROR",
  "TOO_CONSERVATIVE",
  "TOO_AGGRESSIVE",
] as const;
export type MistakeKind = (typeof MISTAKE_KINDS)[number];

export const MISTAKE_LABEL: Record<MistakeKind, string> = {
  OVERVALUED_TAM: "Overvalued the TAM",
  IGNORED_CHURN: "Ignored churn and retention",
  OVERWEIGHTED_PEDIGREE: "Over-weighted founder pedigree",
  UNDERESTIMATED_FOUNDER: "Underestimated the founder",
  MISSED_CAPITAL_INTENSITY: "Missed capital intensity or financing risk",
  CONFUSED_GROWTH_WITH_PMF: "Confused growth with product-market fit",
  PASSED_ON_TECH_ADVANTAGE: "Passed on an exceptional technical advantage",
  OVERLOOKED_ENTRY_PRICE: "Overlooked the entry price",
  TOOK_METRICS_AT_FACE_VALUE: "Took deck metrics at face value",
  ASKED_WHAT_DECK_ANSWERED: "Asked what the deck already answered",
  MATH_ERROR: "Calculation error",
  OVERCONFIDENT_ERROR: "Confidently wrong",
  TOO_CONSERVATIVE: "More negative than the evidence",
  TOO_AGGRESSIVE: "More positive than the evidence",
};

