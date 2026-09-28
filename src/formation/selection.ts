/**
 * ADAPTIVE SELECTION — which exercise next.
 *
 * For every candidate exercise (all cases, or one case):
 *   fit      = exp(−((b − b*)/150)²), b* = targetDifficulty(θ_primary) (E ≈ 0.6)
 *   need     = RD/RD_MAX                         (explore uncertain skills)
 *            + 1.0 if a key concept is a detected weakness
 *            + 0.8 if it drills a recurring mistake
 *   expert   = +0.5 for expert items in expert mode; expert level-5 items are
 *              held back (−0.3) until the profile is expert
 *   novelty  = −0.3 if the case was used in the last 3 attempts,
 *              −0.4 if the kind was used in the last 2; answered exercises are
 *              excluded until the pool is exhausted (then −1, oldest first)
 *   score    = fit × (1 + need) + expert + novelty   (ties broken by a seeded hash)
 *
 * Every DRILL_EVERY-th attempt, if a mistake is recurring, the selection is
 * restricted to that mistake's drill (periodic targeted drills). An explicit
 * drill request restricts it always. Deterministic given its inputs.
 */
import { hashInt } from "./format";
import type { AttemptRecord } from "./records";
import { RD_MAX, targetDifficulty, isExpert, type SkillProfile } from "./skill-model";
import type { Weakness } from "./weaknesses";
import { MISTAKE_DRILL, MISTAKE_LABEL, type MistakeEntry, type MistakeKind } from "./mistakes";
import { CONCEPT_LABEL, SKILL_LABEL } from "./labels";
import type { Exercise, ExerciseKind } from "./types";

export const DRILL_EVERY = 4;

export interface SelectionOptions {
  caseId?: string | null;
  kind?: ExerciseKind | null;
  drill?: MistakeKind | null;
  expertMode?: boolean;
  seed?: string;
}

export interface Selection {
  exercise: Exercise;
  reason: string;
  drill: MistakeKind | null;
  targetDifficulty: number;
  expertMode: boolean;
}

export function selectNext(candidates: Exercise[], history: AttemptRecord[], profile: SkillProfile, weaknesses: Weakness[], mistakes: MistakeEntry[], opts: SelectionOptions = {}): Selection | null {
  let pool = candidates;
  if (opts.caseId) pool = pool.filter((e) => e.case.companyId === opts.caseId || e.case.slug === opts.caseId);
  if (opts.kind) pool = pool.filter((e) => e.kind === opts.kind);
  if (!pool.length) return null;

  const expertMode = opts.expertMode ?? isExpert(profile);
  const recurring = mistakes.filter((m) => m.recurring);
  let drill: MistakeKind | null = opts.drill ?? null;
  if (!drill && recurring.length && history.length > 0 && history.length % DRILL_EVERY === DRILL_EVERY - 1) drill = recurring[0]!.kind;
  if (drill) {
    const spec = MISTAKE_DRILL[drill];
    const drillPool = pool.filter((e) => spec.kinds.includes(e.kind) || e.key.concepts.some((c) => spec.concepts.includes(c)));
    if (drillPool.length) pool = drillPool;
    else drill = null;
  }

  // Answered exercises come back only once everything in the pool has been answered (then least-recent first).
  const answered = new Set(history.map((a) => a.exercise.id));
  const fresh = pool.filter((e) => !answered.has(e.id));
  if (fresh.length) pool = fresh;
  const lastAnswered = new Map<string, number>();
  history.forEach((a, i) => lastAnswered.set(a.exercise.id, i + 1));
  const recent = [...history].sort((a, b) => (a.answeredAt < b.answeredAt ? 1 : -1));
  const recentCases = new Set(recent.slice(0, 3).map((a) => a.exercise.case.companyId));
  const recentKinds = new Set(recent.slice(0, 2).map((a) => a.exercise.kind));
  const weakConcepts = new Set(weaknesses.map((w) => w.concept));
  const recurringConcepts = new Set(recurring.flatMap((m) => MISTAKE_DRILL[m.kind].concepts));
  const seed = opts.seed ?? String(history.length);

  let best: { e: Exercise; score: number; tie: number; b: number; why: string } | null = null;
  for (const e of pool) {
    const primary = e.skills[0];
    const st = primary ? profile[primary] : null;
    const theta = st?.rating ?? 1200;
    const b = targetDifficulty(theta);
    const fit = Math.exp(-Math.pow((e.difficulty - b) / 150, 2));
    const weak = e.key.concepts.find((c) => weakConcepts.has(c));
    const mistake = e.key.concepts.find((c) => recurringConcepts.has(c));
    const need = (st ? st.rd / RD_MAX : 1) + (weak ? 1 : 0) + (mistake ? 0.8 : 0);
    let score = fit * (1 + need);
    if (e.expert && expertMode) score += 0.5;
    if (e.expert && !expertMode && e.level >= 5) score -= 0.3;
    if (recentCases.has(e.case.companyId)) score -= 0.3;
    if (recentKinds.has(e.kind)) score -= 0.4;
    if (answered.has(e.id)) score -= 1 + (lastAnswered.get(e.id) ?? 0) / Math.max(1, history.length);
    const tie = hashInt(`${seed}:${e.id}`) / 2 ** 32;
    const why = drill
      ? `Targeted drill: ${MISTAKE_LABEL[drill].toLowerCase()}${recurring.find((m) => m.kind === drill) ? ` (${recurring.find((m) => m.kind === drill)!.count}× in your mistake library)` : ""}.`
      : weak
        ? `Targets a recurring weakness: ${CONCEPT_LABEL[weak]}.`
        : st && st.rd > 200
          ? `Your estimate in ${primary ? SKILL_LABEL[primary] : "this skill"} is still uncertain.`
          : `Matched to your level in ${primary ? SKILL_LABEL[primary] : "this skill"}.`;
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && tie > best.tie)) best = { e, score, tie, b, why };
  }
  if (!best) return null;
  return { exercise: best.e, reason: best.why, drill, targetDifficulty: best.b, expertMode };
}
