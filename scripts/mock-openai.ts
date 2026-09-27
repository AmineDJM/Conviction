/**
 * Mock OpenAI API for load tests and offline development.
 *
 *   npx tsx scripts/mock-openai.ts            (MOCK_PORT=4010, MOCK_LATENCY_MS=300)
 *   OPENAI_BASE_URL=http://127.0.0.1:4010/v1 npm run dev
 *
 * POST /v1/responses   stream:true → SSE response.output_text.delta … response.completed
 *                      stream:false → the final response object
 *                      Structured calls (text.format.json_schema.schema) get a minimal
 *                      VALID instance generated generically from the JSON schema.
 * POST /v1/embeddings  deterministic pseudo-random vectors (hash of the input), 512-d by default.
 * GET  /stats          request counters and peak concurrency.
 */
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

type Json = Record<string, unknown>;

/* ------------------------------ JSON-schema instance generator ------------------------------ */

function resolveRef(ref: string, root: Json): Json {
  if (ref === "#") return root;
  const parts = ref.replace(/^#\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = root;
  for (const p of parts) node = (node as Json | undefined)?.[p];
  if (!node || typeof node !== "object") throw new Error(`Unresolvable $ref ${ref}`);
  return node as Json;
}

const STRING_CANDIDATES = ["mock", "MOCK-001", "CLM-001", "SRC-001", "MET-001", "2026-01", "2026-01-01", "1", "a", "A", "https://example.com"];

function genString(s: Json): string {
  const format = s.format as string | undefined;
  let v = format === "date-time" ? "2026-01-01T00:00:00Z" : format === "date" ? "2026-01-01" : format === "uri" || format === "url" ? "https://example.com" : format === "email" ? "mock@example.com" : format === "uuid" ? "00000000-0000-4000-8000-000000000000" : "mock";
  if (typeof s.pattern === "string") {
    try {
      const re = new RegExp(s.pattern as string, "u");
      if (!re.test(v)) v = STRING_CANDIDATES.find((c) => re.test(c)) ?? v;
    } catch {
      /* unsupported pattern syntax */
    }
  }
  const min = typeof s.minLength === "number" ? s.minLength : 0;
  const max = typeof s.maxLength === "number" ? s.maxLength : Infinity;
  if (v.length < min) v = v.padEnd(min, "x");
  if (v.length > max) v = v.slice(0, max);
  return v;
}

function genNumber(s: Json, integer: boolean): number {
  let v = 1;
  const min = typeof s.minimum === "number" ? s.minimum : typeof s.exclusiveMinimum === "number" ? s.exclusiveMinimum + (integer ? 1 : 0.001) : -Infinity;
  const max = typeof s.maximum === "number" ? s.maximum : typeof s.exclusiveMaximum === "number" ? s.exclusiveMaximum - (integer ? 1 : 0.001) : Infinity;
  if (v < min) v = integer ? Math.ceil(min) : min;
  if (v > max) v = integer ? Math.floor(max) : max;
  if (typeof s.multipleOf === "number" && s.multipleOf > 0) v = Math.ceil(v / s.multipleOf) * s.multipleOf;
  return v;
}

/**
 * Minimal valid instance: objects get all required properties; strings "mock";
 * numbers/integers 1 (clamped to bounds); booleans false; arrays one item
 * (respecting minItems/maxItems); enums the first value; anyOf with null prefers
 * the non-null branch up to depth 4, then null.
 */
export function instanceFor(schema: unknown, root: Json = schema as Json, depth = 0): unknown {
  if (schema === true || schema === undefined || schema === null) return "mock";
  if (schema === false) return null;
  let s = schema as Json;
  if (typeof s.$ref === "string") s = { ...resolveRef(s.$ref, root), ...Object.fromEntries(Object.entries(s).filter(([k]) => k !== "$ref")) };
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  const branches = (s.anyOf ?? s.oneOf) as Json[] | undefined;
  if (Array.isArray(branches) && branches.length) {
    const isNull = (b: Json) => b.type === "null" || (b.const === null && "const" in b);
    const nonNull = branches.filter((b) => !isNull(b));
    if (nonNull.length && (depth <= 4 || nonNull.length === branches.length)) return instanceFor(nonNull[0], root, depth + 1);
    return null;
  }
  if (Array.isArray(s.allOf) && s.allOf.length) return instanceFor(Object.assign({}, ...(s.allOf as Json[])), root, depth);
  let type = s.type as string | string[] | undefined;
  if (Array.isArray(type)) {
    const nn = type.filter((t) => t !== "null");
    type = nn.length && (depth <= 4 || nn.length === type.length) ? nn[0] : "null";
  }
  if (!type) type = s.properties ? "object" : s.items ? "array" : undefined;
  switch (type) {
    case "object": {
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(s.required) ? (s.required as string[]) : Object.keys(props);
      const out: Json = {};
      for (const k of required) out[k] = instanceFor(props[k], root, depth + 1);
      return out;
    }
    case "array": {
      const minItems = typeof s.minItems === "number" ? s.minItems : 0;
      const maxItems = typeof s.maxItems === "number" ? s.maxItems : Infinity;
      if (Array.isArray(s.prefixItems)) return (s.prefixItems as unknown[]).map((p) => instanceFor(p, root, depth + 1));
      // Deep recursive structures stop growing once optional.
      const n = Math.min(maxItems, Math.max(minItems, depth > 12 ? 0 : 1));
      return Array.from({ length: n }, () => instanceFor(s.items, root, depth + 1));
    }
    case "string":
      return genString(s);
    case "number":
      return genNumber(s, false);
    case "integer":
      return genNumber(s, true);
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return "mock";
  }
}

/* ------------------------------ Embeddings ------------------------------ */

export function mockEmbedding(text: string, dim = 512): number[] {
  // Counter-mode SHA-256 stream seeded by the input: deterministic, well-spread values in [-1, 1).
  const out: number[] = [];
  for (let block = 0; out.length < dim; block++) {
    const h = createHash("sha256").update(text).update(String(block)).digest();
    for (let i = 0; i < 32 && out.length < dim; i += 4) out.push(h.readUInt32LE(i) / 0x80000000 - 1);
  }
  return out;
}

/* ------------------------------ Server ------------------------------ */

export interface MockStats {
  responses: number;
  structured: number;
  streamed: number;
  embeddings: number;
  embeddedInputs: number;
  errors: number;
  inFlight: number;
  peakInFlight: number;
}

export interface MockServer {
  url: string;
  port: number;
  stats: MockStats;
  close(): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const approxTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export async function startMockOpenAI(opts: { port?: number; latencyMs?: number; host?: string } = {}): Promise<MockServer> {
  const latency = opts.latencyMs ?? Number(process.env.MOCK_LATENCY_MS ?? 300);
  const stats: MockStats = { responses: 0, structured: 0, streamed: 0, embeddings: 0, embeddedInputs: 0, errors: 0, inFlight: 0, peakInFlight: 0 };

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const url = (req.url ?? "").replace(/\?.*$/, "");
    stats.inFlight++;
    stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight);
    try {
      if (req.method === "GET" && url.endsWith("/stats")) {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(stats));
        return;
      }
      let body: Json = {};
      try {
        body = raw ? (JSON.parse(raw) as Json) : {};
      } catch {
        res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "invalid JSON" } }));
        return;
      }

      if (req.method === "POST" && url.endsWith("/embeddings")) {
        stats.embeddings++;
        const input = Array.isArray(body.input) ? (body.input as string[]) : [String(body.input ?? "")];
        stats.embeddedInputs += input.length;
        const dim = typeof body.dimensions === "number" ? body.dimensions : 512;
        await sleep(Math.round(latency / 3));
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            object: "list",
            model: body.model ?? "text-embedding-3-small",
            data: input.map((t, index) => ({ object: "embedding", index, embedding: mockEmbedding(t, dim) })),
            usage: { prompt_tokens: input.reduce((a, t) => a + approxTokens(t), 0), total_tokens: input.reduce((a, t) => a + approxTokens(t), 0) },
          }),
        );
        return;
      }

      if (req.method === "POST" && url.endsWith("/responses")) {
        stats.responses++;
        const format = (body.text as Json | undefined)?.format as Json | undefined;
        const schema = format?.type === "json_schema" ? (format.schema as Json | undefined) : undefined;
        let text: string;
        if (schema) {
          stats.structured++;
          text = JSON.stringify(instanceFor(schema, schema));
        } else text = "Mock answer: the records show no data on this question yet. [1]";
        const response = {
          id: `resp_mock_${Date.now().toString(36)}`,
          object: "response",
          status: "completed",
          model: body.model ?? "mock",
          output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }],
          usage: { input_tokens: approxTokens(raw), output_tokens: approxTokens(text), input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
          tool_usage: { web_search: { num_requests: 0 } },
        };
        if (body.stream) {
          stats.streamed++;
          res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
          const send = (ev: Json) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
          const parts = 4;
          const size = Math.ceil(text.length / parts);
          for (let i = 0; i < parts; i++) {
            await sleep(Math.round(latency / parts));
            const delta = text.slice(i * size, (i + 1) * size);
            if (delta) send({ type: "response.output_text.delta", item_id: "msg_mock", output_index: 0, content_index: 0, delta });
          }
          send({ type: "response.completed", response });
          res.end();
        } else {
          await sleep(latency);
          res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(response));
        }
        return;
      }
      res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: `No mock for ${req.method} ${url}` } }));
    } catch (e) {
      stats.errors++;
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: (e as Error).message } }));
    } finally {
      stats.inFlight--;
    }
  });
  server.keepAliveTimeout = 30_000;
  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, opts.host ?? "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://${opts.host ?? "127.0.0.1"}:${port}/v1`,
    port,
    stats,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockOpenAI({ port: Number(process.env.MOCK_PORT ?? 4010) }).then((m) => {
    console.log(`mock OpenAI listening on ${m.url} (latency ${process.env.MOCK_LATENCY_MS ?? 300} ms)`);
    console.log(`  OPENAI_BASE_URL=${m.url}`);
  });
}
