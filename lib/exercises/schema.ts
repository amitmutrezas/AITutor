import { z } from "zod";

/** E1: an exercise record. Levels 1-5 map to fallbackHints[0..4]. */
export const EXERCISE_STATUSES = ["draft", "verified", "live"] as const;
export const EXERCISE_LANGUAGES = ["javascript", "typescript"] as const;

const hint = z.string().min(1);

export const exerciseSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "id must be kebab-case"),
  title: z.string().min(1),
  statement: z.string().min(1),
  language: z.enum(EXERCISE_LANGUAGES),
  starterCode: z.string(),
  /** Test source using the tiny API from runTests.ts: test(name, fn), assert, assert.equal, assert.deepEqual. */
  tests: z.string().min(1),
  referenceSolution: z.string().min(1),
  /** Exactly five strings: index 0 is level 1 (Nudge) ... index 4 is level 5 (Reveal). */
  fallbackHints: z.tuple([hint, hint, hint, hint, hint]),
  status: z.enum(EXERCISE_STATUSES),
});

export type Exercise = z.infer<typeof exerciseSchema>;
export type ExerciseStatus = Exercise["status"];

/** What hint code may see: never the reference solution. */
export type ExerciseForHint = Omit<Exercise, "referenceSolution">;

export function toExerciseForHint(exercise: Exercise): ExerciseForHint {
  // Explicit picks, so a field added later is not passed to hint code by accident.
  const { id, title, statement, language, starterCode, tests, fallbackHints, status } = exercise;
  return { id, title, statement, language, starterCode, tests, fallbackHints, status };
}
