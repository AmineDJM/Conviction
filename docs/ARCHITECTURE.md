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

The model never computes ownership, returns, scores or benchmarks. It suggests a status among those its mode admits (with explicit calibration: a call only if the company could return the fund at this price and a conversation can resolve the decisive uncertainty; a pass when the record already answers it; unverified is never disproven); SCREEN_OUT is reserved to code gates (mandate, quality floor). It supplies facts, anchored ratings and assumptions; code does the arithmetic and decides which recommendation statuses are admissible.

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
- **Measured PMF** (`engine/scoring/measured-pmf.ts`): PMF signal quality is computed from measured signals (NRR, GRR, logo retention, pilot-to-production, D30 retention, repeat rate — each on its benchmark curve). The rating is the lower median over the signals the peer group is *expected* to report (3–4 depending on the profile); a missing, stale or undated signal counts at the bottom, so too few measured signals means Insufficient evidence (the model's view stays in the explanation, never in the score). A small or unknown sample caps the rating at Adequate. Property-tested over every subset of the six signals: removing a signal never raises the rating.
- **Maturity is anchored on measured revenue** (`engine/scoring/maturity.ts`, `maturity_anchor_v1`): with a current ARR or TTM revenue, code sets the operating maturity ($1M PMF_EMERGING, $10M SCALED_GTM, $50M GROWTH); the model's label is kept only without measured revenue, and an analyst override wins. Maturity decides which components are meaningful, so two decks with identical metrics are scored identically. Measured PMF expects only the signals the registry scores at that stage band and maturity.
- **Team ratings need more than the company's word**: FOUNDER_MARKET_FIT and TEAM_COMPLETENESS above ADEQUATE require a cited claim that is verified or independent; otherwise capped (and said) — pedigree cannot lift the Team score.
- **Missing data never helps**: an undisclosed sample size gets the small-sample credit, an undated metric the stale credit; neither can be an outlier candidate. The exceptional-strength override is tested on the power-law *lower* bound, so withholding the valuation cannot bypass a gate. A rejected bottom-up market is not replaced by a larger top-down range for scoring.
- **Normalization guards**: ARR tagged monthly is annualized only when its own words state a monthly amount; label rules fix neighbouring keys (gross logo retention, paid vs completed pilots, partner-channel share, listing fill rate); revenue equal to GMV in a take-rate business is kept but CONTRADICTED and net revenue is estimated as GMV × take rate; a broad figure (ARR incl. signed-not-live contracts — also detected arithmetically as live + contracted ARR — or customers incl. pilots) loses to the narrower figure, and paying customers are computed from a stated breakdown (total − stated pilots, design partners, trials); a total since inception, or its undated twin, is never a current run-rate; scale words (millions, Md, MEUR, k€) and currency symbols are read, a 1000× scale ambiguity keeps the model's value (flagged); durations are converted once; growth and burn multiple are annualized over 10–14-month gaps; named months (EN/FR) and fiscal years parse, impossible dates are rejected. Headcount is the whole company only ("7 AEs", "a sales team of 5" are sub-team counts and are not a headcount); a market figure above $2T, or a per-customer spend above $25M that is really a total, is rejected or reinterpreted, never scored.

## Analysis pipeline (`orchestration/pipeline.ts`, v3)

Measured on fresh databases (engine 3.2): **STANDARD, Ledgerline (FULL depth) 83 s, $0.23**; **FAST_SCREEN, Crateroute 58 s, $0.074** (v2: 220 s).

```
T0  triage ‖ extract metrics ‖ extract claims (two page ranges from 8 pages) ‖ extract profile
      ‖ deck forensics (visual, on the file) ‖ deck forensics (narrative, on the text) ‖ latent signals ‖ divergence signals
      └─ research company ‖ research market ‖ research competition   (start as soon as triage lands)
T1  analysis A1 ‖ A2 ‖ B1 market ‖ B2 financing path, exits ‖ B3 competition, moat ‖ B4 risks
      ‖ decision core ‖ thesis ‖ independent challenge ‖ machine ‖ next proof   (on the record + deterministic layer)
T2  deterministic layer → immutable version → Fund Brain index
```

- Output tokens drive wall-clock, so no call is large: the analysis runs as six parts that each own their sections and rubric criteria; the decision core (the bet in one paragraph), the thesis body, the red team/alternative explanations (the challenger never sees the bet), the value-creation machine and the next proof are separate calls merged by code. The decision core is mandatory: without it the version is PARTIAL.
- A preliminary version is saved as soon as the company is identified (~15 s) and again after extraction.
- **Cancellation**: every call and phase boundary observes an AbortController (`run-control.ts`); a cancelled run keeps a labelled PARTIAL version. **Queue**: at most `MAX_CONCURRENT_ANALYSES` (default 4) run at once; the rest wait (load-tested at 20 concurrent with a mock model server: 0 failures, 0 duplicates).
- **Reproducibility**: identical inputs hit `llm_cache` (key = model + prompt version + schema + instructions + input + effort). Every version records its provenance: model, all prompt versions, engine / dictionary / schema versions, input hash, duration.
- **Idempotent ingestion** (`server/analyze.ts`): the same documents + mode + versions already analysed in full return the existing analysis; a re-upload during a run returns that run; otherwise the same company is re-analysed, reusing its documents and carrying over human overrides. The check-to-run section is synchronous, so concurrent identical uploads cannot create two companies.

Budget: `ai/cost.ts`. STANDARD targets $0.25 under a hard cap of $0.50 (not configurable); FAST_SCREEN targets $0.08 under $0.15. Each call is authorized with a worst-case estimate before it runs; parallel calls hold in-flight reservations; in STANDARD and DEEP_DD the T1 calls and indexing are reserved up front so research cannot starve them (FAST_SCREEN runs no research, so nothing is pre-reserved); research has its own ceiling per mode. When the cap would be exceeded the step is skipped and the analysis is labelled **PARTIAL**. Actual costs are recorded per call (`cost_records`).

Structured outputs: strict JSON schema validated with zod, bounded retries on 408/409/429/5xx (honouring `retry-after`), streamed (SSE) to avoid proxy idle timeouts.

Security: documents, web pages and transcripts are untrusted and travel in random-boundary data envelopes; privileged instructions live only in `instructions`; the model has no tools that act on the system. Instruction-like text is flagged by the model and by `ai/untrusted.ts#detectInjection`, which matches normalized variants (Unicode NFKC, zero-width characters, whitespace, leetspeak, letter-spacing, fake role markup) in EN/FR/ES/DE/IT/PT/ZH and requires imperative or AI-addressed forms so ordinary deck sentences are not flagged.

## Deck versions, duplicates and analyst overrides (`server/analyze.ts`, `server/deck-versions.ts`, `server/company-merge.ts`, `engine/override-*.ts`)

- **Deck v1 → v2 → v3 on the same company.** From a deal, "New deck version" analyses the upload on that company (`documents.deck_version`, `supersedes_document_id`, set once at insert; documents stored before this are resolved as v1 at read time); "Add documents" re-analyses the current deck with the new files. Versions keep reason `DECK_ANALYSIS`, so the stage is `PRE_MEETING_ANALYSIS`, or `DECK_REANALYSIS` once a founder meeting exists.
- **What changed since the last deck** = `engine/latent/deck-diff.ts` on the stored analyses of two consecutive decks (raw canonicals restricted to deck-sourced claims; overrides excluded): restated / updated numbers (a metric keyed from the dictionary in one deck and as a free label in the other is matched on its label, so it is compared rather than reported as both removed and added), metrics no longer reported, market and round changes, logos, milestones hit / missed, what the founder stopped talking about. Shown on the overview and in History, summarised in the memory pack and handed to chat as COMPUTED context.
- **Duplicates are asked, never merged silently.** The deal header shows one consistent view of "same company" signals: a company already offered for merge is not repeated as an unconfirmed link, and a company the user confirmed as different is never shown as linked. `engine/company-match.ts` (name, website domain via `engine/web-domain.ts` — hosting platforms keep the full host — and founders; homonyms with a different domain or disjoint founders are "likely a different company"). The upload page asks before starting (file name + URL); after triage the newer dossier shows "possible duplicate of X" with *Merge into X as new deck version* (re-analyses its documents on X; the duplicate is soft-deleted with `merged_into_id`, kept for audit, redirects to X, its Fund Brain memory removed) or *Different company* (remembered on both sides).
- **One correction model: overrides.** Each override stores a stable anchor (metric key + period + basis; claim statement / proposition hash; field path). Re-analysis re-anchors carried overrides deterministically (`engine/override-carry.ts`); an override whose target is not found (e.g. a different period in the new deck, an ambiguous match) is kept as `UNANCHORED`, reported on the overview, in the overrides panel and in History, and never applied — never silently dropped, never applied to whatever reuses its old id. The old "Correct this metric" route now records an override; stored `USER_CORRECTED` instances are upgraded to overrides on read (same value, author, note, date; effective deal and scores unchanged).

## Returns — one model everywhere

Headline scenarios (`derived.returns.scenarios`) come from the pro-forma cap-table engine (`engine/economics`): option-pool top-up and refresh, prior preferred at an inferred price, SAFE/note conversion, our follow-on on its own round's terms and the full preference waterfall. The interactive returns view runs the same function in the browser (`engine/unified-returns.ts`), so memos, compare, portfolio, chat and the page never disagree. The simplified model is kept only for comparison. The economics report adds the required trajectory (e.g. "at $42M post, what must be true to return 20× our capital"), sensitivity breakpoints sorted by margin, and counterfactuals (CAC ×2, next round +12 months, entry ×2, model-provider commoditisation, incumbent bundles free, custom shocks).

## Refresh only stale data (`engine/refresh.ts`, `orchestration/refresh.ts`)

"Refresh stale sources (N)" on the Evidence and Integrity tabs. Code selects the items (`refresh_policy_v1`): material claims whose evidence is STALE (> 18 months) or AGING (> 9) at the reference date — an undated deck statement is dated by the deck, a newer confirming source makes a claim current; web sources older than 18 months, or undated and retrieved > 9 months ago, still backing a material claim; primary metrics flagged STALE; open PUBLIC_WEB questions researched > 3 months ago. Items re-checked < 30 days ago are deferred (said), at most 12 per refresh, company-reported figures with no web trace last. One budgeted call (`research_refresh_v1`, default cap $0.06, `REFRESH_BUDGET_USD`) researches exactly those items; code discards anything else, turns "nothing newer found" into NOT_FOUND (never evidence), applies the rest through `applyResearch` (verification recomputed from evidence links, freshness recomputed for the touched claims, newer information as a new claim that supersedes the old one), logs the refresh in `analysis.refreshes` and commits a new version (`RESEARCH_REFRESH`) + history + audit + re-index. Tracked as a `RESEARCH` run, cancellable. Nothing stale → no run, no call. Measured on Ledgerline: 3 items, 18 s, $0.026; 12 items (reference date +12 months), 11 s, $0.026.

## Decision focus (`engine/focus`)

Out of everything in the record, which few items decide the investment? Each candidate (computed breakpoints, benchmarked metrics, material claims, open gaps, risks, fund gates) gets a Decision Leverage Index = 100 × impact × (0.4 + 0.6 × uncertainty); a failed mandate gate is binding. Calibration keeps the ranking discriminating: a gap's impact is capped at 0.75 × its importance unless it is anchored to a computed breakpoint or a thesis killer, ties are broken by kind, and only upside metrics (growth, retention, efficiency) can be outlier candidates — hygiene metrics never are. Output: 5 determinants out of N considered, ≤ 2 outlier candidates (top of a benchmark curve — never presented as a percentile — or an exceptional strength rated on evidence; never manufactured), the open question most tied to the determinants, and agreement/disagreement with the model's own decision core. Attention ranking only; never a probability, never a score input.

## Divergence factors (`engine/divergence`)

Ten factors that explain why lookalike startups diverge: founder ambition ceiling, cap-table health and incentive alignment, syndicate quality (behaviour, never brand), strategic survivability (a 24-month slowdown test), market structure (not size), dependency surface, land → expand → platform, organizational focus, compounding-loop strength, scalability architecture. A T0 model pass reports observable evidence with pages; one deterministic module per factor applies explicit rules (founder ownership through the pro-forma path, slowdown arithmetic, dependency danger = criticality × substitutability × switching time, ceiling per customer…). Ordinal levels with coverage; no blended score; never an input to the Operating Quality Index (tested, as are brand and market-size invariance).

## Founder meeting workflow (`server/meetings.ts`, `reports/meeting-*.ts`)

Four separate immutable objects per meeting: **PRE_MEETING_ANALYSIS** (the deck analysis version, frozen when the meeting is added), **PRE_MEETING_BRIEF** (built by code; one optional capped call rephrases objectives), **POST_MEETING_BRIEF** (discussed, new, clarified, confirmed, contradicted, unanswered, what changed, next action — each item anchored to transcript turns), **POST_MEETING_ANALYSIS_Vn** (guarded re-evaluation: founder statements stay COMPANY_REPORTED, ratings move at most one notch up and never to Exceptional, risk severity never lowered, unanchored items not applied). "What changed after the meeting?" is a code-computed Before / Founder said / After / Reason diff. Ingestion: pasted or uploaded transcripts (VTT, SRT, timestamped, notes) and recordings (diarized transcription, chunked, cost-capped); **Import from Zoom / Google Meet** when the server has OAuth credentials: each member connects their own account (authorization code + PKCE, single-use session-bound state, tokens encrypted per member, refreshed single-flight, revoked on disconnect or when the member is removed); the transcript is preferred over audio. The workflow works entirely without integrations. Setup: README → Integrations.

## Formation (`src/formation`, `/formation`)

Deliberate practice on the fund's real deals. Learn before reveal: the pre-answer payload is whitelisted (deck-reported facts only — tested never to contain an answer key), the answer and confidence are stored once with a hash before the reveal (investor journal). Exercises: non-trivial multiple choice from the deal's own numbers, numerical exercises computed by the engines (runway, ownership, dilution, exit value for 20×…), deck forensics keyed on integrity findings, three-questions-for-the-founder scored on information gain, decision, bull/bear, outlier detection. Skill model: Glicko-1 per skill (18 skills), selection toward ~60 % expected success so difficulty rises; weaknesses only from repeated evidence (≥ 4 opportunities, Beta posterior); private mistake library with targeted drills; calibration (Brier, reliability curve); development tendencies only above minimum samples. No points, streaks or confetti. Open answers are graded by one capped model call with a rubric (heuristic fallback, labelled).

## Deep DD report (`reports/deep-dd.ts`, `/deals/[slug]/deep-dd`)

The full due-diligence dossier a partner takes to IC, with its diligence work plan (`reports/deep-dd-workplan.ts`): ordered, deduplicated workstreams of concrete requests drawn only from the stored record — thesis-killing risks, fund gates, computed breakpoints, open gaps, verification priority, evidence debt, integrity findings, open must-ask questions — ranked by the stored indices (decision leverage, verification and research priority); cost and time are not computable from the record and are never shown. Deterministic, no model call: every number is read from one stored version's canonical and derived records and carries its record or engine reference, so it never diverges from the other views; every section states its evidence status and what is unknown. Web reader, print and Markdown.

## Fund Brain (`src/brain`)

*Heavy intelligence at ingestion, lightweight intelligence at conversation time.*

At ingestion (after every version): a compact **Deal Memory Pack**, `metric_facts` for structured queries, an entity graph (founders, prior employers, competitors, investors, markets, customers), and retrieval chunks (pages, claims, sources, analysis sections, risks, questions, memo) with embeddings (`text-embedding-3-small`, 512-d). Unchanged text is never re-embedded (hash reuse). Fund knowledge, IC members, observations and meetings are indexed the same way.

**Entity resolution** (`brain/entities.ts`, `entity_resolution_v1`; `entities.resolution_key`). People are keyed by name + company and merged across companies only on strong evidence (same public profile URL, or ≥ 2 shared distinctive prior employers with no conflicting profile) — homonyms stay separate and are shown with their own company. Deal companies are keyed by id; former names come from explicit statements about the company ("Acme (formerly Widgetly)", "previously known as…", "X, now Acme"); two dossiers are linked `ALIAS_OF` on a rename statement, the same website domain or the same resolved founding team, `POSSIBLY_SAME_AS` on a founder-name overlap only (shown, never used to answer). Employers go through a small versioned alias table (`org_aliases_v1`: Google/Alphabet, Meta/Facebook…); a short name shared by several organizations (Mercury the bank vs Mercury Systems) is resolved only by explicit context, else kept `AMBIGUOUS`; placeholders ("Unnamed distributor") are never entities. Chat mention resolution finds a renamed company by its former name and says so; the deal header shows "Formerly … / Also known as …". Existing data: rebuilt on the next index, or at once with `scripts/reindex-entities.ts`.

At question time (measured first token on the Ledgerline record):
1. Deterministic mention resolution (companies incl. homonyms → most recent dossier, said explicitly; founders; IC members).
2. **Fast path** (~80 ms, no model): a single fact about a single deal is read from the same canonical record the views render, with status, period, source, caveats — or « On ne sait pas encore », whether it is withheld, related metrics, the open gap and the founder question.
3. **Direct plan** for single-deal questions (no planner round-trip, ~1–2.5 s); planner call (effort `none`) otherwise.
4. **Computations**: trajectory and counterfactual questions are computed by the economics engine and handed to the model as COMPUTED context (~0.8 s first token); the model explains, never calculates.
5. **IC pre-mortem** ("why could this die at the fund, who challenges it, on which variable"): fragile variables from the record × members' DOCUMENTED preferences and OBSERVED statements; members with nothing recorded are marked so no view is attributed (~1.1 s).
6. The lexical-only single-deal path removes EN/FR stopwords and bridges question wording to deck wording deterministically (close a deal → sales cycle, burning → burn, how many X use → customers).
7. Retrieval in parallel (SQL over facts, memory packs, FTS5 bm25, exact cosine, graph, fund memory, history; reciprocal rank fusion), streamed answer with numbered citations.

IC members and fund memory: DOCUMENTED (written preferences; fund documents imported with a verbatim quote that code finds in the document — anything else is dropped), OBSERVED (quotes extracted from recorded meetings, kept only when found verbatim), INFERRED (`brain/patterns.ts`: deterministic associations over observations and IC decisions with counts, minimum samples and thresholds — "raised retention in 4 of 6 recorded interventions" — recomputed when the record changes; never a stated preference). Without records the Brain says it does not know.

## Quality & Reliability (`/quality`)

Measured numbers only: evaluation accuracy (latest `evals/run.ts` full run, versioned in `evals/latest.json`), evidence integrity over current versions (verified claims with an independent retrieved source, retrieved web citations, verification / unknown / contradiction / human-correction rates, integrity findings per deal), analysis runs (cost, P50/P95 latency, failure and partial rates, per mode) and Fund Brain (time to first token, share answered without a model call). Unmeasured values say so.

## Storage and deployment

SQLite (WAL, `BEGIN IMMEDIATE` transactions) via Drizzle with SQL migrations in `drizzle/`, applied at startup after a verified pre-migration backup. Daily online backups with retention, tested restore, owner export (ZIP). Documents are encrypted at rest (AES-256-GCM) on local disk or any S3-compatible store. Every query is scoped by workspace; members and roles (IC decisions, merges and deletions need an owner or partner); upload bodies are capped before they are read; login is constant-time for unknown emails and throttled; instance backups are visible only to the setup owner (other owners keep their workspace export); provider errors reach users as classified, key-free messages; a run can never return to RUNNING once finished, recalculation never overwrites a newer version, concurrent meeting submissions and merges are refused, and a deleted or merged company is never re-indexed; server-side sessions with HMAC-signed cookies; audit log; permanent deletion removes documents, versions, memory and files; a consistency checker verifies projections against versions.

Render: one web service plus a persistent disk (`render.yaml`). To scale beyond one instance, move to Postgres (pgvector for embeddings, `tsvector` for lexical search) and a job queue for analyses; the repository layer isolates those changes.

## Directory map

```
src/domain         canonical object, enums, fund profile (zod)
src/engine         metric dictionary, benchmark registry, scoring, calc, returns, economics (cap table, trajectory,
                   sensitivity, counterfactuals), integrity, latent, divergence, focus, overrides, portfolio,
                   financing, fund, risk, decision
src/formation      investor training: case building, generators, graders, skill model, calibration, journal
src/ai             Responses client, cost controller, pricing, prompt modules, untrusted-content policy
src/ingestion      PDF / PPTX / image extraction
src/orchestration  pipeline, assembly of model outputs into the canonical object, context serializers
src/brain          memory packs, indexer, vectors, retrieval, chat orchestrator
src/server         repositories, auth, sessions, storage, recalculation, fund memory
src/reports        deterministic report renderers
src/app            Next.js routes (pages + API)
tests/             unit + adversarial tests (deterministic guarantees; ~2,200 cases)
evals/             LLM-level evaluations on fictional decks
```
