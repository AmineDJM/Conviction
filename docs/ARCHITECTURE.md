# Architecture

## Principle

**AI interprets. Code calculates.** Two layers, never mixed:

| Layer A — deterministic (`src/engine`) | Layer B — reasoning model (`src/ai`, `src/orchestration`) |
|---|---|
| Metric dictionary, normalization (chronology basis, lineage), derivations | Triage, extraction, classification |
| Benchmark registry, scoring, coverage and bounds | Adaptive research planning and execution |
| Pro-forma cap table: pool, prior preferred, SAFE/note conversion, follow-on, waterfall, MOIC, IRR | Founder, product, market, competition analysis |
| Required trajectory, sensitivity breakpoints, counterfactuals, financing map | Thesis, exceptional strength, falsification, independent challenge |
| Deck integrity (implied metrics, cross-slide, chronology, expected evidence, evidence debt) | Deck forensics (visuals, narrative architecture) |
| Latent signals, decision focus, portfolio intelligence, INFERRED fund patterns | Latent-signal observations, causal model, questions, next best action |
| Mandate gates, fund fit, risk map, decision gates | Fund Brain explanations |
| Version control, provenance, cost control, reproducibility cache | |

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

## Analysis pipeline (`orchestration/pipeline.ts`, v3)

Measured on the fictional Ledgerline deck (STANDARD, FULL depth): **88 s, $0.166** (v2: 220 s).

```
T0  triage ‖ extract metrics ‖ extract claims ‖ extract profile ‖ deck forensics (visual) ‖ latent signals
      └─ research company ‖ research market ‖ research competition   (start as soon as triage lands)
T1  analysis A1 ‖ A2 ‖ B1 ‖ B2 ‖ B3 ‖ thesis ‖ independent challenge ‖ actions   (on the record + deterministic layer)
T2  deterministic layer → immutable version → Fund Brain index
```

- Output tokens drive wall-clock, so no call is large: the analysis runs as five parts that each own their sections and rubric criteria; the thesis and the red team/alternative explanations are separate calls (the challenger never sees the bet).
- A preliminary version is saved as soon as the company is identified (~15 s) and again after extraction.
- **Cancellation**: every call and phase boundary observes an AbortController (`run-control.ts`); a cancelled run keeps a labelled PARTIAL version. **Queue**: at most `MAX_CONCURRENT_ANALYSES` (default 4) run at once; the rest wait (load-tested at 20 concurrent with a mock model server: 0 failures, 0 duplicates).
- **Reproducibility**: identical inputs hit `llm_cache` (key = model + prompt version + schema + instructions + input + effort). Every version records its provenance: model, all prompt versions, engine / dictionary / schema versions, input hash, duration.
- **Idempotent ingestion** (`server/analyze.ts`): the same documents + mode + versions already analysed in full return the existing analysis; a re-upload during a run returns that run; otherwise the same company is re-analysed, reusing its documents and carrying over human overrides. The check-to-run section is synchronous, so concurrent identical uploads cannot create two companies.

Budget: `ai/cost.ts`. Each call is authorized with a worst-case estimate before it runs; parallel calls hold in-flight reservations; T1 calls and indexing are reserved up front so research cannot starve them. When the cap would be exceeded the step is skipped and the analysis is labelled **PARTIAL**. Actual costs are recorded per call (`cost_records`).

Structured outputs: strict JSON schema validated with zod, bounded retries on 408/409/429/5xx (honouring `retry-after`), streamed (SSE) to avoid proxy idle timeouts.

Security: documents, web pages and transcripts are untrusted and travel in random-boundary data envelopes; privileged instructions live only in `instructions`; the model has no tools that act on the system. Instruction-like text is flagged by the model and by `ai/untrusted.ts#detectInjection`, which matches normalized variants (Unicode NFKC, zero-width characters, whitespace, leetspeak, letter-spacing, fake role markup) in EN/FR/ES/DE/IT/PT/ZH and requires imperative or AI-addressed forms so ordinary deck sentences are not flagged.

## Returns — one model everywhere

Headline scenarios (`derived.returns.scenarios`) come from the pro-forma cap-table engine (`engine/economics`): option-pool top-up and refresh, prior preferred at an inferred price, SAFE/note conversion, our follow-on on its own round's terms and the full preference waterfall. The interactive returns view runs the same function in the browser (`engine/unified-returns.ts`), so memos, compare, portfolio, chat and the page never disagree. The simplified model is kept only for comparison. The economics report adds the required trajectory (e.g. "at $42M post, what must be true to return 20× our capital"), sensitivity breakpoints sorted by margin, and counterfactuals (CAC ×2, next round +12 months, entry ×2, model-provider commoditisation, incumbent bundles free, custom shocks).

## Decision focus (`engine/focus`)

Out of everything in the record, which few items decide the investment? Each candidate (computed breakpoints, benchmarked metrics, material claims, open gaps, risks, fund gates) gets a Decision Leverage Index = 100 × impact × (0.4 + 0.6 × uncertainty); a failed mandate gate is binding. Output: 5 determinants out of N considered, ≤ 2 outlier candidates (top of a benchmark curve — never presented as a percentile — or an exceptional strength rated on evidence; never manufactured), the open question most tied to the determinants, and agreement/disagreement with the model's own decision core. Attention ranking only; never a probability, never a score input.

## Fund Brain (`src/brain`)

*Heavy intelligence at ingestion, lightweight intelligence at conversation time.*

At ingestion (after every version): a compact **Deal Memory Pack**, `metric_facts` for structured queries, an entity graph (founders, prior employers, competitors, investors, markets, customers), and retrieval chunks (pages, claims, sources, analysis sections, risks, questions, memo) with embeddings (`text-embedding-3-small`, 512-d). Unchanged text is never re-embedded (hash reuse). Fund knowledge, IC members, observations and meetings are indexed the same way.

At question time (measured first token on the Ledgerline record):
1. Deterministic mention resolution (companies incl. homonyms → most recent dossier, said explicitly; founders; IC members).
2. **Fast path** (~80 ms, no model): a single fact about a single deal is read from the same canonical record the views render, with status, period, source, caveats — or « On ne sait pas encore », whether it is withheld, related metrics, the open gap and the founder question.
3. **Direct plan** for single-deal questions (no planner round-trip, ~1–2.5 s); planner call (effort `none`) otherwise.
4. **Computations**: trajectory and counterfactual questions are computed by the economics engine and handed to the model as COMPUTED context (~0.8 s first token); the model explains, never calculates.
5. **IC pre-mortem** ("why could this die at the fund, who challenges it, on which variable"): fragile variables from the record × members' DOCUMENTED preferences and OBSERVED statements; members with nothing recorded are marked so no view is attributed (~1.1 s).
6. Retrieval in parallel (SQL over facts, memory packs, FTS5 bm25, exact cosine, graph, fund memory, history; reciprocal rank fusion), streamed answer with numbered citations.

IC members and fund memory: DOCUMENTED (written preferences; fund documents imported with a verbatim quote that code finds in the document — anything else is dropped), OBSERVED (quotes extracted from recorded meetings, kept only when found verbatim), INFERRED (`brain/patterns.ts`: deterministic associations over observations and IC decisions with counts, minimum samples and thresholds — "raised retention in 4 of 6 recorded interventions" — recomputed when the record changes; never a stated preference). Without records the Brain says it does not know.

## Quality & Reliability (`/quality`)

Measured numbers only: evaluation accuracy (latest `evals/run.ts` full run, versioned in `evals/latest.json`), evidence integrity over current versions (verified claims with an independent retrieved source, retrieved web citations, verification / unknown / contradiction / human-correction rates, integrity findings per deal), analysis runs (cost, P50/P95 latency, failure and partial rates, per mode) and Fund Brain (time to first token, share answered without a model call). Unmeasured values say so.

## Storage and deployment

SQLite (WAL, `BEGIN IMMEDIATE` transactions) via Drizzle with SQL migrations in `drizzle/`, applied at startup after a verified pre-migration backup. Daily online backups with retention, tested restore, owner export (ZIP). Documents are encrypted at rest (AES-256-GCM) on local disk or any S3-compatible store. Every query is scoped by workspace; members and roles; server-side sessions with HMAC-signed cookies; audit log; permanent deletion removes documents, versions, memory and files; a consistency checker verifies projections against versions.

Render: one web service plus a persistent disk (`render.yaml`). To scale beyond one instance, move to Postgres (pgvector for embeddings, `tsvector` for lexical search) and a job queue for analyses; the repository layer isolates those changes.

## Directory map

```
src/domain         canonical object, enums, fund profile (zod)
src/engine         metric dictionary, benchmark registry, scoring, calc, returns, economics (cap table, trajectory,
                   sensitivity, counterfactuals), integrity, latent, focus, portfolio, financing, fund, risk, decision
src/ai             Responses client, cost controller, pricing, prompt modules, untrusted-content policy
src/ingestion      PDF / PPTX / image extraction
src/orchestration  pipeline, assembly of model outputs into the canonical object, context serializers
src/brain          memory packs, indexer, vectors, retrieval, chat orchestrator
src/server         repositories, auth, sessions, storage, recalculation, fund memory
src/reports        deterministic report renderers
src/app            Next.js routes (pages + API)
tests/             unit + adversarial tests (deterministic guarantees; ~1,400 cases)
evals/             LLM-level evaluations on fictional decks
```
