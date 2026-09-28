/**
 * Minimal OpenAI Responses API client (fetch-based, no SDK dependency).
 *
 * - structured(): strict JSON-schema output, zod-validated, bounded retries (§145–146)
 * - web search tool with source capture for citation integrity (§120)
 * - stream(): SSE text streaming for the Fund Brain
 * - embed(): embeddings for retrieval
 *
 * Every call is authorized by the CostController before it runs and recorded after.
 */
import type { z } from "zod";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { toStrictJsonSchema } from "./json-schema";
import type { CostController, Reservation } from "./cost";
import type { Usage } from "./pricing";
import { ProviderError, providerError } from "./errors";

const BASE_URL = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
export const PRIMARY_MODEL = process.env.CONVICTION_MODEL ?? "gpt-5.6-luna";
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 512;

/** Base URL of the OpenAI API (overridable for the offline mock). */
export const OPENAI_BASE_URL = BASE_URL;

/** Authorization header only (multipart requests set their own content type). */
export function authHeaders(): Record<string, string> {
  // In managed environments an egress proxy injects credentials; send the key only if configured.
  return process.env.OPENAI_API_KEY ? { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } : {};
}

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...authHeaders() };
}

export type Effort = "none" | "low" | "medium" | "high";

export interface InputMessage {
  role: "developer" | "user" | "assistant";
  content: string | ({ type: "input_text"; text: string } | { type: "input_image"; image_url: string } | { type: "input_file"; filename: string; file_data: string })[];
}

export interface StructuredCall<T extends z.ZodType> {
  step: string;
  promptVersion: string;
  instructions: string;
  input: InputMessage[];
  schema: T;
  schemaName: string;
  maxOutputTokens: number;
  effort?: Effort;
  model?: string;
  webSearch?: { maxCalls: number };
  cost: CostController;
  /** Budget reserved earlier for this step; consumed by the first authorized attempt. */
  reservation?: Reservation | null;
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Cache the result for identical inputs (never for web research). */
  cache?: boolean;
}

export interface StructuredResult<T> {
  data: T;
  usage: Usage;
  searchSources: { url: string; title?: string }[];
  searchQueries: string[];
  latencyMs: number;
  attempts: number;
  cached: boolean;
}

export class ModelOutputError extends Error {}

interface RawResponse {
  status?: string;
  error?: { message?: string; code?: string | null; type?: string | null } | null;
  incomplete_details?: { reason?: string } | null;
  output?: {
    type: string;
    content?: { type: string; text?: string; annotations?: { type: string; url?: string; title?: string }[] }[];
    action?: { query?: string; queries?: string[]; sources?: { url: string; title?: string }[] };
  }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
  tool_usage?: { web_search?: { num_requests?: number } };
}

const NO_USAGE: Usage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 };
const isAbort = (e: unknown, signal?: AbortSignal | null) => !!signal?.aborted || (e as Error)?.name === "AbortError";

function usageOf(r: RawResponse): Usage {
  const webFromOutput = (r.output ?? []).filter((o) => o.type === "web_search_call").length;
  return {
    inputTokens: r.usage?.input_tokens ?? 0,
    cachedTokens: r.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: r.usage?.output_tokens ?? 0,
    reasoningTokens: r.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    webSearches: r.tool_usage?.web_search?.num_requests ?? webFromOutput,
  };
}

function outputText(r: RawResponse): string {
  const parts: string[] = [];
  for (const o of r.output ?? []) {
    if (o.type !== "message") continue;
    for (const c of o.content ?? []) if (c.type === "output_text" && c.text) parts.push(c.text);
  }
  return parts.join("");
}

function inputChars(instructions: string, input: InputMessage[]): number {
  let n = instructions.length;
  for (const m of input) {
    if (typeof m.content === "string") n += m.content.length;
    else
      for (const c of m.content) {
        if (c.type === "input_text") n += c.text.length;
        else if (c.type === "input_image") n += 4_000; // ~1.2k tokens per page image at low detail
        else n += Math.min(c.file_data.length, 400_000);
      }
  }
  return n;
}

/**
 * POST with SSE streaming and return the final response object. Streaming keeps
 * bytes flowing during long reasoning, which avoids idle timeouts on proxies and
 * load balancers; the complete response arrives in the `response.completed` event.
 */
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

/** Transport-level retries: rate limits and transient server errors, honoring retry-after. */
export async function fetchWithRetry(url: string, init: RequestInit, retries = 4): Promise<Response> {
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, init);
    } catch (e) {
      if ((e as Error).name === "AbortError" || attempt >= retries) throw e;
    }
    if (res && (!RETRYABLE.has(res.status) || attempt >= retries)) return res;
    const retryAfter = res ? Number(res.headers.get("retry-after")) : NaN;
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(30_000, retryAfter * 1000) : delay + Math.floor(Math.random() * 400);
    await res?.body?.cancel().catch(() => {});
    if (init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise((r) => setTimeout(r, wait));
    delay = Math.min(delay * 2, 16_000);
  }
}

/** `state.accepted` is set once the provider accepted the request (HTTP 2xx): from then on a failure may still be billed. */
async function post(body: Record<string, unknown>, signal?: AbortSignal, state: { accepted: boolean } = { accepted: false }): Promise<RawResponse> {
  let res: Response;
  try {
    res = await fetchWithRetry(`${BASE_URL}/responses`, { method: "POST", headers: headers(), body: JSON.stringify({ ...body, stream: true }), signal });
  } catch (e) {
    if (isAbort(e, signal)) throw e;
    throw providerError("responses", null, (e as Error).message, { code: (e as Error).name === "TimeoutError" ? "timeout" : null });
  }
  if (!res.ok || !res.body) {
    const json = (await res.json().catch(() => ({}))) as RawResponse;
    throw providerError("responses", res.status, json.error?.message ?? res.statusText, { code: json.error?.code ?? json.error?.type });
  }
  state.accepted = true;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let final: RawResponse | null = null;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine || dataLine === "data: [DONE]") continue;
        let ev: { type?: string; response?: RawResponse; error?: { message?: string; code?: string | null; type?: string | null } };
        try {
          ev = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if ((ev.type === "response.completed" || ev.type === "response.incomplete") && ev.response) final = ev.response;
        else if (ev.type === "response.failed")
          throw providerError("responses stream", null, ev.response?.error?.message ?? "response failed", { code: ev.response?.error?.code ?? ev.response?.error?.type, usage: ev.response?.usage ? usageOf(ev.response) : null });
        else if (ev.type === "error") throw providerError("responses stream", null, ev.error?.message ?? dataLine.slice(0, 200), { code: ev.error?.code ?? ev.error?.type });
      }
    }
  } catch (e) {
    if (e instanceof ProviderError || isAbort(e, signal)) throw e;
    throw providerError("responses stream", null, (e as Error).message);
  }
  if (!final) throw providerError("responses stream", null, "stream ended without a final response");
  return final;
}

export async function structured<T extends z.ZodType>(call: StructuredCall<T>): Promise<StructuredResult<z.infer<T>>> {
  const model = call.model ?? PRIMARY_MODEL;
  const maxAttempts = call.maxAttempts ?? 2;
  const chars = inputChars(call.instructions, call.input);
  const jsonSchema = toStrictJsonSchema(call.schema);
  let cacheKey: string | null = null;
  if (call.cache) {
    cacheKey = createHash("sha256")
      .update(JSON.stringify({ model, v: call.promptVersion, s: call.schemaName, i: call.instructions, input: call.input, e: call.effort ?? "low", m: call.maxOutputTokens }))
      .digest("hex");
    const hit = await cacheGet(cacheKey);
    if (hit) {
      const parsed = call.schema.safeParse(hit);
      if (parsed.success) {
        await call.cost.record({ step: `${call.step}:cache`, model, promptVersion: call.promptVersion, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, estimatedUsd: 0, actualUsd: 0, latencyMs: 0, toolCalls: 0 });
        return { data: parsed.data, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, searchSources: [], searchQueries: [], latencyMs: 0, attempts: 0, cached: true };
      }
    }
  }
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const estimated = call.cost.authorize(call.step, model, chars, call.maxOutputTokens, call.webSearch?.maxCalls ?? 0, call.reservation);
    const body: Record<string, unknown> = {
      model,
      instructions: call.instructions,
      input: call.input,
      max_output_tokens: call.maxOutputTokens,
      reasoning: { effort: call.effort ?? "low" },
      text: { format: { type: "json_schema", name: call.schemaName, strict: true, schema: jsonSchema } },
      store: false,
    };
    if (call.webSearch && call.webSearch.maxCalls > 0) {
      body.tools = [{ type: "web_search" }];
      body.max_tool_calls = call.webSearch.maxCalls;
      body.include = ["web_search_call.action.sources"];
    }
    const t0 = Date.now();
    let raw: RawResponse | null = null;
    const state = { accepted: false };
    try {
      raw = await post(body, call.signal, state);
    } catch (e) {
      lastErr = e;
      // Refused requests are not billed; an accepted request that then failed may be: its reported usage, else the worst case.
      const reported = e instanceof ProviderError ? e.usage : null;
      await call.cost.record({ step: call.step, model, promptVersion: call.promptVersion, usage: reported ?? NO_USAGE, estimatedUsd: estimated, ...(reported ? {} : { actualUsd: state.accepted ? estimated : 0 }), latencyMs: Date.now() - t0, toolCalls: 0 });
      if (isAbort(e, call.signal)) break;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 1500 * attempt));
      continue;
    }
    const usage = usageOf(raw);
    const latencyMs = Date.now() - t0;
    await call.cost.record({ step: call.step, model, promptVersion: call.promptVersion, usage, estimatedUsd: estimated, latencyMs, toolCalls: usage.webSearches });
    const text = outputText(raw);
    try {
      if (raw.status === "incomplete") throw new ModelOutputError(`Incomplete response: ${raw.incomplete_details?.reason ?? "unknown"}`);
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ModelOutputError("The model returned malformed JSON");
      }
      const result = call.schema.safeParse(parsed);
      if (!result.success) throw new ModelOutputError(`Schema validation failed: ${result.error.message.slice(0, 500)}`);
      const searchSources: { url: string; title?: string }[] = [];
      const searchQueries: string[] = [];
      for (const o of raw.output ?? []) {
        if (o.type === "web_search_call") {
          for (const s of o.action?.sources ?? []) searchSources.push(s);
          for (const q of o.action?.queries ?? (o.action?.query ? [o.action.query] : [])) searchQueries.push(q);
        }
        if (o.type === "message")
          for (const c of o.content ?? []) for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url) searchSources.push({ url: a.url, title: a.title });
      }
      if (cacheKey) await cacheSet(cacheKey, call.step, model, call.promptVersion, result.data, usage);
      return { data: result.data, usage, searchSources, searchQueries, latencyMs, attempts: attempt, cached: false };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new ModelOutputError(String(lastErr));
}

/* ---------------------------------------------------------------- */
/* Streaming (Fund Brain)                                             */
/* ---------------------------------------------------------------- */

export interface StreamCall {
  step: string;
  promptVersion: string;
  instructions: string;
  input: InputMessage[];
  maxOutputTokens: number;
  effort?: Effort;
  model?: string;
  cost: CostController;
  signal?: AbortSignal;
  webSearch?: { maxCalls: number };
}

export async function* stream(call: StreamCall): AsyncGenerator<{ type: "delta"; text: string } | { type: "done"; usage: Usage; latencyMs: number }> {
  const model = call.model ?? PRIMARY_MODEL;
  const estimated = call.cost.authorize(call.step, model, inputChars(call.instructions, call.input), call.maxOutputTokens, call.webSearch?.maxCalls ?? 0);
  const t0 = Date.now();
  const body: Record<string, unknown> = {
    model,
    instructions: call.instructions,
    input: call.input,
    max_output_tokens: call.maxOutputTokens,
    reasoning: { effort: call.effort ?? "low" },
    stream: true,
    store: false,
  };
  if (call.webSearch && call.webSearch.maxCalls > 0) {
    body.tools = [{ type: "web_search" }];
    body.max_tool_calls = call.webSearch.maxCalls;
  }
  let accepted = false;
  let recorded = false;
  try {
    let res: Response;
    try {
      res = await fetchWithRetry(`${BASE_URL}/responses`, { method: "POST", headers: headers(), body: JSON.stringify(body), signal: call.signal }, 2);
    } catch (e) {
      if (isAbort(e, call.signal)) throw e;
      throw providerError("responses (stream)", null, (e as Error).message);
    }
    if (!res.ok || !res.body) {
      const txt = await res.text().catch(() => "");
      throw providerError("responses (stream)", res.status, txt.slice(0, 1000), { code: txt });
    }
    accepted = true;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let usage: Usage = NO_USAGE;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) >= 0) {
        const event = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLine = event.split("\n").find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        const payload = dataLine.slice(6);
        if (payload === "[DONE]") continue;
        let ev: { type?: string; delta?: string; response?: RawResponse };
        try {
          ev = JSON.parse(payload);
        } catch {
          continue;
        }
        if (ev.type === "response.output_text.delta" && ev.delta) yield { type: "delta", text: ev.delta };
        else if ((ev.type === "response.completed" || ev.type === "response.incomplete") && ev.response) usage = usageOf(ev.response);
        else if (ev.type === "response.failed" || ev.type === "error") throw providerError("responses (stream)", null, payload.slice(0, 1000), { code: payload });
      }
    }
    const latencyMs = Date.now() - t0;
    recorded = true;
    await call.cost.record({ step: call.step, model, promptVersion: call.promptVersion, usage, estimatedUsd: estimated, latencyMs, toolCalls: usage.webSearches });
    yield { type: "done", usage, latencyMs };
  } finally {
    // Failure, cancellation or an abandoned stream: release the in-flight hold (worst case charged once the request was accepted).
    if (!recorded) await call.cost.record({ step: call.step, model, promptVersion: call.promptVersion, usage: NO_USAGE, estimatedUsd: estimated, actualUsd: accepted ? estimated : 0, latencyMs: Date.now() - t0, toolCalls: 0 });
  }
}

/* ---------------------------------------------------------------- */
/* Embeddings                                                         */
/* ---------------------------------------------------------------- */

export async function embed(texts: string[], cost: CostController, step = "embedding"): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const out: Float32Array[] = [];
  const BATCH = 96;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, 24_000));
    const chars = batch.reduce((a, t) => a + t.length, 0);
    const estimated = cost.authorize(step, EMBEDDING_MODEL, chars, 0);
    const t0 = Date.now();
    type EmbedJson = { data?: { embedding: number[]; index: number }[]; usage?: { prompt_tokens?: number }; error?: { message?: string; code?: string | null } };
    let res: Response;
    let json: EmbedJson;
    try {
      res = await fetchWithRetry(`${BASE_URL}/embeddings`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIM }),
      });
      json = (await res.json().catch(() => ({}))) as EmbedJson;
    } catch (e) {
      await cost.record({ step, model: EMBEDDING_MODEL, promptVersion: null, usage: NO_USAGE, estimatedUsd: estimated, actualUsd: 0, latencyMs: Date.now() - t0, toolCalls: 0 });
      throw providerError("embeddings", null, (e as Error).message);
    }
    if (!res.ok || !json.data) {
      await cost.record({ step, model: EMBEDDING_MODEL, promptVersion: null, usage: NO_USAGE, estimatedUsd: estimated, actualUsd: 0, latencyMs: Date.now() - t0, toolCalls: 0 });
      throw providerError("embeddings", res.status, json.error?.message ?? res.statusText, { code: json.error?.code });
    }
    await cost.record({
      step,
      model: EMBEDDING_MODEL,
      promptVersion: null,
      usage: { inputTokens: json.usage?.prompt_tokens ?? 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 },
      estimatedUsd: estimated,
      latencyMs: Date.now() - t0,
      toolCalls: 0,
    });
    for (const d of [...json.data].sort((a, b) => a.index - b.index)) out.push(Float32Array.from(d.embedding));
  }
  return out;
}

/* ---------------------------------------------------------------- */
/* Reproducibility cache (llm_cache)                                  */
/* ---------------------------------------------------------------- */

async function cacheGet(key: string): Promise<unknown | null> {
  try {
    const { getDb, schema } = await import("@/db/client");
    const db = getDb();
    const row = db.select().from(schema.llmCache).where(eq(schema.llmCache.key, key)).get();
    if (!row) return null;
    db.update(schema.llmCache).set({ hits: sql`${schema.llmCache.hits} + 1` }).where(eq(schema.llmCache.key, key)).run();
    return row.output;
  } catch {
    return null;
  }
}

async function cacheSet(key: string, step: string, model: string, promptVersion: string, output: unknown, usage: Usage) {
  try {
    const { getDb, schema } = await import("@/db/client");
    getDb()
      .insert(schema.llmCache)
      .values({ key, step, model, promptVersion, output: output as never, usage: usage as never, hits: 0, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
  } catch {
    /* cache is best-effort */
  }
}
