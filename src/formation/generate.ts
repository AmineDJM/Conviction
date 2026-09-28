/**
 * All exercises a training case supports. Deterministic: the same case
 * version always yields the same exercises with the same ids, so an answer can
 * be matched to its exercise without storing any pre-answer state.
 */
import type { TrainingCase } from "./case";
import { concernExercise, missingMetricExercise, pmfSignalExercise } from "./gen-choice";
import { numericExercises } from "./gen-numeric";
import { omissionsExercise, statementsExercise } from "./gen-forensics";
import { founderQuestionsExercise } from "./founder-questions";
import { bullBearExercise, decisionExercise, nextMetricExercise, outlierExercise, passTriggerExercise, thesisExercise, twentyXExercise } from "./gen-judgment";
import type { Exercise } from "./types";

export function generateExercises(c: TrainingCase): Exercise[] {
  const out: (Exercise | null)[] = [
    concernExercise(c),
    pmfSignalExercise(c),
    missingMetricExercise(c),
    ...numericExercises(c),
    statementsExercise(c),
    omissionsExercise(c),
    founderQuestionsExercise(c),
    decisionExercise(c),
    bullBearExercise(c),
    outlierExercise(c),
    thesisExercise(c),
    nextMetricExercise(c),
    passTriggerExercise(c),
    twentyXExercise(c),
  ];
  return out.filter((x): x is Exercise => !!x);
}

export function findExercise(c: TrainingCase, exerciseId: string): Exercise | null {
  return generateExercises(c).find((e) => e.id === exerciseId) ?? null;
}
