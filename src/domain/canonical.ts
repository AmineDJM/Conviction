/**
 * THE CANONICAL INVESTMENT OBJECT (§10).
 *
 * Every report, score and UI view is rendered from this object plus the
 * deterministic `DerivedAnalysis` computed from it (engine/derive.ts).
 * Generated prose is never source data (§148).
 *
 * Source-of-truth hierarchy:
 *   raw documents → sources/claims/metric observations → canonical metrics
 *   → benchmark calculations (derived) → interpretation → reports
 */
import { z } from "zod";
import {
  AnalysisMode,
  ClaimCategory,
  DataState,
  DecisionStatus,
  EvidenceOrigin,
  ExecutionStatus,
  Freshness,
  IcDecision,
  Independence,
  QuestionStatus,
  VerificationStatus,
} from "./enums";
import {
  BusinessModelSection,
  Classification,
  CompetitionSection,
  CustomersSection,
  ExceptionalStrength,
  ExitAssumption,
  FalsificationItem,
  FinancingExtraction,
  FinancingPathAnalysis,
  FounderAnalysis,
  FounderFromDeck,
  FounderQuestionDraft,
  GtmSection,
  Identity,
  InformationGapDraft,
  MarketSection,
  MetricObservation,
  MoatItem,
  NextBestAction,
  NonlinearSection,
  PainSection,
  PmfSection,
  ProductSection,
  RedTeamSection,
  RiskItem,
  RubricAssessment,
  ThesisSection,
  WatchTrigger,
  DeckForensics,
  CausalModel,
  AlternativeExplanation,
  SensitivityDriver,
  PerfectSlide,
  LatentSignalsDraft,
  RevealedInsight,
  DecisionCore,
  DivergenceDraft,
} from "./sections";
import { Money } from "./money";

export const CANONICAL_SCHEMA_VERSION = "1.1";
/** Version of the orchestration + deterministic engine. Bump on any behavioural change; stored with every analysis. */
export const ANALYSIS_ENGINE_VERSION = "3.1";

/* ---------------------------------------------------------------- */
/* Sources                                                            */
/* ---------------------------------------------------------------- */

export const Source = z.object({
  id: z.string(), // SRC-001
  kind: z.enum(["DOCUMENT", "WEB", "TRANSCRIPT", "USER_INPUT"]),
  title: z.string(),
  url: z.string().nullable(),
  documentId: z.string().nullable(),
  publisher: z.string().nullable(),
  publishedDate: z.string().nullable(),
  retrievedAt: z.string(),
  origin: EvidenceOrigin,
  /** Sources that repeat the same underlying origin share a group id (§60). */
  independenceGroup: z.string(),
  /** True when the URL was actually returned by the search tool (citation integrity). */
  citationVerified: z.boolean(),
});
export type Source = z.infer<typeof Source>;

/* ---------------------------------------------------------------- */
/* Claims & evidence (§59–61)                                         */
/* ---------------------------------------------------------------- */

export const EvidenceLink = z.object({
  sourceId: z.string(),
  effect: z.enum(["ORIGIN", "CONFIRMS", "PARTIALLY_CONFIRMS", "CONTRADICTS", "NEW_INFORMATION"]),
  excerpt: z.string(),
  location: z.string().nullable(), // "p. 7", URL fragment, transcript minute
  note: z.string().nullable(),
});
export type EvidenceLink = z.infer<typeof EvidenceLink>;

export const Claim = z.object({
  id: z.string(), // CLM-001
  category: ClaimCategory,
  statement: z.string(),
  valueText: z.string().nullable(),
  entity: z.string(),
  period: z.string().nullable(),
  material: z.boolean(),
  unusualness: z.number().int().default(2),
  proposition: z.string().nullable().default(null),
  evidenceNeeded: z.string().nullable().default(null),
  origin: EvidenceOrigin,
  verification: VerificationStatus,
  freshness: Freshness,
  independence: Independence,
  verificationMethod: z.string(),
  limitations: z.string().nullable(),
  contradictions: z.array(z.string()),
  evidence: z.array(EvidenceLink),
  history: z.array(
    z.object({
      at: z.string(),
      /** CLARIFIED: same fact, better defined (definition, scope, period) — e.g. by the founder in a meeting. */
      change: z.enum(["CREATED", "CONFIRMED", "CLARIFIED", "CHANGED", "CONTRADICTED", "UNRESOLVED", "CORRECTED"]),
      note: z.string(),
    }),
  ),
});
export type Claim = z.infer<typeof Claim>;

/* ---------------------------------------------------------------- */
/* Metrics (§16)                                                      */
/* ---------------------------------------------------------------- */

export const MetricInstance = z.object({
  id: z.string(), // MET-001
  metricKey: z.string(),
  label: z.string(),
  rawValue: z.string(),
  /** Normalized to the dictionary unit (USD for money, percent units for %). */
  normalizedValue: z.number().nullable(),
  unit: z.string(),
  currency: z.string().nullable(),
  periodType: z.string(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  definitionUsed: z.string().nullable(),
  components: z.array(z.string()),
  entityScope: z.string(),
  sampleSize: z.number().nullable(),
  cohortDefinition: z.string().nullable(),
  state: DataState,
  sourceId: z.string().nullable(),
  claimId: z.string().nullable(),
  location: z.string().nullable(),
  excerpt: z.string().nullable(),
  verification: VerificationStatus,
  calculationMethod: z.enum(["REPORTED", "DERIVED", "USER_CORRECTED"]),
  derivation: z.string().nullable(),
  /** Primary instance is the one used for scoring when several periods exist. */
  isPrimary: z.boolean(),
  qualityFlags: z.array(z.string()),
  notes: z.string().nullable(),
  /** Chronology basis of the underlying observation (ACTUAL / CURRENT / LTM / SIGNED …). */
  basis: z.string().default("CURRENT"),
  /** Every transformation from raw text to this number, in order (metric lineage). */
  lineage: z.array(z.object({ step: z.string(), detail: z.string() })).default([]),
  /** Metric ids this value was derived from (DERIVED only). */
  inputs: z.array(z.string()).default([]),
});
export type MetricInstance = z.infer<typeof MetricInstance>;

/* ---------------------------------------------------------------- */
/* Founders, questions, gaps, risks with ids                          */
/* ---------------------------------------------------------------- */

export const Founder = FounderAnalysis.extend({
  id: z.string(),
  backgroundFromDeck: z.string(),
  priorOrganizations: z.array(z.string()),
  publicProfileUrls: z.array(z.string()),
  researchFindingSourceIds: z.array(z.string()),
});
export type Founder = z.infer<typeof Founder>;

export const FounderQuestion = FounderQuestionDraft.extend({
  id: z.string(), // Q-01
  status: QuestionStatus,
  answer: z.string().nullable(),
  answeredAt: z.string().nullable(),
  resolutionNote: z.string().nullable(),
});
export type FounderQuestion = z.infer<typeof FounderQuestion>;

export const InformationGap = InformationGapDraft.extend({
  id: z.string(), // GAP-01
  status: z.enum(["OPEN", "RESEARCHED", "RESOLVED", "NEEDS_FOUNDER"]),
  resolutionNote: z.string().nullable(),
});
export type InformationGap = z.infer<typeof InformationGap>;

export const Risk = RiskItem.extend({ id: z.string() }); // RSK-01
export type Risk = z.infer<typeof Risk>;

export const ExceptionalStrengthItem = ExceptionalStrength.extend({ id: z.string() });

/* ---------------------------------------------------------------- */
/* Analysis status                                                    */
/* ---------------------------------------------------------------- */

export const AnalysisState = z.object({
  mode: AnalysisMode,
  depth: z.enum(["FULL", "PARTIAL"]),
  partialReasons: z.array(z.string()),
  unresolved: z.array(z.string()),
  researchNotCompleted: z.array(z.string()),
  expectedNextActions: z.array(z.string()),
  /** Text in documents or web pages that looked like instructions to an AI. Treated as data (§114). */
  securityFlags: z.array(z.object({ location: z.string(), excerpt: z.string() })),
  completedSteps: z.array(z.string()),
  skippedSteps: z.array(z.object({ step: z.string(), reason: z.string() })),
  /** Full reproducibility record (§ versioning). */
  provenance: z
    .object({
      model: z.string(),
      promptVersions: z.record(z.string(), z.string()),
      engineVersion: z.string(),
      dictionaryVersion: z.string(),
      schemaVersion: z.string(),
      inputHash: z.string().nullable(),
      startedAt: z.string(),
      durationMs: z.number().nullable(),
    })
    .nullable()
    .default(null),
  cancelled: z.boolean().default(false),
});
export type AnalysisState = z.infer<typeof AnalysisState>;

/* ---------------------------------------------------------------- */
/* The canonical object                                               */
/* ---------------------------------------------------------------- */

export const CanonicalDeal = z.object({
  schemaVersion: z.literal(CANONICAL_SCHEMA_VERSION),
  identity: Identity,
  classification: Classification,
  documents: z.array(
    z.object({ id: z.string(), filename: z.string(), kind: z.string(), pages: z.number().nullable() }),
  ),
  sources: z.array(Source),
  claims: z.array(Claim),
  metricObservations: z.array(MetricObservation), // raw, as extracted — audit trail
  metrics: z.array(MetricInstance),
  founders: z.array(Founder),
  foundersFromDeck: z.array(FounderFromDeck),
  product: ProductSection.nullable(),
  pain: PainSection.nullable(),
  customers: CustomersSection.nullable(),
  businessModel: BusinessModelSection.nullable(),
  pmf: PmfSection.nullable(),
  market: MarketSection.nullable(),
  deckMarket: z.object({
    tam: Money.nullable(),
    sam: Money.nullable(),
    som: Money.nullable(),
    description: z.string().nullable(),
  }),
  competition: CompetitionSection.nullable(),
  moat: z.array(MoatItem),
  gtm: GtmSection.nullable(),
  economicsNotes: z.string().nullable(),
  financing: FinancingExtraction.nullable(),
  financingPath: FinancingPathAnalysis.nullable(),
  risks: z.array(Risk),
  rubric: z.array(RubricAssessment),
  exitAssumptions: z.array(ExitAssumption),
  arpaAssumptionUsd: z.number().nullable(),
  exceptionalStrengths: z.array(ExceptionalStrengthItem),
  nonlinear: NonlinearSection.nullable(),
  thesis: ThesisSection.nullable(),
  falsification: z.array(FalsificationItem),
  redTeam: RedTeamSection.nullable(),
  whatILike: z.array(z.string()),
  whatWorriesMe: z.array(z.string()),
  informationGaps: z.array(InformationGap),
  questions: z.array(FounderQuestion),
  nextBestAction: NextBestAction.nullable(),
  executiveSummary: z.string().nullable(),
  aiRecommendation: z
    .object({ suggestedStatus: DecisionStatus, rationale: z.string(), watch: WatchTrigger.nullable() })
    .nullable(),
  powerLawRatings: z
    .object({
      nonlinearMechanism: z.string(),
      exceptionalStrength: z.string(),
    })
    .nullable(),
  icDecision: IcDecision,
  executionStatus: ExecutionStatus,
  analysis: AnalysisState,
  forensics: DeckForensics.nullable().default(null),
  causalModel: CausalModel.nullable().default(null),
  alternativeExplanations: z.array(AlternativeExplanation).default([]),
  sensitivityDrivers: z.array(SensitivityDriver).default([]),
  perfectSlides: z.array(PerfectSlide).default([]),
  /** "Ignoring the founder's narrative, what company is actually in front of us?" */
  realityCheck: z.string().nullable().default(null),
  /** Observable latent signals from the deck (model-extracted, code-aggregated in derived.latent). */
  latentSignals: LatentSignalsDraft.nullable().default(null),
  /** "What the deck reveals beyond the pitch". */
  revealedBeyondPitch: z.array(RevealedInsight).default([]),
  /** Compression: the bet, the 5 determinants, 2 outlier signals, the reversing question. */
  decisionCore: DecisionCore.nullable().default(null),
  /** Observable divergence signals from the deck (model-extracted, code-aggregated in derived.divergence). */
  divergence: DivergenceDraft.nullable().default(null),
  /** Human overrides. Raw data is never overwritten: every override records what it replaced. */
  overrides: z
    .array(
      z.object({
        id: z.string(),
        target: z.enum(["METRIC", "CLASSIFICATION", "ENTITY", "CLAIM"]),
        ref: z.string(),
        field: z.string(),
        from: z.unknown(),
        to: z.unknown(),
        reason: z.string(),
        by: z.string().nullable(),
        at: z.string(),
      }),
    )
    .default([]),
});
export type CanonicalDeal = z.infer<typeof CanonicalDeal>;

export function emptyCanonical(mode: z.infer<typeof AnalysisMode>): CanonicalDeal {
  return {
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    identity: { name: "Untitled company", legalName: null, website: null, hqCountry: null, foundedYear: null, oneLiner: "" },
    classification: {
      industry: [],
      productType: [],
      technology: [],
      revenueModel: [],
      gtm: [],
      operationalMaturity: "PRE_PRODUCT",
      financingStage: "UNKNOWN",
      declaredStage: null,
      rationale: "",
    },
    documents: [],
    sources: [],
    claims: [],
    metricObservations: [],
    metrics: [],
    founders: [],
    foundersFromDeck: [],
    product: null,
    pain: null,
    customers: null,
    businessModel: null,
    pmf: null,
    market: null,
    deckMarket: { tam: null, sam: null, som: null, description: null },
    competition: null,
    moat: [],
    gtm: null,
    economicsNotes: null,
    financing: null,
    financingPath: null,
    risks: [],
    rubric: [],
    exitAssumptions: [],
    arpaAssumptionUsd: null,
    exceptionalStrengths: [],
    nonlinear: null,
    thesis: null,
    falsification: [],
    redTeam: null,
    whatILike: [],
    whatWorriesMe: [],
    informationGaps: [],
    questions: [],
    nextBestAction: null,
    executiveSummary: null,
    aiRecommendation: null,
    powerLawRatings: null,
    icDecision: "PENDING",
    executionStatus: "NOT_STARTED",
    analysis: {
      mode,
      depth: "PARTIAL",
      partialReasons: [],
      unresolved: [],
      researchNotCompleted: [],
      expectedNextActions: [],
      securityFlags: [],
      completedSteps: [],
      skippedSteps: [],
      provenance: null,
      cancelled: false,
    },
    forensics: null,
    causalModel: null,
    alternativeExplanations: [],
    sensitivityDrivers: [],
    perfectSlides: [],
    realityCheck: null,
    latentSignals: null,
    revealedBeyondPitch: [],
    decisionCore: null,
    divergence: null,
    overrides: [],
  };
}

/**
 * Upgrade a stored canonical object to the current schema version. New fields
 * get explicit defaults via zod; nested items gain their new fields here. Never
 * invents data: new analytical fields stay empty until re-analysis.
 */
export function upgradeCanonical(raw: unknown): CanonicalDeal {
  const r = structuredClone(raw) as Record<string, unknown> & { schemaVersion?: string };
  if (r && r.schemaVersion === "1.0") {
    const customers = r.customers as { namedCustomers?: { evidenceLevel?: string }[] } | null;
    for (const nc of customers?.namedCustomers ?? []) nc.evidenceLevel ??= "UNKNOWN";
    for (const o of (r.metricObservations as { basis?: string; sourceKind?: string; isProjection?: boolean }[]) ?? []) {
      o.basis ??= o.isProjection ? "FORECAST" : "CURRENT";
      o.sourceKind ??= "TEXT";
      delete o.isProjection;
    }
    r.schemaVersion = CANONICAL_SCHEMA_VERSION;
  }
  // Divergence signals (added within schema 1.1): absent on versions stored before the pass existed.
  // A malformed stored block is dropped rather than failing the whole version — it is re-extracted on re-analysis.
  if (r && typeof r === "object") {
    if (r.divergence === undefined) r.divergence = null;
    else if (r.divergence !== null && !DivergenceDraft.safeParse(r.divergence).success) r.divergence = null;
  }
  return CanonicalDeal.parse(r);
}
