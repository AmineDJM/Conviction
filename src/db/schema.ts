/**
 * Relational schema (SQLite via better-sqlite3 + Drizzle).
 *
 * The canonical investment object is versioned as a validated JSON document
 * (company_versions.canonical). Query-critical projections are materialized
 * into relational tables at write time (metric_facts, entities, relations,
 * chunks) so the Fund Brain can answer with structured queries first.
 */
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey, foreignKey } from "drizzle-orm/sqlite-core";

const ts = (name: string) => text(name).notNull();

/* ------------------------------ Identity ------------------------------ */

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: ts("created_at"),
});

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: ts("created_at"),
});

export const memberships = sqliteTable(
  "memberships",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["OWNER", "PARTNER", "ANALYST", "VIEWER"] }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workspaceId] })],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at"),
  createdAt: ts("created_at"),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id"),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail"),
    createdAt: ts("created_at"),
  },
  (t) => [index("audit_ws_idx").on(t.workspaceId, t.createdAt)],
);

/* ------------------------------ Fund Brain ------------------------------ */

export const funds = sqliteTable("funds", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  profile: text("profile", { mode: "json" }).notNull(),
  isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
  updatedAt: ts("updated_at"),
});

/** Documented fund knowledge: strategy, criteria, verticals, IC preferences, policies. */
export const fundKnowledge = sqliteTable(
  "fund_knowledge",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["STRATEGY", "CRITERIA", "VERTICAL", "IC_PREFERENCE", "POLICY", "LESSON", "NOTE"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    provenance: text("provenance", { enum: ["DOCUMENTED", "INFERRED", "OBSERVED"] }).notNull(),
    sourceRef: text("source_ref"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [index("fk_ws_idx").on(t.workspaceId, t.kind)],
);

export const icMembers = sqliteTable("ic_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  normName: text("norm_name").notNull(),
  role: text("role").notNull(),
  bio: text("bio"),
  focus: text("focus", { mode: "json" }).$type<string[]>().notNull(),
  /** Only preferences the member has documented or approved. */
  documentedPreferences: text("documented_preferences"),
  createdAt: ts("created_at"),
});

export const meetings = sqliteTable("meetings", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["PARTNER_MEETING", "IC", "FOUNDER_CALL"] }).notNull(),
  title: text("title").notNull(),
  heldAt: ts("held_at"),
  companyId: text("company_id"),
  transcript: text("transcript"),
  notes: text("notes"),
  createdAt: ts("created_at"),
});

/** What an IC member actually said or did. OBSERVED = recorded; INFERRED = pattern across observations. */
export const icObservations = sqliteTable(
  "ic_observations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull().references(() => icMembers.id, { onDelete: "cascade" }),
    meetingId: text("meeting_id"),
    companyId: text("company_id"),
    kind: text("kind", { enum: ["QUESTION", "CONCERN", "SUPPORT", "VOTE", "PATTERN"] }).notNull(),
    statement: text("statement").notNull(),
    quote: text("quote"),
    topic: text("topic"),
    provenance: text("provenance", { enum: ["OBSERVED", "INFERRED"] }).notNull(),
    observedAt: ts("observed_at"),
  },
  (t) => [index("icobs_member_idx").on(t.memberId)],
);

/* ------------------------------ Deals ------------------------------ */

export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normName: text("norm_name").notNull(),
    slug: text("slug").notNull(),
    currentVersionId: text("current_version_id"),
    // Denormalized pipeline projection (rebuilt from the current version).
    oneLiner: text("one_liner"),
    sector: text("sector"),
    stage: text("stage"),
    country: text("country"),
    peerGroup: text("peer_group"),
    decisionStatus: text("decision_status"),
    icDecision: text("ic_decision").notNull().default("PENDING"),
    executionStatus: text("execution_status").notNull().default("NOT_STARTED"),
    exceptionalStrength: text("exceptional_strength"),
    oqi: real("oqi"),
    oqiLower: real("oqi_lower"),
    oqiUpper: real("oqi_upper"),
    oqiCoverage: real("oqi_coverage"),
    evidence: text("evidence"),
    evidenceIndex: real("evidence_index"),
    powerLaw: real("power_law"),
    riskHeadline: text("risk_headline"),
    riskIndex: real("risk_index"),
    fundFit: real("fund_fit"),
    mandate: text("mandate"),
    roundUsd: real("round_usd"),
    postMoneyUsd: real("post_money_usd"),
    baseMoic: real("base_moic"),
    analysisDepth: text("analysis_depth"),
    analysisMode: text("analysis_mode"),
    status: text("status", { enum: ["PROCESSING", "READY", "FAILED"] }).notNull().default("PROCESSING"),
    /** Identity projection for duplicate detection (registrable domain of identity.website, founder names). */
    websiteDomain: text("website_domain"),
    founderNames: text("founder_names", { mode: "json" }).$type<string[]>(),
    /** Set when this company was merged into another one as a new deck version (soft-deleted, kept for audit). */
    mergedIntoId: text("merged_into_id"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [index("companies_ws_idx").on(t.workspaceId, t.updatedAt), uniqueIndex("companies_slug_idx").on(t.workspaceId, t.slug)],
);

export const companyVersions = sqliteTable(
  "company_versions",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    runId: text("run_id"),
    registryId: text("registry_id").notNull(),
    fundProfileId: text("fund_profile_id").notNull(),
    canonical: text("canonical", { mode: "json" }).notNull(),
    derived: text("derived", { mode: "json" }).notNull(),
    reason: text("reason", {
      enum: ["DECK_ANALYSIS", "RESEARCH", "RESEARCH_REFRESH", "FOUNDER_CALL", "METRIC_CORRECTION", "BENCHMARK_RECALC", "QUESTION_UPDATE", "STATUS_CHANGE", "FUND_PROFILE_CHANGE", "USER_OVERRIDE"],
    }).notNull(),
    summary: text("summary"),
    createdBy: text("created_by"),
    createdAt: ts("created_at"),
    /**
     * Meetings workflow stage, set once at insert and never rewritten (see src/domain/meetings.ts).
     * Null on rows written before the workflow existed: resolved at read time (DECK_ANALYSIS → PRE_MEETING_ANALYSIS).
     */
    stage: text("stage", { enum: ["PRE_MEETING_ANALYSIS", "POST_MEETING_ANALYSIS", "DECK_REANALYSIS"] }),
    /** POST_MEETING_ANALYSIS_V{stageSeq}; for other stages, the revision number within the stage. */
    stageSeq: integer("stage_seq"),
  },
  (t) => [uniqueIndex("versions_company_no_idx").on(t.companyId, t.versionNo)],
);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  kind: text("kind", { enum: ["PDF", "PPTX", "IMAGE", "TEXT", "TRANSCRIPT", "OTHER"] }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  storagePath: text("storage_path").notNull(),
  pages: integer("pages"),
  textChars: integer("text_chars"),
  /**
   * Deck lineage: 1, 2, 3… for the pitch deck of each deck version of the company; null for supporting
   * documents (financials, one-pagers) and for rows written before deck versions existed (resolved at read
   * time, see engine/deck-lineage.ts). Set once at insert.
   */
  deckVersion: integer("deck_version"),
  /** The deck document this one supersedes (deck v(n-1)); null for v1 and supporting documents. */
  supersedesDocumentId: text("supersedes_document_id"),
  createdAt: ts("created_at"),
});

export const documentPages = sqliteTable(
  "document_pages",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    pageNo: integer("page_no").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("pages_doc_idx").on(t.documentId, t.pageNo)],
);

export const analysisRuns = sqliteTable(
  "analysis_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: ["FAST_SCREEN", "STANDARD", "DEEP_DD"] }).notNull(),
    kind: text("kind", { enum: ["DECK", "FOUNDER_CALL", "RESEARCH", "RECALC"] }).notNull().default("DECK"),
    status: text("status", { enum: ["QUEUED", "RUNNING", "COMPLETED", "PARTIAL", "FAILED", "CANCELLED"] }).notNull(),
    depth: text("depth"),
    model: text("model").notNull(),
    promptVersions: text("prompt_versions", { mode: "json" }).$type<Record<string, string>>().notNull(),
    registryId: text("registry_id").notNull(),
    budgetUsd: real("budget_usd").notNull(),
    spentUsd: real("spent_usd").notNull().default(0),
    progress: text("progress", { mode: "json" }).$type<{ step: string; label: string; status: string; at: string; detail?: string }[]>().notNull(),
    error: text("error"),
    startedAt: ts("started_at"),
    finishedAt: text("finished_at"),
  },
  (t) => [index("runs_company_idx").on(t.companyId, t.startedAt)],
);

export const costRecords = sqliteTable(
  "cost_records",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    runId: text("run_id"),
    scope: text("scope", { enum: ["ANALYSIS", "CHAT", "EMBEDDING", "FORMATION"] }).notNull(),
    step: text("step").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    reasoningTokens: integer("reasoning_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    estimatedUsd: real("estimated_usd").notNull(),
    actualUsd: real("actual_usd").notNull(),
    latencyMs: integer("latency_ms"),
    createdAt: ts("created_at"),
  },
  (t) => [index("cost_run_idx").on(t.runId), index("cost_ws_idx").on(t.workspaceId, t.createdAt)],
);

export const historyEvents = sqliteTable(
  "history_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionId: text("version_id"),
    type: text("type", {
      enum: [
        "DECK_UPLOADED",
        "ANALYSIS_STARTED",
        "ANALYSIS_COMPLETED",
        "RESEARCH_RUN",
        "FOUNDER_CALL_ADDED",
        "METRIC_CORRECTED",
        "BENCHMARK_RECALCULATED",
        "RECOMMENDATION_CHANGED",
        "QUESTION_UPDATED",
        "IC_DECISION",
        "EXECUTION_STATUS",
        "REPORT_EXPORTED",
        "OVERRIDE_ADDED",
        "OVERRIDE_REVERTED",
        "OVERRIDES_CARRIED_OVER",
        "DECK_VERSION_ADDED",
        "DOCUMENTS_ADDED",
        "COMPANY_MERGED",
        "DUPLICATE_DISMISSED",
      ],
    }).notNull(),
    summary: text("summary").notNull(),
    payload: text("payload", { mode: "json" }),
    actorUserId: text("actor_user_id"),
    createdAt: ts("created_at"),
  },
  (t) => [index("history_company_idx").on(t.companyId, t.createdAt)],
);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  versionId: text("version_id").notNull(),
  runId: text("run_id"),
  kind: text("kind", { enum: ["QUICK_MEMO", "INVESTMENT_MEMO", "FOUNDER_CALL_BRIEF", "DEEP_DD"] }).notNull(),
  registryId: text("registry_id").notNull(),
  createdBy: text("created_by"),
  createdAt: ts("created_at"),
});

/* ------------------------------ Retrieval layer (Fund Brain) ------------------------------ */

/** Pre-computed compact deal context: the chatbot's first stop for any company question. */
export const memoryPacks = sqliteTable("memory_packs", {
  companyId: text("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id").notNull(),
  versionId: text("version_id").notNull(),
  pack: text("pack", { mode: "json" }).notNull(),
  text: text("text").notNull(),
  tokenEstimate: integer("token_estimate").notNull(),
  updatedAt: ts("updated_at"),
});

/** Structured facts for exact questions ("which deals have NRR > 120%?"). Primary metrics of current versions only. */
export const metricFacts = sqliteTable(
  "metric_facts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    metricId: text("metric_id").notNull(),
    metricKey: text("metric_key").notNull(),
    value: real("value"),
    unit: text("unit").notNull(),
    state: text("state").notNull(),
    verification: text("verification").notNull(),
    calculationMethod: text("calculation_method").notNull(),
    periodEnd: text("period_end"),
    sampleSize: integer("sample_size"),
    flags: text("flags", { mode: "json" }).$type<string[]>().notNull(),
  },
  (t) => [index("facts_key_idx").on(t.workspaceId, t.metricKey, t.value), index("facts_company_idx").on(t.companyId)],
);

export const entities = sqliteTable(
  "entities",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    type: text("type", { enum: ["COMPANY", "PERSON", "COMPETITOR", "INVESTOR", "MARKET", "CUSTOMER", "IC_MEMBER"] }).notNull(),
    name: text("name").notNull(),
    normName: text("norm_name").notNull(),
    companyId: text("company_id"),
    aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull(),
    /**
     * Identity key (src/brain/entities.ts): person:<name>:<companyId>, company:<companyId>,
     * org:<canonical>, org:ambiguous:<short>, <type>:<normName>. Null on rows written before
     * entity resolution; those are rebuilt on the next index and pruned when orphaned.
     */
    resolutionKey: text("resolution_key"),
    /** Resolution evidence (per-company person evidence, former names, domain, ambiguity candidates). */
    attributes: text("attributes", { mode: "json" }).$type<Record<string, unknown>>(),
  },
  (t) => [index("entities_norm_idx").on(t.workspaceId, t.normName), uniqueIndex("entities_key_idx").on(t.workspaceId, t.type, t.resolutionKey)],
);

export const relations = sqliteTable(
  "relations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    fromEntity: text("from_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    toEntity: text("to_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    type: text("type", {
      // ALIAS_OF: the same company under another name (explicit rename, same domain, same founding team).
      // POSSIBLY_SAME_AS: partial founder overlap — shown, never used to resolve a mention.
      enum: ["FOUNDED", "WORKED_AT", "COMPETES_WITH", "INVESTED_IN", "OPERATES_IN", "CUSTOMER_OF", "SIMILAR_TO", "ALIAS_OF", "POSSIBLY_SAME_AS"],
    }).notNull(),
    companyId: text("company_id"),
    sourceRef: text("source_ref"),
    note: text("note"),
  },
  (t) => [index("rel_from_idx").on(t.fromEntity), index("rel_to_idx").on(t.toEntity)],
);

/** Retrieval chunks. Embeddings are float32 BLOBs (dimension in `embeddingDim`). */
export const chunks = sqliteTable(
  "chunks",
  {
    rowid: integer("rowid").primaryKey({ autoIncrement: true }),
    id: text("id").notNull().unique(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id"),
    versionId: text("version_id"),
    kind: text("kind", {
      enum: ["PAGE", "CLAIM", "SECTION", "SOURCE", "MEMO", "MEETING", "FUND_KNOWLEDGE", "IC_OBSERVATION", "QUESTION", "RISK"],
    }).notNull(),
    refId: text("ref_id"),
    title: text("title").notNull(),
    text: text("text").notNull(),
    /** Link target in the app, e.g. /deals/acme?tab=evidence&claim=CLM-004 */
    href: text("href"),
    evidenceLabel: text("evidence_label"),
    /** sha256 of the embedded text — unchanged text is never re-embedded. */
    textHash: text("text_hash").notNull(),
    embedding: blob("embedding", { mode: "buffer" }),
    embeddingModel: text("embedding_model"),
    embeddingDim: integer("embedding_dim"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("chunks_ws_company_idx").on(t.workspaceId, t.companyId),
    index("chunks_kind_idx").on(t.workspaceId, t.kind),
    index("chunks_hash_idx").on(t.workspaceId, t.textHash),
  ],
);

export const chatThreads = sqliteTable("chat_threads", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull().references(() => chatThreads.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    contextCompanyId: text("context_company_id"),
    citations: text("citations", { mode: "json" }),
    plan: text("plan", { mode: "json" }),
    costUsd: real("cost_usd"),
    latencyMs: integer("latency_ms"),
    firstTokenMs: integer("first_token_ms"),
    createdAt: ts("created_at"),
  },
  (t) => [index("chat_thread_idx").on(t.threadId, t.createdAt)],
);

/* ------------------------------ Reproducibility ------------------------------ */

/**
 * Cache of deterministic-input model calls (same model + prompt version +
 * schema + input ⇒ same output). Makes identical re-ingestion reproducible and
 * free. Research (web) calls are never cached.
 */
export const llmCache = sqliteTable("llm_cache", {
  key: text("key").primaryKey(),
  step: text("step").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  output: text("output", { mode: "json" }).notNull(),
  usage: text("usage", { mode: "json" }).notNull(),
  hits: integer("hits").notNull().default(0),
  createdAt: ts("created_at"),
});

/* ================================================================== */
/* Meetings workflow                                                  */
/*                                                                    */
/* Deck → PRE_MEETING_ANALYSIS (company_versions.stage) → PRE_MEETING_ */
/* BRIEF → founder meeting (transcript segments) → POST_MEETING_BRIEF */
/* → POST_MEETING_ANALYSIS_Vn (company_versions.stage). Briefs are    */
/* immutable rows; a meeting row only records workflow state and the  */
/* ids of the four objects it produced.                               */
/* ================================================================== */

/** One founder meeting on a deal. Distinct from the Fund Brain `meetings` table (partner/IC meetings). */
export const founderMeetings = sqliteTable(
  "founder_meetings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    /** 1, 2, … per company, in ingestion order. Each successfully processed meeting produces the next POST_MEETING_ANALYSIS_V{n}. */
    seq: integer("seq").notNull(),
    title: text("title").notNull(),
    heldAt: text("held_at").notNull(),
    participants: text("participants", { mode: "json" }).$type<{ name: string; role: string | null; side: "FUND" | "COMPANY" | "OTHER" }[]>().notNull(),
    source: text("source", { enum: ["PASTED_TRANSCRIPT", "TRANSCRIPT_FILE", "RECORDING_UPLOAD", "ZOOM", "GOOGLE_MEET"] }).notNull(),
    status: text("status", { enum: ["TRANSCRIBING", "PROCESSING", "READY", "FAILED"] }).notNull(),
    error: text("error"),
    runId: text("run_id"),
    transcriptDocumentId: text("transcript_document_id"),
    recordingDocumentId: text("recording_document_id"),
    /** Transcription provenance (recordings only). */
    transcription: text("transcription", { mode: "json" }).$type<{ model: string; diarized: boolean; chunks: number; durationSec: number | null; costUsd: number } | null>(),
    /** Display names for diarized speaker labels ("A" → "Maya Chen (CEO)"). Labels in segments are never rewritten. */
    speakerNames: text("speaker_names", { mode: "json" }).$type<Record<string, string>>().notNull(),
    /** Frozen at ingestion: the analysis version the founder was met against. */
    preAnalysisVersionId: text("pre_analysis_version_id").notNull(),
    preBriefId: text("pre_brief_id"),
    postBriefId: text("post_brief_id"),
    postAnalysisVersionId: text("post_analysis_version_id"),
    /** The post-meeting extraction (founder_call_update output) and the code guards applied to it — source of the "Founder said" / "Reason" columns. */
    extraction: text("extraction", { mode: "json" }).$type<{ promptVersion: string; model: string; output: unknown; guards: unknown[] } | null>(),
    createdBy: text("created_by"),
    createdAt: ts("created_at"),
  },
  (t) => [uniqueIndex("founder_meetings_seq_idx").on(t.companyId, t.seq), index("founder_meetings_ws_idx").on(t.workspaceId, t.createdAt)],
);

/** Verbatim transcript, one row per speaker turn. Timestamps are seconds from the start of the recording (null when the source had none). */
export const meetingSegments = sqliteTable(
  "meeting_segments",
  {
    id: text("id").primaryKey(),
    meetingId: text("meeting_id").notNull().references(() => founderMeetings.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    speaker: text("speaker"),
    startSec: real("start_sec"),
    endSec: real("end_sec"),
    text: text("text").notNull(),
  },
  (t) => [uniqueIndex("meeting_segments_idx").on(t.meetingId, t.idx)],
);

/** PRE_MEETING_BRIEF / POST_MEETING_BRIEF — immutable once written. */
export const meetingBriefs = sqliteTable(
  "meeting_briefs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["PRE_MEETING_BRIEF", "POST_MEETING_BRIEF"] }).notNull(),
    /** PRE: the PRE_MEETING_ANALYSIS (or current) version it was built from. POST: the POST_MEETING_ANALYSIS version. */
    versionId: text("version_id").notNull(),
    meetingId: text("meeting_id"),
    builderVersion: text("builder_version").notNull(),
    content: text("content", { mode: "json" }).notNull(),
    generation: text("generation", { mode: "json" }).$type<{ mode: "DETERMINISTIC" | "DETERMINISTIC_PLUS_MODEL"; model: string | null; promptVersion: string | null; costUsd: number; cached: boolean; fallbackReason: string | null }>().notNull(),
    createdBy: text("created_by"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("meeting_briefs_version_idx").on(t.versionId, t.kind),
    index("meeting_briefs_company_idx").on(t.companyId, t.createdAt),
    // One PRE_MEETING_BRIEF per (version, builder version): concurrent requests converge on the same row.
    uniqueIndex("meeting_briefs_pre_unique_idx").on(t.versionId, t.kind, t.builderVersion).where(sql`${t.kind} = 'PRE_MEETING_BRIEF'`),
  ],
);

/* ------------------------------ Meeting integrations (Zoom, Google Meet) ------------------------------ */
/*
 * Optional OAuth connections, one per (workspace, user, provider): only the
 * connecting user's tokens are ever used, and removing the member from the
 * workspace deletes them (composite FK → memberships, cascade). Tokens are an
 * AES-256-GCM blob (src/server/crypto.ts) whose plaintext also carries the row
 * binding; they are never logged, exported or sent to the browser.
 */

export const integrationConnections = sqliteTable(
  "integration_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["zoom", "google_meet"] }).notNull(),
    /** NEEDS_REAUTH: the refresh token was rejected; the user must connect again. */
    status: text("status", { enum: ["CONNECTED", "NEEDS_REAUTH"] }).notNull(),
    accountId: text("account_id"),
    accountEmail: text("account_email"),
    /** Scopes actually granted (space-separated), as reported by the token endpoint. */
    scopes: text("scopes").notNull(),
    tokens: blob("tokens", { mode: "buffer" }).notNull(),
    accessExpiresAt: text("access_expires_at"),
    refreshedAt: text("refreshed_at"),
    lastError: text("last_error"),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [
    uniqueIndex("integration_connections_user_idx").on(t.workspaceId, t.userId, t.provider),
    foreignKey({ columns: [t.userId, t.workspaceId], foreignColumns: [memberships.userId, memberships.workspaceId], name: "integration_connections_membership_fk" }).onDelete("cascade"),
  ],
);

/** Pending OAuth authorizations: single-use, 10-minute, bound to the browser session that started them. `id` = sha256(state). */
export const integrationOauthStates = sqliteTable(
  "integration_oauth_states",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["zoom", "google_meet"] }).notNull(),
    /** sha256 of the session id that started the flow. */
    sessionHash: text("session_hash").notNull(),
    /** PKCE code_verifier, encrypted. */
    verifier: blob("verifier", { mode: "buffer" }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    returnTo: text("return_to").notNull(),
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at"),
  },
  (t) => [
    index("integration_oauth_states_exp_idx").on(t.expiresAt),
    foreignKey({ columns: [t.userId, t.workspaceId], foreignColumns: [memberships.userId, memberships.workspaceId], name: "integration_oauth_states_membership_fk" }).onDelete("cascade"),
  ],
);

/** One row per imported recording / transcript (provenance, "already imported" and "last import"). */
export const integrationImports = sqliteTable(
  "integration_imports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    provider: text("provider", { enum: ["zoom", "google_meet"] }).notNull(),
    /** Zoom meeting UUID / Meet conference record name. */
    externalId: text("external_id").notNull(),
    /** Zoom recording file id / Meet transcript name. */
    itemId: text("item_id").notNull(),
    kind: text("kind", { enum: ["TRANSCRIPT", "AUDIO", "TRANSCRIPT_ENTRIES", "TRANSCRIPT_DOC"] }).notNull(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    meetingId: text("meeting_id").notNull(),
    title: text("title").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => [index("integration_imports_ext_idx").on(t.workspaceId, t.provider, t.externalId), index("integration_imports_user_idx").on(t.workspaceId, t.userId, t.provider, t.createdAt)],
);

/* ------------------------------ Formation (investor training) ------------------------------ */
/*
 * Deliberate practice on the workspace's real deals. Attempts belong to a USER
 * (not only a workspace). The answer columns are written once, before the
 * reveal, and never updated (the investor journal); only grade columns change
 * afterwards (src/formation/store.ts enforces it). `answer_hash` = sha256 of
 * the canonical answer payload + confidence + answered_at, for tamper evidence.
 * Skill ratings are not stored: they are a deterministic replay of the graded
 * attempts (src/formation/skill-model.ts).
 */

export const formationAttempts = sqliteTable(
  "formation_attempts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    kind: text("kind").notNull(),
    variant: text("variant").notNull(),
    skills: text("skills", { mode: "json" }).$type<string[]>().notNull(),
    difficulty: real("difficulty").notNull(),
    level: integer("level").notNull(),
    expert: integer("expert", { mode: "boolean" }).notNull().default(false),
    patterns: text("patterns", { mode: "json" }).$type<string[]>().notNull(),
    /** Full exercise snapshot (public part + key) as generated when the answer was stored. */
    exercise: text("exercise", { mode: "json" }).notNull(),
    /** Immutable: the user's answer and stated confidence (0–1), written before the reveal. */
    answer: text("answer", { mode: "json" }).notNull(),
    confidence: real("confidence").notNull(),
    answeredAt: ts("answered_at"),
    answerHash: text("answer_hash").notNull(),
    /** Grade (written after the answer; may be re-written by a regrade). */
    status: text("status", { enum: ["ANSWERED", "GRADED", "GRADE_FAILED"] }).notNull().default("ANSWERED"),
    grade: text("grade", { mode: "json" }),
    score: real("score"),
    correct: integer("correct", { mode: "boolean" }),
    gradeMethod: text("grade_method"),
    gradeCostUsd: real("grade_cost_usd").notNull().default(0),
    gradedAt: text("graded_at"),
  },
  (t) => [
    index("formation_attempts_user_idx").on(t.workspaceId, t.userId, t.answeredAt),
    index("formation_attempts_company_idx").on(t.companyId, t.answeredAt),
    index("formation_attempts_exercise_idx").on(t.userId, t.exerciseId),
  ],
);

/** Private mistake library: one row per classified mistake, with its evidence. */
export const formationMistakes = sqliteTable(
  "formation_mistakes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").notNull().references(() => formationAttempts.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    kind: text("kind").notNull(),
    evidence: text("evidence").notNull(),
    createdAt: ts("created_at"),
  },
  (t) => [index("formation_mistakes_user_idx").on(t.workspaceId, t.userId, t.kind), uniqueIndex("formation_mistakes_attempt_kind_idx").on(t.attemptId, t.kind)],
);

/* ------------------------------ Human feedback (evaluation §129) ------------------------------ */
/*
 * Measured usefulness, never asserted. Rows are written by people (or, for
 * `source = MEETING`, recorded when a founder meeting answered the question)
 * and summarized read-only on /quality. One row per (version, question, user):
 * a later answer from the same user replaces the earlier one.
 */

/** "Was this founder question useful?" — per question, per analysis version. */
export const questionFeedback = sqliteTable(
  "question_feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    /** Q-01 … within that version. */
    questionId: text("question_id").notNull(),
    /** Snapshot of the question text (ids are per version). */
    questionText: text("question_text").notNull(),
    tier: text("tier").notNull(),
    verdict: text("verdict", { enum: ["USEFUL", "NOT_USEFUL", "ALREADY_KNOWN"] }).notNull(),
    note: text("note"),
    /** MANUAL (any time) · AFTER_MEETING (given from a founder meeting context). */
    source: text("source", { enum: ["MANUAL", "AFTER_MEETING"] }).notNull(),
    meetingId: text("meeting_id"),
    userId: text("user_id").notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [uniqueIndex("question_feedback_unique_idx").on(t.versionId, t.questionId, t.userId), index("question_feedback_ws_idx").on(t.workspaceId, t.createdAt)],
);

/** Per-analysis utility feedback: what the analysis surfaced and the preparation time it saved. */
export const analysisFeedback = sqliteTable(
  "analysis_feedback",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    betterQuestions: integer("better_questions", { mode: "boolean" }).notNull(),
    importantRisks: integer("important_risks", { mode: "boolean" }).notNull(),
    missingEvidence: integer("missing_evidence", { mode: "boolean" }).notNull(),
    marketInsight: integer("market_insight", { mode: "boolean" }).notNull(),
    /** Preparation time saved, minutes (negative = cost time); null = not stated. */
    minutesSaved: integer("minutes_saved"),
    note: text("note"),
    userId: text("user_id").notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (t) => [uniqueIndex("analysis_feedback_unique_idx").on(t.versionId, t.userId), index("analysis_feedback_ws_idx").on(t.workspaceId, t.createdAt)],
);
