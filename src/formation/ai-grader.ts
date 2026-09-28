/**
 * Open-answer grading with one structured model call (gpt-5.6-luna, effort
 * "low"), budget-capped per attempt (hard cap < $0.01), cached on the
 * (exercise, key, answer) triple, prompt-injection-safe (rubric.ts), cost
 * recorded through the CostController into cost_records (scope FORMATION).
 *
 * Any failure — no credentials, network, budget refusal, invalid output —
 * falls back to the deterministic heuristic rubric, labelled as such.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { CostController, type CostEntry } from "@/ai/cost";
import { PRIMARY_MODEL, structured } from "@/ai/openai";
import { getDb, schema, type DB } from "@/db/client";
import { heuristicRubric, buildRubricRequest, RubricOutput, RUBRIC_PROMPT_VERSION, toRubricResult, MAX_ANSWER_CHARS } from "./rubric";
import type { Exercise, RubricResult } from "./types";

/** Hard cap per graded attempt. */
export const FORMATION_GRADE_CAP_USD = 0.009;
export const FORMATION_GRADE_TARGET_USD = 0.004;
export const FORMATION_GRADE_MAX_OUTPUT_TOKENS = 1400;
export const FORMATION_GRADE_STEP = "formation_grade";

export interface ModelCall {
  (req: { instructions: string; input: ReturnType<typeof buildRubricRequest>["input"]; cost: CostController }): Promise<RubricOutput>;
}

export interface GraderDeps {
  workspaceId: string;
  /** Records a cost entry (default: repo.recordCost with scope FORMATION). */
  onCost?: (e: CostEntry) => void | Promise<void>;
  /** Injected model call (tests); default: structured() on the Responses API. */
  call?: ModelCall;
  db?: DB;
  /** Force the heuristic grader (FORMATION_GRADER=heuristic). */
  heuristicOnly?: boolean;
}

export function rubricCacheKey(ex: Exercise, answerText: string, model = PRIMARY_MODEL): string {
  const norm = answerText.slice(0, MAX_ANSWER_CHARS).replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256")
    .update(JSON.stringify({ v: RUBRIC_PROMPT_VERSION, model, ex: ex.id, key: ex.key.keyPoints.map((p) => [p.id, p.kind, p.critical, p.text]), a: norm }))
    .digest("hex");
}

const defaultCall: ModelCall = async ({ instructions, input, cost }) => {
  const r = await structured({
    step: FORMATION_GRADE_STEP,
    promptVersion: RUBRIC_PROMPT_VERSION,
    instructions,
    input,
    schema: RubricOutput,
    schemaName: "formation_rubric",
    maxOutputTokens: FORMATION_GRADE_MAX_OUTPUT_TOKENS,
    effort: "low",
    cost,
    maxAttempts: 1,
    signal: AbortSignal.timeout(25_000),
  });
  return r.data;
};

export interface RubricOutcome {
  rubric: RubricResult;
  costUsd: number;
  fallbackReason: string | null;
}

export async function gradeOpenAnswer(ex: Exercise, answerText: string, deps: GraderDeps): Promise<RubricOutcome> {
  if (deps.heuristicOnly || process.env.FORMATION_GRADER === "heuristic") return { rubric: heuristicRubric(ex, answerText), costUsd: 0, fallbackReason: "Heuristic grader forced by configuration." };
  const db = deps.db ?? getDb();
  const onCost = deps.onCost ?? (async (e: CostEntry) => (await import("@/server/repo")).recordCost(deps.workspaceId, null, "FORMATION", e, db));
  const cost = new CostController(FORMATION_GRADE_CAP_USD, FORMATION_GRADE_TARGET_USD, onCost);
  const key = rubricCacheKey(ex, answerText);
  try {
    const hit = db.select().from(schema.llmCache).where(eq(schema.llmCache.key, key)).get();
    const parsed = hit ? RubricOutput.safeParse(hit.output) : null;
    if (parsed?.success) {
      await cost.record({ step: `${FORMATION_GRADE_STEP}:cache`, model: PRIMARY_MODEL, promptVersion: RUBRIC_PROMPT_VERSION, usage: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, webSearches: 0 }, estimatedUsd: 0, actualUsd: 0, latencyMs: 0, toolCalls: 0 });
      return { rubric: toRubricResult(ex, parsed.data, { method: "MODEL", costUsd: 0, cached: true }), costUsd: 0, fallbackReason: null };
    }
  } catch {
    /* cache is best-effort */
  }
  try {
    const req = buildRubricRequest(ex, answerText);
    const out = await (deps.call ?? defaultCall)({ ...req, cost });
    const valid = RubricOutput.parse(out);
    try {
      db.insert(schema.llmCache)
        .values({ key, step: FORMATION_GRADE_STEP, model: PRIMARY_MODEL, promptVersion: RUBRIC_PROMPT_VERSION, output: valid as never, usage: {} as never, hits: 0, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();
    } catch {
      /* best-effort */
    }
    return { rubric: toRubricResult(ex, valid, { method: "MODEL", costUsd: cost.spentUsd, cached: false }), costUsd: cost.spentUsd, fallbackReason: null };
  } catch (e) {
    return { rubric: heuristicRubric(ex, answerText), costUsd: cost.spentUsd, fallbackReason: (e as Error).message.slice(0, 200) };
  }
}
