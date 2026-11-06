import type { RunOutcome, TestResult } from "./types";

/** R2: shape untrusted worker output into a safe, bounded list of TestResult. */
export function shapeResults(raw: unknown): TestResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 200).map((r, i): TestResult => {
    const o = (r ?? {}) as Record<string, unknown>;
    const passed = o.passed === true;
    return {
      name: typeof o.name === "string" && o.name ? o.name.slice(0, 200) : `Test ${i + 1}`,
      passed,
      message: passed ? "" : String(o.message ?? "Test failed").slice(0, 500),
    };
  });
}

/** Shape a worker message into a RunOutcome. */
export function outcomeFromMessage(msg: unknown): RunOutcome {
  const m = (msg ?? {}) as Record<string, unknown>;
  if (m.type === "done") return { status: "ok", results: shapeResults(m.results) };
  return {
    status: "error",
    message: String(m.message ?? "Your code could not be run.").slice(0, 500),
    results: [],
  };
}

export function timeoutOutcome(limitMs: number): RunOutcome {
  return {
    status: "timeout",
    message: `Your code ran longer than ${limitMs / 1000}s and was stopped. Check for an infinite loop.`,
    results: [],
  };
}

export function allPassed(outcome: RunOutcome | null): boolean {
  return (
    !!outcome &&
    outcome.status === "ok" &&
    outcome.results.length > 0 &&
    outcome.results.every((r) => r.passed)
  );
}
