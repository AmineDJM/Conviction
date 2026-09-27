/**
 * Relational schema (SQLite via better-sqlite3 + Drizzle).
 *
 * The canonical investment object is versioned as a validated JSON document
 * (company_versions.canonical). Query-critical projections are materialized
 * into relational tables at write time (metric_facts, entities, relations,
 * chunks) so the Fund Brain can answer with structured queries first.
 */
import { sqliteTable, text, integer, real, blob, index, uniqueIndex, primaryKey } from "drizzle-orm/sqlite-core";

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
      enum: ["DECK_ANALYSIS", "RESEARCH", "FOUNDER_CALL", "METRIC_CORRECTION", "BENCHMARK_RECALC", "QUESTION_UPDATE", "STATUS_CHANGE", "FUND_PROFILE_CHANGE"],
    }).notNull(),
    summary: text("summary"),
    createdBy: text("created_by"),
    createdAt: ts("created_at"),
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
    scope: text("scope", { enum: ["ANALYSIS", "CHAT", "EMBEDDING"] }).notNull(),
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
  },
  (t) => [index("entities_norm_idx").on(t.workspaceId, t.normName), uniqueIndex("entities_unique_idx").on(t.workspaceId, t.type, t.normName)],
);

export const relations = sqliteTable(
  "relations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    fromEntity: text("from_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    toEntity: text("to_entity").notNull().references(() => entities.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: ["FOUNDED", "WORKED_AT", "COMPETES_WITH", "INVESTED_IN", "OPERATES_IN", "CUSTOMER_OF", "SIMILAR_TO"],
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
