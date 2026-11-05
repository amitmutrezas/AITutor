import { runTests, type TestResult } from "./runTests.ts";
import type { Exercise } from "./schema.ts";

export interface VerifyReport {
  id: string;
  ok: boolean;
  /** Human-readable reasons verification failed (empty when ok). */
  problems: string[];
  referenceResults: TestResult[];
  starterResults: TestResult[];
}

const MIN_SHARED_LINE_LENGTH = 12;

/** E2 + E4: tests pass on the reference solution and at least one fails on the starter code. */
export function verifyExercise(exercise: Exercise, timeoutMs?: number): VerifyReport {
  const problems: string[] = [];
  const reference = runTests({ code: exercise.referenceSolution, tests: exercise.tests, timeoutMs });
  const starter = runTests({ code: exercise.starterCode, tests: exercise.tests, timeoutMs });

  for (const r of reference.results) {
    if (!r.passed) problems.push(`reference solution fails "${r.name}": ${r.message ?? ""}`);
  }
  if (starter.results.every((r) => r.passed)) {
    problems.push("starter code passes every test (exercise is already solved)");
  }

  // Skill rule: level 1-3 fallback hints contain no solution code.
  const solutionLines = new Set(
    exercise.referenceSolution
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= MIN_SHARED_LINE_LENGTH),
  );
  exercise.fallbackHints.slice(0, 3).forEach((hint, i) => {
    if (hint.split("\n").some((l) => solutionLines.has(l.trim()))) {
      problems.push(`fallback hint for level ${i + 1} contains a line of the reference solution`);
    }
  });

  return { id: exercise.id, ok: problems.length === 0, problems, referenceResults: reference.results, starterResults: starter.results };
}

/** A passing draft becomes verified, a failing verified one drops to draft. Live stays live (the caller fails CI). */
export function nextStatus(current: Exercise["status"], ok: boolean): Exercise["status"] {
  if (current === "live") return "live";
  return ok ? "verified" : "draft";
}

/** E2: a verified or live exercise that fails verification is an error (CI fails). Drafts may fail. */
export function isVerifyFailure(current: Exercise["status"], ok: boolean): boolean {
  return !ok && (current === "live" || current === "verified");
}
