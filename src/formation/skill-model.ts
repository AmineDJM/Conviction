/**
 * SKILL MODEL — Glicko-1 per skill, with exercises as opponents.
 *
 * Each skill has a rating θ (mean) and a rating deviation RD (uncertainty).
 * Each exercise has a difficulty b on the same scale (exercise.ts: level 1 =
 * 1050 … level 5 = 1650) and a fixed deviation RD_ITEM (the item difficulty is
 * a design estimate, not learned from a population).
 *
 * One graded attempt is one "game" with a fractional score s ∈ [0, 1]
 * (partial credit). With q = ln(10)/400:
 *
 *   g(RD)   = 1 / √(1 + 3q²RD²/π²)
 *   E       = 1 / (1 + 10^(−g(RD_ITEM)(θ − b)/400))          expected score
 *   d²      = 1 / (q² g² E (1 − E))
 *   RD'     = √(1 / (1/RD² + 1/d²))
 *   θ'      = θ + q · RD'² · g · (s − E)
 *
 * Before each attempt RD grows with inactivity: RD = min(RD_MAX, √(RD² + c²·t))
 * with t in days (c chosen so an unused skill returns to RD_MAX after ~2 years).
 *
 * Multi-skill exercises: the primary skill gets the full update; secondary
 * skills get the update with weight w = 0.5 (Δθ × w, and the information 1/d²
 * scaled by w). Properties (tested): θ' is increasing in s; RD' < RD; a score
 * above expectation raises θ; the selector targets items slightly below θ so
 * that expected success is ~0.6, which makes item difficulty rise with θ.
 *
 * The profile is a pure fold over the attempt history (replayable, auditable);
 * nothing is stored that cannot be recomputed from the attempts.
 */
import { SKILLS, type Skill } from "./types";

export const INITIAL_RATING = 1200;
export const RD_MAX = 350;
export const RD_MIN = 40;
export const RD_ITEM = 60;
/** Inactivity growth per day: RD_MAX² ≈ RD_MIN² + c²·730. */
export const C_PER_DAY = Math.sqrt((RD_MAX * RD_MAX - RD_MIN * RD_MIN) / 730);
export const SECONDARY_WEIGHT = 0.5;
/** Expert mode: mean rating ≥ this with RD ≤ EXPERT_RD on at least EXPERT_SKILLS skills. */
export const EXPERT_RATING = 1500;
export const EXPERT_RD = 150;
export const EXPERT_SKILLS = 3;
/** The selector aims for items at θ + TARGET_OFFSET (E ≈ 0.6). */
export const TARGET_SUCCESS = 0.6;

const Q = Math.log(10) / 400;

export interface SkillState {
  skill: Skill;
  rating: number;
  rd: number;
  n: number;
  lastAt: string | null;
  /** Mean score over attempts touching this skill. */
  meanScore: number | null;
}

export type SkillProfile = Record<Skill, SkillState>;

export function initialProfile(): SkillProfile {
  const p = {} as SkillProfile;
  for (const s of SKILLS) p[s] = { skill: s, rating: INITIAL_RATING, rd: RD_MAX, n: 0, lastAt: null, meanScore: null };
  return p;
}

export function g(rd: number): number {
  return 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
}

export function expectedScore(rating: number, difficulty: number, itemRd = RD_ITEM): number {
  return 1 / (1 + Math.pow(10, (-g(itemRd) * (rating - difficulty)) / 400));
}

/** Difficulty an item should have for the given expected success at this rating. */
export function targetDifficulty(rating: number, success = TARGET_SUCCESS, itemRd = RD_ITEM): number {
  return rating + (400 / g(itemRd)) * Math.log10(1 / success - 1);
}

export function inflateRd(rd: number, days: number): number {
  if (!(days > 0)) return rd;
  return Math.min(RD_MAX, Math.sqrt(rd * rd + C_PER_DAY * C_PER_DAY * days));
}

export interface UpdateResult {
  rating: number;
  rd: number;
  expected: number;
  delta: number;
}

/** One Glicko-1 update of a single skill against one item. `weight` ∈ (0, 1] scales the information. */
export function updateSkill(rating: number, rd: number, difficulty: number, score: number, weight = 1): UpdateResult {
  const s = Math.max(0, Math.min(1, score));
  const gi = g(RD_ITEM);
  const E = expectedScore(rating, difficulty);
  const d2inv = Q * Q * gi * gi * E * (1 - E) * weight;
  const newRdSq = 1 / (1 / (rd * rd) + d2inv);
  const delta = Q * newRdSq * gi * (s - E) * weight;
  return { rating: rating + delta, rd: Math.max(RD_MIN, Math.sqrt(newRdSq)), expected: E, delta };
}

export interface GradedObservation {
  at: string;
  skills: Skill[];
  difficulty: number;
  score: number;
}

export interface SkillEvent {
  at: string;
  skill: Skill;
  before: number;
  after: number;
  expected: number;
  score: number;
  difficulty: number;
}

/** Fold graded attempts (oldest first) into a profile. Deterministic. */
export function replayProfile(obs: GradedObservation[]): { profile: SkillProfile; events: SkillEvent[] } {
  const profile = initialProfile();
  const sums = {} as Record<Skill, number>;
  const events: SkillEvent[] = [];
  const sorted = [...obs].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  for (const o of sorted) {
    o.skills.forEach((skill, i) => {
      const st = profile[skill];
      if (!st) return;
      const days = st.lastAt ? (Date.parse(o.at) - Date.parse(st.lastAt)) / 864e5 : 0;
      const rd0 = inflateRd(st.rd, days);
      const u = updateSkill(st.rating, rd0, o.difficulty, o.score, i === 0 ? 1 : SECONDARY_WEIGHT);
      events.push({ at: o.at, skill, before: st.rating, after: u.rating, expected: u.expected, score: o.score, difficulty: o.difficulty });
      sums[skill] = (sums[skill] ?? 0) + o.score;
      profile[skill] = { skill, rating: u.rating, rd: u.rd, n: st.n + 1, lastAt: o.at, meanScore: sums[skill] / (st.n + 1) };
    });
  }
  return { profile, events };
}

/** Current RD after inactivity up to `now` (display and selection). */
export function currentRd(st: SkillState, now: Date): number {
  if (!st.lastAt) return st.rd;
  return inflateRd(st.rd, (now.getTime() - Date.parse(st.lastAt)) / 864e5);
}

/** Conservative rating (θ − 2·RD): what we are confident the user is at least. */
export function conservative(st: SkillState): number {
  return st.rating - 2 * st.rd;
}

export function isExpert(profile: SkillProfile): boolean {
  return Object.values(profile).filter((s) => s.rating >= EXPERT_RATING && s.rd <= EXPERT_RD).length >= EXPERT_SKILLS;
}

/** Plain-language band for a rating (no points, no levels to "unlock"). */
export const SETTLED_RD = 200;
export function band(st: SkillState): "Not assessed" | "Early read" | "Foundational" | "Developing" | "Proficient" | "Advanced" | "Expert" {
  if (st.n === 0) return "Not assessed";
  // Too uncertain to name a band: a single lucky (or unlucky) answer must not read as a level.
  if (st.rd > SETTLED_RD) return "Early read";
  const r = st.rating;
  return r < 1150 ? "Foundational" : r < 1300 ? "Developing" : r < 1450 ? "Proficient" : r < 1600 ? "Advanced" : "Expert";
}
