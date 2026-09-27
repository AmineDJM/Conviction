# Architecture

## Principle

**AI interprets. Code calculates.** Two layers, never mixed:

| Layer A — deterministic (`src/engine`) | Layer B — reasoning model (`src/ai`, `src/orchestration`) |
|---|---|
| Metric dictionary, normalization, derivations | Understanding, extraction, classification |
| Benchmark registry, scoring, coverage and bounds | Adaptive research planning and execution |
| Cap table, waterfall, ownership, dilution, MOIC, IRR | Founder, product, market, competition analysis |
| Backwards return, price sensitivity, financing map | Thesis, exceptional strength, falsification, red team |
| Mandate gates, fund fit, risk map, decision gates | Questions, next best action, explanations |
| Version control, cost control | Fund Brain answers |

The model never computes ownership, returns, scores or benchmarks. It supplies facts, anchored ratings and assumptions; code does the arithmetic and decides which recommendation statuses are admissible.

## Source-of-truth hierarchy

1. Raw documents (`documents`, `document_pages`, files on disk)
2. Extracted structured evidence (`canonical.metricObservations`, `claims`, `sources`)
3. Canonical metrics (`canonical.metrics`, normalized and derived by code)
4. Benchmark calculations (`derived`, computed by `engine/derive.ts`)
5. Investment interpretation (model-authored sections of the canonical object)
6. Generated reports (rendered from 1–5; never used as source data)

## Canonical investment object

`src/domain/canonical.ts` (zod). One validated JSON document per company version (`company_versions.canonical`) plus the deterministic `derived` snapshot scored under a named registry version. Every change — analysis, research, founder call, metric correction, question update, decision, benchmark recalculation — creates a new version; historical scores are never rewritten.

Evidence is multi-dimensional per claim: origin, verification, freshness, independence (with independence groups so that five articles repeating one press release count once). Verification is **computed** from evidence links (`orchestration/assemble.ts#recomputeVerification`): a claim is VERIFIED only with a retrieved, non-company primary source or two independent origins. A cited URL that was not among the search tool's retrieved results is marked as an unverified citation.

## Scoring (`engine/scoring`)

- Peer group = operational profile × stage band, resolved from the independent classification axes.
- Each dimension aggregates components (metric benchmarks, anchored rubric ratings, reconstructed market size, founder capabilities). Output: `value` (observed-only), `lower` (missing = 0), `upper` (missing = 100), `coverage`, status `SCORED / PARTIAL / NOT_SCORABLE`. Weights are never redistributed silently; decision gates use the bounds, so withholding weak evidence cannot improve the outcome.
- Registry `VC_BENCHMARK_V1_0` ships no observed distributions, so no percentiles are displayed. Benchmark types are explicit: OBSERVED_DISTRIBUTION, INVESTOR_TARGET, INTERNAL_POLICY, MODEL_ASSUMPTION, UNAVAILABLE.
- Operating Quality, Evidence, Power-law, Fund fit and Risk are separate outputs. None is a probability.

## Analysis pipeline (`orchestration/pipeline.ts`)

1. **deck_understanding_v1** — understanding, classification, metric observations, claims, financing, gaps (text layer; multimodal file/image input when there is none).
2. Preliminary version saved (UI shows understanding early).
3. **research_v1** ×2 in parallel (company/founders/claims; market/competitors), budgeted web search, stopping rule for low-value questions, skipped when the deal fails a mandate gate.
4. **investment_analysis_v1** — founders (capabilities), product, pain, PMF, market reconstruction inputs, competition, moat, GTM, financing path, risks, rubric, exit assumptions.
5. Deterministic layer (scores, returns, backwards return, financing map, fund fit, gates).
6. **red_team_v1** — exceptional strength, nonlinear outcome, thesis, falsification, symmetric red team, decision-tested questions, next best action, suggested status.
7. Final version + **Fund Brain indexing**.

Budget: `ai/cost.ts`. Each call is authorized with a worst-case estimate (input tokens, max output tokens, web searches) before it runs; parallel calls hold in-flight reservations; mandatory later steps are reserved up front. When the cap would be exceeded the step is skipped and the analysis is labelled **PARTIAL** with the research not completed. Actual costs are recorded per call (`cost_records`).

Structured outputs: every pass returns strict JSON schema output validated with zod, with bounded retries. Responses are streamed (SSE) and reassembled, which avoids idle timeouts on proxies during long reasoning.

Security: documents and web pages are untrusted. They are passed in a separate message inside random-boundary data envelopes; privileged instructions live only in `instructions`. The model has no tools that act on the system; outputs are data. Instruction-like text is detected (model + regex) and shown as a security flag.

## Fund Brain (`src/brain`)

*Heavy intelligence at ingestion, lightweight intelligence at conversation time.*

At ingestion (after every version): a compact **Deal Memory Pack**, `metric_facts` for structured queries, an entity graph (founders, prior employers, competitors, investors, markets, customers), and retrieval chunks (pages, claims, sources, analysis sections, risks, questions, memo) with embeddings (`text-embedding-3-small`, 512-d). Unchanged text is never re-embedded (hash reuse). Fund knowledge, IC members, observations and meetings are indexed the same way.

At question time:
1. Deterministic mention resolution (companies, founders, IC members) and speculative prefetch of memory packs.
2. A small planner call (reasoning effort `none`) returns a retrieval plan: intent, company ids, metric filters, ranking, semantic query, lexical terms, chunk kinds, fund-memory and history needs, complexity.
3. Retrieval runs in parallel: SQL over facts and company projections, memory packs, FTS5 (bm25), exact cosine search, graph, fund memory, decision history; passages are fused with reciprocal rank fusion.
4. The answer streams with numbered citations linking to the deal, the claim or the source; reasoning effort scales with complexity (`none` / `low` / `medium`).

IC members: DOCUMENTED (written preferences), OBSERVED (quotes extracted from recorded meetings — kept only when the quote is found verbatim in the transcript), INFERRED (patterns, labelled). Without records the Brain says it does not know.

## Storage and deployment

SQLite (WAL) via Drizzle with SQL migrations in `drizzle/` (including the FTS5 table and triggers), applied at startup. Files are stored per workspace under `STORAGE_DIR`. Every query is scoped by workspace; sessions are server-side with HMAC-signed cookies; audit log for sensitive actions; permanent deletion removes documents, versions, memory and files.

Render: one web service plus a persistent disk (`render.yaml`). To scale beyond one instance, move to Postgres (pgvector for embeddings, `tsvector` for lexical search) and a job queue for analyses; the repository layer isolates those changes.

## Directory map

```
src/domain         canonical object, enums, fund profile (zod)
src/engine         metric dictionary, benchmark registry, scoring, calc, returns, financing, fund, risk, decision
src/ai             Responses client, cost controller, pricing, prompt modules, untrusted-content policy
src/ingestion      PDF / PPTX / image extraction
src/orchestration  pipeline, assembly of model outputs into the canonical object, context serializers
src/brain          memory packs, indexer, vectors, retrieval, chat orchestrator
src/server         repositories, auth, sessions, storage, recalculation, fund memory
src/reports        deterministic report renderers
src/app            Next.js routes (pages + API)
tests/             unit tests (deterministic guarantees)
evals/             LLM-level evaluations on fictional decks
```
