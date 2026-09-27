/**
 * Fund Brain conversation orchestrator — "lightweight intelligence at
 * conversation time".
 *
 *   1. deterministic mention resolution + speculative prefetch (memory packs, fund profile)
 *   2. small structured planner call (reasoning effort "none") in parallel with 1
 *   3. retrieval methods chosen by the plan, executed in parallel
 *   4. fusion into numbered, linkable context items
 *   5. streamed answer; reasoning effort scaled to question complexity
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { CostController } from "@/ai/cost";
import { embed, stream, structured, type Effort } from "@/ai/openai";
import { wrapUntrusted } from "@/ai/untrusted";
import { BrainPlan, BRAIN_ANSWER, BRAIN_PLANNER, answerInstructions, plannerInstructions } from "@/ai/prompts/brain";
import { getDefaultFund, recordCost } from "@/server/repo";
import { newId, nowIso } from "@/server/ids";
import {
  catalog,
  chunkItems,
  fundMemory,
  fuse,
  graphContext,
  historyContext,
  icMembers,
  lexicalSearch,
  memoryPacks,
  resolveMentions,
  semanticSearch,
  structuredQuery,
  type ContextItem,
} from "./retrieval";
import { logger } from "@/lib/log";

const s = schema;

export type BrainEvent =
  | { type: "thread"; threadId: string }
  | { type: "status"; text: string }
  | { type: "plan"; plan: BrainPlan; ms: number }
  | { type: "citations"; items: { n: number; title: string; href: string | null; label: string | null; kind: string }[] }
  | { type: "delta"; text: string }
  | { type: "done"; messageId: string; costUsd: number; latencyMs: number; firstTokenMs: number | null }
  | { type: "error"; message: string };

export interface AskInput {
  workspaceId: string;
  userId: string;
  question: string;
  threadId?: string | null;
  contextCompanyId?: string | null;
  signal?: AbortSignal;
}

const CHAT_BUDGET_USD = 0.05;

function fallbackPlan(mentions: string[], contextCompanyId: string | null | undefined, question: string): BrainPlan {
  const ids = mentions.length ? mentions : contextCompanyId ? [contextCompanyId] : [];
  return {
    intent: ids.length ? "COMPANY_QA" : "GENERAL",
    language: /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|des|est|quel|quels|pourquoi|avons)\b/i.test(question) ? "fr" : "en",
    companyIds: ids,
    icMemberIds: [],
    metricFilters: [],
    attributeFilters: { industry: null, stage: null, decisionStatus: null, technology: null },
    rank: null,
    semanticQuery: question,
    lexicalTerms: [],
    chunkKinds: [],
    needsFundBrain: false,
    needsHistory: false,
    needsWeb: false,
    complexity: "MODERATE",
  };
}

function threadHistory(threadId: string, limit = 6) {
  return getDb()
    .select({ role: s.chatMessages.role, content: s.chatMessages.content })
    .from(s.chatMessages)
    .where(eq(s.chatMessages.threadId, threadId))
    .orderBy(asc(s.chatMessages.createdAt))
    .all()
    .slice(-limit);
}

export async function* askBrain(inp: AskInput): AsyncGenerator<BrainEvent> {
  const t0 = Date.now();
  const log = logger.child({ scope: "brain", workspaceId: inp.workspaceId });
  const db = getDb();
  const cost = new CostController(CHAT_BUDGET_USD, CHAT_BUDGET_USD, (e) => recordCost(inp.workspaceId, null, "CHAT", e));

  // Thread.
  let threadId = inp.threadId ?? null;
  if (threadId) {
    const t = db.select().from(s.chatThreads).where(and(eq(s.chatThreads.id, threadId), eq(s.chatThreads.workspaceId, inp.workspaceId))).get();
    if (!t) threadId = null;
  }
  if (!threadId) {
    threadId = newId("thr");
    db.insert(s.chatThreads).values({ id: threadId, workspaceId: inp.workspaceId, userId: inp.userId, title: inp.question.slice(0, 80), createdAt: nowIso(), updatedAt: nowIso() }).run();
  }
  yield { type: "thread", threadId };
  const history = threadHistory(threadId);
  db.insert(s.chatMessages).values({ id: newId("msg"), threadId, role: "user", content: inp.question, contextCompanyId: inp.contextCompanyId ?? null, createdAt: nowIso() }).run();

  // 1. Deterministic resolution + speculative prefetch.
  const cat = catalog(inp.workspaceId);
  const members = icMembers(inp.workspaceId);
  const mentions = resolveMentions(inp.workspaceId, inp.question, cat);
  const speculativeIds = [...new Set([...mentions.companyIds, ...(inp.contextCompanyId ? [inp.contextCompanyId] : [])])];
  const prefetchPacks = memoryPacks(inp.workspaceId, speculativeIds);
  const contextCompany = cat.find((c) => c.id === inp.contextCompanyId);

  // 2. Planner.
  yield { type: "status", text: "Understanding the question" };
  const tPlan = Date.now();
  let plan: BrainPlan;
  try {
    const catalogText = cat.map((c) => `${c.id} | ${c.name} | ${c.sector ?? "-"} | ${c.stage ?? "-"} | ${c.status ?? "-"} | ${(c.oneLiner ?? "").slice(0, 90)}`).join("\n");
    const res = await structured({
      step: "BRAIN_PLAN",
      promptVersion: BRAIN_PLANNER.version,
      // Stable prefix (instructions + catalog) first so prompt caching applies across questions.
      instructions: `${plannerInstructions()}\n\nCOMPANY CATALOG (id | name | sector | stage | status | one-liner):\n${catalogText || "(empty)"}\n\nIC MEMBERS (id | name | role):\n${members.map((m) => `${m.id} | ${m.name} | ${m.role}`).join("\n") || "(none recorded)"}`,
      input: [
        {
          role: "user",
          content: wrapUntrusted(
            "conversation",
            JSON.stringify({
              contextCompany: contextCompany ? { id: contextCompany.id, name: contextCompany.name } : null,
              preResolved: { companyIds: mentions.companyIds, people: mentions.people, icMemberIds: mentions.icMemberIds },
              recentTurns: history.map((h) => `${h.role}: ${h.content.slice(0, 400)}`),
              question: inp.question,
            }),
          ),
        },
      ],
      schema: BrainPlan,
      schemaName: "brain_plan",
      maxOutputTokens: 700,
      effort: "none",
      cost,
      maxAttempts: 1,
    });
    plan = res.data;
    // Keep only ids that exist in this workspace.
    const valid = new Set(cat.map((c) => c.id));
    plan.companyIds = [...new Set([...plan.companyIds.filter((id) => valid.has(id)), ...mentions.companyIds])];
    const validMembers = new Set(members.map((m) => m.id));
    plan.icMemberIds = [...new Set([...plan.icMemberIds.filter((id) => validMembers.has(id)), ...mentions.icMemberIds])];
  } catch (e) {
    log.warn({ err: (e as Error).message }, "planner failed; using fallback plan");
    plan = fallbackPlan(mentions.companyIds, inp.contextCompanyId, inp.question);
  }
  yield { type: "plan", plan, ms: Date.now() - tPlan };

  // 3. Retrieval in parallel.
  yield { type: "status", text: "Retrieving from fund memory" };
  const scopeIds = plan.companyIds.length ? plan.companyIds : [];
  const kinds = plan.chunkKinds.length ? plan.chunkKinds : undefined;
  const wantsPassages = !!plan.semanticQuery || plan.lexicalTerms.length > 0;
  const [semanticHits, structuredItem] = await Promise.all([
    (async () => {
      if (!plan.semanticQuery) return [];
      try {
        const [vec] = await embed([plan.semanticQuery], cost, "BRAIN_EMBED");
        if (!vec) return [];
        if (plan.intent === "SIMILARITY") return semanticSearch(inp.workspaceId, vec, { excludeCompanyIds: scopeIds, distinctCompanies: true, k: 6 });
        return semanticSearch(inp.workspaceId, vec, { companyIds: scopeIds, kinds, k: 12 });
      } catch (e) {
        log.warn({ err: (e as Error).message }, "semantic search unavailable");
        return [];
      }
    })(),
    Promise.resolve(structuredQuery(inp.workspaceId, plan, cat)),
  ]);
  const lexicalHits = wantsPassages
    ? lexicalSearch(inp.workspaceId, [...plan.lexicalTerms, ...(plan.lexicalTerms.length ? [] : [plan.semanticQuery ?? inp.question])], { companyIds: plan.intent === "SIMILARITY" ? undefined : scopeIds, kinds, k: 12 })
    : [];
  const passageIds = fuse([semanticHits, lexicalHits], 60, plan.complexity === "DEEP" ? 12 : 8);

  // Companies surfaced by structured results or similarity also get their memory packs.
  const surfaced = new Set<string>(scopeIds);
  if (plan.intent === "SIMILARITY") semanticHits.forEach((h) => h.companyId && surfaced.add(h.companyId));
  if (structuredItem) for (const c of cat) if (structuredItem.text.includes(`(/deals/${c.slug})`)) surfaced.add(c.id);
  if (plan.intent === "PORTFOLIO_OVERVIEW" && surfaced.size === 0) cat.slice(0, 10).forEach((c) => surfaced.add(c.id));
  const packLimit = plan.complexity === "DEEP" ? 6 : 4;
  const packIds = [...surfaced].slice(0, Math.max(packLimit, scopeIds.length));
  const packs = [...prefetchPacks.filter((p) => packIds.includes(p.companyId!)), ...memoryPacks(inp.workspaceId, packIds.filter((id) => !prefetchPacks.some((p) => p.companyId === id)), surfaced.size > 4 ? 3500 : 7000)];

  const items: ContextItem[] = [];
  if (structuredItem) items.push(structuredItem);
  items.push(...packs);
  if (plan.needsFundBrain || plan.intent === "IC_PERSPECTIVE" || plan.intent === "FUND_STRATEGY" || plan.icMemberIds.length) items.push(...fundMemory(inp.workspaceId, plan.icMemberIds, true));
  else if (plan.intent === "RANK" || plan.intent === "COMPARE" || plan.intent === "CHALLENGE") items.push(...fundMemory(inp.workspaceId, [], false));
  if (plan.needsHistory || plan.intent === "HISTORY_WHY") items.push(...historyContext(inp.workspaceId, scopeIds, cat));
  if (plan.intent === "COMPARE" || plan.intent === "SIMILARITY" || plan.intent === "COMPANY_QA") {
    const g = graphContext(inp.workspaceId, [...surfaced].slice(0, 6), cat);
    if (g) items.push(g);
  }
  items.push(...chunkItems(passageIds));

  const citations = items.map((it, i) => ({ n: i + 1, title: it.title, href: it.href, label: it.label, kind: it.kind }));
  yield { type: "citations", items: citations };

  // 4. Answer.
  yield { type: "status", text: "Writing" };
  const fund = getDefaultFund(inp.workspaceId);
  const contextText = items.map((it, i) => `[${i + 1}] ${it.title}${it.label ? ` {${it.label}}` : ""}${it.href ? ` <${it.href}>` : ""}\n${it.text}`).join("\n\n");
  // The heavy thinking happened at ingestion; answers only need light reasoning (fast first token).
  const effort: Effort = plan.complexity === "SIMPLE" ? "none" : "low";
  const maxOut = plan.complexity === "SIMPLE" ? 900 : plan.complexity === "MODERATE" ? 1800 : 3500;
  let answer = "";
  let firstTokenMs: number | null = null;
  try {
    for await (const ev of stream({
      step: "BRAIN_ANSWER",
      promptVersion: BRAIN_ANSWER.version,
      instructions: answerInstructions(fund.name),
      input: [
        ...history.slice(-4).map((h) => ({ role: h.role, content: h.content.slice(0, 1500) }) as const),
        {
          role: "user",
          content: `${wrapUntrusted("fund records retrieved for this question", contextText || "(no records matched)")}\n\nCONTEXT COMPANY ON SCREEN: ${contextCompany ? `${contextCompany.name} (/deals/${contextCompany.slug})` : "none"}\nANSWER LANGUAGE: ${plan.language}\nQUESTION: ${inp.question}`,
        },
      ],
      maxOutputTokens: maxOut,
      effort,
      cost,
      signal: inp.signal,
      webSearch: plan.needsWeb ? { maxCalls: 2 } : undefined,
    })) {
      if (ev.type === "delta") {
        if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
        answer += ev.text;
        yield { type: "delta", text: ev.text };
      }
    }
  } catch (e) {
    const msg = (e as Error).message;
    log.error({ err: msg }, "answer failed");
    yield { type: "error", message: `The Fund Brain could not answer: ${msg.slice(0, 200)}` };
    if (!answer) return;
  }

  const messageId = newId("msg");
  const latencyMs = Date.now() - t0;
  db.insert(s.chatMessages)
    .values({ id: messageId, threadId, role: "assistant", content: answer, contextCompanyId: inp.contextCompanyId ?? null, citations, plan, costUsd: cost.spentUsd, latencyMs, firstTokenMs, createdAt: nowIso() })
    .run();
  db.update(s.chatThreads).set({ updatedAt: nowIso() }).where(eq(s.chatThreads.id, threadId)).run();
  yield { type: "done", messageId, costUsd: cost.spentUsd, latencyMs, firstTokenMs };
}
