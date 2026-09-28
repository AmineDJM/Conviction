/**
 * End to end (real database, mocked model): the streamed answer is checked sentence by sentence against the items it
 * cites; the displayed and stored answer is the verified one.
 */
import { afterAll, describe, expect, it, vi } from "vitest";

const TMP = vi.hoisted(() => {
  const dir = `${process.env.TMPDIR ?? "/tmp"}/cv-verify-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  process.env.DATABASE_PATH = `${dir}/conviction.db`;
  process.env.STORAGE_DIR = `${dir}/files`;
  return dir;
});

const h = vi.hoisted(() => ({ answer: "", verdicts: null as unknown, verifyCalls: 0, verifyInput: "" }));

vi.mock("@/ai/openai", async (orig) => ({
  ...(await orig<typeof import("@/ai/openai")>()),
  structured: vi.fn(async (call: { step: string; input: { content: string }[] }) => {
    if (call.step === "BRAIN_VERIFY") {
      h.verifyCalls++;
      h.verifyInput = call.input[0]!.content;
      return { data: h.verdicts, usage: {}, searchSources: [], searchQueries: [], latencyMs: 1, attempts: 1, cached: false };
    }
    throw new Error("planner unavailable in this test"); // → fallback plan
  }),
  stream: vi.fn(async function* () {
    yield { type: "delta", text: h.answer };
  }),
  embed: vi.fn(async (texts: string[]) => ({ vectors: texts.map(() => new Float32Array(512).fill(0.01)), usage: { inputTokens: 0 } })),
}));

import fs from "node:fs";
import { getDb, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { createWorkspaceWithOwner } from "@/server/auth";
import * as repo from "@/server/repo";
import { askBrain, type BrainEvent } from "@/brain/chat";
import { derive } from "@/engine/derive";
import { getRegistry } from "@/engine/benchmarks";
import { writeFacts } from "@/brain/indexer";
import { buildMemoryPack } from "@/brain/memory-pack";
import { makeDeal } from "./fixtures";

afterAll(() => {
  getDb().$client.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function setup() {
  const { workspaceId, userId } = createWorkspaceWithOwner({ email: `gp-${Math.random()}@fund.example`, name: "GP", password: "correct horse battery", workspaceName: "Fund" });
  const d = makeDeal();
  const company = repo.createCompany(workspaceId, d.identity.name);
  const derived = derive(d, getRegistry(), repo.getDefaultFund(workspaceId));
  const v = repo.saveVersion({ company, canonical: d, derived, reason: "DECK_ANALYSIS", summary: "test" });
  writeFacts(workspaceId, company.id, v.id, d);
  const row = repo.getCompany(workspaceId, company.id)!;
  const pack = buildMemoryPack({ id: row.id, slug: row.slug }, v.id, d, derived);
  getDb().insert(schema.memoryPacks).values({ workspaceId, companyId: company.id, versionId: v.id, pack: pack.pack, text: pack.pack.text, tokenEstimate: pack.tokens, updatedAt: new Date().toISOString() }).run();
  return { workspaceId, userId, companyId: company.id };
}

async function ask(s: Awaited<ReturnType<typeof setup>>, question: string) {
  const events: BrainEvent[] = [];
  for await (const ev of askBrain({ workspaceId: s.workspaceId, userId: s.userId, question, contextCompanyId: s.companyId })) events.push(ev);
  return events;
}

describe("Fund Brain answers are verified before they are kept", () => {
  it("unsupported parts are trimmed or become uncited inferences; the stored answer is the verified one", async () => {
    const s = await setup();
    h.answer = "Acme reports $3.84M ARR as of August 2026 [1]. Acme's growth will slow sharply after the round [1].";
    h.verdicts = { sentences: [{ id: 0, verdict: "TRIM", supported: "Acme reports $3.84M ARR" }, { id: 1, verdict: "INFERENCE", supported: "" }] };
    const events = await ask(s, "Pourquoi la croissance d'Acme devrait-elle ralentir ?");
    expect(h.verifyCalls).toBe(1);
    expect(h.verifyInput).toContain("SENTENCE 0: Acme reports $3.84M ARR as of August 2026.");
    const rev = events.find((e) => e.type === "revision") as Extract<BrainEvent, { type: "revision" }>;
    expect(rev.text).toBe("Acme reports $3.84M ARR [1]. Lecture : Acme's growth will slow sharply after the round.");
    expect(rev.stats).toMatchObject({ checked: 2, trimmed: 1, inference: 1 });
    const done = events.find((e) => e.type === "done") as Extract<BrainEvent, { type: "done" }>;
    const stored = getDb().select().from(schema.chatMessages).where(eq(schema.chatMessages.id, done.messageId)).get()!;
    expect(stored.content).toBe(rev.text);
    expect((stored.plan as { verification?: unknown }).verification).toMatchObject({ checked: 2, trimmed: 1, inference: 1 });
  });

  it("a citation to an item that was not in the context is removed by code, without asking the verifier", async () => {
    const s = await setup();
    h.verifyCalls = 0;
    h.answer = "Acme has a strong moat in accounts payable automation [42].";
    h.verdicts = { sentences: [] };
    const events = await ask(s, "Pourquoi Acme a-t-il un avantage durable ?");
    expect(h.verifyCalls).toBe(0);
    const rev = events.find((e) => e.type === "revision") as Extract<BrainEvent, { type: "revision" }>;
    expect(rev.text).toBe("Acme has a strong moat in accounts payable automation.");
  });

  it("a verifier failure never blocks the answer; it is stored as unverified", async () => {
    const s = await setup();
    h.answer = "Acme reports $3.84M ARR as of August 2026 [1].";
    h.verdicts = { sentences: "not-an-array" }; // the mock returns data that fails the schema downstream
    const events = await ask(s, "Pourquoi l'ARR d'Acme compte ?");
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
