"use client";
import Link from "next/link";
import { useState } from "react";
import { allPassed } from "../../lib/runner/results";
import { runInSandbox } from "../../lib/runner/run";
import type { RunOutcome, RunnableExercise } from "../../lib/runner/types";
import { HintLadderStub } from "./HintLadderStub";
import { markSolved } from "./solved";

export function Workspace({
  exercise,
  nextId,
}: {
  exercise: RunnableExercise;
  nextId?: string;
}) {
  const [code, setCode] = useState(exercise.starterCode);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const o = await runInSandbox(code, exercise.tests);
    setOutcome(o);
    setRunning(false);
    if (allPassed(o)) markSolved(exercise.id);
  }

  const passed = allPassed(outcome);
  const results = outcome?.results ?? [];
  const failing = results.filter((r) => !r.passed).length;

  return (
    <>
      <p className="crumb">
        <Link href="/exercises">Exercises</Link> / {exercise.title}
      </p>
      <h1>{exercise.title}</h1>
      <div className="ws-grid">
        <div>
          <p className="statement">{exercise.statement}</p>
          <label htmlFor="code-editor" style={{ fontWeight: 600 }}>
            Your code (JavaScript)
          </label>
          <textarea
            id="code-editor"
            className="editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-describedby="editor-help"
          />
          <p id="editor-help" className="crumb">
            Tab moves focus to the next control. Your code runs in your browser only.
          </p>
          <button type="button" className="btn" onClick={run} disabled={running}>
            {running ? "Running..." : "Run tests"}
          </button>

          <div role="status" aria-live="polite" aria-atomic="false" data-testid="results">
            {outcome && outcome.status !== "ok" && (
              <div className="card bad">
                <strong>{outcome.status === "timeout" ? "Timed out" : "Error"}</strong>
                <p>{outcome.message}</p>
              </div>
            )}
            {outcome && outcome.status === "ok" && (
              <div className={passed ? "card ok" : "card"}>
                <strong>
                  {passed
                    ? `All ${results.length} tests passed`
                    : `${failing} of ${results.length} tests failing`}
                </strong>
                <ul className="tests-list">
                  {results.map((r) => (
                    <li key={r.name} className={r.passed ? "t-ok" : "t-bad"}>
                      <span aria-hidden="true">{r.passed ? "✓" : "✗"}</span>{" "}
                      <span className="sr-only-prefix">{r.passed ? "Passed: " : "Failed: "}</span>
                      {r.name}
                      {!r.passed && <span className="t-msg">{r.message}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {passed && (
            <section className="card ok" aria-labelledby="complete-heading">
              <h2 id="complete-heading">Exercise complete</h2>
              <p>All tests pass. Hints used: 0.</p>
              {nextId ? (
                <Link className="btn" href={`/exercises/${nextId}`}>
                  Next exercise
                </Link>
              ) : (
                <Link className="btn" href="/exercises">
                  Back to exercises
                </Link>
              )}
            </section>
          )}
        </div>
        <HintLadderStub />
      </div>
    </>
  );
}
