/**
 * Model provider failures: the provider's text (which can quote a rejected API key) never becomes the stored /
 * returned message; an accepted-then-failed request is charged at its worst case, a refused one at $0; embed()
 * and stream() release their in-flight hold when they fail. fetch is stubbed — no network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CostController } from "@/ai/cost";
import { embed, stream, structured } from "@/ai/openai";
import { ProviderError, classifyProviderError, redactSecrets } from "@/ai/errors";
import { TranscriptionError, transcribeRecording } from "@/ai/transcribe";

const KEY_TEXT = "Incorrect API key provided: sk-proj-abc123SECRETxyz. You can find your API key at https://platform.openai.com/account/api-keys.";
const sse = (...events: unknown[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
const call = (cost: CostController) => ({ step: "T", promptVersion: "v1", instructions: "x", input: [{ role: "user" as const, content: "hello" }], schema: z.object({ a: z.number() }), schemaName: "t", maxOutputTokens: 1000, cost, maxAttempts: 1 });

afterEach(() => vi.unstubAllGlobals());

describe("provider errors are user-safe", () => {
  it("a 401 carries its class, not the provider text or key fragment; refused requests cost $0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: KEY_TEXT, type: "invalid_request_error", code: "invalid_api_key" } }, { status: 401 })));
    const cost = new CostController(1, 1);
    const err = await structured(call(cost)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.errorClass).toBe("AUTHENTICATION");
    expect(err.message).toBe("The model provider returned an error (authentication). Retry, or check the server logs.");
    expect(err.message).not.toMatch(/sk-|Incorrect|platform\.openai/);
    expect(cost.spentUsd).toBe(0);
    expect(cost.remainingUsd).toBe(1); // in-flight hold released
  });

  it("classifies rate limits, invalid requests, timeouts and outages; redacts keys in log text", () => {
    expect(classifyProviderError(429)).toBe("RATE_LIMIT");
    expect(classifyProviderError(400)).toBe("INVALID_REQUEST");
    expect(classifyProviderError(504)).toBe("TIMEOUT");
    expect(classifyProviderError(503)).toBe("UNAVAILABLE");
    expect(classifyProviderError(null, "rate_limit_exceeded")).toBe("RATE_LIMIT");
    expect(redactSecrets(KEY_TEXT)).not.toContain("abc123SECRET");
    expect(redactSecrets("Authorization: Bearer sk-live-123456")).not.toContain("123456");
  });

  it("an accepted request that fails mid-stream without usage is charged its worst case; with usage, the usage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse({ type: "response.created" }, { type: "response.failed", response: { error: { message: `server exploded near ${KEY_TEXT}`, code: "server_error" } } })));
    const cost = new CostController(1, 1);
    const err = await structured(call(cost)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).not.toContain("exploded");
    expect(cost.entries).toHaveLength(1);
    expect(cost.spentUsd).toBeGreaterThan(0);
    expect(cost.spentUsd).toBeCloseTo(cost.entries[0]!.estimatedUsd, 10);

    vi.stubGlobal("fetch", vi.fn(async () => sse({ type: "response.failed", response: { error: { message: "x" }, usage: { input_tokens: 1000, output_tokens: 10 } } })));
    const cost2 = new CostController(1, 1);
    await structured(call(cost2)).catch(() => undefined);
    expect(cost2.spentUsd).toBeGreaterThan(0);
    expect(cost2.spentUsd).toBeLessThan(cost2.entries[0]!.estimatedUsd);
  });

  it("malformed model JSON is reported without echoing the output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse({ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "not json: confidential deck text" }] }], usage: { input_tokens: 1, output_tokens: 1 } } })));
    const err = await structured(call(new CostController(1, 1))).catch((e) => e);
    expect(err.message).toBe("The model returned malformed JSON");
  });

  it("embed() and stream() release their in-flight hold on failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: KEY_TEXT } }, { status: 401 })));
    const cost = new CostController(1, 1);
    const e1 = await embed(["a", "b"], cost).catch((e) => e);
    expect(e1).toBeInstanceOf(ProviderError);
    expect(e1.message).not.toContain("sk-");
    expect(cost.remainingUsd).toBe(1);
    const e2 = await (async () => {
      for await (const ev of stream({ step: "S", promptVersion: "v", instructions: "x", input: [{ role: "user", content: "q" }], maxOutputTokens: 500, cost })) void ev;
    })().catch((e) => e);
    expect(e2).toBeInstanceOf(ProviderError);
    expect(cost.remainingUsd).toBe(1);
    expect(cost.spentUsd).toBe(0);

    // Accepted, then failed: the hold is released and the worst case charged.
    vi.stubGlobal("fetch", vi.fn(async () => sse({ type: "response.output_text.delta", delta: "Hel" }, { type: "error", error: { message: KEY_TEXT } })));
    const cost2 = new CostController(1, 1);
    const seen: string[] = [];
    const e3 = await (async () => {
      for await (const ev of stream({ step: "S", promptVersion: "v", instructions: "x", input: [{ role: "user", content: "q" }], maxOutputTokens: 500, cost: cost2 })) if (ev.type === "delta") seen.push(ev.text);
    })().catch((e) => e);
    expect(seen).toEqual(["Hel"]);
    expect(e3.message).not.toContain("sk-");
    expect(cost2.spentUsd).toBeCloseTo(cost2.entries[0]!.estimatedUsd, 10);
    expect(cost2.remainingUsd).toBeCloseTo(1 - cost2.spentUsd, 10);
  });

  it("transcription rejections are user-safe and keep the status for the fallback decision", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: KEY_TEXT } }, { status: 401 })));
    const err = await transcribeRecording({ data: Buffer.alloc(4096, 1), filename: "call.m4a", mime: "audio/mp4", cost: new CostController(3, 3) }).catch((e) => e);
    expect(err).toBeInstanceOf(TranscriptionError);
    expect(err.status).toBe(401);
    expect(err.message).not.toMatch(/sk-|Incorrect/);
  });
});
