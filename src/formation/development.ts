/**
 * PERSONAL INVESTOR DEVELOPMENT — "What kind of investor are you becoming?"
 *
 * Tendencies are statements about repeated observed behaviour, each with its
 * count and examples. No personality inference. Below the minimum sample a
 * tendency reads "Not enough evidence yet".
 */
import { SKILL_LABEL } from "./labels";
import { bucketRank } from "./gen-judgment";
import { calibration } from "./calibration";
import { chronological, graded, type AttemptRecord } from "./records";
import type { SkillProfile } from "./skill-model";
import { CORRECT_THRESHOLD, type Skill } from "./types";

export const MIN_DECISIONS = 5;
export const MIN_SKILL_ATTEMPTS = 5;
export const MIN_CALIBRATION = 10;
export const MIN_SUBSET = 3;

export interface Tendency {
  id: string;
  area: string;
  status: "EVIDENCED" | "INSUFFICIENT";
  statement: string;
  n: number;
  needed: number;
  examples: string[];
}

const insufficient = (id: string, area: string, n: number, needed: number, what: string): Tendency => ({
  id,
  area,
  status: "INSUFFICIENT",
  statement: `Not enough evidence yet — ${n} of ${needed} ${what}.`,
  n,
  needed,
  examples: [],
});

function posture(id: string, area: string, rows: { gap: number; label: string }[], needed: number, scope: string): Tendency {
  if (rows.length < needed) return insufficient(id, area, rows.length, needed, "decisions needed");
  const mean = rows.reduce((a, r) => a + r.gap, 0) / rows.length;
  const below = rows.filter((r) => r.gap < 0);
  const above = rows.filter((r) => r.gap > 0);
  let statement: string;
  if (mean <= -0.4) statement = `More conservative than the analysis${scope}: below its call in ${below.length} of ${rows.length} decisions.`;
  else if (mean >= 0.4) statement = `More aggressive than the analysis${scope}: above its call in ${above.length} of ${rows.length} decisions.`;
  else statement = `Calibrated to the analysis${scope}: same call or one step away in ${rows.filter((r) => Math.abs(r.gap) <= 1).length} of ${rows.length} decisions.`;
  return { id, area, status: "EVIDENCED", statement, n: rows.length, needed, examples: (mean <= -0.4 ? below : mean >= 0.4 ? above : rows).slice(-3).map((r) => r.label) };
}

export function tendencies(all: AttemptRecord[], profile: SkillProfile): Tendency[] {
  const g = chronological(graded(all));
  const out: Tendency[] = [];

  // Decision posture (overall).
  const decisions = g.filter((a) => a.answer.type === "decision" && a.exercise.key.decisionBucket);
  const rows = decisions.map((a) => {
    const user = a.answer.type === "decision" ? a.answer.decision : "PASS";
    const key = a.exercise.key.decisionBucket!;
    return { gap: bucketRank(user) - bucketRank(key), label: `${a.exercise.case.name}: you — ${user.replace(/_/g, " ").toLowerCase()}, analysis — ${key.replace(/_/g, " ").toLowerCase()}`, a };
  });
  out.push(posture("posture", "Decision posture", rows, MIN_DECISIONS, ""));

  // Technical risk: decisions on deep tech / biotech cases or cases with a high technical risk.
  const tech = rows.filter((r) => r.a.exercise.skills.some((s) => s === "DEEPTECH" || s === "BIOTECH") || r.a.exercise.key.keyPoints.some((p) => p.kind === "RISK" && p.critical && /technical|technology|scientific|clinical/i.test(p.text)));
  out.push(posture("technical", "Technical risk", tech, MIN_SUBSET, " on technical risk"));

  // Founder assessment: pedigree reliance in graded open answers.
  const founderRubrics = g.filter((a) => a.grade.rubric && (a.exercise.kind === "DECISION" || a.exercise.kind === "OUTLIER" || a.exercise.kind === "BULL_BEAR"));
  if (founderRubrics.length < MIN_SKILL_ATTEMPTS) out.push(insufficient("pedigree", "Founder assessment", founderRubrics.length, MIN_SKILL_ATTEMPTS, "judgment answers needed"));
  else {
    const ped = founderRubrics.filter((a) => a.grade.rubric!.pedigreeReliance);
    out.push({
      id: "pedigree",
      area: "Founder assessment",
      status: "EVIDENCED",
      statement: ped.length / founderRubrics.length >= 0.4 ? `Leans on pedigree: ${ped.length} of ${founderRubrics.length} judgment answers cite schools or employers as evidence of quality.` : `Judges founders on capability, not pedigree: pedigree used as evidence in ${ped.length} of ${founderRubrics.length} judgment answers.`,
      n: founderRubrics.length,
      needed: MIN_SKILL_ATTEMPTS,
      examples: ped.slice(-2).map((a) => `${a.exercise.case.name} · ${a.exercise.title}`),
    });
  }

  // Risk versus upside: which does the user miss more often?
  const rub = g.filter((a) => a.grade.rubric);
  let riskTotal = 0;
  let riskMissed = 0;
  let upTotal = 0;
  let upMissed = 0;
  for (const a of rub) {
    riskTotal += a.exercise.key.keyPoints.filter((p) => p.critical && p.kind === "RISK").length;
    riskMissed += a.grade.rubric!.missedCriticalRiskIds.filter((id) => a.exercise.key.keyPoints.find((p) => p.id === id)?.kind === "RISK").length;
    upTotal += a.exercise.key.keyPoints.filter((p) => p.critical && p.kind === "OUTLIER").length;
    upMissed += a.grade.rubric!.missedOutlierIds.length;
  }
  if (rub.length < MIN_SKILL_ATTEMPTS || riskTotal < 5) out.push(insufficient("balance", "Risk versus upside", rub.length, MIN_SKILL_ATTEMPTS, "open answers needed"));
  else {
    const rr = riskMissed / riskTotal;
    const ur = upTotal ? upMissed / upTotal : null;
    out.push({
      id: "balance",
      area: "Risk versus upside",
      status: "EVIDENCED",
      statement:
        ur === null || upTotal < 3
          ? `Misses ${Math.round(rr * 100)}% of critical risks (${riskMissed} of ${riskTotal}); too few evidenced outlier signals so far to compare with upside.`
          : ur > rr + 0.15
            ? `Sees risk more readily than upside: misses ${Math.round(ur * 100)}% of outlier signals versus ${Math.round(rr * 100)}% of critical risks.`
            : rr > ur + 0.15
              ? `Sees upside more readily than risk: misses ${Math.round(rr * 100)}% of critical risks versus ${Math.round(ur * 100)}% of outlier signals.`
              : `Balanced between risk and upside: misses ${Math.round(rr * 100)}% of critical risks and ${Math.round(ur * 100)}% of outlier signals.`,
      n: rub.length,
      needed: MIN_SKILL_ATTEMPTS,
      examples: [],
    });
  }

  // Calibration.
  const cal = calibration(g.map((a) => ({ confidence: a.confidence, correct: a.grade.score >= CORRECT_THRESHOLD })));
  if (cal.n < MIN_CALIBRATION) out.push(insufficient("calibration", "Calibration", cal.n, MIN_CALIBRATION, "answers with stated confidence needed"));
  else
    out.push({
      id: "calibration",
      area: "Calibration",
      status: "EVIDENCED",
      statement:
        cal.overconfidence! >= 0.1
          ? `Overconfident: states ${Math.round(cal.meanConfidence! * 100)}% confidence on average, right ${Math.round(cal.hitRate! * 100)}% of the time.`
          : cal.overconfidence! <= -0.1
            ? `Underconfident: states ${Math.round(cal.meanConfidence! * 100)}% confidence on average, right ${Math.round(cal.hitRate! * 100)}% of the time.`
            : `Well calibrated: ${Math.round(cal.meanConfidence! * 100)}% stated confidence against a ${Math.round(cal.hitRate! * 100)}% hit rate (Brier ${cal.brier!.toFixed(3)}).`,
      n: cal.n,
      needed: MIN_CALIBRATION,
      examples: [],
    });

  // Skill strengths and gaps (need both enough attempts and a settled rating).
  const skills = Object.values(profile).filter((s) => s.n >= MIN_SKILL_ATTEMPTS && s.meanScore !== null);
  const strong = skills.filter((s) => s.meanScore! >= 0.75).sort((a, b) => b.rating - a.rating);
  const weak = skills.filter((s) => s.meanScore! <= 0.45).sort((a, b) => a.rating - b.rating);
  const attemptsBySkill = (skill: Skill) => g.filter((a) => a.exercise.skills.includes(skill));
  if (!skills.length) out.push(insufficient("strengths", "Strengths", Math.max(0, ...Object.values(profile).map((s) => s.n)), MIN_SKILL_ATTEMPTS, "exercises in any one skill needed"));
  for (const s of strong.slice(0, 3))
    out.push({ id: `strong-${s.skill}`, area: "Strength", status: "EVIDENCED", statement: `Strong on ${SKILL_LABEL[s.skill].toLowerCase()}: ${Math.round(s.meanScore! * 100)}/100 average over ${s.n} exercises.`, n: s.n, needed: MIN_SKILL_ATTEMPTS, examples: attemptsBySkill(s.skill).slice(-2).map((a) => `${a.exercise.case.name} · ${a.exercise.title}`) });
  for (const s of weak.slice(0, 3))
    out.push({ id: `weak-${s.skill}`, area: "Gap", status: "EVIDENCED", statement: `Still developing ${SKILL_LABEL[s.skill].toLowerCase()}: ${Math.round(s.meanScore! * 100)}/100 average over ${s.n} exercises.`, n: s.n, needed: MIN_SKILL_ATTEMPTS, examples: attemptsBySkill(s.skill).slice(-2).map((a) => `${a.exercise.case.name} · ${a.exercise.title}`) });
  return out;
}
