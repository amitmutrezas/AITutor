// R1/R2: shared types for the in-browser runner. Client-side only (R3).

/** Minimal exercise shape the workspace needs. M1 owns the real schema; do not import it here. */
export type RunnableExercise = {
  id: string;
  title: string;
  statement: string;
  starterCode: string;
  /** Test source using the tiny API documented in testApi.ts. */
  tests: string;
};

export type TestResult = {
  name: string;
  passed: boolean;
  /** Failing assertion message, or empty string when passed. */
  message: string;
};

export type RunOutcome =
  | { status: "ok"; results: TestResult[] }
  /** Learner code threw before tests could run (syntax error, top-level throw). */
  | { status: "error"; message: string; results: TestResult[] }
  | { status: "timeout"; message: string; results: TestResult[] };
