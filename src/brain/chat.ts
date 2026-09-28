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
import { getDefaultFund, recordCost, getCompany, getCurrentVersion, type LoadedVersion } from "@/server/repo";
import { deckChangeLines, deckComparisonForVersion } from "@/server/deck-versions";
import { applyOverrides } from "@/engine/overrides";

/** Questions about how the pitch evolved between two decks (EN/FR). */
export const DECK_CHANGE_QUESTION = /(since the (last|previous|prior|first) deck|(new|latest|previous|last|old|first|second) deck|deck v?\d|deck.{0,20}(chang|differ|compar)|(chang|differ|restat|compar).{0,40}deck|restat|stopped (talking|mentioning)|no longer (report|mention)|dernier deck|nouveau deck|ancien deck|pr[ée]c[ée]dent deck|deck pr[ée]c[ée]dent|entre les (deux )?decks|a chang[ée].{0,30}deck|ne parle plus)/i;
import { getRegistry } from "@/engine/benchmarks";
import { answerFact, detectFactQuestion, detectLanguage } from "./fast-path";
import { detectCompute, economicsContext, runCompute } from "./compute";
import { fragileVariables, matchMembers, premortemText, PREMORTEM_QUESTION, type PremortemMember } from "./premortem";
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
import { BRAIN_VERIFY, VerifyOutput, applyVerification, citedUnits, splitAnswer, verifyInput, verifyInstructions, type VerificationStats } from "./verify-citations";

const s = schema;

export type BrainEvent =
  | { type: "thread"; threadId: string }
  | { type: "status"; text: string }
  | { type: "plan"; plan: BrainPlan; ms: number }
  | {
      type: "citations";
      items: {
        n: number;
        title: string;
        href: string | null;
        label: string | null;
        kind: string;
      }[];
    }
  | { type: "delta"; text: string }
  /** The streamed answer after citation verification: replaces the displayed text. */
  | { type: "revision"; text: string; stats: VerificationStats }
  | {
      type: "done";
      messageId: string;
      costUsd: number;
      latencyMs: number;
      firstTokenMs: number | null;
    }
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

/** Questions that reach beyond one deal's record → the planner decides. */
const BEYOND_ONE_DEAL =
  /compar|versus|\bvs\b|portfolio|portefeuille|\bfonds\b|\bfund\b|autres (deals|dossiers|soci)|other (deals|companies)|similar|similaire|d[ée]j[àa] vu|seen before|why did we|pourquoi (on a|nous avons|avons-nous) pass|historique|history|\bweb\b|news|actualit|meilleur|best deal|top \d|classement|rank/i;
const IC_WORDS = /\bIC\b|comit[ée]|partner|associ[ée]|chez (nous|vu)|\bVU\b|who will|qui va|member|membre|senior/i;

function premortemMembers(workspaceId: string): PremortemMember[] {
  const db = getDb();
  const obs = db.select().from(s.icObservations).where(eq(s.icObservations.workspaceId, workspaceId)).all();
  return db
    .select()
    .from(s.icMembers)
    .where(eq(s.icMembers.workspaceId, workspaceId))
    .all()
    .map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      focus: m.focus,
      documentedPreferences: m.documentedPreferences,
      observations: obs
        .filter((o) => o.memberId === m.id)
        .map((o) => ({
          kind: o.kind,
          statement: o.statement,
          topic: o.topic,
          provenance: o.provenance,
          observedAt: o.observedAt,
          companyId: o.companyId,
        })),
    }));
}

function fallbackPlan(mentions: string[], contextCompanyId: string | null | undefined, question: string): BrainPlan {
  const ids = mentions.length ? mentions : contextCompanyId ? [contextCompanyId] : [];
  return {
    intent: ids.length ? "COMPANY_QA" : "GENERAL",
    language: detectLanguage(question),
    companyIds: ids,
    icMemberIds: [],
    metricFilters: [],
    attributeFilters: {
      industry: null,
      stage: null,
      decisionStatus: null,
      technology: null,
    },
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
    const t = db
      .select()
      .from(s.chatThreads)
      .where(and(eq(s.chatThreads.id, threadId), eq(s.chatThreads.workspaceId, inp.workspaceId)))
      .get();
    if (!t) threadId = null;
  }
  if (!threadId) {
    threadId = newId("thr");
    db.insert(s.chatThreads)
      .values({
        id: threadId,
        workspaceId: inp.workspaceId,
        userId: inp.userId,
        title: inp.question.slice(0, 80),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
      .run();
  }
  yield { type: "thread", threadId };
  const history = threadHistory(threadId);
  db.insert(s.chatMessages)
    .values({
      id: newId("msg"),
      threadId,
      role: "user",
      content: inp.question,
      contextCompanyId: inp.contextCompanyId ?? null,
      createdAt: nowIso(),
    })
    .run();

  // 1. Deterministic resolution + speculative prefetch.
  const cat = catalog(inp.workspaceId);
  const members = icMembers(inp.workspaceId);
  const mentions = resolveMentions(inp.workspaceId, inp.question, cat);
  const speculativeIds = [...new Set([...mentions.companyIds, ...(inp.contextCompanyId ? [inp.contextCompanyId] : [])])];
  const prefetchPacks = memoryPacks(inp.workspaceId, speculativeIds);
  const contextCompany = cat.find((c) => c.id === inp.contextCompanyId);

  // Single-deal scope: the named company, else the one on screen.
  // Homonyms (several dossiers with the same name, e.g. successive decks) resolve to the most recently updated one, said explicitly.
  let homonymNote: string | null = null;
  let mentioned = mentions.companyIds;
  if (mentioned.length > 1) {
    const rows = mentioned.map((id) => getCompany(inp.workspaceId, id)).filter((r): r is NonNullable<typeof r> => !!r);
    if (rows.length > 1 && new Set(rows.map((r) => r.normName)).size === 1) {
      const latest = [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]!;
      mentioned = [latest.id];
      homonymNote = `${rows.length}|${latest.name}|${latest.updatedAt.slice(0, 10)}`;
    }
  }
  const scopeCompanyId = mentioned.length === 1 ? mentioned[0]! : mentioned.length === 0 ? (inp.contextCompanyId ?? null) : null;
  const scopeEntry = scopeCompanyId ? cat.find((c) => c.id === scopeCompanyId) : undefined;
  let scopeVersion: LoadedVersion | null | undefined;
  const loadScope = () => {
    if (scopeVersion === undefined) {
      const row = scopeCompanyId ? getCompany(inp.workspaceId, scopeCompanyId) : undefined;
      const v = row ? getCurrentVersion(row) : null;
      // The effective deal (raw extraction + analyst overrides): the same object every view renders and derive() scored.
      scopeVersion = v ? { ...v, canonical: applyOverrides(v.canonical) } : null;
    }
    return scopeVersion;
  };

  // 1b. Deterministic fast path: a single fact about a single deal, read from the canonical record (<1 s, no model).
  const fact = scopeEntry && mentions.icMemberIds.length === 0 ? detectFactQuestion(inp.question) : null;
  if (fact && scopeEntry && loadScope()) {
    const lang = detectLanguage(inp.question);
    const a = answerFact(fact, { name: scopeEntry.name, slug: scopeEntry.slug }, loadScope()!.canonical, lang);
    if (homonymNote) {
      const [n, name, date] = homonymNote.split("|");
      a.text += lang === "fr" ? `\n\n_${n} dossiers portent le nom « ${name} » ; réponse sur le plus récent (mis à jour le ${date})._` : `\n\n_${n} dossiers are named “${name}”; answering on the most recent (updated ${date})._`;
    }
    // Entity resolution: a former name / linked dossier is said explicitly, never silently substituted.
    for (const al of mentions.aliases.filter((x) => x.companyId === scopeEntry.id))
      a.text += lang === "fr" ? `\n\n_« ${al.mention} » renvoie à ${al.name} (${al.relation === "FORMER_NAME" ? "ancien nom" : "dossier lié"})._` : `\n\n_“${al.mention}” resolves to ${al.name} (${al.relation === "FORMER_NAME" ? "former name" : "linked dossier"})._`;
    yield { type: "citations", items: a.citations };
    yield { type: "delta", text: a.text };
    const messageId = newId("msg");
    const latencyMs = Date.now() - t0;
    db.insert(s.chatMessages)
      .values({
        id: messageId,
        threadId,
        role: "assistant",
        content: a.text,
        contextCompanyId: inp.contextCompanyId ?? null,
        citations: a.citations,
        plan: { intent: "FAST_FACT", factKey: a.factKey, found: a.found },
        costUsd: 0,
        latencyMs,
        firstTokenMs: latencyMs,
        createdAt: nowIso(),
      })
      .run();
    db.update(s.chatThreads).set({ updatedAt: nowIso() }).where(eq(s.chatThreads.id, threadId)).run();
    yield {
      type: "done",
      messageId,
      costUsd: 0,
      latencyMs,
      firstTokenMs: latencyMs,
    };
    return;
  }

  // Deterministic extras for single-deal questions: engine computations and the IC pre-mortem.
  const extraItems: ContextItem[] = [];
  const compute = scopeEntry ? detectCompute(inp.question) : null;
  if (compute && loadScope()) {
    try {
      const v = loadScope()!;
      const r = runCompute(compute, economicsContext(v.canonical, v.derived, getRegistry(v.row.registryId), getDefaultFund(inp.workspaceId)));
      extraItems.push({
        kind: "TABLE",
        title: `${scopeEntry!.name} — ${r.title}`,
        text: r.text,
        href: `/deals/${scopeEntry!.slug}/returns`,
        label: "COMPUTED",
        companyId: scopeCompanyId,
      });
    } catch (e) {
      log.warn({ err: (e as Error).message }, "computation failed");
    }
  }
  // Deck v2+: "what changed since the last deck" is computed from the two stored analyses and handed over as COMPUTED.
  if (scopeEntry && DECK_CHANGE_QUESTION.test(inp.question) && loadScope()) {
    const v = loadScope()!;
    try {
      const lines = deckChangeLines(deckComparisonForVersion(scopeCompanyId!, v.row.id), 14);
      if (lines.length)
        extraItems.push({ kind: "TABLE", title: `${scopeEntry.name} — what changed since the last deck`, text: lines.join("\n"), href: `/deals/${scopeEntry.slug}/history#deck`, label: "COMPUTED", companyId: scopeCompanyId });
    } catch (e) {
      log.warn({ err: (e as Error).message }, "deck comparison failed");
    }
  }
  const premortem = !!scopeEntry && ((PREMORTEM_QUESTION.test(inp.question) && IC_WORDS.test(inp.question)) || mentions.icMemberIds.length > 0);
  const allMembers = premortem ? premortemMembers(inp.workspaceId) : [];
  if (premortem && loadScope()) {
    const v = loadScope()!;
    const vars = fragileVariables(v.canonical, v.derived);
    const scoped = mentions.icMemberIds.length ? allMembers.filter((m) => mentions.icMemberIds.includes(m.id)) : allMembers;
    extraItems.push({
      kind: "IC",
      title: `${scopeEntry!.name} — IC pre-mortem inputs`,
      text: premortemText(scopeEntry!.name, vars, scoped, matchMembers(scoped, vars, scopeCompanyId), scopeCompanyId),
      href: `/deals/${scopeEntry!.slug}/risks`,
      label: "COMPUTED",
      companyId: scopeCompanyId,
    });
  }

  // 2. Plan: direct for single-deal questions (no planner round-trip), planner otherwise.
  const tPlan = Date.now();
  let plan: BrainPlan;
  const direct = !!scopeEntry && (premortem || compute !== null || (mentions.icMemberIds.length === 0 && !BEYOND_ONE_DEAL.test(inp.question)));
  if (direct) {
    const base = fallbackPlan([scopeCompanyId!], inp.contextCompanyId, inp.question);
    plan = {
      ...base,
      intent: premortem ? "IC_PERSPECTIVE" : "COMPANY_QA",
      icMemberIds: premortem ? (mentions.icMemberIds.length ? mentions.icMemberIds : allMembers.map((m) => m.id)) : [],
      semanticQuery: null,
      lexicalTerms: [inp.question],
      needsFundBrain: premortem,
      complexity: premortem || compute || inp.question.length > 160 || /challenge|th[èe]se|thesis|risque|risk|pourquoi|why|explain|expliqu/i.test(inp.question) ? "MODERATE" : "SIMPLE",
    };
  } else {
    yield { type: "status", text: "Understanding the question" };
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
                preResolved: {
                  companyIds: mentions.companyIds,
                  people: mentions.people,
                  icMemberIds: mentions.icMemberIds,
                  aliases: mentions.aliases.map((x) => `${x.mention} → ${x.name} (${x.relation === "FORMER_NAME" ? "former name" : "linked dossier"})`),
                },
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
        if (plan.intent === "SIMILARITY")
          return semanticSearch(inp.workspaceId, vec, {
            excludeCompanyIds: scopeIds,
            distinctCompanies: true,
            k: 6,
          });
        return semanticSearch(inp.workspaceId, vec, {
          companyIds: scopeIds,
          kinds,
          k: 12,
        });
      } catch (e) {
        log.warn({ err: (e as Error).message }, "semantic search unavailable");
        return [];
      }
    })(),
    Promise.resolve(structuredQuery(inp.workspaceId, plan, cat)),
  ]);
  const lexicalHits = wantsPassages
    ? lexicalSearch(inp.workspaceId, [...plan.lexicalTerms, ...(plan.lexicalTerms.length ? [] : [plan.semanticQuery ?? inp.question])], {
        companyIds: plan.intent === "SIMILARITY" ? undefined : scopeIds,
        kinds,
        k: 12,
      })
    : [];
  const passageIds = fuse([semanticHits, lexicalHits], 60, plan.complexity === "DEEP" ? 12 : 8);

  // Companies surfaced by structured results or similarity also get their memory packs.
  const surfaced = new Set<string>(scopeIds);
  if (plan.intent === "SIMILARITY") semanticHits.forEach((h) => h.companyId && surfaced.add(h.companyId));
  if (structuredItem) for (const c of cat) if (structuredItem.text.includes(`(/deals/${c.slug})`)) surfaced.add(c.id);
  if (plan.intent === "PORTFOLIO_OVERVIEW" && surfaced.size === 0) cat.slice(0, 10).forEach((c) => surfaced.add(c.id));
  const packLimit = plan.complexity === "DEEP" ? 6 : 4;
  const packIds = [...surfaced].slice(0, Math.max(packLimit, scopeIds.length));
  const packs = [
    ...prefetchPacks.filter((p) => packIds.includes(p.companyId!)),
    ...memoryPacks(
      inp.workspaceId,
      packIds.filter((id) => !prefetchPacks.some((p) => p.companyId === id)),
      surfaced.size > 4 ? 3500 : 7000,
    ),
  ];

  const items: ContextItem[] = [...extraItems];
  if (mentions.aliases.length)
    items.push({ kind: "GRAPH", title: "Name resolution (entity graph)", text: mentions.aliases.map((x) => `“${x.mention}” resolves to ${x.name} — ${x.relation === "FORMER_NAME" ? "former name" : "linked dossier"}: ${x.evidence.slice(0, 240)}`).join("\n"), href: null, label: "STRUCTURED", companyId: mentions.aliases[0]!.companyId });
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

  const citations = items.map((it, i) => ({
    n: i + 1,
    title: it.title,
    href: it.href,
    label: it.label,
    kind: it.kind,
  }));
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
    yield {
      type: "error",
      message: `The Fund Brain could not answer: ${msg.slice(0, 200)}`,
    };
    if (!answer) return;
  }

  // 5. Citation verification: every cited sentence is checked against exactly the items it cites; code rewrites
  // unsupported parts (trim or uncited inference). The first token is unaffected; the final text replaces the draft.
  let verification: (VerificationStats & { error?: string }) | null = null;
  // A citation to an item that was not in the context supports nothing: removed by code before any check.
  const dangling = answer.replace(/\[(\d+)\]/g, (m, n: string) => (Number(n) >= 1 && Number(n) <= items.length ? m : ""));
  if (dangling !== answer) {
    answer = dangling.replace(/[ \t]+([.,;!?])/g, "$1");
    yield { type: "revision", text: answer, stats: { checked: 0, supported: 0, trimmed: 0, inference: 0, refused: 0 } };
  }
  const units = citedUnits(splitAnswer(answer).pieces);
  if (answer && units.length) {
    yield { type: "status", text: "Checking citations" };
    const seen = items.map((it, i) => ({ n: i + 1, text: `${it.title}${it.label ? ` {${it.label}}` : ""}${it.href ? ` <${it.href}>` : ""}\n${it.text}` }));
    try {
      const v = await structured({
        step: "BRAIN_VERIFY",
        promptVersion: BRAIN_VERIFY.version,
        instructions: verifyInstructions(),
        input: [{ role: "user", content: verifyInput(units, seen) }],
        schema: VerifyOutput,
        schemaName: "brain_verify",
        maxOutputTokens: Math.min(2500, 200 + units.length * 120),
        effort: "none",
        cost,
        signal: inp.signal,
        cache: true,
      });
      const applied = applyVerification(answer, v.data, plan.language === "fr" ? "fr" : "en");
      verification = applied.stats;
      if (applied.text !== answer) {
        answer = applied.text;
        yield { type: "revision", text: answer, stats: applied.stats };
      }
    } catch (e) {
      // Never block the answer: an unverified answer is stored as such.
      verification = { checked: units.length, supported: 0, trimmed: 0, inference: 0, refused: 0, error: (e as Error).message.slice(0, 200) };
      log.error({ err: (e as Error).message }, "citation verification failed");
    }
  }

  const messageId = newId("msg");
  const latencyMs = Date.now() - t0;
  db.insert(s.chatMessages)
    .values({
      id: messageId,
      threadId,
      role: "assistant",
      content: answer,
      contextCompanyId: inp.contextCompanyId ?? null,
      citations,
      plan: verification ? { ...plan, verification } : plan,
      costUsd: cost.spentUsd,
      latencyMs,
      firstTokenMs,
      createdAt: nowIso(),
    })
    .run();
  db.update(s.chatThreads).set({ updatedAt: nowIso() }).where(eq(s.chatThreads.id, threadId)).run();
  yield {
    type: "done",
    messageId,
    costUsd: cost.spentUsd,
    latencyMs,
    firstTokenMs,
  };
}
